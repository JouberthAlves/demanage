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

Two reviewed migrations need more than this generic allowlist: the immutable
piggy correction provenance trigger and the bounded OAuth issuance-evidence
backfill. Their Git paths and SHA-256 hashes are pinned in
`demanage_cd/migration_gate.py`. This is a code-reviewed exception for those
**exact SQL bytes** (ignoring outer whitespace). If the SQL changes, it must
be reviewed again and the pin explicitly updated in code. This bypass is not
based on comments, filenames alone or a self-reported rehearsal result.

Any other complex migration requires a separately documented, audited release
procedure. This restricted gate is intentionally unable to approve arbitrary
SQL. The parser checks syntactic structure and an allowlist, **not** that the
complete database state is semantically unchanged; retain the disposable
PostgreSQL rehearsal and release backup requirements.
