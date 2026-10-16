# deManage MCP Finance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Enable authenticated AI clients to read deManage financial data and safely execute natural-language-triggered received-income and piggy-bank actions, preserving ledger integrity and asking about ambiguous intent.

**Architecture:** Implement a version-pinned MCP v2 Streamable HTTP endpoint inside the existing Express backend. The MCP adapter passes a verified OAuth user/client identity to transaction-aware finance services; a read-only preview and signed short-lived intent gate all writes, and PostgreSQL idempotency/audit prevents duplicate postings. Keep existing web-cookie authentication distinct from MCP OAuth bearer authentication.

**Tech Stack:** Node.js >=24 (production Node 26), TypeScript 6, Express 5, Prisma 7, PostgreSQL 18, pnpm 10.17.1; \`@modelcontextprotocol/server\` v2, \`@modelcontextprotocol/node\`, \`@modelcontextprotocol/express\`, Zod 4, \`oidc-provider\` 9.12.x (OAuth issuer; compatibility proved before integration); React 19/Vite frontend.

**Spec:** [docs/superpowers/specs/2026-10-16-demanage-mcp-finance-design.md](../specs/2026-10-16-demanage-mcp-finance-design.md)

## Global Constraints

- **Local CI only:** the user has exhausted GitHub Actions minutes. Do not trigger, depend on, enable, or wait for GitHub Actions, CodeQL, GHCR workflows or hosted CI to validate any implementation stage. Run all checks in an isolated local checkout with a disposable local PostgreSQL test database; retain command outputs in the review report.
- **Git workflow:** implementation worktrees/checkouts must be INSIDE the actual project root (\`E:\deManage\.worktrees\<name>\` when that root is verified). Never create sibling worktrees. Never push to \`master\`, open a PR (which triggers \`pull_request\` jobs), merge, or deploy without a new explicit user go-ahead. \`push\` to a non-\`master\` feature branch alone does not match the inspected CI/CodeQL workflow push filters; still recheck workflow triggers before any remote push.
- Read \`AGENTS.md\`, \`plans.md\`, \`CODING_STYLE.md\`, the approved spec, and relevant \`C:\CodexGlobal\Memory\`/actual available project context before implementation. Update \`plans.md\` only when the requested feature is finished. No unrelated refactor.
- The user's required development skills are **PONYTAIL**, **UI-UX-PRO-MAX**, and **Superpowers** where installed and applicable. Ask the user whether to use native subagents or Dual Agents before implementing; if Dual Agents, record architect/executor/reviewer responsibilities. This planning document does not launch agents.
- UI/copy in pt-BR; finance values in BRL with exact centavos; honor \`America/Sao_Paulo\` financial date conventions.
- All operations authenticate from validated tokens, never from client-supplied \`userId\`; every DB lookup/write stays scoped to the token principal.
- Explicit clarification for any materially ambiguous amount, destination, date, source of funds or tag; no financial write during clarification. Client/host confirmation may still apply to otherwise unambiguous writes.
- No changing legacy automatic piggy debit or ordinary web behavior. Compound received-and-saved action must be fully atomic; an unexpectedly goal-capped piggy deposit fails the transaction rather than posting different amounts.
- Pin dependency versions in \`backend/pnpm-lock.yaml\`; do not use obsolete single-package \`@modelcontextprotocol/sdk\` v1 or frozen server-legacy for new MCP code. MCP v2 SDK packages/transport shape must be checked against installed signatures.
- Feature flag \`MCP_ENABLED=false\` by default. No deployment, OAuth exposure, actual account connection or account-plan upgrade at this planning stage.

## Review Focus

1. **Received ≠ scheduled:** one-time \`Entry\` without \`EntryReceipt\` must not count as a received gift; Task 2's integration test must assert a same-month receipt and updated cash/patrimony.
2. **Nearly full piggy:** request +R$20 with only R$8 goal remaining must clarify/fail without creating any entry/tag/deposit; Task 4 test must assert rollback and zero new rows.
3. **Tag casing and accents:** two simultaneous \`Presente\`/\`presente\` requests must reuse one tag, and Unicode normalization cannot create indistinguishable duplicate tags; Task 3's tests must check one persisted category or a deterministic conflict.
4. **Cross-account/redirect injection:** a malicious bearer identity, foreign bank/tag ID or crafted redirect URI must not access funds or exfiltrate authorization codes; Task 7/8 tests must assert denial and unchanged ledger.
5. **Timeout and replay:** two concurrent executes with the same key must create only one compound movement; a repeated key with different payload must conflict; Task 5 and Task 9 tests must check IDs and counts.

---

## Deliverable map / ownership

| Unit | Files it owns | Contract |
| --- | --- | --- |
| Entry description | \`backend/prisma/schema.prisma\`, new notes migration, \`backend/src/services/entries.ts\`, \`frontend/src/lib/entries-api.ts\`, \`frontend/src/types/finance.ts\`, \`frontend/src/lib/income-form.ts\`, \`frontend/src/components/income/income-form-dialog.tsx\` | \`Entry.notes: string | null\`, round-trip via API/UI without overwriting category |
| Received income | new \`backend/src/services/received-income.ts\` | \`createReceivedOneTimeIncomeInTransaction(tx, userId, {amountCents, dateKey, name, notes, tagId})\` returns \`{entryId, receiptId}\` |
| Tag resolver | new \`backend/src/services/finance-tags.ts\`, new unique-index migration | \`resolveIncomeTagInTransaction(tx, userId, tagName)\` returns \`{id, created}\` |
| Accounting operation | new \`backend/src/services/finance-operation.ts\` | \`runFinanceOperationInTransaction(tx, userId, action: FinanceAction)\` returns canonical committed record IDs/amounts |
| Idempotency/audit | new \`backend/src/services/finance-operation-store.ts\`, Prisma migration | \`commitFinanceOperation({userId, clientId, idempotencyKey, payloadDigest, action})\` returns prior-or-new committed result |
| Preview/intent | new \`backend/src/mcp/finance-intent.ts\`, \`backend/src/mcp/finance-preview.ts\` | \`previewFinanceOperation({userId,clientId}, draft)\`: clarification or ready signed intent |
| OAuth issuer | new \`backend/src/oauth/provider.ts\`, \`backend/src/oauth/adapter.ts\`, \`backend/src/routes/oauth.ts\`, \`frontend/src/pages/integrations-page.tsx\`, \`frontend/src/pages/oauth-consent-page.tsx\` | OAuth auth-code+PKCE S256, consent, grant storage, revocation, metadata and client validation |
| Resource auth & MCP HTTP | new \`backend/src/mcp/auth.ts\`, \`backend/src/mcp/http.ts\`; modify \`backend/src/app.ts\`, \`backend/src/utils/var.ts\` | \`POST /mcp\` only with resource-bound valid bearer, no trust in cookies |
| MCP tool catalog | new \`backend/src/mcp/tools.ts\` | overview, piggy list, tags list, preview, execute, operation status |
| Local validation | new \`scripts/ci-local.ps1\`, \`backend/src/mcp/*.test.ts\`, \`backend/src/mcp/*.itest.ts\`, existing targeted tests/docs | One reproducible local gate, staged-client proof, no Actions |

The test files named below are target locations (create if absent), not permission to change all existing finance files.

### Task 1: Add first-class entry descriptions (schema → API → minimal UI)

**Files:**
- Modify: \`backend/prisma/schema.prisma\` (\`model Entry\`)
- Create: \`backend/prisma/migrations/20261016193500_entry_notes/migration.sql\` (verify timestamp unique; use \`prisma migrate dev\` on a disposable DB)
- Modify: \`backend/src/services/entries.ts\`, \`frontend/src/lib/entries-api.ts\`, \`frontend/src/types/finance.ts\`, \`frontend/src/lib/income-form.ts\`, \`frontend/src/components/income/income-form-dialog.tsx\`
- Test: \`backend/src/services/entries.test.ts\`, \`backend/src/lib/financial-routes.integration.itest.ts\`, \`frontend/tests/income-form.test.ts\` (use an existing filename if appropriate)

**Interfaces:** \`Entry.notes: string | null\`, \`CreateEntryInput.notes: string|null\`, \`UpdateEntryInput.notes?:string|null\`, frontend \`Income.notes?:string|null\` and \`EntryPayload.notes?:string|null\`. \`name\`, \`type\`, and \`customTagId\` remain independent.

- [ ] **Step 1: Write failing tests:** create/update/read a \`notes='Presente da minha vó'\` entry alongside \`name='Presente'\` and income tag; clear notes with null; reject over-limit description. Frontend mapping/payload must preserve both fields separately.
- [ ] **Step 2: Verify RED:** \`pnpm --dir backend exec tsx --test src/services/entries.test.ts\`; \`pnpm --dir frontend test\`. Expected failure specifically for missing notes behavior.
- [ ] **Step 3: Implement:** additive nullable Prisma field and migration; validate/serialize notes with existing optional-text policy; add accessible optional Descrição field to form. Do not alter existing rows.
- [ ] **Step 4: Verify GREEN:** targeted tests, \`pnpm --dir backend typecheck\`, \`pnpm --dir frontend typecheck\`, migration \`prisma validate\` in local test environment; expect exit 0.
- [ ] **Step 5: Commit:** \`feat(demanage): add independent income descriptions\`.

### Task 2: Confirm one-time received income inside an existing DB transaction

**Files:**
- Create: \`backend/src/services/received-income.ts\`, \`backend/src/services/received-income.itest.ts\`
- Refer to: \`backend/src/services/entries.ts\` receipt rules, \`backend/src/lib/civil-date.ts\`, \`backend/src/lib/user-write-transaction.ts\`

**Interfaces:** \`createReceivedOneTimeIncomeInTransaction(tx: Prisma.TransactionClient, userId: string, input: {amountCents:number; dateKey:string; name:string; notes:string|null; tagId:string|null}): Promise<{entryId:string;receiptId:string}>\`. Always inserts \`Entry(type='outro',frequency='unica',systemOrigin='manual')\` + matching \`EntryReceipt\` with the same financial day/month.

- [ ] **Step 1: Write failing integration test:** wrapping helper in \`withUserWriteLockTransaction\`, +2000 cents creates one entry, one receipt with amount 20 and correct \`month\`; cash/patrimony reflects received income; thrown error rolls both back.
- [ ] **Step 2: Verify RED:** \`pnpm --dir backend exec tsx --test src/services/received-income.itest.ts\` with local \`DATABASE_URL\`; expected import/function missing.
- [ ] **Step 3: Implement:** helper reusing date-key validation and \`EntryReceipt\` semantics without calling higher-level HTTP methods or a nested transaction; never record unconfirmed income as received.
- [ ] **Step 4: Verify GREEN:** same integration test and \`pnpm --dir backend typecheck\`; no separate money flow if error.
- [ ] **Step 5: Commit:** \`feat(demanage): add transactional received income primitive\`.

### Task 3: Reuse/create normalized income tags without races

**Files:**
- Create: \`backend/src/services/finance-tags.ts\`, \`backend/src/services/finance-tags.itest.ts\`
- Modify: \`backend/prisma/schema.prisma\` (comment for manual index), add migration \`20261016194000_income_tag_casefold_unique/migration.sql\`
- Refer to: \`backend/src/services/custom-tags.ts\`

**Interfaces:** \`resolveIncomeTagInTransaction(tx: Prisma.TransactionClient, userId: string, tagName: string): Promise<{id:string;created:boolean}>\`. Enforce \`scope='income'\`, \`name\` max 100, color deterministic \`#34D399\`. The \`Presente\` category can be automatically created from explicit/clear intent; free-text narrative never becomes an entire tag.

- [ ] **Step 1: Write failing tests:** reuse existing \`Presente\` on request \`presente\`; concurrent requests across HTTP/MCP cannot create case-variant duplicates; foreign-user tag IDs never reused; Unicode canonical-equivalent names are handled predictably. Test migration preflight with existing duplicates fails with actionable report; no destructive auto-merge.
- [ ] **Step 2: Verify RED:** \`pnpm --dir backend exec tsx --test src/services/finance-tags.itest.ts\`.
- [ ] **Step 3: Implement:** normalized case/Unicode lookup under per-user write lock; SQL functional unique index (or generated normalized column) with explicit migration compatibility check, preserving original display names; catch/re-read unique conflict. Add comment/documentation for Prisma-unmodeled constraint.
- [ ] **Step 4: Verify GREEN:** integration tests + migrate drift gate against disposable \`SHADOW_DATABASE_URL\` (see \`docs/database-migrations.md\`); expected no duplicates.
- [ ] **Step 5: Commit:** \`feat(demanage): enforce normalized income tag identity\`.

### Task 4: Implement the atomic accounting command

**Files:**
- Create: \`backend/src/services/finance-operation.ts\`, \`backend/src/services/finance-operation.itest.ts\`
- Modify only as needed: \`backend/src/lib/piggy/transactions.ts\`
- Consume: Tasks 2–3 and existing \`depositToPiggyBankInTransaction(tx, params)\`

**Interfaces:** \`FinanceAction\` union:
- \`{kind:'receive_income';amountCents:number;dateKey:string;description:string;tagName:string}\`
- \`{kind:'deposit_existing_cash';amountCents:number;dateKey:string;bankId:string;deductFromBalance:boolean;note:string|null}\`
- \`{kind:'receive_and_save';amountCents:number;dateKey:string;description:string;tagName:string;bankId:string}\`.
\`runFinanceOperationInTransaction(tx,userId,action):Promise<FinanceActionResult>\` returns exact affected IDs and cents. \`receive_and_save\` always passes \`deductFromBalance:true\`.

- [ ] **Step 1: Write failing integration tests:** gift +R$20, cash −R$20, Porco +R$20; income-only +R$20 with no deposit; existing-cash deposit needs explicit boolean; archived/wrong-user bank rejects; if goal remaining is R$8, requested R$20 rolls back **all** changes including newly created tag and entry; confirm cash/patrimony accounting avoids double counting.
- [ ] **Step 2: Verify RED:** \`pnpm --dir backend exec tsx --test src/services/finance-operation.itest.ts\`.
- [ ] **Step 3: Implement:** one \`Prisma.TransactionClient\` for received-income, tag and piggy accounting; no nested user-write transaction. Reject \`depositAmount !== requested cents\` inside transaction; ensure interest catch-up/preconditions handled prior to accounting lock without silently mutating a partially applied request.
- [ ] **Step 4: Verify GREEN:** targeted integration and \`pnpm --dir backend test:unit\`; assert exactly one linked cofrinho expense and transaction, no extra simulated income.
- [ ] **Step 5: Commit:** \`feat(demanage): atomically receive and save funds\`.

### Task 5: Commit-once idempotency and append-only operation audit

**Files:**
- Modify: \`backend/prisma/schema.prisma\` (new \`FinanceMcpOperation\` with subject/client/key unique, canonical payload digest, result JSON, committedAt)
- Create: migration \`20261016194500_finance_mcp_operations/migration.sql\`, \`backend/src/services/finance-operation-store.ts\`, \`backend/src/services/finance-operation-store.itest.ts\`

**Interfaces:** \`commitFinanceOperation(input:{userId:string;clientId:string;idempotencyKey:string;payloadDigest:string;action:FinanceAction}):Promise<{replayed:boolean;result:FinanceActionResult}>\` locks by user and checks \`@@unique([userId,clientId,idempotencyKey])\` **in the same transaction** as Task 4's financial writes; \`getCommittedOperation(userId,clientId,key)\` exposes only authorized record status.

- [ ] **Step 1: Write failing tests:** parallel exact same calls create exactly one entry/receipt/expense/piggy transaction, return same IDs with \`replayed=true\` on retry; same key/different payload raises conflict; induced failure leaves no committed idempotency row and no money records; status lookup filters another user's data.
- [ ] **Step 2: Verify RED:** \`pnpm --dir backend exec tsx --test src/services/finance-operation-store.itest.ts\`.
- [ ] **Step 3: Implement:** atomic unique key, canonical digest, immutable committed response and minimal redacted audit data. Do not log raw chat messages/tokens. An unknown network outcome must be resolved by status/retry **with the same key**.
- [ ] **Step 4: Verify GREEN:** concurrency integration suite + \`prisma validate\` and migration drift gate.
- [ ] **Step 5: Commit:** \`feat(demanage): guarantee MCP financial write idempotency\`.

### Task 6: Add deterministic read-only preview and signed intent

**Files:**
- Create: \`backend/src/mcp/finance-preview.ts\`, \`backend/src/mcp/finance-intent.ts\`, \`backend/src/mcp/finance-preview.test.ts\`, \`backend/src/mcp/finance-preview.itest.ts\`
- Modify: \`backend/src/utils/var.ts\` (required \`MCP_INTENT_SECRET\` when enabled)

**Interfaces:** \`previewFinanceOperation(identity:{userId:string;clientId:string},draft:Partial<FinanceAction>|Record<string,unknown>):Promise<({status:'clarification_required';questions:string[]}|{status:'ready';intentToken:string;summary:string;effects:{cashDeltaCents:number;piggyDeltaCents:number}})>\`. \`verifyIntent(token,identity)\` returns canonical \`FinanceAction\`, fails expiry/tamper/subject mismatch. Only normalized typed fields enter the signature.

- [ ] **Step 1: Write failing tests:** ambiguous bare deposit asks "descontar do saldo?"; missing amount/date/bank asks; exact bank match only and disallow archived/wrong-user; unclear tag asks instead of guessing; case/diacritic near-matches do not silently pick; forged/expired/wrong-client token rejects; preview creates no financial rows.
- [ ] **Step 2: Verify RED:** \`pnpm --dir backend exec tsx --test src/mcp/finance-preview.test.ts\` and integration test with local DB.
- [ ] **Step 3: Implement:** pure draft validation, user-scoped read-only lookup, HMAC-signed intent (e.g. 5-minute TTL) tied to user/client, cents/day/target/options; revalidate all constraints at execute time. No tag/entry/interest side effect in preview.
- [ ] **Step 4: Verify GREEN:** targeted tests; check financial-row counts unchanged across preview.
- [ ] **Step 5: Commit:** \`feat(demanage): preview and bind financial intents\`.

### Task 7: OAuth authorization-code/PKCE issuer, consent and revocation

**Files:**
- Create: \`backend/src/oauth/provider.ts\`, \`backend/src/oauth/adapter.ts\`, \`backend/src/routes/oauth.ts\`, \`backend/src/oauth/oauth.itest.ts\`, \`frontend/src/pages/integrations-page.tsx\`, \`frontend/src/pages/oauth-consent-page.tsx\`
- Modify: \`backend/src/app.ts\`, \`backend/src/utils/var.ts\`, \`backend/prisma/schema.prisma\` + migration for persistent provider artifacts/grants, \`frontend/src/router.tsx\`, \`backend/package.json\`, \`backend/pnpm-lock.yaml\`.

**Interfaces:** configure \`oidc-provider@9.12.2\` issuer URL (stable HTTPS), persistent Prisma-backed adapter and existing cookie-authenticated user interaction. \`getOAuthGrantSubject(accessToken,expectedResource)\` returns \`{userId:string;clientId:string;scopes:Set<'finance:read'|'finance:write'>}\` or unauthorized. \`revokeClientGrant(userId,clientId)\` makes any issued credentials unusable; separate public client metadata and audit.

- [ ] **Step 1: Write failing tests:** Node 26/TS CJS \`oidc-provider\` import and startup smoke test (stop and revise plan if packaging is incompatible; never ship a handmade auth replacement); auth-code flow **requires PKCE S256**, exact allowed redirect URI, resource/audience, per-user consent and \`finance:read\` vs \`finance:write\` scopes; DCR/client metadata validation; reject altered redirects, state mismatch, CSRF, revoked tokens, expired tokens and another account's grants.
- [ ] **Step 2: Verify RED:** \`pnpm --dir backend exec tsx --test src/oauth/oauth.itest.ts\`; the issuer is not wired.
- [ ] **Step 3: Implement:** maintained provider and PostgreSQL persistence, consent screen showing client/scopes, revocation/settings UI; discovery metadata \`/.well-known/oauth-authorization-server\`; safe session boundary between existing browser JWT and OAuth bearer tokens. Cache/token contents must be untrusted until validated. Never ship static issuer signing keys in repo.
- [ ] **Step 4: Verify GREEN:** OAuth integration, two-user isolation, forced token/grant revocation, typecheck and local build; verify public issuer URLs survive Cloudflare-forwarded HTTPS headers. Disabled MCP flag should disable issuance routes as appropriate.
- [ ] **Step 5: Commit:** \`feat(demanage): add scoped OAuth connection for external agents\`.

### Task 8: Authenticate and mount a stateless MCP v2 HTTP resource

**Files:**
- Create: \`backend/src/mcp/auth.ts\`, \`backend/src/mcp/http.ts\`, \`backend/src/mcp/http.itest.ts\`
- Modify: \`backend/src/app.ts\`, \`backend/src/utils/var.ts\`, \`backend/package.json\`, \`backend/pnpm-lock.yaml\`, \`backend/.env.example\`
- Consume: Task 7's \`getOAuthGrantSubject\`

**Interfaces:** \`createMcpRouter({verifyBearer}): Router\` (or async initializer, if SDK needs it); only bearer authorization is accepted on \`/mcp\`, which advertises \`/.well-known/oauth-protected-resource\` metadata. Use official v2 \`@modelcontextprotocol/server\`, \`@modelcontextprotocol/node\` and \`@modelcontextprotocol/express\` on Express 5, stateless per-request transport if tested compatible.

- [ ] **Step 1: Write failing tests:** \`MCP_ENABLED=false\` returns unavailable; cookie-only request 401; read token accepted for read, rejected for writes; wrong audience, invalid/revoked token 401/403; reject unsupported HTTP methods and malicious origins/hosts, validate Streamable HTTP content negotiation, no raw token in logs.
- [ ] **Step 2: Verify RED:** \`pnpm --dir backend exec tsx --test src/mcp/http.itest.ts\`.
- [ ] **Step 3: Implement:** wire version-pinned SDK v2, bearer middleware/resource discovery; route-specific security that retains current browser CSRF behavior. Check SDK's real \`McpServer\`/transport API from installed types, not legacy snippets.
- [ ] **Step 4: Verify GREEN:** targeted HTTP integration with test bearer issuer + \`pnpm --dir backend build\`; verify correct public base URL behind a local reverse proxy.
- [ ] **Step 5: Commit:** \`feat(demanage): expose protected MCP HTTP transport\`.

### Task 9: Register five MCP tools and implement protected execution

**Files:**
- Create: \`backend/src/mcp/tools.ts\`, \`backend/src/mcp/tools.itest.ts\`
- Modify: \`backend/src/mcp/http.ts\`
- Consume: Tasks 4–8

**Interfaces:** MCP tools \`get_financial_overview\`, \`list_piggy_banks\`, \`list_income_tags\`, \`preview_financial_operation\`, \`execute_financial_operation\`, and \`get_operation_status\` (**six** names). All take the user identity from bearer context, not input. \`execute_financial_operation({intentToken,idempotencyKey})\` passes verified action/digest into Task 5.

- [ ] **Step 1: Write failing integration tests:** list exact six tools, validate JSON schemas + scopes, return real bank names/IDs and ledger snapshots for one user only; preview \`Porco\` gift creates nothing; execute with signed bound intent produces +20/-20/+20; reuse key once, same key new action 409; ambiguity cannot execute; server failures return no false "success".
- [ ] **Step 2: Verify RED:** \`pnpm --dir backend exec tsx --test src/mcp/tools.itest.ts\`.
- [ ] **Step 3: Implement:** small tool handlers; descriptions explicitly instruct conversational agents to ask instead of assuming, show intended effects, and never report committed without the backend's committed response. Keep tools in a domain-aligned catalog; no arbitrary DB access.
- [ ] **Step 4: Verify GREEN:** MCP tool integration, check exact counts, financial snapshots, revocation and idempotency under concurrent calls; no test may rely on GitHub Actions.
- [ ] **Step 5: Commit:** \`feat(demanage): add safe natural-language finance MCP tools\`.

### Task 10: Reproducible local CI, staging acceptance, and finish gate

**Files:**
- Create: \`scripts/ci-local.ps1\`
- Modify: \`plans.md\` only after the implemented features pass; \`README.md\` and \`docs/\` add test/runbook and OAuth/Cloudflare connection instructions
- Test: all existing backend/frontend suites + Task 1–9 tests; add adversarial cross-user and adversarial natural-language fixture cases to existing test harness

**Interfaces:** \`powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ci-local.ps1\` must exit non-zero on any failed gate; it never deploys, merges, publishes containers, or calls \`gh workflow run\`.

- [ ] **Step 1: Write a failing local smoke fixture:** intentionally make one unit test fail and confirm runner exits non-zero; test required environment guard refuses \`DATABASE_URL\` pointing to production and refuses missing disposable \`SHADOW_DATABASE_URL\`.
- [ ] **Step 2: Verify RED:** invoke script in local isolated worktree; expected controlled failure without touching production.
- [ ] **Step 3: Implement script:** verify Node >=24, pnpm 10.17.1, dependencies locked; setup dedicated disposable PostgreSQL 18 test DBs (never drop any unknown database); run:
  \`\`\`powershell
  pnpm --dir backend install --frozen-lockfile
  pnpm --dir frontend install --frozen-lockfile
  pnpm --dir backend exec prisma validate
  pnpm --dir backend exec prisma migrate deploy
  # drift gate as in docs/database-migrations.md, with disposable shadow DB
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm test:integration
  pnpm build
  python -m unittest discover -s ops/cd/tests -v
  \`\`\`
  Validate local Docker build/compose syntax if available (do not publish GHCR); include dependency audit and schema drift checks from \`.github/workflows/ci.yml\` when reproducible locally. Run expected full suite once with clean database; retain redacted command output/exit codes.
- [ ] **Step 4: Verify GREEN:** run full \`scripts/ci-local.ps1\` against two isolated test users, one test with simulated crash after first accounting step (rollback), duplicate calls, OAuth revoke, a real MCP client discovery/preview/execute round trip, browser income note round trip; expected all gates exit 0. Note **separately** if the user's current ChatGPT plan cannot execute custom MCP writes: not a deManage test failure and do not claim that ChatGPT currently controls funds.
- [ ] **Step 5: Commit:** \`test(demanage): validate secure MCP finance locally\`, finalize \`plans.md\` checkbox, include manual acceptance and deployment blockers in review report. Seek explicit approval before merge or deploy; do not run GitHub Actions.

## Scope and handoff

- Implementation stages are independently reviewable, but **none is live externally** until local tests and OAuth hardening pass together.
- Dedicated financial primitives and MCP transport are separated so downstream client/provider support can evolve without rewriting accounting.
- A plan review/approval is required before implementation. **Suggested approach: Subagent-driven**, because the 10 tasks include high-impact financial ledger and authorization boundaries; each task should receive an independent review before the next one.
- Before implementation, ask the user whether to use **native subagents** or their **Dual Agents** setup (if Dual Agents, architect=plan/compliance, executor=implementation, independent reviewer=finance/auth/integration). No Github Actions minutes can be consumed by any path.
