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
        self.assertIn(t.TEACHING_BRIDGE_LABEL, layout['dockerfile'].splitlines())
        self.assertIn('CMD ["node", "scripts/docker-entrypoint.mjs"', layout['dockerfile'])
        original_runs = [line for line in source[source.index('FROM ${NODE_IMAGE} AS runtime'):].replace('\\\n', '').splitlines() if line.startswith('RUN ')]
        self.assertEqual([line for line in layout['dockerfile'].splitlines() if line.startswith('RUN ')], original_runs)
        for changed in [source.replace('COPY --from=builder --chown=physicsos:physicsos /app/node_modules ./node_modules', 'COPY /private ./node_modules'),
                        source + '\nADD secret /app/secret\n', source + '\nCOPY --from=builder --chown=physicsos:physicsos /app/extra ./extra\n',
                        source + '\n' + t.TEACHING_BRIDGE_LABEL + '\n', source.replace(t.TEACHING_BRIDGE_LABEL, 'LABEL physicsos.unreviewed="true"')]:
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

    def test_many_small_files_reuse_bounded_hash_memory_and_keep_exact_multichunk_hashes(self):
        import hashlib
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for index in range(128): (root / f'file-{index}').write_bytes(f'payload-{index}'.encode())
            large = b'z' * (1024 * 1024 + 7)
            (root / 'large').write_bytes(large)
            prefix = 'let hashBuffers=0;const allocate=Buffer.allocUnsafe;Buffer.allocUnsafe=(size,...args)=>{if(size===1024*1024)hashBuffers++;return allocate(size,...args)};'
            suffix = ';process.once("beforeExit",()=>console.log(JSON.stringify({hashBuffers})));'
            result = subprocess.run(['node', '-e', prefix + t.FS_JS + suffix], input=json.dumps({'root': str(root)}), text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            proof, resources = map(json.loads, result.stdout.strip().splitlines())
            self.assertEqual(resources['hashBuffers'], 1)
            self.assertEqual(len(proof['entries']), 129)
            self.assertEqual(proof['entries']['large']['sha256'], hashlib.sha256(large).hexdigest())
            self.assertEqual(proof['entries']['file-0']['sha256'], hashlib.sha256(b'payload-0').hexdigest())

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





class SystemImageFilesystemProof(unittest.TestCase):
    def archive(self, certificate='certificate-v1', helper_mode=0o755, uid=0, target='/usr/bin/node', app='any-app', capability='caps-v1', mtime=1):
        import io
        import tarfile
        data = io.BytesIO()
        rows = [('etc/ssl/certs/ca-bundle.crt', certificate, 0o644), ('usr/local/bin/helper', 'helper', helper_mode),
                ('app/index.js', app, 0o644), ('.dockerenv', '', 0o755), ('etc/hosts', 'image-hosts', 0o644)]
        with tarfile.open(fileobj=data, mode='w', format=tarfile.PAX_FORMAT) as archive:
            root = tarfile.TarInfo('.'); root.type = tarfile.DIRTYPE; root.mode = 0o755; root.uid = uid; root.gid = 0; archive.addfile(root)
            for name, content, mode in rows:
                value = content.encode(); item = tarfile.TarInfo(name); item.size = len(value); item.mode = mode; item.uid = uid; item.gid = 0; item.mtime = mtime
                if name == 'usr/local/bin/helper': item.pax_headers = {'SCHILY.xattr.security.capability': capability}
                archive.addfile(item, io.BytesIO(value))
            link = tarfile.TarInfo('usr/local/bin/node-link'); link.type = tarfile.SYMTYPE; link.linkname = target; link.mode = 0o777; link.uid = uid; archive.addfile(link)
        data.seek(0)
        return data

    def test_runtime_run_system_file_change_is_rejected_even_when_config_and_app_are_equal(self):
        baseline = t.exported_system_tree(self.archive(), [])
        rebuilt = t.exported_system_tree(self.archive(certificate='new-certificate-from-reviewed-RUN'), [])
        t.require_same_config({'User': 'physicsos'}, {'User': 'physicsos'})
        with self.assertRaisesRegex(ValueError, 'outside /app'): t.require_same_system_fs(baseline, rebuilt)
        self.assertEqual(baseline, t.exported_system_tree(self.archive(app='different-frozen-app', mtime=99), []))

    def test_mode_owner_symlink_and_capability_changes_are_all_bound_by_the_system_proof(self):
        baseline = t.exported_system_tree(self.archive(), [])
        for patch in [{'helper_mode': 0o644}, {'uid': 999}, {'target': '/bin/false'}, {'capability': 'different-capabilities'}]:
            with self.subTest(change=patch), self.assertRaises(ValueError):
                t.require_same_system_fs(baseline, t.exported_system_tree(self.archive(**patch), []))
        self.assertIn('.dockerenv', baseline['entries'])
        self.assertIn('etc/hosts', baseline['entries'])
        with self.assertRaises(ValueError): t.exported_system_tree(self.archive(), ['etc/hosts'])

    def test_unstarted_export_audit_has_no_mounts_start_or_persisted_gigabyte_tar(self):
        from unittest.mock import patch, Mock
        image = 'sha256:' + 'a' * 64
        identifier = 'b' * 64
        details = {'Id': identifier, 'Image': image, 'Mounts': [], 'Network': 'none', 'Readonly': True, 'Privileged': False,
                   'State': {'Status': 'created', 'Pid': 0}, 'Labels': {'io.physicsos.role': 'ui-system-fs-audit', 'io.physicsos.task': 'ui-full-transport'}}
        calls = []
        def output(args, **kwargs):
            calls.append(args)
            if args[:3] == ['docker', 'image', 'inspect']: return 'null'
            if args[:2] == ['docker', 'create']: return identifier + '\n'
            return json.dumps(details)
        export = Mock(stdout=self.archive()); export.wait.return_value = 0; export.poll.return_value = 0
        with patch.object(t.subprocess, 'check_output', side_effect=output), patch.object(t.subprocess, 'Popen', return_value=export), patch.object(t, 'image_root_metadata', return_value={'type': 'dir', 'mode': 0o755, 'uid': 0, 'gid': 0}), patch.object(t.subprocess, 'run') as cleanup:
            proof = t.system_filesystem(image)
        self.assertEqual(proof['excludedDaemonFiles'], [])
        self.assertFalse(any(args[:2] == ['docker', 'start'] for args in calls))
        create = next(args for args in calls if args[:2] == ['docker', 'create'])
        self.assertIn('--read-only', create); self.assertIn('none', create); self.assertNotIn('--mount', create)
        self.assertEqual(cleanup.call_args.args[0], ['docker', 'rm', '-f', identifier])


if __name__ == '__main__': unittest.main()
