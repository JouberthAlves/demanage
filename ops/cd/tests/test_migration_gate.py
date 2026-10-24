"""Adversarial PostgreSQL DDL release-gate tests, with no database access."""

import hashlib
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from demanage_cd.migration_gate import REVIEWED_SQL, validate_additive_sql  # noqa: E402


class MigrationGateTests(unittest.TestCase):
    def test_adversarial_statements_are_rejected_even_without_blacklisted_tokens(self):
        unsafe = (
            'ALTER TABLE "Entry" ALTER COLUMN "amount" TYPE TEXT;',
            'ALTER TABLE "Entry" ALTER COLUMN "amount" SET DEFAULT 0;',
            'ALTER TABLE "Entry" ALTER COLUMN "amount" SET STORAGE EXTERNAL;',
            'ALTER TABLE "Entry" DISABLE TRIGGER ALL;',
            'ALTER TABLE "Entry" ENABLE ROW LEVEL SECURITY;',
            'ALTER TABLE "Entry" ALTER COLUMN "amount" DROP DEFAULT;',
            'ALTER TABLE "Entry" ADD COLUMN "bad" TEXT DEFAULT pg_sleep(1);',
            'CREATE INDEX idx_bad ON "Entry" ((pg_sleep(1)));',
            'CREATE TABLE "Copy" AS SELECT * FROM "Entry";',
            'CREATE VIEW "v" AS SELECT * FROM "Entry";',
            'GRANT ALL ON "User" TO PUBLIC;',
            'REVOKE ALL ON "Entry" FROM PUBLIC;',
            'ALTER ROLE postgres SUPERUSER;',
            'DO $$ BEGIN PERFORM pg_sleep(1); END $$;',
            'SELECT pg_sleep(1);',
            'COPY "User" TO PROGRAM \'whoami\';',
            'CREATE FUNCTION malicious() RETURNS integer AS $$ SELECT 1 $$ LANGUAGE sql;',
            'CREATE OR REPLACE FUNCTION public.my_function() RETURNS integer AS $$ SELECT 1 $$ LANGUAGE sql;',
            'CREATE TRIGGER dangerous BEFORE INSERT ON "Entry" FOR EACH ROW EXECUTE FUNCTION malicious();',
            'ALTER TYPE "MyEnum" RENAME VALUE \'one\' TO \'two\';',
            'ALTER TYPE pg_catalog."SystemEnum" ADD VALUE \'hacked\';',
            'CREATE TYPE pg_catalog."NewSystemType" AS ENUM (\'x\');',
            'CREATE INDEX idx_evil ON "Entry" ("amount") WHERE pg_sleep(1) IS NULL;',
            'CREATE TABLE "New" ("id" INT, "v" INT GENERATED ALWAYS AS (pg_sleep(1)) STORED);',
            'CREATE TABLE "New" (LIKE "Entry" INCLUDING ALL);',
            'CREATE TABLE "New" ("id" INT); UPDATE "Entry" SET "amount" = 0;',
            'ALTER TABLE "Entry" ADD COLUMN "ok" TEXT; DELETE FROM "Entry";',
        )
        for sql in unsafe:
            with self.subTest(sql=sql), self.assertRaisesRegex(RuntimeError, "manual|unsupported|unsafe|Invalid"):
                validate_additive_sql(sql, "backend/prisma/migrations/20261023000100_test/migration.sql")

    def test_fail_closed_on_empty_or_invalid_sql(self):
        for sql in ('', ' -- only comments', 'CREATE TABLE broken (', '/* unclosed comment'):
            with self.subTest(sql=sql), self.assertRaises(RuntimeError):
                validate_additive_sql(sql, "backend/prisma/migrations/20261023000100_test/migration.sql")

    def test_known_safe_additive_ddl_survives_parser_and_metadata(self):
        safe = '''
            -- This comment mentions DROP TABLE but must not be executable.
            CREATE TYPE "Status" AS ENUM ('DELETE', 'DROP');
            CREATE TABLE "NewTable" (
                "id" TEXT NOT NULL,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "NewTable_pkey" PRIMARY KEY ("id")
            );
            CREATE UNIQUE INDEX "NewTable_id_key" ON "NewTable"("id");
            ALTER TABLE "NewTable" ADD COLUMN "ownerId" TEXT;
            ALTER TABLE "NewTable" ADD CONSTRAINT "NewTable_owner_fkey"
                FOREIGN KEY ("ownerId") REFERENCES "User"("id")
                ON DELETE CASCADE ON UPDATE CASCADE;
            CREATE INDEX "NewTable_owner_null" ON "NewTable"("ownerId")
                WHERE "ownerId" IS NOT NULL;
        '''
        validate_additive_sql(safe, "backend/prisma/migrations/20261023000100_test/migration.sql")

    def test_exactly_reviewed_migrations_allow_only_pinned_bytes_and_paths(self):
        root = Path(__file__).resolve().parents[3]
        for folder in (
            '20261023210000_piggy_correction_origin',
            '20261023210100_oauth_token_connection_status',
            '20261023211000_c04_owner_composite_fks',
            '20261023213000_expense_obligation_versions',
        ):
            path = f'backend/prisma/migrations/{folder}/migration.sql'
            sql = (root / path).read_text(encoding='utf-8')
            with self.subTest(path=path):
                self.assertEqual(hashlib.sha256(sql.encode('utf-8')).hexdigest(), REVIEWED_SQL[path])
                validate_additive_sql(sql, path)
                with self.assertRaisesRegex(RuntimeError, 'manual|unsupported|unsafe'):
                    validate_additive_sql(sql + '\nSELECT 1;', path)
                with self.assertRaisesRegex(RuntimeError, 'manual|unsupported|unsafe'):
                    validate_additive_sql(sql + '\n', path)
                with self.assertRaisesRegex(RuntimeError, 'manual|unsupported|unsafe'):
                    validate_additive_sql(sql + '\n-- altered', path)
                with self.assertRaisesRegex(RuntimeError, 'manual|unsupported|unsafe'):
                    validate_additive_sql('CREATE TABLE "Harmless" ("id" TEXT);', path)
                with self.assertRaisesRegex(RuntimeError, 'manual|unsupported|unsafe'):
                    validate_additive_sql(sql, 'backend/prisma/migrations/20261023000100_unreviewed/migration.sql')
                with self.assertRaisesRegex(RuntimeError, 'manual|unsupported|unsafe'):
                    validate_additive_sql(sql, './' + path)

    def test_nonpublic_schema_statements_remain_blocked(self):
        path = 'backend/prisma/migrations/20261023000100_unreviewed/migration.sql'
        for sql in (
            'CREATE TABLE private."Records" ("id" TEXT);',
            'ALTER TABLE private."Entry" ADD COLUMN "note" TEXT;',
            'CREATE INDEX "entry_note_idx" ON private."Entry" ("note");',
            'CREATE TYPE private."Status" AS ENUM (\'active\');',
            'SET search_path TO private; CREATE TABLE "Records" ("id" TEXT);',
        ):
            with self.subTest(sql=sql), self.assertRaisesRegex(RuntimeError, 'manual|unsupported|unsafe'):
                validate_additive_sql(sql, path)

    def test_reviewed_c04_f02_cannot_be_redirected_to_another_schema(self):
        root = Path(__file__).resolve().parents[3]
        replacements = (
            (
                '20261023211000_c04_owner_composite_fks',
                'LOCK TABLE "PiggyTransaction"',
                'LOCK TABLE private."PiggyTransaction"',
            ),
            (
                '20261023213000_expense_obligation_versions',
                'CREATE TABLE "ExpenseObligationVersion"',
                'CREATE TABLE private."ExpenseObligationVersion"',
            ),
        )
        for folder, original, altered in replacements:
            path = f'backend/prisma/migrations/{folder}/migration.sql'
            sql = (root / path).read_text(encoding='utf-8')
            self.assertIn(original, sql)
            with self.subTest(path=path), self.assertRaisesRegex(RuntimeError, 'manual|unsupported|unsafe'):
                validate_additive_sql(sql.replace(original, altered, 1), path)

    def test_unsafe_c04_owner_fk_update_cascade_remains_blocked(self):
        root = Path(__file__).resolve().parents[1]
        path = 'backend/prisma/migrations/20261023211000_c04_owner_composite_fks/migration.sql'
        sql = (root / 'tests/fixtures/20261023211000_c04_owner_composite_fks.sql').read_text(encoding='utf-8')
        with self.assertRaisesRegex(RuntimeError, 'manual|unsupported|unsafe'):
            validate_additive_sql(sql, path)

    def test_c04_migration_cannot_reparent_child_owner_by_update_cascade(self):
        root = Path(__file__).resolve().parents[3]
        sql = (root / 'backend/prisma/migrations/20261023211000_c04_owner_composite_fks/migration.sql').read_text(encoding='utf-8')
        schema = (root / 'backend/prisma/schema.prisma').read_text(encoding='utf-8')
        self.assertNotIn('ON UPDATE CASCADE NOT VALID', sql)
        self.assertEqual(sql.count('ON UPDATE NO ACTION NOT VALID'), 2)
        self.assertIn('references: [id, userId], onDelete: Cascade, onUpdate: NoAction', schema)
    def test_f02_obligation_version_ddl_is_atomic(self):
        root = Path(__file__).resolve().parents[3]
        sql = (root / 'backend/prisma/migrations/20261023213000_expense_obligation_versions/migration.sql').read_text(encoding='utf-8').strip()
        self.assertTrue(sql.startswith('BEGIN;'), 'F02 DDL must start explicit transaction')
        self.assertTrue(sql.endswith('COMMIT;'), 'F02 DDL must finish in the same transaction')
    def test_parser_is_mandatory_without_installed_dependency(self):
        from unittest import mock

        with mock.patch('demanage_cd.migration_gate.pg_parse_sql', None):
            with self.assertRaisesRegex(RuntimeError, 'parser unavailable'):
                validate_additive_sql('CREATE TABLE "New" ("id" INT);', 'unknown')


if __name__ == '__main__':
    unittest.main()
