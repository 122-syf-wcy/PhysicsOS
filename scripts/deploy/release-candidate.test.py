import importlib.util
import copy
import hashlib
import io
import json
from email.message import Message
from pathlib import Path
from urllib.response import addinfourl
import tempfile
import unittest
import os
import contextlib
import shlex
import traceback
from types import SimpleNamespace
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('candidate', Path(__file__).with_name('release-candidate.py'))
candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate)


class CandidateSafety(unittest.TestCase):
    def config(self, root):
        return {'task': 'validation', 'root': str(root), 'databaseContainer': 'private-pg', 'databaseOwner': 'validation-db', 'databaseUser': 'test_user', 'databaseName': 'test_db', 'schema': 'validation', 'username': 'qa-admin', 'httpPort': 13188, 'modelPoolPort': 13982, 'databasePasswordFile': '/private/key'}

    def test_data_ancestors_are_detected(self):
        self.assertTrue(candidate.same_data({'Source': '/data'}, {'Source': '/data/store'}))
        self.assertTrue(candidate.same_data({'Name': 'same'}, {'Name': 'same'}))
        self.assertFalse(candidate.same_data({'Source': '/test'}, {'Source': '/production'}))

    def test_owned_child_symlink_is_rejected_before_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'validation'; root.mkdir()
            production = Path(tmp) / 'production'; production.mkdir()
            (root / 'home').symlink_to(production, target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError, 'symlinks'):
                candidate.owned_path(root, root / 'home/profiles/web', [{'Source': str(production)}])
            self.assertEqual(list(production.iterdir()), [])

    def test_hardlinked_profile_is_rejected_before_truncation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'validation'; root.mkdir()
            source = Path(tmp) / 'production-config'; source.write_text('unchanged')
            os.link(source, root / 'profile')
            with self.assertRaisesRegex(RuntimeError, 'hard-linked'):
                candidate.owned_path(root, root / 'profile', [])
            self.assertEqual(source.read_text(), 'unchanged')

    def test_refresh_preserves_existing_candidate_profile_and_permissions(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'production-profile'; source.write_text('new production settings')
            target = Path(tmp) / 'candidate-profile'; target.write_text('candidate-owned settings'); target.chmod(0o600)
            inode = target.stat().st_ino
            self.assertFalse(candidate.seed_profile_file(source, target))
            self.assertEqual(target.read_text(), 'candidate-owned settings')
            self.assertEqual(target.stat().st_ino, inode)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_initial_profile_is_seeded_once_and_missing_source_is_not_created(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'production-profile'; source.write_text('initial settings')
            target = Path(tmp) / 'candidate-profile'
            self.assertTrue(candidate.seed_profile_file(source, target))
            self.assertEqual(target.read_text(), 'initial settings')
            source.write_text('later production settings')
            self.assertFalse(candidate.seed_profile_file(source, target))
            self.assertEqual(target.read_text(), 'initial settings')
            absent = Path(tmp) / 'missing-profile'
            self.assertFalse(candidate.seed_profile_file(Path(tmp) / 'missing-source', absent))
            self.assertFalse(absent.exists())

    def test_profile_seed_rejects_symlinks_and_hardlinks_without_touching_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'source'; source.write_text('unchanged')
            link = Path(tmp) / 'symlink'; link.symlink_to(source)
            with self.assertRaisesRegex(RuntimeError, 'regular file'):
                candidate.seed_profile_file(source, link)
            hardlink = Path(tmp) / 'hardlink'; os.link(source, hardlink)
            with self.assertRaisesRegex(RuntimeError, 'regular file'):
                candidate.seed_profile_file(source, hardlink)
            self.assertEqual(source.read_text(), 'unchanged')

    def test_existing_empty_candidate_patch_is_not_replaced(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'production-patch'; source.write_text('production override')
            target = Path(tmp) / 'candidate-patch'; target.write_text('')
            self.assertFalse(candidate.seed_profile_file(source, target))
            self.assertEqual(target.read_bytes(), b'')

    def test_wrong_endpoint_identity_prevents_any_http_authentication(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'validation'; root.mkdir()
            (root / 'metadata.json').write_text(json.dumps({'container': 'missing', 'image': 'candidate'}))
            with patch.object(candidate, 'lifecycle', return_value=contextlib.nullcontext()), patch.object(candidate, 'metadata', return_value=None), patch.object(candidate, 'check_owned') as request:
                with self.assertRaisesRegex(RuntimeError, 'identity'): candidate.check(self.config(root))
                request.assert_not_called()

    def test_production_pool_endpoint_is_redirected_to_private_pool(self):
        self.assertEqual(candidate.redirect_pool('http://127.0.0.1:38972/v1', 38972, 13982), 'http://127.0.0.1:13982/v1')
        self.assertEqual(candidate.redirect_pool('https://provider.example/v1', 38972, 13982), 'https://provider.example/v1')

    def test_profile_route_is_rewritten_only_for_a_new_seed(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'cordis.patch.yml'
            target.write_text('provider: http://127.0.0.1:38972/v1\n')
            candidate.prepare_profile_pool(target, 38972, 13982, True)
            self.assertEqual(target.read_text(), 'provider: http://127.0.0.1:13982/v1\n')
            original = target.stat()
            candidate.prepare_profile_pool(target, 38972, 13982, False)
            self.assertEqual(target.stat().st_ino, original.st_ino)
            self.assertEqual(target.stat().st_mtime_ns, original.st_mtime_ns)
            self.assertEqual(target.read_text(), 'provider: http://127.0.0.1:13982/v1\n')

    def test_existing_production_route_is_rejected_without_rewriting_profile(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'cordis.patch.yml'
            original = 'provider: http://localhost:38972/v1\n'
            target.write_text(original)
            with self.assertRaisesRegex(RuntimeError, 'production model route'):
                candidate.prepare_profile_pool(target, 38972, 13982, False)
            self.assertEqual(target.read_text(), original)

    def test_start_healthcheck_uses_private_candidate_port(self):
        for port, url in [(13188, 'http://127.0.0.1:13188/readyz'), (14188, 'http://127.0.0.1:14188/readyz')]:
            with self.subTest(port=port), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp) / 'validation'
                config = self.config(root); config['httpPort'] = port
                spec = {
                    'metadata': {'container': 'physicsos-validation-validation', 'image': 'sha256:candidate'},
                    'network': 'private-network', 'mounts': [], 'environment': {},
                    'command': ['node', 'scripts/docker-entrypoint.mjs', 'node', 'vendor/deepseek-harness/apps/cli/lib/bin.js', '--port', str(port)],
                }
                running = {'Id': 'a' * 64, 'State': {'Running': True}, 'Image': 'sha256:candidate'}
                with patch.object(candidate, 'lifecycle', return_value=contextlib.nullcontext()), patch.object(candidate, 'prepare', return_value=({}, spec, [])), patch.object(candidate, 'metadata', side_effect=[None, running]), patch.object(candidate.subprocess, 'run') as run:
                    result = candidate.start(config, 'candidate-image')
                self.assertEqual(result['containerId'], running['Id'])
                creates = [call.args[0] for call in run.call_args_list if call.args[0][:2] == ['docker', 'create']]
                self.assertEqual(len(creates), 1)
                args = creates[0]
                self.assertIn('--health-cmd', args, 'Candidate must override the image healthcheck port')
                health = shlex.split(args[args.index('--health-cmd') + 1])
                self.assertEqual(health, ['node', 'scripts/healthcheck.mjs', url])
                self.assertNotIn('http://127.0.0.1:3080/readyz', health)
                self.assertEqual(args[args.index('--publish') + 1], f'127.0.0.1:{port}:{port}')
                self.assertNotIn('--no-healthcheck', args)

    def test_production_schema_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = self.config(Path(tmp) / 'validation'); config['schema'] = 'physicsos'
            file = Path(tmp) / 'config.json'; file.write_text(json.dumps(config))
            with self.assertRaises(ValueError): candidate.load(file)

    def inspect_fixture(self, protected_root):
        data = {
            'physicsos-app-1': {'Id': 'app', 'State': {'Running': True}, 'Mounts': [{'Destination': '/var/lib/physicsos', 'Source': str(protected_root)}]},
            'private-pg': {'Id': 'private', 'State': {'Running': True}, 'Config': {'Labels': {'io.physicsos.task': 'validation-db'}}, 'Mounts': [{'Name': 'private-pg', 'Source': '/test-pg'}]},
            'physicsos-postgres-1': {'Id': 'production', 'Mounts': [{'Name': 'production-pg', 'Source': '/production-pg', 'Destination': '/var/lib/postgresql/data'}]},
        }
        return lambda kind, name: {'Id': 'candidate-image'} if kind == 'image' else data.get(name)

    def test_home_cannot_overlap_production_volume(self):
        with tempfile.TemporaryDirectory() as tmp:
            protected = Path(tmp) / 'production'; root = protected / 'validation'
            with patch.object(candidate, 'metadata', side_effect=self.inspect_fixture(protected)):
                with self.assertRaisesRegex(RuntimeError, 'overlaps production'): candidate.prepare(self.config(root), 'image')
            self.assertFalse(root.exists())

    def test_shared_postgres_rejected_before_source_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'validation'; inspector = self.inspect_fixture(Path(tmp) / 'production')
            def inspect(kind, name):
                value = inspector(kind, name)
                if name == 'private-pg': value['Mounts'] = [{'Name': 'production-pg'}]
                return value
            with patch.object(candidate, 'metadata', side_effect=inspect):
                with self.assertRaisesRegex(RuntimeError, 'shares production'): candidate.prepare(self.config(root), 'image')
            self.assertFalse(root.exists())

    def test_test_database_cannot_start_with_production_application_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'validation'; protected = Path(tmp) / 'production'
            inspector = self.inspect_fixture(protected)
            def inspect(kind, name):
                value = inspector(kind, name)
                if name == 'private-pg':
                    value['State']['Running'] = False
                    value['Mounts'] = [{'Source': str(protected), 'RW': True}]
                return value
            with patch.object(candidate, 'metadata', side_effect=inspect), patch.object(candidate.subprocess, 'run') as run:
                with self.assertRaisesRegex(RuntimeError, 'shares production'): candidate.prepare(self.config(root), 'image')
                run.assert_not_called()
            self.assertFalse(root.exists())





class IsolatedCandidateNetwork(unittest.TestCase):
    def fixture(self, root):
        task, name = 'ui-test', 'physicsos-ui-test'
        config = {'task': task, 'root': str(root), 'network': name, 'databaseOwner': task,
                  'databaseContainer': 'physicsos-ui-test-pg', 'databaseDataRoot': str(root / 'database-data'), 'modelPoolPort': 3198}
        production = [{'Id': role, 'Name': '/physicsos-' + role + '-1', 'Mounts': [{'Source': '/production/' + role}],
                       'NetworkSettings': {'Networks': {'physicsos_default': {'NetworkID': 'prod-network', 'IPAddress': '172.22.0.' + str(i + 2)}}}}
                      for i, role in enumerate(['app', 'postgres', 'redis'])]
        labels = {'io.physicsos.task': task, 'io.physicsos.role': 'validation-network'}
        network = {'Id': 'private-network', 'Name': name, 'Driver': 'bridge', 'Scope': 'local', 'Labels': labels, 'Containers': {},
                   'IPAM': {'Config': [{'Gateway': '172.30.0.1'}]}}
        pg = {'Id': 'test-pg', 'Name': '/' + config['databaseContainer'], 'Config': {'Labels': {'io.physicsos.task': task, 'io.physicsos.role': 'validation-database'}},
              'Mounts': [{'Source': config['databaseDataRoot'], 'Destination': '/var/lib/postgresql/data', 'RW': True}],
              'NetworkSettings': {'Networks': {name: {'NetworkID': 'private-network', 'IPAddress': '172.30.0.2'}}}}
        return config, production, network, pg

    def test_explicit_network_load_requires_owned_name_database_owner_and_private_data_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'private'
            config = CandidateSafety().config(root)
            config.update({'network': 'physicsos-ui-test', 'databaseOwner': config['task'], 'databaseDataRoot': str(root / 'database-data')})
            file = Path(tmp) / 'config.json'
            file.write_text(json.dumps(config)); self.assertEqual(candidate.load(file)['network'], 'physicsos-ui-test')
            for extra in [{'network': 'bridge'}, {'databaseOwner': 'other'}, {'databaseDataRoot': '/production/pg'}, {'network': '', 'requireIsolatedNetwork': True}]:
                file.write_text(json.dumps({**config, **extra}))
                with self.assertRaises(ValueError): candidate.load(file)

    def test_network_create_labels_only_new_task_resources_and_never_connects_production(self):
        config, production, network, _ = self.fixture(Path('/candidate'))
        with patch.object(candidate, 'metadata', side_effect=[None, network]), patch.object(candidate.subprocess, 'run') as run:
            self.assertEqual(candidate.ensure_isolated_network(config, production, create=True)['Id'], 'private-network')
        args = run.call_args.args[0]
        self.assertEqual(args[:3], ['docker', 'network', 'create'])
        self.assertIn('io.physicsos.task=ui-test', args)
        self.assertIn('io.physicsos.role=validation-network', args)
        self.assertNotIn('physicsos_default', args)

    def test_reuses_owned_bridge_but_rejects_foreign_owner_production_network_and_endpoints(self):
        config, production, network, pg = self.fixture(Path('/candidate'))
        with patch.object(candidate, 'metadata', return_value=network), patch.object(candidate.subprocess, 'run') as run:
            candidate.ensure_isolated_network(config, production, create=True); run.assert_not_called()
        for changed in [{**network, 'Labels': {}}, {**network, 'Id': 'prod-network'},
                        {**network, 'Containers': {'app': {'Name': 'physicsos-app-1'}}},
                        {**network, 'Containers': {'foreign': {'Name': 'unknown-candidate'}}}]:
            with patch.object(candidate, 'metadata', return_value=changed), patch.object(candidate.subprocess, 'run') as run:
                with self.assertRaises(RuntimeError): candidate.ensure_isolated_network(config, production, create=True)
                run.assert_not_called()
        with patch.object(candidate, 'metadata') as inspect:
            with self.assertRaises(RuntimeError): candidate.ensure_isolated_network({**config, 'network': 'physicsos_default'}, production)
            inspect.assert_not_called()

    def test_only_matching_database_endpoint_may_join_an_owned_network(self):
        config, production, network, pg = self.fixture(Path('/candidate'))
        network['Containers'] = {pg['Id']: {'Name': config['databaseContainer']}}
        with patch.object(candidate, 'metadata', side_effect=lambda kind, name: network if kind == 'network' else pg):
            candidate.ensure_isolated_network(config, production)
        pg['Config']['Labels']['io.physicsos.task'] = 'other-task'
        with patch.object(candidate, 'metadata', side_effect=lambda kind, name: network if kind == 'network' else pg):
            with self.assertRaisesRegex(RuntimeError, 'another task'): candidate.ensure_isolated_network(config, production)

    def test_isolated_database_cannot_share_another_network_or_production_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            config, production, network, pg = self.fixture(Path(tmp) / 'candidate')
            candidate.validate_isolated_database(config, pg, production, network)
            pg['NetworkSettings']['Networks']['physicsos_default'] = {'NetworkID': 'prod-network'}
            with patch.object(candidate.subprocess, 'run') as run:
                with self.assertRaisesRegex(RuntimeError, 'another network'): candidate.validate_isolated_database(config, pg, production, network, connect=True)
                run.assert_not_called()
            del pg['NetworkSettings']['Networks']['physicsos_default']
            pg['Mounts'][0]['Source'] = '/production/postgres'
            with self.assertRaisesRegex(RuntimeError, 'task-owned'): candidate.validate_isolated_database(config, pg, production, network)

    def test_private_model_route_rejects_production_ip_name_host_gateway_and_old_loopback_pool(self):
        config, production, network, _ = self.fixture(Path('/candidate'))
        candidate.reject_production_model_routes(config, ['https://api.provider.example/v1', 'http://127.0.0.1:3198/v1'], production, network, 3972)
        for url in ['http://172.22.0.2:3972/v1', 'http://physicsos-app-1:3972/v1', 'http://host.docker.internal:3972/v1', 'http://172.30.0.1:3972/v1', 'http://127.0.0.1:3972/v1']:
            with self.subTest(url=url), self.assertRaisesRegex(RuntimeError, 'production'):
                candidate.reject_production_model_routes(config, [url], production, network, 3972)

    def test_legacy_check_requires_a_published_loopback_and_isolation_before_authentication(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'candidate'; root.mkdir()
            config = CandidateSafety().config(root)
            config.update({'network': 'physicsos-ui-test', 'databaseOwner': config['task'], 'databaseDataRoot': str(root / 'database-data')})
            (root / 'metadata.json').write_text(json.dumps({'container': 'candidate', 'image': 'candidate-image'}))
            current = {'State': {'Running': True}, 'Image': 'candidate-image', 'Config': {'Labels': {'io.physicsos.task': config['task'], 'io.physicsos.role': 'validation'}},
                       'NetworkSettings': {'Ports': {'13188/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '13188'}]}}}
            with patch.object(candidate, 'lifecycle', return_value=contextlib.nullcontext()), patch.object(candidate, 'metadata', return_value=current), \
                    patch.object(candidate, 'check_isolated_resources', side_effect=RuntimeError('foreign network')) as isolation, \
                    patch.object(candidate, 'check_owned') as http:
                with self.assertRaisesRegex(RuntimeError, 'foreign network'): candidate.check(config)
                http.assert_not_called()
                isolation.side_effect = None
                candidate.check(config)
                http.assert_called_once_with(config)
                http.reset_mock()
                current['NetworkSettings']['Ports'] = None
                with self.assertRaisesRegex(RuntimeError, 'endpoint identity'): candidate.check(config)
                http.assert_not_called()

    def test_network_only_preparation_cannot_start_candidate_or_database(self):
        config, production, network, _ = self.fixture(Path('/candidate'))
        with patch.object(candidate, 'lifecycle', return_value=contextlib.nullcontext()), patch.object(candidate, 'production_services', return_value=production), patch.object(candidate, 'ensure_isolated_network', return_value=network), patch.object(candidate.subprocess, 'run') as run:
            result = candidate.prepare_network(config)
            self.assertFalse(result['candidateStarted']); self.assertFalse(result['databaseStarted']); run.assert_not_called()


class NativeValidationWorker(unittest.TestCase):
    @contextlib.contextmanager
    def fixture(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'candidate'; (root / 'secrets').mkdir(parents=True)
            token = root / 'secrets/ui_validation_app_token'
            token.write_bytes(b'mock-private-material-not-a-real-secret\n'); token.chmod(0o400)
            home = root / 'home'; home.mkdir(); (home / 'fixture').write_text('retained')
            production = Path(tmp) / 'production'; production.mkdir()
            (production / 'fixture').write_text('protected')
            config = CandidateSafety().config(root)
            config.update({'requireIsolatedNetwork': True, 'network': 'physicsos-worker-test', 'databaseOwner': config['task'],
                           'validationWorker': {'port': 13187, 'url': 'http://127.0.0.1:13187', 'tokenFile': str(token),
                                                'mountDestination': '/run/secrets/ui_validation_token',
                                                'publicOrigin': 'http://127.0.0.1:13188'}})
            original_stat = Path.stat
            def app_owned(path, *args, **kwargs):
                info = original_stat(path, *args, **kwargs)
                if path == token:
                    fields = list(info); fields[4] = 999; fields[5] = 999
                    return os.stat_result(fields)
                return info
            with patch.object(Path, 'stat', app_owned):
                yield config, token, home, production

    def test_safe_extension_adds_only_real_consumer_env_and_readonly_existing_token(self):
        with self.fixture() as (config, token, home, production):
            before = token.read_bytes(), token.stat().st_ino, token.stat().st_mode
            environment = {'DSH_HOME': '/var/lib/physicsos', 'PHYSICSOS_VALIDATION_TOKEN': 'mock-stale-value'}
            mounts = [{'Source': str(home), 'Destination': '/var/lib/physicsos', 'ReadOnly': False}]
            with patch.object(Path, 'read_bytes', side_effect=AssertionError('extension must not read tokens')):
                candidate.apply_validation_worker(config, environment, mounts, [{'Source': str(production)}])
            self.assertEqual(environment, {
                'DSH_HOME': '/var/lib/physicsos', 'PHYSICSOS_VALIDATION_URL': 'http://127.0.0.1:13187',
                'PHYSICSOS_VALIDATION_TOKEN_FILE': '/run/secrets/ui_validation_token',
                'PHYSICSOS_VALIDATION_PUBLIC_ORIGIN': 'http://127.0.0.1:13188'})
            self.assertEqual(mounts[-1], {'Source': str(token), 'Destination': '/run/secrets/ui_validation_token', 'ReadOnly': True})
            self.assertEqual(before, (token.read_bytes(), token.stat().st_ino, token.stat().st_mode))
            self.assertEqual((home / 'fixture').read_text(), 'retained')
            self.assertEqual((production / 'fixture').read_text(), 'protected')
            self.assertEqual(mounts[0], {'Source': str(home), 'Destination': '/var/lib/physicsos', 'ReadOnly': False})

    def test_explicit_browser_trusted_authority_is_the_only_second_origin(self):
        with self.fixture() as (config, token, home, production):
            config['validationWorker']['publicOrigin'] = 'http://physicsos-validation.invalid:13188'
            settings = candidate.validation_worker_settings(config)
            self.assertEqual(settings['environment']['PHYSICSOS_VALIDATION_PUBLIC_ORIGIN'], 'http://physicsos-validation.invalid:13188')

    def test_old_config_has_no_extension_or_changed_behavior(self):
        config = CandidateSafety().config(Path('/candidate'))
        environment, mounts = {'existing': 'retained'}, []
        candidate.apply_validation_worker(config, environment, mounts)
        self.assertEqual(environment, {'existing': 'retained'}); self.assertEqual(mounts, [])

    def test_unknown_fields_unsafe_routes_origins_and_destinations_are_rejected(self):
        changes = [
            {'extra': 'not-an-env-extension'}, {'url': 'http://physicsos-app-1:13187'},
            {'url': 'http://host.docker.internal:13187'}, {'url': 'https://provider.example:13187'},
            {'url': 'http://127.0.0.1:13187/path'}, {'url': 'http://localhost:13187'},
            {'url': 'http://127.0.0.1:3972'}, {'url': 'http://user:pass@127.0.0.1:13187'},
            {'publicOrigin': 'http://127.0.0.1:3080'}, {'publicOrigin': 'http://physicsos-validation.invalid:3080'},
            {'publicOrigin': 'http://localhost:13188'}, {'publicOrigin': 'http://127.0.0.1:13188/path'},
            {'publicOrigin': 'http://user:pass@127.0.0.1:13188'}, {'publicOrigin': 'https://127.0.0.1:13188'},
            {'mountDestination': '/run/secrets/database_url'}, {'port': True}, {'port': 13188}, {'port': 13982},
        ]
        with self.fixture() as (config, token, home, production):
            for changed in changes:
                with self.subTest(changed=changed), self.assertRaises(RuntimeError):
                    candidate.apply_validation_worker({**config, 'validationWorker': {**config['validationWorker'], **changed}}, {}, [], [{'Source': str(production)}])
            self.assertEqual((home / 'fixture').read_text(), 'retained')
            self.assertEqual((production / 'fixture').read_text(), 'protected')
            self.assertEqual(token.stat().st_mode & 0o777, 0o400)

    def test_escape_symlink_hardlink_missing_and_nonprivate_token_are_rejected(self):
        with self.fixture() as (config, token, home, production):
            for path in [str(production / 'fixture'), str(token.parent / '../home/fixture'), str(token) + ',readonly', str(token.parent / 'missing')]:
                with self.subTest(path=path), self.assertRaises(RuntimeError):
                    candidate.validation_worker_settings({**config, 'validationWorker': {**config['validationWorker'], 'tokenFile': path}})
            link = token.parent / 'link'; link.symlink_to(token)
            with self.assertRaisesRegex(RuntimeError, 'symlinks'):
                candidate.validation_worker_settings({**config, 'validationWorker': {**config['validationWorker'], 'tokenFile': str(link)}})
            hardlink = token.parent / 'linked'; os.link(token, hardlink)
            with self.assertRaisesRegex(RuntimeError, 'hard-linked'):
                candidate.validation_worker_settings(config)
            hardlink.unlink(); token.chmod(0o644)
            with self.assertRaisesRegex(RuntimeError, 'private regular'):
                candidate.validation_worker_settings(config)
            self.assertEqual((home / 'fixture').read_text(), 'retained')
            self.assertEqual((production / 'fixture').read_text(), 'protected')

    def test_duplicate_or_covering_mount_refuses_before_env_or_mount_mutation(self):
        with self.fixture() as (config, token, home, production):
            for destination in ['/run/secrets/ui_validation_token', '/run/secrets', '/run', '/run/secrets/ui_validation_token/child']:
                environment = {'unchanged': 'value'}
                mounts = [{'Source': '/different-file', 'Destination': destination, 'ReadOnly': True}]
                original = [dict(mount) for mount in mounts]
                with self.subTest(destination=destination), self.assertRaisesRegex(RuntimeError, 'overlap'):
                    candidate.apply_validation_worker(config, environment, mounts)
                self.assertEqual(environment, {'unchanged': 'value'}); self.assertEqual(mounts, original)

    def test_worker_extension_requires_isolation_and_never_accepts_production_data(self):
        with self.fixture() as (config, token, home, production):
            for changed in [{'network': ''}, {'requireIsolatedNetwork': False}, {'databaseOwner': 'other'}]:
                with self.assertRaisesRegex(RuntimeError, 'isolated'):
                    candidate.validation_worker_settings({**config, **changed})
            with self.assertRaisesRegex(RuntimeError, 'production'):
                candidate.validation_worker_settings(config, [{'Source': str(token.parent)}])


class CandidateSearchCompanion(unittest.TestCase):
    @contextlib.contextmanager
    def fixture(self, prepared=True):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp).resolve(); root = base / 'candidate'; root.mkdir(mode=0o700)
            config = CandidateSafety().config(root)
            config.update({'requireIsolatedNetwork': True, 'network': 'physicsos-search-test', 'databaseOwner': config['task'],
                           'databaseDataRoot': str(root / 'database-data')})
            (root / 'owner').write_text(config['task'])
            for directory in ['home', 'database-data']:
                (root / directory).mkdir(); (root / directory / 'retained').write_text('candidate user data')
            settings = base / 'searxng-settings.yml'; settings.write_text('use_default_settings: true\n')
            config['searchCompanion'] = {'sourceContainerId': '1' * 64, 'image': 'sha256:' + 'd' * 64,
                                         'settingsFile': str(settings), 'settingsSha256': hashlib.sha256(settings.read_bytes()).hexdigest()}
            production = [{'Id': letter * 64, 'Name': '/physicsos-' + role + '-1',
                           'Mounts': [{'Source': str(base / 'production' / role), 'Destination': '/data', 'RW': True}],
                           'NetworkSettings': {'Networks': {'physicsos_default': {'NetworkID': '6' * 64, 'IPAddress': '172.22.0.' + str(i + 2)}}}}
                          for i, (letter, role) in enumerate([('a', 'app'), ('b', 'postgres'), ('c', 'redis')])]
            for service in production:
                directory = Path(service['Mounts'][0]['Source']); directory.mkdir(parents=True)
                (directory / 'retained').write_text('production data')
            image = {'Id': config['searchCompanion']['image'], 'Config': {'Env': ['PATH=/usr/bin'], 'Entrypoint': ['/entrypoint.sh'], 'Cmd': ['serve'],
                     'User': '', 'WorkingDir': '/usr/local/searxng', 'Volumes': {'/etc/searxng': {}, '/var/cache/searxng': {}}}}
            source = {'Id': '1' * 64, 'Name': '/' + candidate.SEARCH_SOURCE, 'Image': image['Id'],
                      'State': {'Running': True, 'Health': {'Status': 'healthy'}},
                      'Config': {'Labels': {'com.docker.compose.project': 'physicsos', 'com.docker.compose.service': 'searxng'},
                                 'Env': ['SEARXNG_SECRET=mock-production-value-not-for-copying']},
                      'Mounts': [{'Type': 'bind', 'Source': str(settings), 'Destination': candidate.SEARCH_DESTINATION, 'RW': False}],
                      'NetworkSettings': {'Networks': {'physicsos_default': {'NetworkID': '6' * 64}}}}
            network = {'Id': '5' * 64, 'Name': config['network'], 'Driver': 'bridge', 'Scope': 'local',
                       'Labels': {'io.physicsos.task': config['task'], 'io.physicsos.role': 'validation-network'}, 'Containers': {}}
            def endpoint(identity, name, role, number, image_id):
                return {'Id': identity, 'Name': '/' + name, 'Image': image_id, 'State': {'Running': True}, 'Mounts': [],
                        'Config': {'Labels': {'io.physicsos.task': config['task'], 'io.physicsos.role': role}},
                        'HostConfig': {'NetworkMode': config['network']},
                        'NetworkSettings': {'Networks': {config['network']: {'NetworkID': network['Id'], 'IPAddress': '172.30.0.' + str(number), 'Aliases': [name]}}}}
            pg = endpoint('3' * 64, config['databaseContainer'], 'validation-database', 2, 'sha256:' + 'e' * 64)
            pg['Mounts'] = [{'Type': 'bind', 'Source': config['databaseDataRoot'], 'Destination': '/var/lib/postgresql/data', 'RW': True}]
            app = endpoint('4' * 64, 'physicsos-validation-' + config['task'], 'validation', 3, 'sha256:' + 'f' * 64)
            app['Config']['Env'] = [f"DEEPSEEK_BASE_URL=http://127.0.0.1:{config['modelPoolPort']}/v1", 'DATABASE_URL_FILE=/run/secrets/database_url',
                                    'PHYSICSOS_RESEARCH_SEARXNG_URL=' + candidate.SEARCH_URL, 'PHYSICSOS_RESEARCH_SEARXNG_KEY_FILE=']
            app['NetworkSettings']['Ports'] = {str(config['httpPort']) + '/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(config['httpPort'])}]}
            receipt = {**candidate.search_configuration(config), 'containerId': '2' * 64, 'networkId': network['Id'],
                       'databaseContainerId': pg['Id'], 'databaseImage': pg['Image'], 'instance': '7' * 32}
            secret_file = candidate.search_secret_path(config, receipt['instance'])
            secret_content = b'SEARXNG_SECRET=' + os.urandom(32).hex().encode('ascii') + b'\n'
            receipt.update({'secretFile': str(secret_file), 'secretSha256': hashlib.sha256(secret_content).hexdigest()})
            search = endpoint(receipt['containerId'], receipt['container'], 'validation-search', 4, image['Id'])
            search['Config'].update(copy.deepcopy(image['Config']))
            search['Config'].update({'Image': image['Id'], 'Healthcheck': {'Test': ['CMD-SHELL', candidate.SEARCH_HEALTH]}})
            search['Config']['Env'].extend(key + '=' + value for key, value in candidate.SEARCH_ENVIRONMENT.items())
            search['Config']['Env'].append(secret_content.decode('ascii').strip())
            search['Config']['Labels'].update({'io.physicsos.search.instance': receipt['instance'], 'io.physicsos.search.settings-sha256': receipt['settingsSha256'],
                                               'io.physicsos.search.secret-sha256': receipt['secretSha256']})
            search['State']['Health'] = {'Status': 'healthy'}
            search['Mounts'] = copy.deepcopy(source['Mounts'])
            search['HostConfig'].update({'Tmpfs': dict(candidate.SEARCH_TMPFS), 'CapDrop': ['ALL'], 'SecurityOpt': ['no-new-privileges:true'],
                                         'LogConfig': {'Type': 'none'}, 'RestartPolicy': {'Name': 'no'}})
            search['NetworkSettings']['Networks'][config['network']]['Aliases'].append('searxng')
            search['NetworkSettings']['Ports'] = {'8080/tcp': None}
            details = {'container': app['Name'].lstrip('/'), 'image': app['Image'], 'network': config['network'], 'networkId': network['Id'], 'isolatedNetwork': True}
            candidate.private_json(root / 'metadata.json', details)
            f = SimpleNamespace(config=config, root=root, settings=settings, production=production, source=source, image=image,
                                network=network, pg=pg, app=app, search=search, receipt=receipt, details=details, secret_file=secret_file,
                                containers=[*production, source, pg, app])
            for container in [pg, app]: self.attach(f, container)
            if prepared:
                secret_file.write_bytes(secret_content); secret_file.chmod(0o600)
                f.containers.append(search); self.attach(f, search)
                candidate.private_json(root / 'search-companion.json', receipt)
            def inspect(kind, name):
                if kind == 'network': return network if name in {network['Id'], config['network']} else None
                if kind == 'image': return image if name == config['searchCompanion']['image'] else None
                return next((container for container in f.containers if name in {container['Id'], container['Name'].lstrip('/')}), None)
            with patch.object(candidate, 'metadata', side_effect=inspect) as inspected, patch.object(candidate, 'verify_search_mounted_digest') as digest, \
                    patch.object(candidate, 'lifecycle', return_value=contextlib.nullcontext()), \
                    patch.object(candidate, 'settle_mutations', side_effect=lambda: contextlib.nullcontext([False])):
                f.inspected, f.digest = inspected, digest
                yield f

    def attach(self, f, container):
        ip = container['NetworkSettings']['Networks'][f.config['network']]['IPAddress']
        f.network['Containers'][container['Id']] = {'Name': container['Name'].lstrip('/'), 'IPv4Address': ip + '/16'}

    def docker_mutations(self, f, fail=None):
        def run(args, **kwargs):
            if args[:2] == ['docker', 'create']:
                labels = dict(args[i + 1].split('=', 1) for i, value in enumerate(args) if value == '--label')
                f.created_secret_file = Path(args[args.index('--env-file') + 1])
                private_line = f.created_secret_file.read_text().strip()
                environment = [entry for entry in f.image['Config']['Env'] if entry.split('=', 1)[0] not in {*candidate.SEARCH_ENVIRONMENT, 'SEARXNG_SECRET'}]
                environment.extend(args[i + 1] for i, value in enumerate(args) if value == '--env')
                f.search['Config']['Env'] = [*environment, private_line]
                f.search['Config']['Labels'].update(labels); f.containers.append(f.search)
                if fail in {'create', 'collision', 'sensitive-create'}:
                    if fail == 'collision': f.search['Config']['Labels']['io.physicsos.search.instance'] = '8' * 32
                    raise candidate.subprocess.CalledProcessError(1, args, output=private_line, stderr=private_line)
                return candidate.subprocess.CompletedProcess(args, 0, stdout=f.search['Id'] + '\n', stderr='')
            if args[:2] == ['docker', 'start']:
                self.assertEqual(args[2], f.search['Id']); self.attach(f, f.search)
                if fail == 'start': raise candidate.subprocess.CalledProcessError(1, args)
                if fail == 'health': f.search['State']['Health']['Status'] = 'unhealthy'
                if fail == 'peer': f.network['Containers']['9' * 64] = {'Name': 'unknownpeer'}
                return candidate.subprocess.CompletedProcess(args, 0)
            if args[:3] == ['docker', 'rm', '-f']:
                self.assertEqual(args, ['docker', 'rm', '-f', f.search['Id']])
                f.containers.remove(f.search); f.network['Containers'].pop(f.search['Id'], None)
                return candidate.subprocess.CompletedProcess(args, 0)
            raise AssertionError('Unexpected Docker mutation: ' + repr(args[:3]))
        return run

    def assert_data_retained(self, f):
        for directory in ['home', 'database-data']:
            self.assertEqual((f.root / directory / 'retained').read_text(), 'candidate user data')
        for service in f.production:
            self.assertEqual((Path(service['Mounts'][0]['Source']) / 'retained').read_text(), 'production data')
        self.assertEqual(json.loads((f.root / 'metadata.json').read_text()), f.details)

    def test_default_still_allows_only_two_endpoints_and_never_inspects_search(self):
        with self.fixture(prepared=False) as f, patch.object(candidate.subprocess, 'run') as run:
            legacy = {key: value for key, value in f.config.items() if key != 'searchCompanion'}
            candidate.ensure_isolated_network(legacy, f.production)
            f.digest.assert_not_called()
            self.attach(f, f.search); f.containers.append(f.search)
            with self.assertRaisesRegex(RuntimeError, 'foreign endpoint'):
                candidate.ensure_isolated_network(legacy, f.production)
            run.assert_not_called()

    def test_configuration_is_explicit_fixed_and_accepts_only_full_ids(self):
        with self.fixture() as f, patch.object(candidate.subprocess, 'run') as run:
            config_file = f.root / 'test-config.json'; config_file.write_text(json.dumps(f.config))
            self.assertEqual(candidate.load(config_file)['searchCompanion'], f.config['searchCompanion'])
            changes = [{'environment': {}}, {'url': 'http://host.docker.internal:8080/search'}, {'sourceContainerId': '1' * 12},
                       {'image': 'searxng/searxng:latest'}, {'image': 'sha256:' + 'd' * 63}, {'settingsSha256': 'short'},
                       {'settingsFile': 'relative.yml'}, {'settingsFile': '/config/../settings.yml'}, {'settingsFile': '/config,readonly'},
                       {'settingsFile': '/config\x00'}, {'settingsFile': '/config\n'}]
            for changed in changes:
                with self.subTest(changed=changed), self.assertRaises(ValueError):
                    candidate.search_configuration({**f.config, 'searchCompanion': {**f.config['searchCompanion'], **changed}})
            for changed in [{'requireIsolatedNetwork': False}, {'network': ''}, {'databaseOwner': 'another-task'}, {'searchCompanion': None}]:
                with self.subTest(changed=changed), self.assertRaises(ValueError): candidate.search_configuration({**f.config, **changed})
            run.assert_not_called()

    def test_source_settings_are_hashed_without_decoding_or_copying_contents(self):
        with self.fixture() as f, patch.object(Path, 'read_text', side_effect=AssertionError('No settings text reads')), \
                patch.object(Path, 'read_bytes', side_effect=AssertionError('No whole settings reads')):
            source, image = candidate.inspect_search_source(f.config, f.production)
            self.assertIs(source, f.source); self.assertIs(image, f.image)
            f.digest.assert_called_once_with(f.source['Id'], f.receipt['settingsSha256'])

    def test_source_full_identity_readonly_bind_health_and_settings_sha_are_mandatory(self):
        changes = [lambda f: f.source.update(Id='0' * 64), lambda f: f.source.update(Image='sha256:' + '0' * 64),
                   lambda f: f.image.update(Id='sha256:' + '0' * 64), lambda f: f.source.update(Name='/unexpected-source'),
                   lambda f: f.source['Config']['Labels'].update({'com.docker.compose.service': 'app'}),
                   lambda f: f.source['State']['Health'].update(Status='unhealthy'),
                   lambda f: f.source['Mounts'][0].update(RW=True), lambda f: f.source['Mounts'][0].update(Type='volume'),
                   lambda f: f.source['Mounts'][0].update(Source='/other/settings.yml'),
                   lambda f: f.image['Config']['Volumes'].update({'/data': {}}), lambda f: f.settings.write_text('changed\n')]
        for index, change in enumerate(changes):
            with self.subTest(case=index), self.fixture() as f, patch.object(candidate.subprocess, 'run') as run:
                change(f)
                with self.assertRaises(RuntimeError): candidate.inspect_search_source(f.config, f.production)
                run.assert_not_called(); self.assert_data_retained(f)

    def test_settings_symlinks_hardlinks_missing_files_and_production_data_overlap_fail_closed(self):
        for case in ['symlink', 'hardlink', 'missing', 'directory', 'production-data', 'business-secret']:
            with self.subTest(case=case), self.fixture() as f, patch.object(candidate.subprocess, 'run') as run:
                if case == 'symlink':
                    link = f.settings.with_name('link.yml'); link.symlink_to(f.settings)
                    f.config['searchCompanion']['settingsFile'] = str(link); f.source['Mounts'][0]['Source'] = str(link)
                elif case == 'hardlink': os.link(f.settings, f.settings.with_name('linked.yml'))
                elif case == 'missing': f.settings.unlink()
                elif case == 'directory': f.settings.unlink(); f.settings.mkdir()
                else:
                    f.production[0]['Mounts'].append({'Source': str(f.settings), 'Destination': '/data' if case == 'production-data' else '/run/secrets/key', 'RW': case == 'production-data'})
                with self.assertRaises(RuntimeError): candidate.inspect_search_source(f.config, f.production)
                run.assert_not_called()

    def test_three_pinned_members_accept_legacy_candidate_metadata_without_rewriting_it(self):
        with self.fixture() as f, patch.object(candidate.subprocess, 'run') as run:
            self.assertEqual(candidate.check_isolated_resources(f.config, f.details, f.app), (f.network, f.pg))
            candidate.check_isolated_resources(f.config, {**f.details, 'searchCompanion': f.receipt}, f.app)
            self.assert_data_retained(f); run.assert_not_called()
            f.digest.assert_any_call(f.search['Id'], f.receipt['settingsSha256'])

    def test_changed_or_untrusted_receipts_are_not_adopted(self):
        changes = [{'containerId': '2' * 12}, {'containerId': '0' * 64}, {'databaseContainerId': '0' * 64},
                   {'databaseImage': 'sha256:' + '0' * 64}, {'networkId': '0' * 64}, {'image': 'searxng:latest'},
                   {'task': 'other'}, {'instance': 'invalid'}, {'settingsSha256': '0' * 64}, {'extra': True},
                   {'secretFile': '/production/secret.env'}, {'secretSha256': 'invalid'}, {'secretSha256': '0' * 64}]
        for changed in changes:
            with self.subTest(changed=changed), self.fixture() as f, patch.object(candidate.subprocess, 'run') as run:
                candidate.private_json(f.root / 'search-companion.json', {**f.receipt, **changed})
                with self.assertRaises(RuntimeError): candidate.check_isolated_resources(f.config, f.details, f.app)
                run.assert_not_called()
        with self.fixture() as f:
            receipt_file = f.root / 'search-companion.json'; receipt_file.chmod(0o644)
            with self.assertRaisesRegex(RuntimeError, 'private owned'): candidate.read_search_receipt(f.config, f.production)
            receipt_file.chmod(0o600); receipt_file.unlink()
            with self.assertRaises(RuntimeError): candidate.ensure_isolated_network(f.config, f.production)

    def test_unknown_peers_extra_networks_alias_hijacking_static_routes_and_address_drift_are_rejected(self):
        def endpoint(f, service): return service['NetworkSettings']['Networks'][f.config['network']]
        changes = [lambda f: f.network['Containers'].update({'9' * 64: {'Name': 'unknownpeer'}}),
                   lambda f: f.network['Containers'].update({f.production[0]['Id']: {'Name': 'physicsos-app-1'}}),
                   lambda f: f.search['NetworkSettings']['Networks'].update({'physicsos_default': {'NetworkID': '6' * 64}}),
                   lambda f: f.app['NetworkSettings']['Networks'].update({'another-network': {'NetworkID': '0' * 64}}),
                   lambda f: f.pg['NetworkSettings']['Networks'].update({'another-network': {'NetworkID': '0' * 64}}),
                   lambda f: endpoint(f, f.search).update(Aliases=[f.receipt['container']]),
                   lambda f: endpoint(f, f.search)['Aliases'].append('foreign-service'),
                   lambda f: endpoint(f, f.app)['Aliases'].append('searxng'),
                   lambda f: f.app['HostConfig'].update(ExtraHosts=['searxng:172.22.0.10']),
                   lambda f: f.search['HostConfig'].update(Dns=['172.22.0.1']),
                   lambda f: endpoint(f, f.search).update(IPAMConfig={'IPv4Address': '172.30.0.4'}),
                   lambda f: f.network['Containers'][f.search['Id']].update(IPv4Address='172.30.0.99/16')]
        for index, change in enumerate(changes):
            with self.subTest(case=index), self.fixture() as f, patch.object(candidate.subprocess, 'run') as run:
                change(f)
                with self.assertRaises(RuntimeError): candidate.ensure_isolated_network(f.config, f.production)
                run.assert_not_called()
        with self.fixture() as f:
            f.network['Containers'].pop(f.search['Id'])
            with self.assertRaisesRegex(RuntimeError, 'exactly'): candidate.check_isolated_resources(f.config, f.details, f.app)

    def test_sidecar_rejects_public_ports_credentials_extra_mounts_and_security_changes(self):
        changes = [lambda f: f.search['Config']['Env'].append('API_KEY=mock-unapproved-value'),
                   lambda f: f.search['Config'].update(Cmd=['other-command']), lambda f: f.search['Config'].update(Image='searxng:latest'),
                   lambda f: f.search['Mounts'][0].update(RW=True),
                   lambda f: f.search['Mounts'].append({'Type': 'bind', 'Source': '/production/key', 'Destination': '/run/secrets/key', 'RW': False}),
                   lambda f: f.search['HostConfig']['Tmpfs'].update({'/data': 'rw'}),
                   lambda f: f.search['HostConfig'].update(PortBindings={'8080/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '8080'}]}),
                   lambda f: f.search['NetworkSettings']['Ports'].update({'8080/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '8080'}]}),
                   lambda f: f.search['HostConfig'].update(PublishAllPorts=True), lambda f: f.search['HostConfig'].update(Privileged=True),
                   lambda f: f.search['HostConfig'].update(CapAdd=['SYS_ADMIN']),
                   lambda f: f.search['Config']['Labels'].update({'io.physicsos.task': 'another-task'}),
                   lambda f: f.search['Config']['Labels'].update({'io.physicsos.search.instance': '0' * 32}),
                   lambda f: f.search['Config']['Labels'].update({'io.physicsos.search.secret-sha256': '0' * 64}),
                   lambda f: f.search['Config']['Env'].append('SEARXNG_SECRET=' + os.urandom(32).hex()),
                   lambda f: f.search['Config']['Env'].remove('FORCE_OWNERSHIP=false'),
                   lambda f: f.search['Config']['Env'].append('FORCE_OWNERSHIP=true')]
        for index, change in enumerate(changes):
            with self.subTest(case=index), self.fixture() as f:
                change(f)
                with self.assertRaises(RuntimeError): candidate.ensure_isolated_network(f.config, f.production)

    def test_create_command_uses_only_pinned_image_readonly_settings_and_private_search_dns(self):
        with self.fixture() as f:
            secret = {key: f.receipt[key] for key in ['secretFile', 'secretSha256']}
            args = candidate.search_create_args(f.config, f.receipt['instance'], secret)
            self.assertEqual(args[-1], f.image['Id']); self.assertEqual(args[args.index('--pull') + 1], 'never')
            self.assertEqual(args[args.index('--network') + 1], f.config['network'])
            self.assertEqual(args[args.index('--network-alias') + 1], 'searxng')
            self.assertEqual([args[i + 1] for i, item in enumerate(args) if item == '--env'],
                             ['SEARXNG_BASE_URL=http://searxng:8080/', 'FORCE_OWNERSHIP=false'])
            self.assertEqual(args[args.index('--env-file') + 1], str(f.secret_file))
            self.assertFalse(any('SEARXNG_SECRET=' in arg for arg in args))
            self.assertFalse(f.secret_file.read_text().strip().split('=', 1)[1] in repr(args))
            self.assertEqual(args[args.index('--log-driver') + 1], 'none')
            self.assertEqual([args[i + 1] for i, item in enumerate(args) if item == '--mount'],
                             ['type=bind,src=' + str(f.settings) + ',dst=/etc/searxng/settings.yml,readonly'])
            self.assertEqual(shlex.split(args[args.index('--health-cmd') + 1])[0], 'python3')
            for forbidden in ['--publish', '--publish-all', '--volumes-from', '--volume', '--extra-host', 'physicsos_default', 'mock-production-value-not-for-copying']:
                self.assertNotIn(forbidden, args)

    def test_search_action_creates_only_sidecar_and_publishes_private_receipt(self):
        with self.fixture(prepared=False) as f:
            before = f.settings.stat()
            with patch.object(candidate.subprocess, 'run', side_effect=self.docker_mutations(f)) as run:
                result = candidate.prepare_search(f.config)
            self.assertTrue(result['created']); self.assertEqual(result['searchCompanion']['containerId'], f.search['Id'])
            receipt_file = f.root / 'search-companion.json'
            self.assertEqual(result['receiptFile'], str(receipt_file)); self.assertEqual(receipt_file.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(receipt_file.read_text()), result['searchCompanion'])
            self.assertEqual(f.created_secret_file.stat().st_mode & 0o777, 0o600)
            self.assertEqual(result['searchCompanion']['secretFile'], str(f.created_secret_file))
            self.assertEqual(result['searchCompanion']['secretSha256'], hashlib.sha256(f.created_secret_file.read_bytes()).hexdigest())
            private_value = f.created_secret_file.read_text().strip().split('=', 1)[1]
            self.assertFalse(private_value in json.dumps(result))
            self.assertFalse('SEARXNG_SECRET' in json.dumps(result))
            self.assertFalse(any(private_value in repr(call.args[0]) for call in run.call_args_list))
            self.assertEqual([call.args[0][:2] for call in run.call_args_list], [['docker', 'create'], ['docker', 'start']])
            self.assertEqual((f.settings.stat().st_ino, f.settings.stat().st_mtime_ns), (before.st_ino, before.st_mtime_ns))
            self.assert_data_retained(f)
            candidate.check_isolated_resources(f.config, f.details, f.app)

    def test_reuse_and_failed_reuse_never_recreate_restart_or_delete_resources(self):
        with self.fixture() as f, patch.object(candidate.subprocess, 'run') as run:
            before = (f.root / 'search-companion.json').read_bytes()
            secret_before = (f.secret_file.stat().st_ino, hashlib.sha256(f.secret_file.read_bytes()).hexdigest())
            result = candidate.prepare_search(f.config)
            self.assertFalse(result['created']); self.assertEqual(result['searchCompanion'], f.receipt)
            f.search['State']['Health']['Status'] = 'unhealthy'
            with self.assertRaisesRegex(RuntimeError, 'not healthy'): candidate.prepare_search(f.config)
            run.assert_not_called(); self.assertEqual((f.root / 'search-companion.json').read_bytes(), before)
            self.assertEqual((f.secret_file.stat().st_ino, hashlib.sha256(f.secret_file.read_bytes()).hexdigest()), secret_before)
            self.assert_data_retained(f)

    def test_failure_cleanup_targets_only_this_invocations_full_id_and_preserves_all_data(self):
        for failure in ['create', 'start', 'health', 'peer', 'receipt']:
            with self.subTest(failure=failure), self.fixture(prepared=False) as f:
                writer = patch.object(candidate, 'private_json', side_effect=OSError('fixture write failure')) if failure == 'receipt' else contextlib.nullcontext()
                with patch.object(candidate.subprocess, 'run', side_effect=self.docker_mutations(f, failure)) as run, writer:
                    with self.assertRaises(Exception): candidate.prepare_search(f.config)
                removals = [call.args[0] for call in run.call_args_list if call.args[0][:2] == ['docker', 'rm']]
                self.assertEqual(removals, [['docker', 'rm', '-f', f.search['Id']]])
                self.assertFalse((f.root / 'search-companion.json').exists())
                self.assertEqual(list(f.root.glob('search-companion-*.env')), [])
                self.assertIn(f.pg, f.containers); self.assertIn(f.app, f.containers); self.assert_data_retained(f)
                self.assertFalse(any(call.args[0][:2] == ['docker', 'network'] for call in run.call_args_list))

    def test_cancellation_after_receipt_publication_removes_only_new_search_receipt_and_container(self):
        with self.fixture(prepared=False) as f:
            cancelled = [False]; write = candidate.private_json
            def publish_and_cancel(path, value):
                write(path, value); cancelled[0] = True
            with patch.object(candidate, 'settle_mutations', return_value=contextlib.nullcontext(cancelled)), \
                    patch.object(candidate, 'private_json', side_effect=publish_and_cancel), \
                    patch.object(candidate.subprocess, 'run', side_effect=self.docker_mutations(f)) as run:
                with self.assertRaisesRegex(RuntimeError, 'cancelled'): candidate.prepare_search(f.config)
            self.assertEqual(run.call_args.args[0], ['docker', 'rm', '-f', f.search['Id']])
            self.assertFalse((f.root / 'search-companion.json').exists())
            self.assertEqual(list(f.root.glob('search-companion-*.env')), []); self.assert_data_retained(f)

    def test_missing_receipt_or_stale_mounted_config_cannot_trigger_network_or_database_mutations(self):
        with self.fixture(prepared=False) as f, patch.object(candidate.subprocess, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'receipt is missing'):
                candidate.check_isolated_resources(f.config, create=True, connect=True)
            f.digest.side_effect = RuntimeError('Search mounted settings SHA-256 differs')
            with self.assertRaisesRegex(RuntimeError, 'SHA-256'): candidate.prepare_search(f.config)
            run.assert_not_called(); self.assert_data_retained(f)

    def test_private_secret_is_independent_randomness_and_never_part_of_args_or_manifest(self):
        with self.fixture(prepared=False) as f:
            instance, random_material = '8' * 32, os.urandom(32)
            with patch.object(candidate.os, 'urandom', return_value=random_material) as random:
                secret = candidate.create_search_secret(f.config, instance, [])
            random.assert_called_once_with(32)
            self.assertEqual(set(secret), {'secretFile', 'secretSha256'})
            path = Path(secret['secretFile']); content = path.read_bytes()
            self.assertTrue(content == b'SEARXNG_SECRET=' + random_material.hex().encode('ascii') + b'\n')
            self.assertEqual(path.name, 'search-companion-' + instance + '.env')
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(secret['secretSha256'], hashlib.sha256(content).hexdigest())
            args = candidate.search_create_args(f.config, instance, secret)
            self.assertFalse(random_material.hex() in repr(args))
            self.assertFalse(random_material.hex() in json.dumps(secret))
            for changed in [{'secretFile': str(f.root / 'home/secret.env')}, {'secretSha256': 'invalid'}, {'SEARXNG_SECRET': 'unapproved'}]:
                with self.subTest(changed=changed), self.assertRaises(ValueError):
                    candidate.search_create_args(f.config, instance, {**secret, **changed})
            self.assert_data_retained(f)

    def test_private_env_file_changes_fail_closed_before_any_docker_mutation(self):
        for case in ['missing', 'permissions', 'symlink', 'hardlink', 'content', 'size', 'owner', 'production-mount']:
            with self.subTest(case=case), self.fixture() as f, patch.object(candidate.subprocess, 'run') as run:
                if case == 'missing': f.secret_file.unlink()
                elif case == 'permissions': f.secret_file.chmod(0o644)
                elif case == 'symlink':
                    target = f.secret_file.with_suffix('.saved'); f.secret_file.rename(target); f.secret_file.symlink_to(target)
                elif case == 'hardlink': os.link(f.secret_file, f.root / 'linked-secret.env')
                elif case == 'content': f.secret_file.write_bytes(b'SEARXNG_SECRET=' + os.urandom(32).hex().encode('ascii') + b'\n')
                elif case == 'size': f.secret_file.write_bytes(b'not-an-env-file\n')
                elif case == 'production-mount': f.production[0]['Mounts'].append({'Source': str(f.secret_file), 'Destination': '/run/secrets/key', 'RW': False})
                original_stat = Path.stat
                def wrong_owner(path, *args, **kwargs):
                    info = original_stat(path, *args, **kwargs)
                    if case == 'owner' and path == f.secret_file:
                        fields = list(info); fields[4] = os.getuid() + 1; return os.stat_result(fields)
                    return info
                with patch.object(Path, 'stat', wrong_owner):
                    with self.assertRaises(RuntimeError): candidate.prepare_search(f.config)
                run.assert_not_called(); self.assert_data_retained(f)

    def test_secret_exclusive_create_and_partial_write_cleanup_preserve_existing_private_files(self):
        with self.fixture() as f:
            before = f.secret_file.stat().st_ino, hashlib.sha256(f.secret_file.read_bytes()).hexdigest()
            with self.assertRaises(FileExistsError): candidate.create_search_secret(f.config, f.receipt['instance'], [])
            self.assertEqual((f.secret_file.stat().st_ino, hashlib.sha256(f.secret_file.read_bytes()).hexdigest()), before)
            with patch.object(candidate.os, 'fsync', side_effect=OSError('fixture write failure')):
                with self.assertRaises(OSError): candidate.create_search_secret(f.config, '8' * 32, [])
            self.assertFalse(candidate.search_secret_path(f.config, '8' * 32).exists())
            self.assertTrue(f.secret_file.exists()); self.assert_data_retained(f)

    def test_secret_cleanup_refuses_another_instance_or_changed_file(self):
        with self.fixture() as f:
            secret = {key: f.receipt[key] for key in ['secretFile', 'secretSha256']}
            self.assertFalse(candidate.remove_created_search_secret(f.config, '8' * 32, secret, []))
            changed = {**secret, 'secretSha256': '0' * 64}
            self.assertFalse(candidate.remove_created_search_secret(f.config, f.receipt['instance'], changed, []))
            self.assertTrue(f.secret_file.exists()); self.assert_data_retained(f)

    def test_subprocess_failure_diagnostics_do_not_expose_secret_output_or_environment_args(self):
        with self.fixture(prepared=False) as f, patch.object(candidate.subprocess, 'run', side_effect=self.docker_mutations(f, 'sensitive-create')):
            try: candidate.prepare_search(f.config)
            except RuntimeError as error:
                diagnostics = ''.join(traceback.format_exception(type(error), error, error.__traceback__))
                self.assertEqual(str(error), 'Search companion Docker operation failed')
                self.assertNotIn('SEARXNG_SECRET=', diagnostics)
                self.assertNotIn('SEARXNG_BASE_URL=', diagnostics)
                self.assertNotIn('FORCE_OWNERSHIP=', diagnostics)
                self.assertTrue(error.__suppress_context__)
            else: self.fail('Expected sanitized Docker failure')
            self.assertEqual(list(f.root.glob('search-companion-*.env')), [])
            self.assert_data_retained(f)

    def test_search_cli_uses_config_only_and_rejects_an_image_override(self):
        with self.fixture() as f, patch.object(candidate, 'load', return_value=f.config), \
                patch.object(candidate, 'prepare_search', return_value={'created': False}) as prepare, patch('builtins.print'):
            with patch.object(candidate.sys, 'argv', ['release-candidate.py', 'search', '--config', '/private/config.json']):
                self.assertEqual(candidate.main(), 0)
            prepare.assert_called_once_with(f.config); prepare.reset_mock()
            with patch.object(candidate.sys, 'argv', ['release-candidate.py', 'search', '--config', '/private/config.json', '--image', 'searxng:latest']):
                with self.assertRaisesRegex(ValueError, 'pinned'): candidate.main()
            prepare.assert_not_called()

    def test_unreceipted_or_raced_in_instances_are_not_adopted_or_deleted(self):
        with self.fixture(prepared=False) as f, patch.object(candidate.subprocess, 'run') as run:
            f.containers.append(f.search)
            with self.assertRaisesRegex(RuntimeError, 'unreceipted'): candidate.prepare_search(f.config)
            run.assert_not_called(); self.assert_data_retained(f)
        with self.fixture(prepared=False) as f, patch.object(candidate.subprocess, 'run', side_effect=self.docker_mutations(f, 'collision')) as run:
            with self.assertRaisesRegex(RuntimeError, 'Docker operation failed'): candidate.prepare_search(f.config)
            self.assertEqual([call.args[0][:2] for call in run.call_args_list], [['docker', 'create']])
            self.assertEqual(list(f.root.glob('search-companion-*.env')), [])
            self.assertIn(f.search, f.containers); self.assert_data_retained(f)
        with self.fixture() as f, patch.object(candidate.subprocess, 'run') as run:
            self.assertFalse(candidate.remove_created_search(f.config, '0' * 32, f.search['Id']))
            self.assertFalse(candidate.remove_created_search(f.config, f.receipt['instance'], f.app['Id']))
            run.assert_not_called()

    def test_search_guard_runs_before_candidate_authentication(self):
        for case in ['unhealthy', 'missing-receipt', 'wrong-url', 'production-key']:
            with self.subTest(case=case), self.fixture() as f, patch.object(candidate, 'check_owned') as authenticate:
                if case == 'unhealthy': f.search['State']['Health']['Status'] = 'unhealthy'
                elif case == 'missing-receipt': (f.root / 'search-companion.json').unlink()
                elif case == 'wrong-url': f.app['Config']['Env'][2] = 'PHYSICSOS_RESEARCH_SEARXNG_URL=http://172.22.0.9:8080/search'
                else: f.app['Config']['Env'][3] = 'PHYSICSOS_RESEARCH_SEARXNG_KEY_FILE=/run/secrets/production_key'
                with self.assertRaises(RuntimeError): candidate.check(f.config)
                authenticate.assert_not_called(); self.assert_data_retained(f)

    def test_digest_probe_is_full_id_bound_and_exposes_only_sha256(self):
        result = candidate.subprocess.CompletedProcess([], 0, stdout='a' * 64 + '\n')
        with patch.object(candidate.subprocess, 'run', return_value=result) as run:
            candidate.verify_search_mounted_digest('1' * 64, 'a' * 64)
            self.assertEqual(run.call_args.args[0][:6], ['docker', 'exec', '1' * 64, 'python3', '-B', '-c'])
            self.assertTrue(run.call_args.kwargs['capture_output'])
            with self.assertRaisesRegex(RuntimeError, 'SHA-256'): candidate.verify_search_mounted_digest('1' * 64, 'b' * 64)
            count = run.call_count
            with self.assertRaisesRegex(RuntimeError, 'full container ID'): candidate.verify_search_mounted_digest('1' * 12, 'a' * 64)
            self.assertEqual(run.call_count, count)


class CandidateTeachingTools(unittest.TestCase):
    def capacity_result(self, binding):
        cpu = {'NanoCpus': 0, 'CpuPeriod': 0, 'CpuQuota': 0, 'CpusetCpus': ''}
        return {'scope': 'capacity', 'revision': binding['revision'], 'sourceDigest': binding['sourceDigest'],
                'exitCode': 0, 'passed': True, 'passedTests': 2, 'failedTests': 0, 'pendingTests': 0,
                'inputs': {'PHYSICSOS_ACTIVITY_RUN_CAPACITY': '1', 'PHYSICSOS_ACTIVITY_BASE_DAILY_USERS': '6',
                           'PHYSICSOS_ACTIVITY_EVENTS_PER_USER_DAY': '73', 'PHYSICSOS_ACTIVITY_BASE_ROSTER_USERS': '80',
                           'PHYSICSOS_ACTIVITY_BASE_SCHOOLS': '70'},
                'cpuProfile': {'referenceContainer': 'physicsos-app-1', 'reference': dict(cpu), 'runner': dict(cpu)}}

    def pin_capacity(self, config, path, result):
        raw = result if isinstance(result, bytes) else json.dumps(result).encode()
        path.write_bytes(raw); path.chmod(0o600)
        config['activityCapacity'] = {'path': str(path), 'sha256': hashlib.sha256(raw).hexdigest()}

    @contextlib.contextmanager
    def fixture(self, mode='bridge', existing=True, capacity=False, internal=False):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp).resolve(); root = base / ('teaching-' + mode)
            for name in ['home', 'state', 'tools', 'secrets', 'database-data']:
                (root / name).mkdir(parents=True, mode=0o700)
                (root / name / 'retained').write_text('owned fixture data')
            config = CandidateSafety().config(root)
            config.update({'task': 'teaching-' + mode, 'teachingToolsMode': mode, 'requireIsolatedNetwork': True,
                           'network': 'physicsos-teaching-' + mode, 'databaseOwner': 'teaching-' + mode,
                           'databaseContainer': 'physicsos-teaching-' + mode + '-pg', 'schema': 'teaching_' + mode,
                           'databaseDataRoot': str(root / 'database-data')})
            if mode == 'enabled': config.update(httpPort=14188, modelPoolPort=14982)
            (root / 'owner').write_text(config['task'])
            password = base / 'fixture-password'; password.write_text('fake-private-db-material')
            config['databasePasswordFile'] = str(password)
            image = {'Id': 'sha256:' + 'd' * 64, 'Config': {'Env': ['PATH=/usr/bin', candidate.ACTIVITY_CAPACITY_ENV + '=true'],
                     'Entrypoint': [], 'Labels': {'physicsos.manifest.digest': 'e' * 64,
                                                  'physicsos.teaching-tools.bridge': candidate.TEACHING_TOOLS_CAPABILITY}}}
            binding = {'image': image['Id'], 'revision': 'a' * 40, 'sourceDigest': 'b' * 64, 'codeDigest': 'c' * 64,
                       'manifestSha256': 'e' * 64, 'capabilitySha256': 'f' * 64, 'capability': candidate.TEACHING_TOOLS_CAPABILITY}
            image['Config']['Labels'].update({'org.opencontainers.image.revision': binding['revision'],
                                               'physicsos.source.digest': binding['sourceDigest'], 'physicsos.code.digest': binding['codeDigest']})
            if capacity:
                self.assertEqual(mode, 'enabled')
                proof_dir = base / 'operator-only'; proof_dir.mkdir(mode=0o700)
                self.pin_capacity(config, proof_dir / 'result.json', self.capacity_result(binding))
            details = {'task': config['task'], 'container': 'physicsos-validation-' + config['task'], 'image': image['Id'],
                       'port': config['httpPort'], 'schema': config['schema'], 'root': str(root), 'home': str(root / 'home'),
                       'username': config['username'], 'network': config['network'], 'networkId': '5' * 64,
                       'isolatedNetwork': True, 'teachingToolsMode': mode, 'teachingToolsImage': binding,
                       'candidateInstance': '6' * 32, 'databaseContainerId': '8' * 64,
                       **{key: config[key] for key in ['modelPoolPort', 'databaseContainer', 'databaseDataRoot', 'databaseName', 'databaseUser']}}
            environment = {'PATH': '/usr/bin', candidate.TEACHING_TOOLS_ENV: mode,
                           candidate.ACTIVITY_CAPACITY_ENV: 'true' if capacity else 'false',
                           'PHYSICSOS_MODEL_POOL_PORT': str(config['modelPoolPort']),
                           'PHYSICSOS_PUBLIC_URL': f"http://127.0.0.1:{config['httpPort']}",
                           'DEEPSEEK_BASE_URL': f"http://127.0.0.1:{config['modelPoolPort']}/v1",
                           'DATABASE_URL_FILE': '/run/secrets/database_url', 'PRESERVED_FILE': '/run/secrets/fixture'}
            spec = {'metadata': details, 'environment': environment, 'network': config['network'],
                    'command': ['node', 'scripts/docker-entrypoint.mjs', 'node', 'vendor/deepseek-harness/apps/cli/lib/bin.js', '--port', str(config['httpPort'])],
                    'mounts': [{'Source': str(root / 'home'), 'Destination': '/var/lib/physicsos', 'ReadOnly': False}]}
            if capacity: spec['activityCapacity'] = dict(config['activityCapacity'])
            details['fingerprint'] = candidate.candidate_fingerprint(spec)
            if existing: details['containerId'] = '7' * 64
            container = {'Id': '7' * 64, 'Name': '/' + details['container'], 'Image': image['Id'], 'State': {'Running': True},
                         'Config': {'Image': image['Id'], 'Env': [key + '=' + value for key, value in environment.items()],
                                    'Cmd': list(spec['command']), 'Entrypoint': [], 'Labels': {
                                        'io.physicsos.task': config['task'], 'io.physicsos.role': 'validation',
                                        'io.physicsos.teaching-tools.mode': mode, 'io.physicsos.candidate.instance': details['candidateInstance'],
                                        'io.physicsos.candidate.fingerprint': details['fingerprint']}},
                         'Mounts': [{'Source': str(root / 'home'), 'Destination': '/var/lib/physicsos', 'RW': True}],
                         'HostConfig': {'NetworkMode': config['network'], 'PortBindings': {
                             str(config['httpPort']) + '/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(config['httpPort'])}]}},
                         'NetworkSettings': {'Networks': {config['network']: {'NetworkID': '5' * 64, 'IPAddress': '172.30.0.3'}},
                                             'Ports': {str(config['httpPort']) + '/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(config['httpPort'])}]}}}
            production = []
            for i, role in enumerate(['app', 'postgres', 'redis']):
                directory = base / 'production' / role; directory.mkdir(parents=True)
                (directory / 'retained').write_text('protected production fixture')
                production.append({'Id': str(i + 1) * 64, 'Name': '/physicsos-' + role + '-1', 'Image': 'sha256:' + str(i + 1) * 64,
                                   'State': {'Running': True}, 'Config': {'Env': [], 'Labels': {}},
                                   'Mounts': [{'Source': str(directory), 'Destination': '/var/lib/physicsos' if role == 'app' else '/data', 'RW': True}],
                                   'NetworkSettings': {'Networks': {'physicsos_default': {'NetworkID': '0' * 64}}, 'Ports': {}}})
            source = base / 'production/app/profiles/web'; source.mkdir(parents=True)
            (source / 'cordis.patch.yml').write_text('plugins-from-postgres: true\n')
            production[0]['Config'].update({'Cmd': [*spec['command'][:-2], '--port', '3080', '--patch', '/production.patch.yml'],
                                           'Env': ['PATH=/usr/bin', 'DEEPSEEK_BASE_URL=http://127.0.0.1:3972/v1',
                                                   'PHYSICSOS_MODEL_POOL_PORT=3972', 'UNAPPROVED_SECRET=fake-production-material',
                                                   'PHYSICSOS_PUBLIC_URL=https://physics.dongsiwei.com',
                                                   candidate.ACTIVITY_CAPACITY_ENV + '=true']})
            pg = {'Id': '8' * 64, 'Name': '/' + config['databaseContainer'], 'State': {'Running': True},
                  'Config': {'Labels': {'io.physicsos.task': config['task'], 'io.physicsos.role': 'validation-database'}},
                  'Mounts': [{'Source': str(root / 'database-data'), 'Destination': '/var/lib/postgresql/data', 'RW': True}],
                  'NetworkSettings': {'Networks': {config['network']: {'NetworkID': '5' * 64, 'IPAddress': '172.30.0.2'}}}}
            network = {'Id': '5' * 64, 'Name': config['network'], 'Driver': 'bridge', 'Scope': 'local', 'Internal': internal,
                       'Labels': {'io.physicsos.task': config['task'], 'io.physicsos.role': 'validation-network'},
                       'IPAM': {'Config': [{'Subnet': '172.30.0.0/16', 'Gateway': '172.30.0.1'}]},
                       'Containers': {pg['Id']: {'Name': config['databaseContainer'], 'IPv4Address': '172.30.0.2/16'}}}
            if existing:
                network['Containers'][container['Id']] = {'Name': details['container'], 'IPv4Address': '172.30.0.3/16'}
            if internal:
                container['NetworkSettings']['Ports'] = {str(config['httpPort']) + '/tcp': None, '3080/tcp': None}
                container['NetworkSettings']['Networks'][config['network']].update(IPPrefixLen=16, Gateway='')
            f = SimpleNamespace(config=config, root=root, image=image, binding=binding, spec=spec, container=container,
                                current=container if existing else None, production=production, pg=pg, network=network, password=password)
            if existing: self.persist(f)
            def inspect(kind, name):
                if kind == 'network': return network if name == config['network'] else None
                if kind == 'image': return image if name in {image['Id'], 'candidate-image'} else None
                if name in {config['databaseContainer'], pg['Id']}: return pg
                if f.current is not None and name in {f.current['Id'], details['container']}: return f.current
                return next((p for p in production if name in {p['Id'], p['Name'].lstrip('/')}), None)
            with patch.object(candidate, 'metadata', side_effect=inspect), \
                    patch.object(candidate, 'verify_teaching_tools_image', return_value=binding), \
                    patch.object(candidate, 'lifecycle', return_value=contextlib.nullcontext()), \
                    patch.object(candidate, 'settle_mutations', side_effect=lambda: contextlib.nullcontext([False])):
                yield f

    def persist(self, f):
        candidate.private_json(f.root / 'metadata.json', f.spec['metadata'])
        candidate.private_json(f.root / 'state/launch-spec.json', f.spec)

    def docker(self, f, failure=None):
        def run(args, **kwargs):
            if args[:2] == ['docker', 'create']:
                f.current = copy.deepcopy(f.container); f.current['State']['Running'] = False
                f.current['Config']['Labels'] = dict(args[i + 1].split('=', 1) for i, arg in enumerate(args) if arg == '--label')
                f.current['Config']['Env'] = [args[i + 1] for i, arg in enumerate(args) if arg == '--env']
                if failure == 'foreign': f.current['Config']['Labels']['io.physicsos.candidate.instance'] = '9' * 32
                if failure in {'create', 'foreign'}:
                    raise candidate.subprocess.CalledProcessError(1, args, output='fake-private-output', stderr='fake-private-output')
                return candidate.subprocess.CompletedProcess(args, 0, stdout=f.current['Id'] + '\n')
            if args[:2] == ['docker', 'start']:
                self.assertEqual(args[2], f.current['Id'])
                self.assertEqual(json.loads((f.root / 'metadata.json').read_text())['containerId'], f.current['Id'])
                if failure == 'start': raise candidate.subprocess.CalledProcessError(1, args, stderr='fake-private-output')
                f.current['State']['Running'] = True
                return candidate.subprocess.CompletedProcess(args, 0)
            if args[:3] == ['docker', 'rm', '-f']:
                self.assertEqual(args[3], f.current['Id']); f.current = None
                return candidate.subprocess.CompletedProcess(args, 0)
            raise AssertionError('Unexpected Docker mutation')
        return run

    def test_only_two_modes_private_config_and_no_extra_environment_fields(self):
        for mode in ['bridge', 'enabled']:
            with self.subTest(mode=mode), self.fixture(mode) as f:
                file = f.root / 'config.json'; candidate.private_json(file, f.config)
                self.assertEqual(candidate.load(file)['teachingToolsMode'], mode)
                for invalid in [None, False, {}, [], '', 'off', 'Enabled', 'enabled\n', 'bridge --env X=1']:
                    with self.subTest(invalid=invalid), self.assertRaises(candidate.CandidateError):
                        candidate.teaching_tools_mode({**f.config, 'teachingToolsMode': invalid})
                for extra in ['environment', 'env', 'mounts', 'image', 'activityQueryCapacityVerified', 'unknown']:
                    with self.subTest(extra=extra), self.assertRaisesRegex(candidate.CandidateError, 'FIELDS_INVALID'):
                        candidate.teaching_tools_mode({**f.config, extra: {candidate.TEACHING_TOOLS_ENV: mode}})
                file.chmod(0o644)
                with self.assertRaisesRegex(candidate.CandidateError, 'CONFIG_PRIVATE'): candidate.load(file)

    def test_capacity_reference_requires_private_enabled_config_with_exact_fields(self):
        with self.fixture('enabled', capacity=True) as f:
            file = f.root / 'config.json'; candidate.private_json(file, f.config)
            reference = f.config['activityCapacity']
            self.assertEqual(candidate.load(file)['activityCapacity'], reference)
            for mode in [None, 'bridge', 'off']:
                config = {**f.config, 'teachingToolsMode': mode}
                if mode is None: config.pop('teachingToolsMode')
                with self.subTest(mode=mode), self.assertRaisesRegex(candidate.CandidateError, 'CAPACITY_MODE_REQUIRED'):
                    candidate.teaching_tools_mode(config)
            for invalid in [None, True, {'path': reference['path']}, {**reference, 'override': True},
                            {**reference, 'path': 'relative/result.json'}, {**reference, 'path': '/opt/../result.json'},
                            {**reference, 'sha256': 'short'}]:
                with self.subTest(reference=invalid), self.assertRaisesRegex(candidate.CandidateError, 'REFERENCE_INVALID'):
                    candidate.teaching_tools_mode({**f.config, 'activityCapacity': invalid})
            file.write_text(json.dumps(f.config)[:-1] + ', "activityCapacity": null}')
            with self.assertRaisesRegex(ValueError, 'Duplicate JSON field'): candidate.load(file)

    def test_capacity_pass_requires_exact_source_results_inputs_and_matching_cpu_profiles(self):
        with self.fixture('enabled', existing=False, capacity=True) as f:
            path = Path(f.config['activityCapacity']['path'])
            valid = self.capacity_result(f.binding)
            input_names = valid['inputs']
            cpu = valid['cpuProfile']
            changes = [dict(scope='postgres'), dict(revision='0' * 40), dict(sourceDigest='0' * 64),
                       dict(exitCode=1), dict(exitCode=False), dict(passed=False), dict(passed=1),
                       dict(passedTests=1), dict(passedTests=2.0), dict(failedTests=1), dict(pendingTests=1),
                       dict(inputs={key: value for key, value in input_names.items() if key != 'PHYSICSOS_ACTIVITY_RUN_CAPACITY'}),
                       dict(inputs={**input_names, 'PHYSICSOS_ACTIVITY_RUN_CAPACITY': 1}),
                       dict(inputs={**input_names, 'PHYSICSOS_ACTIVITY_BASE_DAILY_USERS': '81'}),
                       dict(inputs={**input_names, 'PHYSICSOS_ACTIVITY_EVENTS_PER_USER_DAY': '0'}),
                       dict(inputs={**input_names, 'PHYSICSOS_ACTIVITY_BASE_ROSTER_USERS': '100001'}),
                       dict(inputs={**input_names, 'PHYSICSOS_ACTIVITY_BASE_SCHOOLS': '7e1'}),
                       dict(cpuProfile={**cpu, 'referenceContainer': 'other'}),
                       dict(cpuProfile={**cpu, 'runner': {**cpu['runner'], 'NanoCpus': 1_000_000_000}}),
                       dict(cpuProfile={**cpu, 'runner': {**cpu['runner'], 'CpuQuota': False}}),
                       dict(cpuProfile={**cpu, 'reference': {**cpu['reference'], 'CpusetCpus': []}}),
                       dict(cpuProfile={**cpu, 'runner': {**cpu['runner'], 'extra': 0}})]
            for index, invalid in enumerate([{**valid, **change} for change in changes] +
                                             [b'not JSON', (json.dumps(valid)[:-1] + ', "passed": true}').encode()]):
                with self.subTest(case=index), self.assertRaisesRegex(candidate.CandidateError, '^CANDIDATE_ACTIVITY_CAPACITY_UNVERIFIED$'):
                    self.pin_capacity(f.config, path, invalid)
                    candidate.verify_activity_capacity(f.config['activityCapacity'], f.binding)
            profile = {**cpu['reference'], 'NanoCpus': 1_500_000_000, 'CpusetCpus': '0-2'}
            self.pin_capacity(f.config, path, {**valid, 'inputs': {**input_names, 'PHYSICSOS_ACTIVITY_BASE_DAILY_USERS': '9'},
                                              'cpuProfile': {**cpu, 'reference': profile, 'runner': profile}, 'otherReceiptField': 'allowed'})
            self.assertTrue(candidate.verify_activity_capacity(f.config['activityCapacity'], f.binding))

    def test_capacity_file_must_be_private_owned_regular_nonsymlink_and_digest_pinned(self):
        with self.fixture('enabled', capacity=True) as f:
            reference = f.config['activityCapacity']; path = Path(reference['path'])
            for permissions in [0o400, 0o600]:
                path.chmod(permissions)
                self.assertTrue(candidate.verify_activity_capacity(reference, f.binding))
            path.chmod(0o644)
            with self.assertRaisesRegex(candidate.CandidateError, 'FILE_PRIVATE'):
                candidate.verify_activity_capacity(reference, f.binding)
            path.chmod(0o600)
            stat_fd = os.fstat
            def owner(uid):
                def inspect(fd):
                    info = stat_fd(fd)
                    return SimpleNamespace(st_uid=uid, st_mode=info.st_mode, st_nlink=info.st_nlink,
                                           st_size=info.st_size, st_ctime_ns=info.st_ctime_ns)
                return inspect
            with patch.object(candidate.os, 'fstat', side_effect=owner(0)):
                self.assertTrue(candidate.verify_activity_capacity(reference, f.binding))
            with patch.object(candidate.os, 'fstat', side_effect=owner(os.getuid() + 1)):
                with self.assertRaisesRegex(candidate.CandidateError, 'FILE_PRIVATE'):
                    candidate.verify_activity_capacity(reference, f.binding)
            link = path.with_name('symlink'); link.symlink_to(path)
            dir_link = f.root.parent / 'operator-alias'; dir_link.symlink_to(path.parent, target_is_directory=True)
            fifo = path.with_name('fifo'); os.mkfifo(fifo, 0o600)
            for target in [link, dir_link / path.name, path.parent, fifo, path.with_name('missing')]:
                with self.subTest(target=target.name), self.assertRaisesRegex(candidate.CandidateError, 'FILE_PRIVATE'):
                    candidate.verify_activity_capacity({**reference, 'path': str(target)}, f.binding)
            hardlink = path.with_name('hardlink'); os.link(path, hardlink)
            with self.assertRaisesRegex(candidate.CandidateError, 'FILE_PRIVATE'):
                candidate.verify_activity_capacity(reference, f.binding)
            hardlink.unlink(); path.write_bytes(path.read_bytes() + b'\n')
            with self.assertRaisesRegex(candidate.CandidateError, '^CANDIDATE_ACTIVITY_CAPACITY_DIGEST_CHANGED$'):
                candidate.verify_activity_capacity(reference, f.binding)

    def test_bridge_and_enabled_use_independent_schema_appdata_network_database_and_ports(self):
        with self.fixture('bridge') as bridge, self.fixture('enabled') as enabled:
            for key in ['task', 'root', 'schema', 'network', 'databaseContainer', 'databaseDataRoot', 'httpPort', 'modelPoolPort']:
                self.assertNotEqual(bridge.config[key], enabled.config[key])
            self.assertFalse(candidate.same_data({'Source': bridge.config['root']}, {'Source': enabled.config['root']}))

    def test_legacy_unspecified_mode_does_not_inject_or_read_arbitrary_environment(self):
        config = CandidateSafety().config(Path('/unused-legacy'))
        config['environment'] = {candidate.TEACHING_TOOLS_ENV: 'enabled', 'SECRET': 'unapproved'}
        for inherited in [{}, {candidate.TEACHING_TOOLS_ENV: 'bridge', 'EXISTING_FILE': '/run/secrets/retained'}]:
            environment = dict(inherited)
            candidate.apply_teaching_tools_mode(config, environment)
            self.assertEqual(environment, inherited)
        with patch.object(candidate, 'verify_teaching_tools_image') as verify:
            candidate.guard_teaching_tools(config, {'Config': {'Env': ['LEGACY=value', 'LEGACY=duplicate']}})
            verify.assert_not_called()

    def test_explicit_mode_sets_capacity_false_without_proof_and_preserves_other_env(self):
        for mode in ['bridge', 'enabled']:
            with self.subTest(mode=mode), self.fixture(mode) as f:
                environment = {candidate.TEACHING_TOOLS_ENV: 'enabled' if mode == 'bridge' else 'bridge',
                               candidate.ACTIVITY_CAPACITY_ENV: 'true', 'UNCHANGED_SECRET': 'fake-private-material',
                               'UNCHANGED_KEY_FILE': '/run/secrets/fixture', 'PHYSICSOS_VALIDATION_URL': 'http://127.0.0.1:13187'}
                before = dict(environment)
                candidate.apply_teaching_tools_mode(f.config, environment)
                self.assertEqual(environment, {**before, candidate.TEACHING_TOOLS_ENV: mode, candidate.ACTIVITY_CAPACITY_ENV: 'false'})

    def test_mode_requires_new_private_data_scope_and_refuses_production(self):
        with self.fixture() as f:
            for changed in [{'requireIsolatedNetwork': False}, {'network': ''}, {'databaseOwner': 'other'},
                            {'databaseDataRoot': ''}, {'schema': 'physicsos'}, {'databaseContainer': 'physicsos-postgres-1'}]:
                with self.subTest(changed=changed), self.assertRaisesRegex(candidate.CandidateError, 'ISOLATION_REQUIRED'):
                    candidate.teaching_tools_mode({**f.config, **changed})
            # An old interactive candidate receipt cannot acquire a mode in place.
            old = copy.deepcopy(f.spec); old['metadata'].pop('teachingToolsMode')
            with self.assertRaises(candidate.CandidateError): candidate.validate_teaching_tools_spec(f.config, old['metadata'], old)
            legacy_config = {k: v for k, v in f.config.items() if k != 'teachingToolsMode'}
            with self.assertRaisesRegex(candidate.CandidateError, 'MODE_REQUIRED'): candidate.remove_owned(legacy_config)

    def test_prepare_injects_mode_and_proven_capacity_without_mutating_production_secrets_or_profiles(self):
        for mode, capacity in [('bridge', False), ('enabled', False), ('enabled', True)]:
            with self.subTest(mode=mode, capacity=capacity), self.fixture(mode, existing=False, capacity=capacity) as f:
                before = copy.deepcopy(f.production), f.password.read_bytes(), f.password.stat().st_ino
                source = Path(f.production[0]['Mounts'][0]['Source']) / 'profiles/web/cordis.patch.yml'
                original_profile = source.read_bytes(), source.stat().st_ino
                # Production/image Env and the persisted profile all try to
                # declare true, but the candidate uses only its verified proof.
                source.write_text('teachingToolsMode: ' + ('enabled' if mode == 'bridge' else 'bridge') +
                                  '\nactivityQueryCapacityVerified: true\n')
                opposite_profile = source.read_bytes()
                with patch.object(candidate, 'check_isolated_resources', return_value=(f.network, f.pg)), \
                        patch.object(candidate.os, 'chown'), patch.object(candidate.subprocess, 'check_output', return_value='# health fixture\n'), \
                        patch.object(candidate.subprocess, 'run') as run:
                    _, spec, _ = candidate.prepare(f.config, 'candidate-image')
                    run.assert_not_called()
                self.assertEqual(spec['environment'][candidate.TEACHING_TOOLS_ENV], mode)
                self.assertEqual(spec['environment'][candidate.ACTIVITY_CAPACITY_ENV], 'true' if capacity else 'false')
                self.assertEqual(spec['environment']['PHYSICSOS_PUBLIC_URL'], f"http://127.0.0.1:{f.config['httpPort']}")
                self.assertEqual(spec.get('activityCapacity'), f.config.get('activityCapacity'))
                self.assertNotIn('activityCapacity', spec['metadata'])
                self.assertNotIn('UNAPPROVED_SECRET', spec['environment'])
                self.assertEqual(spec['metadata']['teachingToolsMode'], mode)
                self.assertEqual(spec['metadata']['teachingToolsImage'], f.binding)
                self.assertEqual(spec['metadata']['fingerprint'], candidate.candidate_fingerprint(spec))
                self.assertEqual(before, (f.production, f.password.read_bytes(), f.password.stat().st_ino))
                self.assertEqual(source.read_bytes(), opposite_profile)
                self.assertEqual(source.stat().st_ino, original_profile[1])
                self.assertEqual((f.root / 'home/retained').read_text(), 'owned fixture data')

    def test_prepare_refuses_stale_capacity_before_network_database_or_candidate_writes(self):
        with self.fixture('enabled', existing=False, capacity=True) as f, \
                patch.object(candidate, 'verify_teaching_tools_image', return_value={**f.binding, 'revision': '0' * 40}), \
                patch.object(candidate, 'check_isolated_resources') as resources, \
                patch.object(candidate.subprocess, 'run') as run, patch.object(candidate, 'private_json') as write:
            with self.assertRaisesRegex(candidate.CandidateError, 'CAPACITY_UNVERIFIED'):
                candidate.prepare(f.config, 'candidate-image')
            resources.assert_not_called(); run.assert_not_called(); write.assert_not_called()
            self.assertFalse((f.root / 'secrets/database_url').exists())

    def test_production_port_and_root_are_refused_before_any_write_or_docker_mutation(self):
        for changed in [{'httpPort': 3080}, {'modelPoolPort': 3972}]:
            with self.subTest(changed=changed), self.fixture(existing=False) as f, \
                    patch.object(candidate.subprocess, 'run') as run, patch.object(candidate, 'private_json') as write:
                with self.assertRaisesRegex(candidate.CandidateError, 'PRODUCTION_PORT'):
                    candidate.prepare({**f.config, **changed}, 'candidate-image')
                run.assert_not_called(); write.assert_not_called()
        with self.fixture(existing=False) as f, patch.object(candidate.subprocess, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'overlaps production'):
                candidate.prepare({**f.config, 'root': f.production[0]['Mounts'][0]['Source']}, 'candidate-image')
            run.assert_not_called()

    def test_guard_checks_actual_config_env_and_all_provenance_bindings_in_memory(self):
        changes = [lambda f: f.current['Config']['Env'].append(candidate.TEACHING_TOOLS_ENV + '=enabled'),
                   lambda f: f.current['Config'].update(Env=[entry.replace(candidate.TEACHING_TOOLS_ENV + '=bridge', candidate.TEACHING_TOOLS_ENV + '=enabled') for entry in f.current['Config']['Env']]),
                   lambda f: f.current['Config']['Env'].remove(candidate.TEACHING_TOOLS_ENV + '=bridge'),
                   lambda f: f.current['Config']['Env'].append('UNAPPROVED_SECRET=do-not-print-this'),
                   lambda f: f.current['Config'].update(Env=[entry for entry in f.current['Config']['Env'] if not entry.startswith('PHYSICSOS_PUBLIC_URL=')] + ['PHYSICSOS_PUBLIC_URL=https://physics.dongsiwei.com']),
                   lambda f: f.current['Config']['Env'].append('PHYSICSOS_PUBLIC_URL=http://127.0.0.1:65535'),
                   lambda f: f.current['Config']['Labels'].update({'io.physicsos.teaching-tools.mode': 'enabled'}),
                   lambda f: f.current.update(Id='9' * 64), lambda f: f.current.update(Name='/physicsos-app-1'),
                   lambda f: f.current['Mounts'][0].update(Source='/production/home'),
                   lambda f: f.current['HostConfig'].update(NetworkMode='physicsos_default'),
                   lambda f: f.current['Config']['Cmd'].append('--different'),
                   lambda f: f.spec['metadata']['teachingToolsImage'].update(sourceDigest='0' * 64)]
        with self.fixture() as f: candidate.guard_teaching_tools(f.config, f.current)
        for i, change in enumerate(changes):
            with self.subTest(case=i), self.fixture() as f, patch.object(candidate.subprocess, 'run') as run:
                change(f); self.persist(f)
                with self.assertRaises(candidate.CandidateError) as raised: candidate.guard_teaching_tools(f.config, f.current)
                self.assertRegex(str(raised.exception), '^CANDIDATE_[A-Z_]+$')
                self.assertNotIn('do-not-print-this', str(raised.exception)); run.assert_not_called()
        with self.fixture('enabled') as f: candidate.guard_teaching_tools(f.config, f.current)

    def test_guard_binds_capacity_reference_receipt_and_effective_environment(self):
        with self.fixture('enabled', capacity=True) as f:
            candidate.guard_teaching_tools(f.config, f.current)
            reference = f.config['activityCapacity']
            for changed in [None, {**reference, 'path': reference['path'] + '.new'}, {**reference, 'sha256': '0' * 64}]:
                config = {**f.config, 'activityCapacity': changed}
                if changed is None: config.pop('activityCapacity')
                with self.subTest(changed=changed), self.assertRaisesRegex(candidate.CandidateError, 'CAPACITY_BINDING_CHANGED'):
                    candidate.guard_teaching_tools(config, f.current)
            for key, value in [('path', reference['path'] + '.new'), ('sha256', '0' * 64)]:
                spec = copy.deepcopy(f.spec); spec['activityCapacity'][key] = value
                self.assertNotEqual(candidate.candidate_fingerprint(spec), f.spec['metadata']['fingerprint'])
            spec = copy.deepcopy(f.spec); spec['environment'][candidate.ACTIVITY_CAPACITY_ENV] = 'false'
            spec['metadata']['fingerprint'] = candidate.candidate_fingerprint(spec)
            with self.assertRaisesRegex(candidate.CandidateError, 'CAPACITY_BINDING_CHANGED'):
                candidate.validate_teaching_tools_spec(f.config, spec['metadata'], spec)
            f.current['Config']['Env'].remove(candidate.ACTIVITY_CAPACITY_ENV + '=true')
            with self.assertRaisesRegex(candidate.CandidateError, 'TEACHING_ENV_CHANGED'):
                candidate.guard_teaching_tools(f.config, f.current)
            f.current['Config']['Env'].append(candidate.ACTIVITY_CAPACITY_ENV + '=true')
            Path(reference['path']).write_text('changed bytes\n')
            with patch.object(candidate, 'check_owned') as auth, patch.object(candidate.subprocess, 'run') as run:
                for action in [candidate.check, candidate.stop]:
                    with self.subTest(action=action.__name__), self.assertRaisesRegex(candidate.CandidateError, 'DIGEST_CHANGED'):
                        action(f.config)
                auth.assert_not_called(); run.assert_not_called()

    def test_fingerprint_binds_mode_environment_source_code_and_manifests(self):
        with self.fixture() as f:
            initial = candidate.candidate_fingerprint(f.spec)
            for key in ['sourceDigest', 'codeDigest', 'manifestSha256', 'capabilitySha256']:
                spec = copy.deepcopy(f.spec); spec['metadata']['teachingToolsImage'][key] = '0' * 64
                self.assertNotEqual(candidate.candidate_fingerprint(spec), initial)
            for mutate in [lambda s: s['metadata'].update(teachingToolsMode='enabled'),
                           lambda s: s['environment'].update({candidate.TEACHING_TOOLS_ENV: 'enabled'}),
                           lambda s: s['environment'].update(PRESERVED_FILE='/different'),
                           lambda s: s['metadata'].update(databaseContainerId='0' * 64)]:
                spec = copy.deepcopy(f.spec); mutate(spec)
                self.assertNotEqual(candidate.candidate_fingerprint(spec), initial)
            spec = copy.deepcopy(f.spec); spec['metadata'].pop('containerId')
            self.assertEqual(candidate.candidate_fingerprint(spec), initial)

    def test_start_persists_full_id_before_start_and_passes_only_the_effective_activity_flag(self):
        for mode, capacity in [('bridge', False), ('enabled', False), ('enabled', True)]:
            with self.subTest(mode=mode, capacity=capacity), self.fixture(mode, existing=False, capacity=capacity) as f, \
                    patch.object(candidate, 'prepare', return_value=({}, f.spec, [])), \
                    patch.object(candidate, 'check_isolated_resources'), \
                    patch.object(candidate.subprocess, 'run', side_effect=self.docker(f)) as run:
                result = candidate.start(f.config, 'candidate-image')
                self.assertEqual(result['teachingToolsMode'], mode)
                self.assertEqual(result['containerId'], '7' * 64)
                create = run.call_args_list[0].args[0]
                self.assertIn(candidate.TEACHING_TOOLS_ENV + '=' + mode, create)
                self.assertIn(candidate.ACTIVITY_CAPACITY_ENV + ('=true' if capacity else '=false'), create)
                self.assertIn('PRESERVED_FILE=/run/secrets/fixture', create)
                if capacity:
                    for value in f.config['activityCapacity'].values():
                        self.assertNotIn(value, json.dumps(result))
                        self.assertFalse(any(value in arg for arg in create))
                self.assertEqual(run.call_args_list[1].args[0], ['docker', 'start', '7' * 64])
                candidate.guard_teaching_tools(f.config, f.current)

    def test_browser_url_parser_accepts_only_the_official_primary_loopback_root_url(self):
        port = 14188; token = b'a' * 42 + b'A'
        exact = b'http://127.0.0.1:14188/?token=' + token
        line = b'dsh web: ' + exact
        lan = b' (LAN: http://172.30.0.3:14188/?token=' + token + b')'
        self.assertEqual(candidate.primary_browser_url(line, port), exact)
        self.assertEqual(candidate.primary_browser_url(line + lan + b'\r', port), exact)
        for invalid in [b'log ' + line, b'dsh web:' + lan, line.replace(b'127.0.0.1', b'localhost'),
                        line.replace(b'http:', b'https:'), line.replace(b'14188', b'13188'),
                        line.replace(b'/?', b'/index.html?'), line.replace(b'127.0.0.1', b'user@127.0.0.1'),
                        line + b'&token=' + token, line + b'#fragment', line + b'a', line[:-1], line[:-1] + b'B']:
            with self.subTest(invalid=invalid): self.assertIsNone(candidate.primary_browser_url(invalid, port))

    def mock_browser_attachment(self, f, output, errors=b'', on_kill=None):
        def pipe(data):
            read, write = os.pipe()
            with os.fdopen(write, 'wb') as stream: stream.write(data)
            return os.fdopen(read, 'rb')
        client = SimpleNamespace(kill=Mock(side_effect=on_kill), wait=Mock())
        def attach(args, **options):
            self.assertEqual(args, ['docker', 'start', '--attach', f.current['Id']])
            self.assertTrue(options['start_new_session'])
            self.assertEqual(options['stdin'], candidate.subprocess.DEVNULL)
            self.assertEqual((options['stdout'], options['stderr']), (candidate.subprocess.PIPE, candidate.subprocess.PIPE))
            self.assertEqual(json.loads((f.root / 'metadata.json').read_text())['containerId'], f.current['Id'])
            f.current['State']['Running'] = True
            client.stdout, client.stderr = pipe(output), pipe(errors)
            return client
        return client, patch.object(candidate.subprocess, 'Popen', side_effect=attach)

    def test_owned_start_captures_private_primary_url_and_detaches_only_client_then_stop_clears_it(self):
        with self.fixture('enabled', existing=False, capacity=True) as f, \
                patch.object(candidate, 'prepare', return_value=({}, f.spec, [])), \
                patch.object(candidate, 'check_isolated_resources'), \
                patch.object(candidate.subprocess, 'run', side_effect=self.docker(f)) as run:
            auth_file = f.root / 'state/auth-url'; auth_file.write_bytes(b'stale URL')
            token = b'a' * 42 + b'A'
            exact = f"http://127.0.0.1:{f.config['httpPort']}/?token=".encode() + token
            def verify_published_before_client_kill():
                self.assertEqual(auth_file.read_bytes(), exact)
                self.assertEqual(auth_file.stat().st_mode & 0o777, 0o600)
                self.assertEqual(auth_file.stat().st_uid, os.getuid())
                self.assertEqual(auth_file.stat().st_nlink, 1)
            client, attach = self.mock_browser_attachment(f, b'private startup\ndsh web: ' + exact + b'\n',
                                                         b'private stderr', verify_published_before_client_kill)
            with attach: result = candidate.start(f.config, 'candidate-image', capture_browser_url=True)
            client.kill.assert_called_once_with(); client.wait.assert_called_once_with(timeout=5)
            self.assertTrue(client.stdout.closed and client.stderr.closed)
            self.assertEqual([call.args[0][:2] for call in run.call_args_list], [['docker', 'create']])
            self.assertNotIn(token.decode(), json.dumps(result))
            self.assertEqual(result['fingerprint'], f.spec['metadata']['fingerprint'])
            self.assertEqual(list(auth_file.parent.glob('.auth-url.partial-*')), [])
            candidate.stop(f.config)
            self.assertFalse(auth_file.exists())
            self.assertEqual(run.call_args.args[0], ['docker', 'rm', '-f', '7' * 64])

    def test_browser_capture_failure_leaks_no_output_and_removes_only_owned_container(self):
        for case, code in [('stderr-only', 'MISSING'), ('over-limit', 'OUTPUT_LIMIT'), ('publish', 'FILE_PRIVATE')]:
            with self.subTest(case=case), self.fixture(existing=False) as f, \
                    patch.object(candidate, 'prepare', return_value=({}, f.spec, [])), \
                    patch.object(candidate, 'check_isolated_resources'), \
                    patch.object(candidate.subprocess, 'run', side_effect=self.docker(f)) as run:
                auth_file = f.root / 'state/auth-url'; auth_file.write_bytes(b'stale URL')
                token = b'b' * 42 + b'A'
                line = f"dsh web: http://127.0.0.1:{f.config['httpPort']}/?token=".encode() + token + b'\n'
                client, attach = self.mock_browser_attachment(f, b'' if case == 'stderr-only' else line, line)
                limit = patch.object(candidate, 'BROWSER_ATTACH_MAX_BYTES', 10) if case == 'over-limit' else contextlib.nullcontext()
                def collide(*args, **kwargs):
                    auth_file.write_bytes(b'raced-in file')
                    raise FileExistsError('private path must not print')
                publish = patch.object(candidate.os, 'link', side_effect=collide) if case == 'publish' else contextlib.nullcontext()
                with attach, limit, publish, self.assertRaisesRegex(candidate.CandidateError, '^CANDIDATE_BROWSER_URL_' + code + '$') as raised:
                    candidate.start(f.config, 'candidate-image', capture_browser_url=True)
                diagnostics = ''.join(traceback.format_exception(type(raised.exception), raised.exception, raised.exception.__traceback__))
                self.assertNotIn(token.decode(), diagnostics)
                self.assertNotIn('private path must not print', diagnostics)
                client.kill.assert_called_once_with()
                self.assertEqual(run.call_args.args[0], ['docker', 'rm', '-f', '7' * 64])
                self.assertEqual(list(auth_file.parent.glob('.auth-url.partial-*')), [])
                if case == 'publish': self.assertEqual(auth_file.read_bytes(), b'raced-in file')
                else: self.assertFalse(auth_file.exists())

    def test_browser_capture_option_is_restricted_to_explicit_teaching_start(self):
        with self.fixture(existing=False) as f, patch.object(candidate, 'load', return_value=f.config) as load, \
                patch.object(candidate, 'start', return_value={}) as start, patch('builtins.print'):
            cli = ['release-candidate.py', '--config', '/private/config.json', '--image', 'candidate-image', '--capture-browser-url']
            for action in ['refresh', 'stop', 'check', 'network', 'search']:
                with patch.object(candidate.sys, 'argv', [*cli, action]), self.assertRaisesRegex(candidate.CandidateError, 'START_REQUIRED'):
                    candidate.main()
            load.assert_not_called(); start.assert_not_called()
            with patch.object(candidate.sys, 'argv', [*cli, 'start']): self.assertEqual(candidate.main(), 0)
            start.assert_called_once_with(f.config, 'candidate-image', capture_browser_url=True)
        with patch.object(candidate, 'lifecycle') as lifecycle:
            with self.assertRaisesRegex(candidate.CandidateError, 'MODE_REQUIRED'):
                candidate.start(CandidateSafety().config(Path('/legacy')), 'test-image', capture_browser_url=True)
            lifecycle.assert_not_called()

    def test_failed_create_or_start_removes_only_exact_owned_id_without_secret_diagnostics(self):
        for failure in ['create', 'start']:
            with self.subTest(failure=failure), self.fixture(existing=False) as f, \
                    patch.object(candidate, 'prepare', return_value=({}, f.spec, [])), \
                    patch.object(candidate.subprocess, 'run', side_effect=self.docker(f, failure)) as run:
                with self.assertRaisesRegex(candidate.CandidateError, '^CANDIDATE_TEACHING_OPERATION_FAILED$') as raised:
                    candidate.start(f.config, 'candidate-image')
                diagnostics = ''.join(traceback.format_exception(type(raised.exception), raised.exception, raised.exception.__traceback__))
                self.assertNotIn('fake-private-output', diagnostics); self.assertNotIn('PRESERVED_FILE=', diagnostics)
                self.assertEqual(run.call_args.args[0], ['docker', 'rm', '-f', '7' * 64])
                self.assertEqual((f.root / 'home/retained').read_text(), 'owned fixture data')
        with self.fixture(existing=False) as f, patch.object(candidate, 'prepare', return_value=({}, f.spec, [])), \
                patch.object(candidate.subprocess, 'run', side_effect=self.docker(f, 'foreign')) as run:
            with self.assertRaises(candidate.CandidateError): candidate.start(f.config, 'candidate-image')
            self.assertEqual(len(run.call_args_list), 1, 'Do not remove a raced foreign nonce, even with the same name/image')

    def test_refresh_uses_same_guard_mode_fingerprint_and_exact_id_cleanup(self):
        for mode in ['bridge', 'enabled']:
            with self.subTest(mode=mode), self.fixture(mode) as f, patch.object(candidate, 'check_isolated_resources'), \
                    patch.object(candidate, 'start_owned', return_value={'refreshed': True}) as start, \
                    patch.object(candidate.subprocess, 'run', side_effect=self.docker(f)) as run:
                before = copy.deepcopy(f.production), f.password.read_bytes()
                self.assertEqual(candidate.refresh(f.config, 'candidate-image'), {'refreshed': True})
                self.assertEqual(run.call_args.args[0], ['docker', 'rm', '-f', '7' * 64])
                start.assert_called_once_with(f.config, f.image['Id'])
                self.assertEqual(before, (f.production, f.password.read_bytes()))
        for changed in [{'teachingToolsMode': 'enabled'}, {'httpPort': 14188}, {'schema': 'another_schema'}]:
            with self.subTest(changed=changed), self.fixture() as f, patch.object(candidate.subprocess, 'run') as run:
                with self.assertRaises(candidate.CandidateError): candidate.refresh({**f.config, **changed}, 'candidate-image')
                run.assert_not_called()

    def test_refresh_refuses_new_cold_source_without_matching_capacity_before_removal(self):
        with self.fixture('enabled', capacity=True) as f, patch.object(candidate, 'check_isolated_resources'), \
                patch.object(candidate, 'verify_teaching_tools_image', return_value={**f.binding, 'sourceDigest': '0' * 64}), \
                patch.object(candidate, 'start_owned') as start, patch.object(candidate.subprocess, 'run') as run:
            with self.assertRaisesRegex(candidate.CandidateError, 'CAPACITY_UNVERIFIED'):
                candidate.refresh(f.config, 'candidate-image')
            start.assert_not_called(); run.assert_not_called()
            self.assertIs(f.current, f.container)

    def test_guard_refuses_before_http_authentication_and_stop_refuses_mode_drift(self):
        with self.fixture() as f, patch.object(candidate, 'check_owned') as auth, patch.object(candidate.subprocess, 'run') as run:
            f.current['Config']['Env'].append(candidate.TEACHING_TOOLS_ENV + '=enabled')
            with self.assertRaises(candidate.CandidateError): candidate.check(f.config)
            with self.assertRaises(candidate.CandidateError): candidate.stop(f.config)
            auth.assert_not_called(); run.assert_not_called()

    def capabilities(self, mode, capacity):
        enabled = mode == 'enabled'
        learning = {'schemaVersion': 1, 'teachingToolsMode': mode, 'lifecycleBridge': True, 'lifecycleWritesEnabled': enabled,
                    'productStateEnabled': enabled, 'activityQueryCapacityVerified': capacity,
                    'minimumRollbackCapability': candidate.TEACHING_TOOLS_CAPABILITY if enabled else None}
        activity = {'schemaVersion': 1, 'mode': mode, 'collectionEnabled': enabled, 'queryCapacityVerified': capacity}
        return learning, activity

    def test_capabilities_require_exact_mode_and_boolean_query_collection_flags(self):
        for mode, capacity in [('bridge', False), ('enabled', False), ('enabled', True)]:
            with self.subTest(mode=mode, capacity=capacity):
                learning, activity = self.capabilities(mode, capacity)
                candidate.check_teaching_tools_capabilities(mode, learning, activity, capacity)
                for key, wrong in [('teachingToolsMode', 'off'), ('lifecycleBridge', False),
                                   ('lifecycleWritesEnabled', mode != 'enabled'), ('productStateEnabled', mode != 'enabled'),
                                   ('activityQueryCapacityVerified', not capacity)]:
                    with self.subTest(key=key), self.assertRaisesRegex(candidate.CandidateError, 'TEACHING_CAPABILITY_CHANGED'):
                        candidate.check_teaching_tools_capabilities(mode, {**learning, key: wrong}, activity, capacity)
                for key, wrong in [('mode', 'off'), ('collectionEnabled', mode != 'enabled'),
                                   ('queryCapacityVerified', not capacity), ('queryCapacityVerified', int(capacity)), ('schemaVersion', True)]:
                    with self.subTest(key=key), self.assertRaisesRegex(candidate.CandidateError, 'ACTIVITY_CAPABILITY_CHANGED'):
                        candidate.check_teaching_tools_capabilities(mode, learning, {**activity, key: wrong}, capacity)
                with self.assertRaisesRegex(candidate.CandidateError, 'ACTIVITY_CAPABILITY_CHANGED'):
                    candidate.check_teaching_tools_capabilities(mode, learning, {'schemaVersion': 1, 'mode': mode}, capacity)

    def mock_candidate_http(self, f, learning, activity, activity_status=200, *, address='127.0.0.1'):
        port = f.config['httpPort']; password = 'mock-candidate-password'; cookie = 'session=mock-candidate-cookie'
        (f.root / 'secrets/admin_password').write_text(password + '\n')
        identity = {'user': {'username': f.config['username'], 'schoolId': 'PHYSICSOS-OPEN', 'role': 'SUPER_ADMIN'}}
        values = {'/readyz': {'status': 'ready'}, '/physicsos/auth/login': identity, '/physicsos/auth/me': identity,
                  '/physicsos/admin/dashboard': {}, '/physicsos/learning/capabilities': learning,
                  '/physicsos/activity/v1/capabilities': activity}
        seen = []
        def http_open(_handler, request):
            parsed = candidate.urllib.parse.urlsplit(request.full_url)
            path = parsed.path; method = request.get_method(); seen.append((method, path))
            self.assertEqual((parsed.scheme, parsed.netloc, parsed.query), ('http', f'{address}:{port}', ''))
            self.assertEqual(request.get_header('Host'), 'physicsos-validation.invalid:' + str(port))
            headers = Message(); headers['Content-Type'] = 'application/json'
            if path == '/physicsos/auth/login':
                self.assertEqual(method, 'POST')
                self.assertEqual(json.loads(request.data), {'username': f.config['username'], 'schoolId': 'PHYSICSOS-OPEN', 'password': password})
                headers['Set-Cookie'] = cookie + '; Path=/; HttpOnly'
            else:
                self.assertEqual(method, 'GET')
                self.assertEqual(request.get_header('Cookie'), None if path == '/readyz' else cookie)
            status = activity_status if path == '/physicsos/activity/v1/capabilities' else 200
            if status == 302: headers['Location'] = 'http://outside.invalid/'
            response = addinfourl(io.BytesIO(json.dumps(values[path]).encode()), headers, request.full_url, code=status)
            response.msg = password + ' ' + cookie + ' ' + candidate.ACTIVITY_CAPACITY_ENV + '=true'
            return response
        return seen, patch.object(candidate.urllib.request.HTTPHandler, 'http_open', autospec=True, side_effect=http_open)

    def test_check_uses_authenticated_activity_get_and_reports_only_effective_flags(self):
        cases = [('bridge', False, False), ('enabled', False, False), ('enabled', True, False),
                 ('bridge', False, True), ('enabled', True, True)]
        for mode, capacity, internal in cases:
            with self.subTest(mode=mode, capacity=capacity, internal=internal), self.fixture(mode, capacity=capacity, internal=internal) as f, \
                    patch.object(candidate.urllib.request, 'getproxies', side_effect=AssertionError('Must not consult proxies')):
                address = '172.30.0.3' if internal else '127.0.0.1'
                seen, transport = self.mock_candidate_http(f, *self.capabilities(mode, capacity), address=address)
                with transport: result = candidate.check(f.config)
                self.assertEqual(seen, [('GET', '/readyz'), ('POST', '/physicsos/auth/login'), ('GET', '/physicsos/auth/me'),
                                        ('GET', '/physicsos/admin/dashboard'), ('GET', '/physicsos/learning/capabilities'),
                                        ('GET', '/physicsos/activity/v1/capabilities')])
                self.assertIs(result['activityQueryCapacityVerified'], capacity)
                self.assertIs(result['activityCollectionEnabled'], mode == 'enabled')
                self.assertNotIn('activityCapacity', result)
                self.assertEqual(json.loads((f.root / 'state/acceptance.json').read_text()), result)

    def test_check_refuses_activity_http_errors_redirects_and_wrong_flags_without_diagnostics(self):
        cases = [(302, 'TEACHING_HTTP_FAILED', False), (302, 'TEACHING_HTTP_FAILED', True),
                 (503, 'TEACHING_HTTP_FAILED', False), (200, 'ACTIVITY_CAPABILITY_CHANGED', False)]
        for status, code, internal in cases:
            with self.subTest(status=status, internal=internal), self.fixture('enabled', capacity=True, internal=internal) as f:
                learning, activity = self.capabilities('enabled', True)
                address = '172.30.0.3' if internal else '127.0.0.1'
                seen, transport = self.mock_candidate_http(f, learning, {**activity, 'queryCapacityVerified': False}, status, address=address)
                with transport, self.assertRaisesRegex(candidate.CandidateError, '^CANDIDATE_' + code + '$') as raised:
                    candidate.check(f.config)
                self.assertEqual(seen[-1], ('GET', '/physicsos/activity/v1/capabilities'))
                self.assertFalse((f.root / 'state/acceptance.json').exists())
                diagnostics = ''.join(traceback.format_exception(type(raised.exception), raised.exception, raised.exception.__traceback__))
                for private in ['mock-candidate-password', 'mock-candidate-cookie', candidate.ACTIVITY_CAPACITY_ENV + '=true']:
                    self.assertNotIn(private, diagnostics)

    def test_internal_check_rejects_unverified_endpoints_before_authentication(self):
        def endpoint(f): return f.current['NetworkSettings']['Networks'][f.config['network']]
        def member(f): return f.network['Containers'][f.current['Id']]
        def change_ip(f, ip):
            endpoint(f)['IPAddress'] = ip
            member(f)['IPv4Address'] = ip + '/16'
        cases = {
            'external bridge': lambda f: f.network.update(Internal=False),
            'truthy internal flag': lambda f: f.network.update(Internal='true'),
            'missing Ports field': lambda f: f.current['NetworkSettings'].pop('Ports'),
            'wrong suppressed port': lambda f: f.current['NetworkSettings'].update(Ports={'13189/tcp': None}),
            'unexpected extra port': lambda f: f.current['NetworkSettings'].update(Ports={'13188/tcp': None, '13189/tcp': None}),
            'wrong configured bind': lambda f: f.current['HostConfig']['PortBindings']['13188/tcp'][0].update(HostIp='0.0.0.0'),
            'network receipt mismatch': lambda f: f.network.update(Id='9' * 64),
            'missing full CID': lambda f: f.network['Containers'].pop(f.current['Id']),
            'different IP': lambda f: member(f).update(IPv4Address='172.30.0.9/16'),
            'different netmask': lambda f: member(f).update(IPv4Address='172.30.0.3/24'),
            'default gateway': lambda f: endpoint(f).update(Gateway='172.30.0.1'),
            'link-local address': lambda f: change_ip(f, '169.254.0.3'),
            'noncanonical IPv4': lambda f: change_ip(f, '172.30.0.03'),
        }
        for name, change in cases.items():
            with self.subTest(case=name), self.fixture(internal=True) as f, patch.object(candidate, 'check_owned') as auth:
                change(f)
                with self.assertRaises(RuntimeError): candidate.check(f.config)
                auth.assert_not_called()

    def test_internal_endpoint_requires_strict_port(self):
        with self.fixture(internal=True) as f:
            for port in [True, '13188', 13188.0, 1023, 65536]:
                with self.subTest(port=port), self.assertRaisesRegex(candidate.CandidateError, 'INTERNAL_ENDPOINT_INVALID'):
                    candidate.internal_candidate_address({**f.config, 'httpPort': port}, f.spec['metadata'], f.current, f.network)

    def test_internal_check_revalidates_the_returned_network_id(self):
        with self.fixture(internal=True) as f, patch.object(candidate, 'check_owned') as auth, \
                patch.object(candidate, 'ensure_isolated_network', side_effect=[f.network, {**f.network, 'Id': '9' * 64}]):
            with self.assertRaisesRegex(candidate.CandidateError, 'INTERNAL_ENDPOINT_INVALID'): candidate.check(f.config)
            auth.assert_not_called()

    def test_internal_check_refuses_a_stale_address_before_opening_http(self):
        with self.fixture(internal=True) as f, patch.object(candidate.urllib.request, 'build_opener') as client:
            with self.assertRaisesRegex(candidate.CandidateError, 'INTERNAL_ENDPOINT_CHANGED'):
                candidate.check_owned(f.config, expected_internal_address='172.30.0.9')
            client.assert_not_called()

    def test_image_binding_reuses_cold_verifier_and_rejects_handmade_labels(self):
        with self.fixture() as f:
            marker = 'packages/teaching-tools-capabilities.json'
            manifest = {'originSchema': 2, 'files': {marker: f.binding['capabilitySha256']},
                        'teachingToolsBridge': candidate.TEACHING_TOOLS_CAPABILITY,
                        **{key: f.binding[key] for key in ['revision', 'sourceDigest', 'codeDigest']}}
            runtime = SimpleNamespace(TEACHING_TOOLS_MARKER=marker, TEACHING_TOOLS_LABEL='physicsos.teaching-tools.bridge',
                                      verify_image=lambda image: {'verified': True, **f.binding}, read_base_manifest=lambda image: manifest,
                                      node_operation=lambda *args: {'schemaVersion': 1, 'defaultMode': 'bridge',
                                          'capability': candidate.TEACHING_TOOLS_CAPABILITY, 'rollbackPolicy': 'image-and-config-only-no-data-restore'})
            loader = SimpleNamespace(loader=SimpleNamespace(exec_module=lambda module: None))
            # Bypass this fixture's verifier stub to exercise the real function.
            real_spec = importlib.util.spec_from_file_location('candidate_image_proof', Path(__file__).with_name('release-candidate.py'))
            real = importlib.util.module_from_spec(real_spec); real_spec.loader.exec_module(real)
            with patch.object(real.importlib.util, 'spec_from_file_location', return_value=loader), \
                    patch.object(real.importlib.util, 'module_from_spec', return_value=runtime):
                self.assertEqual(real.verify_teaching_tools_image(f.image), f.binding)
                for changed in [{'files': {}}, {'sourceDigest': '0' * 64}, {'teachingToolsBridge': ''}]:
                    before = dict(manifest); manifest.update(changed)
                    with self.subTest(changed=changed), self.assertRaisesRegex(real.CandidateError, '^CANDIDATE_TEACHING_IMAGE_UNVERIFIED$'):
                        real.verify_teaching_tools_image(f.image)
                    manifest.clear(); manifest.update(before)
                runtime.verify_image = lambda image: {'verified': False, **f.binding}
                with self.assertRaisesRegex(real.CandidateError, '^CANDIDATE_TEACHING_IMAGE_UNVERIFIED$'):
                    real.verify_teaching_tools_image(f.image)


if __name__ == '__main__': unittest.main()
