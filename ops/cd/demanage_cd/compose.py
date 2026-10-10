"""Compose model validation and the image-only overlay.

The agent never runs down, up on the database, --build, prune or volume commands.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from .docker import inspect_one
from .manifest import SERVICES
from .runner import Runner

EXPECTED_CONTAINERS = {
    "db": "demanage-db",
    "backend": "demanage-backend",
    "frontend": "demanage-frontend",
}


def compose_command(config: dict[str, Any], overlay: Path | None = None) -> list[str]:
    parts = [
        "docker",
        "compose",
        "--project-name",
        config["project_name"],
        "--env-file",
        config["env_file"],
    ]
    for file in config["compose_files"]:
        parts.extend(["-f", file])
    if overlay is not None:
        parts.extend(["-f", str(overlay)])
    return parts


def compose_model(
    runner: Runner, config: dict[str, Any], overlay: Path | None = None
) -> dict[str, Any]:
    return json.loads(
        runner.run(compose_command(config, overlay) + ["config", "--format", "json"])
    )


def expected_runtime_networks(model: dict[str, Any], service: dict[str, Any]) -> set[str]:
    attached = service.get("networks", {})
    names = attached if isinstance(attached, list) else attached.keys()
    networks = model.get("networks", {})
    return {networks.get(key, {}).get("name", key) for key in names}


def expected_port_bindings(service: dict[str, Any]) -> list[tuple[str, str, str]]:
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


def actual_port_bindings(container: dict[str, Any]) -> list[tuple[str, str, str]]:
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
    runner: Runner,
    config: dict[str, Any],
    overlay: Path | None = None,
    *,
    check_runtime: bool = True,
) -> None:
    original = compose_model(runner, config)
    services = original.get("services", {})
    if not {"db", "frontend", "backend"}.issubset(services):
        raise RuntimeError("Compose does not contain the expected three services")
    for name, container in EXPECTED_CONTAINERS.items():
        if services[name].get("container_name") != container:
            raise RuntimeError(f"Unexpected container name for {name}")
        if check_runtime:
            _validate_runtime(runner, config, name, container, original, services[name])
    if overlay is None:
        return

    proposed = compose_model(runner, config, overlay)
    if set(proposed["services"]) != set(services):
        raise RuntimeError("Deployment overlay changed the Compose services")
    for name in services:
        old = dict(services[name])
        new = dict(proposed["services"][name])
        if name in SERVICES:
            old.pop("image", None)
            new.pop("image", None)
        if old != new:
            raise RuntimeError(f"Deployment overlay changed {name} settings beyond image")


def _validate_runtime(
    runner: Runner,
    config: dict[str, Any],
    name: str,
    container: str,
    original: dict[str, Any],
    service: dict[str, Any],
) -> None:
    running = runner.run(compose_command(config) + ["ps", "-q", name])
    actual_container = inspect_one(runner, container)
    actual = actual_container["Id"]
    if not running or not actual.startswith(running):
        raise RuntimeError(f"{name} is not managed by the selected Compose project")
    labels = actual_container["Config"].get("Labels") or {}
    if (
        labels.get("com.docker.compose.project") != config["project_name"]
        or labels.get("com.docker.compose.service") != name
    ):
        raise RuntimeError(f"{name} has unexpected Compose ownership labels")
    configured_networks = expected_runtime_networks(original, service)
    actual_networks = set(actual_container["NetworkSettings"]["Networks"])
    if configured_networks != actual_networks:
        raise RuntimeError(f"{name} runtime Docker networks disagree with selected Compose")
    if expected_port_bindings(service) != actual_port_bindings(actual_container):
        raise RuntimeError(f"{name} host port bindings disagree with selected Compose")


def write_overlay(folder: Path, images: dict[str, str]) -> Path:
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


def apply_overlay(
    runner: Runner,
    config: dict[str, Any],
    images: dict[str, str],
    folder: Path,
    *,
    rollback: bool = False,
) -> None:
    overlay = write_overlay(folder, images)
    validate_compose(runner, config, overlay, check_runtime=not rollback)
    # NEVER invoke down, up on db/tunnel, --build, prune or volume commands.
    runner.run(compose_command(config, overlay) + [
        "up", "--detach", "--no-deps", "--no-build", "--pull", "never",
        "backend", "frontend",
    ])
