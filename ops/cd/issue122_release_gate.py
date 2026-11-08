"""Exact, one-time Issue122 production promotion witness after independent live migration.

Eligibility only: cannot approve production, alter GitHub's protected environment,
or bypass the Debian pull-only deploy agent. All hashes are reviewed immutable
release evidence; unrelated schema/Compose changes remain blocked.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

from issue87_release_gate import _git, verify_exact_sensitive_diff

PREVIOUS_COMMIT = "15237faaf0bbd380d27494a1bfd87993ca8e28ca"
TARGET_COMMIT = "13f860b851d1e2a8ae8789bfe2aeb99909d73be4"
BACKUP_SHA256 = "8caaf77f0e81ec82c5fac8f7649ee8eab9d1a3a7c6d27e81e1e0b93f0fb668c7"
REHEARSAL_SHA256 = "26845259b842d489c4fb7d94d37aed3298097cdaede64526d2637fd574497de1"
ROLLBACK_SHA256 = "a40e7367685850c2e1f5cd8ef2682e04d15b687a00d2f0e2894f9ed0af80dc9a"
LIVE_MIGRATION_SHA256 = "4ca93ce733539133016e0c3bed55d1f5f030ec0ed338c883f98200ba1faa8d60"
BACKEND_IMAGE = (
    "ghcr.io/bielxdh3/demanage-backend@sha256:"
    "94a18c18b5aec3c58a254bd3092f1cef8fbc58eea7164f58e3ec89ace3ab55dd"
)
FRONTEND_IMAGE = (
    "ghcr.io/bielxdh3/demanage-frontend@sha256:"
    "f9436c6899b7f94ba15025593b3b1e300723b7ac7be78b416a35000c958f9025"
)

# The exact difference from the deployed 15237faa to the validated app SHA.
# The Compose delta only adds an internal DB network, without host port changes.
EXPECTED_SENSITIVE_DIFF = {
    "backend/prisma/migrations/20261105183000_trusted_login_device/migration.sql": "A",
    "backend/prisma/schema.prisma": "M",
    "docker-compose.prod.yml": "M",
}
EXPECTED_BLOBS = {
    "backend/prisma/migrations/20261105183000_trusted_login_device/migration.sql":
        "f12403515df4ea529e4043d862496c99995788eb",
    "backend/prisma/schema.prisma": "d4501834be2fdbfe5a3c63f6cdff751cb803a3a3",
    "docker-compose.prod.yml": "9c0e980f2b21f95ee159b9d4a47fca029166bac4",
}

# Private snapshot/rollback evidence 2026-11-08 22:47-22:53 UTC.
# Must be used within 48 hours of the earlier isolated rehearsal.
EVIDENCE_COMPLETED_AT = datetime(2026, 11, 8, 22, 53, 9, tzinfo=timezone.utc)
EVIDENCE_EXPIRES_AT = datetime(2026, 11, 10, 22, 47, 59, tzinfo=timezone.utc)


def verify_one_time_issue122_release(
    *, repo: Path, previous: str, target: str,
    backup_sha256: str, rehearsal_sha256: str,
    rollback_sha256: str, live_migration_sha256: str,
    backend: str, frontend: str, now: datetime | None = None,
) -> bool:
    if (previous, target) != (PREVIOUS_COMMIT, TARGET_COMMIT):
        raise RuntimeError("Only the exact Issue122 previous/target pair is eligible")
    if (
        backup_sha256, rehearsal_sha256,
        rollback_sha256, live_migration_sha256
    ) != (BACKUP_SHA256, REHEARSAL_SHA256, ROLLBACK_SHA256, LIVE_MIGRATION_SHA256):
        raise RuntimeError("Required reviewed independent production proofs are missing or changed")
    if (backend, frontend) != (BACKEND_IMAGE, FRONTEND_IMAGE):
        raise RuntimeError("Both exact immutable OCI images must match the reviewed release")
    instant = now if now is not None else datetime.now(timezone.utc)
    if not isinstance(instant, datetime) or instant.tzinfo is None:
        raise RuntimeError("Review requires a timezone-aware clock")
    instant = instant.astimezone(timezone.utc)
    if not (EVIDENCE_COMPLETED_AT <= instant <= EVIDENCE_EXPIRES_AT):
        raise RuntimeError("Issue122 evidence is expired or not yet valid")
    _git(repo, "merge-base", "--is-ancestor", previous, target)
    verify_exact_sensitive_diff(
        repo, previous, target, EXPECTED_SENSITIVE_DIFF, EXPECTED_BLOBS
    )
    return True


def main(argv: list[str] | None = None, *, now: datetime | None = None) -> int:
    p = argparse.ArgumentParser(description="Exact Issue122 one-time production eligibility gate")
    p.add_argument("--repo", type=Path, required=True)
    p.add_argument("--previous", required=True)
    p.add_argument("--target", required=True)
    p.add_argument("--backup-sha256", required=True)
    p.add_argument("--rehearsal-sha256", required=True)
    p.add_argument("--rollback-sha256", required=True)
    p.add_argument("--live-migration-sha256", required=True)
    p.add_argument("--backend", required=True)
    p.add_argument("--frontend", required=True)
    args = p.parse_args(argv)
    try:
        verify_one_time_issue122_release(
            repo=args.repo, previous=args.previous, target=args.target,
            backup_sha256=args.backup_sha256,
            rehearsal_sha256=args.rehearsal_sha256,
            rollback_sha256=args.rollback_sha256,
            live_migration_sha256=args.live_migration_sha256,
            backend=args.backend, frontend=args.frontend, now=now,
        )
    except RuntimeError as error:
        print("BLOCKED: " + str(error), file=sys.stderr)
        return 1
    print("ISSUE122_RELEASE_GATE=PASS (eligibility only; production environment approval required)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
