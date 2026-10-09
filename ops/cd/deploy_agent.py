#!/usr/bin/env python3
"""Pull-only, fail-closed production deploy agent for deManage.

No inbound port, long-lived GitHub token, automatic schema migration approval,
volume deletion, database recreation, or Cloudflare configuration changes.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

REPOSITORY = "bielxdh3/demanage"
MANIFEST_URL = (
    "https://raw.githubusercontent.com/"
    + REPOSITORY
    + "/production/production.json"
)
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
IMAGE_RE = {
    service: re.compile(
        r"^ghcr\.io/bielxdh3/demanage-"
        + service
        + r"@sha256:[0-9a-f]{64}$"
    )
    for service in ("backend", "frontend")
}


def invoke(args: list[str], *, check: bool = True) -> str:
    completed = subprocess.run(
        args,
        text=True,
        capture_output=True,
        check=False,
        timeout=240,
    )
    if check and completed.returncode != 0:
        # Do not print Docker/Compose diagnostics: they may contain secrets.
        raise RuntimeError(
            f"Command {args[0]} failed (exit code {completed.returncode}); "
            "inspect the host privately"
        )
    return completed.stdout.strip()


def load_json(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Not a JSON object: {path}")
    return data


def atomic_json(path: Path, data: dict) -> None:
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


def validate_release(raw: dict) -> dict:
    if set(raw) != {
        "version", "source_commit", "previous_commit",
        "backend", "frontend", "approved_by", "approved_at"
    }:
        raise ValueError("Unexpected production manifest fields")
    if raw["version"] != 1:
        raise ValueError("Unsupported production manifest version")
    if not all(
        isinstance(raw[key], str) and SHA_RE.fullmatch(raw[key])
        for key in ("source_commit", "previous_commit")
    ):
        raise ValueError("Invalid commit SHA")
    if raw["approved_by"] != "bielxdh3":
        raise ValueError("Release not approved by the repository owner")
    if not isinstance(raw["approved_at"], str):
        raise ValueError("Invalid approval timestamp")
    for service, pattern in IMAGE_RE.items():
        if not isinstance(raw[service], str) or not pattern.fullmatch(raw[service]):
            raise ValueError(f"Invalid {service} image identity")
    return raw


def fetch_approval() -> dict | None:
    request = urllib.request.Request(
        MANIFEST_URL,
        headers={
            "User-Agent": "demanage-pull-deployer/1",
            "Cache-Control": "no-cache",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = response.read(8192 + 1)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise
    if len(body) > 8192:
        raise ValueError("Production manifest exceeds maximum size")
    return validate_release(json.loads(body))


def validate_config(config: dict) -> dict:
    required = {
        "compose_files", "env_file", "project_name",
        "backup_root", "state_file", "lock_file",
        "public_health_url"
    }
    if not required.issubset(config):
        raise ValueError(f"Missing config fields: {sorted(required - set(config))}")
    files = config["compose_files"]
    if not isinstance(files, list) or not files or not all(
        isinstance(p, str) and Path(p).is_absolute() and Path(p).is_file()
        for p in files
    ):
        raise ValueError("compose_files must list existing absolute file paths")
    for key in ("env_file",):
        if not Path(config[key]).is_file():
            raise ValueError(f"Missing {key}")
    for key in ("backup_root", "state_file", "lock_file"):
        if not Path(config[key]).is_absolute():
            raise ValueError(f"Expected absolute path for {key}")
    if config["project_name"] != "demanage":
        raise ValueError("Refusing to manage another Compose project")
    if config["public_health_url"] != "https://demanage.biel.dev.br/api/health":
        raise ValueError("Unexpected production hostname")
    return config


def docker_inspect(name: str) -> dict:
    result = json.loads(invoke(["docker", "inspect", name]))
    if len(result) != 1:
        raise RuntimeError("Expected exactly one Docker object")
    return result[0]


def compose_command(config: dict, overlay: Path | None = None) -> list[str]:
    parts = [
        "docker", "compose", "--project-name", config["project_name"],
        "--env-file", config["env_file"],
    ]
    for file in config["compose_files"]:
        parts.extend(["-f", file])
    if overlay is not None:
        parts.extend(["-f", str(overlay)])
    return parts


def compose_model(config: dict, overlay: Path | None = None) -> dict:
    return json.loads(
        invoke(compose_command(config, overlay) + ["config", "--format", "json"])
    )


def expected_runtime_networks(model: dict, service: dict) -> set[str]:
    attached = service.get("networks", {})
    names = attached if isinstance(attached, list) else attached.keys()
    networks = model.get("networks", {})
    return {networks.get(key, {}).get("name", key) for key in names}


def expected_port_bindings(service: dict) -> list[tuple[str, str, str]]:
    bindings = []
    for port in service.get("ports") or []:
        if not isinstance(port, dict):
            raise RuntimeError("Compose ports must be expanded in config JSON")
        if port.get("published") is None:
            raise RuntimeError("Refusing dynamically published ports")
        target = f"{port['target']}/{port.get('protocol', 'tcp')}"
        host = port.get("host_ip") or "0.0.0.0"
        bindings.append((target, str(host), str(port["published"])))
    return sorted(bindings)


def actual_port_bindings(container: dict) -> list[tuple[str, str, str]]:
    bindings = []
    for port, entries in (container["HostConfig"].get("PortBindings") or {}).items():
        for entry in entries or []:
            bindings.append((
                port,
                entry.get("HostIp") or "0.0.0.0",
                entry.get("HostPort") or "",
            ))
    return sorted(bindings)


def validate_compose(
    config: dict, overlay: Path | None = None, *, check_runtime: bool = True
) -> None:
    original = compose_model(config)
    services = original.get("services", {})
    if not {"db", "frontend", "backend"}.issubset(services):
        raise RuntimeError("Compose does not contain the expected three services")
    expected_names = {
        "db": "demanage-db",
        "backend": "demanage-backend",
        "frontend": "demanage-frontend",
    }
    for name, container in expected_names.items():
        if services[name].get("container_name") != container:
            raise RuntimeError(f"Unexpected container name for {name}")
        if check_runtime:
            running = invoke(compose_command(config) + ["ps", "-q", name])
            actual_container = docker_inspect(container)
            actual = actual_container["Id"]
            if not running or not actual.startswith(running):
                raise RuntimeError(f"{name} is not managed by the selected Compose project")
            labels = actual_container["Config"].get("Labels") or {}
            if (
                labels.get("com.docker.compose.project") != "demanage"
                or labels.get("com.docker.compose.service") != name
            ):
                raise RuntimeError(f"{name} has unexpected Compose ownership labels")
            configured_networks = expected_runtime_networks(original, services[name])
            actual_networks = set(actual_container["NetworkSettings"]["Networks"])
            if configured_networks != actual_networks:
                raise RuntimeError(
                    f"{name} runtime Docker networks disagree with selected Compose"
                )
            if expected_port_bindings(services[name]) != actual_port_bindings(actual_container):
                raise RuntimeError(
                    f"{name} host port bindings disagree with selected Compose"
                )
    if overlay is None:
        return

    proposed = compose_model(config, overlay)
    if set(proposed["services"]) != set(services):
        raise RuntimeError("Deployment overlay changed the Compose services")
    for name in services:
        old = dict(services[name])
        new = dict(proposed["services"][name])
        if name in ("backend", "frontend"):
            old.pop("image", None)
            new.pop("image", None)
        if old != new:
            raise RuntimeError(f"Deployment overlay changed {name} settings beyond image")


def db_identity() -> dict:
    db = docker_inspect("demanage-db")
    volumes = [
        (mount.get("Name"), mount.get("Destination"))
        for mount in db["Mounts"] if mount.get("Type") == "volume"
    ]
    if ("demanage_pgdata", "/var/lib/postgresql") not in volumes:
        raise RuntimeError("Unexpected PostgreSQL volume mount: refusing deploy")
    if db["State"].get("Health", {}).get("Status") != "healthy":
        raise RuntimeError("PostgreSQL is not healthy")
    return {"id": db["Id"], "image": db["Image"], "volumes": sorted(volumes)}


def running_images() -> dict:
    return {
        service: docker_inspect(f"demanage-{service}")["Image"]
        for service in ("backend", "frontend")
    }


def healthy(config: dict, image_ids: dict | None = None) -> bool:
    try:
        backend = docker_inspect("demanage-backend")
        frontend = docker_inspect("demanage-frontend")
        if backend["State"].get("Health", {}).get("Status") != "healthy":
            return False
        if not frontend["State"].get("Running"):
            return False
        if image_ids and any(
            obj["Image"] != image_ids[name]
            for name, obj in (("backend", backend), ("frontend", frontend))
        ):
            return False
        request = urllib.request.Request(
            config["public_health_url"],
            headers={"Cache-Control": "no-cache", "User-Agent": "demanage-cd/1"},
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            if response.status != 200:
                return False
            body = json.loads(response.read(4096))
        return body.get("status") == "ok" and body.get("service") == "demanage-backend"
    except Exception:
        return False


def wait_healthy(config: dict, image_ids: dict, timeout: int = 150) -> bool:
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        if healthy(config, image_ids):
            return True
        time.sleep(5)
    return False


def backup_database(config: dict, commit: str) -> tuple[str, str]:
    root = Path(config["backup_root"])
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not root.is_dir() or (root.stat().st_mode & 0o077) != 0:
        raise RuntimeError("Backup root is not private (0700)")
    free = shutil.disk_usage(root).free
    if free < 2 * 1024**3:
        raise RuntimeError("Under 2 GiB free; refusing to deploy")
    folder = root / ("cd-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
                     + "-" + commit[:12])
    folder.mkdir(mode=0o700)
    destination = folder / "demanage.dump"
    temporary = "/tmp/demanage-cd-" + uuid.uuid4().hex + ".dump"
    try:
        invoke([
            "docker", "exec", "demanage-db", "pg_dump", "-U", "demanage",
            "-d", "demanage", "--format=custom", "--no-owner",
            "--no-privileges", "--file=" + temporary,
        ])
        invoke(["docker", "exec", "demanage-db", "pg_restore", "--list", temporary])
        invoke(["docker", "cp", "demanage-db:" + temporary, str(destination)])
    finally:
        invoke(["docker", "exec", "demanage-db", "rm", "-f", temporary], check=False)
    destination.chmod(0o600)
    if destination.stat().st_size < 1024:
        raise RuntimeError("Database backup unexpectedly small")
    sha = hashlib.sha256(destination.read_bytes()).hexdigest()
    atomic_json(folder / "metadata.json", {
        "sha256": sha,
        "size": destination.stat().st_size,
        "source_commit": commit,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return str(destination), sha


def write_overlay(folder: Path, images: dict) -> Path:
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    file = folder / ("image-override-" + uuid.uuid4().hex + ".yml")
    content = (
        "services:\n"
        f"  backend:\n    image: '{images['backend']}'\n"
        f"  frontend:\n    image: '{images['frontend']}'\n"
    )
    file.write_text(content, encoding="utf-8")
    file.chmod(0o600)
    return file


def apply(
    config: dict, images: dict, folder: Path, *, rollback: bool = False
) -> None:
    overlay = write_overlay(folder, images)
    validate_compose(config, overlay, check_runtime=not rollback)
    # NEVER invoke down, up on db/tunnel, --build, prune or volume commands.
    invoke(compose_command(config, overlay) + [
        "up", "--detach", "--no-deps", "--no-build", "--pull", "never", "backend", "frontend"
    ])


def deploy(config: dict, release: dict, state: dict) -> None:
    target = release["source_commit"]
    if release["previous_commit"] != state["source_commit"]:
        raise RuntimeError("Approval previous_commit does not match deployed state")
    if not healthy(config):
        raise RuntimeError("Production is unhealthy before deploy")
    before_db = db_identity()
    previous_images = running_images()
    if previous_images != state["running_image_ids"]:
        raise RuntimeError("Containers changed outside the deploy agent")

    for service in ("backend", "frontend"):
        invoke(["docker", "pull", release[service]])
        arch = invoke([
            "docker", "image", "inspect", "--format", "{{.Architecture}}",
            release[service],
        ])
        if arch != "amd64":
            raise RuntimeError(f"Unexpected architecture for {service}")
    new_images = {
        service: json.loads(invoke(["docker", "image", "inspect", release[service]]))[0]["Id"]
        for service in ("backend", "frontend")
    }
    # The PostgreSQL dump is mandatory before container mutation.
    path, digest = backup_database(config, target)
    print(f"Validated pre-deploy database dump {path}, sha256:{digest}", flush=True)

    tag = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    rollback_refs = {
        service: f"localhost/demanage-rollback/{service}:{tag}"
        for service in ("backend", "frontend")
    }
    for service in ("backend", "frontend"):
        invoke(["docker", "image", "tag", previous_images[service], rollback_refs[service]])

    workdir = Path(config["state_file"]).parent / "overrides"
    try:
        apply(config, {key: release[key] for key in ("backend", "frontend")}, workdir)
        if not wait_healthy(config, new_images):
            raise RuntimeError("New deployment failed health/identity checks")
        if db_identity() != before_db:
            raise RuntimeError("PostgreSQL container/volume/image changed unexpectedly")
        atomic_json(Path(config["state_file"]), {
            "source_commit": target,
            "running_image_ids": new_images,
            "deployed_at": datetime.now(timezone.utc).isoformat(),
            "backup": path,
        })
        print(f"DEPLOYED_AND_VERIFIED {target}", flush=True)
    except Exception:
        print("Deployment failed: attempting application-only rollback", file=sys.stderr)
        try:
            apply(config, rollback_refs, workdir, rollback=True)
            if not wait_healthy(config, previous_images):
                raise RuntimeError("Rollback healthcheck did not pass")
            if db_identity() != before_db:
                raise RuntimeError("DB identity changed during rollback")
            print("Application rollback successful; database/tunnel untouched", file=sys.stderr)
        except Exception:
            print("CRITICAL: application rollback failed; operator action needed", file=sys.stderr)
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--init-current-sha", help="One-time operator-confirmed existing live SHA")
    parser.add_argument("--check", action="store_true", help="Read-only status and validation")
    args = parser.parse_args()
    config = validate_config(load_json(args.config))
    state_path = Path(config["state_file"])
    lock_path = Path(config["lock_file"])
    lock_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with lock_path.open("a+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        validate_compose(config)
        db_identity()
        if args.init_current_sha:
            sha = args.init_current_sha
            if not SHA_RE.fullmatch(sha) or state_path.exists():
                raise RuntimeError("Invalid initial SHA or existing agent state")
            if not healthy(config):
                raise RuntimeError("Existing production is unhealthy; cannot initialize")
            atomic_json(state_path, {
                "source_commit": sha,
                "running_image_ids": running_images(),
                "initialized_at": datetime.now(timezone.utc).isoformat(),
            })
            print(f"Initialized deploy state at existing live commit {sha}")
            return 0
        if not state_path.exists():
            raise RuntimeError("Agent is not initialized; follow the production runbook")
        state = load_json(state_path)
        current = state.get("source_commit")
        if not isinstance(current, str) or not SHA_RE.fullmatch(current):
            raise RuntimeError("Corrupt saved deployment state")
        release = fetch_approval()
        if release is None:
            print("No approved production release has been published")
            return 0
        if release["source_commit"] == current:
            print("Already at approved version", current)
            return 0
        if args.check:
            print("Pending approved release:", release["source_commit"])
            print("Current:", current)
            print("Safe previous-commit link:", release["previous_commit"] == current)
            return 0
        deploy(config, release, state)
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"BLOCKED: {error}", file=sys.stderr)
        sys.exit(1)
