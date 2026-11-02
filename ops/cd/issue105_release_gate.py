"""Single-release authorization proof for the independently migrated Issue 105 schema.

Does not connect to production, run SQL, publish a pointer, or approve the
protected GitHub environment. The three SHA-256 witnesses were produced on
the Debian host after a real PostgreSQL dump, isolated restore+migration and
separate verified live migration, before the app image is changed.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from issue87_release_gate import _git, verify_exact_sensitive_diff


PREVIOUS_COMMIT = "4bda79dfeb959ebb813e22f602a15599fe6b00fb"
TARGET_COMMIT = "faa174f8c53cca9226cc709893df9e7bcae5131e"
BACKUP_SHA256 = "4f7da3b0904e60b08325988bcb5d2a35b2992ffa62c7b3e717ddd109a86e4126"
REHEARSAL_SHA256 = "3eb7cde251046cb54cae0b1eace5b7d34e841f4983974cf5cb3023f855c34bfa"
LIVE_MIGRATION_SHA256 = "0e15e76f78b84e170f3578ce43a0a0eff8b9f08c89fcaa2fd9b5a1f63bcfc488"
BACKEND_IMAGE = (
    "ghcr.io/bielxdh3/demanage-backend@sha256:"
    "fd61a84d080184773879112ce3edd67098c6d775e73ccf8bcc5e557703373bd6"
)
FRONTEND_IMAGE = (
    "ghcr.io/bielxdh3/demanage-frontend@sha256:"
    "33b44921c0a6d7e042c35df214c2401b002ce56c94ece5cc03ac374c6816ea8f"
)
REHEARSAL_COMPLETED_AT = datetime(2026, 11, 2, 19, 48, 15, tzinfo=timezone.utc)
LIVE_MIGRATION_COMPLETED_AT = datetime(2026, 11, 2, 19, 51, 28, tzinfo=timezone.utc)
EXPIRES_AT = REHEARSAL_COMPLETED_AT + timedelta(hours=48)

EXPECTED_SENSITIVE_DIFF = {
    "backend/prisma/migrations/20261102192000_expense_voided_at/migration.sql": "A",
    "backend/prisma/schema.prisma": "M",
}
EXPECTED_BLOBS = {
    "backend/prisma/migrations/20261102192000_expense_voided_at/migration.sql":
        "3ee3b40350aec18db6a14a657228c0745550c3e7",
    "backend/prisma/schema.prisma": "0ccf78da87fb9e13a26f56993e889b62e313b0e3",
}


def verify_one_time_issue105_release(
    *, repo: Path, previous: str, target: str,
    dump_sha256: str, rehearsal_sha256: str, live_migration_sha256: str,
    backend: str, frontend: str, now: datetime | None = None,
) -> bool:
    if (previous, target) != (PREVIOUS_COMMIT, TARGET_COMMIT):
        raise RuntimeError("Only the exact Issue105 previous/target commit pair is eligible")
    if dump_sha256 != BACKUP_SHA256:
        raise RuntimeError("The reviewed production dump SHA-256 is missing or different")
    if rehearsal_sha256 != REHEARSAL_SHA256:
        raise RuntimeError("The reviewed isolated rehearsal SHA-256 is missing or different")
    if live_migration_sha256 != LIVE_MIGRATION_SHA256:
        raise RuntimeError("The independently verified live migration SHA-256 is missing or different")
    if (backend, frontend) != (BACKEND_IMAGE, FRONTEND_IMAGE):
        raise RuntimeError("Both immutable OCI image digests must match the reviewed release")
    instant = now if now is not None else datetime.now(timezone.utc)
    if not isinstance(instant, datetime) or instant.tzinfo is None:
        raise RuntimeError("Approval requires a timezone-aware UTC timestamp")
    instant = instant.astimezone(timezone.utc)
    if not (LIVE_MIGRATION_COMPLETED_AT <= instant <= EXPIRES_AT):
        raise RuntimeError("The reviewed backup/rehearsal/live-migration approval window expired or is not yet valid")
    _git(repo, "merge-base", "--is-ancestor", previous, target)
    verify_exact_sensitive_diff(
        repo, previous, target, EXPECTED_SENSITIVE_DIFF, EXPECTED_BLOBS,
    )
    return True


def main(argv: list[str] | None = None, *, now: datetime | None = None) -> int:
    parser = argparse.ArgumentParser(description="Strict one-time Issue105 schema release witness")
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--previous", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--dump-sha256", required=True)
    parser.add_argument("--rehearsal-sha256", required=True)
    parser.add_argument("--live-migration-sha256", required=True)
    parser.add_argument("--backend", required=True)
    parser.add_argument("--frontend", required=True)
    args = parser.parse_args(argv)
    try:
        verify_one_time_issue105_release(
            repo=args.repo, previous=args.previous, target=args.target,
            dump_sha256=args.dump_sha256,
            rehearsal_sha256=args.rehearsal_sha256,
            live_migration_sha256=args.live_migration_sha256,
            backend=args.backend, frontend=args.frontend, now=now,
        )
    except RuntimeError as exc:
        print("BLOCKED: " + str(exc), file=sys.stderr)
        return 1
    print("ISSUE105_RELEASE_GATE=PASS (eligibility only; protected approval required)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
