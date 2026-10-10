"""Approval manifest and agent configuration validation (no side effects)."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

REPOSITORY = "bielxdh3/demanage"
MANIFEST_URL = (
    "https://raw.githubusercontent.com/" + REPOSITORY + "/production/production.json"
)
PUBLIC_HEALTH_URL = "https://demanage.biel.dev.br/api/health"
APPROVER = "bielxdh3"
MAX_MANIFEST_BYTES = 8192
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SERVICES = ("backend", "frontend")
IMAGE_RE = {
    service: re.compile(
        r"^ghcr\.io/bielxdh3/demanage-" + service + r"@sha256:[0-9a-f]{64}$"
    )
    for service in SERVICES
}
REVISION_LABEL = "org.opencontainers.image.revision"
RELEASE_FIELDS = {
    "version",
    "source_commit",
    "previous_commit",
    "backend",
    "frontend",
    "approved_by",
    "approved_at",
}
CONFIG_FIELDS = {
    "compose_files",
    "env_file",
    "project_name",
    "backup_root",
    "state_file",
    "lock_file",
    "public_health_url",
}


def load_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Not a JSON object: {path}")
    return data


def validate_release(raw: dict[str, Any]) -> dict[str, Any]:
    if set(raw) != RELEASE_FIELDS:
        raise ValueError("Unexpected production manifest fields")
    if raw["version"] != 1:
        raise ValueError("Unsupported production manifest version")
    if not all(
        isinstance(raw[key], str) and SHA_RE.fullmatch(raw[key])
        for key in ("source_commit", "previous_commit")
    ):
        raise ValueError("Invalid commit SHA")
    if raw["approved_by"] != APPROVER:
        raise ValueError("Release not approved by the repository owner")
    if not isinstance(raw["approved_at"], str):
        raise ValueError("Invalid approval timestamp")
    for service, pattern in IMAGE_RE.items():
        if not isinstance(raw[service], str) or not pattern.fullmatch(raw[service]):
            raise ValueError(f"Invalid {service} image identity")
    return raw


def fetch_approval(
    url: str = MANIFEST_URL,
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> dict[str, Any] | None:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "demanage-pull-deployer/1",
            "Cache-Control": "no-cache",
            "Accept": "application/json",
        },
    )
    try:
        with opener(request, timeout=15) as response:
            body = response.read(MAX_MANIFEST_BYTES + 1)
    except urllib.error.HTTPError as error:
        try:
            if error.code == 404:
                return None
            raise
        finally:
            error.close()
    if len(body) > MAX_MANIFEST_BYTES:
        raise ValueError("Production manifest exceeds maximum size")
    return validate_release(json.loads(body))


def validate_config(config: dict[str, Any]) -> dict[str, Any]:
    if not CONFIG_FIELDS.issubset(config):
        raise ValueError(
            f"Missing config fields: {sorted(CONFIG_FIELDS - set(config))}"
        )
    files = config["compose_files"]
    if not isinstance(files, list) or not files or not all(
        isinstance(p, str) and Path(p).is_absolute() and Path(p).is_file()
        for p in files
    ):
        raise ValueError("compose_files must list existing absolute file paths")
    if not Path(config["env_file"]).is_file():
        raise ValueError("Missing env_file")
    for key in ("backup_root", "state_file", "lock_file"):
        if not Path(config[key]).is_absolute():
            raise ValueError(f"Expected absolute path for {key}")
    if config["project_name"] != "demanage":
        raise ValueError("Refusing to manage another Compose project")
    if config["public_health_url"] != PUBLIC_HEALTH_URL:
        raise ValueError("Unexpected production hostname")
    return config
