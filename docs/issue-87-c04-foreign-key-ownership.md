# Issue #87 — C04: ownership in database foreign keys

Scope: Prisma schema and migrations, with targeted service inspection on the
2026-10-23 consolidated audit branch. This is a **defense-in-depth** database
integrity finding, **not a demonstrated cross-account IDOR**. Service endpoints
frequently filter by authenticated `userId`, but code filters alone do not
constrain all future writes, migrations, scripts or direct database clients.

## What this milestone protects

| Child | Referenced parent | Ownership check | Delete behavior |
| --- | --- | --- | --- |
| `PiggyTransaction(userId, piggyBankId)` | `PiggyBank(id, userId)` | Composite FK, same owner required | CASCADE, unchanged |
| `FinanceMcpUndo(userId, operationId)` | `FinanceMcpOperation(id, userId)` | Composite FK, same owner required | CASCADE, unchanged |

The migration creates composite unique indexes (the global `id` primary keys
are still intact), checks existing rows, adds/validates the new FKs and then
drops the superseded single-ID FKs. The whole migration is transactional;
on any mismatch it aborts without rewriting or deleting historical records.
Large installations should schedule the migration to accommodate the DDL
locks. Do not claim existing data was inspected until a disposable or
authorized staging database has actually run the preflight.

To inspect blockers **read-only**, use:

```sql
SELECT t."id", t."userId" AS child_owner, b."userId" AS bank_owner
FROM "PiggyTransaction" t
JOIN "PiggyBank" b ON b."id" = t."piggyBankId"
WHERE t."userId" <> b."userId";

SELECT u."id", u."userId" AS undo_owner, o."userId" AS operation_owner
FROM "FinanceMcpUndo" u
JOIN "FinanceMcpOperation" o ON o."id" = u."operationId"
WHERE u."userId" <> o."userId";
```

## Remaining gaps requiring separate design/migrations

| References | Gap | Safer migration route |
| --- | --- | --- |
| `Expense.cardId`, `Expense.customTagId`, `Entry.customTagId` | Child and parent both contain owner IDs; FK checks referenced ID only | Add parent `UNIQUE(id, userId)`; preflight mismatch; composite FK with PostgreSQL `ON DELETE SET NULL (cardId/customTagId)` so the non-null owner survives. Prisma's default composite `SetNull` would try to null `userId`; verify tooling/drift compatibility or use equivalent validated DB-side enforcement |
| `PiggyTransaction.expenseId/entryId`, `AssetTransaction.expenseId/entryId` | Nullable cash links can point to another owner's financial row at DB level | Similar composite FK with targeted nullification of only `expenseId`/`entryId`. Preserve the existing internal-transfer lifecycle and `@unique` links; preflight mismatches before enforcing |
| `ExpenseSplit.expenseId/cardId` | Split has no `userId`; expense and selected card could belong to different accounts | Add/backfill an immutable `userId` derived from the expense, verify all card owners match, create compound parent keys/FKs and account for pix `cardId=NULL`. Requires careful backfill and API/schema changes, or an audited DB constraint trigger |

`ExpensePayment` and `EntryReceipt` have no independent owner column:
their ownership derives from their single parent FK, so a composite
same-owner constraint is not meaningful without schema changes. OIDC
`OAuthArtifact.grantId` is a protocol identifier rather than a declared
cross-user relational FK; treat it separately.

Next review: check actual preflight results on disposable/staging PostgreSQL,
exercise delete cascades and migrations, and address nullable `SET NULL`
relations in a dedicated milestone. No production DB, deploy or merge is
authorized by this audit.

### Owner rotation safety

The original unshipped migration declared `ON UPDATE CASCADE` on the new
compound foreign keys. A database writer could then change `PiggyBank.userId`
or `FinanceMcpOperation.userId` and automatically move historical child rows to
the new account. The revised SQL and Prisma schema use **ON UPDATE NO ACTION**.
Adversarial PostgreSQL tests attempt both reparentings with existing financial
children and must fail without rewriting either child owner. Ordinary deletes
still cascade as specified. The old unsafe SQL remains a blocked fixture.

The restrictive production migration gate remains closed until the new SQL bytes
receive explicit review and a disposable PostgreSQL migration rehearsal.
