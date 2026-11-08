"""Two-phase, exact Issue122 live schema migration (no application rollout).

PREPARE takes a consistent production pg_dump and records preflight evidence.
APPLY requires the exact reviewed preflight SHA and applies the single pinned
migration using the immutable backend Prisma CLI. The separate protected
production workflow remains solely responsible for deployment.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from demanage_cd.backup import backup_database
from demanage_cd.deploy import Context, db_identity, healthy, running_images
from demanage_cd.docker import image_inspect, image_revision
from demanage_cd.manifest import validate_config, load_json
from demanage_cd.runner import SubprocessRunner
from demanage_cd.state import atomic_json, journal_path, load_state

PREVIOUS = "15237faaf0bbd380d27494a1bfd87993ca8e28ca"
TARGET = "13f860b851d1e2a8ae8789bfe2aeb99909d73be4"
BACKEND = (
    "ghcr.io/bielxdh3/demanage-backend@sha256:"
    "94a18c18b5aec3c58a254bd3092f1cef8fbc58eea7164f58e3ec89ace3ab55dd"
)
MIGRATION = "20261105183000_trusted_login_device"
REHEARSAL_SHA = "26845259b842d489c4fb7d94d37aed3298097cdaede64526d2637fd574497de1"
ROLLBACK_SHA = "a40e7367685850c2e1f5cd8ef2682e04d15b687a00d2f0e2894f9ed0af80dc9a"
PREVIOUS_BACKEND = "sha256:91752c666ecfaf087147855fa47fe1240bb9320f1d67f9cd0e04d24c595b628e"
SHA256 = re.compile(r"^[a-f0-9]{64}$")


def safe_command(args: list[str], *, timeout: int = 300) -> str:
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        # Never print commands or Docker/pnpm outputs that could expose secrets.
        raise RuntimeError("Reviewed production migration command returned nonzero")
    return result.stdout.strip()


def read_file(path: Path, root: Path, name: str) -> tuple[dict, str]:
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(root) or resolved.name != name or resolved.is_symlink():
        raise RuntimeError("Invalid private proof location")
    raw = resolved.read_bytes()
    return json.loads(raw), hashlib.sha256(raw).hexdigest()


def status(config_file: Path) -> tuple[dict, Context]:
    cfg = validate_config(load_json(config_file))
    ctx = Context(config=cfg, runner=SubprocessRunner())
    state = load_state(ctx.state_file)
    if state["source_commit"] != PREVIOUS or journal_path(cfg).exists():
        raise RuntimeError("Production release state changed or journal pending")
    if running_images(ctx.runner) != state["running_image_ids"] or not healthy(ctx):
        raise RuntimeError("Production containers no longer match healthy snapshot")
    db_identity(ctx.runner)
    if image_revision(image_inspect(ctx.runner, BACKEND)) != TARGET:
        raise RuntimeError("Candidate registry image does not match pinned revision")
    if image_revision(image_inspect(ctx.runner, PREVIOUS_BACKEND)) != PREVIOUS:
        raise RuntimeError("Running previous image does not match pinned revision")
    return cfg, ctx


def db_summary() -> dict:
    # Only aggregate counts leave the DB; no financial contents are printed.
    sql = (
        "SELECT json_build_object("
        "'User',(SELECT count(*) FROM \"User\"),"
        "'Expense',(SELECT count(*) FROM \"Expense\"),"
        "'Entry',(SELECT count(*) FROM \"Entry\"),"
        "'PiggyBank',(SELECT count(*) FROM \"PiggyBank\"),"
        "'PiggyTransaction',(SELECT count(*) FROM \"PiggyTransaction\"),"
        "'migrated',(SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL),"
        "'target',(SELECT count(*) FROM _prisma_migrations "
        "WHERE migration_name = '"+MIGRATION+"' AND finished_at IS NOT NULL)"
        ")::text"
    )
    result = safe_command([
        "docker", "exec", "demanage-db", "psql", "-U", "demanage",
        "-d", "demanage", "-At", "-c", sql,
    ])
    return json.loads(result)


def check_readiness(root: Path) -> None:
    rehearsal, rehearsal_hash = read_file(
        root / "cd-20261108T224759Z-13f860b851d1/local-migration-rehearsal.json",
        root, "local-migration-rehearsal.json",
    )
    rollback, rollback_hash = read_file(
        root / "cd-20261108T224759Z-13f860b851d1/issue122-rollback-proof.json",
        root, "issue122-rollback-proof.json",
    )
    if rehearsal_hash != REHEARSAL_SHA or rollback_hash != ROLLBACK_SHA:
        raise RuntimeError("Reviewed independent rehearsal/rollback hashes changed")
    if (
        rehearsal["source_commit"] != TARGET
        or rehearsal["previous_commit"] != PREVIOUS
        or rehearsal["backend_ref"] != BACKEND
        or rollback["source_commit"] != TARGET
        or rollback["previous_commit"] != PREVIOUS
        or rollback["backend_ref"] != BACKEND
        or rollback["old_and_new_http_probes"] != "passed"
        or rollback["migration_rehearsal_sha256"] != REHEARSAL_SHA
        or rollback["backup_sha256"] != rehearsal["backup_sha256"]
    ):
        raise RuntimeError("Independent release proofs do not match")
    completed = datetime.fromisoformat(rollback["completed_at"])
    if completed.tzinfo is None or not timedelta(0) <= datetime.now(timezone.utc) - completed <= timedelta(hours=48):
        raise RuntimeError("Rollback proof is stale")


def prepare(config_file: Path) -> Path:
    config, ctx = status(config_file)
    root = Path(config["backup_root"]).resolve(strict=True)
    check_readiness(root)
    before = db_summary()
    if before["migrated"] != 37 or before["target"] != 0:
        raise RuntimeError("Live DB does not have precisely the reviewed pre-migration state")
    dump, sha = backup_database(ctx.runner, config, TARGET)
    if hashlib.sha256(Path(dump).read_bytes()).hexdigest() != sha:
        raise RuntimeError("Fresh production backup checksum mismatch")
    receipt = {
        "version": 1, "previous_commit": PREVIOUS, "source_commit": TARGET,
        "backend_ref": BACKEND, "backup_path": dump, "backup_sha256": sha,
        "migration_rehearsal_sha256": REHEARSAL_SHA,
        "rollback_proof_sha256": ROLLBACK_SHA,
        "before": before, "prepared_at": datetime.now(timezone.utc).isoformat(),
    }
    dest = Path(dump).parent / "issue122-live-preflight.json"
    atomic_json(dest, receipt)
    return dest


def apply(config_file: Path, preflight_file: Path, confirmed_sha: str) -> Path:
    config, ctx = status(config_file)
    root = Path(config["backup_root"]).resolve(strict=True)
    check_readiness(root)
    receipt, _ = read_file(preflight_file, root, "issue122-live-preflight.json")
    if (
        receipt.get("version") != 1
        or receipt.get("previous_commit") != PREVIOUS
        or receipt.get("source_commit") != TARGET
        or receipt.get("backend_ref") != BACKEND
        or receipt.get("migration_rehearsal_sha256") != REHEARSAL_SHA
        or receipt.get("rollback_proof_sha256") != ROLLBACK_SHA
    ):
        raise RuntimeError("Unexpected live preflight receipt")
    timepoint = datetime.fromisoformat(receipt["prepared_at"])
    if timepoint.tzinfo is None or not timedelta(0) <= datetime.now(timezone.utc) - timepoint <= timedelta(minutes=20):
        raise RuntimeError("Live preflight receipt expired")
    dump = Path(receipt["backup_path"]).resolve(strict=True)
    if dump != preflight_file.resolve(strict=True).parent / "demanage.dump":
        raise RuntimeError("Preflight production dump does not belong to proof directory")
    if not SHA256.fullmatch(confirmed_sha) or confirmed_sha != receipt["backup_sha256"]:
        raise RuntimeError("Explicit backup hash confirmation required")
    if hashlib.sha256(dump.read_bytes()).hexdigest() != confirmed_sha:
        raise RuntimeError("Backup changed since review")
    if db_summary() != receipt["before"]:
        raise RuntimeError("Finance row counts or migration state changed since preflight")

    # Only Prisma CLI. The network namespace is the existing PostgreSQL
    # container (no published ports or separate connection to the public app).
    # Password is read by Docker from the existing 0600 private env file.
    shell = (
        ': "${POSTGRES_PASSWORD:?Missing production DB credential}"; '
        "export DATABASE_URL=$(node -e "
        "'process.stdout.write(\"postgresql://demanage:\" + "
        "encodeURIComponent(process.env.POSTGRES_PASSWORD) + "
        "\"@127.0.0.1:5432/demanage?schema=public\")'); "
        "exec ./node_modules/.bin/prisma migrate deploy"
    )
    safe_command([
        "docker", "run", "--rm", "--network", "container:demanage-db",
        "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m", "--env-file",
        str(config["env_file"]), "--entrypoint", "/bin/sh", BACKEND, "-ec", shell,
    ])
    after = db_summary()
    before = receipt["before"]
    for name in ("User", "Expense", "Entry", "PiggyBank", "PiggyTransaction"):
        if after[name] != before[name]:
            raise RuntimeError("Finance table changed during live migration")
    if after["migrated"] != 38 or after["target"] != 1:
        raise RuntimeError("Exact Issue122 migration was not confirmed")
    status(config_file)
    result = {
        "version": 1, "previous_commit": PREVIOUS, "source_commit": TARGET,
        "backend_ref": BACKEND, "backup_sha256": confirmed_sha,
        "migration_rehearsal_sha256": REHEARSAL_SHA,
        "rollback_proof_sha256": ROLLBACK_SHA,
        "before": before, "after": after,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    dest = preflight_file.resolve(strict=True).parent / "issue122-live-migration-proof.json"
    atomic_json(dest, result)
    return dest


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--config", type=Path, required=True)
    p.add_argument("--prepare", action="store_true")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--preflight", type=Path)
    p.add_argument("--confirm-backup-sha256")
    args = p.parse_args()
    if args.prepare == args.apply:
        p.error("Specify exactly one of --prepare/--apply")
    try:
        if args.prepare:
            path = prepare(args.config)
            print("PREFLIGHT_FILE=" + str(path))
        else:
            if not args.preflight or not args.confirm_backup_sha256:
                raise RuntimeError("Preflight and confirmed hash required")
            path = apply(args.config, args.preflight, args.confirm_backup_sha256)
            print("LIVE_MIGRATION_PROOF_FILE=" + str(path))
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.TimeoutExpired) as error:
        print("BLOCKED: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
