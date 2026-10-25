"""One-time, fail-closed issue #87 migration approval policy.

This script does not approve GitHub's protected ``production`` environment,
publish a manifest, execute SQL or contact the database. Only the manually
reviewed environment-gated workflow may consume its successful result.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


PREVIOUS_COMMIT = "ec2a3d40a6c8218ab0550258305e1745ee3b1fbc"
TARGET_COMMIT = "62e98ccea16dd0d3164ab1689c11fe770b983393"
BACKUP_SHA256 = "be5d1dd8432507f8f23fca55fe3ae4261cf1a2a58efbf18a7a179e2e792fc84c"
REHEARSAL_SHA256 = "b0e07420cb4102daeafffb7efa53f528e5c55ca410dd4d5da13be065dd153495"
BACKEND_IMAGE = (
    "ghcr.io/bielxdh3/demanage-backend@sha256:"
    "5d39a9d37c5b476641c42eebb487d2ea2183eb1f1f83b6c1b140a0ed8e9d6837"
)
FRONTEND_IMAGE = (
    "ghcr.io/bielxdh3/demanage-frontend@sha256:"
    "e44c023e7fbcefa55e1e8a9421e10777691121bb2534d7297333d1c45684294a"
)
REHEARSAL_COMPLETED_AT = datetime(2026, 10, 24, 12, 32, 45, 639910, tzinfo=timezone.utc)
REHEARSAL_EXPIRES_AT = REHEARSAL_COMPLETED_AT + timedelta(hours=48)
SENSITIVE_PATHS = (
    "backend/prisma", "backend/prisma.config.ts", "backend/entrypoint.sh",
    "docker-compose.prod.yml",
)

# Exact Git blobs of the already merged target.  SQL SHA-256 is independently
# pinned and reviewed in demanage_cd/migration_gate.py; Git identity is a second
# lock on the schema, migration files and conservative Compose-only change.
EXPECTED_SENSITIVE_DIFF = {
    "backend/prisma/migrations/20261023210000_piggy_correction_origin/migration.sql": "A",
    "backend/prisma/migrations/20261023210100_oauth_token_connection_status/migration.sql": "A",
    "backend/prisma/migrations/20261023211000_c04_owner_composite_fks/migration.sql": "A",
    "backend/prisma/migrations/20261023213000_expense_obligation_versions/migration.sql": "A",
    "backend/prisma/schema.prisma": "M",
    "docker-compose.prod.yml": "M",
}
EXPECTED_BLOBS = {
    "backend/prisma/migrations/20261023210000_piggy_correction_origin/migration.sql": "08a11f31bad8fa3de0d1c97a8b762490ee2e8c4c",
    "backend/prisma/migrations/20261023210100_oauth_token_connection_status/migration.sql": "048dfe79e7879391796e7eb47b64c87006059d3c",
    "backend/prisma/migrations/20261023211000_c04_owner_composite_fks/migration.sql": "4b5b9375fe62011454af19be0c5d4d50841e3ae2",
    "backend/prisma/migrations/20261023213000_expense_obligation_versions/migration.sql": "5d64ef47487a41d60f5c8458d9131895e5b5dc05",
    "backend/prisma/schema.prisma": "9d4328b893527e75f65bf495244312b7cc01d7b9",
    "docker-compose.prod.yml": "7ab5d06e0ef7a3556b32a3c9aa513e34ebf77b67",
}


def _git(repo: Path, *args: str) -> bytes:
    try:
        return subprocess.run(
            ["git", "-C", str(repo), *args],
            check=True, capture_output=True, timeout=30,
        ).stdout
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError("Git identity verification failed") from exc


def verify_exact_sensitive_diff(
    repo: Path,
    previous: str,
    target: str,
    expected_diff: dict[str, str],
    expected_blobs: dict[str, str],
) -> None:
    """Prove the only sensitive differences are precisely reviewed Git blobs."""
    if set(expected_diff) != set(expected_blobs):
        raise RuntimeError("sensitive Git diff review manifest incomplete")
    raw = _git(
        repo, "diff", "--name-status", "--no-renames", "--no-ext-diff",
        "--no-textconv", "-z", previous, target, "--", *SENSITIVE_PATHS,
    )
    tokens = raw.split(b"\0")
    if not tokens or tokens[-1] != b"" or (len(tokens) - 1) % 2:
        raise RuntimeError("sensitive Git diff malformed")
    actual: dict[str, str] = {}
    for idx in range(0, len(tokens) - 1, 2):
        try:
            status = tokens[idx].decode("ascii", errors="strict")
            path = tokens[idx + 1].decode("utf-8", errors="strict")
        except UnicodeError as exc:
            raise RuntimeError("sensitive Git diff noncanonical") from exc
        if status not in ("A", "M") or path in actual:
            raise RuntimeError("sensitive Git diff unexpected status or duplicate")
        actual[path] = status
    if actual != expected_diff:
        raise RuntimeError("sensitive Git diff differs from exact reviewed release")
    for path, expected_blob in expected_blobs.items():
        actual_blob = _git(repo, "rev-parse", "--verify", f"{target}:{path}").decode("ascii").strip()
        if actual_blob != expected_blob:
            raise RuntimeError("sensitive Git diff blob does not match reviewed bytes")


def verify_one_time_issue87_release(
    *, repo: Path, previous: str, target: str,
    dump_sha256: str, rehearsal_sha256: str,
    backend: str, frontend: str, now: datetime | None = None,
) -> bool:
    """Release witness input validation; *not* an environment approval."""
    if (previous, target) != (PREVIOUS_COMMIT, TARGET_COMMIT):
        raise RuntimeError("Only the exact reviewed previous/target commit pair is eligible")
    if dump_sha256 != BACKUP_SHA256:
        raise RuntimeError("The reviewed production dump SHA-256 is missing or different")
    if rehearsal_sha256 != REHEARSAL_SHA256:
        raise RuntimeError("The reviewed isolated rehearsal SHA-256 is missing or different")
    if (backend, frontend) != (BACKEND_IMAGE, FRONTEND_IMAGE):
        raise RuntimeError("Both immutable OCI image digests must match the reviewed release")
    instant = now if now is not None else datetime.now(timezone.utc)
    if not isinstance(instant, datetime) or instant.tzinfo is None:
        raise RuntimeError("rehearsal window requires an aware UTC clock")
    instant = instant.astimezone(timezone.utc)
    if not (REHEARSAL_COMPLETED_AT <= instant <= REHEARSAL_EXPIRES_AT):
        raise RuntimeError("The rehearsal approval window expired or is not yet valid")
    _git(repo, "merge-base", "--is-ancestor", previous, target)
    verify_exact_sensitive_diff(repo, previous, target, EXPECTED_SENSITIVE_DIFF, EXPECTED_BLOBS)
    return True


def main(argv: list[str] | None = None, *, now: datetime | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate one reviewed release before protected GitHub approval")
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--previous", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--dump-sha256", required=True)
    parser.add_argument("--rehearsal-sha256", required=True)
    parser.add_argument("--backend", required=True)
    parser.add_argument("--frontend", required=True)
    args = parser.parse_args(argv)
    try:
        verify_one_time_issue87_release(
            repo=args.repo, previous=args.previous, target=args.target,
            dump_sha256=args.dump_sha256, rehearsal_sha256=args.rehearsal_sha256,
            backend=args.backend, frontend=args.frontend, now=now,
        )
    except RuntimeError as exc:
        print("BLOCKED: " + str(exc), file=sys.stderr)
        return 1
    print("ISSUE87_RELEASE_GATE=PASS (eligibility only; production approval still required)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
