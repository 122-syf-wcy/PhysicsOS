import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import os
import contextlib
import shlex
from unittest.mock import patch

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
                running = {'State': {'Running': True}, 'Image': 'sha256:candidate'}
                with patch.object(candidate, 'lifecycle', return_value=contextlib.nullcontext()), patch.object(candidate, 'prepare', return_value=({}, spec, [])), patch.object(candidate, 'metadata', side_effect=[None, running]), patch.object(candidate.subprocess, 'run') as run:
                    candidate.start(config, 'candidate-image')
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

    def test_check_revalidates_isolation_before_http_authentication(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'candidate'; root.mkdir()
            config = CandidateSafety().config(root)
            config.update({'network': 'physicsos-ui-test', 'databaseOwner': config['task'], 'databaseDataRoot': str(root / 'database-data')})
            (root / 'metadata.json').write_text(json.dumps({'container': 'candidate', 'image': 'candidate-image'}))
            current = {'State': {'Running': True}, 'Image': 'candidate-image', 'Config': {'Labels': {'io.physicsos.task': config['task'], 'io.physicsos.role': 'validation'}},
                       'NetworkSettings': {'Ports': {'13188/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '13188'}]}}}
            with patch.object(candidate, 'lifecycle', return_value=contextlib.nullcontext()), patch.object(candidate, 'metadata', return_value=current), patch.object(candidate, 'check_isolated_resources', side_effect=RuntimeError('foreign network')), patch.object(candidate, 'check_owned') as http:
                with self.assertRaisesRegex(RuntimeError, 'foreign network'): candidate.check(config)
                http.assert_not_called()

    def test_network_only_preparation_cannot_start_candidate_or_database(self):
        config, production, network, _ = self.fixture(Path('/candidate'))
        with patch.object(candidate, 'lifecycle', return_value=contextlib.nullcontext()), patch.object(candidate, 'production_services', return_value=production), patch.object(candidate, 'ensure_isolated_network', return_value=network), patch.object(candidate.subprocess, 'run') as run:
            result = candidate.prepare_network(config)
            self.assertFalse(result['candidateStarted']); self.assertFalse(result['databaseStarted']); run.assert_not_called()


if __name__ == '__main__': unittest.main()
