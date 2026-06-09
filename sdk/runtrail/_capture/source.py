"""Capture source snapshot: find .py files belonging to the current project.

Walks sys.modules to find files under the project root directory.
Returns a list of (abs_path, rel_path) tuples for Store.snapshot_source().
Never raises — returns empty list on any failure.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

_MAX_FILES = 500
_MAX_FILE_BYTES = 1 * 1024 * 1024  # 1 MiB per file


def capture(root: Path | None = None) -> list[tuple[Path, str]]:
    """Return [(abs_path, rel_path), ...] for .py files under *root*.

    *root* defaults to the current working directory.
    """
    if root is None:
        root = Path.cwd()
    root = root.resolve()

    try:
        return _collect(root)
    except Exception as exc:
        log.debug("source: capture failed: %s", exc)
        return []


def _collect(root: Path) -> list[tuple[Path, str]]:
    seen: set[Path] = set()
    result: list[tuple[Path, str]] = []

    # 1. Modules already imported (fast path — covers the entrypoint and its imports)
    for mod in list(sys.modules.values()):
        try:
            spec = getattr(mod, "__spec__", None)
            if spec is None:
                continue
            origin = getattr(spec, "origin", None)
            if origin is None or not origin.endswith(".py"):
                continue
            p = Path(origin).resolve()
            if p in seen:
                continue
            if _is_under(p, root) and p.stat().st_size <= _MAX_FILE_BYTES:
                seen.add(p)
                result.append((p, str(p.relative_to(root))))
                if len(result) >= _MAX_FILES:
                    break
        except Exception:
            continue

    # 2. Filesystem walk to pick up files not yet imported (e.g. configs, data scripts)
    if len(result) < _MAX_FILES:
        for p in sorted(root.rglob("*.py")):
            if p in seen:
                continue
            if _should_skip(p, root):
                continue
            try:
                if p.stat().st_size > _MAX_FILE_BYTES:
                    continue
                seen.add(p)
                result.append((p, str(p.relative_to(root))))
                if len(result) >= _MAX_FILES:
                    break
            except Exception:
                continue

    return result


def _is_under(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


_SKIP_DIRS = {
    ".git", "__pycache__", ".venv", "venv", "env", ".env",
    "node_modules", "dist", "build", ".mypy_cache", ".pytest_cache",
    ".ruff_cache", "*.egg-info",
}


def _should_skip(p: Path, root: Path) -> bool:
    try:
        parts = p.relative_to(root).parts
    except ValueError:
        return True
    for part in parts[:-1]:  # all directory components
        if part in _SKIP_DIRS or part.endswith(".egg-info"):
            return True
    return False
