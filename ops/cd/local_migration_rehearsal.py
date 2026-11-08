"""Create a private, read-only production migration rehearsal proof.

Run on Debian as the existing deManage deploy operator. Only reads the live DB
(pg_dump) and uses a new isolated network + disposable PG container.
Never runs migration commands against production.
"""

from __future__ import annotations

import argparse
import hashlib
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



PREVIOUS_COMMIT = "15237faaf0bbd380d27494a1bfd87993ca8e28ca"
REVIEWED_TARGET_COMMIT = "13f860b851d1e2a8ae8789bfe2aeb99909d73be4"
REVIEWED_OLD_BACKEND = (
    "sha256:91752c666ecfaf087147855fa47fe1240bb9320f1d67f9cd0e04d24c595b628e"
)
REVIEWED_NEW_BACKEND = (
    "ghcr.io/bielxdh3/demanage-backend@sha256:"
    "94a18c18b5aec3c58a254bd3092f1cef8fbc58eea7164f58e3ec89ace3ab55dd"
)

# Run inside the disposable backend only; no authentication data is logged.
# An isolated test account exercises both auth and financial read/write access.
OLD_NEW_HTTP_PROBE = r"""
const assert = require('node:assert/strict');
const root = 'http://127.0.0.1:8888';
let cookie = '';
async function request(path, method='GET', body) {
  const headers = {origin: 'https://demanage.biel.dev.br'};
  if (body) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const response = await fetch(root+path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw Error('Compatibility HTTP status: '+path+' '+response.status);
  if (response.headers.get('set-cookie')) {
    cookie = response.headers.get('set-cookie').split(';')[0];
  }
  return response;
}
(async () => {
  const email = process.env.COMPAT_TEST_EMAIL;
  const password = process.env.COMPAT_TEST_PASSWORD;
  if (process.env.COMPAT_MODE === 'previous') {
    assert.equal((await request('/auth/register','POST',{
      name:'Isolated Compatibility Test',email,password
    })).status,201);
  } else {
    assert.equal((await request('/auth/login','POST',{email,password})).status,200);
  }
  for(const path of ['/auth/me','/expenses','/entries','/piggy-banks','/cards']) {
    assert.equal((await request(path)).status,200);
  }
  if (process.env.COMPAT_MODE === 'previous') {
    assert.equal((await request('/piggy-banks','POST',{
      name:'Isolated Finance Test', goalAmount:100
    })).status,201);
  }
  assert.equal((await request('/piggy-banks')).status,200);
  console.log('ISOLATED_COMPATIBILITY_PASS');
})().catch(e=>{console.error(e.message);process.exit(1)});
"""


def prove_rollback_compatibility(
    network: str, uri: str, previous: str, current: str,
) -> None:
    """Exercise both immutable app versions against only the migrated clone."""
    app = "demanage-issue122-rollback-" + uuid.uuid4().hex
    token = secrets.token_hex(36)
    email = "compat-" + uuid.uuid4().hex + "@example.invalid"
    password = "Compatibility2026!Strong"
    try:
        for mode, image in (("previous", previous), ("candidate", current)):
            run(
                "docker", "run", "-d", "--rm", "--name", app,
                "--network", network, "--read-only",
                "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
                "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
                "-e", "DATABASE_URL=" + uri, "-e", "JWT_SECRET=" + token,
                "-e", "JWT_EXPIRES_IN=7d", "-e", "NODE_ENV=production",
                "-e", "API_PORT=8888",
                "-e", "APP_URL=https://demanage.biel.dev.br",
                "-e", "COMPAT_MODE=" + mode,
                "-e", "COMPAT_TEST_EMAIL=" + email,
                "-e", "COMPAT_TEST_PASSWORD=" + password, image,
            )
            for _ in range(70):
                check = subprocess.run([
                    "docker", "exec", app, "node", "-e",
                    "fetch('http://127.0.0.1:8888/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
                ], capture_output=True, timeout=10)
                if check.returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError("Disposable candidate/previous API did not become healthy")
            run("docker", "exec", app, "node", "-e", OLD_NEW_HTTP_PROBE)
            run("docker", "rm", "-f", app)
    finally:
        subprocess.run(["docker", "rm", "-f", app], capture_output=True, timeout=30)


def run(*arguments: str) -> str:
    result = subprocess.run(arguments, capture_output=True, text=True, check=False, timeout=300)
    if result.returncode != 0:
        # The arguments may contain ephemeral PG credentials. Never include them,
        # stdout or stderr in exceptions or diagnostics.
        raise RuntimeError("Isolated migration tooling failed (redacted command, nonzero exit)")
    return result.stdout.strip()


def rehearse(config_file: Path, target: str, backend_ref: str, previous_backend: str | None = None) -> Path:
    if not SHA_RE.fullmatch(target) or not REF.fullmatch(backend_ref):
        raise RuntimeError("Invalid migration target or immutable backend reference")
    if previous_backend is not None and (
        target != REVIEWED_TARGET_COMMIT
        or backend_ref != REVIEWED_NEW_BACKEND
        or previous_backend != REVIEWED_OLD_BACKEND
    ):
        raise RuntimeError("Rollback proof is restricted to the exact Issue122 image and release")
    config = validate_config(load_json(config_file))
    runner = SubprocessRunner()
    ctx = Context(config=config, runner=runner)
    state = load_state(ctx.state_file)
    if previous_backend is not None and state["source_commit"] != PREVIOUS_COMMIT:
        raise RuntimeError("Live release is not the reviewed previous version")
    if journal_path(config).exists():
        raise RuntimeError("Previous release is interrupted; no rehearsal permitted")
    if not healthy(ctx) or running_images(runner) != state["running_image_ids"]:
        raise RuntimeError("Production state or health did not match before rehearsal")
    db_identity(runner)
    if previous_backend is not None:
        if image_revision(image_inspect(runner, previous_backend)) != PREVIOUS_COMMIT:
            raise RuntimeError("Previous backend image identity differs")
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
        if previous_backend is not None:
            if (restored_count, after_count) != (37, 38):
                raise RuntimeError("Expected exactly one reviewed migration in disposable database")
            prove_rollback_compatibility(
                network, "postgresql://demanage:" + secret + "@"
                + container + ":5432/demanage?schema=public",
                previous_backend, backend_ref,
            )
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
        if previous_backend is not None:
            rollback_proof = {
                "version": 1,
                "source_commit": target,
                "previous_commit": state["source_commit"],
                "previous_backend_image": previous_backend,
                "backend_ref": backend_ref,
                "backup_sha256": checksum,
                "migration_rehearsal_sha256": hashlib.sha256(
                    proof_path.read_bytes()
                ).hexdigest(),
                "old_and_new_http_probes": "passed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
            atomic_json(proof_path.parent / "issue122-rollback-proof.json", rollback_proof)
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
    parser.add_argument(
        "--previous-backend", help="Issue122 exact previous immutable image; enables isolated rollback HTTP proof"
    )
    args = parser.parse_args()
    result = rehearse(args.config, args.source_commit, args.backend_ref, args.previous_backend)
    print("REHEARSAL_PROOF_FILE=" + str(result))
    if args.previous_backend is not None:
        print("ROLLBACK_PROOF_FILE=" + str(result.parent / "issue122-rollback-proof.json"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
