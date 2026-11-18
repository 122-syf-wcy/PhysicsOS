import copy
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('release_runtime', pathlib.Path(__file__).with_name('release-runtime.py'))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


def sha(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def frozen():
    files = {'packages/a/src/index.ts': sha('source')}
    source = {'revision': 'a' * 40, 'sourceDigest': sha(json.dumps(files, sort_keys=True, separators=(',', ':'))), 'files': files}
    scope = {'name': 'fixture', 'path': 'packages/physicsos/a', 'sourcePath': 'vendor/deepseek-harness/packages/physicsos/a', 'mode': 'host'}
    plan = {'revision': source['revision'], 'sourceDigest': source['sourceDigest'], 'packageScopes': [scope], 'vite': False}
    evidence = {**plan, 'evidence': [{'tool': 'typescript', 'exitCode': 0}, {'tool': 'tsdown', 'exitCode': 0}]}
    marker = dict(source)
    return source, plan, evidence, marker


def inventory_fixture(files, mode='host'):
    """Run the actual inventory program against inert JavaScript fixture files."""
    with tempfile.TemporaryDirectory() as temporary:
        root = pathlib.Path(temporary)
        prefix = 'packages/request-fixture'
        (root / prefix / 'lib').mkdir(parents=True)
        (root / prefix / 'package.json').write_text(json.dumps({'name': 'request-fixture'}))
        for name, code in files.items():
            (root / prefix / 'lib' / name).write_text(code)
        request = {'root': str(root), 'selections': [{'root': prefix, 'mode': mode, 'items': ['lib', 'package.json']}]}
        return subprocess.run(['node', '-e', runtime.INVENTORY_JS], input=json.dumps(request), text=True, capture_output=True)


class RuntimeDeltaTests(unittest.TestCase):
    def test_teaching_tools_marker_is_exported_and_labels_are_bound_to_the_manifest(self):
        marker = runtime.TEACHING_TOOLS_MARKER
        request = runtime.inventory_request({'changed': [marker], 'deleted': [], 'packageScopes': []})
        self.assertIn(marker, request['exact'])
        self.assertEqual(runtime.teaching_tools_bridge_label({}), '')
        self.assertEqual(runtime.teaching_tools_bridge_label({marker: 'a' * 64}), 'teaching-tools-bridge-v1')
        with self.assertRaises(ValueError):
            runtime.teaching_tools_bridge_label({marker: 'unverified'})
        record = {'revision': 'b' * 40, 'sourceDigest': 'c' * 64, 'codeDigest': 'd' * 64, 'teachingToolsBridge': 'teaching-tools-bridge-v1'}
        labels = {'org.opencontainers.image.revision': record['revision'], 'physicsos.source.digest': record['sourceDigest'], 'physicsos.code.digest': record['codeDigest'], runtime.TEACHING_TOOLS_LABEL: record['teachingToolsBridge']}
        metadata = {'id': 'sha256:' + 'e' * 64, 'labels': labels}
        self.assertEqual(runtime.validate_image_labels(metadata, record), metadata['id'])
        with self.assertRaises(ValueError):
            runtime.validate_image_labels({**metadata, 'labels': {**labels, runtime.TEACHING_TOOLS_LABEL: ''}}, record)

    def test_incremental_build_replaces_inherited_manifest_byte_label(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = pathlib.Path(temporary)
            context = output / 'context'
            context.mkdir()
            base_id, final_id = 'sha256:' + 'b' * 64, 'sha256:' + 'f' * 64
            current_digest, inherited_digest = 'c' * 64, 'a' * 64
            record = {'baseImage': base_id, 'revision': 'd' * 40, 'sourceDigest': 'e' * 64,
                      'codeDigest': 'f' * 64, 'bytesExported': 0, 'deletedFiles': [],
                      'changedFiles': [], 'contextHashes': {'app/physicsos-runtime-manifest.json': current_digest}}
            commands = []
            def command(args, request=None, log=False):
                commands.append(args)
                return str(output) if args[:2] == ['docker', 'info'] else ''
            with patch.object(runtime, 'load_export', return_value=(output, context, record, {'files': {}})), \
                 patch.object(runtime, 'image_metadata', side_effect=[{'id': base_id, 'labels': {'physicsos.manifest.digest': inherited_digest}}, {'id': final_id}]), \
                 patch.object(runtime, 'read_base_manifest', return_value={'files': {}}), \
                 patch.object(runtime, 'require_disk'), patch.object(runtime, 'command', side_effect=command), \
                 patch.object(runtime.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout='')), \
                 patch.object(runtime, 'validate_image_labels'), \
                 patch.object(runtime, 'verify_image', return_value={'verified': True, 'image': final_id}):
                runtime.build_runtime(SimpleNamespace(output_dir=str(output), image_tag='physicsos:fixture', reserve_bytes=0, base_tag=None))
            build = next(args for args in commands if args[:2] == ['docker', 'build'])
            labels = [build[i + 1] for i, arg in enumerate(build[:-1]) if arg == '--label']
            self.assertIn('physicsos.manifest.digest=' + current_digest, labels)
            self.assertNotIn('physicsos.manifest.digest=' + inherited_digest, labels)

    def test_repository_instruction_links_are_excluded_but_runtime_snapshots_stay_owned(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            repo = root / runtime.HARNESS
            (repo / 'src').mkdir(parents=True)
            (repo / 'src/index.js').write_text('export const value=1')
            (repo / 'package.json').write_text(json.dumps({'name': 'repository-fixture'}))
            for name in ['CLAUDE.md', 'packages/CLAUDE.md', 'vendor/CLAUDE.md', '.agents/notes/CLAUDE.md', '.claude/skills', '.cursor/rules', 'snapshots/case/expected.json']:
                target = repo / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.symlink_to('deliberately-absent-metadata-target')
            actual = repo / 'packages/fixture/src/snapshots/runtime.js'
            actual.parent.mkdir(parents=True)
            actual.write_text('export const snapshot=1')
            request = {'root': str(root), 'selections': [{'root': runtime.HARNESS, 'mode': 'files', 'items': ['.']}]}
            result = subprocess.run(['node', '-e', runtime.INVENTORY_JS], input=json.dumps(request), text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            files = json.loads(result.stdout)['files']
            self.assertIn(runtime.HARNESS + '/src/index.js', files)
            self.assertIn(runtime.HARNESS + '/packages/fixture/src/snapshots/runtime.js', files)
            self.assertFalse(any(name in files for name in runtime.REPOSITORY_DOC_LINKS))
            for name in runtime.REPOSITORY_DOC_LINKS | {runtime.HARNESS + '/snapshots/case/expected.json', runtime.HARNESS + '/.agents/notes/CLAUDE.md'}:
                with self.assertRaises(ValueError): runtime.safe_code_path(name)
            self.assertEqual(runtime.safe_code_path(runtime.HARNESS + '/packages/fixture/src/snapshots/runtime.js'), runtime.HARNESS + '/packages/fixture/src/snapshots/runtime.js')
            for name in ['src/runtime-link.js', 'packages/fixture/src/CLAUDE.md']:
                link = repo / name
                link.symlink_to('index.js')
                failed = subprocess.run(['node', '-e', runtime.INVENTORY_JS], input=json.dumps(request), text=True, capture_output=True)
                self.assertNotEqual(failed.returncode, 0)
                self.assertIn('Runtime export contains source link', failed.stderr)
                link.unlink()

    def test_legacy_prefixes_normalize_to_real_paths_and_reject_unknown_ownership(self):
        result = runtime.normalize_manifest({'schemaVersion': 1, 'files': {
            'ui-physicsos/src/index.ts': sha('ui'),
            'physicsos-packages/physics-scene/src/index.ts': sha('scene'),
            'student-preset/agent.cordis.yml': sha('preset'),
            'web-dist/index.html': sha('html'),
        }})
        self.assertIn('vendor/deepseek-harness/packages/client/ui-physicsos/src/index.ts', result['files'])
        self.assertEqual(result['files']['vendor/deepseek-harness/packages/client/ui-physicsos/src/index.ts'], sha('ui'))
        self.assertEqual(result['files']['packages/physics-scene/src/index.ts'], sha('scene'))
        self.assertEqual(result['files']['vendor/deepseek-harness/apps/cli/config/agent-presets/physics-student/agent.cordis.yml'], sha('preset'))
        with self.assertRaises(ValueError):
            runtime.normalize_manifest({'schemaVersion': 1, 'files': {'unknown/private-file': sha('bad')}})
        legacy_debug = runtime.normalize_manifest({'schemaVersion': 1, 'files': {'atomic-write/tests/atomic-write.spec.ts': sha('test'), 'plugin-center/lib/types/index.js.map': sha('map')}})
        self.assertEqual(len(legacy_debug['files']), 2)
        with self.assertRaises(ValueError):
            runtime.safe_code_path('vendor/deepseek-harness/packages/util/atomic-write/tests/atomic-write.spec.ts')

    def test_delta_skips_identical_files_and_deletes_only_selected_base_owned_paths(self):
        base = {'packages/a/src/keep.ts': sha('keep'), 'packages/a/src/deleted.ts': sha('old'), 'packages/b/src/unselected.ts': sha('keep')}
        candidate = {'packages/a/src/keep.ts': sha('keep'), 'packages/a/src/new.ts': sha('new')}
        delta = runtime.compute_delta(base, candidate, set(base) - {'packages/b/src/unselected.ts'})
        self.assertEqual(delta['changed'], ['packages/a/src/new.ts'])
        self.assertEqual(delta['deleted'], ['packages/a/src/deleted.ts'])
        self.assertEqual(delta['files']['packages/b/src/unselected.ts'], sha('keep'))

    def test_unsafe_runtime_paths_and_secret_or_dependency_trees_are_rejected(self):
        for path in ['../escape', '/var/lib/physicsos/data', '.env.database_url', 'packages/a/node_modules/secret', 'scripts/private.key', 'vendor/deepseek-harness/packages/a/../secret', 'packages\\escape']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                runtime.safe_code_path(path)
        self.assertEqual(runtime.safe_code_path('packages/ui/src/lib/cn.ts'), 'packages/ui/src/lib/cn.ts')

    def test_wrong_source_freeze_failed_build_or_missing_scope_fails_before_export(self):
        source, plan, evidence, marker = frozen()
        runtime.validate_freeze(source, plan, evidence, marker)
        for changed in [{**evidence, 'sourceDigest': 'f' * 64}, {**evidence, 'packageScopes': []}, {**evidence, 'evidence': [{'exitCode': 1}]}]:
            with self.assertRaises(ValueError):
                runtime.validate_freeze(source, plan, changed, marker)
        with self.assertRaises(ValueError):
            runtime.validate_freeze(source, plan, evidence, {**marker, 'revision': 'b' * 40})
        with self.assertRaisesRegex(ValueError, 'full runtime'):
            runtime.validate_freeze(source, {**plan, 'fullBuild': True}, evidence, marker)

    def test_deleted_file_scope_and_startup_file_are_inventoried_from_base_before_owned_deletion(self):
        plan = {'packageScopes': [{'path': 'packages/physicsos/a', 'mode': 'files', 'files': ['config/removed.yml'], 'deletedFiles': ['config/removed.yml']}], 'changed': [], 'deleted': ['scripts/healthcheck.mjs']}
        self.assertTrue(callable(getattr(runtime, 'inventory_request', None)))
        candidate = runtime.inventory_request(plan)
        base = runtime.inventory_request(plan, base=True)
        self.assertEqual(candidate['selections'][0]['items'], [])
        self.assertEqual(base['selections'][0]['items'], ['config/removed.yml'])
        self.assertNotIn('scripts/healthcheck.mjs', candidate['exact'])
        self.assertIn('scripts/healthcheck.mjs', base['exact'])

    def test_vite_inventory_uses_real_dist_paths_without_dot_aliases(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            prefix = 'vendor/deepseek-harness/apps/web/dist'
            (root / prefix).mkdir(parents=True)
            (root / prefix / 'index.html').write_text('html')
            request = {'root': str(root), 'selections': [{'root': prefix, 'items': ['.']}]}
            result = subprocess.run(['node', '-e', runtime.INVENTORY_JS], input=json.dumps(request), text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(set(json.loads(result.stdout)['files']), {prefix + '/index.html'})

    def test_real_package_inventory_resolves_external_dependency_version(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            prefix = 'packages/a'
            (root / prefix / 'lib').mkdir(parents=True)
            (root / prefix / 'lib/index.js').write_text('import library from "fixture-library"; export { library }')
            (root / prefix / 'package.json').write_text(json.dumps({'name': 'a', 'dependencies': {'fixture-library': '1.0.0'}}))
            library = root / prefix / 'node_modules/fixture-library'
            library.mkdir(parents=True)
            (library / 'package.json').write_text(json.dumps({'name': 'fixture-library', 'version': '1.0.0', 'main': 'index.js'}))
            (library / 'index.js').write_text('module.exports = {}')
            request = {'root': str(root), 'selections': [{'root': prefix, 'mode': 'host', 'items': ['lib', 'package.json']}]}
            result = subprocess.run(['node', '-e', runtime.INVENTORY_JS], input=json.dumps(request), text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)['packages'][prefix]['resolvedBare']['fixture-library'], {'name': 'fixture-library', 'version': '1.0.0'})

    def test_import_only_exports_and_prefix_only_builtins_are_checked_without_execution(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary).resolve()
            prefix = 'packages/a'
            library = root / prefix / 'node_modules/fixture-esm'
            origin = root / prefix / 'lib/index.js'
            library.mkdir(parents=True)
            origin.parent.mkdir()
            (root / prefix / 'package.json').write_text(json.dumps({'name': 'a', 'dependencies': {'fixture-esm': '1.0.0'}}))
            (library / 'package.json').write_text(json.dumps({'name': 'fixture-esm', 'version': '1.0.0', 'exports': {'import': './index.mjs'}}))
            code = 'throw Error("dependency code must not execute")'
            (library / 'index.mjs').write_text(code)
            request = {'root': str(root), 'selections': [{'root': prefix, 'mode': 'host', 'items': ['lib', 'package.json']}]}

            def scan(source):
                origin.write_text(source)
                result = subprocess.run(['node', '-e', runtime.INVENTORY_JS], input=json.dumps(request), text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                return json.loads(result.stdout)['packages'][prefix]

            source = 'export * from "fixture-esm"; import("fixture-esm"); import("node:sqlite");'
            meta = scan(source)
            entries = [{'owner': prefix + '/lib/index.js', 'path': prefix + '/node_modules/fixture-esm/index.mjs', 'sha256': sha(code)}]
            self.assertEqual(meta['nodeRequests'], ['fixture-esm'])
            self.assertEqual(meta['resolvedBare']['fixture-esm'], {'name': 'fixture-esm', 'version': '1.0.0', 'importEntries': entries})
            update = runtime.workspace_updates({prefix: meta}, {prefix: meta}, {})
            updater = root / 'update.cjs'; updater.write_text(runtime.UPDATE_JS)
            driver = 'require(process.argv[1]).applyRuntimeUpdate(process.argv[2],JSON.parse(require("fs").readFileSync(0,"utf8")))'
            args = ['node', '-e', driver, str(updater), str(root)]
            update['deleted'] = []
            result = subprocess.run(args, input=json.dumps(update), text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            (library / 'index.mjs').write_text(code + ';')
            changed = subprocess.run(args, input=json.dumps(update), text=True, capture_output=True)
            self.assertNotEqual(changed.returncode, 0)
            self.assertIn('ESM-only runtime entry failed path/byte verification', changed.stderr)
            with self.assertRaisesRegex(ValueError, 'Resolved external dependency version changed'):
                runtime.workspace_updates({prefix: scan(source)}, {prefix: meta}, {})
            self.assertIsNone(scan(source + 'require("fixture-esm");')['resolvedBare']['fixture-esm'])

    def test_inlined_client_library_absent_from_base_is_not_a_node_runtime_dependency(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            prefix = 'vendor/deepseek-harness/packages/client/ui'
            (root / prefix / 'lib').mkdir(parents=True)
            (root / prefix / 'package.json').write_text(json.dumps({'name': 'fixture-ui', 'dependencies': {'idb': '8.0.4'}}))
            (root / prefix / 'lib/index.js').write_text('const prompt = \'import fake from "idb";\'; export const nodeHalf = true')
            (root / prefix / 'lib/client.js').write_text('window.__ModuleLoader__.load({factory: require => {const inlinedIdb = {}; return inlinedIdb}})')
            request = {'root': str(root), 'selections': [{'root': prefix, 'mode': 'client', 'items': ['lib', 'package.json']}]}
            result = subprocess.run(['node', '-e', runtime.INVENTORY_JS], input=json.dumps(request), text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            meta = json.loads(result.stdout)['packages'][prefix]
            self.assertEqual(meta['nodeRequests'], [])
            self.assertEqual(meta['clientRequests'], [])
            self.assertEqual(meta['resolvedBare'], {})
            self.assertEqual(runtime.workspace_updates({prefix: meta}, {prefix: meta}, {})['links'], [])

    def test_real_inventory_does_not_turn_bundle_regex_and_from_properties_into_dependencies(self):
        # The deployed bundle contains quoted-character regexes followed by
        # connector {from, to} fields. Neither is an import declaration.
        code = r'''export function parse(v) {
  const pattern = /["']/;
  return {from: id(v.from, "from"), to: id(v.to, "to")};
}
const regexCalls = /require("regex-decoy")|import("regex-import-decoy")/;
const text = 'require("string-decoy")';
const template = `import "template-decoy"`;
// require("line-comment-decoy")
/* export * from "block-comment-decoy" */
obj.require("member-decoy"); obj.__require("member-helper-decoy");
obj["require"]("computed-member-decoy"); obj?.require("optional-member-decoy");
'''
        result = inventory_fixture({'index.js': code})
        self.assertEqual(result.returncode, 0, result.stderr)
        meta = json.loads(result.stdout)['packages']['packages/request-fixture']
        self.assertEqual(meta['nodeRequests'], [])
        self.assertEqual(meta['resolvedBare'], {})

    def test_real_inventory_keeps_static_dynamic_helper_and_client_requests(self):
        result = inventory_fixture({
            'index.js': r'''import "fixture-side-effect";
import value from "fixture-default/subpath";
export { value } from "fixture-export/subpath";
export * from "@fixture/export/all";
require("fixture-cjs/subpath"); __require("@fixture/helper/subpath");
(require)("fixture-parenthesized");
import("fixture-dynamic"); import(`fixture-static-template`);
require("\x66ixture-escaped");
const template = `value: ${require("fixture-interpolation")}`;
import "node:fs"; require("path"); import "./chunk.js";
''',
            'chunk.js': 'export * from "fixture-chunk"; require("./index.js");',
            'client.js': r'''window.__ModuleLoader__.load({factory: require => {
  const pattern = /["']/;
  require("@fixture/client/subpath"); __require("fixture-client-helper");
  return `value: ${import("fixture-client-dynamic")}`;
}});''',
            'optional-plot.js': 'import("fixture-optional"); obj.require("not-a-module-request");',
        }, mode='client')
        self.assertEqual(result.returncode, 0, result.stderr)
        meta = json.loads(result.stdout)['packages']['packages/request-fixture']
        self.assertEqual(meta['nodeRequests'], sorted([
            '@fixture/export/all', '@fixture/helper/subpath', 'fixture-chunk',
            'fixture-cjs/subpath', 'fixture-default/subpath', 'fixture-dynamic',
            'fixture-escaped', 'fixture-export/subpath', 'fixture-interpolation',
            'fixture-parenthesized', 'fixture-side-effect', 'fixture-static-template',
        ]))
        self.assertEqual(meta['clientRequests'], sorted([
            '@fixture/client/subpath', 'fixture-client-dynamic',
            'fixture-client-helper', 'fixture-optional',
        ]))

    def test_real_inventory_hashes_static_client_css_and_still_scans_commonjs_requests(self):
        css = '.badge { display: inline-flex; color: #fff }'
        result = inventory_fixture({'index.js': 'import styles from "./Badge.module.css"; require("./required.css");',
                                    'Badge.module.css': css, 'required.css': 'require("fixture-executable-request")'}, mode='client')
        self.assertEqual(result.returncode, 0, result.stderr)
        inventory = json.loads(result.stdout)
        self.assertEqual(inventory['files']['packages/request-fixture/lib/Badge.module.css']['sha256'], sha(css))
        self.assertEqual(inventory['packages']['packages/request-fixture']['nodeRequests'], ['fixture-executable-request'])
        rejected = inventory_fixture({'index.js': 'import "./Badge.module.css";', 'Badge.module.css': css})
        self.assertNotEqual(rejected.returncode, 0)

    def test_real_inventory_refuses_invalid_javascript_instead_of_silently_missing_requests(self):
        result = inventory_fixture({'index.js': 'export const broken = /unterminated'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Invalid JavaScript in runtime dependency inventory', result.stderr)

    def test_noop_preserves_the_published_image_revision_and_reports_requested_inputs_separately(self):
        base = {'revision': 'a' * 40, 'sourceDigest': 'b' * 64, 'codeDigest': 'c' * 64}
        requested = {'baseImage': 'sha256:' + 'd' * 64, 'revision': 'e' * 40, 'sourceDigest': 'f' * 64}
        report = runtime.noop_report(base, requested, {'changed': [], 'deleted': []})
        self.assertTrue(report['noop'])
        self.assertEqual(report['revision'], base['revision'])
        self.assertEqual(report['sourceDigest'], base['sourceDigest'])
        self.assertEqual(report['requestedSourceDigest'], requested['sourceDigest'])

    def test_real_inventory_records_absolute_and_root_escaping_requests_for_reuse_refusal(self):
        # The real fixture importer is <root>/packages/request-fixture/lib/index.js.
        # Three parents leave its package but stay in <root>; four escape <root>.
        importer_dir = '/app/packages/request-fixture/lib'
        self.assertEqual(os.path.normpath(os.path.join(importer_dir, '../../../in-root.js')), '/app/in-root.js')
        self.assertEqual(os.path.normpath(os.path.join(importer_dir, '../../../../outside.js')), '/outside.js')
        result = inventory_fixture({'index.js': 'import "/var/lib/unreviewed.mjs"; import "file:/opt/foreign.mjs"; import "../../../in-root.js"; import "../../../../outside.js";'})
        self.assertEqual(result.returncode, 0, result.stderr)
        package = json.loads(result.stdout)['packages']['packages/request-fixture']
        self.assertEqual(package['unsafeNodeRequests'], sorted(['/var/lib/unreviewed.mjs', 'file:/opt/foreign.mjs', '../../../../outside.js']))
        self.assertNotIn('../../../in-root.js', package['unsafeNodeRequests'])
        with self.assertRaisesRegex(ValueError, 'root-escaping'):
            runtime.registry_additions({'packages/request-fixture': package}, {'packages/request-fixture': package}, {})
        inside = inventory_fixture({'index.js': 'import "../../../in-root.js"; import "./chunk.js";', 'chunk.js': 'require("fixture-in-package");'})
        self.assertEqual(inside.returncode, 0, inside.stderr)
        inside_package = json.loads(inside.stdout)['packages']['packages/request-fixture']
        self.assertEqual(inside_package['unsafeNodeRequests'], [])
        self.assertEqual(inside_package['nodeRequests'], ['fixture-in-package'])
        self.assertEqual(inside_package['nodeRequestOrigins']['fixture-in-package'], ['packages/request-fixture/lib/chunk.js'])

    def test_runtime_updater_preflights_all_owned_deletions_before_mutating_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            (root / 'packages/a/src').mkdir(parents=True)
            owned = root / 'packages/a/src/old.ts'
            owned.write_text('old')
            script = root / 'updater.cjs'
            script.write_text(runtime.UPDATE_JS)
            request = {'deleted': [{'path': 'packages/a/src/old.ts', 'sha256': sha('old')}, {'path': '../unowned', 'sha256': sha('bad')}], 'links': [], 'checks': []}
            code = 'const f=require("fs"),api=require(process.argv[1]);let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>api.applyRuntimeUpdate(process.argv[2],JSON.parse(s)));'
            invalid = subprocess.run(['node', '-e', code, str(script), str(root)], input=json.dumps(request), text=True, capture_output=True)
            self.assertNotEqual(invalid.returncode, 0)
            self.assertEqual(owned.read_text(), 'old')
            valid = {**request, 'deleted': request['deleted'][:1]}
            accepted = subprocess.run(['node', '-e', code, str(script), str(root)], input=json.dumps(valid), text=True, capture_output=True)
            self.assertEqual(accepted.returncode, 0, accepted.stderr)
            self.assertFalse(owned.exists())

    def test_changed_external_registry_dependency_requires_full_runtime_build(self):
        old = {'name': 'fixture', 'dependencies': {'react': '18.3.1'}}
        new = {'name': 'fixture', 'dependencies': {'react': '19.0.0'}}
        with self.assertRaisesRegex(ValueError, 'full runtime'):
            runtime.workspace_updates({'packages/a': new}, {'packages/a': old}, {})
        self.assertEqual(runtime.workspace_updates({'packages/a': old}, {'packages/a': old}, {})['links'], [])
        with self.assertRaisesRegex(ValueError, 'full runtime'):
            runtime.workspace_updates({'packages/a': {**old, 'resolvedBare': {'react': {'name': 'react', 'version': '19.0.0'}}}}, {'packages/a': {**old, 'resolvedBare': {'react': {'name': 'react', 'version': '18.3.1'}}}}, {})

    def test_context_hash_corruption_and_wrong_image_labels_fail_admission(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            (root / 'app/scripts').mkdir(parents=True)
            (root / 'app/scripts/fixture.mjs').write_text('source')
            record = {'baseImage': 'sha256:' + 'b' * 64, 'revision': 'a' * 40, 'sourceDigest': 'c' * 64, 'codeDigest': 'd' * 64, 'contextHashes': {'app/scripts/fixture.mjs': sha('source')}}
            runtime.verify_context(root, record)
            (root / 'app/scripts/fixture.mjs').write_text('corrupted')
            with self.assertRaises(ValueError):
                runtime.verify_context(root, record)
        labels = {'org.opencontainers.image.revision': record['revision'], 'physicsos.source.digest': record['sourceDigest'], 'physicsos.code.digest': record['codeDigest']}
        runtime.validate_image_labels({'id': 'sha256:' + 'e' * 64, 'labels': labels}, record)
        with self.assertRaises(ValueError):
            runtime.validate_image_labels({'id': 'sha256:' + 'e' * 64, 'labels': {**labels, 'physicsos.source.digest': 'f' * 64}}, record)

    def test_remote_docker_filesystem_budget_preserves_reserve_and_inode_checks(self):
        self.assertTrue(callable(getattr(runtime, 'assert_disk_budget', None)))
        runtime.assert_disk_budget({'freeBytes': 512 * 1024 * 1024, 'freeInodes': 8000}, 32 * 1024 * 1024)
        with self.assertRaises(ValueError):
            runtime.assert_disk_budget({'freeBytes': 300 * 1024 * 1024, 'freeInodes': 8000}, 32 * 1024 * 1024)
        with self.assertRaises(ValueError):
            runtime.assert_disk_budget({'freeBytes': 512 * 1024 * 1024, 'freeInodes': 3000}, 32 * 1024 * 1024)

    def test_signed_plugin_entry_and_existing_trust_root_are_checked_with_real_node_crypto(self):
        self.assertIsNotNone(shutil.which('node'), 'tooling image must expose its existing Node runtime')
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            script = r'''const f=require('fs'),p=require('path'),c=require('crypto');const root=process.argv[1];f.writeFileSync(p.join(root,'entry.mjs'),'export {}');const key=c.generateKeyPairSync('ed25519');f.writeFileSync(p.join(root,'signing.pub'),key.publicKey.export({type:'spki',format:'pem'}));const e={id:'fixture',name:'Fixture',version:'1',harnessRange:'*',capabilities:[],entry:'entry.mjs',publisher:'fixture',sha256:c.createHash('sha256').update(f.readFileSync(p.join(root,'entry.mjs'))).digest('hex')};const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}':JSON.stringify(v);e.signature='ed25519:'+c.sign(null,Buffer.from(canonical(e)),key.privateKey).toString('base64');f.writeFileSync(p.join(root,'manifest.json'),JSON.stringify({schemaVersion:1,entries:[e]}));'''
            subprocess.run(['node', '-e', script, str(root)], check=True, capture_output=True)
            (root / 'harness').mkdir()
            (root / 'entry.mjs').rename(root / 'harness/entry.mjs')
            request = {'root': str(root), 'entryRoot': 'harness', 'manifestPath': 'manifest.json', 'publicKeyPath': 'signing.pub'}
            result = subprocess.run(['node', '-e', runtime.SIGNATURE_JS], input=json.dumps(request), text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(result.stdout, 'signature verification must return proof')
            proof = json.loads(result.stdout)
            runtime.validate_signature_proofs(proof, proof)
            with self.assertRaises(ValueError):
                runtime.validate_signature_proofs(proof, {**proof, 'publicKeySha256': 'f' * 64})
            manifest = json.loads((root / 'manifest.json').read_text())
            manifest['entries'][0]['signature'] = 'ed25519:' + 'A' * 88
            (root / 'manifest.json').write_text(json.dumps(manifest))
            invalid = subprocess.run(['node', '-e', runtime.SIGNATURE_JS], input=json.dumps(request), text=True, capture_output=True)
            self.assertNotEqual(invalid.returncode, 0)




class RegistryReuseTests(unittest.TestCase):
    prefix = runtime.HARNESS + '/packages/physicsos/fixture'
    target = runtime.HARNESS + '/node_modules/.pnpm/fixture-native@1.0.0/node_modules/fixture-native'

    def inventories(self):
        old = {'name': 'fixture', 'mode': 'host', 'dependencies': {'zod': '4.4.3'},
               'nodeRequests': ['zod'], 'clientRequests': [], 'resolvedBare': {'zod': {'name': 'zod', 'version': '4.4.3'}}}
        new = {**copy.deepcopy(old), 'dependencies': {'zod': '4.4.3', 'fixture-native': '1.0.0'},
               'nodeRequests': ['fixture-native', 'zod'], 'nodeRequestOrigins': {'fixture-native': [self.prefix + '/lib/index.js']},
               'resolvedBare': {**old['resolvedBare'], 'fixture-native': {'name': 'fixture-native', 'version': '1.0.0'}}}
        return {self.prefix: new}, {self.prefix: old}

    def proof(self, artifact=None, before=None):
        if artifact is None:
            candidate, base = self.inventories()
            row = runtime.registry_additions(candidate, base, {})[0]
            entries = {self.target: {'type': 'dir', 'mode': 0o755},
                       self.target + '/package.json': {'type': 'file', 'mode': 0o644, 'bytes': 10, 'sha256': sha('manifest')},
                       self.target + '/index.cjs': {'type': 'file', 'mode': 0o644, 'bytes': 10, 'sha256': sha('entry')}}
            row.update({'target': self.target, 'entries': {kind: {'path': self.target + '/index.cjs', 'sha256': sha('entry')} for kind in ['require', 'import']}})
            artifact = {'abi': {'node': '24.7.0', 'modules': '137', 'platform': 'linux', 'arch': 'x64', 'libc': 'glibc', 'nodeSha256': sha('node binary'), 'sharedLibraries': []},
                        'entries': entries, 'packages': {}, 'requests': [row]}
        rows = [{**row, 'beforeLink': before or {'type': 'absent'}} for row in artifact['requests']]
        value = {'format': 'physicsos-registry-reuse/1', 'schemaVersion': 1,
                 'base': {'image': 'sha256:' + 'a' * 64, 'revision': 'b' * 40, 'sourceDigest': 'c' * 64, 'manifestSha256': '6' * 64, 'codeDigest': '7' * 64},
                 'candidate': {'image': 'sha256:' + 'd' * 64, 'id': 'e' * 64, 'revision': 'f' * 40, 'sourceDigest': '1' * 64},
                 **{key: '2' * 64 for key in ['nodeInventoryDigest', 'baselineSourceManifestDigest', 'planDigest', 'publicKeySha256']},
                 'requests': rows, 'origins': [{**row, 'owner': row['from'] + '/lib/index.js'} for row in artifact['requests']],
                 'artifacts': artifact, 'artifactDigest': runtime.sha(runtime.canonical(artifact))}
        value['proofDigest'] = runtime.sha(runtime.canonical(value))
        return value

    def test_default_rejects_additions_and_safe_proof_links_only_existing_base_artifact(self):
        candidate, base = self.inventories()
        with self.assertRaisesRegex(ValueError, 'full runtime'):
            runtime.workspace_updates(candidate, base, {})
        proof = self.proof()
        runtime.validate_registry_reuse_proof(proof, copy.deepcopy(proof))
        update = runtime.workspace_updates(candidate, base, {}, proof)
        self.assertEqual(update['links'], [{'link': self.prefix + '/node_modules/fixture-native', 'target': self.target,
                                           'registry': True, 'before': {'type': 'absent'}}])
        self.assertIn('fixture-native', update['checks'][0]['dependencies'])

    def test_new_registry_links_do_not_overwrite_inherited_audited_links(self):
        candidate, base = self.inventories()
        proof = self.proof()
        inherited = runtime.HARNESS + '/node_modules/.pnpm/zod@4.4.3/node_modules/zod'
        artifact = proof['artifacts']
        artifact['entries'][inherited] = {'type': 'dir', 'mode': 0o755}
        artifact['entries'][inherited + '/package.json'] = {'type': 'file', 'mode': 0o644, 'bytes': 10, 'sha256': sha('inherited manifest')}
        entry = {'path': inherited + '/index.cjs', 'sha256': sha('inherited')}
        artifact['entries'][entry['path']] = {'type': 'file', 'mode': 0o644, 'bytes': 9, 'sha256': entry['sha256']}
        row = {'from': self.prefix, 'request': 'zod', 'name': 'zod', 'specifier': '4.4.3', 'target': inherited,
               'resolved': {'name': 'zod', 'version': '4.4.3'}, 'entries': {'require': entry, 'import': entry}}
        artifact['requests'].append(row)
        proof['requests'].append({**row, 'beforeLink': {'type': 'symlink', 'realpath': inherited, 'target': '../retained-zod'}})
        proof['origins'].append({**row, 'owner': self.prefix + '/lib/index.js'})
        proof.update(retainedProofDigest=sha('prior manifest proof'), retainedRequests=[[self.prefix, 'zod']])
        proof['artifactDigest'] = sha(runtime.canonical(artifact))
        proof['proofDigest'] = sha(runtime.canonical({k: v for k, v in proof.items() if k != 'proofDigest'}))
        update = runtime.workspace_updates(candidate, base, {}, proof)
        self.assertEqual([link['link'] for link in update['links']], [self.prefix + '/node_modules/fixture-native'])
        self.assertEqual(update['checks'][0]['dependencies'], ['fixture-native', 'zod'])
        proof['requests'][1]['beforeLink'] = {'type': 'absent'}
        proof['proofDigest'] = sha(runtime.canonical({k: v for k, v in proof.items() if k != 'proofDigest'}))
        with self.assertRaisesRegex(ValueError, 'Retained registry request/link'):
            runtime.workspace_updates(candidate, base, {}, proof)

    def test_existing_spec_version_removal_client_external_and_root_escape_stay_rejected(self):
        candidate, base = self.inventories()
        for edit in [lambda m: m['dependencies'].update(zod='^4.4.3'),
                     lambda m: m['resolvedBare']['zod'].update(version='5.0.0'),
                     lambda m: m['nodeRequests'].remove('zod'),
                     lambda m: m.update(clientRequests=['fixture-native']),
                     lambda m: m.update(unsafeNodeRequests=['/var/lib/unreviewed.js']),
                     lambda m: m['nodeRequestOrigins'].update({'fixture-native': ['../outside.js']})]:
            changed = copy.deepcopy(candidate)
            edit(changed[self.prefix])
            with self.subTest(edit=edit), self.assertRaises(ValueError):
                runtime.workspace_updates(changed, base, {}, self.proof())
        for request in ['../../external', '/app/external', 'file:/opt/private', '@fixture/name/../../../secret']:
            with self.subTest(request=request), self.assertRaises(ValueError):
                runtime.bare_name(request)

    def test_self_rehashed_proof_and_true_booleans_do_not_admit_changed_metadata(self):
        proof = self.proof()
        for edit in [lambda p: p['candidate'].update(sourceDigest='3' * 64),
                     lambda p: p['base'].update(image='sha256:' + '4' * 64),
                     lambda p: p['artifacts']['entries'][self.target + '/index.cjs'].update(sha256=sha('tampered')),
                     lambda p: p.update(verified=True, trusted=True),
                     lambda p: p.update(nodeInventoryDigest='5' * 64)]:
            changed = copy.deepcopy(proof)
            edit(changed)
            changed['artifactDigest'] = runtime.sha(runtime.canonical(changed['artifacts']))
            changed['proofDigest'] = runtime.sha(runtime.canonical({key: value for key, value in changed.items() if key != 'proofDigest'}))
            with self.subTest(edit=edit), self.assertRaises(ValueError):
                runtime.validate_registry_reuse_proof(changed, proof)

    def test_registry_lock_accepts_add_only_baseline_reference_and_rejects_graph_or_existing_ref_changes(self):
        candidate, base = self.inventories()
        additions = runtime.registry_additions(candidate, base, {})
        graph = {'packages': {'fixture-native@1.0.0': {'resolution': {'integrity': 'same'}}},
                 'snapshots': {'fixture-native@1.0.0': {}}, 'settings': {'policy': 'same'}}
        reference = {'specifier': '1.0.0', 'version': '1.0.0'}
        before = {'graph': graph, 'importers': {'packages/attachment/fixture': {'dependencies': {'fixture-native': reference}},
                                              'packages/physicsos/fixture': {'dependencies': {'zod': {'specifier': '4.4.3', 'version': '4.4.3'}}}}}
        after = copy.deepcopy(before)
        after['importers']['packages/physicsos/fixture']['dependencies']['fixture-native'] = reference
        runtime.validate_registry_lock(after, before, additions, {})
        for change in [lambda d: d['graph']['packages']['fixture-native@1.0.0']['resolution'].update(integrity='changed'),
                       lambda d: d['graph'].update(settings={'policy': 'changed'}),
                       lambda d: d['importers']['packages/physicsos/fixture']['dependencies']['zod'].update(version='5.0.0'),
                       lambda d: d['importers']['packages/physicsos/fixture']['dependencies']['fixture-native'].update(version='2.0.0')]:
            invalid = copy.deepcopy(after)
            change(invalid)
            with self.subTest(change=change), self.assertRaises(ValueError):
                runtime.validate_registry_lock(invalid, before, additions, {})
        no_reference = copy.deepcopy(before)
        no_reference['importers'].pop('packages/attachment/fixture')
        with self.assertRaisesRegex(ValueError, 'Existing/new external lock importer changed without an audited Node addition'):
            runtime.validate_registry_lock(after, no_reference, additions, {})

    def test_registry_lock_accepts_reachable_transitive_promotion_without_changing_the_graph(self):
        candidate, base = self.inventories()
        additions = runtime.registry_additions(candidate, base, {})
        graph = {'packages': {'fixture-native@1.0.0': {'resolution': {'integrity': 'sha512-locked'}}, 'fixture-parent@2.0.0': {'resolution': {'integrity': 'sha512-parent'}}},
                 'snapshots': {'fixture-native@1.0.0': {}, 'fixture-parent@2.0.0': {'dependencies': {'fixture-native': '1.0.0'}}}}
        before = {'graph': graph, 'importers': {'packages/parent': {'dependencies': {'fixture-parent': {'specifier': '2.0.0', 'version': '2.0.0'}}},
                                              'packages/physicsos/fixture': {'dependencies': {'zod': {'specifier': '4.4.3', 'version': '4.4.3'}}}}}
        after = copy.deepcopy(before)
        after['importers']['packages/physicsos/fixture']['dependencies']['fixture-native'] = {'specifier': '1.0.0', 'version': '1.0.0'}
        runtime.validate_registry_lock(after, before, additions, {})
        for mutate in [lambda d: d['graph']['snapshots']['fixture-parent@2.0.0'].update(dependencies={}),
                       lambda d: d['graph']['packages']['fixture-native@1.0.0'].update(resolution={}),
                       lambda d: d['importers'].pop('packages/parent')]:
            old = copy.deepcopy(before); mutate(old)
            new = copy.deepcopy(after); new['graph'] = copy.deepcopy(old['graph'])
            if 'packages/parent' not in old['importers']: new['importers'].pop('packages/parent')
            with self.subTest(mutate=mutate), self.assertRaisesRegex(ValueError, 'reachable baseline'):
                runtime.validate_registry_lock(new, old, additions, {})
        changed = copy.deepcopy(after)
        changed['graph']['packages']['fixture-native@1.0.0']['resolution']['integrity'] = 'sha512-changed'
        with self.assertRaisesRegex(ValueError, 'graph/resolution/integrity'):
            runtime.validate_registry_lock(changed, before, additions, {})

    def test_registry_policies_pin_absent_root_metadata_to_exact_base_source_attestation(self):
        lock = runtime.HARNESS + '/pnpm-lock.yaml'
        workspace = runtime.HARNESS + '/pnpm-workspace.yaml'
        old_files = {lock: sha('old lock'), workspace: sha('policy'), '.npmrc': sha('npm policy'), 'pnpm-lock.yaml': sha('root lock')}
        files = {**old_files, lock: sha('new lock')}
        baseline = {'revision': 'a' * 40, 'files': old_files, 'sourceDigest': runtime.sha(runtime.canonical(old_files))}
        source = {'revision': 'b' * 40, 'files': files, 'sourceDigest': runtime.sha(runtime.canonical(files))}
        base = {**baseline, 'files': {lock: old_files[lock], workspace: old_files[workspace]}}
        before = {lock: old_files[lock], workspace: old_files[workspace], '.npmrc': None, 'pnpm-lock.yaml': None}
        runtime.validate_registry_sources(source, baseline, base, before, files)
        for args in [(source, {**baseline, 'revision': 'c' * 40}, base, before, files),
                     (source, baseline, base, {**before, lock: sha('unattested lock')}, files),
                     (source, baseline, base, before, {**files, '.npmrc': sha('private change')}),
                     (source, baseline, base, {**before, workspace: None}, files)]:
            with self.subTest(args=args[3]), self.assertRaises(ValueError):
                runtime.validate_registry_sources(*args)
        bad_source = copy.deepcopy(source)
        bad_source['files']['.npmrc'] = sha('new trust policy')
        bad_source['sourceDigest'] = runtime.sha(runtime.canonical(bad_source['files']))
        with self.assertRaisesRegex(ValueError, 'policy/root lock'):
            runtime.validate_registry_sources(bad_source, baseline, base, before, bad_source['files'])

    def make_physical_fixture(self, root, linked):
        package = root / self.prefix
        (package / 'lib').mkdir(parents=True)
        (package / 'lib/index.js').write_text('import value from "fixture-native"; export {value}')
        (package / 'package.json').write_text(json.dumps({'name': 'fixture', 'dependencies': {'fixture-native': '1.0.0'}}))
        native = root / self.target
        native.mkdir(parents=True)
        (native / 'package.json').write_text(json.dumps({'name': 'fixture-native', 'version': '1.0.0',
                                                       'main': 'index.cjs', 'optionalDependencies': {'@fixture/native-linux': '1.0.0'}}))
        (native / 'index.cjs').write_text('throw Error("Dependency code must not execute during metadata audit")')
        addon_path = runtime.HARNESS + '/node_modules/.pnpm/@fixture+native-linux@1.0.0/node_modules/@fixture/native-linux'
        addon = root / addon_path
        addon.mkdir(parents=True)
        (addon / 'package.json').write_text(json.dumps({'name': '@fixture/native-linux', 'version': '1.0.0', 'main': 'addon.node'}))
        (addon / 'addon.node').write_bytes(b'not executable, only a hashed native fixture')
        optional = native.parent / '@fixture/native-linux'
        optional.parent.mkdir()
        optional.symlink_to(pathlib.Path(os.path.relpath(addon, optional.parent)))
        if linked:
            link = package / 'node_modules/fixture-native'
            link.parent.mkdir()
            link.symlink_to(pathlib.Path(os.path.relpath(native, link.parent)))
        rows = runtime.registry_additions(*self.inventories(), {})
        rows[0]['target'] = self.target
        return rows, addon

    def observe(self, root, rows, phase):
        code = runtime.REGISTRY_CODE + r'''let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{const d=JSON.parse(input);console.log(JSON.stringify(observeRegistry(d.root,d.rows,d.phase)));});'''
        return subprocess.run(['node', '-e', code], input=json.dumps({'root': str(root), 'rows': rows, 'phase': phase}), text=True, capture_output=True)

    def apply(self, root, proof, deleted=None):
        updater = root / 'updater.cjs'
        updater.write_text(runtime.UPDATE_JS)
        doc = {'links': [{'link': self.prefix + '/node_modules/fixture-native', 'target': self.target, 'registry': True, 'before': proof['requests'][0]['beforeLink']}],
               'checks': [{'from': self.prefix, 'dependencies': ['fixture-native']}], 'deleted': deleted or [], 'registryReuse': proof}
        code = 'let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>require(process.argv[1]).applyRuntimeUpdate(process.argv[2],JSON.parse(s)));'
        return subprocess.run(['node', '-e', code, str(updater), str(root)], input=json.dumps(doc), text=True, capture_output=True)

    def test_registry_link_without_a_physical_proof_cannot_be_smuggled_into_workspace_update(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            self.make_physical_fixture(root, linked=False)
            updater = root / 'updater.cjs'
            updater.write_text(runtime.UPDATE_JS)
            doc = {'links': [{'link': self.prefix + '/node_modules/fixture-native', 'target': self.target}], 'checks': [], 'deleted': []}
            code = 'let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>require(process.argv[1]).applyRuntimeUpdate(process.argv[2],JSON.parse(s)));'
            result = subprocess.run(['node', '-e', code, str(updater), str(root)], input=json.dumps(doc), text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('unverified registry artifact', result.stderr)

    def test_real_native_closure_safe_base_link_and_cold_verification_without_loading_dependencies(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            base, candidate = pathlib.Path(a), pathlib.Path(b)
            rows, _ = self.make_physical_fixture(base, linked=False)
            self.make_physical_fixture(candidate, linked=True)
            observed = self.observe(candidate, rows, 'after')
            self.assertEqual(observed.returncode, 0, observed.stderr)
            physical = json.loads(observed.stdout)['artifacts']
            before = self.observe(base, physical['requests'], 'before')
            self.assertEqual(before.returncode, 0, before.stderr)
            self.assertEqual(json.loads(before.stdout)['artifacts'], physical)
            self.assertTrue(any(name.endswith('.node') for name in physical['entries']))
            proof = self.proof(physical)
            accepted = self.apply(base, proof)
            self.assertEqual(accepted.returncode, 0, accepted.stderr)
            link = base / self.prefix / 'node_modules/fixture-native'
            self.assertEqual(link.resolve(), base / self.target)
            cold = subprocess.run(['node', '-e', runtime.REGISTRY_VERIFY_JS], input=json.dumps({'root': str(base), 'proof': proof, 'phase': 'after'}), text=True, capture_output=True)
            self.assertEqual(cold.returncode, 0, cold.stderr)
            retry_observed = self.observe(base, physical['requests'], 'before')
            self.assertEqual(retry_observed.returncode, 0, retry_observed.stderr)
            linked_proof = self.proof(physical, before=json.loads(retry_observed.stdout)['links'][0]['state'])
            retry = self.apply(base, linked_proof)
            self.assertEqual(retry.returncode, 0, retry.stderr)
            link.unlink()
            missing = subprocess.run(['node', '-e', runtime.REGISTRY_VERIFY_JS], input=json.dumps({'root': str(base), 'proof': proof, 'phase': 'after'}), text=True, capture_output=True)
            self.assertNotEqual(missing.returncode, 0)

    def test_changed_native_missing_entry_abi_and_external_artifact_rejected_before_deletion_or_link(self):
        for mutation in ['native', 'entry', 'abi', 'escape', 'version', 'missing-artifact', 'link-parent-escape']:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temporary:
                root = pathlib.Path(temporary)
                rows, addon = self.make_physical_fixture(root, linked=False)
                result = self.observe(root, rows, 'before')
                self.assertEqual(result.returncode, 0, result.stderr)
                proof = self.proof(json.loads(result.stdout)['artifacts'])
                if mutation == 'native':
                    (addon / 'addon.node').write_bytes(b'changed native bytes')
                elif mutation == 'entry':
                    (root / self.target / 'index.cjs').unlink()
                elif mutation == 'abi':
                    proof['artifacts']['abi']['modules'] = '999'
                    proof['artifactDigest'] = runtime.sha(runtime.canonical(proof['artifacts']))
                elif mutation == 'version':
                    manifest = root / self.target / 'package.json'
                    doc = json.loads(manifest.read_text())
                    doc['version'] = '2.0.0'
                    manifest.write_text(json.dumps(doc))
                elif mutation == 'missing-artifact':
                    shutil.rmtree(root / self.target)
                elif mutation == 'link-parent-escape':
                    (root / self.prefix / 'node_modules').symlink_to('/tmp')
                else:
                    (root / self.target / 'external-asset').symlink_to('/tmp')
                owned = root / self.prefix / 'lib/old.js'
                owned.write_text('owned old file')
                rejected = self.apply(root, proof, [{'path': str(owned.relative_to(root)), 'sha256': sha('owned old file')}])
                self.assertNotEqual(rejected.returncode, 0)
                self.assertEqual(owned.read_text(), 'owned old file')
                self.assertFalse((root / self.prefix / 'node_modules/fixture-native').is_symlink())

    def test_registry_manifest_digest_survives_normalization_and_must_match_export_frozen_identity(self):
        proof = self.proof()
        manifest = {'schemaVersion': 2, 'files': {'packages/a/src/index.ts': sha('source')},
                    'baseImage': proof['base']['image'], 'revision': proof['candidate']['revision'], 'sourceDigest': proof['candidate']['sourceDigest'],
                    'pluginTrust': {'publicKeySha256': proof['publicKeySha256']}, 'registryReuse': proof, 'registryReuseDigest': proof['proofDigest']}
        normalized = runtime.normalize_manifest(manifest)
        self.assertEqual(runtime.validate_manifest_registry(normalized, {'registryReuseDigest': proof['proofDigest']}), proof)
        for key in ['revision', 'sourceDigest', 'baseImage', 'registryReuseDigest']:
            bad = {**normalized, key: 'changed'}
            with self.subTest(key=key), self.assertRaises(ValueError):
                runtime.validate_manifest_registry(bad)
        with self.assertRaises(ValueError):
            runtime.validate_manifest_registry(normalized, {'registryReuseDigest': 'f' * 64})


class FullRuntimeProvenanceTests(unittest.TestCase):
    def full_fixture(self):
        files = {'Dockerfile': sha('reviewed dockerfile'), runtime.DEFAULT_TRUST['publicKeyPath']: sha('reviewed public key')}
        source = {'revision': 'a' * 40, 'files': files, 'sourceDigest': runtime.sha(runtime.canonical(files)), 'dependencyFingerprint': 'b' * 64}
        builder_image, node_image, image_id = ['sha256:' + c * 64 for c in 'cde']
        receipt = {**source, 'origin': 'docker-builder-target', 'fullBuildVerified': True, 'buildTarget': 'builder',
                   'builderImage': builder_image, 'baseImage': node_image,
                   **{key: True for key in ['completeDevelopmentDependencies', 'lockedDependenciesVerified', 'sourceProjectionVerified', 'nativeProbeVerified', 'sharedDeclarationBoundaryVerified']}}
        receipt.update({'abi': {'node': '24.7.0', 'modules': '137', 'platform': 'linux', 'arch': 'x64', 'libc': 'glibc'}, 'toolsVerified': ['typescript', 'tsdown', 'vite', 'vitest', 'tsx']})
        record = {**source, 'schemaVersion': 1, 'format': 'physicsos-full-build/1', 'successfulStages': ['builder', 'runtime'],
                  'sourceProjectionVerified': True, 'builderImage': builder_image, 'nodeImage': node_image,
                  'runtimeImage': image_id, 'dockerfileSha256': files['Dockerfile']}
        labels = {'physicsos.role': 'full-runtime-input', 'physicsos.full-build.revision': source['revision'],
                  'physicsos.full-build.source-digest': source['sourceDigest'],
                  'physicsos.full-build.dependency-fingerprint': source['dependencyFingerprint']}
        image = {'id': image_id, 'labels': labels}
        return source, dict(source), receipt, record, image

    def test_full_build_accepts_only_matching_source_dockerfile_receipt_and_immutable_images(self):
        source, marker, receipt, record, image = self.full_fixture()
        runtime.validate_full_record(source, marker, receipt, record, image)
        bad_values = [
            (source, marker, {**receipt, 'origin': 'runtime-seed'}, record, image),
            (source, marker, {**receipt, 'nativeProbeVerified': False}, record, image),
            (source, marker, receipt, {**record, 'dockerfileSha256': 'f' * 64}, image),
            (source, marker, receipt, {**record, 'successfulStages': ['runtime']}, image),
            (source, marker, receipt, record, {**image, 'labels': {}}),
            (source, marker, receipt, {**record, 'runtimeImage': 'sha256:' + 'f' * 64}, image),
            (source, {**marker, 'files': {}}, receipt, record, image),
        ]
        for values in bad_values:
            with self.subTest(values=values[2].get('origin')), self.assertRaises(ValueError):
                runtime.validate_full_record(*values)

    def test_full_runtime_inventory_must_match_builder_and_pin_plugin_key_to_source(self):
        source, _, _, record, _ = self.full_fixture()
        files = {name: {'sha256': sha(name), 'bytes': 1} for name in runtime.full_inventory_request()['required']}
        files[runtime.DEFAULT_TRUST['publicKeyPath']]['sha256'] = source['files'][runtime.DEFAULT_TRUST['publicKeyPath']]
        inventory = {'files': files}
        proof = {'verified': True, 'entries': 2, 'publicKeySha256': source['files'][runtime.DEFAULT_TRUST['publicKeyPath']]}
        manifest = runtime.full_manifest(source, record, inventory, inventory, proof)
        self.assertEqual(manifest['sourceDigest'], source['sourceDigest'])
        self.assertEqual(manifest['codeDigest'], runtime.sha(runtime.canonical(manifest['files'])))
        self.assertEqual(manifest['buildProvenance'], record)
        self.assertEqual(runtime.normalize_manifest(manifest)['files'], manifest['files'])
        changed = {'files': {**files, 'scripts/healthcheck.mjs': {'sha256': sha('altered'), 'bytes': 7}}}
        with self.assertRaisesRegex(ValueError, 'differs'):
            runtime.full_manifest(source, record, inventory, changed, proof)
        with self.assertRaisesRegex(ValueError, 'trust'):
            runtime.full_manifest(source, record, inventory, inventory, {**proof, 'publicKeySha256': 'f' * 64})
        incomplete = {'files': {key: value for key, value in files.items() if key != 'scripts/healthcheck.mjs'}}
        with self.assertRaisesRegex(ValueError, 'absent'):
            runtime.full_manifest(source, record, incomplete, incomplete, proof)

    def test_audited_seed_still_requires_full_compilation_and_immutable_runtime_stage_evidence(self):
        source, marker, receipt, record, image = self.full_fixture()
        receipt.update({'origin': 'audited-runtime-seed', 'audited': True, 'buildTarget': 'audited-seed-full-build',
                        'seedImage': record['builderImage'], 'offlineRootLockVerified': True, 'offlineHarnessLockVerified': True,
                        'offlineEvidence': [{'cwd': cwd, 'command': 'pnpm install --offline --frozen-lockfile --prod=false', 'exitCode': 0} for cwd in ['/app', '/app/vendor/deepseek-harness']],
                        'fullBuildEvidence': [{'command': 'pnpm run ' + script, 'exitCode': 0} for script in ['build:lib', 'build:web']]})
        record.update({'seedReceiptOrigin': 'audited-runtime-seed', 'builderSnapshot': 'sha256:' + 'f' * 64,
                       'runtimeStageSha256': '1' * 64, 'runtimeDockerfileSha256': '2' * 64})
        runtime.validate_full_record(source, marker, receipt, record, image)
        with self.assertRaisesRegex(ValueError, 'both complete build'):
            runtime.validate_full_record(source, marker, {**receipt, 'fullBuildEvidence': []}, record, image)
        with self.assertRaisesRegex(ValueError, 'offline'):
            runtime.validate_full_record(source, marker, {**receipt, 'offlineEvidence': []}, record, image)
        with self.assertRaisesRegex(ValueError, 'snapshot'):
            runtime.validate_full_record(source, marker, receipt, {**record, 'builderSnapshot': 'mutable:tag'}, image)

    def test_verified_overlay_requires_full_filesystem_and_reviewed_config_proof_instead_of_old_manifest(self):
        source, marker, receipt, record, image = self.full_fixture()
        receipt.update({'origin': 'audited-runtime-seed', 'audited': True, 'buildTarget': 'audited-seed-full-build',
                        'seedImage': record['builderImage'], 'offlineRootLockVerified': True, 'offlineHarnessLockVerified': True,
                        'offlineEvidence': [{'cwd': cwd, 'command': 'pnpm install --offline --frozen-lockfile', 'exitCode': 0} for cwd in ['/app', '/app/vendor/deepseek-harness']],
                        'fullBuildEvidence': [{'command': 'pnpm run ' + script, 'exitCode': 0} for script in ['build:lib', 'build:web']]})
        record.update({'runtimeTransport': 'verified-overlay', 'seedReceiptOrigin': 'audited-runtime-seed',
                       'transportBaseImage': receipt['seedImage'], 'runtimeConfigImage': 'sha256:' + 'f' * 64,
                       'runtimeStageSha256': '1' * 64, 'runtimeDockerfileSha256': '2' * 64,
                       'configOnlyDockerfileSha256': '3' * 64, 'filesystemDigest': '4' * 64, 'runtimeConfigDigest': '5' * 64, 'systemFSdigest': '6' * 64})
        runtime.validate_full_record(source, marker, receipt, record, image)
        with self.assertRaisesRegex(ValueError, 'filesystem/config'):
            runtime.validate_full_record(source, marker, receipt, {**record, 'filesystemDigest': ''}, image)
        with self.assertRaisesRegex(ValueError, 'filesystem/config'):
            runtime.validate_full_record(source, marker, receipt, {**record, 'systemFSdigest': ''}, image)
        with self.assertRaisesRegex(ValueError, 'filesystem/config'):
            runtime.validate_full_record(source, marker, receipt, {**record, 'transportBaseImage': 'sha256:' + '9' * 64}, image)

    def test_incremental_base_without_a_manifest_stays_rejected(self):
        for value in [{}, {'files': {}}, {'schemaVersion': 2}]:
            with self.assertRaises(ValueError):
                runtime.normalize_manifest(value)


if __name__ == '__main__':
    unittest.main()
