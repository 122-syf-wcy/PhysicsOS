#!/usr/bin/env python3
"""Run/check an owned candidate with isolated data and the real image command."""
import argparse
import contextlib
import fcntl
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import time
import urllib.parse
import urllib.request
os.umask(0o077)


def metadata(kind, name):
    result = subprocess.run(['docker', kind, 'inspect', name], capture_output=True, text=True)
    return json.loads(result.stdout)[0] if result.returncode == 0 else None


def private_json(path, value):
    temporary = path.with_name(path.name + '.partial-' + os.urandom(8).hex())
    try:
        with temporary.open('x') as file:
            file.write(json.dumps(value, indent=2) + '\n'); file.flush(); os.fsync(file.fileno())
        temporary.chmod(0o600); temporary.replace(path)
    finally: temporary.unlink(missing_ok=True)


def load(file):
    value = json.loads(Path(file).read_text())
    for name in ['task', 'databaseOwner', 'databaseUser', 'databaseName', 'schema', 'username']:
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_-]{0,62}', value.get(name, '')):
            raise ValueError('Invalid validation identity')
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}', value['schema']):
        raise ValueError('Invalid validation schema')
    value['username'] = value['username'].lower()
    value['_configFile'] = str(Path(file).resolve())
    for name in ['httpPort', 'modelPoolPort']:
        if not isinstance(value.get(name), int) or not 1024 <= value[name] <= 65535:
            raise ValueError('Invalid validation port')
    if value['httpPort'] == value['modelPoolPort'] or value['schema'] == 'physicsos':
        raise ValueError('Validation must use separate ports/schema')
    root = Path(value['root'])
    if not root.is_absolute() or root.is_symlink() or ',' in str(root) or root == Path('/'):
        raise ValueError('Invalid validation directory')
    return value


def same_data(left, right):
    if left.get('Name') and left.get('Name') == right.get('Name'):
        return True
    if not left.get('Source') or not right.get('Source'):
        return False
    a, b = Path(left['Source']).resolve(), Path(right['Source']).resolve()
    return a == b or a in b.parents or b in a.parents


def owned_path(root, path, protected):
    relative = path.relative_to(root)
    current = root
    for part in [None, *relative.parts]:
        if part is not None: current = current / part
        if current.is_symlink(): raise RuntimeError('Validation paths must not contain symlinks')
        if current.exists() and stat.S_ISREG(current.stat().st_mode) and current.stat().st_nlink > 1:
            raise RuntimeError('Validation files must not share hard-linked inodes')
    resolved = path.resolve()
    if any(same_data({'Source': str(resolved)}, mount) for mount in protected):
        raise RuntimeError('Validation path overlaps production data')


@contextlib.contextmanager
def lifecycle(root):
    # The shared host project path stays identical inside the Docker operations box.
    name = hashlib.sha256(str(root.resolve()).encode()).hexdigest()[:24]
    directory = Path(os.environ.get('PHYSICSOS_DIR', '/opt/physicsos')) / '.physicsos-release/validation-locks'
    protected = [mount for service in ['physicsos-app-1', 'physicsos-postgres-1', 'physicsos-redis-1'] for source in [metadata('container', service)] if source for mount in source['Mounts'] if mount.get('Destination', '').startswith(('/var/lib/physicsos', '/var/lib/postgresql', '/data'))]
    if any(same_data({'Source': str(directory)}, mount) for mount in protected): raise RuntimeError('Validation lock directory overlaps production data')
    if directory.is_symlink(): raise RuntimeError('Validation lock directory must not be a symlink')
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / ('validation-' + name + '.lock')
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if info.st_uid != os.getuid() or info.st_nlink != 1 or not stat.S_ISREG(info.st_mode):
            raise RuntimeError('Validation lifecycle lock ownership differs')
        fcntl.flock(fd, fcntl.LOCK_EX)
        try: yield
        finally: fcntl.flock(fd, fcntl.LOCK_UN)
    finally: os.close(fd)


def redirect_pool(value, old_port, new_port):
    return re.sub(r'(https?://)(127\.0\.0\.1|localhost|\[::1\]):' + str(old_port) + r'\b', lambda match: match.group(1) + match.group(2) + ':' + str(new_port), value)


@contextlib.contextmanager
def settle_mutations():
    cancelled = [False]
    def request_cancel(_number, _frame): cancelled[0] = True
    previous = {number: signal.getsignal(number) for number in [signal.SIGINT, signal.SIGTERM]}
    for number in previous: signal.signal(number, request_cancel)
    try: yield cancelled
    finally:
        for number, handler in previous.items(): signal.signal(number, handler)


def prepare(config, image_name):
    app = metadata('container', 'physicsos-app-1')
    pg = metadata('container', config['databaseContainer'])
    production_pg = metadata('container', 'physicsos-postgres-1')
    image = metadata('image', image_name)
    if not app or not app['State']['Running'] or not image:
        raise RuntimeError('Current production or candidate image unavailable')
    if not pg or pg['Config'].get('Labels', {}).get('io.physicsos.task') != config['databaseOwner']:
        raise RuntimeError('Existing validation database ownership differs')
    redis = metadata('container', 'physicsos-redis-1')
    protected = [mount for source in [app, production_pg, redis] if source for mount in source['Mounts'] if mount.get('Destination', '').startswith(('/var/lib/physicsos', '/var/lib/postgresql', '/data'))]
    if not production_pg or pg['Id'] == production_pg['Id'] or any(same_data(a, b) for a in pg['Mounts'] if a.get('RW', True) for b in protected):
        raise RuntimeError('Validation database shares production data')
    root = Path(config['root'])
    writable = ['owner', 'metadata.json', 'home', 'state', 'secrets', 'tools', 'home/profiles', 'home/profiles/web', 'home/profiles/web/node_modules', 'tools/candidate.patch.yml', 'secrets/database_url', 'secrets/admin_password', 'state/launch-spec.json', 'state/logger.json', 'state/launcher.json', 'state/launcher.log', 'state/runtime.log', 'state/auth-url', 'state/lifecycle.lock', 'state/intent.json']
    for path in [root, *(root / name for name in writable), *(root / 'home/profiles/web' / name for name in ['cordis.yml', 'cordis.patch.yml', 'package.json', 'pnpm-workspace.yaml'])]: owned_path(root, path, protected)
    if root.exists() and not (root / 'owner').exists() and any(root.iterdir()):
        raise RuntimeError('Validation directory is not an owned empty directory')
    if not pg['State']['Running']:
        subprocess.run(['docker', 'start', pg['Id']], check=True, stdout=subprocess.DEVNULL)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    owner = root / 'owner'
    if owner.exists() and owner.read_text().strip() != config['task']:
        raise RuntimeError('Validation directory belongs to another task')
    owner.write_text(config['task']); root.chmod(0o700)
    paths = {name: root / name for name in ['home', 'state', 'secrets', 'tools']}
    for path in paths.values():
        path.mkdir(exist_ok=True, mode=0o700); os.chown(path, 999, 999); path.chmod(0o700)
    profile_source = Path(next(m['Source'] for m in app['Mounts'] if m['Destination'] == '/var/lib/physicsos')) / 'profiles/web'
    profile = paths['home'] / 'profiles/web'
    profile.mkdir(parents=True, exist_ok=True, mode=0o700)
    for directory in [profile.parent, profile]: os.chown(directory, 999, 999)
    for name in ['cordis.yml', 'cordis.patch.yml', 'package.json', 'pnpm-workspace.yaml']:
        if (profile_source / name).is_file():
            shutil.copyfile(profile_source / name, profile / name)
            os.chown(profile / name, 999, 999); (profile / name).chmod(0o600)
    port = config['httpPort']
    health = subprocess.check_output(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'cat', image['Id'], '/app/overlays/harness/files/packages/physicsos/health-host/deployment.patch.yml'], text=True)
    patch = paths['tools'] / 'candidate.patch.yml'
    patch.write_text(health + f'''\n- id: webserver
  config:
    host: '0.0.0.0'
    port: {port}
- id: storage-postgres
  config:
    connectionString: !!js process.env.DATABASE_URL
    schema: !!js process.env.PHYSICSOS_STORAGE_SCHEMA
    ssl: false
- id: storage-domain
  config:
    backend: postgres
- id: shared-state-host
  config:
    backend: memory
    keyPrefix: {config['task']}
''')
    os.chown(patch, 999, 999); patch.chmod(0o600)
    network = next(iter(app['NetworkSettings']['Networks']))
    if network not in pg['NetworkSettings']['Networks']:
        subprocess.run(['docker', 'network', 'connect', network, pg['Id']], check=True)
        pg = metadata('container', config['databaseContainer'])
    pg_ip = pg['NetworkSettings']['Networks'][network]['IPAddress']
    password = Path(config['databasePasswordFile']).read_text().strip()
    database = f"postgresql://{config['databaseUser']}:{urllib.parse.quote(password, safe='')}@{pg_ip}:5432/{config['databaseName']}"
    for name, content in [('database_url', database), ('admin_password', os.urandom(24).hex())]:
        target = paths['secrets'] / name
        if name == 'database_url' or not target.exists():
            target.chmod(0o600) if target.exists() else None
            target.write_text(content + '\n')
        os.chown(target, 999, 999); target.chmod(0o400)
    command = list(app['Config']['Cmd'])
    if command[:4] != ['node', 'scripts/docker-entrypoint.mjs', 'node', 'vendor/deepseek-harness/apps/cli/lib/bin.js']:
        raise RuntimeError('Unexpected production command; review validation configuration')
    rewritten, index = [], 0
    while index < len(command):
        item = command[index]
        if item in ['--port', '--patch', '--trusted-host']:
            if item == '--port': rewritten.extend([item, str(port)])
            if item == '--patch': rewritten.extend([item, '/run/physicsos-validation-tools/candidate.patch.yml'])
            index += 2
        else:
            rewritten.append(item); index += 1
    rewritten.extend(['--trusted-host', f'physicsos-validation.invalid:{port}'])
    environment = dict(entry.split('=', 1) for entry in app['Config']['Env'])
    base_url = urllib.parse.urlsplit(environment.get('DEEPSEEK_BASE_URL', ''))
    old_pool_port = base_url.port if base_url.hostname in ['127.0.0.1', 'localhost', '::1'] and base_url.port else int(environment.get('PHYSICSOS_MODEL_POOL_PORT', '3972'))
    profile_patch = profile / 'cordis.patch.yml'
    if profile_patch.exists(): profile_patch.write_text(redirect_pool(profile_patch.read_text(), old_pool_port, config['modelPoolPort']))
    environment = {name: value for name, value in environment.items() if name.endswith('_FILE') or (not re.search(r'KEY|PASSWORD|SECRET|TOKEN|CREDENTIAL|COOKIE|DATABASE_URL|REDIS_URL|SMTP|AUTHORIZATION', name) and not re.search(r'(?i)Bearer\s|[?&](?:token|api_key)=|://[^/\s]+:[^/\s]+@', value))}
    environment = {name: redirect_pool(value, old_pool_port, config['modelPoolPort']) for name, value in environment.items()}
    environment['REDIS_URL_FILE'] = ''
    environment.update({'DSH_HOME': '/var/lib/physicsos', 'DSH_TELEMETRY_DISABLED': '1', 'PHYSICSOS_STORAGE_BACKEND': 'postgres', 'PHYSICSOS_STORAGE_SCHEMA': config['schema'], 'DATABASE_URL_FILE': '/run/secrets/database_url', 'DEEPSEEK_BASE_URL': f"http://127.0.0.1:{config['modelPoolPort']}/v1", 'PHYSICSOS_ADMIN_PASSWORD_FILE': '/run/secrets/admin_password', 'PHYSICSOS_ADMIN_USERNAME': config['username'], 'PHYSICSOS_SHARED_STATE_BACKEND': 'memory', 'PHYSICSOS_MODEL_POOL_PORT': str(config['modelPoolPort']), 'PHYSICOS_TRUSTED_HOSTS': f'physicsos-validation.invalid:{port}', 'PHYSICOS_TRUSTED_PROXIES': '', 'PHYSICSOS_SESSIONS_ROOT': '/var/lib/physicsos/sessions', 'PHYSICSOS_REGISTRATION_MODE': 'open', 'PHYSICSOS_SMTP_USER_FILE': '', 'PHYSICSOS_SMTP_PASSWORD_FILE': ''})
    mounts = [{'Source': str(paths['home']), 'Destination': '/var/lib/physicsos', 'ReadOnly': False}, {'Source': str(paths['tools']), 'Destination': '/run/physicsos-validation-tools', 'ReadOnly': True}]
    if (profile_source / 'node_modules').is_dir(): mounts.append({'Source': str(profile_source / 'node_modules'), 'Destination': '/var/lib/physicsos/profiles/web/node_modules', 'ReadOnly': True})
    private_values = [password, database, (paths['secrets'] / 'admin_password').read_text().strip()]
    for mount in app['Mounts']:
        destination = mount['Destination']
        if not destination.startswith('/run/secrets/') or destination in ['/run/secrets/smtp_user', '/run/secrets/smtp_password', '/run/secrets/redis_url', '/run/secrets/redis_password']: continue
        source = paths['secrets'] / destination.rsplit('/', 1)[-1] if destination in ['/run/secrets/database_url', '/run/secrets/admin_password'] else Path(mount['Source'])
        mounts.append({'Source': str(source), 'Destination': destination, 'ReadOnly': True})
        if source.is_file(): private_values.append(source.read_text().strip())
    name = 'physicsos-validation-' + config['task']
    details = {'task': config['task'], 'container': name, 'image': image['Id'], 'productionImage': app['Image'], 'port': port, 'schema': config['schema'], 'home': str(paths['home']), 'root': str(root), 'username': config['username'], 'productionDataWritable': False, 'nativePreload': False}
    spec = {'metadata': details, 'command': rewritten, 'environment': environment, 'mounts': mounts, 'network': network}
    private_json(root / 'metadata.json', details); private_json(paths['state'] / 'launch-spec.json', spec)
    return paths, spec, private_values


def remove_owned(config):
    name = 'physicsos-validation-' + config['task']
    container = metadata('container', name)
    if container:
        labels = container['Config'].get('Labels', {})
        if labels.get('io.physicsos.task') != config['task'] or labels.get('io.physicsos.role') != 'validation':
            raise RuntimeError('Refusing to stop an unowned service')
        subprocess.run(['docker', 'rm', '-f', name], check=True, stdout=subprocess.DEVNULL, start_new_session=True)


def start(config, image):
    root = Path(config['root'])
    with lifecycle(root):
        if metadata('container', 'physicsos-validation-' + config['task']): raise RuntimeError('Owned candidate already exists')
        paths, spec, _ = prepare(config, image)
        name, port = spec['metadata']['container'], config['httpPort']
        args = ['docker', 'create', '--name', name, '--log-driver', 'none', '--label', 'io.physicsos.task=' + config['task'], '--label', 'io.physicsos.role=validation', '--network', spec['network'], '--publish', f'127.0.0.1:{port}:{port}', '--memory', '1536m', '--cpus', '2']
        for mount in spec['mounts']:
            args.extend(['--mount', 'type=bind,src=' + mount['Source'] + ',dst=' + mount['Destination'] + (',readonly' if mount['ReadOnly'] else '')])
        for key, value in spec['environment'].items(): args.extend(['--env', key + '=' + value])
        args.extend([spec['metadata']['image'], *spec['command']])
        with settle_mutations() as cancelled:
            try:
                subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
                if cancelled[0]: raise RuntimeError('Candidate start cancelled')
                subprocess.run(['docker', 'start', name], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
                actual = metadata('container', name)
                if cancelled[0] or not actual or not actual['State']['Running'] or actual['Image'] != spec['metadata']['image']:
                    raise RuntimeError('Candidate did not acknowledge startup')
            except BaseException:
                remove_owned(config)
                raise
        return {**spec['metadata'], 'url': f'http://physicsos-validation.invalid:{port}', 'logDriver': 'none'}


def stop(config):
    root = Path(config['root'])
    if (root / 'owner').read_text().strip() != config['task']: raise RuntimeError('Validation owner changed')
    with lifecycle(root), settle_mutations(): remove_owned(config)
    return {'stopped': True, 'preservedHome': str(root / 'home'), 'preservedSchema': config['schema']}


def check_owned(config):
    root = Path(config['root']); details = json.loads((root / 'metadata.json').read_text()); base = f"http://127.0.0.1:{config['httpPort']}"
    cookie = http.cookiejar.CookieJar(); client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie)); authority = f"physicsos-validation.invalid:{config['httpPort']}"
    def get(path):
        with client.open(urllib.request.Request(base + path, headers={'host': authority, 'accept': 'application/json'}), timeout=10) as response:
            if response.status != 200 or response.headers.get_content_type() != 'application/json': raise RuntimeError('Expected successful candidate JSON')
            return json.load(response)
    if get('/readyz').get('status') != 'ready': raise RuntimeError('Candidate is not ready')
    password = (root / 'secrets/admin_password').read_text().strip()
    request = urllib.request.Request(base + '/physicsos/auth/login', method='POST', headers={'content-type': 'application/json', 'host': authority, 'origin': 'http://' + authority}, data=json.dumps({'schoolId': 'PHYSICSOS-OPEN', 'username': config['username'], 'password': password}).encode())
    with client.open(request, timeout=20) as response: data = json.load(response)
    if data.get('user', {}).get('role') != 'SUPER_ADMIN': raise RuntimeError('Unexpected candidate login role')
    me = get('/physicsos/auth/me')
    if me.get('user', {}).get('username') != config['username'] or me.get('user', {}).get('schoolId') != 'PHYSICSOS-OPEN': raise RuntimeError('Candidate account scope changed')
    get('/physicsos/admin/dashboard')
    current = metadata('container', details['container'])
    if not current or current['Image'] != details['image'] or not current['State']['Running']: raise RuntimeError('Candidate identity changed')
    result = {'verified': True, 'image': details['image'], 'readyJson': True, 'login': True, 'accountScope': True, 'protectedRead': True, 'port': config['httpPort']}
    protected = [mount for name in ['physicsos-app-1', 'physicsos-postgres-1', 'physicsos-redis-1'] for source in [metadata('container', name)] if source for mount in source['Mounts'] if mount.get('Destination', '').startswith(('/var/lib/physicsos', '/var/lib/postgresql', '/data'))]
    owned_path(root, root / 'state/acceptance.json', protected)
    private_json(root / 'state/acceptance.json', result)
    return result


def check(config):
    root = Path(config['root'])
    with lifecycle(root):
        owned_path(root, root / 'metadata.json', [])
        details = json.loads((root / 'metadata.json').read_text())
        current = metadata('container', details['container'])
        labels = current['Config'].get('Labels', {}) if current else {}
        bindings = current['NetworkSettings'].get('Ports', {}).get(f"{config['httpPort']}/tcp") or [] if current else []
        if not current or not current['State']['Running'] or current['Image'] != details['image'] or labels.get('io.physicsos.task') != config['task'] or labels.get('io.physicsos.role') != 'validation' or not any(binding.get('HostIp') == '127.0.0.1' and binding.get('HostPort') == str(config['httpPort']) for binding in bindings):
            raise RuntimeError('Owned candidate endpoint identity must match before authentication')
        return check_owned(config)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['start', 'stop', 'check'])
    parser.add_argument('--config', required=True); parser.add_argument('--image')
    args = parser.parse_args(); config = load(args.config)
    if args.action == 'stop': result = stop(config)
    elif args.action == 'check': result = check(config)
    else:
        if not args.image: raise ValueError('Candidate image is required')
        result = start(config, args.image)
    print(json.dumps(result)); return 0


if __name__ == '__main__':
    try: sys.exit(main())
    except Exception as error:
        print(json.dumps({'candidateError': type(error).__name__})); sys.exit(1)
