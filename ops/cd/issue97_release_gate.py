"""Exact one-time issue #97 approval witness for the already migrated salary schema.

Does not touch a database, approve an environment or publish a production pointer.
The existing protected workflow and Debian image-only deploy agent retain control.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

from issue87_release_gate import _git, verify_exact_sensitive_diff


PREVIOUS_COMMIT = '4d9beefa6faefce070b2bc0b8cba2821c3a91945'
TARGET_COMMIT = 'dbaac461d74753ddbe22bb6889b2baa2e9717a61'
BACKUP_SHA256 = 'a22547a007014b5e6dba81ce784f0f373daf5d4d1e24a8532979e284d2609d98'
REHEARSAL_SHA256 = '7b9bf43d1c5a275c1e4ac35cda7103d07310a58af64f4499cc9d121b9f29d915'
LIVE_MIGRATION_SHA256 = 'dbaac8394df20b9f5eb38cf8b3ba0a8c1ad5a3a03ab11744396a697d9a580846'
BACKEND_IMAGE = (
    'ghcr.io/bielxdh3/demanage-backend@sha256:'
    '52765713db9a6af95c4278a38bdc7660f4f8d157b49b9fbc3b6d490bee5e99ff'
)
FRONTEND_IMAGE = (
    'ghcr.io/bielxdh3/demanage-frontend@sha256:'
    '248782c6c3ac80587f307e0160e37a8fe3e28083a4526b08d321442bbc0faecd'
)

# The private production dump was completed at 2026-11-03T03:33:00Z;
# isolated PostgreSQL 18 rehearsal completed at 03:41:18.393566Z and the
# separately verified LIVE migration completed at 03:47:55.354139Z.
# Evidence expires 48h after the initial dump (the oldest proof).
LIVE_COMPLETED_AT = datetime(2026, 11, 3, 3, 47, 55, 354139, tzinfo=timezone.utc)
EVIDENCE_EXPIRES_AT = datetime(2026, 11, 5, 3, 33, 0, tzinfo=timezone.utc)

# Only these four paths changed between the exact live and target SHAs.
# Keep the generic schema/Compose promotion block untouched.
EXPECTED_SENSITIVE_DIFF = {
    'backend/entrypoint.sh': 'M',
    'backend/prisma/migrations/20261102211000_salary_period_history/migration.sql': 'A',
    'backend/prisma/schema.prisma': 'M',
    'docker-compose.prod.yml': 'M',
}
EXPECTED_BLOBS = {
    'backend/entrypoint.sh': '893daa54100b08d6e61ada4c12b0a623293805e4',
    'backend/prisma/migrations/20261102211000_salary_period_history/migration.sql':
        'a01534825752a89da8647d34ebd8c4e71c43b623',
    'backend/prisma/schema.prisma': '217fba909fb8d7b74c53fdd477a3230878865e80',
    'docker-compose.prod.yml': '708dee0252eaa8253c4e8d45bf4c8b1f35bbc639',
}


def verify_one_time_issue97_release(
    *, repo: Path, previous: str, target: str,
    dump_sha256: str, rehearsal_sha256: str, live_migration_sha256: str,
    backend: str, frontend: str, now: datetime | None = None,
) -> bool:
    """Verify fixed release proofs; eligibility is *not* production approval."""
    if (previous, target) != (PREVIOUS_COMMIT, TARGET_COMMIT):
        raise RuntimeError('Only the exact Issue97 previous/target commit pair is eligible')
    if dump_sha256 != BACKUP_SHA256:
        raise RuntimeError('The reviewed production dump SHA-256 is missing or different')
    if rehearsal_sha256 != REHEARSAL_SHA256:
        raise RuntimeError('The reviewed restored PostgreSQL 18 rehearsal proof is missing or different')
    if live_migration_sha256 != LIVE_MIGRATION_SHA256:
        raise RuntimeError('The independent, completed live salary migration proof is missing or different')
    if (backend, frontend) != (BACKEND_IMAGE, FRONTEND_IMAGE):
        raise RuntimeError('Both exact immutable OCI images must match the reviewed release')
    instant = now if now is not None else datetime.now(timezone.utc)
    if not isinstance(instant, datetime) or instant.tzinfo is None:
        raise RuntimeError('Review requires a timezone-aware UTC clock')
    instant = instant.astimezone(timezone.utc)
    if not (LIVE_COMPLETED_AT <= instant <= EVIDENCE_EXPIRES_AT):
        raise RuntimeError('The time-bounded Issue97 migration evidence is not currently valid')
    _git(repo, 'merge-base', '--is-ancestor', previous, target)
    verify_exact_sensitive_diff(repo, previous, target, EXPECTED_SENSITIVE_DIFF, EXPECTED_BLOBS)
    return True


def main(argv: list[str] | None = None, *, now: datetime | None = None) -> int:
    parser = argparse.ArgumentParser(description='Issue97 exact one-time production release proof')
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--previous', required=True)
    parser.add_argument('--target', required=True)
    parser.add_argument('--dump-sha256', required=True)
    parser.add_argument('--rehearsal-sha256', required=True)
    parser.add_argument('--live-migration-sha256', required=True)
    parser.add_argument('--backend', required=True)
    parser.add_argument('--frontend', required=True)
    args = parser.parse_args(argv)
    try:
        verify_one_time_issue97_release(
            repo=args.repo, previous=args.previous, target=args.target,
            dump_sha256=args.dump_sha256, rehearsal_sha256=args.rehearsal_sha256,
            live_migration_sha256=args.live_migration_sha256,
            backend=args.backend, frontend=args.frontend, now=now,
        )
    except RuntimeError as error:
        print('BLOCKED: ' + str(error), file=sys.stderr)
        return 1
    print('ISSUE97_RELEASE_GATE=PASS (eligibility only; protected production approval is still required)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
