# Design — deManage MCP Finance (v1)

**Date:** 2026-10-16
**Stage:** proposal for user review; NOT an implementation plan
**Target:** existing deManage monorepo (Express 5, Prisma 7, PostgreSQL, React)

## 1. Purpose and success criteria

Let a person control their own deManage financial records **from an external AI conversation** (primarily ChatGPT), using natural Brazilian Portuguese. This is **not** a chatbot embedded in the deManage website and does not require the deManage operator to purchase OpenAI model tokens for each conversation.

Example A: "Ganhei R$ 20 da minha vó; coloca na caixinha Porco" must, when the references are unambiguous, produce **one atomic financial operation**:
- An actual received one-time income entry of **+R$ 20.00** with income tag **Presente** (create/reuse), description **Presente da minha vó**;
- A cash deduction of **-R$ 20.00** through the existing piggy-bank deposit machinery;
- A deposit of **+R$ 20.00** in the precise bank **Porco**.
- Net effect: cash unchanged; bank +20; external wealth +20, without double-counting internal transfers.

Example B: "Adiciona R$ 20 no meu saldo, foi presente da minha vó" must create a received one-time income **+R$ 20.00**, reuse or create income tag **Presente**, preserve description **Presente da minha vó**, and **not** touch piggy banks.

If someone says only "Adiciona R$ 20 na caixinha Porco", the assistant **must ask** whether the amount is coming from existing cash (deduct) or money already accounted for elsewhere (do not deduct). The service must not silently choose. Ambiguous amounts, dates, labels, duplicates and target bank names also trigger clarification.

Success is measured by financial ledger correctness, not merely a successful MCP HTTP response.

## 2. Availability constraint and choices

**As verified on 2026-10-16:** OpenAI documents full custom MCP write/modify support in ChatGPT for Business and Enterprise/Edu, not ChatGPT Plus or Pro. A deManage MCP can be built/tested independently and used with a compatible client, but direct financial writes *in the user's current ChatGPT Plus chat* **must not be promised**. Recheck the current plan entitlements and do a real end-to-end write test before describing ChatGPT integration as live.

Approaches considered:
1. **Recommended:** add an MCP Streamable HTTP adapter to the existing Express backend. Pros: reuse business services, deployment, and transaction boundaries; few moving parts. Cons: must carefully isolate OAuth identity and CSRF/auth middleware.
2. Separate MCP gateway service calls internal deManage HTTP API. Pros: deployment isolation. Cons: extra service, auth/service-account surface, and difficult compound transaction atomicity.
3. Build an AI chat inside deManage backed by model APIs. Pros: user interface is immediately controllable. Cons: fails the explicit requirement to operate *from ChatGPT itself* and introduces inference API costs.

Choose (1) with an **isolated MCP module** and **no bypass of the existing accounting layer**.

## 3. Existing code and changes required

Already present:
- `backend/src/routes/piggy-banks.ts` with list, deposit, withdraw and transactions.
- `backend/src/services/piggy-banks.ts` with `parseMoneyMovement`, `deductFromBalance`, and `withFreshInterest`.
- `backend/src/lib/piggy/transactions.ts`: transaction-aware `depositToPiggyBankInTransaction(tx,...)`; automatic deposits deduct; manual deposits can opt out. Deposits can be **capped to remaining goal**, so a compound receipt/deposit must reject or explicitly reconfirm if the actual deposit would be less than the requested amount.
- `backend/src/services/entries.ts`: creates one-time income, with income custom tags and `type='outro'`; `setReceiptState` creates `EntryReceipt` for a confirmed receipt.
- `backend/src/services/custom-tags.ts`: tag scope `income|expense`, case-insensitive lookup prior to create.
- `backend/src/lib/user-write-transaction.ts`: a per-user PostgreSQL row lock inside Prisma interactive transactions.

Gaps:
- No MCP transport / OAuth token verification / grants.
- `Entry` has `name` and `customTagId`, but no separate optional `notes` field. Add nullable `Entry.notes` with migration, API serialization/validation, and minimal UI support so **description** remains distinct from **tag** and display title. Preserve existing records.
- Existing `createEntry` and deposit service own separate transaction boundaries. Extract reusable **transaction-aware domain primitives**; do **not** call separate HTTP endpoints, nest two user-write transactions, or rely on compensating deletes for an atomic multi-step action.
- One-time income must be **confirmed received** with an `EntryReceipt` in the same transaction; merely creating an entry may not affect current cash/patrimony as intended.
- Add database-backed operation idempotency/audit metadata; protect against repeated tool calls and uncertain network acknowledgements.
- Existing `CustomTag` name uniqueness is case-sensitive at database level; protect against concurrent case-variant duplicates using a database constraint or equivalently robust transactional rule.

## 4. MCP contract v1

**Transport:** Streamable HTTP, version-pinned MCP SDK, e.g. `POST /mcp` (mount before or with correctly configured route-specific middlewares). The server exposes tools, not a new model.

Read tools:
- `get_financial_overview` — current available cash, received income, expenses and piggy totals using existing accounting services.
- `list_piggy_banks` — each accessible bank's ID, canonical name, state, remaining goal, current balance; never accept user ID from the AI.
- `list_income_tags` — existing income tag IDs and names.
- `get_operation_status` — resolve an idempotency key to committed/pending/failed result for that authenticated principal.

Operation tools:
- `preview_financial_operation` — takes a typed draft (`receive_income`, `deposit_existing_cash`, `receive_and_save`) with amount in integer centavos (or canonical BRL decimal string), target bank ID or resolvable name, description, income tag name and explicit source/deduction semantics. Returns a human-readable effect summary, a **missing/ambiguous fields** list, and an opaque short-lived intent token *only when resolvable*. Must not change the financial ledger.
- `execute_financial_operation` — takes that intent token plus a client-generated idempotency key. Revalidates ownership, amounts, bank state, goal cap, token subject, replay status and expiry; executes the full operation once. Returns entry/receipt/tag/deposit/expense IDs, exact credited/debited amounts, before/after balance when available, and an explicit committed status.

Tool descriptions **must instruct** the model not to fill missing financial intent by guesswork. If `preview` returns `clarification_required`, the assistant asks **one specific question**, does not call `execute`, and previews again after the answer. Natural-language interpretation stays with the AI client; server validation catches omitted/inconsistent structured fields, not every possible semantic misinterpretation. Important or destructive operations may additionally require user confirmation by the host or deManage's own flow.

Scope **not included in v1**: deleting entries or piggy banks; changing recurring salary or auto debit; arbitrary SQL; unrestricted bulk operations; asset trading; a chat UI inside deManage.

## 5. Deterministic business policy

1. Monetary value must be positive, bounded, currency BRL, computed with exact decimal/centavos arithmetic; never binary-float ledger deltas. A compound receive/save amount must match the *actual* deposited amount, not a silently capped amount.
2. Bank selection: case-insensitive exact match after normalization; if zero matches, say bank not found; if multiple or fuzzy guesses, ask to choose. Archived banks cannot receive money.
3. Tag is a categorical `CustomTag(scope='income', name='Presente')`, **not** the free-text description. Reuse case-insensitive name first; if none, create in same transaction with a deterministic fallback color and appropriate type `outro`; never invent an existing tag or silently choose among near-synonyms.
4. Description `Presente da minha vó` is preserved verbatim (after safe trimming) in `Entry.notes`. Entry display name defaults to a clear label (e.g., `Presente`) independently; do not overwrite descriptive text with a tag identifier.
5. A just-received one-time income is persisted as `Entry` **plus** `EntryReceipt` marked received at the actual date. The receipt must use the same real-world day key as its associated piggy deposit; preserve business time zone conventions (`America/Sao_Paulo`).
6. `receive_and_save` always models *new external money received* followed by an *internal cash-to-piggy movement*: `deductFromBalance=true`. If the origin of funds is not explicit or has another plausible interpretation, preview returns a clarification requirement.
7. A bare piggy deposit requires an explicit `deductFromBalance=true|false` derived from the user's intent. Never rely on the legacy default `true` for MCP.
8. All user-requested records, including a newly created tag, the confirmed income receipt, piggy deposit, linked cash expense and operation idempotency result, commit or roll back together. Background accrued interest catch-up can be maintained separately, but **must not** produce a partially completed requested action.
9. For a repeated idempotency key and identical normalized payload, return the previous committed result. For the same key with different payload, fail with conflict. A timeout is **unknown status**, never an invitation to generate a fresh key and duplicate the posting.
10. For a clear unambiguous instruction, the server can execute after validation/preview subject to any mandatory host confirmation. For ambiguous intent, ask; do not invent defaults or assert success before commit.

## 6. Authentication, authorization and safety

- Treat the MCP as a distinct **OAuth 2.1 protected resource**; use HTTPS, authorization-code + PKCE, token audience/resource validation, discovery metadata, revocable consent and narrow scopes such as `finance:read` / `finance:write`. Implement or adopt an authorized identity issuer; no reuse of the browser session cookie as an MCP bearer token, no hardcoded permanent API key.
- Follow OpenAI/MCP OAuth metadata requirements (`/.well-known/oauth-protected-resource`, authorization-server metadata and resource binding). Use refresh-token mechanisms only when enabled and securely stored. Display a human-readable consent screen and allow disconnect/revoke.
- Identity always comes from a verified access token; **never** trust a `userId` supplied by an LLM. Enforce row-level ownership in each domain query or mutation; prevent cross-account tag and bank references.
- Keep existing CSRF protection for browser cookie requests; authorize MCP bearer calls with token-specific threat model and route-specific middleware rather than globally disabling CSRF.
- Validate input schemas (including size limits), enforce per-user write rate limits, avoid external URLs/network fetches from AI-supplied strings, protect tool outputs from prompt-injection implications and redact financial data, bearer tokens and descriptions in production logs.
- Keep the MCP behind approved Cloudflare HTTPS/Tunnel routing, without exposing PostgreSQL or internal API routes. Ensure Streamable HTTP supports expected content types, path routing, request timeouts and optional SSE when implemented.
- Maintain a tamper-evident or at least append-only transaction audit: user, authorized client, action, normalized amount, related record IDs, timestamps, idempotency key and status. Never persist raw chat transcripts by default.

## 7. Request sequence

1. User asks ChatGPT: "Ganhei vinte reais da minha vó, coloca no Porco."
2. AI looks up available piggy banks and tags with authorized read tools.
3. AI previews a `receive_and_save` operation: income +20, income tag Presente, description "Presente da minha vó", cash transfer -20, bank Porco +20.
4. Preview validates current exact bank ID, destination state and goal; ambiguous or missing details return clarification (no writes).
5. Client, after any required approval, calls `execute_financial_operation` with preview token and stable idempotency key.
6. Under one per-user DB lock and transaction, perform tag upsert/reuse, one-time income + receipt, piggy deposit + corresponding cash expense and operation audit record. Verify totals using existing business functions; invalidate cached patrimony/dashboard as appropriate.
7. Return actual IDs, amounts and after-state; AI only says "feito" if the service confirms committed.

If the user instead says "Add R$ 20 ao saldo, presente da minha vó", do a single `receive_income` action with no cofrinho movement.

## 8. Implementation slices and acceptance tests

**Slice A — accounting foundation:** add Entry notes and full read/write support; extract shared transaction-aware one-time received-income primitive; atomic income+piggy command with explicit deduction, tag resolution, exact centavos, same-day semantics and exact goal handling. Tests: +20/-20/+20, income-only +20, insufficient goal, archived bank, duplicate tags, ownership, rollback after induced deposit failure, cash/patrimony cache accounting.

**Slice B — idempotency, OAuth and transport:** operation audit/idempotency record with unique `(userId, clientId, idempotencyKey)` and payload digest; token verification, OAuth discovery/consent, typed MCP tools, read vs write scopes, rate limit, secure logs. Tests: unauthenticated 401, wrong scope 403, cross-user access denied, replay exactly once, same-key/different-request conflict, timeout retry, revoked/expired token, hostile tool strings, OAuth integration, Cloudflare reverse-proxy path.

**Slice C — client acceptance:** connect a supported client to a staging MCP; validate tool discovery, preview/execute, ambiguity questioning, confirmation UX and real financial effects. Test direct ChatGPT write functionality **only when account/workspace eligibility allows it**; otherwise classify ChatGPT write as blocked by platform entitlement, not as a defect in deManage. No production deployment without user approval.

Run local `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:integration` and build as appropriate, using a test database. Preserve existing CI and manual production approval workflow.

## 9. Out-of-scope and rollout

A staging environment and test account go first. Feature-flag the MCP as disabled by default and verify authorization before enabling it. Preserve existing website operations and DB migration backwards compatibility. No automatic production deploy, no branch merge, and no subscription upgrade as part of implementation. The next deliverable after approval of **this specification** is a file-by-file implementation plan for review.
