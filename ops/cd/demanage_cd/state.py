"""Atomic JSON files: the deploy state and the intent journal.

Journal semantics: the journal is written BEFORE any container is mutated and
removed only after the new release is verified (or the previous one is restored).
If the agent dies in between, the next run finds the journal and reconciles it
against the running containers instead of starting a second deployment.
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any

from .manifest import SHA_RE, SERVICES, load_json

JOURNAL_FILENAME = "deploy-journal.json"
ROLLBACK_FAILED = "rollback-failed"
APPLYING = "applying"


def atomic_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(data, output, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def journal_path(config: dict[str, Any]) -> Path:
    return Path(config["state_file"]).parent / JOURNAL_FILENAME


def load_state(path: Path) -> dict[str, Any]:
    state = load_json(path)
    current = state.get("source_commit")
    if not isinstance(current, str) or not SHA_RE.fullmatch(current):
        raise RuntimeError("Corrupt saved deployment state")
    images = state.get("running_image_ids")
    if not isinstance(images, dict) or set(images) != set(SERVICES):
        raise RuntimeError("Corrupt saved deployment state (image ids)")
    return state


def write_state(path: Path, state: dict[str, Any]) -> None:
    atomic_json(path, state)


def read_journal(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    journal = load_json(path)
    for key in ("target", "previous", "new_images", "previous_images", "phase"):
        if key not in journal:
            raise RuntimeError(f"Corrupt deploy journal: missing {key}")
    return journal


def write_journal(path: Path, journal: dict[str, Any]) -> None:
    atomic_json(path, journal)


def clear_journal(path: Path) -> None:
    path.unlink(missing_ok=True)
