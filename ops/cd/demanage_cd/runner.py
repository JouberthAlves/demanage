"""Command execution behind a small interface so deploy logic can run against a fake."""

from __future__ import annotations

import subprocess
import sys
from collections.abc import Sequence
from typing import Protocol


class CommandError(RuntimeError):
    """A command failed. Messages never include command output (it may contain secrets)."""


class Runner(Protocol):
    def run(
        self, args: Sequence[str], *, check: bool = True, timeout: float = 240
    ) -> str:
        """Run a command and return stripped stdout."""


class SubprocessRunner:
    def run(
        self, args: Sequence[str], *, check: bool = True, timeout: float = 240
    ) -> str:
        try:
            completed = subprocess.run(
                list(args),
                text=True,
                capture_output=True,
                check=False,
                timeout=timeout,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise CommandError(
                f"Command {args[0]} could not complete ({type(error).__name__})"
            ) from None
        if check and completed.returncode != 0:
            raise CommandError(
                f"Command {args[0]} failed (exit code {completed.returncode}); "
                "inspect the host privately"
            )
        return completed.stdout.strip()


def log(message: str) -> None:
    print(f"[deploy-agent] {message}", file=sys.stderr, flush=True)
