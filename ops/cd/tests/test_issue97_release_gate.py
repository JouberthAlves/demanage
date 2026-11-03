"""Fail-closed proof checks for the one-time issue #97 production promotion."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from issue97_release_gate import (  # noqa: E402
    BACKEND_IMAGE, BACKUP_SHA256, FRONTEND_IMAGE, LIVE_MIGRATION_SHA256,
    PREVIOUS_COMMIT, REHEARSAL_SHA256, TARGET_COMMIT,
    EXPECTED_BLOBS, EXPECTED_SENSITIVE_DIFF, verify_one_time_issue97_release,
)

ROOT = Path(__file__).resolve().parents[3]
NOW = datetime(2026, 11, 3, 4, 0, tzinfo=timezone.utc)


class Issue97ExactReleaseGateTests(unittest.TestCase):
    def eligible(self, **overrides):
        values = dict(
            repo=ROOT, previous=PREVIOUS_COMMIT, target=TARGET_COMMIT,
            dump_sha256=BACKUP_SHA256, rehearsal_sha256=REHEARSAL_SHA256,
            live_migration_sha256=LIVE_MIGRATION_SHA256,
            backend=BACKEND_IMAGE, frontend=FRONTEND_IMAGE, now=NOW,
        )
        values.update(overrides)
        return verify_one_time_issue97_release(**values)

    def test_only_exact_reviewed_pair_and_blobs_are_eligible(self):
        self.assertTrue(self.eligible())
        self.assertEqual(set(EXPECTED_SENSITIVE_DIFF), set(EXPECTED_BLOBS))
        self.assertEqual(set(EXPECTED_SENSITIVE_DIFF), {
            'backend/entrypoint.sh',
            'backend/prisma/migrations/20261102211000_salary_period_history/migration.sql',
            'backend/prisma/schema.prisma',
            'docker-compose.prod.yml',
        })

    def test_wrong_commit_pair_denied(self):
        for values in ({'previous': '0' * 40}, {'target': '1' * 40}):
            with self.subTest(values=values), self.assertRaisesRegex(RuntimeError, 'exact.*commit'):
                self.eligible(**values)

    def test_missing_wrong_or_swapped_proofs_and_images_denied(self):
        for values in (
            {'dump_sha256': ''}, {'dump_sha256': '0' * 64},
            {'rehearsal_sha256': ''}, {'rehearsal_sha256': '1' * 64},
            {'live_migration_sha256': ''}, {'live_migration_sha256': '2' * 64},
            {'backend': FRONTEND_IMAGE}, {'frontend': BACKEND_IMAGE},
        ):
            with self.subTest(values=values), self.assertRaises(RuntimeError):
                self.eligible(**values)

    def test_expired_early_and_naive_clocks_denied(self):
        for instant in (
            datetime(2026, 11, 3, 3, 47, tzinfo=timezone.utc),
            datetime(2026, 11, 6, tzinfo=timezone.utc),
            datetime(2026, 11, 3, 4, 0),
        ):
            with self.subTest(instant=instant), self.assertRaises(RuntimeError):
                self.eligible(now=instant)

    def test_sensitive_path_mutation_fail_closed(self):
        with mock.patch('issue97_release_gate.verify_exact_sensitive_diff', side_effect=RuntimeError('tampered blob')):
            with self.assertRaisesRegex(RuntimeError, 'tampered blob'):
                self.eligible()

    def test_commit_must_descend_from_live_previous(self):
        with mock.patch('issue97_release_gate._git', side_effect=RuntimeError('bad ancestry')):
            with self.assertRaisesRegex(RuntimeError, 'bad ancestry'):
                self.eligible()


if __name__ == '__main__':
    unittest.main()
