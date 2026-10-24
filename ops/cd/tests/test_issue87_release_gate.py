"""Adversarial executable tests for the one-release production migration gate."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from issue87_release_gate import (  # noqa: E402
    main,
    verify_exact_sensitive_diff,
    verify_one_time_issue87_release,
)


ROOT = Path(__file__).resolve().parents[3]
PREVIOUS = "ec2a3d40a6c8218ab0550258305e1745ee3b1fbc"
TARGET = "62e98ccea16dd0d3164ab1689c11fe770b983393"
DUMP = "be5d1dd8432507f8f23fca55fe3ae4261cf1a2a58efbf18a7a179e2e792fc84c"
PROOF = "b0e07420cb4102daeafffb7efa53f528e5c55ca410dd4d5da13be065dd153495"
BACKEND = "ghcr.io/bielxdh3/demanage-backend@sha256:5d39a9d37c5b476641c42eebb487d2ea2183eb1f1f83b6c1b140a0ed8e9d6837"
FRONTEND = "ghcr.io/bielxdh3/demanage-frontend@sha256:e44c023e7fbcefa55e1e8a9421e10777691121bb2534d7297333d1c45684294a"
NOW = datetime(2026, 10, 24, 13, tzinfo=timezone.utc)


class Issue87ReleaseGateTests(unittest.TestCase):
    def arguments(self, **updates):
        values = {
            "repo": ROOT,
            "previous": PREVIOUS,
            "target": TARGET,
            "dump_sha256": DUMP,
            "rehearsal_sha256": PROOF,
            "backend": BACKEND,
            "frontend": FRONTEND,
            "now": NOW,
        }
        values.update(updates)
        return values

    def test_exact_commit_with_rehearsal_and_images_is_eligible_for_human_approval(self):
        self.assertTrue(verify_one_time_issue87_release(**self.arguments()))

    def test_wrong_source_or_target_is_rejected(self):
        for changed in ({"previous": "0" * 40}, {"target": "1" * 40}):
            with self.subTest(changed=changed), self.assertRaisesRegex(RuntimeError, "exact.*commit"):
                verify_one_time_issue87_release(**self.arguments(**changed))

    def test_wrong_or_missing_proof_and_dump_are_rejected(self):
        for changed in (
            {"dump_sha256": "0" * 64},
            {"dump_sha256": ""},
            {"rehearsal_sha256": "1" * 64},
            {"rehearsal_sha256": ""},
        ):
            with self.subTest(changed=changed), self.assertRaisesRegex(RuntimeError, "reviewed.*(dump|rehearsal)"):
                verify_one_time_issue87_release(**self.arguments(**changed))

    def test_wrong_immutable_image_digests_are_rejected(self):
        for changed in (
            {"backend": BACKEND.replace("5d39a9", "0d39a9")},
            {"frontend": BACKEND},
            {"frontend": FRONTEND.split("@", 1)[0] + ":sha-" + TARGET},
        ):
            with self.subTest(changed=changed), self.assertRaisesRegex(RuntimeError, "immutable.*image"):
                verify_one_time_issue87_release(**self.arguments(**changed))

    def test_expired_or_future_rehearsal_is_rejected(self):
        for date in (datetime(2026, 10, 24, 12, tzinfo=timezone.utc),
                     datetime(2026, 10, 27, tzinfo=timezone.utc)):
            with self.subTest(date=date), self.assertRaisesRegex(RuntimeError, "rehearsal.*window"):
                verify_one_time_issue87_release(**self.arguments(now=date))

    def test_cli_checks_real_reviewed_git_history_and_rejects_bad_image(self):
        args = [
            "--repo", str(ROOT), "--previous", PREVIOUS,
            "--target", TARGET, "--dump-sha256", DUMP, "--rehearsal-sha256", PROOF,
            "--backend", BACKEND, "--frontend", FRONTEND,
        ]
        stdout, stderr = StringIO(), StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            self.assertEqual(main(args, now=NOW), 0)
        self.assertIn("ISSUE87_RELEASE_GATE=PASS", stdout.getvalue())
        stdout, stderr = StringIO(), StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            self.assertNotEqual(main(args[:-2] + ["--frontend", BACKEND], now=NOW), 0)
        self.assertNotIn("ISSUE87_RELEASE_GATE=PASS", stdout.getvalue())

    def test_actual_git_sensitive_diff_rejects_extra_paths_and_mutated_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            self.git(repo, "init", "-q")
            self.git(repo, "config", "user.name", "Test")
            self.git(repo, "config", "user.email", "test@example.invalid")
            schema = repo / "backend/prisma/schema.prisma"
            schema.parent.mkdir(parents=True)
            schema.write_text("version=1\n", encoding="utf-8")
            self.git(repo, "add", "backend/prisma/schema.prisma")
            self.git(repo, "commit", "-qm", "baseline")
            prev = self.git(repo, "rev-parse", "HEAD")
            schema.write_text("version=2\n", encoding="utf-8")
            self.git(repo, "commit", "-qam", "reviewed schema")
            reviewed = self.git(repo, "rev-parse", "HEAD")
            blob = self.git(repo, "rev-parse", f"{reviewed}:backend/prisma/schema.prisma")
            allowed = {"backend/prisma/schema.prisma": "M"}
            pinned = {"backend/prisma/schema.prisma": blob}
            verify_exact_sensitive_diff(repo, prev, reviewed, allowed, pinned)

            (repo / "backend/entrypoint.sh").write_text("unsafe entrypoint\n", encoding="utf-8")
            self.git(repo, "add", "backend/entrypoint.sh")
            self.git(repo, "commit", "-qm", "extra sensitive path")
            compromised = self.git(repo, "rev-parse", "HEAD")
            with self.assertRaisesRegex(RuntimeError, "sensitive.*diff"):
                verify_exact_sensitive_diff(repo, prev, compromised, allowed, pinned)

            schema.write_text("attacker modification\n", encoding="utf-8")
            self.git(repo, "commit", "-qam", "changed schema bytes")
            tampered = self.git(repo, "rev-parse", "HEAD")
            with self.assertRaisesRegex(RuntimeError, "sensitive.*diff"):
                verify_exact_sensitive_diff(repo, prev, tampered,
                                            {"backend/prisma/schema.prisma": "M",
                                             "backend/entrypoint.sh": "A"},
                                            pinned)

    @staticmethod
    def git(repo: Path, *arguments: str) -> str:
        result = subprocess.run(["git", "-C", str(repo), *arguments],
                                capture_output=True, text=True, check=True)
        return result.stdout.strip()


if __name__ == "__main__":
    unittest.main()
