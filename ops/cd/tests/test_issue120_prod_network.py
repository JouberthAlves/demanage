"""Issue #120 DEM-09/14: production database isolation and CD overlay contract."""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
PROD = ROOT / 'docker-compose.prod.yml'
C05 = ROOT / 'ops/cd/overrides/issue97-c05-prod-security.yml'


def compose_model(*files: Path) -> dict:
    args = ['docker', 'compose', '--project-name', 'demanage']
    for file in files:
        args.extend(['-f', str(file)])
    result = subprocess.run(
        args + ['config', '--format', 'json'],
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
        env={
            **os.environ,
            'POSTGRES_PASSWORD': 'issue120-config-only',
            'JWT_SECRET': 'issue120-config-only',
            'DEMANAGE_BACKEND_IMAGE': 'backend:issue120',
            'DEMANAGE_FRONTEND_IMAGE': 'frontend:issue120',
        },
    )
    return json.loads(result.stdout)


class ProductionDatabaseNetworkTests(unittest.TestCase):
    def test_private_db_network_preserves_migration_and_health_dependencies(self):
        config = compose_model(PROD)
        services = config['services']
        db = services['db']
        backend = services['backend']
        frontend = services['frontend']

        self.assertTrue(config['networks']['demanage_db']['internal'])
        self.assertEqual(set(db['networks']), {'demanage_db'})
        self.assertEqual(set(backend['networks']), {'demanage', 'demanage_db'})
        self.assertEqual(set(frontend['networks']), {'demanage'})
        self.assertIn('no-new-privileges:true', db['security_opt'])
        self.assertEqual(db.get('ports', []), [])
        self.assertEqual(backend.get('ports', []), [])
        self.assertEqual(db['healthcheck']['test'][-1], 'pg_isready -U demanage -d demanage')
        self.assertEqual(backend['depends_on']['db']['condition'], 'service_healthy')
        self.assertEqual(frontend['depends_on']['backend']['condition'], 'service_healthy')
        # The entrypoint constructs DATABASE_URL safely from this password.
        self.assertEqual(backend['environment']['POSTGRES_PASSWORD'], 'issue120-config-only')
        entrypoint = (ROOT / 'backend/entrypoint.sh').read_text(encoding='utf-8')
        self.assertIn('@db:5432/demanage', entrypoint)
        self.assertIn('prisma migrate deploy', entrypoint)
        self.assertEqual(db['volumes'][0]['target'], '/var/lib/postgresql')

    def test_image_and_c05_overlays_preserve_networks_and_healthchecks(self):
        original = compose_model(PROD, C05)
        with tempfile.TemporaryDirectory() as directory:
            overlay = Path(directory) / 'images.yml'
            overlay.write_text(
                'services:\n'
                '  backend:\n    image: backend:updated\n'
                '  frontend:\n    image: frontend:updated\n',
                encoding='utf-8',
            )
            proposed = compose_model(PROD, C05, overlay)
        for name in ('db', 'backend', 'frontend'):
            before = dict(original['services'][name])
            after = dict(proposed['services'][name])
            if name != 'db':
                before.pop('image')
                after.pop('image')
            self.assertEqual(before, after, f'{name}: overlay must only change image')


if __name__ == '__main__':
    unittest.main()
