"""Capture Python environment: version, installed packages, venv/conda info.

Uses ``importlib.metadata`` — no subprocess, no pip invocation.
Never raises.
"""

from __future__ import annotations

import logging
import os
import platform
import sys
from typing import Any

log = logging.getLogger(__name__)


def capture() -> tuple[dict[str, Any], list[tuple[str, str]]]:
    """Return ``(env_dict, packages)`` where *packages* is ``[(name, version), ...]``."""
    env: dict[str, Any] = {
        "python": _python_version(),
        "executable": sys.executable,
        "virtual_env": _venv_name(),
        "conda_env": os.environ.get("CONDA_DEFAULT_ENV"),
        "platform": platform.platform(),
    }

    packages = _installed_packages()

    # Try to pull CUDA version from torch if available (no NVML needed).
    cuda = _cuda_version()
    if cuda:
        env["cuda"] = cuda

    return env, packages


def _python_version() -> str:
    v = sys.version_info
    return f"{v.major}.{v.minor}.{v.micro}"


def _venv_name() -> str | None:
    ve = os.environ.get("VIRTUAL_ENV")
    if ve:
        return os.path.basename(ve)
    # Detect Poetry / Hatch venvs that don't set VIRTUAL_ENV
    if hasattr(sys, "real_prefix"):
        return os.path.basename(sys.prefix)
    if sys.base_prefix != sys.prefix:
        return os.path.basename(sys.prefix)
    return None


def _installed_packages() -> list[tuple[str, str]]:
    try:
        from importlib.metadata import distributions  # Python 3.9+

        pkgs: list[tuple[str, str]] = []
        for dist in distributions():
            name = dist.metadata.get("Name", "")
            version = dist.metadata.get("Version", "")
            if name:
                pkgs.append((name.lower(), version))
        pkgs.sort(key=lambda x: x[0])
        return pkgs
    except Exception as exc:
        log.debug("env: could not list packages: %s", exc)
        return []


def _cuda_version() -> str | None:
    # 1. Try torch (most ML users have it)
    try:
        import torch  # type: ignore[import]
        return torch.version.cuda  # type: ignore[no-any-return]
    except Exception:
        pass
    # 2. Try nvidia-smi via subprocess (expensive, last resort)
    try:
        import subprocess
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"],
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
        return out.decode().strip().splitlines()[0]
    except Exception:
        return None
