"""Validate local CI evidence before a production-release decision.

Evidence proves integrity of local log files, not GitHub-hosted CI/CodeQL.
It is trusted only when reviewed by the authenticated repository owner.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

GATES = (
    "01-backend-install", "02-frontend-install", "03-backend-audit",
    "04-frontend-audit", "05-prisma-validate", "06-prisma-generate",
    "07-migrate-deploy", "08-migration-drift", "09-backend-typecheck",
    "10-frontend-typecheck", "11-backend-lint", "12-frontend-lint",
    "13-backend-unit", "14-frontend-unit", "15-backend-integration",
    "16-backend-build", "17-frontend-build", "18-deploy-agent-compile",
    "19-deploy-agent-test", "20-compose-dev-syntax",
    "21-compose-build-syntax", "22-compose-prod-syntax",
    "23-backend-image-build", "24-frontend-image-build",
)
SHA = re.compile(r"^[0-9a-f]{40}$")
DIGEST = re.compile(r"^[0-9a-f]{64}$")


def validate_ci_evidence(folder: Path, target: str, *, now: datetime | None = None) -> str:
    """Return SHA256 of validated evidence; refuse missing, stale or altered logs."""
    if not SHA.fullmatch(target):
        raise ValueError("Invalid full target SHA")
    path = folder / "local-ci-evidence.json"
    if path.is_symlink() or not path.is_file():
        raise ValueError("Missing or symlinked local CI evidence")
    data = path.read_bytes()
    if len(data) > 65536:
        raise ValueError("CI evidence is oversized")
    evidence = json.loads(data)
    if set(evidence) != {"version", "source_commit", "completed_at", "image_builds", "steps"}:
        raise ValueError("Unexpected CI evidence fields")
    if evidence["version"] != 1 or evidence["source_commit"] != target or evidence["image_builds"] is not True:
        raise ValueError("CI evidence is for a different revision or omitted image builds")
    completed = datetime.fromisoformat(evidence["completed_at"].replace("Z", "+00:00"))
    current = now or datetime.now(timezone.utc)
    if completed.utcoffset() is None or not current - timedelta(days=7) <= completed <= current + timedelta(minutes=5):
        raise ValueError("CI evidence is stale or future-dated")
    steps = evidence["steps"]
    if not isinstance(steps, list) or [s.get("name") for s in steps if isinstance(s, dict)] != list(GATES):
        raise ValueError("CI evidence has missing, reordered or unknown gates")
    for entry in steps:
        if not isinstance(entry, dict) or set(entry) != {"name", "sha256"}:
            raise ValueError("Invalid gate evidence structure")
        if not isinstance(entry["sha256"], str) or not DIGEST.fullmatch(entry["sha256"]):
            raise ValueError("Invalid gate log checksum")
        logfile = folder / (entry["name"] + ".log")
        if logfile.is_symlink() or not logfile.is_file() or logfile.stat().st_size > 64 * 1024 * 1024:
            raise ValueError("Missing, symlinked or oversized CI log")
        content = logfile.read_bytes()
        if hashlib.sha256(content).hexdigest() != entry["sha256"]:
            raise ValueError("CI log hash mismatch: " + entry["name"])
        lines = content.decode("utf-8-sig").splitlines()
        if not lines or lines[0] != "Step: " + entry["name"] or lines[-1] != "Exit code: 0":
            raise ValueError("CI log did not complete successfully: " + entry["name"])
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify SHA-bound local CI release evidence")
    parser.add_argument("--log-directory", required=True, type=Path)
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()
    print("LOCAL_CI_EVIDENCE_VALIDATED_SHA256=" + validate_ci_evidence(args.log_directory, args.commit))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
