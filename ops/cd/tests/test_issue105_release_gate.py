"""Adversarial checks for a single reviewed database migration promotion."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from issue105_release_gate import (  # noqa: E402
    BACKEND_IMAGE, BACKUP_SHA256, FRONTEND_IMAGE,
    LIVE_MIGRATION_SHA256, PREVIOUS_COMMIT, REHEARSAL_SHA256, TARGET_COMMIT,
    verify_one_time_issue105_release,
)

ROOT = Path(__file__).resolve().parents[3]
NOW = datetime(2026, 11, 2, 20, tzinfo=timezone.utc)


class Issue105ReviewedMigrationGateTests(unittest.TestCase):
    def eligible(self, **overrides):
        kwargs = dict(
            repo=ROOT, previous=PREVIOUS_COMMIT, target=TARGET_COMMIT,
            dump_sha256=BACKUP_SHA256,
            rehearsal_sha256=REHEARSAL_SHA256,
            live_migration_sha256=LIVE_MIGRATION_SHA256,
            backend=BACKEND_IMAGE, frontend=FRONTEND_IMAGE, now=NOW,
        )
        kwargs.update(overrides)
        return verify_one_time_issue105_release(**kwargs)

    def test_exact_reviewed_schema_and_images_eligible(self):
        self.assertTrue(self.eligible())

    def test_commit_pairs_and_extra_sensitive_edits_fail_closed(self):
        for values in ({"previous": "0" * 40}, {"target": "f" * 40}):
            with self.subTest(values=values), self.assertRaisesRegex(RuntimeError, "exact.*commit"):
                self.eligible(**values)

    def test_any_proof_or_image_mismatch_fails_closed(self):
        for values in (
            {"dump_sha256": "0" * 64},
            {"rehearsal_sha256": ""},
            {"live_migration_sha256": "1" * 64},
            {"backend": FRONTEND_IMAGE},
            {"frontend": BACKEND_IMAGE},
        ):
            with self.subTest(values=values), self.assertRaises(RuntimeError):
                self.eligible(**values)

    def test_evidence_expiry_and_clock_validation(self):
        for date in (
            datetime(2026, 11, 2, 19, 50, tzinfo=timezone.utc),
            datetime(2026, 11, 5, tzinfo=timezone.utc),
            datetime(2026, 11, 2, 20),
        ):
            with self.subTest(date=date), self.assertRaises(RuntimeError):
                self.eligible(now=date)


if __name__ == "__main__":
    unittest.main()
