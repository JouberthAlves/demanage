"""Command-line flow: argument parsing, the single-run lock and the top-level sequence."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from pathlib import Path

from .compose import validate_compose
from .deploy import Context, db_identity, deploy, initialize, reconcile
from .manifest import load_json, validate_config
from .runner import SubprocessRunner
from .state import load_state, read_journal


@contextmanager
def exclusive_lock(path: Path) -> Iterator[None]:
    # fcntl is POSIX-only. Importing it here keeps the package importable and
    # testable on other platforms; the lock itself is only taken on POSIX hosts.
    import fcntl

    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("a+") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("another deploy agent run holds the lock") from error
        yield


def run_agent(
    ctx: Context, *, init_sha: str | None = None, check: bool = False
) -> int:
    with exclusive_lock(Path(ctx.config["lock_file"])):
        validate_compose(ctx.runner, ctx.config)
        db_identity(ctx.runner)
        if init_sha:
            initialize(ctx, init_sha)
            return 0
        if not ctx.state_file.exists():
            raise RuntimeError("Agent is not initialized; follow the production runbook")
        state = load_state(ctx.state_file)
        if check:
            release = ctx.fetch()
            journal = read_journal(ctx.journal)
            print("Journal present (interrupted run):", journal is not None)
            if release is None:
                print("No approved production release has been published")
                return 0
            print("Pending approved release:", release["source_commit"])
            print("Current:", state["source_commit"])
            print("Safe previous-commit link:", release["previous_commit"] == state["source_commit"])
            return 0
        journal = read_journal(ctx.journal)
        if journal is not None:
            state = reconcile(ctx, state, journal)
        release = ctx.fetch()
        if release is None:
            print("No approved production release has been published")
            return 0
        if release["source_commit"] == state["source_commit"]:
            print("Already at approved version", state["source_commit"])
            return 0
        deploy(ctx, release, state)
        return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="deploy_agent.py")
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument(
        "--init-current-sha",
        dest="init_sha",
        help="One-time operator-confirmed live commit; its image revision labels must match",
    )
    parser.add_argument("--check", action="store_true", help="Read-only status and validation")
    return parser


def main(argv: Sequence[str] | None = None, ctx: Context | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if ctx is None:
            config = validate_config(load_json(args.config))
            ctx = Context(config=config, runner=SubprocessRunner())
        return run_agent(ctx, init_sha=args.init_sha, check=args.check)
    except Exception as error:  # noqa: BLE001 - the agent must exit non-zero with a clear reason
        print(f"BLOCKED: {error}", file=sys.stderr, flush=True)
        return 1
