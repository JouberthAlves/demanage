# deManage issue #87: one-time production release authorization

## Intent

Allow the already merged, hosted-CI-verified `62e98ccea16dd0d3164ab1689c11fe770b983393` to be promoted from the actual deployed `ec2a3d40a6c8218ab0550258305e1745ee3b1fbc`, while preserving financial records and the GitHub `production` required-reviewer gate. No new application features, direct edits to the `production` branch, or privileged production SQL shortcuts.

## Approaches

1. Direct Docker/SQL/manual manifest update: rejected; it would bypass the existing signed GitHub approval and Debian deploy journal.
2. Widen the general Prisma/Compose allowlist: rejected; future unreviewed schema changes would become promotable.
3. **Chosen:** narrowly scoped one-time GH Actions exception, locked to the two exact commits, the six changed sensitive paths and their committed bytes, both immutable GHCR digests, a verified production-dump checksum, and the independent isolated rehearsal proof. Keep the production environment reviewer, v2 pointer witness, Debian backup and rollback unchanged.

## Review evidence

- Current production: `ec2a3d40a6c8218ab0550258305e1745ee3b1fbc` (Debian state and `production.json` agree).
- Intended app source: `62e98ccea16dd0d3164ab1689c11fe770b983393` (merged PR #88, CI + CodeQL push checks passed).
- Backend: `ghcr.io/bielxdh3/demanage-backend@sha256:5d39a9d37c5b476641c42eebb487d2ea2183eb1f1f83b6c1b140a0ed8e9d6837`.
- Frontend: `ghcr.io/bielxdh3/demanage-frontend@sha256:e44c023e7fbcefa55e1e8a9421e10777691121bb2534d7297333d1c45684294a`.
- Immutable reviewed migration SQL blobs: the four `REVIEWED_SQL` hashes in `ops/cd/demanage_cd/migration_gate.py`.
- Isolated PostgreSQL 18 rehearsal: 31 applied migrations before, 35 after; source and previous commit and backend digest bound in the proof. Proof SHA256 `b0e07420cb4102daeafffb7efa53f528e5c55ca410dd4d5da13be065dd153495`.
- Production snapshot dump SHA256 `be5d1dd8432507f8f23fca55fe3ae4261cf1a2a58efbf18a7a179e2e792fc84c` at `/opt/demanage/backups/cd-20261024T123238Z-62e98ccea16d/demanage.dump` (rehashed on the Debian host).
- Sensitive diff: four new SQL migration files, `backend/prisma/schema.prisma`, `docker-compose.prod.yml`. The Compose delta only introduces conservative `TRUST_CF_INGRESS_VERIFIED=0` and empty `TRUSTED_TUNNEL_PROXY_IP` defaults; production's existing Compose topology must not be replaced.

## Safety contract

- A release beyond either exact commit, changed earlier migrations, a seventh sensitive file, changed SQL/schema/Compose bytes, absent or wrong proof hash, wrong images, or expired rehearsal must fail closed.
- Require the owner to explicitly enter both checksums in workflow dispatch and approve the existing protected `production` environment. This PR's merge is **not** production approval.
- Before any live app change, the Debian pull-agent checks health and DB/Compose identity, takes another fresh custom PostgreSQL backup, then journals and updates only backend/frontend by immutable digest. The backend entrypoint will apply four migrations; SQL data effects and table locks require a maintenance window.
- Restore *application images* automatically on unhealthy release, never silently roll back SQL. In a schema incident, stop writes and use the saved dump only via a separate operator-approved recovery procedure; the old application may not be schema-compatible.
- Afterwards confirm 35 migrations, 0 failed migrations, financial row-count/integrity invariants, container image labels and IDs, `/api/health`, `/api/ready`, unauthenticated auth rejection, and the public UI; do not assert logged-in end-to-end functionality without credentials.

## Non-goals and remaining decisions

No unreviewed schema migration, rollback automation for PostgreSQL, Cloudflare topology change, user-data migration, or cleanup of other worktrees. Manual merge of the gate PR and required environment approval stay with the owner. A new proof is required if the window expires or live preflight no longer matches; never re-use stale checksums or silently weaken the gate.
