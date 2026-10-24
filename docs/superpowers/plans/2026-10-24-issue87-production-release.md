# Issue #87 One-Time Production Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely authorize only the exact reviewed PostgreSQL migration release, then complete the existing protected GitHub-to-Debian deployment after human approval.

**Architecture:** A self-contained Python policy validates immutable release identity and the exact sensitive Git diff. The existing GitHub Actions workflow invokes it before publishing the signed pointer, with a post-image-digest check; the local dry-run gate uses the same policy. Only the existing Debian agent deploys the images and applies migrations.

**Tech Stack:** Python 3 standard library, Git, GitHub Actions YAML, PostgreSQL 18/Prisma, Docker GHCR digests.

**Spec:** `docs/superpowers/specs/2026-10-24-issue87-production-release-design.md`

## Global Constraints

- Production previous SHA `ec2a3d40a6c8218ab0550258305e1745ee3b1fbc`; target SHA `62e98ccea16dd0d3164ab1689c11fe770b983393` only.
- Pin exact dump `be5d1dd8432507f8f23fca55fe3ae4261cf1a2a58efbf18a7a179e2e792fc84c`, rehearsal `b0e07420cb4102daeafffb7efa53f528e5c55ca410dd4d5da13be065dd153495`, and two GHCR digests from the spec.
- No direct `production.json` writes, protected-gate bypass, automatic SQL rollback, destructive git cleanup, or interference with other worktrees.
- Commits authored by bielxdh3 with exactly one `Co-authored-by: Codex <codex@openai.com>` trailer.

## Review Focus

- A different previous or target commit rejects the one-time exception.
- Modified/removed old SQL, an extra sensitive file, or changed schema/Compose rejects the exception.
- Missing/wrong owner-entered dump or proof checksum, expired proof, or wrong OCI digest rejects the exception.
- The existing PR47 exception and default no-schema promotion remain unchanged.
- Published v2 pointer still requires GitHub environment approval and the Debian agent's independent provenance, health, DB identity, backup and rollback.

### Task 1: One-time policy (TDD)

**Files:** Add `ops/cd/issue87_release_gate.py`; add `ops/cd/tests/test_issue87_release_gate.py`.

**Interfaces:** `verify_issue87_release(repo, previous, target, dump_sha, rehearsal_sha, *, backend=None, frontend=None, now=None)` validates fixed identity, fresh review, exact sensitive diff/bytes and optional OCI digests; CLI exits nonzero on any failure.

- [ ] Write adversarial tests for the real committed release plus wrong identity/dump/proof, injected seventh sensitive file, changed blob, expired proof and swapped digests.
- [ ] Run tests and record expected RED for missing policy.
- [ ] Implement minimal checked policy with Git blob reads, bounded subprocess calls and no side effects.
- [ ] Run targeted tests, confirm GREEN; include explicit `--images` validation before pointer creation.
- [ ] Commit this independently reviewable component if integration timing permits.

### Task 2: Connect both authorization channels

**Files:** Modify `.github/workflows/promote-production.yml`, `ops/cd/local_release_approval.py`; update tests `ops/cd/tests/test_local_release.py`, `ops/cd/tests/test_promote_workflow_ancestry.py`.

**Interfaces:** Two new owner-entered checksums, one-shot only; `ISSUE87_IMAGE_CHECK_REQUIRED` environment marker; local approval dry-run uses the same exact policy and still forbids `--publish`.

- [ ] Add RED tests for unchanged generic blockers, one-shot exact exception, immutable image digests and human environment gate.
- [ ] Wire policy in the workflow before pointer preparation; preserve PR47 logic, current protected environment, and CI/CodeQL checks.
- [ ] Fix any concrete local-approval runtime regressions shown by tests; do not open a second publishing path.
- [ ] Run affected Python suites and workflow syntax checks; confirm GREEN.

### Task 3: Reviewed release artifact and independent review

**Files:** Add `docs/issue-87-production-release-review.md`; update docs if actual release process differs.

- [ ] Record four SQL blob hashes, dump/proof checksums, image digests, migration/Compose effects, recovery and offsite limitations.
- [ ] Run focused tests, full deployment-safety suite, available local gates, and `git diff --check`.
- [ ] Request read-only independent P1/P2 review of immutable commit/patch; fix any validated findings and reverify.

### Task 4: Publish and obtain legitimate approvals

- [ ] Commit author bielxdh3 + exactly one Codex coauthor, publish new branch and open draft/ready PR for owner's review.
- [ ] Verify exact-head GitHub CI/CodeQL and keep the PR open until owner merges.
- [ ] After owner merge, dispatch `Approve production release` on `master` with target SHA and both exact checksums; do not self-approve the protected environment.
- [ ] When approved and published, verify v2 pointer bytes, waiting Debian agent, fresh backup, four applied migrations and service/data health; report all evidence or exact blocker.
