# Security Policy

deManage handles authentication, financial records, PostgreSQL data, cookies, recovery codes, and self-hosted deployment boundaries. Security reports should avoid exposing real user data or credentials.

## Supported versions

Security fixes target the current `master` branch and the currently deployed/self-hosted revision when practical.

## Reporting a vulnerability

Do **not** open a public issue for an undisclosed vulnerability.

Preferred reporting path:

1. Use GitHub's private vulnerability reporting / Security Advisory flow for this repository.
2. If that path is unavailable, contact the repository owner privately through GitHub before disclosing technical details.

Include:

- affected commit or revision;
- affected frontend/backend component or route;
- reproduction steps using disposable data;
- expected and observed behavior;
- security impact and required preconditions;
- sanitized logs when useful.

Do not include live JWTs, cookies, recovery codes, database dumps, credentials, private URLs, personal financial data, environment files, access tokens, or unrelated private information.

## High-priority areas

Reports are especially useful for:

- authentication and session handling;
- JWT, cookie, CSRF, CORS, or rate-limit bypasses;
- IDOR / authorization failures;
- password or recovery-code handling;
- injection and unsafe input validation;
- sensitive data exposure in logs or errors;
- PostgreSQL / Prisma authorization or integrity issues;
- Docker / reverse-proxy / self-host deployment boundaries;
- dependency or CI/CD compromise.

## Safe testing

Use test accounts and disposable data only. Do not test against third-party systems, accounts, or data you do not own or have explicit authorization to assess.

## Disclosure

Please allow reasonable time to investigate, fix, and publish an advisory before public disclosure.
