"""Owner-approved, no-GitHub-Actions production pointer publication.

This is a distinct review gate, not a claim of GitHub-hosted CI/CodeQL.
The existing Debian pull-only deploy agent still owns backup and rollback.
No private credentials are included in the published manifest.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath

from demanage_cd.local_ci import SHA, validate_ci_evidence
from demanage_cd.manifest import validate_release
from demanage_cd.migration_gate import validate_additive_sql

REPOSITORY = "bielxdh3/demanage"
APPROVER = "bielxdh3"
PRODUCTION_FILE = f"repos/{REPOSITORY}/contents/production.json"
MIGRATION_PROOF = re.compile(
    r"^/opt/demanage/backups/cd-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}/"
    r"local-migration-rehearsal\.json$"
)
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
SENSITIVE = (
    "backend/prisma", "backend/prisma.config.ts",
    "backend/entrypoint.sh", "docker-compose.prod.yml",
)


def call(*args: str) -> str:
    completed = subprocess.run(args, check=True, text=True, capture_output=True, timeout=180)
    return completed.stdout.strip()


def read_git_sql(repo: Path, target: str, path: str) -> str:
    """Read SQL from the target Git blob without newline/whitespace rewriting."""
    completed = subprocess.run(
        ["git", "-C", str(repo), "show", target + ":" + path],
        check=True, capture_output=True, timeout=180,
    )
    return completed.stdout.decode("utf-8")


def json_call(*args: str) -> dict:
    value = json.loads(call(*args))
    if not isinstance(value, dict):
        raise RuntimeError("Expected JSON object")
    return value


def utc_recent(value: str) -> bool:
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError, AttributeError):
        return False
    now = datetime.now(timezone.utc)
    return stamp.tzinfo is not None and now - timedelta(hours=48) <= stamp <= now + timedelta(minutes=5)


def read_live_manifest() -> tuple[dict, str]:
    response = json_call("gh", "api", PRODUCTION_FILE + "?ref=production")
    raw = base64.b64decode(response["content"])
    existing = validate_release(json.loads(raw))
    return existing, response["sha"]


def read_migration_proof(path: str, previous: str, target: str, backend: str) -> tuple[dict, str]:
    if not MIGRATION_PROOF.fullmatch(path):
        raise RuntimeError("Invalid server rehearsal proof location")
    raw = call("ssh", "-o", "BatchMode=yes", "servidor", "cat", path)
    evidence = json.loads(raw)
    required = {
        "version", "source_commit", "previous_commit", "backend_ref",
        "backup_path", "backup_sha256", "migration_count_before",
        "migration_count_after", "completed_at",
    }
    if not isinstance(evidence, dict) or set(evidence) != required or evidence["version"] != 1:
        raise RuntimeError("Unexpected migration proof format")
    if (evidence["source_commit"], evidence["previous_commit"], evidence["backend_ref"]) != (
        target, previous, backend
    ):
        raise RuntimeError("Migration rehearsal is not bound to this exact release")
    if not utc_recent(evidence["completed_at"]):
        raise RuntimeError("Migration rehearsal has expired")
    if type(evidence["migration_count_before"]) is not int or type(evidence["migration_count_after"]) is not int:
        raise RuntimeError("Migration counts must be integers")
    if evidence["migration_count_after"] <= evidence["migration_count_before"]:
        raise RuntimeError("Required schema migrations were not applied in rehearsal")
    backup = evidence["backup_path"]
    # Proof paths belong to the Debian server, not the Windows approval host.
    if backup != str(PurePosixPath(path).parent / "demanage.dump"):
        raise RuntimeError("Rehearsed backup is not inside the private proof folder")
    checksum = evidence["backup_sha256"]
    if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
        raise RuntimeError("Invalid backup checksum")
    live_checksum = call("ssh", "-o", "BatchMode=yes", "servidor", "sha256sum", backup).split()[0]
    if live_checksum != checksum:
        raise RuntimeError("Migration backup changed since review")
    return evidence, hashlib.sha256(raw.encode("utf-8")).hexdigest()


def verify_image(target: str, service: str) -> str:
    tag = f"ghcr.io/{REPOSITORY}-{service}:sha-{target}"
    manifest = json_call(
        "docker", "buildx", "imagetools", "inspect", tag,
        "--format", "{{json .Manifest}}",
    )
    digest = manifest.get("digest")
    if not isinstance(digest, str) or not DIGEST.fullmatch(digest):
        raise RuntimeError("Cannot resolve immutable registry digest for " + service)
    ref = f"ghcr.io/{REPOSITORY}-{service}@{digest}"
    call("docker", "pull", ref)
    image = json.loads(call("docker", "image", "inspect", ref))[0]
    label = (image.get("Config") or {}).get("Labels") or {}
    if image.get("Architecture") != "amd64" or label.get("org.opencontainers.image.revision") != target:
        raise RuntimeError("Registry image revision or architecture mismatch for " + service)
    return ref


def verify_git(repo: Path, previous: str, target: str) -> bool:
    sha = call("git", "-C", str(repo), "ls-remote", "origin", "refs/heads/master").split()[0]
    if sha != target:
        raise RuntimeError("Requested commit is not the current upstream master")
    call("git", "-C", str(repo), "cat-file", "-e", target + "^{commit}")
    call("git", "-C", str(repo), "cat-file", "-e", previous + "^{commit}")
    if subprocess.run(["git", "-C", str(repo), "merge-base", "--is-ancestor", previous, target]).returncode:
        raise RuntimeError("Deploy previous commit is not an ancestor of target")
    changed = call("git", "-C", str(repo), "diff", "--name-only", previous, target, "--", *SENSITIVE)
    if not changed:
        return False
    # Entry point/compose mutations need a different runbook. Only additive
    # migrations and schema changes can be attested through this path.
    names = changed.splitlines()
    if any(not (name.startswith("backend/prisma/migrations/") or name == "backend/prisma/schema.prisma") for name in names):
        raise RuntimeError("Entrypoint or base Compose changed: local promotion forbidden")
    statuses = call("git", "-C", str(repo), "diff", "--name-status", previous, target, "--", "backend/prisma/migrations")
    if any(not row.startswith("A\t") for row in statuses.splitlines()):
        raise RuntimeError("Existing migrations were edited or removed")
    # This channel only permits additive DDL, even with a reviewed rehearsal.
    # Destructive migrations need a separate planned and audited procedure.
    for name in names:
        if not name.startswith("backend/prisma/migrations/"):
            continue
        if not re.fullmatch(r"backend/prisma/migrations/[0-9]{14}_[a-zA-Z0-9_]+/migration\.sql", name):
            raise RuntimeError("Unexpected migration asset in local release")
        content = read_git_sql(repo, target, name)
        validate_additive_sql(content, name)
    return True


def promote(args: argparse.Namespace) -> str:
    if not SHA.fullmatch(args.source_commit) or args.confirm_sha != args.source_commit:
        raise RuntimeError("Operator must explicitly confirm the exact 40-character target SHA")
    if args.publish and not args.acknowledge_no_codeql:
        raise RuntimeError("Operator must acknowledge that hosted CodeQL was not run")
    repo = Path(__file__).resolve().parents[2]
    proof_sha = validate_ci_evidence(args.log_directory, args.source_commit)
    actor = json_call("gh", "api", "user").get("login")
    if actor != APPROVER:
        raise RuntimeError("Local approval requires an authenticated repository owner")
    remote, content_sha = read_live_manifest()
    previous = remote["source_commit"]
    state = json.loads(call("ssh", "-o", "BatchMode=yes", "servidor",
                            "cat", "/opt/demanage/cd/state.json"))
    if state.get("source_commit") != previous:
        raise RuntimeError("Live Debian deploy state differs from production manifest")
    if previous == args.source_commit:
        raise RuntimeError("Target commit is already the approved production version")
    schema_changes = verify_git(repo, previous, args.source_commit)
    backend = verify_image(args.source_commit, "backend")
    frontend = verify_image(args.source_commit, "frontend")
    rehearsal_sha = "no-schema-change"
    if schema_changes:
        if not args.migration_proof or not args.confirm_migration_backup_sha256:
            raise RuntimeError("Schema changes require a reviewed isolated DB migration proof and backup checksum")
        migration, rehearsal_sha = read_migration_proof(
            args.migration_proof, previous, args.source_commit, backend
        )
        if args.confirm_migration_backup_sha256 != migration["backup_sha256"]:
            raise RuntimeError("Migration backup was not explicitly acknowledged")
    elif args.migration_proof or args.confirm_migration_backup_sha256:
        raise RuntimeError("No migration review is needed for this release")

    approved = validate_release({
        "version": 1,
        "source_commit": args.source_commit,
        "previous_commit": previous,
        "backend": backend,
        "frontend": frontend,
        "approved_by": actor,
        "approved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    })
    print("RELEASE_GATE=PASS")
    print("LOCAL_CI_EVIDENCE_SHA256=" + proof_sha)
    print("MIGRATION_REHEARSAL_SHA256=" + rehearsal_sha)
    print("PREVIOUS_COMMIT=" + previous)
    print("TARGET_COMMIT=" + args.source_commit)
    print("BACKEND_IMAGE=" + backend)
    print("FRONTEND_IMAGE=" + frontend)
    if not args.publish:
        print("DRY_RUN_ONLY: no production pointer changed")
        return "dry-run"

    # A second read avoids publishing a stale approval when master moves during
    # slow registry downloads or human review of migration evidence.
    if call("git", "-C", str(repo), "ls-remote", "origin", "refs/heads/master").split()[0] != args.source_commit:
        raise RuntimeError("Master moved while the local approval was being reviewed")
    # The signed-in owner's GitHub token is the release authority (no token is
    # passed to the server). GitHub's content SHA is a compare-and-swap guard.
    commit_message = (
        "deploy(local-ci): approve " + args.source_commit + "\n\n"
        "Owner reviewed exact local CI evidence SHA256 " + proof_sha + "\n"
        "Isolated migration rehearsal SHA256 " + rehearsal_sha + "\n"
        "GitHub Actions checks were NOT run; locally approved channel."
    )
    body = {
        "message": commit_message,
        "content": base64.b64encode((json.dumps(approved, indent=2) + "\n").encode()).decode(),
        "branch": "production",
        "sha": content_sha,
    }
    with tempfile.TemporaryDirectory(prefix="demanage-approval-") as tmp:
        payload = Path(tmp) / "request.json"
        payload.write_text(json.dumps(body), encoding="utf-8")
        response = json_call("gh", "api", "--method", "PUT", PRODUCTION_FILE, "--input", str(payload))
    if "commit" not in response:
        raise RuntimeError("GitHub did not confirm production pointer update")
    published, _ = read_live_manifest()
    if published != approved:
        raise RuntimeError("Production pointer did not match the approved manifest")
    print("PRODUCTION_POINTER_PUBLISHED=" + args.source_commit)
    return args.source_commit


def main() -> int:
    parser = argparse.ArgumentParser(description="Review a local-CI release before publishing immutable production pointer")
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--confirm-sha", required=True)
    parser.add_argument("--log-directory", type=Path, required=True)
    parser.add_argument("--migration-proof", help="Private proof path under /opt/demanage/backups/ on Debian")
    parser.add_argument("--confirm-migration-backup-sha256")
    parser.add_argument("--publish", action="store_true", help="Explicitly update production.json; default is read-only")
    parser.add_argument("--acknowledge-no-codeql", action="store_true", help="Acknowledge that GitHub CodeQL did not run on this SHA")
    args = parser.parse_args()
    try:
        promote(args)
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError, RuntimeError) as error:
        print("BLOCKED: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
