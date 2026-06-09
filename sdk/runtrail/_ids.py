"""ID generation and slug utilities."""

from __future__ import annotations

import hashlib
import os
import re
import socket
import time


def generate_run_id(name: str = "") -> str:
    """Return a unique run ID: ``run-<8 hex chars>``.

    The hex suffix is the first 8 chars of SHA-256 over
    (name + epoch_ns + pid + hostname).  On collision the caller
    should regenerate with a different name/timestamp.
    """
    raw = f"{name}{time.time_ns()}{os.getpid()}{_hostname()}".encode()
    digest = hashlib.sha256(raw).hexdigest()
    return f"run-{digest[:8]}"


def slugify(name: str, max_len: int = 64) -> str:
    """Convert an arbitrary string to a safe project-ID slug.

    Rules:
    - Lowercase ASCII.
    - Only ``[a-z0-9-]``.
    - Leading/trailing hyphens stripped.
    - Truncated to *max_len* characters.
    - Falls back to ``"default"`` if the result would be empty.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:max_len]
    return slug or "default"


def _hostname() -> str:
    try:
        return socket.gethostname()
    except Exception:
        return "unknown"
