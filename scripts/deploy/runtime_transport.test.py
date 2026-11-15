import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('runtime_transport', Path(__file__).with_name('runtime_transport.py'))
t = importlib.util.module_from_spec(spec)
spec.loader.exec_module(t)


class FullTransportContracts(unittest.TestCase):
    def test_closed_runtime_copy_parser_preserves_config_and_rejects_unsupported_forms(self):
        source = (Path(__file__).parents[2] / 'Dockerfile').read_text()
        layout = t.config_only_dockerfile(source)
        self.assertEqual(set(layout['copies']), set(t.COPY_PATHS))
        self.assertNotIn('\nCOPY ', layout['dockerfile'])
        self.assertIn('HEALTHCHECK', layout['dockerfile'])
        self.assertIn('CMD ["node", "scripts/docker-entrypoint.mjs"', layout['dockerfile'])
        original_runs = [line for line in source[source.index('FROM ${NODE_IMAGE} AS runtime'):].replace('\\\n', '').splitlines() if line.startswith('RUN ')]
        self.assertEqual([line for line in layout['dockerfile'].splitlines() if line.startswith('RUN ')], original_runs)
        for changed in [source.replace('COPY --from=builder --chown=physicsos:physicsos /app/node_modules ./node_modules', 'COPY /private ./node_modules'),
                        source + '\nADD secret /app/secret\n', source + '\nCOPY --from=builder --chown=physicsos:physicsos /app/extra ./extra\n']:
            with self.assertRaises(ValueError): t.config_only_dockerfile(changed)

    def test_runtime_configuration_comparison_ignores_only_approved_labels_and_never_echoes_env(self):
        config = {'User': 'physicsos', 'Env': ['PRIVATE=do-not-echo'], 'Cmd': ['node', 'server.js']}
        t.require_same_config({**config, 'Labels': {'physicsos.role': 'transport'}}, config)
        for changed in [{'Cmd': ['sleep', 'infinity']}, {'User': 'root'}, {'Env': []}, {'Labels': {'security.policy': 'changed'}}]:
            with self.assertRaises(ValueError) as error: t.require_same_config({**config, **changed}, config)
            self.assertNotIn('do-not-echo', str(error.exception))

    def test_copy_owner_normalization_preserves_symlink_identity_and_executable_mode(self):
        tree = {'node_modules': {'type': 'dir', 'mode': 0o755, 'uid': 0, 'gid': 0},
                'node_modules/react': {'type': 'symlink', 'mode': 0o777, 'uid': 0, 'gid': 0, 'target': '../packages/react'},
                'packages': {'type': 'dir', 'mode': 0o755, 'uid': 0, 'gid': 0},
                'packages/run.js': {'type': 'file', 'mode': 0o755, 'uid': 0, 'gid': 0, 'sha256': 'a' * 64, 'bytes': 1}}
        root = {'type': 'dir', 'mode': 0o755, 'uid': 999, 'gid': 999}
        desired = t.desired_tree({'entries': tree}, {'entries': {}, 'root': root, 'owner': {'uid': 999, 'gid': 999}})
        self.assertEqual(desired['entries']['packages/run.js']['mode'], 0o755)
        self.assertEqual(desired['entries']['node_modules/react']['target'], '../packages/react')
        self.assertTrue(all(row['uid'] == 999 and row['gid'] == 999 for row in desired['entries'].values()))
        with self.assertRaises(ValueError): t.desired_tree({'entries': tree}, {'entries': {'unreviewed': {}}, 'root': root})
        broken = {**tree, 'node_modules/react': {**tree['node_modules/react'], 'target': '../../../outside'}}
        with self.assertRaises(ValueError): t.validate_tree(broken)

    def scan(self, root):
        result = subprocess.run(['node', '-e', t.FS_JS], input=json.dumps({'root': str(root)}), text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def fixture(self, folder):
        before, after, stage = [folder / name for name in ['before', 'after', 'stage']]
        (before / 'scripts').mkdir(parents=True)
        (before / 'node_modules/.pnpm/react').mkdir(parents=True)
        (before / 'node_modules/.pnpm/react-old').mkdir(parents=True)
        (before / 'scripts/run.js').write_text('old code')
        os.chmod(before / 'scripts/run.js', 0o644)
        (before / 'obsolete').write_text('old owned file')
        (before / 'node_modules/.pnpm/react/index.js').write_text('export const ready = true')
        (before / 'node_modules/react').symlink_to('.pnpm/react-old')
        shutil.copytree(before, after, symlinks=True)
        (after / 'scripts/run.js').write_text('new code')
        os.chmod(after / 'scripts/run.js', 0o755)
        (after / 'obsolete').unlink()
        (after / 'node_modules/react').unlink(); (after / 'node_modules/react').symlink_to('.pnpm/react')
        expected_before, expected_after = self.scan(before), self.scan(after)
        changed = [name for name, row in expected_after['entries'].items() if expected_before['entries'].get(name) != row]
        for name in changed:
            row = expected_after['entries'][name]
            target = stage / 'payload' / name; target.parent.mkdir(parents=True, exist_ok=True)
            if row['type'] == 'symlink': target.symlink_to(row['target'])
            elif row['type'] == 'file': shutil.copy2(after / name, target)
        (stage / 'plan.json').write_text(json.dumps({'before': expected_before, 'after': expected_after, 'changed': changed}))
        script = folder / 'apply.cjs'; script.write_text(t.APPLY_JS)
        return before, after, stage, script

    def apply(self, before, stage, script):
        code = 'require(process.argv[1]).applyFullTransport(process.argv[2],process.argv[3]);'
        return subprocess.run(['node', '-e', code, str(script), str(before), str(stage)], text=True, capture_output=True)

    def test_transport_applies_code_deletions_modes_and_links_without_flattening_module_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            before, after, stage, script = self.fixture(Path(tmp))
            result = self.apply(before, stage, script)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(self.scan(before), self.scan(after))
            self.assertEqual(stat.S_IMODE((before / 'scripts/run.js').stat().st_mode), 0o755)
            self.assertTrue((before / 'node_modules/react').is_symlink())
            self.assertEqual((before / 'node_modules/react').resolve(), before / 'node_modules/.pnpm/react')
            self.assertFalse((before / 'obsolete').exists())

    def test_base_tamper_and_flattened_payload_link_are_rejected_before_any_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            before, _, stage, script = self.fixture(Path(tmp))
            (before / 'unreviewed').write_text('tamper')
            result = self.apply(before, stage, script)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((before / 'scripts/run.js').read_text(), 'old code')
            self.assertTrue((before / 'obsolete').exists())
            (before / 'unreviewed').unlink()
            link = stage / 'payload/node_modules/react'; link.unlink(); link.write_text('.pnpm/react')
            result = self.apply(before, stage, script)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((before / 'scripts/run.js').read_text(), 'old code')
            self.assertTrue((before / 'obsolete').exists())


if __name__ == '__main__': unittest.main()
