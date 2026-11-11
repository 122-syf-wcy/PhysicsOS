#!/usr/bin/env python3
"""Export verified runtime deltas, build offline candidates, and cold-check files.

Operations use an explicitly owned development builder and immutable local image.
No operation reads environment values, secrets, production data or switches apps.
"""
import argparse
import hashlib
import json
import os
import pathlib
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
EXCLUDED = {'node_modules', '.git', 'tests', 'test', '__tests__', 'fixtures', '__fixtures__', '__snapshots__', '.home', '.ssh', 'secrets', '.turbo', '.vite', '__pycache__', 'preview'}
ROOT_CODE = {'package.json', 'classroom-runtime-links.cjs', 'classroom-runtime-links.json', 'physicsos-runtime-update.cjs', 'physicsos-runtime-update.json'}
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


def excluded(value):
    parts = pathlib.PurePosixPath(value).parts
    return bool(set(parts) & EXCLUDED) or any(p == '.env' or p.startswith('.env.') for p in parts) or value.endswith(('.pem', '.key', '.p12', '.pfx', '.log', '.pid', '.tsbuildinfo', '.map', '.spec.ts', '.test.ts', '.spec.tsx', '.test.tsx'))


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
    return {'schemaVersion': 2, 'ownership': 'physicsos-runtime/2', 'files': dict(sorted(files.items())), 'codeDigest': sha(canonical(files)), 'revision': value.get('revision', value.get('mainRevision')), 'sourceDigest': value.get('sourceDigest'), 'pluginTrust': value.get('pluginTrust', DEFAULT_TRUST), 'legacyFileCount': len(source), 'originSchema': value['schemaVersion']}


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


def workspace_updates(candidate, base, workspace_paths):
    links, checks = {}, []
    for path, package in candidate.items():
        safe_code_path((path + '/' if path else '') + 'package.json')
        before = base.get(path, {})
        deps = {**package.get('dependencies', {}), **package.get('peerDependencies', {})}
        old = {**before.get('dependencies', {}), **before.get('peerDependencies', {})}
        actual = 'nodeRequests' in package
        names = package.get('nodeRequests', list(deps))
        old_names = before.get('nodeRequests', list(old))
        root_name = lambda name: '/'.join(name.split('/')[:2]) if name.startswith('@') else name.split('/')[0]
        bare = {name: deps.get(root_name(name)) for name in names if root_name(name) not in workspace_paths}
        old_bare = {name: old.get(root_name(name)) for name in old_names if root_name(name) not in workspace_paths}
        if bare != old_bare:
            raise ValueError('External registry dependency changed; a full runtime build is required')
        if 'resolvedBare' in package and 'resolvedBare' in before and package['resolvedBare'] != before['resolvedBare']:
            raise ValueError('Resolved external dependency version changed; a full runtime build is required')
        for request in names:
            name = root_name(request)
            if name in workspace_paths and (old.get(name) != deps.get(name) or request not in old_names):
                target = safe_code_path(workspace_paths[name] + '/package.json').removesuffix('/package.json')
                link = (path + '/' if path else '') + 'node_modules/' + name
                safe_relative(link)
                links[link] = {'link': link, 'target': target, 'force': True}
        if not before and package.get('name', '').startswith('@physicsos/'):
            link = 'node_modules/' + package['name']
            safe_relative(link)
            links[link] = {'link': link, 'target': path, 'force': True}
        if actual and any(root_name(name) not in workspace_paths for name in set(package.get('clientRequests', [])) - set(before.get('clientRequests', []))):
            raise ValueError('New client module-table external is unverified; a full runtime build is required')
        checks.append({'from': path, 'dependencies': sorted(names)})
    return {'links': list(links.values()), 'checks': checks}


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


def validate_image_labels(metadata, record):
    labels = metadata.get('labels') or {}
    expected = {'org.opencontainers.image.revision': record['revision'], 'physicsos.source.digest': record['sourceDigest'], 'physicsos.code.digest': record['codeDigest']}
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
const skip=n=>n.split('/').some(x=>['node_modules','.git','tests','test','__tests__','fixtures','__fixtures__','__snapshots__','.home','.ssh','secrets','.turbo','.vite','__pycache__','preview'].includes(x)||x==='.env'||x.startsWith('.env.'))||/\.(?:pem|key|p12|pfx|log|pid|tsbuildinfo|map|spec\.ts|test\.ts|spec\.tsx|test\.tsx)$/.test(n);
const visit=n=>{safe(n);if(skip(n))return;const abs=p.resolve(root,n);if(!abs.startsWith(root+'/'))throw Error('Inventory escaped root');if(!f.existsSync(abs))return;const st=f.lstatSync(abs);if(st.isSymbolicLink())throw Error('Runtime export contains source link');if(st.isDirectory()){for(const name of f.readdirSync(abs))visit(n+'/'+name);}else if(st.isFile()){const bytes=f.readFileSync(abs);files[n]={sha256:c.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,mode:st.mode&511};}else throw Error('Non-file runtime code');};
const pkg=n=>{const file=p.join(root,n,'package.json');if(!f.existsSync(file))return;const m=JSON.parse(f.readFileSync(file));if(m.name)workspace[m.name]=n;return {name:m.name,version:m.version,dependencies:m.dependencies||{},peerDependencies:m.peerDependencies||{}};};
for(const row of doc.selections||[]){safe(row.root);for(const item of row.items||[])visit(item==='.'?row.root:row.root+'/'+safe(item));const m=pkg(row.root);if(m){m.mode=row.mode||'host';packages[row.root]=m;}}
for(const name of doc.exact||[])visit(safe(name));
if((doc.exact||[]).includes('package.json'))packages['']=pkg('');
for(const name of doc.required||[]){const abs=p.resolve(root,safe(name));if(!f.existsSync(abs)||!f.statSync(abs).size)throw Error('Required runtime artifact absent');}
const children=n=>f.existsSync(p.join(root,n))?f.readdirSync(p.join(root,n),{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>n+'/'+x.name):[];
for(const n of children('packages'))pkg(n);for(const group of children('vendor/deepseek-harness/packages'))for(const n of children(group))pkg(n);for(const n of children('vendor/deepseek-harness/vendor'))pkg(n);for(const n of children('vendor/deepseek-harness/apps'))pkg(n);for(const n of children('vendor/deepseek-harness/native/system/packages'))pkg(n);
const requests=code=>{const out=new Set(),tokens=/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]/g;let previous=[],statement=false,match;while((match=tokens.exec(code))){const value=match[0];if(value.startsWith('//')||value.startsWith('/*'))continue;if(['import','export'].includes(value)&&previous.at(-1)!=='.')statement=true;if(value[0]==='"'||value[0]==="'"){if(previous.at(-1)==='('&&['require','__require','import'].includes(previous.at(-2))&&previous.at(-3)!=='.'||statement&&['from','import'].includes(previous.at(-1)))out.add(value.slice(1,-1));}if(value===';')statement=false;previous.push(value);if(previous.length>3)previous.shift();}return [...out];};
const external=n=>!n.startsWith('.')&&!p.isAbsolute(n)&&!builtinModules.includes(n.replace(/^node:/,''));
for(const [path,m]of Object.entries(packages)){const req=createRequire(p.join(root,path,'package.json')),node=new Set(),client=new Set(),seen=new Set();const follow=n=>{if(seen.has(n)||!f.existsSync(n))return;seen.add(n);for(const name of requests(f.readFileSync(n,'utf8'))){if(external(name))node.add(name);else if(name.startsWith('.')){const next=p.resolve(p.dirname(n),name);if(next.startsWith(p.join(root,path,'lib')+'/'))follow(next);}}};if(!['source','files'].includes(m.mode))for(const name of ['index.js','invariant.js','startup.js'])follow(p.join(root,path,'lib',name));if(m.mode==='client')for(const [name]of Object.entries(files))if(name.startsWith(path+'/lib/')&&/^\/(?:client(?:\.[^/]+)?|optional-[^/]+)\.js$/.test(name.slice((path+'/lib').length)))for(const request of requests(f.readFileSync(p.join(root,name),'utf8')))if(external(request))client.add(request);m.nodeRequests=[...node].sort();m.clientRequests=[...client].sort();m.resolvedBare={};for(const name of m.nodeRequests){const bare=name.startsWith('@')?name.split('/').slice(0,2).join('/'):name.split('/')[0];if(bare in workspace)continue;try{let file;try{file=req.resolve(bare+'/package.json')}catch{let dir=p.dirname(f.realpathSync(req.resolve(name)));while(!f.existsSync(p.join(dir,'package.json'))){const parent=p.dirname(dir);if(parent===dir)throw Error('External dependency manifest absent');dir=parent;}file=p.join(dir,'package.json');}const meta=JSON.parse(f.readFileSync(file));m.resolvedBare[name]={name:meta.name,version:meta.version};}catch{m.resolvedBare[name]=null;}}}
console.log(JSON.stringify({files,packages,workspace}));});
'''

UPDATE_JS = r'''
const f=require('fs'),p=require('path'),c=require('crypto'),{createRequire}=require('module');
function applyRuntimeUpdate(root,doc){root=f.realpathSync(root);
const safe=n=>{if(typeof n!=='string'||!n||p.isAbsolute(n)||n.split('/').some(x=>x==='..'||x==='.'||!x||x==='.env'||x.startsWith('.env.'))||/[\\\0\r\n]/.test(n)||/\.(?:pem|key|p12|pfx)$/.test(n))throw Error('Unsafe runtime update path');return p.join(root,n);};
const parent=abs=>{const dir=f.realpathSync(p.dirname(abs));if(dir!==root&&!dir.startsWith(root+'/'))throw Error('Runtime update parent escaped app');};
for(const row of doc.deleted){const abs=safe(row.path);if(!(row.path.startsWith('packages/')||row.path.startsWith('scripts/')||row.path.startsWith('vendor/deepseek-harness/')||row.path==='classroom-runtime-links.cjs'||row.path==='classroom-runtime-links.json'))throw Error('Unowned runtime deletion');parent(abs);if(!f.existsSync(abs))continue;const st=f.lstatSync(abs);if(!st.isFile()||c.createHash('sha256').update(f.readFileSync(abs)).digest('hex')!==row.sha256)throw Error('Owned deleted file changed');}
for(const row of doc.links){const abs=safe(row.link),target=safe(row.target);if(!row.link.includes('/node_modules/')&&!row.link.startsWith('node_modules/'))throw Error('Not a workspace link');if(!f.existsSync(p.join(target,'package.json')))throw Error('Workspace target absent');f.mkdirSync(p.dirname(abs),{recursive:true,mode:493});parent(abs);let current;try{current=f.lstatSync(abs)}catch{}if(current&&!current.isSymbolicLink())throw Error('Refusing real workspace dependency directory');}
for(const row of doc.deleted){const abs=safe(row.path);if(f.existsSync(abs))f.unlinkSync(abs);}
for(const row of doc.links){const abs=safe(row.link),target=safe(row.target);let exists=false;try{f.lstatSync(abs);exists=true}catch{}if(exists)f.unlinkSync(abs);f.symlinkSync(p.relative(p.dirname(abs),target),abs,'dir');try{f.lchownSync(abs,999,999)}catch{}}
for(const row of doc.checks){const req=createRequire(safe((row.from?row.from+'/':'')+'package.json'));for(const dep of row.dependencies)req.resolve(dep);}
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
    return json.loads(command(['docker', 'image', 'inspect', '--format', '{"id":{{json .Id}},"labels":{{json .Config.Labels}}}', image]))


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
    startup = {'package.json', 'scripts/docker-entrypoint.mjs', 'scripts/healthcheck.mjs', 'scripts/deploy/wait-for-ready.mjs', 'scripts/deploy/migrate-json-postgres.mjs'}
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
    updates = workspace_updates(candidate['packages'], before['packages'], candidate['workspace'])
    code_files = {path: info['sha256'] for path, info in candidate['files'].items()}
    # The generic updater is public code; its checksum is covered like plugins.
    provisional = compute_delta(base_files, code_files, owned)
    noop = noop_report(base, {'baseImage': args.base_image, 'revision': args.revision, 'sourceDigest': source['sourceDigest']}, provisional)
    if noop:
        return noop
    update_document = {**updates, 'deleted': [{'path': n, 'sha256': base_files[n]} for n in provisional['deleted']]}
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
        for name in METADATA:
            atomic_json(app / name, manifest)
        dockerfile = '\n'.join(['ARG BASE_IMAGE=scratch', 'FROM ${BASE_IMAGE}', 'ARG REVISION', 'ARG SOURCE_DIGEST', 'ARG CODE_DIGEST', 'USER root', 'COPY --chown=999:999 app/ /app/', 'RUN node /app/physicsos-runtime-update.cjs', 'USER physicsos', 'LABEL org.opencontainers.image.revision=$REVISION', 'LABEL physicsos.source.digest=$SOURCE_DIGEST', 'LABEL physicsos.code.digest=$CODE_DIGEST', ''])
        (temporary / 'Dockerfile').write_text(dockerfile)
        context_hashes = {str(path.relative_to(temporary)): sha(path.read_bytes()) for path in temporary.rglob('*') if path.is_file()}
        record = {**identity, 'codeDigest': delta['codeDigest'], 'context': str(output / 'context'), 'contextHashes': context_hashes, 'changedFiles': delta['changed'], 'deletedFiles': delta['deleted'], 'baseExtraFiles': extra, 'managedFileCount': len(delta['files']), 'bytesExported': sum(path.stat().st_size for path in temporary.rglob('*') if path.is_file()), 'legacyFilesNormalized': base['legacyFileCount']}
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
    return output, context, record, normalized


def verify_image(image, expected=None):
    metadata = image_metadata(image)
    exact = metadata['id']
    if not IMAGE_ID.fullmatch(exact):
        raise ValueError('Invalid cold-verification image identity')
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
    return {'verified': True, 'image': exact, 'revision': manifest['revision'], 'sourceDigest': manifest['sourceDigest'], 'codeDigest': manifest['codeDigest'], 'checkedFiles': checks['checked'], 'signedPluginEntries': proof['entries'], 'network': 'none', 'readOnly': True}


def build_runtime(args):
    output, context, record, manifest = load_export(args.output_dir)
    if not IMAGE_ID.fullmatch(record['baseImage']) or image_metadata(record['baseImage'])['id'] != record['baseImage']:
        raise ValueError('Immutable local runtime base changed or disappeared')
    base = read_base_manifest(record['baseImage'])
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
    started = time.monotonic()
    command(['docker', 'build', '--network=none', '--pull=false', '--progress=plain', '--build-arg', 'BASE_IMAGE=' + base_tag, '--build-arg', 'REVISION=' + record['revision'], '--build-arg', 'SOURCE_DIGEST=' + record['sourceDigest'], '--build-arg', 'CODE_DIGEST=' + record['codeDigest'], '--tag', args.image_tag, str(context)], log=True)
    metadata = image_metadata(args.image_tag)
    validate_image_labels(metadata, record)
    proof = verify_image(metadata['id'], record)
    result = {**proof, 'baseImage': record['baseImage'], 'baseTag': base_tag, 'imageTag': args.image_tag, 'bytesExported': record['bytesExported'], 'changedFiles': len(record['changedFiles']), 'deletedFiles': len(record['deletedFiles']), 'elapsedSeconds': round(time.monotonic() - started, 2)}
    atomic_json(output / 'build.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    export = commands.add_parser('export')
    for name in ['builder', 'base-image', 'revision', 'source-manifest', 'plan-file', 'output-dir']:
        export.add_argument('--' + name, required=True)
    build = commands.add_parser('build')
    build.add_argument('--output-dir', required=True)
    build.add_argument('--image-tag', required=True)
    build.add_argument('--base-tag')
    build.add_argument('--reserve-bytes', type=int, default=256 * 1024 * 1024)
    verify = commands.add_parser('verify')
    verify.add_argument('--image', required=True)
    verify.add_argument('--record-file')
    args = parser.parse_args()
    if args.action == 'export':
        result = export_runtime(args)
    elif args.action == 'build':
        result = build_runtime(args)
    else:
        result = verify_image(args.image, json.loads(pathlib.Path(args.record_file).read_text()) if args.record_file else None)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as error:
        print('release-runtime: refused or failed: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
