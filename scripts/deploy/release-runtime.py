#!/usr/bin/env python3
"""Export verified runtime deltas, build offline candidates, and cold-check files.

Operations use an explicitly owned development builder and immutable local image.
No operation reads environment values, secrets, production data or switches apps.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import posixpath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time

HARNESS = 'vendor/deepseek-harness'
HEX64 = re.compile(r'^[a-f0-9]{64}$')
HEX40 = re.compile(r'^[a-f0-9]{40}$')
IMAGE_ID = re.compile(r'^sha256:[a-f0-9]{64}$')
EXCLUDED = {'.agents', '.claude', '.cursor', 'node_modules', '.git', 'tests', 'test', '__tests__', 'fixtures', '__fixtures__', '__snapshots__', '.home', '.ssh', 'secrets', '.turbo', '.vite', '__pycache__', 'preview'}
ROOT_CODE = {'overlays/harness/files/packages/physicsos/health-host/deployment.patch.yml', 'package.json', 'classroom-runtime-links.cjs', 'classroom-runtime-links.json', 'physicsos-runtime-update.cjs', 'physicsos-runtime-update.json'}
METADATA = {'physicsos-runtime-manifest.json', 'canvas-source-manifest.json'}
LEGACY_ROOTS = {
    **{name: f'{HARNESS}/packages/physicsos/{name}' for name in ['auth-host', 'experiment-host', 'learning-host', 'model-pool-host', 'paper-host', 'plugin-center', 'tool-physicsos']},
    **{name: f'{HARNESS}/packages/client/{name}' for name in ['file-upload', 'ui-conversation', 'ui-physicsos', 'ui-sidebar']},
    'atomic-write': f'{HARNESS}/packages/util/atomic-write',
    'physicsos-packages': 'packages', 'web-dist': f'{HARNESS}/apps/web/dist',
    'web-app': f'{HARNESS}/packages/bundle/web-app',
    'student-agent-preset': f'{HARNESS}/apps/cli',
}
LEGACY_EXACT = {
    'runtime-links.cjs': 'classroom-runtime-links.cjs',
    'runtime-links.json': 'classroom-runtime-links.json',
    'student-preset/agent.cordis.yml': f'{HARNESS}/apps/cli/config/agent-presets/physics-student/agent.cordis.yml',
    'student-preset/bundle.patch.yml': f'{HARNESS}/packages/bundle/web-app/presets/physics-student.patch.yml',
}
DEFAULT_TRUST = {'entryRoot': HARNESS, 'manifestPath': f'{HARNESS}/packages/physicsos/plugin-center/plugins/manifest.json', 'publicKeyPath': f'{HARNESS}/packages/physicsos/plugin-center/plugins/physicsos-plugin-signing.pub'}
TEACHING_TOOLS_MARKER = 'packages/teaching-tools-capabilities.json'
TEACHING_TOOLS_LABEL = 'physicsos.teaching-tools.bridge'


def sha(data):
    return hashlib.sha256(data.encode() if isinstance(data, str) else data).hexdigest()


def canonical(value, legacy=False):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=legacy)


def safe_relative(value):
    if not isinstance(value, str) or not value or any(c in value for c in ['\\', '\0', '\n', '\r']):
        raise ValueError('Unsafe runtime path')
    path = pathlib.PurePosixPath(value)
    if path.is_absolute() or '..' in path.parts or '.' in path.parts or str(path) != value:
        raise ValueError('Unsafe runtime path')
    return value


REPOSITORY_DOC_LINKS = {HARNESS + '/' + name for name in ['CLAUDE.md', 'packages/CLAUDE.md', 'vendor/CLAUDE.md']}


def excluded(value):
    parts = pathlib.PurePosixPath(value).parts
    return value in REPOSITORY_DOC_LINKS or value.startswith(HARNESS + '/snapshots/') or bool(set(parts) & EXCLUDED) or any(p == '.env' or p.startswith('.env.') for p in parts) or value.endswith(('.pem', '.key', '.p12', '.pfx', '.log', '.pid', '.tsbuildinfo', '.map', '.spec.ts', '.test.ts', '.spec.tsx', '.test.tsx'))


def safe_owned_path(value):
    safe_relative(value)
    parts = pathlib.PurePosixPath(value).parts
    private = bool(set(parts) & {'node_modules', '.git', '.home', '.ssh', 'secrets', '__pycache__'}) or any(p == '.env' or p.startswith('.env.') for p in parts) or value.endswith(('.pem', '.key', '.p12', '.pfx', '.log', '.pid', '.tsbuildinfo'))
    if private or not (value.startswith(('packages/', 'scripts/', HARNESS + '/')) or value in ROOT_CODE):
        raise ValueError('Unsafe private/dependency runtime code path')
    return value


def safe_code_path(value):
    safe_owned_path(value)
    if excluded(value):
        raise ValueError('New runtime export includes a test/debug/generated path')
    return value


def normalize_manifest(value):
    if value.get('schemaVersion') not in (1, 2) or not isinstance(value.get('files'), dict):
        raise ValueError('No supported base runtime ownership manifest')
    source = value['files']
    if value.get('codeDigest') and value['codeDigest'] != sha(canonical(source, legacy=value['schemaVersion'] == 1)):
        raise ValueError('Base runtime manifest checksum differs')
    files = {}
    for name, checksum in source.items():
        safe_relative(name)
        if not isinstance(checksum, str) or not HEX64.fullmatch(checksum):
            raise ValueError('Invalid runtime file digest')
        if value['schemaVersion'] == 1:
            if name in LEGACY_EXACT:
                target = LEGACY_EXACT[name]
            else:
                prefix, separator, rest = name.partition('/')
                if not separator or prefix not in LEGACY_ROOTS:
                    raise ValueError('Unknown legacy runtime ownership prefix')
                target = LEGACY_ROOTS[prefix] + '/' + rest
        else:
            target = name
        # Old release manifests retained a few public tests/sourcemaps. Keep
        # their ownership/checksums without admitting them into new payloads.
        safe_owned_path(target)
        if target in files and files[target] != checksum:
            raise ValueError('Conflicting legacy ownership aliases')
        files[target] = checksum
    return {'schemaVersion': 2, 'ownership': 'physicsos-runtime/2', 'files': dict(sorted(files.items())), 'codeDigest': sha(canonical(files)), 'revision': value.get('revision', value.get('mainRevision')), 'sourceDigest': value.get('sourceDigest'), 'pluginTrust': value.get('pluginTrust', DEFAULT_TRUST), 'legacyFileCount': len(source), 'originSchema': value['schemaVersion'], **{key: value[key] for key in ['filesystem', 'filesystemDigest', 'runtimeConfigDigest', 'systemFilesystem', 'systemFSdigest', 'registryReuse', 'registryReuseDigest', 'baseImage', 'teachingToolsBridge'] if key in value}}


def compute_delta(base, candidate, owned):
    for path, checksum in base.items():
        safe_owned_path(path)
        if not HEX64.fullmatch(checksum):
            raise ValueError('Invalid runtime file digest')
    for path, checksum in candidate.items():
        safe_code_path(path)
        if not HEX64.fullmatch(checksum):
            raise ValueError('Invalid runtime file digest')
    if not set(owned) <= set(base):
        raise ValueError('Deletion ownership is absent from the base manifest')
    changed = sorted(path for path, checksum in candidate.items() if base.get(path) != checksum)
    deleted = sorted(set(owned) - set(candidate))
    files = {path: checksum for path, checksum in base.items() if path not in deleted}
    files.update(candidate)
    return {'changed': changed, 'deleted': deleted, 'files': dict(sorted(files.items())), 'codeDigest': sha(canonical(files))}


def noop_report(base, requested, delta):
    if delta['changed'] or delta['deleted']:
        return None
    return {'noop': True, 'image': requested['baseImage'], 'baseImage': requested['baseImage'], 'revision': base['revision'], 'runtimeSourceRevision': base['revision'], 'sourceDigest': base.get('sourceDigest'), 'codeDigest': base['codeDigest'], 'requestedRevision': requested['revision'], 'requestedSourceDigest': requested['sourceDigest'], 'changedFiles': [], 'deletedFiles': [], 'bytesExported': 0}


def validate_freeze(source, plan, evidence, marker):
    revision, checksum = source.get('revision'), source.get('sourceDigest')
    if not isinstance(revision, str) or not HEX40.fullmatch(revision) or not isinstance(checksum, str) or not HEX64.fullmatch(checksum) or sha(canonical(source.get('files', {}))) != checksum:
        raise ValueError('Invalid frozen authoritative source digest')
    for value in [plan, evidence, marker]:
        if value.get('revision') != revision or value.get('sourceDigest') != checksum:
            raise ValueError('Build evidence or source marker differs from the source freeze')
    if marker.get('files') != source.get('files'):
        raise ValueError('Full builder source marker differs')
    if plan.get('fullBuild') or any(n.startswith(HARNESS + '/native/') or n == 'package.json' or n.endswith('/package.json') for n in plan.get('deleted', [])) or any(n.startswith(HARNESS + '/native/') for n in plan.get('changed', [])):
        raise ValueError('Shared build configuration, native code or removed packages require a full runtime build')
    compiled = {(p.get('name'), p.get('path'), p.get('mode')) for p in evidence.get('packageScopes', []) if p.get('mode') != 'files'}
    required = {(p.get('name'), p.get('path'), p.get('mode')) for p in plan.get('packageScopes', []) if p.get('mode') != 'files'}
    if not required <= compiled or any(row.get('exitCode') != 0 for row in evidence.get('evidence', [])) or (required and not evidence.get('evidence')):
        raise ValueError('Required package compilation evidence is missing or failed')
    if plan.get('vite') and not evidence.get('vite'):
        raise ValueError('Fresh static frontend build evidence is missing')
    if plan.get('sharedTypes') and not evidence.get('sharedTypes'):
        raise ValueError('Shared declaration build evidence is missing')
    for row in plan.get('packageScopes', []):
        path = safe_relative(row.get('path'))
        if row.get('sourcePath', HARNESS + '/' + path) != HARNESS + '/' + path or row.get('mode') not in ('host', 'client', 'files'):
            raise ValueError('Invalid package build scope')


def bare_name(request):
    if not isinstance(request, str) or not re.fullmatch(r'(?:@[a-zA-Z0-9_.-]+/)?[a-zA-Z0-9_.-]+(?:/[a-zA-Z0-9_./-]+)?', request):
        raise ValueError('Not a supported bare Node runtime request')
    safe_relative(request)
    return '/'.join(request.split('/')[:2]) if request.startswith('@') else request.split('/')[0]


def registry_additions(candidate, base, workspace_paths):
    """Only ADD requests/declarations; never weaken existing spec/version guards."""
    additions = []
    for path, package in candidate.items():
        safe_code_path((path + '/' if path else '') + 'package.json')
        before = base.get(path, {})
        if package.get('unsafeNodeRequests') or before.get('unsafeNodeRequests'):
            raise ValueError('External/root-escaping Node path requires a full runtime build')
        if any(bare_name(name) in workspace_paths for name in before.get('resolvedBare', {})):
            raise ValueError('An existing registry dependency cannot be reclassified as a workspace')
        if 'nodeRequests' not in package or 'nodeRequests' not in before:
            raise ValueError('Actual base/candidate Node inventory required for registry reuse')
        deps = {**package.get('dependencies', {}), **package.get('peerDependencies', {})}
        old = {**before.get('dependencies', {}), **before.get('peerDependencies', {})}
        names, old_names = set(package['nodeRequests']), set(before['nodeRequests'])
        if any(bare_name(n) not in workspace_paths for n in set(package.get('clientRequests', [])) - set(before.get('clientRequests', []))):
            raise ValueError('New client module-table external is unverified; a full runtime build is required')
        for field in ('dependencies', 'peerDependencies', 'optionalDependencies'):
            previous, current = before.get(field, {}), package.get(field, {})
            if any(name not in workspace_paths and current.get(name) != spec for name, spec in previous.items()):
                raise ValueError('Existing external bare spec changed; a full runtime build is required')
            if field == 'optionalDependencies' and previous != current:
                raise ValueError('Optional runtime declaration changes require a full runtime build')
            if any(name not in workspace_paths and name not in previous and name not in {bare_name(n) for n in names - old_names} for name in current):
                raise ValueError('New registry declaration has no audited Node request; a full runtime build is required')
        for request in old_names:
            name = bare_name(request)
            if name in workspace_paths:
                continue
            if request not in names or deps.get(name) != old.get(name) or package.get('resolvedBare', {}).get(request) != before.get('resolvedBare', {}).get(request) or not package.get('resolvedBare', {}).get(request):
                raise ValueError('Existing resolved external dependency changed; a full runtime build is required')
        for request in sorted(names - old_names):
            name = bare_name(request)
            if name in workspace_paths:
                continue
            if not isinstance(deps.get(name), str) or re.match(r'^(?:workspace:|link:|file:|https?:|git[+:])', deps[name]):
                raise ValueError('New Node runtime dependency is undeclared or not registry-backed')
            if package.get('mode') not in ('host', 'client'):
                raise ValueError('New registry request is not compiled Node runtime code')
            origins = package.get('nodeRequestOrigins', {}).get(request)
            if not origins or any(not origin.startswith(path + '/lib/') for origin in origins):
                raise ValueError('Actual Node request origin is missing or outside its compiled package')
            resolved = package.get('resolvedBare', {}).get(request)
            if not isinstance(resolved, dict) or resolved.get('name') != name or not isinstance(resolved.get('version'), str):
                raise ValueError('New Node runtime entry/version is unresolved; a full runtime build is required')
            additions.append({'from': path, 'request': request, 'name': name, 'specifier': deps[name], 'resolved': resolved})
    return additions


def workspace_updates(candidate, base, workspace_paths, registry_reuse=None):
    links, checks = {}, []
    approved = {}
    if registry_reuse is not None:
        validate_registry_reuse_proof(registry_reuse)
        additions = registry_additions(candidate, base, workspace_paths)
        rows = registry_reuse.get('requests', [])
        if [{key: row.get(key) for key in ['from', 'request', 'name', 'specifier', 'resolved']} for row in rows] != additions:
            raise ValueError('Audited registry reuse does not match actual Node additions')
        for row in rows:
            safe_registry_path(row['target'])
            approved[(row['from'], row['request'])] = row
    for path, package in candidate.items():
        safe_code_path((path + '/' if path else '') + 'package.json')
        before = base.get(path, {})
        deps = {**package.get('dependencies', {}), **package.get('peerDependencies', {})}
        old = {**before.get('dependencies', {}), **before.get('peerDependencies', {})}
        actual = 'nodeRequests' in package
        names = package.get('nodeRequests', list(deps))
        old_names = before.get('nodeRequests', list(old))
        bare = {name: deps.get(bare_name(name)) for name in names if bare_name(name) not in workspace_paths}
        old_bare = {name: old.get(bare_name(name)) for name in old_names if bare_name(name) not in workspace_paths}
        retained = {name: spec for name, spec in bare.items() if (path, name) not in approved}
        if retained != old_bare or any(name not in workspace_paths and deps.get(name) != spec for name, spec in old.items()):
            raise ValueError('External registry dependency changed; a full runtime build is required')
        if 'resolvedBare' in package and 'resolvedBare' in before and {name: meta for name, meta in package['resolvedBare'].items() if (path, name) not in approved} != before['resolvedBare']:
            raise ValueError('Resolved external dependency version changed; a full runtime build is required')
        for request in names:
            name = bare_name(request)
            if (path, request) in approved:
                row = approved[(path, request)]
                link = (path + '/' if path else '') + 'node_modules/' + name
                safe_relative(link)
                entry = {'link': link, 'target': row['target'], 'registry': True, 'before': row['beforeLink']}
                if link in links and links[link] != entry:
                    raise ValueError('Conflicting audited registry link targets')
                links[link] = entry
            elif name in workspace_paths and (old.get(name) != deps.get(name) or request not in old_names):
                target = safe_code_path(workspace_paths[name] + '/package.json').removesuffix('/package.json')
                link = (path + '/' if path else '') + 'node_modules/' + name
                safe_relative(link)
                links[link] = {'link': link, 'target': target, 'force': True}
        if not before and package.get('name', '').startswith('@physicsos/'):
            link = 'node_modules/' + package['name']
            safe_relative(link)
            links[link] = {'link': link, 'target': path, 'force': True}
        if actual and any(bare_name(name) not in workspace_paths for name in set(package.get('clientRequests', [])) - set(before.get('clientRequests', []))):
            raise ValueError('New client module-table external is unverified; a full runtime build is required')
        checks.append({'from': path, 'dependencies': sorted(names)})
    return {'links': list(links.values()), 'checks': checks}


def safe_registry_path(value):
    safe_relative(value)
    prefixes = ('node_modules/.pnpm/', HARNESS + '/node_modules/.pnpm/')
    prefix = next((item for item in prefixes if value.startswith(item)), None)
    if not prefix:
        raise ValueError('Registry artifact is outside the closed pnpm store')
    parts = pathlib.PurePosixPath(value[len(prefix):]).parts
    if len(parts) < 3 or parts[1] != 'node_modules' or parts[0] == 'node_modules' or any(part in {'.git', '.home', '.ssh', 'secrets', '__pycache__'} or part == '.env' or part.startswith('.env.') for part in parts) or value.endswith(('.pem', '.key', '.p12', '.pfx', '.log', '.pid')):
        raise ValueError('Unsafe registry artifact/private path')
    return value


def validate_registry_artifacts(value):
    if not isinstance(value, dict) or not value.get('entries') or not isinstance(value.get('requests'), list) or not value['requests']:
        raise ValueError('Complete physical registry artifact proof is missing')
    if not isinstance(value.get('packages'), dict):
        raise ValueError('Registry transitive package inventory is missing')
    abi = value.get('abi') or {}
    if abi.get('platform') != 'linux' or not all(abi.get(key) for key in ['node', 'modules', 'arch', 'libc']) or abi['libc'] not in ('glibc', 'musl') or not HEX64.fullmatch(abi.get('nodeSha256', '')) or not isinstance(abi.get('sharedLibraries'), list):
        raise ValueError('Registry runtime ABI proof is missing')
    for library in abi['sharedLibraries']:
        if not all(isinstance(library.get(key), str) and library[key].startswith(('/lib/', '/lib64/', '/usr/lib/')) for key in ['path', 'realpath']) or not HEX64.fullmatch(library.get('sha256', '')):
            raise ValueError('Registry runtime system library ABI hash is missing')
    entries = value['entries']
    for name, item in entries.items():
        safe_registry_path(name)
        if item.get('type') not in ('file', 'dir', 'symlink') or not isinstance(item.get('mode'), int) or not 0 <= item['mode'] <= 0o777:
            raise ValueError('Unsupported registry artifact type/mode')
        if item['type'] == 'file' and (not HEX64.fullmatch(item.get('sha256', '')) or not isinstance(item.get('bytes'), int) or item['bytes'] < 0):
            raise ValueError('Registry artifact content digest is missing')
        if item['type'] == 'symlink':
            target = item.get('target')
            if not isinstance(target, str) or not target or any(char in target for char in ['\\', '\0', '\n', '\r']) or pathlib.PurePosixPath(target).is_absolute():
                raise ValueError('Registry symlink escapes the application root')
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
            safe_registry_path(resolved)
            safe_registry_path(item.get('realpath'))
            if item['realpath'] not in entries:
                raise ValueError('Registry symlink target is not inventoried')
    for name, package in value['packages'].items():
        safe_registry_path(name)
        if entries.get(name, {}).get('type') != 'dir' or entries.get(name + '/package.json', {}).get('type') != 'file' or not isinstance(package.get('version'), str):
            raise ValueError('Transitive registry package manifest is absent')
        for dependency in package.get('dependencies', {}).values():
            if dependency is not None:
                safe_registry_path(dependency.get('target'))
                if entries.get(dependency['target'], {}).get('type') != 'dir':
                    raise ValueError('Transitive registry dependency target is not inventoried')
    for row in value['requests']:
        safe_code_path((row.get('from') + '/' if row.get('from') else '') + 'package.json')
        if bare_name(row.get('request')) != row.get('name'):
            raise ValueError('Registry request name differs')
        target = safe_registry_path(row.get('target'))
        if entries.get(target, {}).get('type') != 'dir' or entries.get(target + '/package.json', {}).get('type') != 'file':
            raise ValueError('Registry package manifest/root is absent')
        if not row.get('entries'):
            raise ValueError('Resolved registry entry proof is absent')
        for entry in row['entries'].values():
            safe_registry_path(entry.get('path'))
            if not entry['path'].startswith(target + '/') or entries.get(entry['path'], {}).get('type') != 'file' or entries[entry['path']]['sha256'] != entry.get('sha256'):
                raise ValueError('Resolved registry entry digest differs')
    return value


def reuse_source_files(source):
    files = source.get('files')
    if not isinstance(files, dict) or not HEX40.fullmatch(source.get('revision', '')) or not HEX64.fullmatch(source.get('sourceDigest', '')) or sha(canonical(files)) != source['sourceDigest']:
        raise ValueError('Invalid registry reuse source attestation')
    for name, checksum in files.items():
        safe_relative(name)
        if not isinstance(checksum, str) or not HEX64.fullmatch(checksum):
            raise ValueError('Invalid registry reuse source file checksum')
    return files


def validate_manifest_registry(manifest, record=None):
    proof, digest = manifest.get('registryReuse'), manifest.get('registryReuseDigest')
    if proof is None and digest is None:
        if record and record.get('registryReuseDigest'):
            raise ValueError('Exported registry proof is absent from the runtime manifest')
        return None
    validate_registry_reuse_proof(proof)
    if digest != proof['proofDigest'] or any(manifest.get(key) != proof['candidate'].get(key) for key in ['revision', 'sourceDigest']) or manifest.get('baseImage') != proof['base']['image'] or proof['publicKeySha256'] != manifest['pluginTrust'].get('publicKeySha256'):
        raise ValueError('Runtime registry proof is not bound to its base/frozen source/trust root')
    if record and record.get('registryReuseDigest') != digest:
        raise ValueError('Runtime/export registry audit digest differs')
    return proof


def validate_registry_sources(source, baseline, base, before_policies, candidate_policies):
    files, old_files = reuse_source_files(source), reuse_source_files(baseline)
    if baseline['revision'] != base.get('revision') or baseline['sourceDigest'] != base.get('sourceDigest'):
        raise ValueError('Baseline source attestation does not belong to the exact base image')
    paths = sorted({name for name in set(files) | set(old_files) if registry_policy_path(name)})
    for name in paths:
        if name != HARNESS + '/pnpm-lock.yaml' and files.get(name) != old_files.get(name):
            raise ValueError('Registry reuse supply-chain policy/root lock changed; a full runtime build is required')
        if candidate_policies.get(name) != files.get(name):
            raise ValueError('Candidate lock/policy differs from its frozen source')
        actual = before_policies.get(name)
        if actual is not None and (actual != old_files.get(name) or (name in base['files'] and actual != base['files'][name])):
            raise ValueError('Base lock/policy differs from its source/ownership manifest')
        if (name.startswith(HARNESS + '/') or name == 'package.json') and name in old_files and actual is None:
            raise ValueError('Baseline harness lock/policy artifact is absent')
        if name in base['files'] and actual is None:
            raise ValueError('Owned base lock/policy artifact is absent')
    for doc in [source, baseline]:
        if not HEX64.fullmatch(doc['files'].get(HARNESS + '/pnpm-lock.yaml', '')):
            raise ValueError('Frozen harness lock checksum is required')
    return paths


def baseline_registry_reachable(lock):
    """Exact locked nodes reachable from existing importers, not arbitrary installed/orphan store entries."""
    graph = lock.get('graph', {})
    snapshots, packages = graph.get('snapshots', {}), graph.get('packages', {})
    if not isinstance(snapshots, dict) or not isinstance(packages, dict):
        raise ValueError('Baseline registry graph is absent')
    pending = []
    for importer in lock.get('importers', {}).values():
        for kind in ['dependencies', 'devDependencies', 'optionalDependencies']:
            for name, ref in importer.get(kind, {}).items():
                version = ref.get('version') if isinstance(ref, dict) else None
                if isinstance(version, str) and name + '@' + version in snapshots:
                    pending.append(name + '@' + version)
    seen = set()
    while pending:
        key = pending.pop()
        if key in seen:
            continue
        if len(seen) >= 200_000:
            raise ValueError('Baseline registry graph exceeds the traversal budget')
        seen.add(key)
        node = snapshots.get(key)
        if not isinstance(node, dict):
            raise ValueError('Baseline locked snapshot is invalid')
        for kind in ['dependencies', 'optionalDependencies']:
            for name, version in node.get(kind, {}).items():
                if isinstance(version, str) and name + '@' + version in snapshots:
                    pending.append(name + '@' + version)
    return seen


def validate_registry_lock(candidate, before, additions, workspace_paths):
    if not isinstance(candidate.get('graph'), dict) or candidate['graph'] != before.get('graph') or not candidate['graph'].get('packages') or not candidate['graph'].get('snapshots'):
        raise ValueError('External registry lock graph/resolution/integrity/policy changed; a full runtime build is required')
    new, old = candidate.get('importers', {}), before.get('importers', {})
    reachable = baseline_registry_reachable(before)
    expected = {(row['from'].removeprefix(HARNESS + '/'), row['name']): row for row in additions}
    for importer in sorted(set(new) | set(old)):
        a, b = old.get(importer, {}), new.get(importer, {})
        for field in set(a) | set(b):
            left, right = a.get(field, {}), b.get(field, {})
            if left == right:
                continue
            if field not in ('dependencies', 'devDependencies', 'optionalDependencies') or not isinstance(left, dict) or not isinstance(right, dict):
                raise ValueError('Unreviewed lock importer configuration changed')
            for name in set(left) | set(right):
                previous, current = left.get(name), right.get(name)
                if previous == current:
                    continue
                if name in workspace_paths:
                    owner = HARNESS + '/' + importer if importer != '.' else HARNESS
                    target = workspace_paths[name]
                    if not isinstance(current, dict) or not current.get('version', '').startswith('link:') or posixpath.normpath(posixpath.join(owner, current['version'][5:])) != target:
                        raise ValueError('Workspace lock link does not match the actual workspace')
                    continue
                row = expected.get((importer, name))
                if previous is not None or not row or not isinstance(current, dict) or current.get('specifier') != row['specifier']:
                    raise ValueError('Existing/new external lock importer changed without an audited Node addition')
                version = current.get('version', '')
                if not isinstance(version, str) or version.split('(', 1)[0] != row['resolved']['version'] or name + '@' + version not in candidate['graph']['snapshots'] or name + '@' + version.split('(', 1)[0] not in candidate['graph']['packages']:
                    raise ValueError('New importer resolved version/snapshot differs from the installed artifact')
                package = before['graph']['packages'][name + '@' + version.split('(', 1)[0]]
                resolution = package.get('resolution') if isinstance(package, dict) else None
                if name + '@' + version not in reachable or not isinstance(resolution, dict) or not isinstance(resolution.get('integrity'), str) or not resolution['integrity']:
                    raise ValueError('New bare dependency has no reachable baseline integrity-locked reference')
                # A transitive -> direct link is admissible only within the SAME lock graph.
                # collect_registry_reuse also compares full physical closures/ABI/entry bytes
                # in the exact base and candidate. Store existence alone never grants reuse.
    for (importer, name), row in expected.items():
        ref = next((new.get(importer, {}).get(field, {}).get(name) for field in ['dependencies', 'optionalDependencies'] if name in new.get(importer, {}).get(field, {})), None)
        if not isinstance(ref, dict) or ref.get('specifier') != row['specifier'] or ref.get('version', '').split('(', 1)[0] != row['resolved']['version']:
            raise ValueError('Audited Node request is not declared in the actual locked importer')


def verify_context(context, record):
    context = pathlib.Path(context)
    actual = {}
    for path in context.rglob('*'):
        if path.is_symlink():
            raise ValueError('Runtime context contains a symlink')
        if path.is_file():
            relative = str(path.relative_to(context))
            safe_relative(relative)
            actual[relative] = sha(path.read_bytes())
    if actual != record.get('contextHashes'):
        raise ValueError('Runtime context hash or owned file set differs')
    return len(actual)


def teaching_tools_bridge_label(files):
    checksum = files.get(TEACHING_TOOLS_MARKER)
    if checksum is None:
        return ''
    if not isinstance(checksum, str) or not HEX64.fullmatch(checksum):
        raise ValueError('Teaching tools capability marker is not covered by the runtime manifest')
    return 'teaching-tools-bridge-v1'


def validate_image_labels(metadata, record):
    labels = metadata.get('labels') or {}
    expected = {'org.opencontainers.image.revision': record['revision'], 'physicsos.source.digest': record['sourceDigest'], 'physicsos.code.digest': record['codeDigest']}
    if 'teachingToolsBridge' in record:
        expected[TEACHING_TOOLS_LABEL] = record['teachingToolsBridge']
    if record.get('filesystemDigest'):
        expected.update({'physicsos.filesystem.digest': record['filesystemDigest'], 'physicsos.runtime-config.digest': record['runtimeConfigDigest']})
        if record.get('systemFSdigest'): expected['physicsos.system-fs.digest'] = record['systemFSdigest']
    if not IMAGE_ID.fullmatch(metadata.get('id', '')) or any(labels.get(name) != value for name, value in expected.items()):
        raise ValueError('Candidate image identity or source/code labels differ')
    return metadata['id']


def validate_signature_proofs(base, candidate):
    if not base.get('verified') or not candidate.get('verified') or base.get('publicKeySha256') != candidate.get('publicKeySha256') or candidate.get('entries', 0) < 1:
        raise ValueError('Signed plugin inventory or existing trust root differs')


SIGNATURE_JS = r'''
const f=require('fs'),p=require('path'),c=require('crypto');let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{
const doc=JSON.parse(s),root=p.resolve(doc.root),inside=n=>{if(typeof n!=='string'||p.isAbsolute(n)||n.split('/').includes('..')||/[\\\0\r\n]/.test(n))throw Error('Unsafe plugin path');const v=f.realpathSync(p.resolve(root,n));if(!v.startsWith(root+'/'))throw Error('Plugin path escapes root');return v;};
const manifest=JSON.parse(f.readFileSync(inside(doc.manifestPath),'utf8')),pub=f.readFileSync(inside(doc.publicKeyPath)),key=c.createPublicKey(pub);
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}':JSON.stringify(v);
if(manifest.schemaVersion!==1||!Array.isArray(manifest.entries)||!manifest.entries.length)throw Error('Bad signed plugin inventory');
for(const e of manifest.entries){if(c.createHash('sha256').update(f.readFileSync(inside((doc.entryRoot?doc.entryRoot+'/':'')+e.entry))).digest('hex')!==e.sha256)throw Error('Stale signed plugin entry');const value={id:e.id,name:e.name,version:e.version,harnessRange:e.harnessRange,capabilities:[...e.capabilities],entry:e.entry,publisher:e.publisher,sha256:e.sha256,...e.description===undefined?{}:{description:e.description}};if(!String(e.signature).startsWith('ed25519:')||!c.verify(null,Buffer.from(canonical(value)),key,Buffer.from(e.signature.slice(8),'base64')))throw Error('Plugin signature mismatch');}
console.log(JSON.stringify({verified:true,entries:manifest.entries.length,publicKeySha256:c.createHash('sha256').update(pub).digest('hex')}));});
'''

INVENTORY_JS = r'''
const f=require('fs'),p=require('path'),c=require('crypto'),{createRequire,builtinModules}=require('module');let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{
const doc=JSON.parse(s),root=doc.root||'/app',files={},packages={},workspace={};
const safe=n=>{if(!n||p.isAbsolute(n)||n.split('/').includes('..')||/[\\\0\r\n]/.test(n))throw Error('Unsafe inventory path');return n;};
const repositoryDocs=new Set(['CLAUDE.md','packages/CLAUDE.md','vendor/CLAUDE.md'].map(n=>'vendor/deepseek-harness/'+n));
const skip=n=>repositoryDocs.has(n)||n.startsWith('vendor/deepseek-harness/snapshots/')||n.split('/').some(x=>['.agents','.claude','.cursor','node_modules','.git','tests','test','__tests__','fixtures','__fixtures__','__snapshots__','.home','.ssh','secrets','.turbo','.vite','__pycache__','preview'].includes(x)||x==='.env'||x.startsWith('.env.'))||/\.(?:pem|key|p12|pfx|log|pid|tsbuildinfo|map|spec\.ts|test\.ts|spec\.tsx|test\.tsx)$/.test(n);
const visit=n=>{safe(n);if(skip(n))return;const abs=p.resolve(root,n);if(!abs.startsWith(root+'/'))throw Error('Inventory escaped root');let st;try{st=f.lstatSync(abs)}catch(error){if(error.code==='ENOENT')return;throw error}if(st.isSymbolicLink())throw Error('Runtime export contains source link');if(st.isDirectory()){for(const name of f.readdirSync(abs))visit(n+'/'+name);}else if(st.isFile()){const bytes=f.readFileSync(abs);files[n]={sha256:c.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,mode:st.mode&511};}else throw Error('Non-file runtime code');};
const pkg=n=>{const file=p.join(root,n,'package.json');if(!f.existsSync(file))return;const m=JSON.parse(f.readFileSync(file));if(m.name)workspace[m.name]=n;return {name:m.name,version:m.version,dependencies:m.dependencies||{},peerDependencies:m.peerDependencies||{},optionalDependencies:m.optionalDependencies||{}};};
for(const row of doc.selections||[]){safe(row.root);for(const item of row.items||[])visit(item==='.'?row.root:row.root+'/'+safe(item));const m=pkg(row.root);if(m){m.mode=row.mode||'host';packages[row.root]=m;}}
for(const name of doc.exact||[])visit(safe(name));
if((doc.exact||[]).includes('package.json'))packages['']=pkg('');
for(const name of doc.required||[]){const abs=p.resolve(root,safe(name));if(!f.existsSync(abs)||!f.statSync(abs).size)throw Error('Required runtime artifact absent');}
const children=n=>f.existsSync(p.join(root,n))?f.readdirSync(p.join(root,n),{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>n+'/'+x.name):[];
for(const n of children('packages'))pkg(n);for(const group of children('vendor/deepseek-harness/packages'))for(const n of children(group))pkg(n);for(const n of children('vendor/deepseek-harness/vendor'))pkg(n);for(const n of children('vendor/deepseek-harness/apps'))pkg(n);for(const n of children('vendor/deepseek-harness/native/system/packages'))pkg(n);
let parser;
const requests=(code,file)=>{
  const ts=parser??=require(require.resolve('typescript',{paths:[process.cwd(),'/app/vendor/deepseek-harness']}));
  const source=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  if(source.parseDiagnostics.length)throw Error('Invalid JavaScript in runtime dependency inventory: '+file+': '+ts.flattenDiagnosticMessageText(source.parseDiagnostics[0].messageText,' '));
  const out=new Set();
  const add=node=>{if(node&&(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)))out.add(node.text);};
  const walk=node=>{
    if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))add(node.moduleSpecifier);
    else if(ts.isCallExpression(node)){
      let callee=node.expression;
      while(ts.isParenthesizedExpression(callee))callee=callee.expression;
      if(callee.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(callee)&&['require','__require'].includes(callee.text))add(node.arguments[0]);
    }
    ts.forEachChild(node,walk);
  };
  walk(source);
  return [...out];
};
const external=n=>!n.startsWith('.')&&!p.isAbsolute(n)&&!builtinModules.includes(n.replace(/^node:/,''));
for(const [path,m]of Object.entries(packages)){
  const req=createRequire(p.join(root,path,'package.json')),node=new Set(),client=new Set(),seen=new Set(),origins={},unsafe=new Set();
  const follow=n=>{if(seen.has(n)||!f.existsSync(n))return;seen.add(n);for(const name of requests(f.readFileSync(n,'utf8'),n)){
    if(p.isAbsolute(name)||/^[A-Za-z][A-Za-z0-9+.-]*:/.test(name)&&!name.startsWith('node:'))unsafe.add(name);
    if(external(name)){node.add(name);(origins[name]??=new Set()).add(p.relative(root,n));}
    else if(name.startsWith('.')){const next=p.resolve(p.dirname(n),name);if(!next.startsWith(root+'/'))unsafe.add(name);if(next.startsWith(p.join(root,path,'lib')+'/'))follow(next);}
  }};
  if(!['source','files'].includes(m.mode))for(const name of ['index.js','invariant.js','startup.js'])follow(p.join(root,path,'lib',name));
  if(m.mode==='client')for(const [name]of Object.entries(files))if(name.startsWith(path+'/lib/')&&/^\/(?:client(?:\.[^/]+)?|optional-[^/]+)\.js$/.test(name.slice((path+'/lib').length)))for(const request of requests(f.readFileSync(p.join(root,name),'utf8'),name))if(external(request))client.add(request);
  m.nodeRequests=[...node].sort();m.nodeRequestOrigins=Object.fromEntries(Object.entries(origins).sort().map(([n,v])=>[n,[...v].sort()]));m.unsafeNodeRequests=[...unsafe].sort();m.clientRequests=[...client].sort();m.resolvedBare={};
  for(const name of m.nodeRequests){const bare=name.startsWith('@')?name.split('/').slice(0,2).join('/'):name.split('/')[0];if(bare in workspace)continue;try{let file;try{file=req.resolve(bare+'/package.json')}catch{let dir=p.dirname(f.realpathSync(req.resolve(name)));while(!f.existsSync(p.join(dir,'package.json'))){const parent=p.dirname(dir);if(parent===dir)throw Error('External dependency manifest absent');dir=parent;}file=p.join(dir,'package.json');}const meta=JSON.parse(f.readFileSync(file));m.resolvedBare[name]={name:meta.name,version:meta.version};}catch{m.resolvedBare[name]=null;}}
}
console.log(JSON.stringify({files,packages,workspace}));});
'''

# Registry proofs hash complete physical virtual-store closures, not only the
# imported JS entry. No dependency code/native addon is evaluated by this scan.
REGISTRY_CODE = r'''
const f=require('fs'),p=require('path'),c=require('crypto'),{createRequire}=require('module');
const {pathToFileURL}=require('url'),{spawnSync}=require('child_process');
const registryJSON=v=>Array.isArray(v)?'['+v.map(registryJSON).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+registryJSON(v[k])).join(',')+'}':JSON.stringify(v);
const registryHash=v=>c.createHash('sha256').update(v).digest('hex');
function registryRelative(root,a){const n=p.relative(root,a);if(!n||p.isAbsolute(n)||n.split('/').some(x=>!x||x==='.'||x==='..'||['.git','.home','.ssh','secrets','__pycache__'].includes(x)||x==='.env'||x.startsWith('.env.'))||/[\\\0\r\n]/.test(n)||/\.(?:pem|key|p12|pfx|log|pid)$/.test(n))throw Error('Unsafe registry artifact path');const prefix=['node_modules/.pnpm/','vendor/deepseek-harness/node_modules/.pnpm/'].find(v=>n.startsWith(v)),parts=prefix?n.slice(prefix.length).split('/'):[];if(parts.length<3||parts[1]!=='node_modules'||parts[0]==='node_modules')throw Error('Registry artifact is outside the closed pnpm store');return n;}
function registryVirtual(root,a){const n=registryRelative(root,a),prefix=n.startsWith('node_modules/.pnpm/')?'node_modules/.pnpm/':'vendor/deepseek-harness/node_modules/.pnpm/';return p.join(root,prefix,n.slice(prefix.length).split('/')[0],'node_modules');}
function registryABI(){const report=process.report.getReport(),h=report.header,sharedLibraries=(report.sharedObjects||[]).filter(name=>!/^linux-(?:vdso|gate)\.so\.\d+$/.test(name)).sort().map(name=>{if(!['/lib/','/lib64/','/usr/lib/'].some(prefix=>name.startsWith(prefix)))throw Error('Unreviewed external Node ABI library');const realpath=f.realpathSync(name);if(!['/lib/','/lib64/','/usr/lib/'].some(prefix=>realpath.startsWith(prefix))||!f.statSync(realpath).isFile())throw Error('Node ABI library escaped its system roots');return{path:name,realpath,sha256:registryHash(f.readFileSync(realpath))};});return{node:process.versions.node,modules:process.versions.modules,napi:process.versions.napi,arch:process.arch,platform:process.platform,libc:h.glibcVersionRuntime?'glibc':'musl',glibcVersion:h.glibcVersionRuntime||null,nodeSha256:registryHash(f.readFileSync(process.execPath)),sharedLibraries};}
function registryEntry(root,a,target){const real=f.realpathSync(a),name=registryRelative(root,real),st=f.lstatSync(real);if(!st.isFile()||!name.startsWith(target+'/'))throw Error('Registry entry is absent or escaped its package');return{path:name,sha256:registryHash(f.readFileSync(real))};}
function registryResolve(root,owner,request,target,fromFile=false){const parent=fromFile?p.join(root,owner):p.join(root,owner,'package.json'),req=createRequire(parent),required=registryEntry(root,req.resolve(request),target);const code='import {pathToFileURL,fileURLToPath} from "node:url";process.stdout.write(fileURLToPath(import.meta.resolve(process.argv[1],pathToFileURL(process.argv[2]).href)));';const r=spawnSync(process.execPath,['--experimental-import-meta-resolve','--input-type=module','-e',code,request,parent],{encoding:'utf8',env:{},maxBuffer:1024*1024});if(r.status!==0)throw Error('ESM registry entry is unresolved');return{require:required,import:registryEntry(root,r.stdout,target)};}
function registryLink(root,from,name,target){const relative=(from?from+'/':'')+'node_modules/'+name;if(p.isAbsolute(relative)||relative.split('/').some(x=>!x||x==='.'||x==='..')||/[\\\0\r\n]/.test(relative))throw Error('Unsafe registry importer link');const a=p.join(root,relative);let parent=p.dirname(a);while(parent!==root){let st;try{st=f.lstatSync(parent)}catch(error){if(error.code!=='ENOENT')throw error}if(st&&!st.isDirectory())throw Error('Registry importer parent is a link/non-directory');parent=p.dirname(parent);if(!parent.startsWith(root))throw Error('Registry importer parent escaped root');}let st;try{st=f.lstatSync(a)}catch(error){if(error.code!=='ENOENT')throw error;return{type:'absent'}}if(!st.isSymbolicLink())throw Error('Refusing a real registry dependency directory');const raw=f.readlinkSync(a);if(p.isAbsolute(raw)||/[\\\0\r\n]/.test(raw))throw Error('External registry importer link');const real=registryRelative(root,f.realpathSync(a));if(real!==target)throw Error('Registry importer link points to a different artifact');return{type:'symlink',target:raw,realpath:real};}
function observeRegistry(root,rows,phase){root=f.realpathSync(root);const entries={},packages={},virtuals=new Set(),seen=new Set();
function visit(a){const name=registryRelative(root,a);if(seen.has(name))return;seen.add(name);const st=f.lstatSync(a),mode=st.mode&511;if(st.mode&3584)throw Error('Special registry artifact permissions');if(st.isSymbolicLink()){const target=f.readlinkSync(a);if(!target||p.isAbsolute(target)||/[\\\0\r\n]/.test(target))throw Error('External registry artifact link');registryRelative(root,p.resolve(p.dirname(a),target));const real=f.realpathSync(a),realpath=registryRelative(root,real);entries[name]={type:'symlink',mode,target,realpath};if(f.statSync(real).isDirectory())scanVirtual(registryVirtual(root,real));visit(real);}else{if(f.realpathSync(a)!==a)throw Error('Registry artifact ancestor is a symlink');if(st.isDirectory()){entries[name]={type:'dir',mode};for(const n of f.readdirSync(a).sort())visit(p.join(a,n));}else if(st.isFile()){entries[name]={type:'file',mode,bytes:st.size,sha256:registryHash(f.readFileSync(a))};}else throw Error('Special registry artifact file');}}
function packageMeta(a,modules,name){const real=f.realpathSync(a),relative=registryRelative(root,real),manifest=p.join(real,'package.json');if(!f.lstatSync(real).isDirectory()||!f.lstatSync(manifest).isFile())throw Error('Registry package manifest/root is absent');const m=JSON.parse(f.readFileSync(manifest));if(m.name!==name||typeof m.version!=='string')throw Error('Registry package name/version differs');if(packages[relative])return;const dependencies={};packages[relative]={name:m.name,version:m.version,dependencies};for(const field of ['dependencies','optionalDependencies','peerDependencies'])for(const dep of Object.keys(m[field]||{}).sort()){const target=p.join(modules,dep);let st;try{st=f.lstatSync(target)}catch(error){if(error.code!=='ENOENT')throw error}if(!st){if(field==='dependencies'||field==='peerDependencies'&&!m.peerDependenciesMeta?.[dep]?.optional)throw Error('Required transitive registry dependency is absent');dependencies[field+':'+dep]=null;continue;}const actual=f.realpathSync(target),n=registryRelative(root,actual),meta=JSON.parse(f.readFileSync(p.join(actual,'package.json')));if(meta.name!==dep)throw Error('Transitive registry dependency name differs');dependencies[field+':'+dep]={target:n,name:meta.name,version:meta.version};scanVirtual(registryVirtual(root,actual));}}
function scanVirtual(modules){if(virtuals.has(modules))return;virtuals.add(modules);if(f.realpathSync(modules)!==modules||!f.lstatSync(modules).isDirectory())throw Error('Registry virtual store parent is not a real directory');for(const name of f.readdirSync(modules).sort()){const a=p.join(modules,name);visit(a);if(name.startsWith('@')){for(const n of f.readdirSync(a).sort())packageMeta(p.join(a,n),modules,name+'/'+n);}else packageMeta(a,modules,name);}}
const requests=[],links=[];for(const row of rows){const name=row.name,request=row.request,from=row.from;if(typeof from!=='string'||p.isAbsolute(from)||from.split('/').some(x=>x==='.'||x==='..')||typeof name!=='string'||!/^(@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+$/.test(name))throw Error('Invalid registry request');let target=row.target;if(!target){const link=p.join(root,from,'node_modules',name);target=registryRelative(root,f.realpathSync(link));}const a=p.join(root,target);if(registryRelative(root,f.realpathSync(a))!==target)throw Error('Registry target realpath changed');scanVirtual(registryVirtual(root,a));const meta=packages[target];if(!meta||meta.name!==name||meta.version!==row.resolved?.version)throw Error('Installed registry version differs');const state=registryLink(root,from,name,target),actual=registryResolve(root,target,request,target);if(phase!=='before'){if(state.type!=='symlink')throw Error('Audited registry importer link is absent');const m=JSON.parse(f.readFileSync(p.join(root,from,'package.json'))),spec={...m.dependencies,...m.peerDependencies}[name];if(spec!==row.specifier||registryJSON(registryResolve(root,from,request,target))!==registryJSON(actual))throw Error('Actual importer resolved entry/spec differs');}requests.push({from,request,name,specifier:row.specifier,resolved:row.resolved,target,entries:actual});links.push({from,request,state});}
return{artifacts:{abi:registryABI(),entries,packages,requests},links};}
function checkRegistryOrigins(root,proof){for(const row of proof.origins||[]){if(typeof row.owner!=='string'||!row.owner.startsWith(row.from+'/lib/')||p.isAbsolute(row.owner)||row.owner.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe Node request origin');const want=proof.requests.find(v=>v.from===row.from&&v.request===row.request);if(!want||registryJSON(registryResolve(root,row.owner,row.request,row.target,true))!==registryJSON(want.entries))throw Error('Actual compiled Node resolver differs from the audited artifact');}}
function checkRegistry(root,proof,phase){root=f.realpathSync(root);if(proof.schemaVersion!==1||registryHash(registryJSON(proof.artifacts))!==proof.artifactDigest)throw Error('Registry artifact proof digest changed');const observed=observeRegistry(root,proof.requests,phase);if(registryJSON(observed.artifacts)!==registryJSON(proof.artifacts))throw Error('Registry bytes/realpath/transitive/native assets or ABI changed');if(phase==='before')for(const [i,row]of proof.requests.entries())if(registryJSON(observed.links[i].state)!==registryJSON(row.beforeLink))throw Error('Registry link absence/base state changed');if(phase!=='before')checkRegistryOrigins(root,proof);return observed;}
'''

REGISTRY_AUDIT_JS = REGISTRY_CODE + r'''
let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{const doc=JSON.parse(input),root=f.realpathSync(doc.root||'/app'),policies={};for(const name of doc.policies){if(typeof name!=='string'||p.isAbsolute(name)||name.split('/').some(x=>!x||x==='.'||x==='..')||/[\\\0\r\n]/.test(name))throw Error('Unsafe policy checksum path');const a=p.join(root,name);let st;try{st=f.lstatSync(a)}catch(error){if(error.code!=='ENOENT')throw error;policies[name]=null;continue;}if(!st.isFile()||f.realpathSync(a)!==a)throw Error('Lock/policy must be a real application file');policies[name]=registryHash(f.readFileSync(a));}const parserPath=require.resolve('js-yaml',{paths:[root,root+'/vendor/deepseek-harness']}),parser={path:registryRelative(root,f.realpathSync(parserPath)),sha256:registryHash(f.readFileSync(parserPath))},lock=require(parserPath).load(f.readFileSync(root+'/vendor/deepseek-harness/pnpm-lock.yaml','utf8')),graph={...lock};delete graph.importers;console.log(JSON.stringify({policies,parser,lock:{graph,importers:lock.importers},...observeRegistry(root,doc.requests,doc.phase)}));});
'''

REGISTRY_VERIFY_JS = REGISTRY_CODE + r'''
let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{const d=JSON.parse(input);checkRegistry(d.root||'/app',d.proof,d.phase);console.log(JSON.stringify({checkedRequests:d.proof.requests.length,artifactDigest:d.proof.artifactDigest}));});
'''

REGISTRY_ORIGIN_JS = REGISTRY_CODE + r'''
let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{const d=JSON.parse(input);checkRegistryOrigins(f.realpathSync(d.root||'/app'),d.proof);console.log(JSON.stringify({checkedOrigins:d.proof.origins.length}));});
'''

UPDATE_JS = REGISTRY_CODE + r'''
function applyRuntimeUpdate(root,doc){root=f.realpathSync(root);
const safe=n=>{if(typeof n!=='string'||!n||p.isAbsolute(n)||n.split('/').some(x=>x==='..'||x==='.'||!x||x==='.env'||x.startsWith('.env.'))||/[\\\0\r\n]/.test(n)||/\.(?:pem|key|p12|pfx)$/.test(n))throw Error('Unsafe runtime update path');return p.join(root,n);};
const parent=abs=>{const dir=f.realpathSync(p.dirname(abs));if(dir!==root&&!dir.startsWith(root+'/'))throw Error('Runtime update parent escaped app');};
for(const row of doc.deleted){const abs=safe(row.path);if(!(row.path.startsWith('packages/')||row.path.startsWith('scripts/')||row.path.startsWith('vendor/deepseek-harness/')||row.path==='classroom-runtime-links.cjs'||row.path==='classroom-runtime-links.json'||row.path==='overlays/harness/files/packages/physicsos/health-host/deployment.patch.yml'))throw Error('Unowned runtime deletion');parent(abs);if(!f.existsSync(abs))continue;const st=f.lstatSync(abs);if(!st.isFile()||c.createHash('sha256').update(f.readFileSync(abs)).digest('hex')!==row.sha256)throw Error('Owned deleted file changed');}
if(doc.registryReuse)checkRegistry(root,doc.registryReuse,'before');
const registryLinks=new Map((doc.registryReuse?.requests||[]).map(row=>[(row.from?row.from+'/':'')+'node_modules/'+row.name,row]));
for(const row of doc.links){const abs=safe(row.link),target=safe(row.target);if(!row.link.includes('/node_modules/')&&!row.link.startsWith('node_modules/'))throw Error('Not a runtime dependency link');if(row.registry){const proof=registryLinks.get(row.link);if(!proof||proof.target!==row.target||registryJSON(proof.beforeLink)!==registryJSON(row.before))throw Error('Registry link has no matching physical proof');registryRelative(root,target);}else if(row.target.split('/').includes('node_modules'))throw Error('Workspace link cannot admit an unverified registry artifact');if(!f.existsSync(p.join(target,'package.json')))throw Error('Runtime link target absent');let current;try{current=f.lstatSync(abs)}catch(error){if(error.code!=='ENOENT')throw error}if(current&&!current.isSymbolicLink())throw Error('Refusing real workspace dependency directory');if(!row.registry){let dir=p.dirname(abs);while(dir!==root){let st;try{st=f.lstatSync(dir)}catch(error){if(error.code!=='ENOENT')throw error}if(st&&!st.isDirectory())throw Error('Runtime link parent escaped app');dir=p.dirname(dir);}}}
if([...registryLinks.keys()].some(link=>!doc.links.some(row=>row.registry&&row.link===link)))throw Error('Audited registry link plan is incomplete');
for(const row of doc.deleted){const abs=safe(row.path);if(f.existsSync(abs))f.unlinkSync(abs);}
for(const row of doc.links){const abs=safe(row.link),target=safe(row.target);f.mkdirSync(p.dirname(abs),{recursive:true,mode:493});parent(abs);let exists=false;try{f.lstatSync(abs);exists=true}catch(error){if(error.code!=='ENOENT')throw error}if(exists)f.unlinkSync(abs);f.symlinkSync(p.relative(p.dirname(abs),target),abs,'dir');try{f.lchownSync(abs,999,999)}catch{}}
for(const row of doc.checks){const req=createRequire(safe((row.from?row.from+'/':'')+'package.json'));for(const dep of row.dependencies)req.resolve(dep);}
if(doc.registryReuse)checkRegistry(root,doc.registryReuse,'after');
}
module.exports={applyRuntimeUpdate};
if(require.main===module)applyRuntimeUpdate('/app',JSON.parse(f.readFileSync('/app/physicsos-runtime-update.json','utf8')));
'''

VERIFY_JS = r'''
const f=require('fs'),p=require('path'),c=require('crypto');let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{const files=JSON.parse(s),failures=[];let checked=0;for(const [n,want]of Object.entries(files)){if(!n||p.isAbsolute(n)||n.split('/').includes('..')||/[\\\0\r\n]/.test(n))throw Error('Unsafe verification path');const abs=p.join('/app',n);try{const real=f.realpathSync(abs);if(!real.startsWith('/app/'))throw Error('escaped');if(c.createHash('sha256').update(f.readFileSync(real)).digest('hex')!==want)failures.push(n);checked++;}catch{failures.push(n);}}console.log(JSON.stringify({checked,failures}));if(failures.length)process.exitCode=1;});
'''


def command(args, request=None, log=False):
    result = subprocess.run(args, input=None if request is None else json.dumps(request).encode(), stdout=subprocess.PIPE, stderr=None if log else subprocess.DEVNULL)
    if log and result.stdout:
        sys.stderr.buffer.write(result.stdout)
    if result.returncode:
        raise ValueError(f'{args[0]} operation failed ({result.returncode})')
    if len(result.stdout) > 64 * 1024 * 1024:
        raise ValueError('Runtime operation metadata exceeded limit')
    return result.stdout.decode().strip()


def image_metadata(image):
    return json.loads(command(['docker', 'image', 'inspect', '--format', '{"id":{{json .Id}},"labels":{{json (index .Config "Labels")}}}', image]))


def check_builder(builder):
    if not re.fullmatch(r'physicsos-[A-Za-z0-9_.-]+', builder) or builder == 'physicsos-app-1':
        raise ValueError('Dedicated development builder is required')
    metadata = json.loads(command(['docker', 'inspect', '--format', '{"name":{{json .Name}},"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}}}', builder]))
    if (metadata.get('labels') or {}).get('physicsos.role') != 'development-builder' or any(m['Destination'] == '/var/lib/physicsos' or m['Destination'].startswith('/run/secrets') for m in metadata.get('mounts', [])):
        raise ValueError('Production or secret-mounted container is not a development builder')


def node_operation(image_or_builder, script, request=None, builder=False):
    args = ['docker', 'exec', '-i', image_or_builder, 'node', '-e', script] if builder else ['docker', 'run', '--rm', '-i', '--network', 'none', '--read-only', '--entrypoint', 'node', image_or_builder, '-e', script]
    return json.loads(command(args, request))


def read_builder_json(builder, path):
    safe_relative(path)
    return json.loads(command(['docker', 'exec', builder, 'node', '-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"));', '/app/' + path]))


def read_base_manifest(image):
    script = 'const f=require("fs"),a="/app/physicsos-runtime-manifest.json",b="/app/canvas-source-manifest.json";process.stdout.write(f.readFileSync(f.existsSync(a)?a:b,"utf8"));'
    return normalize_manifest(node_operation(image, script))


def atomic_json(path, value):
    path = pathlib.Path(path)
    temporary = path.with_name(path.name + '.partial-' + os.urandom(6).hex())
    try:
        with temporary.open('x', encoding='utf8') as stream:
            stream.write(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n')
        temporary.chmod(0o600)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def require_disk(path, payload, reserve=256 * 1024 * 1024):
    if payload < 0 or reserve < 0:
        raise ValueError('Invalid disk budget')
    usage = shutil.disk_usage(path)
    stats = os.statvfs(path)
    return assert_disk_budget({'freeBytes': usage.free, 'freeInodes': stats.f_favail}, payload, reserve)


def assert_disk_budget(stats, payload, reserve=256 * 1024 * 1024):
    if payload < 0 or reserve < 0:
        raise ValueError('Invalid disk budget')
    required = payload * 4 + reserve
    if stats.get('freeBytes', -1) < required or stats.get('freeInodes', -1) < 4096:
        raise ValueError('Insufficient disk space/inodes before runtime export/build; no cleanup performed')
    return {**stats, 'requiredBytes': required}


def selections_for(plan):
    selections, exact = [], []
    for row in plan.get('packageScopes', []):
        path = HARNESS + '/' + safe_relative(row['path'])
        if row['mode'] == 'files':
            items = [safe_relative(n) for n in row.get('files', []) if n not in row.get('deletedFiles', [])]
        else:
            items = ['src', 'lib', 'package.json', 'tsconfig.json', 'tsdown.config.ts', 'README.md', 'README.zh.md', 'LICENSE']
        selections.append({'root': path, 'mode': row['mode'], 'items': items, 'ownedItems': row.get('files', []) if row['mode'] == 'files' else items})
    root_packages = sorted({n.split('/')[1] for n in plan.get('changed', []) + plan.get('deleted', []) if n.startswith('packages/') and len(n.split('/')) > 2 and not excluded(n)})
    for name in root_packages:
        selections.append({'root': 'packages/' + name, 'mode': 'source', 'items': ['src', 'package.json'], 'ownedItems': ['src', 'package.json']})
    if plan.get('vite'):
        selections.append({'root': HARNESS + '/apps/web/dist', 'items': ['.'], 'ownedItems': ['.']})
    startup = {'overlays/harness/files/packages/physicsos/health-host/deployment.patch.yml', 'package.json', TEACHING_TOOLS_MARKER, 'scripts/docker-entrypoint.mjs', 'scripts/healthcheck.mjs', 'scripts/deploy/wait-for-ready.mjs', 'scripts/deploy/migrate-json-postgres.mjs'}
    exact.extend(sorted(startup & set(plan.get('changed', []) + plan.get('deleted', []))))
    return selections, exact


def inventory_request(plan, base=False):
    selections, exact = selections_for(plan)
    return {'root': '/app', 'selections': [{**row, 'items': row['ownedItems'] if base else row['items']} for row in selections], 'exact': exact if base else [n for n in exact if n not in plan.get('deleted', [])], 'required': [] if base else plan.get('requiredArtifacts', [])}


def selected_path(path, selections, exact):
    if path in exact:
        return True
    for row in selections:
        for item in row['ownedItems']:
            prefix = row['root'] if item == '.' else row['root'] + '/' + item
            if path == prefix or path.startswith(prefix + '/'):
                return True
    return False


def stream_copy(builder, names, destination, expected):
    if not names:
        return
    for name in names:
        safe_code_path(name)
    proc = subprocess.Popen(['docker', 'exec', '-i', builder, 'tar', '-C', '/app', '-cf', '-', '--null', '-T', '-'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    proc.stdin.write(('\0'.join(names) + '\0').encode())
    proc.stdin.close()
    seen = set()
    try:
        with tarfile.open(fileobj=proc.stdout, mode='r|') as archive:
            for member in archive:
                name = safe_code_path(member.name.rstrip('/'))
                if name not in expected or name in seen or not member.isfile():
                    raise ValueError('Unexpected or linked runtime archive member')
                path = destination.joinpath(*pathlib.PurePosixPath(name).parts)
                path.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as source, path.open('xb') as target:
                    shutil.copyfileobj(source, target, 1024 * 1024)
                path.chmod(member.mode & 0o777)
                if sha(path.read_bytes()) != expected[name]:
                    raise ValueError('Builder artifact changed during export')
                seen.add(name)
        if proc.wait() or seen != set(names):
            raise ValueError('Runtime delta archive was incomplete')
    finally:
        if proc.poll() is None:
            proc.terminate()
            proc.wait()


def registry_builder_identity(builder):
    metadata = json.loads(command(['docker', 'inspect', '--format', '{"id":{{json .Id}},"image":{{json .Image}},"role":{{json (index .Config.Labels "physicsos.role")}}}', builder]))
    if not HEX64.fullmatch(metadata.get('id', '')) or not IMAGE_ID.fullmatch(metadata.get('image', '')) or metadata.get('role') != 'development-builder':
        raise ValueError('Exact dedicated registry audit builder identity is required')
    return metadata


def registry_base_identity(image, base):
    metadata = image_metadata(image)
    if metadata.get('id') != image or not IMAGE_ID.fullmatch(image) or base.get('originSchema') != 2:
        raise ValueError('Registry reuse requires an exact source-labelled base image')
    validate_image_labels(metadata, base)
    digest = (metadata.get('labels') or {}).get('physicsos.manifest.digest')
    if not HEX64.fullmatch(digest or ''):
        raise ValueError('Exact base manifest byte label is required for registry reuse')
    script = "const f=require('fs'),c=require('crypto');const a='/app/physicsos-runtime-manifest.json',b='/app/canvas-source-manifest.json';for(const n of[a,b])if(!f.lstatSync(n).isFile()||f.realpathSync(n)!==n)throw Error('Base manifest is linked');const x=f.readFileSync(a),y=f.readFileSync(b);if(!x.equals(y))throw Error('Base manifest aliases differ');console.log(JSON.stringify({sha256:c.createHash('sha256').update(x).digest('hex')}));"
    if node_operation(image, script).get('sha256') != digest:
        raise ValueError('Base manifest byte digest differs from its immutable image label')
    return {key: base.get(key) for key in ['revision', 'sourceDigest', 'codeDigest']} | {'image': image, 'manifestSha256': digest}


def collect_registry_reuse(args, source, plan, base, candidate, before, baseline):
    base_identity = registry_base_identity(args.base_image, base)
    builder_identity = registry_builder_identity(args.builder)
    additions = registry_additions(candidate['packages'], before['packages'], candidate['workspace'])
    if not additions or any(not row['from'].startswith(HARNESS + '/') for row in additions):
        raise ValueError('Only actual harness bare Node additions support registry reuse')
    files, old_files = reuse_source_files(source), reuse_source_files(baseline)
    policies = sorted(n for n in set(files) | set(old_files) if registry_policy_path(n))
    candidate_proof = node_operation(args.builder, REGISTRY_AUDIT_JS, {'root': '/app', 'phase': 'after', 'requests': additions, 'policies': policies}, builder=True)
    physical = validate_registry_artifacts(candidate_proof['artifacts'])
    requests = physical['requests']
    origins = [{'from': row['from'], 'request': row['request'], 'name': row['name'], 'specifier': row['specifier'], 'resolved': row['resolved'], 'target': row['target'], 'owner': origin} for row in requests for origin in candidate['packages'][row['from']]['nodeRequestOrigins'][row['request']]]
    node_operation(args.builder, REGISTRY_ORIGIN_JS, {'root': '/app', 'proof': {'origins': origins, 'requests': requests}}, builder=True)
    base_proof = node_operation(args.base_image, REGISTRY_AUDIT_JS, {'root': '/app', 'phase': 'before', 'requests': requests, 'policies': policies})
    validate_registry_artifacts(base_proof['artifacts'])
    if base_proof['artifacts'] != physical or base_proof['parser'] != candidate_proof['parser']:
        raise ValueError('Base/candidate registry bytes, entry, transitive/native assets, realpath or ABI differ; a full runtime build is required')
    validate_registry_sources(source, baseline, base, base_proof['policies'], candidate_proof['policies'])
    validate_registry_lock(candidate_proof['lock'], base_proof['lock'], additions, candidate['workspace'])
    receipt = read_builder_json(args.builder, 'physicsos-development-builder.json')
    if receipt.get('builderImage') != builder_identity['image'] or receipt.get('dependencyFingerprint') != source.get('dependencyFingerprint') or any(receipt.get(key) is not True for key in ['completeDevelopmentDependencies', 'lockedDependenciesVerified', 'nativeProbeVerified']):
        raise ValueError('Current locked development-builder evidence does not match registry reuse')
    if receipt.get('abi') != {key: physical['abi'][key] for key in ['node', 'modules', 'platform', 'arch', 'libc']}:
        raise ValueError('Builder registry ABI differs from its existing reviewed receipt')
    signature = {'root': '/app', **{key: base['pluginTrust'].get(key, DEFAULT_TRUST[key]) for key in ['entryRoot', 'manifestPath', 'publicKeyPath']}}
    signed_base = node_operation(args.base_image, SIGNATURE_JS, signature)
    signed_candidate = node_operation(args.builder, SIGNATURE_JS, signature, builder=True)
    validate_signature_proofs(signed_base, signed_candidate)
    if signed_candidate['publicKeySha256'] != files.get(signature['publicKeyPath']) or signed_base['publicKeySha256'] != old_files.get(signature['publicKeyPath']):
        raise ValueError('Registry reuse plugin trust root differs from the frozen sources')
    if base.get('filesystemDigest') or base.get('systemFSdigest'):
        # A complete base filesystem proof must not be dropped by a delta. This
        # audited path deliberately supports the existing code-owned base only.
        raise ValueError('Complete-filesystem base requires reviewed full runtime transport')
    retained = base.get('registryReuse')
    if retained:
        validate_manifest_registry(base)
        if not set(retained['artifacts']['entries']) <= set(physical['entries']) or any(physical['entries'][name] != item for name, item in retained['artifacts']['entries'].items()) or not {(row['from'], row['request']) for row in retained['requests']} <= {(row['from'], row['request']) for row in physical['requests']}:
            raise ValueError('Existing audited registry inventory cannot be dropped; a full runtime build is required')
    requests = [{**row, 'beforeLink': base_proof['links'][index]['state']} for index, row in enumerate(requests)]
    for row in requests:
        if row['beforeLink'].get('type') not in ('absent', 'symlink') or row['beforeLink'].get('type') == 'symlink' and row['beforeLink'].get('realpath') != row['target']:
            raise ValueError('Registry importer absence/link proof differs')
    proof = {'schemaVersion': 1, 'format': 'physicsos-registry-reuse/1', 'base': base_identity,
             'candidate': {'revision': source['revision'], 'sourceDigest': source['sourceDigest'], 'dependencyFingerprint': source.get('dependencyFingerprint'), 'builder': args.builder, **builder_identity},
             'baselineSourceManifestDigest': sha(canonical(baseline)), 'planDigest': sha(canonical(plan)),
             'nodeInventoryDigest': sha(canonical({'base': before['packages'], 'candidate': candidate['packages'], 'workspace': candidate['workspace']})),
             'locks': {'baseSha256': base_proof['policies'][HARNESS + '/pnpm-lock.yaml'], 'candidateSha256': candidate_proof['policies'][HARNESS + '/pnpm-lock.yaml'], 'graphDigest': sha(canonical(candidate_proof['lock']['graph']))},
             'policies': {'base': base_proof['policies'], 'candidate': candidate_proof['policies']},
             'requests': requests, 'origins': origins, 'artifacts': physical, 'artifactDigest': sha(canonical(physical)),
             'publicKeySha256': signed_candidate['publicKeySha256']}
    proof['proofDigest'] = sha(canonical(proof))
    # Re-read marker and identities after the bounded synchronous scan. The
    # builder is mutable; the proof is never an authority for later exports.
    marker = read_builder_json(args.builder, 'physicsos-source-manifest.json')
    validate_freeze(source, plan, read_builder_json(args.builder, 'physicsos-build-evidence.json'), marker)
    if registry_builder_identity(args.builder) != builder_identity or registry_base_identity(args.base_image, read_base_manifest(args.base_image)) != base_identity:
        raise ValueError('Registry audit identities changed while collecting metadata')
    return proof


def validate_registry_reuse_proof(proof, actual=None):
    if not isinstance(proof, dict) or proof.get('schemaVersion') != 1 or proof.get('format') != 'physicsos-registry-reuse/1' or not HEX64.fullmatch(proof.get('proofDigest', '')) or sha(canonical({key: value for key, value in proof.items() if key != 'proofDigest'})) != proof['proofDigest']:
        raise ValueError('Invalid registry reuse proof digest/format')
    validate_registry_artifacts(proof.get('artifacts'))
    if sha(canonical(proof['artifacts'])) != proof.get('artifactDigest'):
        raise ValueError('Registry reuse physical artifact digest differs')
    requests = [{key: value for key, value in row.items() if key != 'beforeLink'} for row in proof.get('requests', [])]
    if requests != proof['artifacts']['requests']:
        raise ValueError('Registry reuse requests/physical artifacts differ')
    if not IMAGE_ID.fullmatch(proof.get('base', {}).get('image', '')) or not IMAGE_ID.fullmatch(proof.get('candidate', {}).get('image', '')) or not HEX64.fullmatch(proof.get('candidate', {}).get('id', '')):
        raise ValueError('Registry reuse exact image identities are missing')
    if not HEX64.fullmatch(proof['base'].get('manifestSha256', '')) or not HEX64.fullmatch(proof['base'].get('codeDigest', '')):
        raise ValueError('Registry reuse base manifest/ownership checksum is missing')
    for identity in [proof['base'], proof['candidate']]:
        if not HEX40.fullmatch(identity.get('revision', '')) or not HEX64.fullmatch(identity.get('sourceDigest', '')):
            raise ValueError('Registry reuse frozen source identity is missing')
    for key in ['nodeInventoryDigest', 'baselineSourceManifestDigest', 'planDigest', 'publicKeySha256']:
        if not HEX64.fullmatch(proof.get(key, '')):
            raise ValueError('Registry reuse metadata checksum is missing')
    if not proof.get('origins') or {(row.get('from'), row.get('request')) for row in proof['origins']} != {(row['from'], row['request']) for row in proof['requests']}:
        raise ValueError('Registry reuse compiled Node origins are missing')
    for origin in proof['origins']:
        safe_code_path(origin.get('owner'))
        if not origin['owner'].startswith(origin['from'] + '/lib/'):
            raise ValueError('Registry reuse Node origin escaped its compiled package')
    for row in proof['requests']:
        state = row.get('beforeLink', {})
        if state.get('type') not in ('absent', 'symlink') or state['type'] == 'symlink' and state.get('realpath') != row['target']:
            raise ValueError('Registry reuse base link state differs')
    if actual is not None and proof != actual:
        raise ValueError('Registry reuse proof differs from freshly verified images/source/resolution/content; re-audit or perform a full runtime build')
    return proof


def copy_registry_binding(retained, args, source, plan, base):
    proof = json.loads(json.dumps(retained))
    proof['retainedProofDigest'] = retained['proofDigest']
    proof['base'] = registry_base_identity(args.base_image, base)
    proof['candidate'] = {'revision': source['revision'], 'sourceDigest': source['sourceDigest'], 'dependencyFingerprint': source.get('dependencyFingerprint'), 'builder': args.builder, **registry_builder_identity(args.builder)}
    proof['planDigest'] = sha(canonical(plan))
    for row in proof['requests']:
        link = (row['from'] + '/' if row['from'] else '') + 'node_modules/' + row['name']
        row['beforeLink'] = {'type': 'symlink', 'target': posixpath.relpath(row['target'], posixpath.dirname(link)), 'realpath': row['target']}
    proof['proofDigest'] = sha(canonical({key: value for key, value in proof.items() if key != 'proofDigest'}))
    return validate_registry_reuse_proof(proof)


def registry_policy_path(name):
    return pathlib.PurePosixPath(name).name in {'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'pnpmfile.cjs', '.pnpmfile.cjs'} or name in {'package.json', HARNESS + '/package.json'} or '/patches/' in '/' + name


def audit_registry_reuse(args):
    check_builder(args.builder)
    source = json.loads(pathlib.Path(args.source_manifest).read_text())
    plan = json.loads(pathlib.Path(args.plan_file).read_text())
    if source.get('revision') != args.revision or not HEX40.fullmatch(args.revision) or not IMAGE_ID.fullmatch(args.base_image):
        raise ValueError('Exact frozen candidate revision/base image required for registry audit')
    validate_freeze(source, plan, read_builder_json(args.builder, 'physicsos-build-evidence.json'), read_builder_json(args.builder, 'physicsos-source-manifest.json'))
    base = read_base_manifest(args.base_image)
    baseline = json.loads(pathlib.Path(args.baseline_source_manifest).read_text())
    candidate = node_operation(args.builder, INVENTORY_JS, inventory_request(plan), builder=True)
    before = node_operation(args.base_image, INVENTORY_JS, inventory_request(plan, base=True))
    proof = collect_registry_reuse(args, source, plan, base, candidate, before, baseline)
    validate_registry_reuse_proof(proof)
    output = pathlib.Path(args.proof_file)
    if output.exists() or output.is_symlink():
        raise ValueError('Registry audit proof output already exists; do not overwrite previous evidence')
    output.parent.mkdir(parents=True, exist_ok=True)
    atomic_json(output, proof)
    return {'proofFile': str(output.resolve()), 'proofDigest': proof['proofDigest'], 'artifactDigest': proof['artifactDigest'],
            'baseImage': args.base_image, 'revision': args.revision, 'sourceDigest': source['sourceDigest'],
            'requests': [{key: row[key] for key in ['from', 'request', 'target']} for row in proof['requests']]}


def export_runtime(args):
    if not IMAGE_ID.fullmatch(args.base_image) or image_metadata(args.base_image)['id'] != args.base_image or not HEX40.fullmatch(args.revision):
        raise ValueError('Exact immutable base image and committed revision required')
    check_builder(args.builder)
    source = json.loads(pathlib.Path(args.source_manifest).read_text())
    plan = json.loads(pathlib.Path(args.plan_file).read_text())
    if source.get('revision') != args.revision:
        raise ValueError('Export revision differs from frozen source')
    validate_freeze(source, plan, read_builder_json(args.builder, 'physicsos-build-evidence.json'), read_builder_json(args.builder, 'physicsos-source-manifest.json'))
    base = read_base_manifest(args.base_image)
    trust = {key: base['pluginTrust'][key] for key in ['manifestPath', 'publicKeyPath']}
    trust['entryRoot'] = base['pluginTrust'].get('entryRoot', HARNESS)
    for key in ['manifestPath', 'publicKeyPath']:
        safe_code_path(trust[key])
    safe_code_path(trust['entryRoot'] + '/package.json')
    signature_request = {'root': '/app', **trust}
    base_signature = node_operation(args.base_image, SIGNATURE_JS, signature_request)
    candidate_signature = node_operation(args.builder, SIGNATURE_JS, signature_request, builder=True)
    validate_signature_proofs(base_signature, candidate_signature)
    selections, exact = selections_for(plan)
    request = inventory_request(plan)
    candidate = node_operation(args.builder, INVENTORY_JS, request, builder=True)
    before = node_operation(args.base_image, INVENTORY_JS, inventory_request(plan, base=True))
    for path, info in candidate['files'].items():
        safe_code_path(path)
        if path in source['files'] and info['sha256'] != source['files'][path]:
            raise ValueError('Exported source changed after the reviewed freeze')
    base_files = dict(base['files'])
    owned = {path for path in base_files if selected_path(path, selections, exact)}
    if owned:
        verified_base = node_operation(args.base_image, VERIFY_JS, {path: base_files[path] for path in owned})
        if verified_base.get('failures') or verified_base.get('checked') != len(owned):
            raise ValueError('Selected immutable base file differs from its ownership manifest')
    extra = {path: info['sha256'] for path, info in before['files'].items() if path not in base_files}
    base_files.update(extra)
    owned.update(extra)
    reuse = None
    proof_file, baseline_file = getattr(args, 'registry_reuse_proof', None), getattr(args, 'baseline_source_manifest', None)
    if bool(proof_file) != bool(baseline_file):
        raise ValueError('Registry reuse requires both an independently audited proof and exact baseline source manifest')
    if proof_file:
        proof_path = pathlib.Path(proof_file)
        if proof_path.is_symlink() or proof_path.stat().st_size > 32 * 1024 * 1024:
            raise ValueError('Unsafe/oversize registry proof input')
        reviewed = validate_registry_reuse_proof(json.loads(proof_path.read_text()))
        actual = collect_registry_reuse(args, source, plan, base, candidate, before, json.loads(pathlib.Path(baseline_file).read_text()))
        reuse = validate_registry_reuse_proof(reviewed, actual)
    if not reuse and base.get('registryReuse'):
        workspace_updates(candidate['packages'], before['packages'], candidate['workspace'])
        for key in ['dependencies', 'peerDependencies', 'optionalDependencies']:
            if any(package.get(key, {}) != before['packages'].get(path, {}).get(key, {}) for path, package in candidate['packages'].items()):
                raise ValueError('Retained registry proof permits source-only deltas; dependency changes require a new/full audit')
        # Subsequent source-only deltas retain (and recheck) the prior physical
        # inventory; never silently discard its stronger cold-verification guard.
        retained = validate_manifest_registry(base)
        policies = retained['policies']['candidate']
        if {path: source['files'][path] for path in source['files'] if registry_policy_path(path)} != {path: checksum for path, checksum in policies.items() if checksum is not None}:
            raise ValueError('Retained registry policy source checksum changed')
        policy_request = {'root': '/app', 'requests': retained['artifacts']['requests'], 'phase': 'after', 'policies': sorted(policies)}
        for image, builder in [(args.base_image, False), (args.builder, True)]:
            current = node_operation(image, REGISTRY_AUDIT_JS, policy_request, builder=builder)
            actual_policies = current['policies']
            if any((checksum is not None or builder or path.startswith(HARNESS + '/') or path == 'package.json') and checksum != retained['policies']['candidate'].get(path) for path, checksum in actual_policies.items()) or sha(canonical(current['lock']['graph'])) != retained['locks']['graphDigest']:
                raise ValueError('Retained registry policy/lock graph changed; a fresh/full audit is required')
        node_operation(args.base_image, REGISTRY_VERIFY_JS, {'root': '/app', 'phase': 'after', 'proof': retained})
        node_operation(args.builder, REGISTRY_VERIFY_JS, {'root': '/app', 'phase': 'after', 'proof': retained}, builder=True)
        reuse = copy_registry_binding(retained, args, source, plan, base)
    updates = workspace_updates(candidate['packages'], before['packages'], candidate['workspace'], reuse if proof_file else None)
    code_files = {path: info['sha256'] for path, info in candidate['files'].items()}
    if proof_file:
        # Retain the verified candidate harness lock, not just package.json. All
        # registry bytes remain inherited from the exact base, never copied.
        lock_path = HARNESS + '/pnpm-lock.yaml'
        base_files[lock_path] = reuse['locks']['baseSha256']
        code_files[lock_path] = reuse['locks']['candidateSha256']
        candidate['files'][lock_path] = {'sha256': code_files[lock_path], 'bytes': int(command(['docker', 'exec', args.builder, 'node', '-e', 'process.stdout.write(String(require("fs").statSync(process.argv[1]).size));', '/app/' + lock_path])), 'mode': 0o644}
    # The generic updater is public code; its checksum is covered like plugins.
    provisional = compute_delta(base_files, code_files, owned)
    noop = noop_report(base, {'baseImage': args.base_image, 'revision': args.revision, 'sourceDigest': source['sourceDigest']}, provisional)
    if noop:
        return noop
    update_document = {**updates, 'deleted': [{'path': n, 'sha256': base_files[n]} for n in provisional['deleted']]}
    if reuse:
        update_document['registryReuse'] = reuse
        for row in reuse['requests']:
            link = (row['from'] + '/' if row['from'] else '') + 'node_modules/' + row['name']
            if not any(item['link'] == link for item in update_document['links']):
                update_document['links'].append({'link': link, 'target': row['target'], 'registry': True, 'before': row['beforeLink']})
    generated = {'physicsos-runtime-update.cjs': UPDATE_JS.encode(), 'physicsos-runtime-update.json': (json.dumps(update_document, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode()}
    code_files.update({path: sha(data) for path, data in generated.items()})
    delta = compute_delta(base_files, code_files, owned)
    payload = sum(candidate['files'][n]['bytes'] for n in delta['changed'] if n in candidate['files']) + sum(len(data) for data in generated.values()) + 1024 * 1024
    output = pathlib.Path(args.output_dir)
    identity = {'format': 'physicsos-runtime-export/1', 'baseImage': args.base_image, 'revision': args.revision, 'sourceDigest': source['sourceDigest']}
    if output.exists():
        if output.is_symlink() or not (output / 'owner.json').is_file() or json.loads((output / 'owner.json').read_text()) != identity:
            raise ValueError('Runtime output directory is not owned by this frozen release')
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
    require_disk(output if output.exists() else output.parent, payload)
    output.mkdir(mode=0o700, exist_ok=True)
    if not (output / 'owner.json').exists():
        atomic_json(output / 'owner.json', identity)
    temporary = pathlib.Path(tempfile.mkdtemp(prefix='context-', dir=output))
    try:
        app = temporary / 'app'
        app.mkdir()
        copied = [n for n in delta['changed'] if n in candidate['files']]
        stream_copy(args.builder, copied, app, {n: code_files[n] for n in copied})
        for path, data in generated.items():
            if path in delta['changed']:
                (app / path).write_bytes(data)
        manifest = {'schemaVersion': 2, 'ownership': 'physicsos-runtime/2', 'baseImage': args.base_image, 'revision': args.revision, 'mainRevision': args.revision, 'sourceDigest': source['sourceDigest'], 'codeDigest': delta['codeDigest'], 'files': delta['files'], 'pluginTrust': {**trust, **candidate_signature}}
        if reuse:
            manifest.update({'registryReuse': reuse, 'registryReuseDigest': reuse['proofDigest']})
        manifest['teachingToolsBridge'] = teaching_tools_bridge_label(delta['files'])
        for name in METADATA:
            atomic_json(app / name, manifest)
        bridge = teaching_tools_bridge_label(delta['files'])
        dockerfile = '\n'.join(['ARG BASE_IMAGE=scratch', 'FROM ${BASE_IMAGE}', 'ARG REVISION', 'ARG SOURCE_DIGEST', 'ARG CODE_DIGEST', 'USER root', 'COPY --chown=999:999 app/ /app/', 'RUN node /app/physicsos-runtime-update.cjs', 'USER physicsos', 'LABEL org.opencontainers.image.revision=$REVISION', 'LABEL physicsos.source.digest=$SOURCE_DIGEST', 'LABEL physicsos.code.digest=$CODE_DIGEST', f'LABEL {TEACHING_TOOLS_LABEL}="{bridge}"', ''])
        (temporary / 'Dockerfile').write_text(dockerfile)
        context_hashes = {str(path.relative_to(temporary)): sha(path.read_bytes()) for path in temporary.rglob('*') if path.is_file()}
        record = {**identity, 'codeDigest': delta['codeDigest'], 'context': str(output / 'context'), 'contextHashes': context_hashes, 'changedFiles': delta['changed'], 'deletedFiles': delta['deleted'], 'baseExtraFiles': extra, 'managedFileCount': len(delta['files']), 'bytesExported': sum(path.stat().st_size for path in temporary.rglob('*') if path.is_file()), 'legacyFilesNormalized': base['legacyFileCount']}
        record['teachingToolsBridge'] = bridge
        if reuse:
            record['registryReuseDigest'] = reuse['proofDigest']
            record['registryRequests'] = len(reuse['requests'])
        verify_context(temporary, record)
        if (output / 'context').exists():
            shutil.rmtree(output / 'context')
        temporary.rename(output / 'context')
        atomic_json(output / 'export.json', record)
        return record
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def load_export(output):
    output = pathlib.Path(output)
    if output.is_symlink() or not (output / 'owner.json').is_file():
        raise ValueError('Runtime export directory is not tool-owned')
    record = json.loads((output / 'export.json').read_text())
    owner = json.loads((output / 'owner.json').read_text())
    if owner != {key: record[key] for key in ['format', 'baseImage', 'revision', 'sourceDigest']} or owner.get('format') != 'physicsos-runtime-export/1':
        raise ValueError('Runtime export ownership or frozen identity differs')
    context = output / 'context'
    if context.is_symlink() or context.resolve() != pathlib.Path(record['context']).resolve():
        raise ValueError('Unexpected runtime context directory')
    verify_context(context, record)
    modern = json.loads((context / 'app/physicsos-runtime-manifest.json').read_text())
    legacy = json.loads((context / 'app/canvas-source-manifest.json').read_text())
    if modern != legacy or modern.get('schemaVersion') != 2 or any(modern.get(key) != record[key] for key in ['baseImage', 'revision', 'sourceDigest', 'codeDigest']):
        raise ValueError('Combined runtime metadata or export identity differs')
    normalized = normalize_manifest(modern)
    validate_manifest_registry(normalized, record)
    return output, context, record, normalized


def verify_image(image, expected=None):
    metadata = image_metadata(image)
    exact = metadata['id']
    if not IMAGE_ID.fullmatch(exact):
        raise ValueError('Invalid cold-verification image identity')
    metadata_digest = (metadata.get('labels') or {}).get('physicsos.manifest.digest')
    if metadata_digest:
        proof_script = "const f=require('fs'),c=require('crypto');const a='/app/physicsos-runtime-manifest.json',b='/app/canvas-source-manifest.json';for(const p of[a,b])if(!f.lstatSync(p).isFile())throw Error('Manifest alias is not a regular file');const x=f.readFileSync(a),y=f.readFileSync(b);if(!x.equals(y))throw Error('Manifest aliases differ');console.log(JSON.stringify({sha256:c.createHash('sha256').update(x).digest('hex')}));"
        if node_operation(exact, proof_script).get('sha256') != metadata_digest:
            raise ValueError('Cold runtime manifest byte digest changed')
    manifest = read_base_manifest(exact)
    if manifest['originSchema'] == 2:
        validate_image_labels(metadata, expected or manifest)
    elif expected:
        raise ValueError('Candidate is still using legacy runtime ownership metadata')
    checks = node_operation(exact, VERIFY_JS, manifest['files'])
    if checks.get('failures') or checks.get('checked') != len(manifest['files']):
        raise ValueError('Cold runtime file verification failed')
    trust = {key: manifest['pluginTrust'][key] for key in ['manifestPath', 'publicKeyPath']}
    trust['entryRoot'] = manifest['pluginTrust'].get('entryRoot', HARNESS)
    proof = node_operation(exact, SIGNATURE_JS, {'root': '/app', **trust})
    if manifest['pluginTrust'].get('publicKeySha256') and proof['publicKeySha256'] != manifest['pluginTrust']['publicKeySha256']:
        raise ValueError('Cold runtime signing trust root differs')
    reuse = validate_manifest_registry(manifest, expected)
    if reuse:
        if not metadata_digest:
            raise ValueError('Cold registry reuse manifest byte label is absent')
        registry_check = node_operation(exact, REGISTRY_VERIFY_JS, {'root': '/app', 'phase': 'after', 'proof': reuse})
        if registry_check.get('checkedRequests') != len(reuse['requests']) or registry_check.get('artifactDigest') != reuse['artifactDigest']:
            raise ValueError('Cold registry entry/link/absence/content verification failed')
    filesystem_digest = manifest.get('filesystemDigest')
    labels = metadata.get('labels') or {}
    if filesystem_digest or labels.get('physicsos.filesystem.digest'):
        t = transport_module()
        expected_fs = manifest.get('filesystem')
        if not expected_fs or sha(canonical(expected_fs)) != filesystem_digest or labels.get('physicsos.filesystem.digest') != filesystem_digest:
            raise ValueError('Complete cold filesystem proof missing or changed')
        t.validate_tree(expected_fs['entries'])
        if full_filesystem(exact, {'ignore': t.METADATA}) != expected_fs:
            raise ValueError('Cold image files, modes, owners or symlinks differ from the audited full builder')
        if sha(canonical(t.runtime_config(image_config(exact)))) != manifest.get('runtimeConfigDigest') or labels.get('physicsos.runtime-config.digest') != manifest.get('runtimeConfigDigest'):
            raise ValueError('Cold runtime configuration proof changed')
    if manifest.get('systemFSdigest') or labels.get('physicsos.system-fs.digest'):
        t = transport_module()
        expected_system = manifest.get('systemFilesystem')
        if not expected_system or sha(canonical(expected_system)) != manifest.get('systemFSdigest') or labels.get('physicsos.system-fs.digest') != manifest.get('systemFSdigest'):
            raise ValueError('Complete cold system filesystem proof missing or changed')
        t.require_same_system_fs(t.system_filesystem(exact), expected_system)
    return {'verified': True, 'image': exact, 'revision': manifest['revision'], 'sourceDigest': manifest['sourceDigest'], 'codeDigest': manifest['codeDigest'], 'checkedFiles': checks['checked'], 'signedPluginEntries': proof['entries'], 'network': 'none', 'readOnly': True, **{key: manifest[key] for key in ['filesystemDigest', 'runtimeConfigDigest', 'systemFSdigest'] if key in manifest}}


def build_runtime(args):
    output, context, record, manifest = load_export(args.output_dir)
    if not IMAGE_ID.fullmatch(record['baseImage']) or image_metadata(record['baseImage'])['id'] != record['baseImage']:
        raise ValueError('Immutable local runtime base changed or disappeared')
    base = read_base_manifest(record['baseImage'])
    reuse = validate_manifest_registry(manifest, record)
    if reuse:
        if registry_base_identity(record['baseImage'], base) != reuse['base']:
            raise ValueError('Runtime registry base identity changed after export')
        node_operation(record['baseImage'], REGISTRY_VERIFY_JS, {'root': '/app', 'phase': 'before', 'proof': reuse})
    base_files = {**base['files'], **record.get('baseExtraFiles', {})}
    for path, checksum in manifest['files'].items():
        local = context / 'app' / path
        if local.is_file():
            if sha(local.read_bytes()) != checksum:
                raise ValueError('Copied runtime artifact differs from combined manifest')
        elif base_files.get(path) != checksum:
            raise ValueError('Retained runtime artifact differs from the exact base')
    if not re.fullmatch(r'physicsos:[A-Za-z0-9][A-Za-z0-9_.-]*', args.image_tag):
        raise ValueError('Explicit PhysicsOS candidate image tag required')
    payload = record['bytesExported'] + len(record['deletedFiles']) * 4096 + 16 * 1024 * 1024
    require_disk(output, payload, args.reserve_bytes)
    docker_root = command(['docker', 'info', '--format', '{{.DockerRootDir}}'])
    try:
        require_disk(docker_root, payload, args.reserve_bytes)
    except FileNotFoundError:
        # Probe the real Docker backing filesystem without mounting its data.
        stats = node_operation(record['baseImage'], "const s=require('fs').statfsSync('/');console.log(JSON.stringify({freeBytes:Number(s.bavail)*Number(s.bsize),freeInodes:Number(s.ffree)}));")
        assert_disk_budget(stats, payload, args.reserve_bytes)
    base_tag = args.base_tag or 'physicsos:runtime-base-' + record['baseImage'][7:31]
    if not re.fullmatch(r'physicsos:[A-Za-z0-9][A-Za-z0-9_.-]*', base_tag):
        raise ValueError('Unsafe verified local base tag')
    if args.base_tag:
        if image_metadata(base_tag)['id'] != record['baseImage']:
            raise ValueError('Provided base tag differs from the immutable base image')
    else:
        command(['docker', 'tag', record['baseImage'], base_tag])
    # Candidate tags can be reused without dropping their previous image identity.
    previous = subprocess.run(['docker', 'image', 'inspect', '--format', '{{.Id}}', args.image_tag], capture_output=True, text=True)
    if previous.returncode == 0:
        previous_id = previous.stdout.strip()
        if not IMAGE_ID.fullmatch(previous_id):
            raise ValueError('Existing candidate image identity is invalid')
        command(['docker', 'tag', previous_id, 'physicsos:retained-' + previous_id[7:]])
    manifest_digest = record.get('contextHashes', {}).get('app/physicsos-runtime-manifest.json', '')
    if not HEX64.fullmatch(manifest_digest):
        raise ValueError('Verified runtime manifest byte digest is required')
    started = time.monotonic()
    command(['docker', 'build', '--label', 'physicsos.manifest.digest=' + manifest_digest, '--network=none', '--pull=false', '--progress=plain', '--build-arg', 'BASE_IMAGE=' + base_tag, '--build-arg', 'REVISION=' + record['revision'], '--build-arg', 'SOURCE_DIGEST=' + record['sourceDigest'], '--build-arg', 'CODE_DIGEST=' + record['codeDigest'], '--tag', args.image_tag, str(context)], log=True)
    metadata = image_metadata(args.image_tag)
    validate_image_labels(metadata, record)
    proof = verify_image(metadata['id'], record)
    result = {**proof, 'baseImage': record['baseImage'], 'baseTag': base_tag, 'imageTag': args.image_tag, 'bytesExported': record['bytesExported'], 'changedFiles': len(record['changedFiles']), 'deletedFiles': len(record['deletedFiles']), 'elapsedSeconds': round(time.monotonic() - started, 2)}
    atomic_json(output / 'build.json', result)
    return result



FULL_EXACT = ['package.json', 'scripts/healthcheck.mjs', 'scripts/docker-entrypoint.mjs',
              'scripts/deploy/wait-for-ready.mjs', 'scripts/deploy/migrate-json-postgres.mjs',
              'overlays/harness/files/packages/physicsos/health-host/deployment.patch.yml']


def full_inventory_request():
    # These are exactly the roots copied by the reviewed Dockerfile. Registry
    # dependencies are installed by that full build, never delta-adopted.
    return {'root': '/app', 'selections': [
        {'root': 'packages', 'mode': 'files', 'items': ['.']},
        {'root': HARNESS, 'mode': 'files', 'items': ['.']},
    ], 'exact': FULL_EXACT, 'required': FULL_EXACT + [
        HARNESS + '/apps/web/dist/index.html', HARNESS + '/apps/cli/lib/bin.js',
        DEFAULT_TRUST['manifestPath'], DEFAULT_TRUST['publicKeyPath']]}


def validate_full_record(source, marker, receipt, record, image):
    files = source.get('files', {})
    revision, source_digest = source.get('revision'), source.get('sourceDigest')
    if not HEX40.fullmatch(revision or '') or not HEX64.fullmatch(source_digest or '') or not HEX64.fullmatch(source.get('dependencyFingerprint', '')) or sha(canonical(files)) != source_digest:
        raise ValueError('Invalid full-build source freeze')
    if record.get('format') != 'physicsos-full-build/1' or record.get('schemaVersion') != 1 or record.get('successfulStages') != ['builder', 'runtime'] or record.get('sourceProjectionVerified') is not True:
        raise ValueError('Successful frozen full builder/runtime evidence is required')
    for value in [marker, receipt, record]:
        if value.get('sourceDigest') != source_digest or value.get('dependencyFingerprint') != source.get('dependencyFingerprint'):
            raise ValueError('Full-build source/dependency evidence differs')
    if marker.get('files') != files or marker.get('revision') != revision or record.get('revision') != revision:
        raise ValueError('Full-build source marker differs')
    target_build = receipt.get('origin') == 'docker-builder-target' and receipt.get('buildTarget') == 'builder'
    seed_build = receipt.get('origin') == 'audited-runtime-seed' and receipt.get('buildTarget') == 'audited-seed-full-build'
    if seed_build:
        evidence = receipt.get('fullBuildEvidence') or []
        offline = receipt.get('offlineEvidence') or []
        if receipt.get('audited') is not True or receipt.get('offlineRootLockVerified') is not True or receipt.get('offlineHarnessLockVerified') is not True or len(offline) < 2 or any(row.get('exitCode') != 0 or '--offline' not in row.get('command', '') or '--frozen-lockfile' not in row.get('command', '') for row in offline) or not {'/app', '/app/vendor/deepseek-harness'}.issubset({row.get('cwd') for row in offline}):
            raise ValueError('Audited offline frozen seed evidence is incomplete')
        if [row.get('command') for row in evidence] != ['pnpm run build:lib', 'pnpm run build:web'] or any(row.get('exitCode') != 0 for row in evidence):
            raise ValueError('Seed must run both complete build stages successfully')
        if record.get('runtimeTransport') == 'verified-overlay':
            if record.get('transportBaseImage') != receipt.get('seedImage') or not IMAGE_ID.fullmatch(record.get('runtimeConfigImage', '')) or any(not HEX64.fullmatch(record.get(key, '')) for key in ['filesystemDigest', 'runtimeConfigDigest', 'systemFSdigest', 'configOnlyDockerfileSha256']):
                raise ValueError('Complete verified filesystem/config transport evidence is required')
        elif not IMAGE_ID.fullmatch(record.get('builderSnapshot', '')):
            raise ValueError('Reviewed runtime stage and immutable seed snapshot evidence are required')
        if record.get('seedReceiptOrigin') != 'audited-runtime-seed' or receipt.get('seedImage') != record.get('builderImage') or any(not HEX64.fullmatch(record.get(key, '')) for key in ['runtimeStageSha256', 'runtimeDockerfileSha256']):
            raise ValueError('Reviewed full seed runtime evidence differs')
    if receipt.get('fullBuildVerified') is not True or not (target_build or seed_build):
        raise ValueError('A reviewed complete Docker builder target or audited full seed build is required')
    if any(receipt.get(key) is not True for key in ['completeDevelopmentDependencies', 'lockedDependenciesVerified', 'sourceProjectionVerified', 'nativeProbeVerified', 'sharedDeclarationBoundaryVerified']):
        raise ValueError('Full development builder evidence is incomplete')
    abi = receipt.get('abi') or {}
    if abi.get('platform') != 'linux' or not abi.get('node') or not abi.get('modules') or not abi.get('arch') or abi.get('libc') not in ['glibc', 'musl']:
        raise ValueError('Full development builder ABI evidence is incomplete')
    if not {'typescript', 'tsdown', 'vite', 'vitest', 'tsx'}.issubset(set(receipt.get('toolsVerified') or [])):
        raise ValueError('Full development build tools were not verified')
    if record.get('dockerfileSha256') != files.get('Dockerfile') or not HEX64.fullmatch(record.get('dockerfileSha256', '')):
        raise ValueError('Full-build Dockerfile differs from frozen source')
    for key in ['builderImage', 'nodeImage', 'runtimeImage']:
        if not IMAGE_ID.fullmatch(record.get(key, '')):
            raise ValueError('Full-build immutable image identity is required')
    if record['builderImage'] != receipt.get('builderImage') or record['nodeImage'] != receipt.get('baseImage') or record['runtimeImage'] != image.get('id'):
        raise ValueError('Full-build image evidence differs')
    labels = image.get('labels') or {}
    expected = {'physicsos.role': 'full-runtime-input', 'physicsos.full-build.revision': revision,
                'physicsos.full-build.source-digest': source_digest,
                'physicsos.full-build.dependency-fingerprint': source['dependencyFingerprint']}
    if any(labels.get(key) != value for key, value in expected.items()):
        raise ValueError('Full-runtime input does not belong to this frozen build')
    return record


def full_manifest(source, record, builder_inventory, runtime_inventory, proof):
    before, actual = builder_inventory.get('files', {}), runtime_inventory.get('files', {})
    expected_files = {name: value['sha256'] for name, value in before.items()}
    actual_files = {name: value['sha256'] for name, value in actual.items()}
    if not expected_files or expected_files != actual_files:
        raise ValueError('Full runtime differs from the verified development builder')
    for name, checksum in actual_files.items():
        safe_code_path(name)
        if name in source['files'] and checksum != source['files'][name]:
            raise ValueError('Runtime source differs from the reviewed source freeze')
    for name in full_inventory_request()['required']:
        if name not in actual_files:
            raise ValueError('Required full runtime artifact is absent')
    if not proof.get('verified') or proof.get('entries', 0) < 1 or proof.get('publicKeySha256') != source['files'].get(DEFAULT_TRUST['publicKeyPath']):
        raise ValueError('Plugin trust is not pinned by the reviewed full source')
    files = dict(sorted(actual_files.items()))
    return {'schemaVersion': 2, 'ownership': 'physicsos-runtime/2', 'revision': source['revision'],
            'sourceDigest': source['sourceDigest'], 'codeDigest': sha(canonical(files)), 'files': files,
            'pluginTrust': {**DEFAULT_TRUST, **proof}, 'buildProvenance': record}


def export_full_runtime(args):
    check_builder(args.builder)
    source = json.loads(pathlib.Path(args.source_manifest).read_text())
    record = json.loads(pathlib.Path(args.record_file).read_text())
    image = image_metadata(args.image)
    if image['id'] != args.image or not IMAGE_ID.fullmatch(args.image):
        raise ValueError('An exact immutable full-runtime image is required')
    marker = read_builder_json(args.builder, 'physicsos-source-manifest.json')
    receipt = read_builder_json(args.builder, 'physicsos-development-builder.json')
    validate_full_record(source, marker, receipt, record, image)
    frozen_dockerfile = pathlib.Path(args.source_manifest).parent / 'source/Dockerfile'
    dockerfile_source = frozen_dockerfile.read_text()
    if sha(dockerfile_source) != source['files']['Dockerfile']:
        raise ValueError('Reviewed source Dockerfile changed')
    if record.get('seedReceiptOrigin'):
        stages = list(re.finditer(r'^FROM \$\{NODE_IMAGE\} AS runtime\r?$', dockerfile_source, re.M))
        if len(stages) != 1:
            raise ValueError('Expected one reviewed runtime stage')
        stage = dockerfile_source[stages[0].start():]
        derived = 'ARG NODE_IMAGE\nARG BUILDER_IMAGE\nFROM ${BUILDER_IMAGE} AS builder\n\n' + stage
        if record.get('runtimeTransport') == 'verified-overlay':
            layout = transport_module().config_only_dockerfile(dockerfile_source)
            if sha(stage) != record['runtimeStageSha256'] or sha(layout['dockerfile']) != record['configOnlyDockerfileSha256']:
                raise ValueError('Reviewed config-only runtime stage changed')
        elif sha(stage) != record['runtimeStageSha256'] or sha(derived) != record['runtimeDockerfileSha256'] or image_metadata(record['builderSnapshot'])['id'] != record['builderSnapshot']:
            raise ValueError('Seed runtime stage or builder snapshot changed')
    actual_builder = json.loads(command(['docker', 'inspect', '--format', '{{json .Image}}', args.builder]))
    if actual_builder != record['builderImage'] or record.get('builder') != args.builder:
        raise ValueError('Full builder container identity changed')
    # ABI and the native lock are re-probed; no old image is a trust root.
    abi_script = 'const h=process.report.getReport().header;console.log(JSON.stringify({node:process.versions.node,modules:process.versions.modules,platform:process.platform,arch:process.arch,libc:h.glibcVersionRuntime?"glibc":"musl"}));'
    runtime_abi = node_operation(args.image, abi_script)
    builder_abi = node_operation(args.builder, abi_script, builder=True)
    if runtime_abi != receipt.get('abi') or builder_abi != receipt.get('abi'):
        raise ValueError('Full runtime or builder ABI differs from the verified build')
    native = 'const f=require("fs/promises");(async()=>{const {tryLockExclusive}=await import("/app/vendor/deepseek-harness/native/system/packages/entry/lib/flock.js");const p="/tmp/full-native-"+process.pid,h=await f.open(p,"w");try{await tryLockExclusive(h.fd)}finally{await h.close();await f.unlink(p)};console.log(JSON.stringify({verified:true}))})();'
    command(['docker', 'exec', args.builder, 'node', '-e', native])
    signature = {'root': '/app', **DEFAULT_TRUST}
    builder_proof = node_operation(args.builder, SIGNATURE_JS, signature, builder=True)
    runtime_proof = node_operation(args.image, SIGNATURE_JS, signature)
    validate_signature_proofs(builder_proof, runtime_proof)
    if record.get('runtimeTransport') == 'verified-overlay':
        # The legacy code map cannot represent links or dependencies. Derive
        # its compatible regular-file subset from the stronger complete scan;
        # all entries, including omitted links/modes, are attested below.
        t = transport_module()
        layout = t.config_only_dockerfile(dockerfile_source)
        approved = full_filesystem(record['runtimeConfigImage'], {'owner': True})
        normalized = t.desired_runtime_tree(full_filesystem(args.builder, {'paths': layout['copies']}, builder=True), approved)
        actual_full = full_filesystem(args.image, {})
        if normalized != actual_full:
            raise ValueError('Complete raw filesystem differs before manifest export')
        regular = {}
        for name, item in normalized['entries'].items():
            if item['type'] != 'file':
                continue
            try: safe_code_path(name)
            except ValueError: continue
            regular[name] = item
        built = runtime = {'files': regular}
    else:
        request = full_inventory_request()
        built = node_operation(args.builder, INVENTORY_JS, request, builder=True)
        runtime = node_operation(args.image, INVENTORY_JS, request)
    manifest = full_manifest(source, record, built, runtime, runtime_proof)
    if record.get('runtimeTransport') == 'verified-overlay':
        t = transport_module()
        layout = t.config_only_dockerfile(dockerfile_source)
        config_image = record['runtimeConfigImage']
        labels = image_metadata(config_image).get('labels') or {}
        if labels.get('physicsos.role') != 'runtime-config-proof' or labels.get('physicsos.full-build.source-digest') != source['sourceDigest']:
            raise ValueError('Config-only runtime proof ownership changed')
        config_digest = t.require_same_config(image_config(args.image), image_config(config_image))
        approved = full_filesystem(config_image, {'owner': True})
        desired = normalized
        actual = actual_full
        if actual != desired or sha(canonical(desired)) != record['filesystemDigest'] or config_digest != record['runtimeConfigDigest']:
            raise ValueError('Full raw runtime filesystem/config differs from the audited builder')
        for name, item in desired['entries'].items():
            if name in source['files'] and (item['type'] == 'file' and item['sha256'] != source['files'][name] or item['type'] == 'symlink' and sha(item['target']) != source['files'][name]):
                raise ValueError('Complete filesystem source differs from the frozen commit')
        system_expected = t.system_filesystem(config_image)
        system_digest = t.require_same_system_fs(t.system_filesystem(args.image), system_expected)
        if system_digest != record['systemFSdigest']:
            raise ValueError('Full system filesystem changed after transport')
        manifest.update({'filesystem': desired, 'filesystemDigest': record['filesystemDigest'], 'runtimeConfigDigest': config_digest,
                         'systemFilesystem': system_expected, 'systemFSdigest': system_digest})
    output = pathlib.Path(args.output_dir)
    owner = {'format': 'physicsos-full-runtime-export/1', 'baseImage': args.image,
             'revision': source['revision'], 'sourceDigest': source['sourceDigest']}
    if output.exists() and (output.is_symlink() or not (output / 'owner.json').is_file() or json.loads((output / 'owner.json').read_text()) != owner):
        raise ValueError('Full-runtime output is not owned by this release')
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = len(canonical(manifest).encode()) * 3 + 1024 * 1024
    require_disk(output.parent, payload)
    output.mkdir(mode=0o700, exist_ok=True)
    atomic_json(output / 'owner.json', owner)
    context = output / 'context'
    context.mkdir(mode=0o700, exist_ok=True)
    manifest['teachingToolsBridge'] = teaching_tools_bridge_label(manifest['files'])
    atomic_json(context / 'physicsos-runtime-manifest.json', manifest)
    atomic_json(context / 'canvas-source-manifest.json', manifest)
    dockerfile = '\n'.join(['ARG BASE_IMAGE=scratch', 'FROM ${BASE_IMAGE}', 'ARG REVISION', 'ARG SOURCE_DIGEST', 'ARG CODE_DIGEST',
                          'USER root', 'COPY --chown=999:999 physicsos-runtime-manifest.json canvas-source-manifest.json /app/',
                          'USER physicsos', 'LABEL org.opencontainers.image.revision=$REVISION',
                          'LABEL physicsos.source.digest=$SOURCE_DIGEST', 'LABEL physicsos.code.digest=$CODE_DIGEST',
                          'LABEL physicsos.role=verified-full-runtime', ''])
    bridge = teaching_tools_bridge_label(manifest['files'])
    dockerfile += f'LABEL {TEACHING_TOOLS_LABEL}="{bridge}"\n'
    if manifest.get('filesystemDigest'):
        dockerfile += 'ARG FILESYSTEM_DIGEST\nARG RUNTIME_CONFIG_DIGEST\nLABEL physicsos.filesystem.digest=$FILESYSTEM_DIGEST\nLABEL physicsos.runtime-config.digest=$RUNTIME_CONFIG_DIGEST\n'
    if manifest.get('systemFSdigest'):
        dockerfile += 'ARG SYSTEM_FS_DIGEST\nLABEL physicsos.system-fs.digest=$SYSTEM_FS_DIGEST\n'
    dockerfile += 'ARG MANIFEST_DIGEST\nLABEL physicsos.manifest.digest=$MANIFEST_DIGEST\n'
    (context / 'Dockerfile').write_text(dockerfile)
    result = {**owner, **{key: manifest[key] for key in ['filesystemDigest', 'runtimeConfigDigest', 'systemFSdigest'] if key in manifest}, 'codeDigest': manifest['codeDigest'], 'checkedFiles': len(manifest['files']),
              'manifestSha256': sha((context / 'physicsos-runtime-manifest.json').read_bytes()),
              'dockerfileSha256': sha(dockerfile), 'context': str(context.resolve()), 'teachingToolsBridge': bridge}
    atomic_json(output / 'export.json', result)
    return result


def build_full_runtime(args):
    output = pathlib.Path(args.output_dir)
    record = json.loads((output / 'export.json').read_text())
    owner = json.loads((output / 'owner.json').read_text())
    if record.get('format') != 'physicsos-full-runtime-export/1' or any(record.get(key) != owner.get(key) for key in owner):
        raise ValueError('Full-runtime export ownership differs')
    context = output / 'context'
    if context.is_symlink() or context.resolve() != pathlib.Path(record['context']):
        raise ValueError('Full-runtime export context changed')
    manifest_path = context / 'physicsos-runtime-manifest.json'
    manifest = json.loads(manifest_path.read_text())
    if sha(manifest_path.read_bytes()) != record['manifestSha256'] or sha((context / 'Dockerfile').read_bytes()) != record['dockerfileSha256']:
        raise ValueError('Full-runtime export content changed')
    if json.loads((context / 'canvas-source-manifest.json').read_text()) != manifest:
        raise ValueError('Runtime manifest aliases differ')
    normalize_manifest(manifest)
    if any(manifest.get(key) != record.get(key) for key in ['revision', 'sourceDigest', 'codeDigest']):
        raise ValueError('Full-runtime manifest identity differs')
    base = image_metadata(record['baseImage'])
    if base['id'] != record['baseImage']:
        raise ValueError('Immutable full-runtime input changed')
    proof = manifest['buildProvenance']
    if proof['runtimeImage'] != base['id'] or (base.get('labels') or {}).get('physicsos.full-build.source-digest') != record['sourceDigest']:
        raise ValueError('Full-runtime base no longer matches the audited build')
    checks = node_operation(base['id'], VERIFY_JS, manifest['files'])
    if checks.get('failures') or checks.get('checked') != len(manifest['files']):
        raise ValueError('Full-runtime base changed after export')
    require_disk(output, manifest_path.stat().st_size * 3 + 1024 * 1024)
    if not re.fullmatch(r'physicsos[a-z0-9_.-]*:[A-Za-z0-9_.-]+', args.image_tag):
        raise ValueError('Owned PhysicsOS image tag required')
    base_tag = 'physicsos:full-runtime-base-' + base['id'][7:31]
    command(['docker', 'tag', base['id'], base_tag])
    build_args = ['docker', 'build', '--network=none', '--pull=false', '--build-arg', 'BASE_IMAGE=' + base_tag,
                  '--build-arg', 'REVISION=' + record['revision'], '--build-arg', 'SOURCE_DIGEST=' + record['sourceDigest'],
                  '--build-arg', 'CODE_DIGEST=' + record['codeDigest']]
    build_args.extend(['--build-arg', 'MANIFEST_DIGEST=' + record['manifestSha256']])
    if record.get('systemFSdigest'):
        build_args.extend(['--build-arg', 'SYSTEM_FS_DIGEST=' + record['systemFSdigest']])
    if record.get('filesystemDigest'):
        build_args.extend(['--build-arg', 'FILESYSTEM_DIGEST=' + record['filesystemDigest'], '--build-arg', 'RUNTIME_CONFIG_DIGEST=' + record['runtimeConfigDigest']])
    command([*build_args, '--tag', args.image_tag, str(context)], log=True)
    exact = image_metadata(args.image_tag)['id']
    verified = verify_image(exact, record)
    result = {**verified, 'imageTag': args.image_tag, 'baseImage': base['id'], 'fullBuild': True,
              'sourceDigest': record['sourceDigest'], 'codeDigest': record['codeDigest']}
    atomic_json(output / 'build.json', result)
    return result


_TRANSPORT = None


def transport_module():
    global _TRANSPORT
    if _TRANSPORT is None:
        spec = importlib.util.spec_from_file_location('physicsos_runtime_transport', pathlib.Path(__file__).with_name('runtime_transport.py'))
        _TRANSPORT = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_TRANSPORT)
    return _TRANSPORT


def image_config(image):
    return json.loads(command(['docker', 'image', 'inspect', '--format', '{{json .Config}}', image]))


def full_filesystem(image_or_builder, request, builder=False):
    # Read-only root scanning verifies restrictive file modes without changing
    # them. COPY owner discovery uses the reviewed image's actual non-root USER.
    script = transport_module().FS_JS
    if builder:
        args = ['docker', 'exec', '-i', '-u', '0', image_or_builder, 'node', '-e', script]
    else:
        args = ['docker', 'run', '--rm', '-i', '--network', 'none', '--read-only']
        if not request.get('owner'):
            args.extend(['--user', '0'])
        args.extend(['--entrypoint', 'node', image_or_builder, '-e', script])
    return json.loads(command(args, request))


def transport_layout(source_manifest):
    source = json.loads(pathlib.Path(source_manifest).read_text())
    file = pathlib.Path(source_manifest).parent / 'source/Dockerfile'
    contents = file.read_text()
    if sha(contents) != source['files']['Dockerfile']:
        raise ValueError('Transport Dockerfile changed from reviewed freeze')
    return source, transport_module().config_only_dockerfile(contents)


def build_transport_config(args):
    source, layout = transport_layout(args.source_manifest)
    if args.image_tag != 'physicsos:runtime-config-' + source['revision'][:16]:
        raise ValueError('Owned frozen config image tag required')
    if not IMAGE_ID.fullmatch(args.node_image) or image_metadata(args.node_image)['id'] != args.node_image:
        raise ValueError('Immutable local Node base required')
    output = pathlib.Path(args.output_dir)
    if output.exists():
        raise ValueError('Config-only output must be a new task-owned path')
    output.mkdir(parents=True, mode=0o700)
    (output / 'Dockerfile').write_text(layout['dockerfile'])
    tag = 'physicsos:config-node-' + args.node_image[7:31]
    command(['docker', 'tag', args.node_image, tag])
    command(['docker', 'build', '--target', 'runtime', '--pull=false', '--build-arg', 'NODE_IMAGE=' + tag,
             '--label', 'physicsos.role=runtime-config-proof', '--label', 'physicsos.full-build.source-digest=' + source['sourceDigest'],
             '--tag', args.image_tag, str(output)], log=True)
    exact = image_metadata(args.image_tag)['id']
    t = transport_module()
    scan = full_filesystem(exact, {'owner': True})
    if scan['entries'] or image_config(exact).get('User') != 'physicsos':
        raise ValueError('Config-only image does not define the closed empty non-root application')
    result = {'image': exact, 'nodeImage': args.node_image, 'sourceDigest': source['sourceDigest'],
              'dockerfileSha256': source['files']['Dockerfile'], 'runtimeStageSha256': sha(layout['stage']),
              'configOnlyDockerfileSha256': sha(layout['dockerfile'])}
    atomic_json(output / 'config-proof.json', result)
    return result


def build_verified_transport(args):
    t = transport_module()
    source, layout = transport_layout(args.source_manifest)
    if args.image_tag != 'physicsos:full-input-' + source['revision'][:16]:
        raise ValueError('Owned frozen transport image tag required')
    check_builder(args.builder)
    receipt = read_builder_json(args.builder, 'physicsos-development-builder.json')
    marker = read_builder_json(args.builder, 'physicsos-source-manifest.json')
    # This is a full-build transport; a seed receipt without the real full
    # compilation evidence never authorizes a patch image.
    if receipt.get('origin') != 'audited-runtime-seed' or receipt.get('buildTarget') != 'audited-seed-full-build' or receipt.get('fullBuildVerified') is not True or receipt.get('seedImage') != args.base_image:
        raise ValueError('Completed audited full seed build is required for verified transport')
    if marker.get('files') != source['files'] or marker.get('sourceDigest') != source['sourceDigest'] or receipt.get('sourceDigest') != source['sourceDigest']:
        raise ValueError('Transport source freeze differs from audited builder')
    evidence = receipt.get('fullBuildEvidence') or []
    if [step.get('command') for step in evidence] != ['pnpm run build:lib', 'pnpm run build:web'] or any(step.get('exitCode') != 0 for step in evidence):
        raise ValueError('Complete full seed compilation evidence missing')
    actual_builder = json.loads(command(['docker', 'inspect', '--format', '{{json .Image}}', args.builder]))
    if actual_builder != args.base_image or image_metadata(args.base_image)['id'] != args.base_image or image_metadata(args.config_image)['id'] != args.config_image:
        raise ValueError('Immutable transport identities changed')
    config = image_config(args.config_image)
    config_digest = t.require_same_config(image_config(args.base_image), config)
    system_expected = t.system_filesystem(args.config_image)
    system_digest = t.require_same_system_fs(t.system_filesystem(args.base_image), system_expected)
    node_operation(args.base_image, "const f=require('fs');if(f.existsSync('/run/physicsos-full-transport'))throw Error('Transport staging path already exists in base');console.log(JSON.stringify({verified:true}));")
    proof_labels = image_metadata(args.config_image).get('labels') or {}
    if proof_labels.get('physicsos.role') != 'runtime-config-proof' or proof_labels.get('physicsos.full-build.source-digest') != source['sourceDigest']:
        raise ValueError('Config proof does not belong to this freeze')
    approved = full_filesystem(args.config_image, {'owner': True})
    desired = t.desired_runtime_tree(full_filesystem(args.builder, {'paths': layout['copies']}, builder=True), approved)
    before = full_filesystem(args.base_image, {})
    t.validate_tree(before['entries'])
    if before['root'] != desired['root']:
        raise ValueError('Transport application root differs from reviewed config')
    changed = sorted(name for name, item in desired['entries'].items() if before['entries'].get(name) != item)
    output = pathlib.Path(args.output_dir)
    if output.exists():
        raise ValueError('Transport output must be a new task-owned path')
    estimate = sum(desired['entries'][name].get('bytes', 0) for name in changed) + len(canonical({'before': before, 'after': desired}).encode()) + 1024 * 1024
    output.parent.mkdir(parents=True, exist_ok=True)
    require_disk(output.parent, estimate)
    output.mkdir(parents=True, mode=0o700)
    context = output / 'context'; context.mkdir(mode=0o700)
    stage = context / 'transport'; stage.mkdir(mode=0o700)
    payload_bytes = t.write_payload(args.builder, changed, desired['entries'], stage / 'payload')
    atomic_json(stage / 'plan.json', {'before': before, 'after': desired, 'changed': changed})
    (stage / 'apply.cjs').write_text(t.APPLY_JS)
    dockerfile = '\n'.join(['ARG BASE_IMAGE', 'FROM ${BASE_IMAGE}', 'USER root',
                            'COPY transport/ /run/physicsos-full-transport/',
                            'RUN node /run/physicsos-full-transport/apply.cjs && rm -rf /run/physicsos-full-transport',
                            'USER physicsos', ''])
    (context / 'Dockerfile').write_text(dockerfile)
    base_tag = 'physicsos:verified-transport-base-' + args.base_image[7:31]
    command(['docker', 'tag', args.base_image, base_tag])
    command(['docker', 'build', '--network=none', '--pull=false', '--build-arg', 'BASE_IMAGE=' + base_tag,
             '--label', 'physicsos.role=full-runtime-input', '--label', 'physicsos.full-build.revision=' + source['revision'],
             '--label', 'physicsos.full-build.source-digest=' + source['sourceDigest'],
             '--label', 'physicsos.full-build.dependency-fingerprint=' + source['dependencyFingerprint'],
             '--tag', args.image_tag, str(context)], log=True)
    exact = image_metadata(args.image_tag)['id']
    t.require_same_config(image_config(exact), config)
    t.require_same_system_fs(t.system_filesystem(exact), system_expected)
    after = full_filesystem(exact, {})
    if after != desired:
        raise ValueError('Cold raw transport image differs from the complete audited builder filesystem')
    result = {'image': exact, 'transportBaseImage': args.base_image, 'runtimeConfigImage': args.config_image,
              'runtimeConfigDigest': config_digest, 'filesystemDigest': sha(canonical(desired)), 'systemFSdigest': system_digest,
              'runtimeStageSha256': sha(layout['stage']), 'runtimeDockerfileSha256': sha(dockerfile),
              'configOnlyDockerfileSha256': sha(layout['dockerfile']), 'payloadBytes': payload_bytes,
              'changedEntries': len(changed), 'filesystemEntries': len(desired['entries']), 'payloadEstimateBytes': estimate}
    atomic_json(output / 'transport-proof.json', result)
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    export = commands.add_parser('export')
    for name in ['builder', 'base-image', 'revision', 'source-manifest', 'plan-file', 'output-dir']:
        export.add_argument('--' + name, required=True)
    export.add_argument('--registry-reuse-proof', help='Opt in to freshly reverified ADD-only base registry artifacts')
    export.add_argument('--baseline-source-manifest', help='Frozen source attestation bound to the exact base image')
    audit = commands.add_parser('audit-registry', help='Read-only physical/lock audit; write a checksum-bound public metadata proof')
    for name in ['builder', 'base-image', 'revision', 'source-manifest', 'baseline-source-manifest', 'plan-file', 'proof-file']:
        audit.add_argument('--' + name, required=True)
    build = commands.add_parser('build')
    build.add_argument('--output-dir', required=True)
    build.add_argument('--image-tag', required=True)
    build.add_argument('--base-tag')
    build.add_argument('--reserve-bytes', type=int, default=256 * 1024 * 1024)
    full_export = commands.add_parser('full-export')
    for name in ['builder', 'image', 'source-manifest', 'record-file', 'output-dir']:
        full_export.add_argument('--' + name, required=True)
    full_build = commands.add_parser('full-build')
    full_build.add_argument('--output-dir', required=True)
    full_build.add_argument('--image-tag', required=True)
    config_only = commands.add_parser('transport-config')
    for name in ['source-manifest', 'node-image', 'image-tag', 'output-dir']:
        config_only.add_argument('--' + name, required=True)
    transport = commands.add_parser('verified-transport')
    for name in ['builder', 'base-image', 'config-image', 'source-manifest', 'image-tag', 'output-dir']:
        transport.add_argument('--' + name, required=True)
    verify = commands.add_parser('verify')
    verify.add_argument('--image', required=True)
    verify.add_argument('--record-file')
    args = parser.parse_args()
    if args.action == 'export':
        result = export_runtime(args)
    elif args.action == 'audit-registry':
        result = audit_registry_reuse(args)
    elif args.action == 'build':
        result = build_runtime(args)
    elif args.action == 'full-export':
        result = export_full_runtime(args)
    elif args.action == 'full-build':
        result = build_full_runtime(args)
    elif args.action == 'transport-config':
        result = build_transport_config(args)
    elif args.action == 'verified-transport':
        result = build_verified_transport(args)
    else:
        result = verify_image(args.image, json.loads(pathlib.Path(args.record_file).read_text()) if args.record_file else None)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as error:
        print('release-runtime: refused or failed: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
