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
    if value.get('requireIsolatedNetwork') and not value.get('network'):
        raise ValueError('An explicit isolated network is required')
    if value.get('network'):
        if not re.fullmatch(r'physicsos-[A-Za-z0-9_.-]{1,80}', value['network']) or value['databaseOwner'] != value['task']:
            raise ValueError('Isolated validation network/database ownership differs')
        if not value.get('databaseDataRoot'):
            raise ValueError('An owned isolated database data path is required')
    root = Path(value['root'])
    if not root.is_absolute() or root.is_symlink() or ',' in str(root) or root == Path('/'):
        raise ValueError('Invalid validation directory')
    if value.get('network'):
        data = Path(value['databaseDataRoot'])
        if not data.is_absolute() or data.is_symlink() or data == root or root not in data.parents:
            raise ValueError('Isolated database path must be a private child of candidate root')
    search_configuration(value)
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


def prepare_profile_pool(path, old_port, new_port, seeded):
    if not path.exists():
        return
    original = path.read_text()
    redirected = redirect_pool(original, old_port, new_port)
    if redirected == original:
        return
    if not seeded:
        raise RuntimeError('Existing candidate profile still references the production model route')
    path.write_text(redirected)


@contextlib.contextmanager
def settle_mutations():
    cancelled = [False]
    def request_cancel(_number, _frame): cancelled[0] = True
    previous = {number: signal.getsignal(number) for number in [signal.SIGINT, signal.SIGTERM]}
    for number in previous: signal.signal(number, request_cancel)
    try: yield cancelled
    finally:
        for number, handler in previous.items(): signal.signal(number, handler)



def production_services():
    return [source for name in ['physicsos-app-1', 'physicsos-postgres-1', 'physicsos-redis-1']
            for source in [metadata('container', name)] if source]


def container_networks(container):
    return container.get('NetworkSettings', {}).get('Networks', {})


def require_task_container(config, container, role):
    labels = container.get('Config', {}).get('Labels') or {}
    if labels.get('io.physicsos.task') != config['task'] or labels.get('io.physicsos.role') != role:
        raise RuntimeError('Isolated network endpoint belongs to another task or role')


SEARCH_SOURCE = 'physicsos-searxng-1'
SEARCH_DESTINATION = '/etc/searxng/settings.yml'
SEARCH_URL = 'http://searxng:8080/search'
SEARCH_TMPFS = {'/etc/searxng': 'rw,noexec,nosuid,nodev,size=16777216',
                '/var/cache/searxng': 'rw,noexec,nosuid,nodev,size=67108864'}
SEARCH_HEALTH = 'python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen(\'http://127.0.0.1:8080/healthz\',timeout=4).status==200 else 1)"'


# New tmpfs directories must not make the root entrypoint chown a read-only
# production settings bind (or require restoring any dropped capabilities).
SEARCH_ENVIRONMENT = {'SEARXNG_BASE_URL': 'http://searxng:8080/', 'FORCE_OWNERSHIP': 'false'}


def search_configuration(config):
    """Opt-in only; no arbitrary image tags, mounts, environment or routes."""
    if 'searchCompanion' not in config:
        return None
    search = config['searchCompanion']
    fields = {'sourceContainerId', 'image', 'settingsFile', 'settingsSha256'}
    if not isinstance(search, dict) or set(search) != fields:
        raise ValueError('Search companion configuration has unknown or missing fields')
    if (config.get('requireIsolatedNetwork') is not True or not config.get('network')
            or config.get('databaseOwner') != config['task']):
        raise ValueError('Search companion requires an explicitly isolated task database/network')
    for field, pattern in [('sourceContainerId', r'[a-f0-9]{64}'), ('image', r'sha256:[a-f0-9]{64}'), ('settingsSha256', r'[a-f0-9]{64}')]:
        if not isinstance(search[field], str) or not re.fullmatch(pattern, search[field]):
            raise ValueError('Search companion requires full container/image IDs and SHA-256')
    raw = search['settingsFile']
    if (not isinstance(raw, str) or not raw or any(char in raw for char in [',', '\x00', '\n', '\r'])
            or not Path(raw).is_absolute() or str(Path(raw)) != raw or '..' in Path(raw).parts):
        raise ValueError('Search settings require a canonical absolute file path')
    name = 'physicsos-validation-' + config['task'] + '-searxng'
    if config['databaseContainer'] in {name, 'physicsos-validation-' + config['task'], SEARCH_SOURCE}:
        raise ValueError('Search companion/database names must be distinct')
    return {**search, 'task': config['task'], 'container': name, 'sourceContainer': SEARCH_SOURCE,
            'network': config['network'], 'databaseContainer': config['databaseContainer'], 'alias': 'searxng', 'url': SEARCH_URL}


def search_file_sha256(path):
    # Digest only: never decode, copy, log or return settings/secret contents.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as file:
        before = os.fstat(file.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            raise RuntimeError('Search settings must be a non-hardlinked regular file')
        digest = hashlib.sha256()
        for chunk in iter(lambda: file.read(65536), b''): digest.update(chunk)
        after = os.fstat(file.fileno())
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
            raise RuntimeError('Search settings changed while hashing')
        return digest.hexdigest()


def search_secret_path(config, instance):
    if not isinstance(instance, str) or not re.fullmatch(r'[a-f0-9]{32}', instance):
        raise RuntimeError('Search secret requires a valid instance identity')
    return Path(config['root']) / ('search-companion-' + instance + '.env')


def create_search_secret(config, instance, protected):
    path = search_secret_path(config, instance)
    owned_path(Path(config['root']), path, protected)
    # Independent random material, never derived from the public instance ID.
    content = b'SEARXNG_SECRET=' + os.urandom(32).hex().encode('ascii') + b'\n'
    identity = None
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as file:
            info = os.fstat(file.fileno()); identity = (info.st_dev, info.st_ino)
            file.write(content); file.flush(); os.fsync(file.fileno())
        return {'secretFile': str(path), 'secretSha256': hashlib.sha256(content).hexdigest()}
    except BaseException:
        # An exclusive-create collision or a replaced file belongs to someone
        # else. Only remove this invocation's inode, even after a partial write.
        if identity is not None:
            try: info = path.lstat()
            except FileNotFoundError: pass
            else:
                if (info.st_dev, info.st_ino) == identity and stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                    path.unlink()
        raise


def validate_search_secret(config, receipt, production=()):
    path = search_secret_path(config, receipt['instance'])
    if receipt.get('secretFile') != str(path):
        raise RuntimeError('Search secret file/instance binding differs')
    owned_path(Path(config['root']), path, [mount for service in production for mount in service.get('Mounts', [])])
    if not path.is_file(): raise RuntimeError('Search private env-file is missing')
    info = path.stat()
    if (info.st_uid != os.getuid() or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) not in {0o400, 0o600}
            or info.st_size != len(b'SEARXNG_SECRET=') + 65 or search_file_sha256(path) != receipt.get('secretSha256')):
        raise RuntimeError('Search private env-file ownership/permissions/SHA-256 differs')


def remove_created_search_secret(config, instance, secret, production):
    try: validate_search_secret(config, {**secret, 'instance': instance}, production)
    except (OSError, RuntimeError): return False
    search_secret_path(config, instance).unlink()
    return True


def verify_search_mounted_digest(container_id, expected):
    # A bind can retain an old inode after its host pathname is replaced. Check
    # the actual mounted file too; stdout is a digest, never configuration text.
    if not re.fullmatch(r'[a-f0-9]{64}', container_id):
        raise RuntimeError('Search digest inspection requires a full container ID')
    command = 'import hashlib\nh=hashlib.sha256()\nwith open("/etc/searxng/settings.yml","rb") as f:\n for b in iter(lambda:f.read(65536),b""): h.update(b)\nprint(h.hexdigest())'
    result = subprocess.run(['docker', 'exec', container_id, 'python3', '-B', '-c', command], check=True,
                            capture_output=True, text=True, timeout=15)
    if result.stdout.strip() != expected:
        raise RuntimeError('Search mounted settings SHA-256 differs')


def inspect_search_source(config, production):
    expected = search_configuration(config)
    source, image = metadata('container', SEARCH_SOURCE), metadata('image', expected['image'])
    labels = (source or {}).get('Config', {}).get('Labels') or {}
    if (not source or source.get('Id') != expected['sourceContainerId'] or source.get('Name') != '/' + SEARCH_SOURCE
            or source.get('Image') != expected['image'] or not image or image.get('Id') != expected['image']
            or labels.get('com.docker.compose.project') != 'physicsos' or labels.get('com.docker.compose.service') != 'searxng'
            or source.get('State', {}).get('Running') is not True or source.get('State', {}).get('Health', {}).get('Status') != 'healthy'):
        raise RuntimeError('Expected production search container/image identity or health differs')
    if set(image.get('Config', {}).get('Volumes') or {}) - set(SEARCH_TMPFS):
        raise RuntimeError('Search image declares an unsupported persistent volume')
    settings = [mount for mount in source.get('Mounts', []) if mount.get('Destination') == SEARCH_DESTINATION]
    if (len(settings) != 1 or settings[0].get('Type') != 'bind' or settings[0].get('RW') is not False
            or settings[0].get('Source') != expected['settingsFile']):
        raise RuntimeError('Production search settings must be the expected read-only file bind')
    protected = [mount for service in production for mount in service.get('Mounts', [])]
    protected.extend(mount for mount in source.get('Mounts', []) if mount is not settings[0])
    path = Path(expected['settingsFile'])
    owned_path(Path('/'), path, protected)
    if not path.is_file() or search_file_sha256(path) != expected['settingsSha256']:
        raise RuntimeError('Search settings file/SHA-256 differs')
    verify_search_mounted_digest(source['Id'], expected['settingsSha256'])
    return source, image


def validate_search_receipt(config, receipt):
    expected = search_configuration(config)
    extra = {'containerId', 'networkId', 'databaseContainerId', 'databaseImage', 'instance', 'secretFile', 'secretSha256'}
    if (not isinstance(receipt, dict) or set(receipt) != set(expected) | extra
            or any(receipt.get(key) != value for key, value in expected.items())):
        raise RuntimeError('Search companion receipt/configuration binding differs')
    for key in ['containerId', 'networkId', 'databaseContainerId']:
        if not isinstance(receipt[key], str) or not re.fullmatch(r'[a-f0-9]{64}', receipt[key]):
            raise RuntimeError('Search companion receipt requires full resource IDs')
    if (not isinstance(receipt['databaseImage'], str) or not re.fullmatch(r'sha256:[a-f0-9]{64}', receipt['databaseImage'])
            or not isinstance(receipt['instance'], str) or not re.fullmatch(r'[a-f0-9]{32}', receipt['instance'])
            or not isinstance(receipt['secretSha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', receipt['secretSha256'])
            or receipt['secretFile'] != str(search_secret_path(config, receipt['instance']))
            or len({receipt['containerId'], receipt['databaseContainerId'], receipt['sourceContainerId']}) != 3):
        raise RuntimeError('Search companion receipt identity differs')
    return receipt


def read_search_receipt(config, production, required=False):
    # Kept outside app-mounted state/home, so a candidate cannot replace it.
    path = Path(config['root']) / 'search-companion.json'
    owned_path(Path(config['root']), path, [mount for service in production for mount in service.get('Mounts', [])])
    if not path.exists():
        if required: raise RuntimeError('Search companion receipt is missing; prepare search first')
        return None
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise RuntimeError('Search companion receipt is not a private owned file')
    receipt = validate_search_receipt(config, json.loads(path.read_text()))
    validate_search_secret(config, receipt, production)
    return receipt


def validate_search_peer(config, container, network, search=False):
    identity = container.get('Id', '')
    if (not re.fullmatch(r'[a-f0-9]{64}', identity) or not re.fullmatch(r'sha256:[a-f0-9]{64}', container.get('Image', ''))
            or set(container_networks(container)) != {config['network']}
            or container_networks(container)[config['network']].get('NetworkID') != network['Id']):
        raise RuntimeError('Search network peer identity or single-network binding differs')
    endpoint = container_networks(container)[config['network']]
    aliases = (endpoint.get('Aliases') or []) + (endpoint.get('DNSNames') or [])
    host = container.get('HostConfig', {})
    if (endpoint.get('IPAMConfig') or endpoint.get('Links')
            or any(host.get(key) for key in ['ExtraHosts', 'Links', 'Dns', 'DnsOptions', 'DnsSearch'])
            or host.get('NetworkMode') not in {config['network'], network['Id']}):
        raise RuntimeError('Search network peer has a static address or alternate DNS/network route')
    if search:
        if ('searxng' not in (endpoint.get('Aliases') or [])
                or set(aliases) - {'searxng', container['Name'].lstrip('/'), identity, identity[:12]}
                or not endpoint.get('IPAddress')
                or (network.get('Containers') or {}).get(identity, {}).get('IPv4Address', '').split('/')[0] != endpoint['IPAddress']):
            raise RuntimeError('Search alias/address binding differs')
    elif any(alias.lower().rstrip('.') == 'searxng' for alias in aliases):
        raise RuntimeError('Another candidate endpoint claims the search alias')


def validate_search_container(config, receipt, container, image, network=None):
    validate_search_receipt(config, receipt)
    require_task_container(config, container, 'validation-search')
    labels = container.get('Config', {}).get('Labels') or {}
    settings, host = container.get('Config', {}), container.get('HostConfig', {})
    if (container.get('Id') != receipt['containerId'] or container.get('Name') != '/' + receipt['container']
            or container.get('Image') != receipt['image'] or settings.get('Image') != receipt['image']
            or image.get('Id') != receipt['image'] or labels.get('io.physicsos.search.instance') != receipt['instance']
            or labels.get('io.physicsos.search.settings-sha256') != receipt['settingsSha256']
            or labels.get('io.physicsos.search.secret-sha256') != receipt['secretSha256']):
        raise RuntimeError('Search companion full ID/image/name/label binding differs')
    original = image.get('Config', {})
    expected_env = dict(entry.split('=', 1) for entry in original.get('Env', []) if '=' in entry)
    expected_env.pop('SEARXNG_SECRET', None)
    expected_env.update(SEARCH_ENVIRONMENT)
    entries = settings.get('Env') or []
    environment = dict(entry.split('=', 1) for entry in entries if '=' in entry)
    secret = environment.pop('SEARXNG_SECRET', None)
    # Compare only a digest of the exact generated env-file line. No secret
    # value reaches argv, labels, receipts, diagnostics or returned manifests.
    if (len(entries) != len(environment) + 1 or environment != expected_env
            or not isinstance(secret, str) or not re.fullmatch(r'[a-f0-9]{64}', secret)
            or hashlib.sha256(('SEARXNG_SECRET=' + secret + '\n').encode('ascii')).hexdigest() != receipt['secretSha256']
            or any((settings.get(key) or []) != (original.get(key) or []) for key in ['Cmd', 'Entrypoint'])
            or any((settings.get(key) or '') != (original.get(key) or '') for key in ['User', 'WorkingDir'])):
        raise RuntimeError('Search companion command/environment differs from the pinned image')
    mounts = container.get('Mounts', [])
    binds = [mount for mount in mounts if mount.get('Type') != 'tmpfs']
    if (len(binds) != 1 or binds[0].get('Type') != 'bind' or binds[0].get('Source') != receipt['settingsFile']
            or binds[0].get('Destination') != SEARCH_DESTINATION or binds[0].get('RW') is not False
            or any(mount.get('Destination') not in SEARCH_TMPFS or mount.get('Source') or mount.get('Name') for mount in mounts if mount.get('Type') == 'tmpfs')
            or host.get('Tmpfs') != SEARCH_TMPFS or host.get('Binds') or host.get('VolumesFrom')):
        raise RuntimeError('Search companion may mount only read-only settings and private tmpfs')
    if (host.get('NetworkMode') not in {config['network'], receipt['networkId']} or host.get('Privileged')
            or any(host.get(key) for key in ['PortBindings', 'PublishAllPorts', 'CapAdd', 'Devices', 'DeviceRequests', 'ExtraHosts', 'Links', 'Dns', 'DnsOptions', 'DnsSearch', 'PidMode', 'UTSMode'])
            or host.get('IpcMode', '') not in {'', 'private'} or host.get('CapDrop') != ['ALL']
            or host.get('SecurityOpt') not in [['no-new-privileges:true'], ['no-new-privileges']]
            or host.get('LogConfig', {}).get('Type') != 'none' or host.get('RestartPolicy', {}).get('Name') != 'no'
            or any(container.get('NetworkSettings', {}).get('Ports', {}).values())
            or settings.get('Healthcheck', {}).get('Test') != ['CMD-SHELL', SEARCH_HEALTH]):
        raise RuntimeError('Search companion ports/security/healthcheck differ')
    if network is not None:
        validate_search_peer(config, container, network, search=True)
        if container.get('State', {}).get('Running') is not True or container.get('State', {}).get('Health', {}).get('Status') != 'healthy':
            raise RuntimeError('Search companion is not healthy')
        verify_search_mounted_digest(container['Id'], receipt['settingsSha256'])


def validate_search_members(config, network, pg, current, receipt):
    expected = {pg['Id']: config['databaseContainer']}
    if pg.get('Name') != '/' + config['databaseContainer']:
        raise RuntimeError('Search network database name differs')
    if current is not None:
        if current.get('Name') != '/physicsos-validation-' + config['task']:
            raise RuntimeError('Search network candidate name differs')
        require_task_container(config, current, 'validation')
        expected[current['Id']] = current['Name'].lstrip('/')
    if receipt is not None:
        validate_search_receipt(config, receipt)
        if receipt['networkId'] != network['Id'] or receipt['databaseContainerId'] != pg['Id'] or receipt['databaseImage'] != pg.get('Image'):
            raise RuntimeError('Search companion network/database receipt changed')
        expected[receipt['containerId']] = receipt['container']
    actual = {identity: endpoint.get('Name') for identity, endpoint in (network.get('Containers') or {}).items()}
    if actual != expected:
        raise RuntimeError('Search network members must be exactly the controlled candidate/database/search set')


def ensure_isolated_network(config, production, create=False, search_receipt=None):
    search = search_configuration(config)
    if search is not None:
        source, search_image = inspect_search_source(config, production)
        production = [*production, source]
        if search_receipt is None:
            search_receipt = read_search_receipt(config, production)
        else:
            validate_search_receipt(config, search_receipt)
            validate_search_secret(config, search_receipt, production)
    elif search_receipt is not None:
        raise RuntimeError('Search companion is not explicitly enabled')
    name = config['network']
    protected_names = {name for source in production for name in container_networks(source)}
    protected_ids = {value.get('NetworkID') for source in production for value in container_networks(source).values()}
    if name in protected_names:
        raise RuntimeError('Validation cannot join a production network')
    network = metadata('network', name)
    if network is None and create:
        subprocess.run(['docker', 'network', 'create', '--driver', 'bridge', '--label', 'io.physicsos.task=' + config['task'],
                        '--label', 'io.physicsos.role=validation-network', name], check=True, stdout=subprocess.DEVNULL)
        network = metadata('network', name)
    labels = (network or {}).get('Labels') or {}
    if not network or network.get('Driver') != 'bridge' or network.get('Scope', 'local') != 'local' or network.get('Id') in protected_ids or labels.get('io.physicsos.task') != config['task'] or labels.get('io.physicsos.role') != 'validation-network':
        raise RuntimeError('Isolated validation network ownership/driver differs')
    if search is not None and (network.get('Name') != name or not re.fullmatch(r'[a-f0-9]{64}', network.get('Id', ''))):
        raise RuntimeError('Search network requires its exact name and full ID')
    allowed = {config['databaseContainer']: 'validation-database', 'physicsos-validation-' + config['task']: 'validation'}
    if search_receipt is not None:
        if search_receipt['networkId'] != network['Id']:
            raise RuntimeError('Search companion network receipt changed')
        allowed[search_receipt['container']] = 'validation-search'
    protected_containers = {source.get('Id') for source in production}
    for endpoint_id, endpoint in (network.get('Containers') or {}).items():
        if endpoint_id in protected_containers or endpoint.get('Name') not in allowed:
            raise RuntimeError('Isolated network contains a production or foreign endpoint')
        source = metadata('container', endpoint_id)
        if not source or source.get('Id') != endpoint_id or source.get('Name', '').lstrip('/') != endpoint['Name']:
            raise RuntimeError('Isolated network endpoint identity changed')
        require_task_container(config, source, allowed[endpoint['Name']])
        if search is not None:
            if allowed[endpoint['Name']] == 'validation-search':
                validate_search_container(config, search_receipt, source, search_image, network)
            else:
                validate_search_peer(config, source, network)
                if search_receipt is not None and endpoint['Name'] == config['databaseContainer']:
                    if endpoint_id != search_receipt['databaseContainerId'] or source.get('Image') != search_receipt['databaseImage']:
                        raise RuntimeError('Search network database full ID/image changed')
    return network


def validate_isolated_database(config, pg, production, network, connect=False):
    require_task_container(config, pg, 'validation-database')
    if pg.get('Id') in {source.get('Id') for source in production}:
        raise RuntimeError('Validation cannot use a production database')
    if pg.get('HostConfig', {}).get('NetworkMode') in ['host', 'container:physicsos-app-1']:
        raise RuntimeError('Isolated database cannot share a host or production namespace')
    names = set(container_networks(pg))
    if names - {config['network']}:
        raise RuntimeError('Isolated database already belongs to another network')
    protected = [mount for source in production for mount in source.get('Mounts', [])]
    data_root = Path(config['databaseDataRoot'])
    owned_path(Path(config['root']), data_root, protected)
    data_mounts = [mount for mount in pg.get('Mounts', []) if mount.get('Destination', '').startswith('/var/lib/postgresql')]
    if not data_mounts or any(not mount.get('RW', True) or Path(mount.get('Source', '')).resolve() != data_root.resolve() for mount in data_mounts):
        raise RuntimeError('Isolated database data is not the task-owned data path')
    if any(same_data(a, b) for a in pg.get('Mounts', []) for b in protected):
        raise RuntimeError('Isolated database mounts production data')
    if config['network'] not in names:
        if not connect:
            raise RuntimeError('Isolated database is not attached to its task network')
        subprocess.run(['docker', 'network', 'connect', config['network'], pg['Id']], check=True, stdout=subprocess.DEVNULL)
        pg = metadata('container', config['databaseContainer'])
    if not pg or set(container_networks(pg)) != {config['network']} or container_networks(pg)[config['network']].get('NetworkID') != network['Id']:
        raise RuntimeError('Isolated database network identity changed')
    return pg


def check_isolated_resources(config, details=None, current=None, create=False, connect=False):
    production = production_services()
    if len(production) != 3:
        raise RuntimeError('Production protection metadata is incomplete')
    search_receipt = (read_search_receipt(config, production, required=True)
                      if search_configuration(config) is not None else None)
    # Search is prepared separately on an existing network/DB. A missing or
    # stale receipt must not trigger network creation or database attachment.
    network = ensure_isolated_network(config, production, create=create and search_receipt is None)
    if details and (details.get('network') != config['network'] or details.get('networkId') != network['Id'] or details.get('isolatedNetwork') is not True):
        raise RuntimeError('Candidate isolated network receipt changed')
    pg = metadata('container', config['databaseContainer'])
    if not pg:
        raise RuntimeError('Task-owned isolated database is unavailable')
    pg = validate_isolated_database(config, pg, production, network, connect=connect and search_receipt is None)
    search_current = current
    if search_receipt is not None:
        if search_current is None:
            search_current = metadata('container', 'physicsos-validation-' + config['task'])
        validate_search_members(config, network, pg, search_current, search_receipt)
        if details and 'searchCompanion' in details and details['searchCompanion'] != search_receipt:
            raise RuntimeError('Candidate search companion receipt changed')
    if current:
        require_task_container(config, current, 'validation')
        if set(container_networks(current)) != {config['network']} or container_networks(current)[config['network']].get('NetworkID') != network['Id']:
            raise RuntimeError('Candidate joined another network')
        if current.get('HostConfig', {}).get('NetworkMode') == 'host':
            raise RuntimeError('Candidate shares the host network')
        protected = [mount for source in production for mount in source.get('Mounts', [])]
        if any(same_data(a, b) for a in current.get('Mounts', []) if a.get('RW', True) for b in protected):
            raise RuntimeError('Candidate has writable production mounts')
        environment = dict(entry.split('=', 1) for entry in current.get('Config', {}).get('Env', []) if '=' in entry)
        if environment.get('DEEPSEEK_BASE_URL') != f"http://127.0.0.1:{config['modelPoolPort']}/v1" or environment.get('DATABASE_URL_FILE') != '/run/secrets/database_url':
            raise RuntimeError('Candidate private database/model route identity changed')
        if search_receipt is not None and (environment.get('PHYSICSOS_RESEARCH_SEARXNG_URL') != SEARCH_URL
                                           or environment.get('PHYSICSOS_RESEARCH_SEARXNG_KEY_FILE')):
            raise RuntimeError('Candidate search URL/credential route differs from its private companion')
        app = next((source for source in production if source.get('Name') == '/physicsos-app-1'), production[0])
        live_env = dict(entry.split('=', 1) for entry in app.get('Config', {}).get('Env', []) if '=' in entry)
        old_port = int(live_env.get('PHYSICSOS_MODEL_POOL_PORT', '3972'))
        reject_production_model_routes(config, environment.values(), production, network, old_port)
        settings = validation_worker_settings(config, protected)
        if settings is not None:
            token_mounts = [mount for mount in current.get('Mounts', []) if mount.get('Destination') == VALIDATION_WORKER_TOKEN_DESTINATION]
            if (any(environment.get(key) != value for key, value in settings['environment'].items())
                    or 'PHYSICSOS_VALIDATION_TOKEN' in environment or len(token_mounts) != 1
                    or token_mounts[0].get('Source') != settings['mount']['Source'] or token_mounts[0].get('RW') is not False):
                raise RuntimeError('Candidate private worker environment/token mount binding changed')
    network = ensure_isolated_network(config, production)
    if search_receipt is not None:
        validate_search_members(config, network, pg, search_current, search_receipt)
    return network, pg


def reject_production_model_routes(config, values, production, network, old_pool_port):
    # Cross-network container routes and Docker host gateways are never model
    # upstreams. External provider HTTPS remains available for real validation.
    hosts = {'host.docker.internal', 'gateway.docker.internal', 'host-gateway'}
    for source in production:
        if source.get('Name'): hosts.add(source['Name'].lstrip('/'))
        for endpoint in container_networks(source).values():
            hosts.update(filter(None, [endpoint.get('IPAddress'), endpoint.get('GlobalIPv6Address')]))
    for row in network.get('IPAM', {}).get('Config', []):
        if row.get('Gateway'): hosts.add(row['Gateway'])
    for value in values:
        for url in re.findall(r'https?://[^\s\'"<>]+', value):
            parsed = urllib.parse.urlsplit(url.rstrip('),;'))
            if parsed.hostname in hosts or parsed.hostname in ['127.0.0.1', 'localhost', '::1'] and parsed.port == old_pool_port and old_pool_port != config['modelPoolPort']:
                raise RuntimeError('Candidate configuration routes to production or a host model proxy')


def prepare_network(config):
    if not config.get('network'):
        raise ValueError('Network preparation requires an explicit isolated network')
    with lifecycle(Path(config['root'])):
        production = production_services()
        if len(production) != 3:
            raise RuntimeError('Production protection metadata is incomplete')
        network = ensure_isolated_network(config, production, create=True)
        return {'network': config['network'], 'networkId': network['Id'], 'task': config['task'], 'databaseStarted': False, 'candidateStarted': False}

def search_create_args(config, instance, secret):
    expected = search_configuration(config)
    if expected is None or not isinstance(instance, str) or not re.fullmatch(r'[a-f0-9]{32}', instance):
        raise ValueError('Search creation requires explicit configuration and a new instance ID')
    if (not isinstance(secret, dict) or set(secret) != {'secretFile', 'secretSha256'}
            or secret['secretFile'] != str(search_secret_path(config, instance))
            or not isinstance(secret['secretSha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', secret['secretSha256'])):
        raise ValueError('Search creation requires an instance-bound private env-file digest')
    args = ['docker', 'create', '--name', expected['container'], '--pull', 'never', '--log-driver', 'none', '--restart', 'no',
            '--network', expected['network'], '--network-alias', 'searxng', '--memory', '512m', '--cpus', '1',
            '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true']
    for key, value in {'io.physicsos.task': config['task'], 'io.physicsos.role': 'validation-search',
                       'io.physicsos.search.instance': instance, 'io.physicsos.search.settings-sha256': expected['settingsSha256'],
                       'io.physicsos.search.secret-sha256': secret['secretSha256']}.items():
        args.extend(['--label', key + '=' + value])
    for destination, options in SEARCH_TMPFS.items(): args.extend(['--tmpfs', destination + ':' + options])
    for key, value in SEARCH_ENVIRONMENT.items(): args.extend(['--env', key + '=' + value])
    args.extend(['--mount', 'type=bind,src=' + expected['settingsFile'] + ',dst=' + SEARCH_DESTINATION + ',readonly',
                 '--env-file', secret['secretFile'], '--health-cmd', SEARCH_HEALTH,
                 '--health-interval', '5s', '--health-timeout', '5s', '--health-retries', '6', '--health-start-period', '10s', expected['image']])
    return args


def remove_created_search(config, instance, container_id=None):
    expected = search_configuration(config)
    container = metadata('container', container_id or expected['container'])
    labels = (container or {}).get('Config', {}).get('Labels') or {}
    if (not container or not re.fullmatch(r'[a-f0-9]{64}', container.get('Id', ''))
            or container_id is not None and container.get('Id') != container_id
            or container.get('Name') != '/' + expected['container'] or container.get('Image') != expected['image']
            or labels.get('io.physicsos.task') != config['task'] or labels.get('io.physicsos.role') != 'validation-search'
            or labels.get('io.physicsos.search.instance') != instance):
        return False
    # Never rm by name, never remove volumes/networks or candidate data.
    subprocess.run(['docker', 'rm', '-f', container['Id']], check=True, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL, start_new_session=True, timeout=30)
    return True


def wait_search_healthy(receipt, cancelled):
    deadline = time.monotonic() + 90
    while True:
        container = metadata('container', receipt['containerId'])
        if (cancelled[0] or not container or container.get('Id') != receipt['containerId']
                or container.get('State', {}).get('Running') is not True):
            raise RuntimeError('Search companion did not acknowledge startup')
        health = container.get('State', {}).get('Health', {}).get('Status')
        if health == 'healthy': return
        if health != 'starting' or time.monotonic() >= deadline:
            raise RuntimeError('Search companion failed its healthcheck')
        time.sleep(1)


def prepare_search(config):
    """Create/reuse only search on an existing owned network/database/root.

    The separate receipt survives app refreshes. An unreceipted service is never
    adopted. Failure cleanup is limited to this invocation's nonce and full ID.
    """
    expected = search_configuration(config)
    if expected is None: raise ValueError('Search preparation requires searchCompanion')
    root = Path(config['root'])
    with lifecycle(root), settle_mutations() as cancelled:
        production = production_services()
        if len(production) != 3: raise RuntimeError('Production protection metadata is incomplete')
        source, image = inspect_search_source(config, production)
        protected = [mount for service in [*production, source] for mount in service.get('Mounts', [])]
        for path in [root / 'owner', root / 'search-companion.json']: owned_path(root, path, protected)
        if not (root / 'owner').is_file() or (root / 'owner').read_text().strip() != config['task']:
            raise RuntimeError('Search preparation requires an existing task-owned candidate root')
        receipt = read_search_receipt(config, [*production, source])
        network = ensure_isolated_network(config, production)
        pg = metadata('container', config['databaseContainer'])
        if not pg: raise RuntimeError('Task-owned isolated database is unavailable')
        pg = validate_isolated_database(config, pg, production, network)
        current = metadata('container', 'physicsos-validation-' + config['task'])
        validate_search_members(config, network, pg, current, receipt)
        if receipt is not None:
            return {'searchCompanion': receipt, 'created': False, 'receiptFile': str(root / 'search-companion.json')}
        if metadata('container', expected['container']):
            raise RuntimeError('Refusing to adopt an unreceipted search companion')
        instance, created_id, secret = os.urandom(16).hex(), None, None
        receipt = {**expected, 'networkId': network['Id'], 'databaseContainerId': pg['Id'], 'databaseImage': pg['Image'], 'instance': instance}
        try:
            if cancelled[0]: raise RuntimeError('Search preparation cancelled')
            secret = create_search_secret(config, instance, protected)
            receipt.update(secret)
            if cancelled[0]: raise RuntimeError('Search preparation cancelled')
            result = subprocess.run(search_create_args(config, instance, secret), check=True, capture_output=True,
                                    text=True, start_new_session=True, timeout=60)
            if not re.fullmatch(r'[a-f0-9]{64}', result.stdout.strip()):
                raise RuntimeError('Search creation did not return a full container ID')
            created_id = result.stdout.strip(); receipt['containerId'] = created_id
            actual = metadata('container', created_id)
            if not actual: raise RuntimeError('Created search companion is unavailable')
            validate_search_container(config, receipt, actual, image)
            if cancelled[0]: raise RuntimeError('Search preparation cancelled')
            subprocess.run(['docker', 'start', created_id], check=True, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, start_new_session=True, timeout=30)
            wait_search_healthy(receipt, cancelled)
            network = ensure_isolated_network(config, production, search_receipt=receipt)
            validate_search_members(config, network, pg, current, receipt)
            if cancelled[0]: raise RuntimeError('Search preparation cancelled')
            private_json(root / 'search-companion.json', receipt)
            if cancelled[0]: raise RuntimeError('Search preparation cancelled')
            return {'searchCompanion': receipt, 'created': True, 'receiptFile': str(root / 'search-companion.json')}
        except BaseException as error:
            removed = remove_created_search(config, instance, created_id)
            if removed and (root / 'search-companion.json').exists():
                if read_search_receipt(config, [*production, source]) == receipt:
                    (root / 'search-companion.json').unlink()
            if secret is not None:
                remove_created_search_secret(config, instance, secret, [*production, source])
            if isinstance(error, subprocess.SubprocessError):
                # Never propagate captured Docker output or a command with
                # environment arguments through helper callers' diagnostics.
                raise RuntimeError('Search companion Docker operation failed') from None
            raise


VALIDATION_WORKER_TOKEN_DESTINATION = '/run/secrets/ui_validation_token'


def validation_worker_settings(config, protected=()):
    """The only task-private extension: a loopback worker and one existing token.

    This is deliberately not an arbitrary environment/mount override. No token
    contents are read, copied or changed here, including on candidate refresh.
    """
    if 'validationWorker' not in config:
        return None
    worker = config['validationWorker']
    fields = {'port', 'url', 'tokenFile', 'mountDestination', 'publicOrigin'}
    if not isinstance(worker, dict) or set(worker) != fields:
        raise RuntimeError('Validation worker configuration has unknown or missing fields')
    if config.get('requireIsolatedNetwork') is not True or not config.get('network') or config.get('databaseOwner') != config['task']:
        raise RuntimeError('Validation worker requires a task-owned isolated network/database')
    port = worker['port']
    if type(port) is not int or not 1024 <= port <= 65535 or port in {config['httpPort'], config['modelPoolPort']}:
        raise RuntimeError('Validation worker requires a separate private port')
    if not isinstance(worker['url'], str) or worker['url'] != f'http://127.0.0.1:{port}':
        raise RuntimeError('Validation worker URL must be its exact private loopback endpoint')
    # Numeric loopback is the verified worker-internal origin; the .invalid
    # authority is separately useful for browser/CLI trusted-host checks.
    origins = {f'http://127.0.0.1:{config["httpPort"]}', f'http://physicsos-validation.invalid:{config["httpPort"]}'}
    if not isinstance(worker['publicOrigin'], str) or worker['publicOrigin'] not in origins:
        raise RuntimeError('Validation worker public origin must be an exact candidate authority')
    if worker['mountDestination'] != VALIDATION_WORKER_TOKEN_DESTINATION:
        raise RuntimeError('Validation worker token mount destination is fixed')
    raw = worker['tokenFile']
    if not isinstance(raw, str) or not raw or ',' in raw or '\x00' in raw:
        raise RuntimeError('Validation worker token path is invalid')
    token, root = Path(raw), Path(config['root'])
    if not token.is_absolute() or str(token) != raw or '..' in token.parts or root / 'secrets' not in token.parents:
        raise RuntimeError('Validation worker token must stay inside candidate secrets')
    owned_path(root, token, protected)
    if not token.exists():
        raise RuntimeError('Validation worker token must already exist')
    info = token.stat()
    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != 999
            or info.st_gid != 999 or stat.S_IMODE(info.st_mode) not in {0o400, 0o600}
            or not 24 <= info.st_size <= 4096):
        raise RuntimeError('Validation worker token must be an app-readable private regular file')
    return {'port': port, 'environment': {
        'PHYSICSOS_VALIDATION_URL': worker['url'],
        'PHYSICSOS_VALIDATION_TOKEN_FILE': VALIDATION_WORKER_TOKEN_DESTINATION,
        'PHYSICSOS_VALIDATION_PUBLIC_ORIGIN': worker['publicOrigin'],
    }, 'mount': {'Source': str(token), 'Destination': VALIDATION_WORKER_TOKEN_DESTINATION, 'ReadOnly': True}}


def apply_validation_worker(config, environment, mounts, protected=()):
    settings = validation_worker_settings(config, protected)
    if settings is None:
        return
    target = Path(VALIDATION_WORKER_TOKEN_DESTINATION)
    for mount in mounts:
        destination = Path(mount['Destination'])
        if (destination == target or destination in target.parents or target in destination.parents
                or mount.get('Source') == settings['mount']['Source']):
            raise RuntimeError('Validation worker token would overlap an existing mount')
    environment.pop('PHYSICSOS_VALIDATION_TOKEN', None)
    environment.update(settings['environment'])
    mounts.append(settings['mount'])


def seed_profile_file(source, destination):
    if destination.exists() or destination.is_symlink():
        if destination.is_symlink() or not destination.is_file() or destination.stat().st_nlink != 1:
            raise RuntimeError('Existing candidate profile is not a private regular file')
        return False
    if not source.is_file():
        return False
    # Refreshes retain their own settings; a raced-in file must not be truncated.
    with source.open('rb') as incoming, destination.open('xb') as outgoing:
        shutil.copyfileobj(incoming, outgoing)
    return True


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
    validation_worker_settings(config, [mount for source in [app, production_pg, redis] if source for mount in source['Mounts']])
    root = Path(config['root'])
    writable = ['owner', 'metadata.json', 'home', 'state', 'secrets', 'tools', 'home/profiles', 'home/profiles/web', 'home/profiles/web/node_modules', 'tools/candidate.patch.yml', 'secrets/database_url', 'secrets/admin_password', 'state/launch-spec.json', 'state/logger.json', 'state/launcher.json', 'state/launcher.log', 'state/runtime.log', 'state/auth-url', 'state/lifecycle.lock', 'state/intent.json']
    for path in [root, *(root / name for name in writable), *(root / 'home/profiles/web' / name for name in ['cordis.yml', 'cordis.patch.yml', 'package.json', 'pnpm-workspace.yaml'])]: owned_path(root, path, protected)
    if root.exists() and not (root / 'owner').exists() and any(root.iterdir()):
        raise RuntimeError('Validation directory is not an owned empty directory')
    isolated = None
    if config.get('network'):
        isolated, pg = check_isolated_resources(config, create=True, connect=True)
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
    seeded_profiles = set()
    for name in ['cordis.yml', 'cordis.patch.yml', 'package.json', 'pnpm-workspace.yaml']:
        if seed_profile_file(profile_source / name, profile / name):
            seeded_profiles.add(name)
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
    if isolated:
        isolated, pg = check_isolated_resources(config)
        network = config['network']
    else:
        # Compatibility only for existing legacy candidates without network.
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
    prepare_profile_pool(profile_patch, old_pool_port, config['modelPoolPort'], 'cordis.patch.yml' in seeded_profiles)
    environment = {name: value for name, value in environment.items() if name.endswith('_FILE') or (not re.search(r'KEY|PASSWORD|SECRET|TOKEN|CREDENTIAL|COOKIE|DATABASE_URL|REDIS_URL|SMTP|AUTHORIZATION', name) and not re.search(r'(?i)Bearer\s|[?&](?:token|api_key)=|://[^/\s]+:[^/\s]+@', value))}
    environment = {name: redirect_pool(value, old_pool_port, config['modelPoolPort']) for name, value in environment.items()}
    environment['REDIS_URL_FILE'] = ''
    environment.update({'DSH_HOME': '/var/lib/physicsos', 'DSH_TELEMETRY_DISABLED': '1', 'PHYSICSOS_STORAGE_BACKEND': 'postgres', 'PHYSICSOS_STORAGE_SCHEMA': config['schema'], 'DATABASE_URL_FILE': '/run/secrets/database_url', 'DEEPSEEK_BASE_URL': f"http://127.0.0.1:{config['modelPoolPort']}/v1", 'PHYSICSOS_ADMIN_PASSWORD_FILE': '/run/secrets/admin_password', 'PHYSICSOS_ADMIN_USERNAME': config['username'], 'PHYSICSOS_SHARED_STATE_BACKEND': 'memory', 'PHYSICSOS_MODEL_POOL_PORT': str(config['modelPoolPort']), 'PHYSICOS_TRUSTED_HOSTS': f'physicsos-validation.invalid:{port}', 'PHYSICOS_TRUSTED_PROXIES': '', 'PHYSICSOS_SESSIONS_ROOT': '/var/lib/physicsos/sessions', 'PHYSICSOS_REGISTRATION_MODE': 'open', 'PHYSICSOS_SMTP_USER_FILE': '', 'PHYSICSOS_SMTP_PASSWORD_FILE': ''})
    if search_configuration(config) is not None:
        environment.update({'PHYSICSOS_RESEARCH_SEARXNG_URL': SEARCH_URL, 'PHYSICSOS_RESEARCH_SEARXNG_KEY_FILE': ''})
    if isolated:
        reject_production_model_routes(config, [*environment.values(), *(p.read_text() for p in profile.glob('*.yml'))], production_services(), isolated, old_pool_port)
    mounts = [{'Source': str(paths['home']), 'Destination': '/var/lib/physicsos', 'ReadOnly': False}, {'Source': str(paths['tools']), 'Destination': '/run/physicsos-validation-tools', 'ReadOnly': True}]
    if (profile_source / 'node_modules').is_dir(): mounts.append({'Source': str(profile_source / 'node_modules'), 'Destination': '/var/lib/physicsos/profiles/web/node_modules', 'ReadOnly': True})
    private_values = [password, database, (paths['secrets'] / 'admin_password').read_text().strip()]
    for mount in app['Mounts']:
        destination = mount['Destination']
        if not destination.startswith('/run/secrets/') or destination in ['/run/secrets/smtp_user', '/run/secrets/smtp_password', '/run/secrets/redis_url', '/run/secrets/redis_password']: continue
        source = paths['secrets'] / destination.rsplit('/', 1)[-1] if destination in ['/run/secrets/database_url', '/run/secrets/admin_password'] else Path(mount['Source'])
        mounts.append({'Source': str(source), 'Destination': destination, 'ReadOnly': True})
        if source.is_file(): private_values.append(source.read_text().strip())
    apply_validation_worker(config, environment, mounts, [mount for service in [app, production_pg, redis] if service for mount in service['Mounts']])
    name = 'physicsos-validation-' + config['task']
    details = {'task': config['task'], 'container': name, 'image': image['Id'], 'productionImage': app['Image'], 'port': port, 'schema': config['schema'], 'home': str(paths['home']), 'root': str(root), 'username': config['username'], 'productionDataWritable': False, 'nativePreload': False}
    if isolated:
        details.update({'network': network, 'networkId': isolated['Id'], 'isolatedNetwork': True})
    if search_configuration(config) is not None:
        details['searchCompanion'] = read_search_receipt(config, production_services(), required=True)
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
        args.extend(['--health-cmd', f'node scripts/healthcheck.mjs http://127.0.0.1:{port}/readyz'])
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
                if config.get('network'): check_isolated_resources(config, spec['metadata'], actual)
            except BaseException:
                remove_owned(config)
                raise
        return {**spec['metadata'], 'containerId': actual['Id'], 'url': f'http://physicsos-validation.invalid:{port}', 'logDriver': 'none'}


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
    if config.get('network'): check_isolated_resources(config, details, current)
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
        if config.get('network'): check_isolated_resources(config, details, current)
        return check_owned(config)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['network', 'search', 'start', 'stop', 'check'])
    parser.add_argument('--config', required=True); parser.add_argument('--image')
    args = parser.parse_args(); config = load(args.config)
    if args.action == 'search':
        if args.image: raise ValueError('Search image must be pinned by full ID in searchCompanion')
        result = prepare_search(config)
    elif args.action == 'network': result = prepare_network(config)
    elif args.action == 'stop': result = stop(config)
    elif args.action == 'check': result = check(config)
    else:
        if not args.image: raise ValueError('Candidate image is required')
        result = start(config, args.image)
    print(json.dumps(result)); return 0


if __name__ == '__main__':
    try: sys.exit(main())
    except Exception as error:
        print(json.dumps({'candidateError': type(error).__name__})); sys.exit(1)
