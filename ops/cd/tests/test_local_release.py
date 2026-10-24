"""Fail-closed tests for the owner-owned local release approval channel."""

import argparse
import importlib.util
import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
MODULE = Path(__file__).resolve().parents[1] / "local_release_approval.py"
spec = importlib.util.spec_from_file_location("local_release_approval", MODULE)
approval = importlib.util.module_from_spec(spec)
spec.loader.exec_module(approval)

TARGET = "a" * 40
PREVIOUS = "b" * 40
BACKEND = "ghcr.io/bielxdh3/demanage-backend@sha256:" + "c" * 64
FRONTEND = "ghcr.io/bielxdh3/demanage-frontend@sha256:" + "d" * 64
PROOF = "/opt/demanage/backups/cd-20261017T140000Z-" + TARGET[:12] + "/local-migration-rehearsal.json"
BACKUP = str(PurePosixPath(PROOF).parent / "demanage.dump")
CHECKSUM = "e" * 64


def arguments(**updates):
    data = {
        "source_commit": TARGET, "confirm_sha": TARGET,
        "log_directory": Path("imaginary"),
        "migration_proof": PROOF, "confirm_migration_backup_sha256": CHECKSUM,
        "publish": False, "acknowledge_no_codeql": False,
    }
    data.update(updates)
    return argparse.Namespace(**data)


def migration_evidence(**updates):
    data = {
        "version": 1, "source_commit": TARGET, "previous_commit": PREVIOUS,
        "backend_ref": BACKEND, "backup_path": BACKUP,
        "backup_sha256": CHECKSUM, "migration_count_before": 26,
        "migration_count_after": 30, "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    data.update(updates)
    return data


def production_manifest():
    return {
        "version": 1, "source_commit": PREVIOUS, "previous_commit": "f" * 40,
        "backend": BACKEND, "frontend": FRONTEND,
        "approved_by": "bielxdh3", "approved_at": datetime.now(timezone.utc).isoformat(),
    }


class LocalReleaseApprovalTests(unittest.TestCase):
    def setup_success(self):
        patches = [
            mock.patch.object(approval, "validate_ci_evidence", return_value="f" * 64),
            mock.patch.object(approval, "json_call", return_value={"login": "bielxdh3"}),
            mock.patch.object(approval, "read_live_manifest", return_value=(production_manifest(), "github-blob")),
            mock.patch.object(approval, "call", return_value=json.dumps({"source_commit": PREVIOUS})),
            mock.patch.object(approval, "verify_git", return_value=True),
            mock.patch.object(approval, "verify_image", side_effect=[BACKEND, FRONTEND]),
            mock.patch.object(approval, "read_migration_proof", return_value=(migration_evidence(), "f" * 64)),
        ]
        self.addCleanup(lambda: [p.stop() for p in patches])
        return [p.start() for p in patches]

    def test_dry_run_never_writes_production_pointer(self):
        self.setup_success()
        self.assertEqual(approval.promote(arguments()), "dry-run")

    def test_refuse_unconfirmed_target(self):
        with self.assertRaisesRegex(RuntimeError, "explicitly confirm"):
            approval.promote(arguments(confirm_sha="f" * 40))

    def test_refuse_publication_without_codeql_acknowledgement(self):
        with self.assertRaisesRegex(RuntimeError, "acknowledge"):
            approval.promote(arguments(publish=True))

    def test_refuse_other_github_actor(self):
        mocks = self.setup_success()
        mocks[1].return_value = {"login": "another-user"}
        with self.assertRaisesRegex(RuntimeError, "authenticated repository owner"):
            approval.promote(arguments())

    def test_refuse_server_release_drift(self):
        mocks = self.setup_success()
        mocks[3].return_value = json.dumps({"source_commit": "9" * 40})
        with self.assertRaisesRegex(RuntimeError, "differs from production"):
            approval.promote(arguments())

    def test_refuse_missing_reviewed_migration(self):
        self.setup_success()
        with self.assertRaisesRegex(RuntimeError, "require a reviewed"):
            approval.promote(arguments(migration_proof=None))

    def test_refuse_migration_checksum_not_acknowledged(self):
        self.setup_success()
        with self.assertRaisesRegex(RuntimeError, "not explicitly acknowledged"):
            approval.promote(arguments(confirm_migration_backup_sha256="9" * 64))

    def test_refuse_unexpected_proof_path(self):
        with self.assertRaisesRegex(RuntimeError, "Invalid server rehearsal"):
            approval.read_migration_proof("/etc/passwd", PREVIOUS, TARGET, BACKEND)

    def test_rehearsal_checks_snapshot_hash(self):
        data = migration_evidence()
        with mock.patch.object(approval, "call", side_effect=[json.dumps(data), CHECKSUM + "  " + BACKUP]):
            loaded, checksum = approval.read_migration_proof(PROOF, PREVIOUS, TARGET, BACKEND)
        self.assertEqual(loaded, data)
        self.assertEqual(len(checksum), 64)

    def test_rehearsal_uses_posix_path_even_on_windows(self):
        self.assertEqual(
            BACKUP,
            "/opt/demanage/backups/cd-20261017T140000Z-" + TARGET[:12] + "/demanage.dump",
        )

    def test_rehearsal_refuses_changed_dump(self):
        data = migration_evidence()
        with mock.patch.object(approval, "call", side_effect=[json.dumps(data), "0" * 64 + "  " + BACKUP]):
            with self.assertRaisesRegex(RuntimeError, "changed since review"):
                approval.read_migration_proof(PROOF, PREVIOUS, TARGET, BACKEND)

    def test_rehearsal_refuses_insufficient_schema_count(self):
        data = migration_evidence(migration_count_after=26)
        with mock.patch.object(approval, "call", return_value=json.dumps(data)):
            with self.assertRaisesRegex(RuntimeError, "not applied"):
                approval.read_migration_proof(PROOF, PREVIOUS, TARGET, BACKEND)

    def test_rehearsal_refuses_mismatch(self):
        data = migration_evidence(source_commit="7" * 40)
        with mock.patch.object(approval, "call", return_value=json.dumps(data)):
            with self.assertRaisesRegex(RuntimeError, "not bound"):
                approval.read_migration_proof(PROOF, PREVIOUS, TARGET, BACKEND)

    def test_git_rejects_destructive_new_migration(self):
        with mock.patch.object(approval, "call", side_effect=[
            TARGET + " refs/heads/master", "", "",
            "backend/prisma/migrations/20261017120000_danger/migration.sql",
            "A\tbackend/prisma/migrations/20261017120000_danger/migration.sql",
        ]):
            with mock.patch.object(approval, "read_git_sql", return_value='DROP TABLE "User";'), \
                    mock.patch.object(approval.subprocess, "run", return_value=mock.Mock(returncode=0)):
                with self.assertRaisesRegex(RuntimeError, "manual audited runbook"):
                    approval.verify_git(Path("test-repo"), PREVIOUS, TARGET)

    def test_git_allows_additive_new_migration(self):
        with mock.patch.object(approval, "call", side_effect=[
            TARGET + " refs/heads/master", "", "",
            "backend/prisma/migrations/20261017120000_add/migration.sql",
            "A\tbackend/prisma/migrations/20261017120000_add/migration.sql",
        ]):
            with mock.patch.object(approval, "read_git_sql", return_value='CREATE TABLE "NewTable" ("id" TEXT NOT NULL);'), \
                    mock.patch.object(approval.subprocess, "run", return_value=mock.Mock(returncode=0)):
                self.assertTrue(approval.verify_git(Path("test-repo"), PREVIOUS, TARGET))

    def test_git_reads_exact_sql_bytes_from_committed_blob(self):
        root = Path(__file__).resolve().parents[3]
        for folder in (
            "20261023210000_piggy_correction_origin",
            "20261023210100_oauth_token_connection_status",
            "20261023211000_c04_owner_composite_fks",
            "20261023213000_expense_obligation_versions",
        ):
            path = f"backend/prisma/migrations/{folder}/migration.sql"
            with self.subTest(path=path):
                self.assertEqual(approval.read_git_sql(root, "HEAD", path), (root / path).read_bytes().decode("utf-8"))

    def test_git_accepts_all_four_exactly_reviewed_pr_migrations(self):
        root = Path(__file__).resolve().parents[3]
        files = [
            f"backend/prisma/migrations/{folder}/migration.sql"
            for folder in (
                "20261023210000_piggy_correction_origin",
                "20261023210100_oauth_token_connection_status",
                "20261023211000_c04_owner_composite_fks",
                "20261023213000_expense_obligation_versions",
            )
        ]
        contents = [(root / path).read_text(encoding="utf-8") for path in files]
        with mock.patch.object(approval, "call", side_effect=[
            TARGET + " refs/heads/master", "", "",
            "\n".join(["backend/prisma/schema.prisma", *files]),
            "\n".join("A\t" + path for path in files),
        ]):
            with mock.patch.object(approval, "read_git_sql", side_effect=contents), \
                    mock.patch.object(approval.subprocess, "run", return_value=mock.Mock(returncode=0)):
                self.assertTrue(approval.verify_git(Path("test-repo"), PREVIOUS, TARGET))

    def test_git_refuses_c04_migration_before_safe_fk_revision(self):
        path = "backend/prisma/migrations/20261023211000_c04_owner_composite_fks/migration.sql"
        sql = (Path(__file__).resolve().parent / "fixtures/20261023211000_c04_owner_composite_fks.sql").read_text(encoding="utf-8")
        with mock.patch.object(approval, "call", side_effect=[
            TARGET + " refs/heads/master", "", "", path, "A\t" + path,
        ]):
            with mock.patch.object(approval, "read_git_sql", return_value=sql), \
                    mock.patch.object(approval.subprocess, "run", return_value=mock.Mock(returncode=0)):
                with self.assertRaisesRegex(RuntimeError, "manual audited runbook"):
                    approval.verify_git(Path("test-repo"), PREVIOUS, TARGET)

    def test_git_rejects_modified_bytes_at_reviewed_c04_path(self):
        root = Path(__file__).resolve().parents[3]
        path = "backend/prisma/migrations/20261023211000_c04_owner_composite_fks/migration.sql"
        altered = (root / path).read_text(encoding="utf-8") + "\n"
        with mock.patch.object(approval, "call", side_effect=[
            TARGET + " refs/heads/master", "", "", path, "A\t" + path,
        ]):
            with mock.patch.object(approval, "read_git_sql", return_value=altered), \
                    mock.patch.object(approval.subprocess, "run", return_value=mock.Mock(returncode=0)):
                with self.assertRaisesRegex(RuntimeError, "manual audited runbook"):
                    approval.verify_git(Path("test-repo"), PREVIOUS, TARGET)

    def test_git_blocks_non_additive_column_type_change_that_old_regex_allowed(self):
        file = "backend/prisma/migrations/20261023220000_sneaky/migration.sql"
        with mock.patch.object(approval, "call", side_effect=[
            TARGET + " refs/heads/master", "", "", file, "A\t" + file,
        ]):
            with mock.patch.object(approval, "read_git_sql", return_value='ALTER TABLE "Entry" ALTER COLUMN "amount" TYPE TEXT;'), \
                    mock.patch.object(approval.subprocess, "run", return_value=mock.Mock(returncode=0)):
                with self.assertRaisesRegex(RuntimeError, "manual audited runbook"):
                    approval.verify_git(Path("test-repo"), PREVIOUS, TARGET)


if __name__ == "__main__":
    unittest.main()
