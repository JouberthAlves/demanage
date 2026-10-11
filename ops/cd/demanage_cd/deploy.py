"""Deploy, rollback and journal reconciliation.

Order of operations for a release (each step can stop the deploy):
  1. preflight: healthy, database identity unchanged, state matches containers
  2. pull both images by digest; check architecture and the revision label
  3. PostgreSQL dump (mandatory)
  4. write the intent journal (BEFORE any container is changed)
  5. apply image-only overlay, verify health and identity
  6. write the deploy state, then remove the journal
On failure: application-only rollback to the previous images. If that fails the
journal is kept with phase "rollback-failed" and every later run refuses to act.
"""

from __future__ import annotations

import json
import time
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .backup import backup_database
from .compose import apply_overlay
from .docker import image_inspect, image_revision, inspect_one, pull, tag
from .manifest import SERVICES, SHA_RE, fetch_approval
from .runner import Runner, log
from .state import (
    APPLYING,
    ROLLBACK_FAILED,
    clear_journal,
    journal_path,
    write_journal,
    write_state,
)

HEALTH_TIMEOUT_SECONDS = 150


def http_health_probe(url: str) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"Cache-Control": "no-cache", "User-Agent": "demanage-cd/1"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status != 200:
            raise RuntimeError(f"Public health check returned HTTP {response.status}")
        body = json.loads(response.read(4096))
    if not isinstance(body, dict):
        raise RuntimeError("Public health check did not return a JSON object")
    return body


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Context:
    """Everything the deploy needs from the outside world; replaceable in tests."""

    config: dict[str, Any]
    runner: Runner
    probe: Callable[[str], dict[str, Any]] = http_health_probe
    backup: Callable[..., tuple[str, str]] = backup_database
    sleep: Callable[[float], None] = time.sleep
    monotonic: Callable[[], float] = time.monotonic
    clock: Callable[[], datetime] = _utc_now
    health_timeout: float = HEALTH_TIMEOUT_SECONDS
    fetch: Callable[[], dict[str, Any] | None] = fetch_approval

    @property
    def state_file(self) -> Path:
        return Path(self.config["state_file"])

    @property
    def journal(self) -> Path:
        return journal_path(self.config)

    @property
    def workdir(self) -> Path:
        return self.state_file.parent / "overrides"


def running_images(runner: Runner) -> dict[str, str]:
    return {
        service: inspect_one(runner, f"demanage-{service}")["Image"]
        for service in SERVICES
    }


def db_identity(runner: Runner) -> dict[str, Any]:
    db = inspect_one(runner, "demanage-db")
    volumes = [
        (mount.get("Name"), mount.get("Destination"))
        for mount in db["Mounts"]
        if mount.get("Type") == "volume"
    ]
    if ("demanage_pgdata", "/var/lib/postgresql") not in volumes:
        raise RuntimeError("Unexpected PostgreSQL volume mount: refusing deploy")
    if db["State"].get("Health", {}).get("Status") != "healthy":
        raise RuntimeError("PostgreSQL is not healthy")
    return {"id": db["Id"], "image": db["Image"], "volumes": sorted(volumes)}


def healthy(ctx: Context, image_ids: dict[str, str] | None = None) -> bool:
    """True only when containers and the public endpoint are healthy.

    Failures are logged (without secrets) so an operator can see why a deploy stalled.
    """
    try:
        backend = inspect_one(ctx.runner, "demanage-backend")
        frontend = inspect_one(ctx.runner, "demanage-frontend")
        if backend["State"].get("Health", {}).get("Status") != "healthy":
            return False
        if not frontend["State"].get("Running"):
            return False
        if image_ids and any(
            obj["Image"] != image_ids[name]
            for name, obj in (("backend", backend), ("frontend", frontend))
        ):
            return False
        body = ctx.probe(ctx.config["public_health_url"])
        return body.get("status") == "ok" and body.get("service") == "demanage-backend"
    except Exception as error:  # noqa: BLE001 - reported below, never silently dropped
        log(f"health check not passing: {type(error).__name__}: {error}")
        return False


def wait_healthy(
    ctx: Context, image_ids: dict[str, str] | None = None, timeout: float | None = None
) -> bool:
    until = ctx.monotonic() + (ctx.health_timeout if timeout is None else timeout)
    while True:
        if healthy(ctx, image_ids):
            return True
        if ctx.monotonic() >= until:
            return False
        ctx.sleep(5)


def verify_release_images(runner: Runner, release: dict[str, Any]) -> dict[str, str]:
    """Pull both images by digest and return their image IDs.

    The revision label must equal the approved commit; this ties the running
    image to the source that CI validated.
    """
    images: dict[str, str] = {}
    for service in SERVICES:
        ref = release[service]
        pull(runner, ref)
        image = image_inspect(runner, ref)
        if image.get("Architecture") != "amd64":
            raise RuntimeError(f"Unexpected architecture for {service}")
        if image_revision(image) != release["source_commit"]:
            raise RuntimeError(
                f"{service} image revision label does not match the approved commit"
            )
        images[service] = image["Id"]
    return images


def deploy(ctx: Context, release: dict[str, Any], state: dict[str, Any]) -> None:
    target = release["source_commit"]
    if release["previous_commit"] != state["source_commit"]:
        raise RuntimeError("Approval previous_commit does not match deployed state")
    if not healthy(ctx):
        raise RuntimeError("Production is unhealthy before deploy")
    before_db = db_identity(ctx.runner)
    previous_images = running_images(ctx.runner)
    if previous_images != state["running_image_ids"]:
        raise RuntimeError("Containers changed outside the deploy agent")

    new_images = verify_release_images(ctx.runner, release)
    # The PostgreSQL dump is mandatory before container mutation.
    backup_path, digest = ctx.backup(ctx.runner, ctx.config, target)
    log(f"validated pre-deploy database dump {backup_path}, sha256:{digest}")

    stamp = ctx.clock().strftime("%Y%m%d%H%M%S")
    rollback_refs = {
        service: f"localhost/demanage-rollback/{service}:{stamp}"
        for service in SERVICES
    }
    for service in SERVICES:
        tag(ctx.runner, previous_images[service], rollback_refs[service])

    # Intent journal first: if the agent dies after this point, the next run
    # reconciles against the containers instead of guessing.
    journal: dict[str, Any] = {
        "phase": APPLYING,
        "target": target,
        "previous": state["source_commit"],
        "previous_images": previous_images,
        "new_images": new_images,
        "rollback_refs": rollback_refs,
        "backup": backup_path,
        "started_at": ctx.clock().isoformat(),
    }
    write_journal(ctx.journal, journal)

    try:
        apply_overlay(
            ctx.runner,
            ctx.config,
            {service: release[service] for service in SERVICES},
            ctx.workdir,
        )
        if not wait_healthy(ctx, new_images):
            raise RuntimeError("New deployment failed health/identity checks")
        if db_identity(ctx.runner) != before_db:
            raise RuntimeError("PostgreSQL container/volume/image changed unexpectedly")
    except Exception:
        log("deployment failed: attempting application-only rollback")
        rollback(ctx, journal, before_db)
        raise

    write_state(ctx.state_file, {
        "source_commit": target,
        "running_image_ids": new_images,
        "deployed_at": ctx.clock().isoformat(),
        "backup": backup_path,
    })
    clear_journal(ctx.journal)
    print(f"DEPLOYED_AND_VERIFIED {target}", flush=True)


def rollback(ctx: Context, journal: dict[str, Any], before_db: dict[str, Any]) -> None:
    """Restore the previous application images. Never touches the database or tunnel."""
    try:
        apply_overlay(
            ctx.runner, ctx.config, journal["rollback_refs"], ctx.workdir, rollback=True
        )
        if not wait_healthy(ctx, journal["previous_images"]):
            raise RuntimeError("rollback healthcheck did not pass")
        if db_identity(ctx.runner) != before_db:
            raise RuntimeError("database identity changed during rollback")
    except Exception as error:  # noqa: BLE001 - recorded in the journal, then re-raised by caller
        journal["phase"] = ROLLBACK_FAILED
        journal["rollback_error"] = type(error).__name__
        write_journal(ctx.journal, journal)
        log("CRITICAL: application rollback failed; journal kept, operator action needed")
        return
    clear_journal(ctx.journal)
    log("application rollback successful; database and tunnel untouched")


def reconcile(ctx: Context, state: dict[str, Any], journal: dict[str, Any]) -> dict[str, Any]:
    """Resolve a journal left by an interrupted run. Returns the current state."""
    if journal["phase"] == ROLLBACK_FAILED:
        raise RuntimeError(
            "previous deployment rollback failed; operator action needed (see deploy journal)"
        )
    running = running_images(ctx.runner)
    if running == journal["new_images"] and wait_healthy(ctx, journal["new_images"]):
        recovered = {
            "source_commit": journal["target"],
            "running_image_ids": journal["new_images"],
            "deployed_at": ctx.clock().isoformat(),
            "backup": journal["backup"],
            "recovered_from_journal": True,
        }
        write_state(ctx.state_file, recovered)
        clear_journal(ctx.journal)
        log(f"recovered interrupted deploy: {journal['target']} is running and healthy")
        return recovered
    if running == journal["previous_images"] and wait_healthy(ctx, journal["previous_images"]):
        clear_journal(ctx.journal)
        log("interrupted deploy left the previous release running; journal cleared")
        return state
    raise RuntimeError(
        "deploy journal present and running containers match neither release; "
        "operator action needed"
    )


def initialize(ctx: Context, sha: str) -> None:
    """One-time: record the operator-confirmed live commit after verifying its image labels."""
    if not SHA_RE.fullmatch(sha):
        raise RuntimeError("Invalid initial SHA")
    if ctx.state_file.exists() or ctx.journal.exists():
        raise RuntimeError("Agent state already exists; refusing to re-initialize")
    if not healthy(ctx):
        raise RuntimeError("Existing production is unhealthy; cannot initialize")
    images = running_images(ctx.runner)
    for service in SERVICES:
        revision = image_revision(image_inspect(ctx.runner, images[service]))
        if revision != sha:
            raise RuntimeError(
                f"{service} image revision label does not match the initial SHA"
            )
    write_state(ctx.state_file, {
        "source_commit": sha,
        "running_image_ids": images,
        "initialized_at": ctx.clock().isoformat(),
    })
    print(f"initialized deploy state at existing live commit {sha}", flush=True)
