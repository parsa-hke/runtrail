"""Capture git state at run start.

Returns a dict with commit, branch, dirty flag, and remote URL.
Saves git_diff.patch to the run directory when the tree is dirty.
Never raises — returns partial data on any failure.
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


def capture(run_dir: Path) -> dict[str, Any]:
    """Return git metadata for the current working directory.

    Side-effect: writes ``git_diff.patch`` to *run_dir* when dirty.
    """
    result: dict[str, Any] = {
        "commit": None,
        "branch": None,
        "dirty": False,
        "remote_url": None,
    }

    try:
        result["commit"] = _git("rev-parse", "HEAD")
    except Exception:
        # Not a git repo or git not installed — return empty.
        log.debug("git: not a repo or git unavailable")
        return result

    try:
        result["branch"] = _git("rev-parse", "--abbrev-ref", "HEAD")
    except Exception:
        pass

    try:
        status = _git("status", "--porcelain")
        result["dirty"] = bool(status.strip())
    except Exception:
        pass

    if result["dirty"]:
        try:
            diff = _git_bytes("diff", "HEAD")
            if diff:
                patch_path = run_dir / "git_diff.patch"
                patch_path.parent.mkdir(parents=True, exist_ok=True)
                patch_path.write_bytes(diff)
        except Exception as exc:
            log.debug("git: could not save diff: %s", exc)

    try:
        result["remote_url"] = _git("remote", "get-url", "origin")
    except Exception:
        pass

    return result


def _git(*args: str) -> str:
    out = subprocess.check_output(
        ["git", *args],
        stderr=subprocess.DEVNULL,
        timeout=10,
    )
    return out.decode().strip()


def _git_bytes(*args: str) -> bytes:
    return subprocess.check_output(
        ["git", *args],
        stderr=subprocess.DEVNULL,
        timeout=30,
    )
