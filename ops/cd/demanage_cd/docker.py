"""Docker inspection helpers. Every call goes through the injected runner."""

from __future__ import annotations

import json
from typing import Any

from .manifest import REVISION_LABEL
from .runner import Runner


def inspect_one(runner: Runner, ref: str) -> dict[str, Any]:
    result = json.loads(runner.run(["docker", "inspect", ref]))
    if not isinstance(result, list) or len(result) != 1:
        raise RuntimeError("Expected exactly one Docker object")
    return result[0]


def image_inspect(runner: Runner, ref: str) -> dict[str, Any]:
    result = json.loads(runner.run(["docker", "image", "inspect", ref]))
    if not isinstance(result, list) or len(result) != 1:
        raise RuntimeError("Expected exactly one Docker image")
    return result[0]


def image_revision(image: dict[str, Any]) -> str | None:
    labels = (image.get("Config") or {}).get("Labels") or {}
    return labels.get(REVISION_LABEL)


def pull(runner: Runner, ref: str) -> None:
    runner.run(["docker", "pull", ref])


def tag(runner: Runner, source: str, target: str) -> None:
    runner.run(["docker", "image", "tag", source, target])
