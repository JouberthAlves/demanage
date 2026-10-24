"""Approval manifest and agent configuration validation (no side effects)."""

from __future__ import annotations

import base64
import binascii
import hashlib
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
MAX_API_BYTES = 131072
GITHUB_API = "https://api.github.com/repos/" + REPOSITORY
PROMOTION_WORKFLOW_ID = 379924232
PROMOTION_WORKFLOW_PATH = ".github/workflows/promote-production.yml"
# This exact historical pointer predates authenticated provenance. It was published
# by the approved 2026-10-19 promotion run; never extend this exception to new v1s.
LEGACY_POINTER_COMMIT = "0f8892e115349975d854b53c5807ca79b1f2e5fc"
LEGACY_POINTER_BLOB = "820939efcee292b9f91a616536ba04aaa38e3410"
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
RELEASE_V2_FIELDS = RELEASE_FIELDS | {"approval_run_id", "approval_run_attempt"}
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
    if not isinstance(raw, dict):
        raise ValueError("Production manifest must be a JSON object")
    version = raw.get("version")
    if type(version) is not int or version not in (1, 2):
        raise ValueError("Unsupported production manifest version")
    if set(raw) != (RELEASE_FIELDS if version == 1 else RELEASE_V2_FIELDS):
        raise ValueError("Unexpected production manifest fields")
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
    if version == 2:
        if type(raw["approval_run_id"]) is not int or not 0 < raw["approval_run_id"] < 2**63:
            raise ValueError("Invalid approval run ID")
        # A rerun has a different execution context; require a fresh dispatch.
        if type(raw["approval_run_attempt"]) is not int or raw["approval_run_attempt"] != 1:
            raise ValueError("Unsupported approval run attempt")
    return raw


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def _github_json(path: str, opener: Callable[..., Any]) -> Any:
    request = urllib.request.Request(
        GITHUB_API + path,
        headers={
            "User-Agent": "demanage-pull-deployer/2",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Cache-Control": "no-cache",
        },
    )
    with opener(request, timeout=15) as response:
        body = response.read(MAX_API_BYTES + 1)
    if len(body) > MAX_API_BYTES:
        raise ValueError("GitHub approval metadata exceeds maximum size")
    return json.loads(body)


def _immutable_pointer(raw_body: bytes, opener: Callable[..., Any]) -> tuple[str, str]:
    """Bind CDN bytes to the current production Git commit and its file blob."""
    ref = _github_json("/git/ref/heads/production", opener)
    commit = (ref.get("object") or {}).get("sha") if isinstance(ref, dict) else None
    if (
        not isinstance(ref, dict) or ref.get("ref") != "refs/heads/production"
        or (ref.get("object") or {}).get("type") != "commit"
        or not isinstance(commit, str) or not SHA_RE.fullmatch(commit)
    ):
        raise ValueError("Invalid production branch ref")
    content = _github_json(f"/contents/production.json?ref={commit}", opener)
    if not isinstance(content, dict) or content.get("type") != "file" or content.get("encoding") != "base64":
        raise ValueError("Invalid immutable production pointer response")
    blob = content.get("sha")
    encoded = content.get("content")
    if not isinstance(blob, str) or not SHA_RE.fullmatch(blob) or not isinstance(encoded, str):
        raise ValueError("Invalid immutable production pointer identity")
    try:
        immutable_body = base64.b64decode("".join(encoded.split()), validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError("Invalid immutable production pointer encoding") from error
    if (len(immutable_body) > MAX_MANIFEST_BYTES or immutable_body != raw_body
            or git_blob_sha(immutable_body) != blob):
        raise ValueError("Production pointer content differs from immutable Git blob")
    return commit, blob


def _verify_approval_provenance(
    release: dict[str, Any], commit: str, blob: str,
    pointer_bytes: bytes, opener: Callable[..., Any]
) -> None:
    if release["version"] == 1:
        if (commit, blob) != (LEGACY_POINTER_COMMIT, LEGACY_POINTER_BLOB):
            raise ValueError("Unwitnessed legacy production pointer provenance")
        return

    run_id = release["approval_run_id"]
    attempt = release["approval_run_attempt"]
    run = _github_json(f"/actions/runs/{run_id}", opener)
    if not isinstance(run, dict) or any((
        run.get("id") != run_id,
        run.get("workflow_id") != PROMOTION_WORKFLOW_ID,
        str(run.get("path", "")).split("@", 1)[0] != PROMOTION_WORKFLOW_PATH,
        run.get("event") != "workflow_dispatch",
        run.get("head_branch") != "master",
        run.get("status") != "completed",
        run.get("conclusion") != "success",
        run.get("run_attempt") != attempt,
        (run.get("actor") or {}).get("login") != APPROVER,
        (run.get("triggering_actor") or {}).get("login") != APPROVER,
    )):
        raise ValueError("Production approval workflow identity is invalid")
    repository_id = (run.get("repository") or {}).get("id")
    if type(repository_id) is not int or repository_id <= 0:
        raise ValueError("Invalid production approval workflow repository")
    approvals = _github_json(f"/actions/runs/{run_id}/approvals", opener)
    if not isinstance(approvals, list) or not any(
        isinstance(item, dict) and item.get("state") == "approved"
        and (item.get("user") or {}).get("login") == APPROVER
        and any(isinstance(env, dict) and env.get("name") == "production"
                for env in item.get("environments", []))
        for item in approvals
    ):
        raise ValueError("Required production environment reviewer approval is missing")

    artifacts = _github_json(f"/actions/runs/{run_id}/artifacts?per_page=100", opener)
    # The artifact is uploaded before the GitHub Contents API write. Its name
    # authenticates the exact pointer bytes independent of the branch's writer.
    # The successful run proves the later publication step also completed.
    expected = f"production-pointer-{run_id}-{attempt}-{hashlib.sha256(pointer_bytes).hexdigest()}"
    if (
        not isinstance(artifacts, dict)
        or type(artifacts.get("total_count")) is not int
        or artifacts["total_count"] > 100
        or not isinstance(artifacts.get("artifacts"), list)
        or sum(
            isinstance(item, dict)
            and item.get("name") == expected
            and item.get("expired") is False
            and type(item.get("size_in_bytes")) is int
            and item["size_in_bytes"] > 0
            and (item.get("workflow_run") or {}).get("id") == run_id
            and (item.get("workflow_run") or {}).get("repository_id") == repository_id
            for item in artifacts["artifacts"]
        ) != 1
    ):
        raise ValueError("Missing immutable artifact bound to approved production pointer")


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
    release = validate_release(json.loads(body))
    commit, blob = _immutable_pointer(body, opener)
    _verify_approval_provenance(release, commit, blob, body, opener)
    return release


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
