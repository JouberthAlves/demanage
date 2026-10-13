"""Pull-only, fail-closed production deploy agent for deManage.

Modules:
  runner    command execution behind an injectable interface (tests use a fake)
  manifest  approval manifest and agent configuration validation
  state     atomic JSON files: deploy state and the intent journal
  docker    image and container inspection helpers
  compose   Compose model validation and the image-only overlay
  backup    pre-deploy PostgreSQL dump
  deploy    deploy, rollback and journal reconciliation
  cli       argument parsing, locking and the top-level flow
"""
