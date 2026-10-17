"""Create a private, read-only production migration rehearsal proof.

Run on Debian as the existing deManage deploy operator. Only reads the live DB
(pg_dump) and uses a new isolated network + disposable PG container.
Never runs migration commands against production.
"""

from __future__ import annotations

import argparse
import re
import secrets
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from demanage_cd.backup import backup_database
from demanage_cd.deploy import db_identity, healthy, running_images, Context
from demanage_cd.docker import image_inspect, image_revision
from demanage_cd.manifest import SHA_RE, validate_config, load_json
from demanage_cd.runner import SubprocessRunner
from demanage_cd.state import atomic_json, journal_path, load_state

REF = re.compile(r"^ghcr\.io/bielxdh3/demanage-backend@sha256:[0-9a-f]{64}$")
POSTGRES_IMAGE = (
    "postgres:18.6-alpine3.24@sha256:"
    "77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873"
)


def run(*arguments: str) -> str:
    result = subprocess.run(arguments, capture_output=True, text=True, check=False, timeout=300)
    if result.returncode != 0:
        # The arguments may contain ephemeral PG credentials. Never include them,
        # stdout or stderr in exceptions or diagnostics.
        raise RuntimeError("Isolated migration tooling failed (redacted command, nonzero exit)")
    return result.stdout.strip()


def rehearse(config_file: Path, target: str, backend_ref: str) -> Path:
    if not SHA_RE.fullmatch(target) or not REF.fullmatch(backend_ref):
        raise RuntimeError("Invalid migration target or immutable backend reference")
    config = validate_config(load_json(config_file))
    runner = SubprocessRunner()
    ctx = Context(config=config, runner=runner)
    state = load_state(ctx.state_file)
    if journal_path(config).exists():
        raise RuntimeError("Previous release is interrupted; no rehearsal permitted")
    if not healthy(ctx) or running_images(runner) != state["running_image_ids"]:
        raise RuntimeError("Production state or health did not match before rehearsal")
    db_identity(runner)
    run("docker", "pull", backend_ref)
    metadata = image_inspect(runner, backend_ref)
    if image_revision(metadata) != target or metadata["Architecture"] != "amd64":
        raise RuntimeError("Backend image does not match reviewed commit or architecture")

    # Consistent PostgreSQL snapshot. Existing production container is read-only
    # from this process; never exec SQL schema changes into demanage-db.
    dump, checksum = backup_database(runner, config, target)
    current_db_count = int(run(
        "docker", "exec", "demanage-db", "psql", "-U", "demanage", "-d", "demanage",
        "-At", "-c", "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL",
    ))
    suffix = uuid.uuid4().hex
    network = "demanage-ci-rehearsal-" + suffix
    container = "demanage-ci-rehearsal-db-" + suffix
    secret = secrets.token_hex(28)
    created_network = False
    created_container = False
    try:
        run("docker", "network", "create", "--internal", network)
        created_network = True
        run(
            "docker", "run", "-d", "--rm", "--name", container,
            "--network", network, "-e", "POSTGRES_USER=demanage",
            "-e", "POSTGRES_PASSWORD=" + secret, "-e", "POSTGRES_DB=demanage",
            POSTGRES_IMAGE,
        )
        created_container = True
        for _ in range(45):
            ready = subprocess.run(
                ["docker", "exec", container, "pg_isready", "-U", "demanage", "-d", "demanage"],
                capture_output=True, timeout=10,
            )
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Disposable PostgreSQL did not become ready")
        run("docker", "cp", dump, container + ":/tmp/production.dump")
        run("docker", "exec", container, "pg_restore", "--list", "/tmp/production.dump")
        run(
            "docker", "exec", container, "pg_restore", "-U", "demanage", "-d", "demanage",
            "--no-owner", "--no-privileges", "/tmp/production.dump",
        )
        restored_count = int(run(
            "docker", "exec", container, "psql", "-U", "demanage", "-d", "demanage",
            "-At", "-c", "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL",
        ))
        if restored_count != current_db_count:
            raise RuntimeError("Restored migration count does not match production snapshot")
        run(
            "docker", "run", "--rm", "--network", network,
            "--security-opt", "no-new-privileges:true",
            "-e", "DATABASE_URL=postgresql://demanage:" + secret + "@"
            + container + ":5432/demanage?schema=public",
            "--entrypoint", "./node_modules/.bin/prisma",
            backend_ref, "migrate", "deploy",
        )
        after_count = int(run(
            "docker", "exec", container, "psql", "-U", "demanage", "-d", "demanage",
            "-At", "-c", "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL",
        ))
        if after_count < restored_count:
            raise RuntimeError("Migration count decreased unexpectedly")
        proof = {
            "version": 1,
            "source_commit": target,
            "previous_commit": state["source_commit"],
            "backend_ref": backend_ref,
            "backup_path": dump,
            "backup_sha256": checksum,
            "migration_count_before": restored_count,
            "migration_count_after": after_count,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
        proof_path = Path(dump).parent / "local-migration-rehearsal.json"
        atomic_json(proof_path, proof)
        return proof_path
    finally:
        if created_container:
            subprocess.run(["docker", "rm", "-f", container], capture_output=True, timeout=30)
        if created_network:
            subprocess.run(["docker", "network", "rm", network], capture_output=True, timeout=30)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--backend-ref", required=True)
    args = parser.parse_args()
    result = rehearse(args.config, args.source_commit, args.backend_ref)
    print("REHEARSAL_PROOF_FILE=" + str(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
