"""Unit guards for the exact two-phase Issue122 production migration."""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import issue122_live_migration as gate  # noqa: E402


class Issue122LiveMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.backups = self.root / "backups"
        self.backups.mkdir()
        self.dirname = self.backups / "cd-fake-issue122"
        self.dirname.mkdir()
        self.dump = self.dirname / "demanage.dump"
        self.dump.write_bytes(b"isolated-fake-test-dump-not-real-finances")
        self.sha = hashlib.sha256(self.dump.read_bytes()).hexdigest()
        self.preflight = self.dirname / "issue122-live-preflight.json"
        self.before = {
            "User": 1, "Expense": 3, "Entry": 2, "PiggyBank": 1,
            "PiggyTransaction": 1, "migrated": 37, "target": 0,
        }
        self.after = {**self.before, "migrated": 38, "target": 1}
        self.preflight.write_text(json.dumps({
            "version": 1,
            "previous_commit": gate.PREVIOUS,
            "source_commit": gate.TARGET,
            "backend_ref": gate.BACKEND,
            "backup_path": str(self.dump),
            "backup_sha256": self.sha,
            "migration_rehearsal_sha256": gate.REHEARSAL_SHA,
            "rollback_proof_sha256": gate.ROLLBACK_SHA,
            "prepared_at": datetime.now(timezone.utc).isoformat(),
            "before": self.before,
        }), encoding="utf-8")

    def test_invalid_confirmed_hash_fails_before_migration_command(self):
        with mock.patch.object(gate, "status", return_value=({"backup_root": str(self.backups)}, object())), mock.patch.object(
            gate, "check_readiness"
        ), mock.patch.object(gate, "safe_command") as command:
            with self.assertRaisesRegex(RuntimeError, "confirmation"):
                gate.apply(self.root / "unused-config", self.preflight, "a" * 64)
            command.assert_not_called()

    def test_current_counts_change_blocks_without_writing_schema(self):
        with mock.patch.object(gate, "status", return_value=({"backup_root": str(self.backups)}, object())), mock.patch.object(
            gate, "check_readiness"
        ), mock.patch.object(gate, "db_summary", return_value={**self.before, "User": 2}), mock.patch.object(
            gate, "safe_command"
        ) as command:
            with self.assertRaisesRegex(RuntimeError, "counts"):
                gate.apply(self.root / "unused-config", self.preflight, self.sha)
            command.assert_not_called()

    def test_only_pinned_digest_and_db_container_namespace_are_used(self):
        calls = []
        with mock.patch.object(gate, "status", return_value=({
            "backup_root": str(self.backups), "env_file": "/opt/demanage/.env"
        }, object())), mock.patch.object(gate, "check_readiness"), mock.patch.object(
            gate, "db_summary", side_effect=[self.before, self.after]
        ), mock.patch.object(gate, "safe_command", side_effect=lambda args: calls.append(args) or ""):
            proof = gate.apply(self.root / "unused-config", self.preflight, self.sha)
        self.assertEqual(len(calls), 1)
        command = calls[0]
        self.assertEqual(command[:3], ["docker", "run", "--rm"])
        self.assertIn("container:demanage-db", command)
        self.assertIn(gate.BACKEND, command)
        self.assertIn("--read-only", command)
        self.assertIn("--cap-drop", command)
        self.assertNotIn("-p", command)
        self.assertNotIn("--publish", command)
        written = json.loads(proof.read_text())
        self.assertEqual(written["after"]["migrated"], 38)
        self.assertEqual(written["before"]["Expense"], written["after"]["Expense"])

    def test_subprocess_errors_do_not_return_secret_stdout_stderr(self):
        result = subprocess.CompletedProcess([], 2, "SECRET123", "SECRET456")
        with mock.patch.object(gate.subprocess, "run", return_value=result):
            with self.assertRaises(RuntimeError) as caught:
                gate.safe_command(["docker", "run", "-e", "PASSWORD=SECRET789"])
        self.assertNotIn("SECRET", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
