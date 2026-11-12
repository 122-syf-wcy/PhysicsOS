import hashlib
import importlib.util
import json
import pathlib
import shutil
import subprocess
import tempfile
import unittest

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


if __name__ == '__main__':
    unittest.main()
