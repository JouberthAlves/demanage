# Governance

deManage currently uses a maintainer-led governance model for this fork.

## Maintainer

The fork owner, `@bielxdh3`, is the final decision maker for fork-specific scope, merges, deployment, repository settings, security response, and maintenance.

The project remains derived from the upstream repository `JouberthAlves/demanage`. Upstream authorship and rights over inherited code are not replaced by this fork governance.

## Decision model

- [plans.md](plans.md) defines the product roadmap and execution priorities.
- Pull requests should implement one coherent goal.
- `master` is the integrated branch for this fork.
- Security, authorization, data integrity, and financial correctness take precedence over convenience.
- Documentation should distinguish shipped behavior from planned work.

## Security-sensitive decisions

Authentication, authorization, cookies, recovery codes, financial calculations, Prisma migrations, deployment exposure, and secret handling require explicit review and focused validation.

## Releases and deployment

A merged change is not automatically a production-readiness claim. Self-hosted deployment should use the documented security controls and exact validated revision.

## Governance changes

This file may evolve as contribution volume, upstream coordination, or additional maintainers make a broader model useful.
