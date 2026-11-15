"""Closed full-build filesystem transport. Never adopts old source/code manifests."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import subprocess
import tarfile

COPY_PATHS = ['package.json', 'node_modules', 'packages', 'vendor/deepseek-harness',
              'overlays/harness/files/packages/physicsos/health-host', 'scripts/healthcheck.mjs',
              'scripts/deploy/wait-for-ready.mjs', 'scripts/deploy/migrate-json-postgres.mjs',
              'scripts/docker-entrypoint.mjs']
METADATA = ['physicsos-runtime-manifest.json', 'canvas-source-manifest.json']


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def config_only_dockerfile(source):
    matches = list(re.finditer(r'^FROM \$\{NODE_IMAGE\} AS runtime\r?$', source, re.M))
    if len(matches) != 1:
        raise ValueError('Expected one closed Node runtime stage')
    if re.search(r'^#\s*escape=', source, re.M | re.I):
        raise ValueError('Custom Dockerfile escape directives are not supported')
    stage = source[matches[0].start():]
    # This grammar deliberately rejects future COPY/ADD variants until reviewed.
    logical = re.sub(r'\\\r?\n', '', stage)
    kept, copies = [], []
    allowed = {'FROM', 'ENV', 'RUN', 'WORKDIR', 'USER', 'EXPOSE', 'STOPSIGNAL', 'HEALTHCHECK', 'CMD'}
    for line in logical.splitlines():
        text = line.strip()
        if not text or text.startswith('#'):
            continue
        instruction = text.split(None, 1)[0]
        if instruction == 'COPY':
            match = re.fullmatch(r'COPY --from=builder --chown=physicsos:physicsos\s+/app/(\S+)\s+\./(\S+)', text)
            if not match or match[1] != match[2] or match[1] not in COPY_PATHS:
                raise ValueError('Unsupported full runtime COPY syntax or destination')
            copies.append(match[1])
        elif instruction in allowed:
            if instruction == 'FROM' and (kept or text != 'FROM ${NODE_IMAGE} AS runtime'):
                raise ValueError('Additional runtime stages are not transportable')
            kept.append(line)
        else:
            raise ValueError('Unsupported runtime instruction for verified transport')
    if sorted(copies) != sorted(COPY_PATHS):
        raise ValueError('Complete reviewed runtime COPY layout is required')
    return {'stage': stage, 'dockerfile': 'ARG NODE_IMAGE\n' + '\n'.join(kept) + '\n', 'copies': copies}


def allowed_label(key):
    return key in ['org.opencontainers.image.revision', 'physicsos.source.digest', 'physicsos.code.digest',
                   'physicsos.role', 'physicsos.filesystem.digest', 'physicsos.runtime-config.digest', 'physicsos.manifest.digest',
                   'physicsos.full-build.revision', 'physicsos.full-build.source-digest', 'physicsos.full-build.dependency-fingerprint']


def runtime_config(config):
    value = dict(config)
    labels = {key: item for key, item in (value.pop('Labels', None) or {}).items() if not allowed_label(key)}
    if labels:
        value['Labels'] = labels
    return value


def require_same_config(left, right):
    if runtime_config(left) != runtime_config(right):
        # Values may be private: never echo Env or argument values.
        raise ValueError('Runtime configuration differs from the reviewed config-only image')
    return digest(canonical(runtime_config(right)))


def safe_path(name):
    if not isinstance(name, str) or not name or '\\' in name or '\x00' in name or '\n' in name or str(PurePosixPath(name)) != name or PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts or name == '.':
        raise ValueError('Transport path escapes its closed application root')
    return name


def validate_tree(tree):
    for name, item in tree.items():
        safe_path(name)
        if item.get('type') not in ['file', 'dir', 'symlink'] or not isinstance(item.get('mode'), int) or not 0 <= item['mode'] <= 0o7777:
            raise ValueError('Unsupported transport filesystem entry')
        if any(not isinstance(item.get(key), int) or item[key] < 0 for key in ['uid', 'gid']):
            raise ValueError('Missing filesystem ownership evidence')
        if item['type'] == 'file' and not re.fullmatch(r'[a-f0-9]{64}', item.get('sha256', '')):
            raise ValueError('File hash evidence missing')
        if item['type'] == 'symlink':
            target = item.get('target')
            if not isinstance(target, str) or not target or '\x00' in target or '\\' in target:
                raise ValueError('Invalid symlink evidence')
            resolved = posixpath.normpath(posixpath.join('/app', posixpath.dirname(name), target))
            if not (resolved == '/app' or resolved.startswith('/app/')) or item['mode'] != 0o777:
                raise ValueError('Symlink crosses the closed application boundary')
        for parent in PurePosixPath(name).parents:
            if str(parent) == '.':
                continue
            if str(parent) not in tree or tree[str(parent)]['type'] != 'dir':
                raise ValueError('Transport has a non-directory or missing parent')
    return tree


FS_CODE = r'''
const f=require('fs'),p=require('path'),c=require('crypto');
function fileHash(a){const h=c.createHash('sha256'),fd=f.openSync(a,'r'),buffer=Buffer.allocUnsafe(1024*1024);try{let n;while((n=f.readSync(fd,buffer,0,buffer.length,null))>0)h.update(buffer.subarray(0,n));}finally{f.closeSync(fd)}return h.digest('hex')}
function pathOf(root,n){if(typeof n!=='string'||!n||p.isAbsolute(n)||n.split('/').some(x=>!x||x==='.'||x==='..')||/[\\\0\r\n]/.test(n))throw Error('Unsafe transport path');const a=p.resolve(root,n);if(!a.startsWith(root+'/'))throw Error('Transport escaped root');return a}
function children(a){return f.readdirSync(a,{encoding:'buffer'}).map(b=>{const n=b.toString('utf8');if(!Buffer.from(n).equals(b))throw Error('Non-UTF8 path is not transportable');return n})}
function entry(a){const s=f.lstatSync(a),v={mode:s.mode&4095,uid:s.uid,gid:s.gid};if(s.isSymbolicLink()){const b=f.readlinkSync(a,{encoding:'buffer'}),target=b.toString('utf8');if(!Buffer.from(target).equals(b))throw Error('Non-UTF8 link is not transportable');return{...v,type:'symlink',target}};if(s.isDirectory())return{...v,type:'dir'};if(s.isFile())return{...v,type:'file',sha256:fileHash(a),bytes:s.size};throw Error('Special filesystem entry is not transportable')}
function scan(root,roots,ignore){root=p.resolve(root);const rootEntry=entry(root);if(rootEntry.type!=='dir')throw Error('Application root must be a real directory');const entries={};function visit(n){if(ignore.includes(n))return;const a=pathOf(root,n),e=entry(a);if(e.type==='symlink'){const target=p.resolve('/app',p.dirname(n),e.target);if(target!=='/app'&&!target.startsWith('/app/'))throw Error('External application symlink is not transportable')}entries[n]=e;if(e.type==='dir')for(const k of children(a))visit(n+'/'+k)}
if(roots){for(const n of roots){let parent=p.posix.dirname(n);while(parent!=='.'){if(!entries[parent]){const e=entry(pathOf(root,parent));if(e.type!=='dir')throw Error('COPY parent is not a directory');entries[parent]=e;}parent=p.posix.dirname(parent)}visit(n)}}else for(const n of children(root))visit(n);return{root:rootEntry,entries}}
function equal(a,b){if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return a===b;const x=Object.keys(a).sort(),y=Object.keys(b).sort();return x.length===y.length&&x.every((k,i)=>k===y[i]&&equal(a[k],b[k]))}
'''
FS_JS = FS_CODE + r'''
let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{const d=JSON.parse(input);const result=scan(d.root||'/app',d.paths,d.ignore||[]);if(d.owner)result.owner={uid:process.getuid(),gid:process.getgid()};console.log(JSON.stringify(result))});
'''

APPLY_JS = FS_CODE + r'''
function applyFullTransport(root,stage){root=p.resolve(root);stage=p.resolve(stage);const doc=JSON.parse(f.readFileSync(stage+'/plan.json','utf8'));
const before=scan(root,undefined,[]);if(!equal(before,doc.before))throw Error('Transport base filesystem changed before application');
function parentsSafe(base,n){let parent=p.dirname(n);while(parent!=='.'){if(f.lstatSync(pathOf(base,parent)).isSymbolicLink())throw Error('Transport parent became a symlink');parent=p.dirname(parent)}}
// Validate every staged leaf before the first application mutation.
for(const n of doc.changed){const desired=doc.after.entries[n];if(desired.type==='dir')continue;parentsSafe(stage+'/payload',n);const actual=entry(pathOf(stage+'/payload',n));const expected={...desired,uid:actual.uid,gid:actual.gid};if(!equal(actual,expected))throw Error('Staged transport entry differs')}
const order=Object.keys(doc.before.entries).sort((a,b)=>b.split('/').length-a.split('/').length||b.localeCompare(a));
for(const n of order){const old=doc.before.entries[n],next=doc.after.entries[n];if(!next||old.type!==next.type){parentsSafe(root,n);const a=pathOf(root,n);if(old.type==='dir')f.rmdirSync(a);else f.unlinkSync(a)}}
const directories=Object.keys(doc.after.entries).filter(n=>doc.after.entries[n].type==='dir').sort((a,b)=>a.split('/').length-b.split('/').length);
for(const n of directories){const a=pathOf(root,n),e=doc.after.entries[n];if(equal(doc.before.entries[n],e))continue;parentsSafe(root,n);if(!f.existsSync(a))f.mkdirSync(a,{mode:e.mode});f.chownSync(a,e.uid,e.gid);f.chmodSync(a,e.mode)}
for(const n of doc.changed){const e=doc.after.entries[n];if(e.type==='dir')continue;parentsSafe(root,n);const a=pathOf(root,n),from=pathOf(stage+'/payload',n);try{f.lstatSync(a);f.unlinkSync(a)}catch(error){if(error.code!=='ENOENT')throw error}if(e.type==='symlink'){f.symlinkSync(e.target,a);f.lchownSync(a,e.uid,e.gid)}else{f.copyFileSync(from,a,f.constants.COPYFILE_EXCL);f.chownSync(a,e.uid,e.gid);f.chmodSync(a,e.mode)}}
if(!equal(scan(root,undefined,[]),doc.after))throw Error('Transport output does not match the full audited builder filesystem');
}
if(require.main===module)applyFullTransport('/app','/run/physicsos-full-transport');
module.exports={applyFullTransport};
'''


def desired_tree(builder_scan, config_scan):
    if config_scan['entries']:
        raise ValueError('Reviewed config-only image must have an empty application root')
    owner = config_scan.get('owner')
    if not owner or owner.get('uid', 0) == 0:
        raise ValueError('Reviewed runtime must resolve a real non-root COPY owner')
    entries = {name: {**item, 'uid': owner['uid'], 'gid': owner['gid']} for name, item in builder_scan['entries'].items()}
    validate_tree(entries)
    return {'root': config_scan['root'], 'entries': entries}



def desired_runtime_tree(builder_scan, config_scan):
    directories = {'node_modules', 'packages', 'vendor/deepseek-harness', 'overlays/harness/files/packages/physicsos/health-host'}
    for name in COPY_PATHS:
        expected = 'dir' if name in directories else 'file'
        if builder_scan['entries'].get(name, {}).get('type') != expected:
            raise ValueError('Reviewed COPY root is missing or has an unsupported link/type')
    return desired_tree(builder_scan, config_scan)

def write_payload(builder, changed, desired, destination):
    """Export leaves without dereferencing links or reusing an existing staging tree."""
    destination = Path(destination)
    destination.mkdir(mode=0o700)
    archive = destination.parent / 'payload.tar'
    names = [name for name in changed if desired[name]['type'] != 'dir']
    for name in names:
        safe_path(name)
    if not names:
        return 0
    with archive.open('xb') as output:
        process = subprocess.Popen(['docker', 'exec', '-i', builder, 'tar', '-C', '/app', '--no-recursion', '--hard-dereference', '--null', '-T', '-', '-cf', '-'], stdin=subprocess.PIPE, stdout=output, stderr=subprocess.DEVNULL)
        process.communicate(('\0'.join(names) + '\0').encode())
        if process.returncode != 0:
            raise ValueError('Builder filesystem transport export failed')
    seen = set()
    with tarfile.open(archive) as source:
        for member in source:
            name = member.name.removeprefix('./')
            safe_path(name)
            if name not in names or name in seen:
                raise ValueError('Unrequested or duplicate transport archive entry')
            item = desired[name]
            output = destination / name
            if any(parent.is_symlink() for parent in output.parents if destination in parent.parents or parent == destination):
                raise ValueError('Transport staging parent is a symlink')
            output.parent.mkdir(parents=True, exist_ok=True)
            if member.issym() and item['type'] == 'symlink' and member.linkname == item['target']:
                output.symlink_to(member.linkname)
            elif member.isfile() and item['type'] == 'file':
                with source.extractfile(member) as data, output.open('xb') as target:
                    shutil.copyfileobj(data, target)
                if digest(output.read_bytes()) != item['sha256']:
                    raise ValueError('Transport file changed while exporting')
                os.chmod(output, item['mode'])
            else:
                raise ValueError('Transport archive entry type changed')
            seen.add(name)
    if seen != set(names):
        raise ValueError('Transport payload is incomplete')
    size = archive.stat().st_size
    archive.unlink()
    return size
