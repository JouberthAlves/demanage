"""Mandatory PostgreSQL dump before any container mutation."""

from __future__ import annotations

import hashlib
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .runner import Runner
from .state import atomic_json

MIN_FREE_BYTES = 2 * 1024**3
MIN_DUMP_BYTES = 1024


def backup_database(
    runner: Runner,
    config: dict[str, Any],
    commit: str,
    *,
    now: datetime | None = None,
    min_free_bytes: int = MIN_FREE_BYTES,
) -> tuple[str, str]:
    """Write a custom-format dump under backup_root and return (path, sha256)."""
    root = Path(config["backup_root"])
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not root.is_dir() or (sys.platform != "win32" and root.stat().st_mode & 0o077):
        raise RuntimeError("Backup root is not private (0700)")
    if shutil.disk_usage(root).free < min_free_bytes:
        raise RuntimeError("Not enough free disk space for a database backup; refusing to deploy")
    timestamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
    folder = root / f"cd-{timestamp}-{commit[:12]}"
    folder.mkdir(mode=0o700)
    destination = folder / "demanage.dump"
    temporary = "/tmp/demanage-cd-" + uuid.uuid4().hex + ".dump"
    try:
        runner.run([
            "docker", "exec", "demanage-db", "pg_dump", "-U", "demanage",
            "-d", "demanage", "--format=custom", "--no-owner",
            "--no-privileges", "--file=" + temporary,
        ])
        runner.run(["docker", "exec", "demanage-db", "pg_restore", "--list", temporary])
        runner.run(["docker", "cp", "demanage-db:" + temporary, str(destination)])
    finally:
        runner.run(["docker", "exec", "demanage-db", "rm", "-f", temporary], check=False)
    destination.chmod(0o600)
    size = destination.stat().st_size
    if size < MIN_DUMP_BYTES:
        raise RuntimeError("Database backup unexpectedly small")
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    atomic_json(folder / "metadata.json", {
        "sha256": digest,
        "size": size,
        "source_commit": commit,
        "created_at": (now or datetime.now(timezone.utc)).isoformat(),
    })
    return str(destination), digest
