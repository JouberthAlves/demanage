"""Regression tests for offline CI evidence validation."""

import hashlib
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from demanage_cd.local_ci import GATES, validate_ci_evidence  # noqa: E402

COMMIT = "a" * 40
NOW = datetime(2026, 10, 17, 16, tzinfo=timezone.utc)


class LocalCiEvidenceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.proof = {
            "version": 1, "source_commit": COMMIT,
            "completed_at": NOW.isoformat(), "image_builds": True,
            "steps": [],
        }
        for name in GATES:
            data = f"Step: {name}\nStarted: {NOW.isoformat()}\nOK\nExit code: 0\n".encode()
            (self.folder / (name + ".log")).write_bytes(data)
            self.proof["steps"].append({"name": name, "sha256": hashlib.sha256(data).hexdigest()})
        self.write()

    def write(self):
        (self.folder / "local-ci-evidence.json").write_text(json.dumps(self.proof))

    def validate(self):
        return validate_ci_evidence(self.folder, COMMIT, now=NOW)

    def test_all_gates_pass_and_bound_sha(self):
        self.assertEqual(len(self.validate()), 64)

    def test_refuse_different_commit(self):
        with self.assertRaisesRegex(ValueError, "different revision"):
            validate_ci_evidence(self.folder, "b" * 40, now=NOW)

    def test_refuse_corrupted_log(self):
        with (self.folder / (GATES[4] + ".log")).open("ab") as stream:
            stream.write(b"CORRUPTED")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            self.validate()

    def test_refuse_fake_green_log(self):
        name = GATES[7]
        content = f"Step: {name}\nExit code: 1\n".encode()
        (self.folder / (name + ".log")).write_bytes(content)
        self.proof["steps"][7]["sha256"] = hashlib.sha256(content).hexdigest()
        self.write()
        with self.assertRaisesRegex(ValueError, "did not complete"):
            self.validate()

    def test_refuse_skipped_gate(self):
        self.proof["steps"].pop()
        self.write()
        with self.assertRaisesRegex(ValueError, "missing, reordered"):
            self.validate()

    def test_refuse_old_evidence(self):
        self.proof["completed_at"] = (NOW - timedelta(days=9)).isoformat()
        self.write()
        with self.assertRaisesRegex(ValueError, "stale"):
            self.validate()

    def test_refuse_no_image_builds(self):
        self.proof["image_builds"] = False
        self.write()
        with self.assertRaisesRegex(ValueError, "image builds"):
            self.validate()

    def test_refuse_symlink_log(self):
        source = self.folder / (GATES[0] + ".log")
        outside = self.folder / "outside"
        source.rename(outside)
        try:
            source.symlink_to(outside)
        except (OSError, NotImplementedError):
            self.skipTest("Symlink privileges unavailable")
        with self.assertRaisesRegex(ValueError, "symlinked"):
            self.validate()


if __name__ == "__main__":
    unittest.main()
