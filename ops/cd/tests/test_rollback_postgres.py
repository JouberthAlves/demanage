"""DEM-01: optional, disposable PostgreSQL rollback compatibility demonstration.

Run with DEMANAGE_DEM01_POSTGRES=1. No production data, Docker volumes,
published ports, or restoration of backups are involved.
"""

import os
import subprocess
import sys
import time
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from demanage_cd.deploy import (  # noqa: E402
    MigrationCompatibilityUnverified,
    prisma_migration_snapshot,
    require_unchanged_migrations,
)
from demanage_cd.migration_gate import validate_additive_sql  # noqa: E402


class DisposableRunner:
    def __init__(self, test):
        self.test = test

    def run(self, args, *, check=True, timeout=240):
        # Run the production SQL unchanged; redirect only the target container.
        assert list(args[:3]) == ['docker', 'exec', 'demanage-db']
        result = self.test.docker(['exec', self.test.container, *args[3:]], check=check)
        return result.stdout.strip()


@unittest.skipUnless(os.environ.get('DEMANAGE_DEM01_POSTGRES') == '1',
                     'opt-in disposable Docker PostgreSQL test')
class RollbackPostgresTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.container = 'demanage-dem01-test-' + uuid.uuid4().hex
        cls.docker([
            'run', '-d', '--rm', '--pull', 'never', '--network', 'none',
            '--name', cls.container,
            '-e', 'POSTGRES_USER=demanage', '-e', 'POSTGRES_DB=demanage',
            '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
            'postgres:18-alpine',
        ])
        for _ in range(60):
            result = cls.docker([
                'exec', cls.container, 'pg_isready', '-U', 'demanage', '-d', 'demanage',
            ], check=False)
            if result.returncode == 0:
                return
            time.sleep(0.25)
        cls.docker(['rm', '-f', cls.container], check=False)
        raise RuntimeError('Disposable PostgreSQL did not become ready')

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, 'container'):
            cls.docker(['rm', '-f', cls.container], check=False)

    @staticmethod
    def docker(args, *, check=True):
        result = subprocess.run(['docker', *args], text=True, capture_output=True,
                                timeout=45, check=False)
        if check and result.returncode != 0:
            raise RuntimeError('Disposable PostgreSQL command failed: ' + result.stderr.strip()[-400:])
        return result

    def sql(self, statement, *, check=True):
        return self.docker([
            'exec', self.container, 'psql', '-X', '-U', 'demanage', '-d', 'demanage',
            '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', statement,
        ], check=check)

    def test_additive_vs_incompatible_schema_with_old_client(self):
        runner = DisposableRunner(self)
        self.sql('''
            CREATE TABLE public."_prisma_migrations" (
                migration_name text NOT NULL, checksum text NOT NULL,
                started_at timestamptz NOT NULL, finished_at timestamptz,
                rolled_back_at timestamptz
            );
            CREATE TABLE public.demo_ledger (id integer PRIMARY KEY, amount integer NOT NULL);
            INSERT INTO public.demo_ledger VALUES (1, 123);
            INSERT INTO public."_prisma_migrations"
                VALUES ('baseline', repeat('a', 64), now(), now(), NULL);
        ''')
        before = prisma_migration_snapshot(runner)
        self.assertEqual(self.sql('SELECT amount FROM demo_ledger').stdout.strip(), '123')

        # Compatible additive change: the old query still works, but rollback
        # cannot infer that all other old queries remain compatible.
        self.sql('ALTER TABLE demo_ledger ADD COLUMN notes text;')
        self.sql('''INSERT INTO public."_prisma_migrations"
                    VALUES ('additive', repeat('b', 64), now(), now(), NULL)''')
        self.assertEqual(self.sql('SELECT amount FROM demo_ledger').stdout.strip(), '123')
        with self.assertRaises(MigrationCompatibilityUnverified):
            require_unchanged_migrations(runner, {'prisma_migrations': before})

        # Incompatible DDL, which the production additive gate rejects: /health
        # could still return 200 while an old endpoint query fails.
        bad_ddl = 'ALTER TABLE demo_ledger DROP COLUMN amount;'
        with self.assertRaises(RuntimeError):
            validate_additive_sql(bad_ddl,
                                  'backend/prisma/migrations/20261105000000_dem01/migration.sql')
        self.sql(bad_ddl)
        self.sql('''INSERT INTO public."_prisma_migrations"
                    VALUES ('incompatible', repeat('c', 64), now(), now(), NULL)''')
        self.assertEqual(self.sql('SELECT 1').stdout.strip(), '1')
        self.assertNotEqual(self.sql('SELECT amount FROM demo_ledger', check=False).returncode, 0)
        with self.assertRaises(MigrationCompatibilityUnverified):
            require_unchanged_migrations(runner, {'prisma_migrations': before})


if __name__ == '__main__':
    unittest.main()
