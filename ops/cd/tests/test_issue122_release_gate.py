"""Fail-closed tests for the one-time Issue122 production gate."""
from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from issue122_release_gate import (  # noqa: E402
    PREVIOUS_COMMIT, TARGET_COMMIT, BACKUP_SHA256, REHEARSAL_SHA256,
    ROLLBACK_SHA256, LIVE_MIGRATION_SHA256, BACKEND_IMAGE,
    FRONTEND_IMAGE, EXPECTED_BLOBS, EXPECTED_SENSITIVE_DIFF,
    verify_one_time_issue122_release,
)

ROOT = Path(__file__).resolve().parents[3]
NOW = datetime(2026, 11, 8, 23, 0, tzinfo=timezone.utc)


class Issue122ReleaseGateTests(unittest.TestCase):
    def check(self, **overrides):
        args = dict(
            repo=ROOT, previous=PREVIOUS_COMMIT, target=TARGET_COMMIT,
            backup_sha256=BACKUP_SHA256, rehearsal_sha256=REHEARSAL_SHA256,
            rollback_sha256=ROLLBACK_SHA256,
            live_migration_sha256=LIVE_MIGRATION_SHA256,
            backend=BACKEND_IMAGE, frontend=FRONTEND_IMAGE, now=NOW,
        )
        args.update(overrides)
        return verify_one_time_issue122_release(**args)

    def test_exact_signed_ancestry_and_sensitive_blob_set(self):
        self.assertTrue(self.check())
        self.assertEqual(set(EXPECTED_BLOBS), set(EXPECTED_SENSITIVE_DIFF))
        self.assertEqual(set(EXPECTED_BLOBS), {
            "backend/prisma/migrations/20261105183000_trusted_login_device/migration.sql",
            "backend/prisma/schema.prisma", "docker-compose.prod.yml",
        })

    def test_never_eligible_for_other_previous_or_target(self):
        for kwargs in ({"previous": "0" * 40}, {"target": "1" * 40}):
            with self.subTest(kwargs=kwargs), self.assertRaisesRegex(RuntimeError, "exact Issue122"):
                self.check(**kwargs)

    def test_wrong_or_absent_proof_or_image_always_denied(self):
        for field in (
            "backup_sha256", "rehearsal_sha256",
            "rollback_sha256", "live_migration_sha256",
            "backend", "frontend",
        ):
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                self.check(**{field: ""})
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                self.check(**{field: "f" * 64})

    def test_naive_early_and_expired_clock_denied(self):
        for when in (
            datetime(2026, 11, 8, 22, 52, tzinfo=timezone.utc),
            datetime(2026, 11, 11, tzinfo=timezone.utc),
            datetime(2026, 11, 8, 23, 0),
        ):
            with self.subTest(when=when), self.assertRaises(RuntimeError):
                self.check(now=when)

    def test_tampered_tree_and_missing_ancestry_fail_closed(self):
        with mock.patch(
            "issue122_release_gate.verify_exact_sensitive_diff",
            side_effect=RuntimeError("tampered")
        ):
            with self.assertRaisesRegex(RuntimeError, "tampered"):
                self.check()
        with mock.patch("issue122_release_gate._git", side_effect=RuntimeError("bad ancestry")):
            with self.assertRaisesRegex(RuntimeError, "bad ancestry"):
                self.check()


if __name__ == "__main__":
    unittest.main()
