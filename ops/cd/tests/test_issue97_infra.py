"""Issue #97 B16/B17 regressions; no production mutations."""

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from demanage_cd import compose  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]


class OverlayCleanupTests(unittest.TestCase):
    def test_stale_overlays_removed_but_active_and_recent_rollback_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            old = [compose.write_overlay(folder, {'backend': 'old', 'frontend': 'old'}) for _ in range(4)]
            active = old[-1]
            labels = {
                'com.docker.compose.project': 'demanage',
                'com.docker.compose.project.config_files': f'/srv/base.yml,{active}',
            }

            def run(args, **_kwargs):
                if args[:2] == ['docker', 'inspect']:
                    service = args[-1].removeprefix('demanage-')
                    return json.dumps([{'Config': {'Labels': dict(labels, **{'com.docker.compose.service': service})}}])
                if 'up' in args:
                    return ''
                raise AssertionError(args)

            config = {'project_name': 'demanage', 'env_file': '/srv/.env', 'compose_files': ['/srv/base.yml']}
            with mock.patch.object(compose, 'validate_compose'):
                compose.apply_overlay(mock.Mock(run=run), config, {'backend': 'new', 'frontend': 'new'}, folder)

            self.assertFalse(old[0].exists(), 'stale abandoned overlay should be reclaimed')
            self.assertFalse(old[1].exists(), 'stale abandoned overlay should be reclaimed')
            self.assertTrue(active.exists(), 'active container overlay must survive')
            self.assertGreaterEqual(len(list(folder.glob('image-override-*.yml'))), 2)

    def test_unknown_docker_labels_prevent_overlay_cleanup(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            originals = [compose.write_overlay(folder, {'backend': 'old', 'frontend': 'old'}) for _ in range(4)]
            config = {'project_name': 'demanage', 'env_file': '/srv/.env', 'compose_files': ['/srv/base.yml']}

            def run(args, **_kwargs):
                if args[:2] == ['docker', 'inspect']:
                    return json.dumps([{'Config': {'Labels': {}}}])
                if 'up' in args:
                    return ''
                raise AssertionError(args)

            with mock.patch.object(compose, 'validate_compose'):
                compose.apply_overlay(mock.Mock(run=run), config, {'backend': 'new', 'frontend': 'new'}, folder)
            self.assertTrue(all(path.exists() for path in originals))

    def test_crashed_overlay_is_reclaimed_on_next_attempt_without_removing_active(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            stale = [compose.write_overlay(folder, {'backend': 'old', 'frontend': 'old'}) for _ in range(3)]
            active = compose.write_overlay(folder, {'backend': 'active', 'frontend': 'active'})
            labels = {
                'com.docker.compose.project': 'demanage',
                'com.docker.compose.project.config_files': f'/srv/base.yml,{active}',
            }

            def run(args, **_kwargs):
                if args[:2] == ['docker', 'inspect']:
                    service = args[-1].removeprefix('demanage-')
                    return json.dumps([{'Config': {'Labels': dict(labels, **{'com.docker.compose.service': service})}}])
                if 'up' in args:
                    return ''
                raise AssertionError(args)

            config = {'project_name': 'demanage', 'env_file': '/srv/.env', 'compose_files': ['/srv/base.yml']}
            runner = mock.Mock(run=run)
            with mock.patch.object(compose, 'validate_compose', side_effect=RuntimeError('simulated interruption')):
                with self.assertRaisesRegex(RuntimeError, 'interruption'):
                    compose.apply_overlay(runner, config, {'backend': 'failed', 'frontend': 'failed'}, folder)

            self.assertTrue(active.exists())
            with mock.patch.object(compose, 'validate_compose'):
                compose.apply_overlay(runner, config, {'backend': 'retry', 'frontend': 'retry'}, folder)
            self.assertFalse(stale[0].exists())
            self.assertFalse(stale[1].exists())
            self.assertTrue(active.exists())


class DatabaseUrlReservedPasswordTests(unittest.TestCase):
    def test_compose_backend_builds_safe_database_url(self):
        # Docker Compose config-only does not connect to Docker or PostgreSQL.
        with tempfile.TemporaryDirectory() as temp:
            envfile = Path(temp) / 'test.env'
            password = 'ab@cd#ef%gh:ij'
            envfile.write_text(
                "JWT_SECRET=local-test-only\n"
                "DEMANAGE_BACKEND_IMAGE=backend:test\n"
                "DEMANAGE_FRONTEND_IMAGE=frontend:test\n",
                encoding='utf-8',
            )
            result = subprocess.run(
                ['docker', 'compose', '--env-file', str(envfile), '-f', str(ROOT / 'docker-compose.prod.yml'), 'config', '--format', 'json'],
                capture_output=True, text=True, check=True, timeout=30,
                env={**os.environ, 'POSTGRES_PASSWORD': password},
            )
            backend = json.loads(result.stdout)['services']['backend']
            url = backend['environment'].get('DATABASE_URL')
            if url is not None:
                self.assertEqual(urlsplit(url).password, password)
            else:
                # B17 alternative: entrypoint safely constructs URL at startup.
                self.assertEqual(backend['environment']['POSTGRES_PASSWORD'], password)
                entrypoint = (ROOT / 'backend/entrypoint.sh').read_text(encoding='utf-8')
                match = re.search(r"node -e '([^']+)'", entrypoint)
                self.assertIsNotNone(match, 'entrypoint must construct the database URI')
                url = subprocess.run(
                    ['node', '-e', match.group(1)], capture_output=True, text=True,
                    check=True, timeout=10, env={**os.environ, 'POSTGRES_PASSWORD': password},
                ).stdout
                parsed = urlsplit(url)
                self.assertEqual(unquote(parsed.password), password)
                self.assertEqual(parsed.hostname, 'db')
                self.assertEqual(parsed.port, 5432)
                self.assertEqual(parsed.path, '/demanage')


if __name__ == '__main__':
    unittest.main()
