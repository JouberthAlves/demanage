# Local migration approval: PostgreSQL AST gate

The local release approval path accepts **only additive operations** that its
PostgreSQL grammar parser can validate structurally. The SQL is read from the
exact target Git commit, after verifying that earlier migrations were not
changed or removed. A separate migration rehearsal in a disposable PostgreSQL
instance, with backup proof, is still mandatory for schema changes.

Install the pinned parser before running `local_release_approval.py` outside
of the CI runner:

```shell
python -m pip install -r ops/cd/requirements-approval.txt
```

`.github/workflows/ci.yml` and `scripts/ci-local.ps1` install that same
version for their deployment-safety checks. If the parser is unavailable,
malformed SQL appears, or an unknown PostgreSQL AST node occurs, promotion
**stops**; it never falls back to the former keyword blacklist.

Generic approval supports `CREATE TABLE` with simple column/constraint forms,
`CREATE TYPE ... AS ENUM`, additive `ALTER TABLE ADD COLUMN/ADD CONSTRAINT`,
and ordinary/partial `CREATE INDEX`, with narrowly checked SQL expressions.
Changes such as `ALTER COLUMN TYPE`, DML, privilege commands, dynamic SQL,
unrecognized functions and complex migrations are **not automatically safe**.

Four reviewed migrations need more than this generic allowlist: the piggy
correction provenance trigger, bounded OAuth issuance-evidence backfill, C04
composite owner foreign keys, and F02 expense obligation versions. Their Git
paths and SHA-256 hashes are pinned in `demanage_cd/migration_gate.py`.
Each hash covers the **complete committed SQL blob**, including trailing
newlines and whitespace. The release reader preserves those bytes. A changed
path or byte needs another code review and explicit new pin; comments,
filenames alone, and self-reported rehearsal results grant no exception.

Any other complex migration requires a separately documented, audited release
procedure. This restricted gate is intentionally unable to approve arbitrary
SQL. The parser checks syntactic structure and an allowlist, **not** that the
complete database state is semantically unchanged; retain the disposable
PostgreSQL rehearsal and release backup requirements.

## C04/F02 migration advisory plan

Review evidence: hosted CI for commit `779c9da70f951bb6130f433568ca289c755d89e5`
([run 40028210230](https://github.com/bielxdh3/demanage/actions/runs/40028210230))
passed PostgreSQL 18 migration deployment, Prisma drift validation, 269
backend unit tests, and 90 integration tests. The integration run exercised
C04's foreign-owner FK rejection and blocked parent reparenting, plus F02
historical obligation behavior. This validates these **unchanged SQL blobs**
in disposable CI, not the future production data shape or this gate commit's
hosted status.

Before any production promotion:

1. Inspect the exact target Git migration blobs and their pins. Reject any
   changed or removed previously applied migration; require the exact target
   commit, approved image digests, local CI evidence, and owner approval.
2. Run the isolated PostgreSQL rehearsal against a verified production dump;
   compare `_prisma_migrations`, inspect failed checks, and confirm the backup
   SHA-256 before any production approval. A rehearsal failure is a stop.
3. For C04, preflight the two child-to-parent ownership joins for mismatches
   and stop for manual investigation if any exist. Its explicit transaction
   holds `SHARE ROW EXCLUSIVE` locks on child tables and creates nonconcurrent
   unique indexes; budget a maintenance window and monitor lock wait/time.
   The corrected `ON UPDATE NO ACTION` avoids reparenting child financial
   rows. The old `ON UPDATE CASCADE` SQL stays blocked as a regression fixture.
4. For F02, verify the new table, indexes, trigger and single BEGIN/COMMIT
   transaction in the rehearsal. Existing obligations are intentionally not
   backfilled from today's mutable values. The trigger blocks UPDATE, but
   DELETE (including parent cascade) is outside its scope.
5. Treat data conflicts, excessive locks, schema drift, a missing backup, or
   any mismatch in evidence as a failed rehearsal. Stop and prepare a separate
   audited migration plan; never auto-reassign account ownership or invent
   historical expense amounts.

These pins only clear the restricted SQL-shape check. They do **not** approve
production deployment, establish a safe execution time, or replace the
separate backup, rehearsal, and release gates.
