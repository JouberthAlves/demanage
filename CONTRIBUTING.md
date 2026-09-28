# Contributing to deManage

Thanks for contributing to deManage.

deManage is a personal finance application with authentication, financial records, PostgreSQL persistence, and self-hosted deployment support. Contributions should preserve data integrity, authorization boundaries, and predictable financial behavior.

## Before you start

1. Read [AGENTS.md](AGENTS.md).
2. Read [plans.md](plans.md) and stay within the user-approved scope.
3. Follow [CODING_STYLE.md](CODING_STYLE.md).
4. Review [SECURITY.md](SECURITY.md) for security-sensitive work.
5. Search existing pull requests before starting overlapping work.

Keep each pull request focused on one coherent goal. Do not mix unrelated refactors, dependency upgrades, UI redesign, and product features.

## Development setup

Frontend:

```bash
cd frontend
pnpm install
pnpm dev
```

Backend:

```bash
cd backend
pnpm install
pnpm exec prisma generate
pnpm dev
```

See [README.md](README.md) for PostgreSQL and environment setup.

## Validation

Run the checks relevant to your change.

Frontend:

```bash
cd frontend
pnpm lint
pnpm build
```

Backend:

```bash
cd backend
pnpm lint
pnpm test
pnpm build
```

For schema changes, validate Prisma generation and migrations against disposable development data.

Never claim a validation passed unless it actually completed.

## Security-sensitive areas

Extra scrutiny is required for:

- authentication and sessions;
- cookies, JWTs, CORS, and CSRF;
- authorization and user ownership;
- password and recovery-code flows;
- Prisma schema and migrations;
- financial calculations and transaction timing;
- Docker, reverse-proxy, and self-host configuration;
- secrets, environment variables, and logs.

## Pull requests

A good pull request should include:

- the problem and intended behavior;
- exact files changed;
- validations performed and results;
- security/data-integrity implications;
- screenshots for meaningful UI changes;
- validations not run and why;
- remaining limitations.

Use the repository pull request template.

## AI-assisted contributions

AI-assisted work is welcome, but the contributor remains responsible for the submitted code, validation claims, and security impact. Review generated diffs before publishing and never commit secrets or private financial data.

## Licensing note

This repository is a fork of `JouberthAlves/demanage`. The upstream repository currently does not publish a repository-wide license. Contributions must not claim broader rights over inherited upstream code than the upstream author has granted.
