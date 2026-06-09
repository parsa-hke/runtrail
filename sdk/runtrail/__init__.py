"""
runtrail — local-first experiment tracker for solo ML researchers.

Quick start::

    import runtrail

    run = runtrail.init(config={"lr": 0.1, "batch_size": 256})
    for step in range(1000):
        run.log({"loss": 0.9 - step * 0.001}, step=step)
    run.finish()

Or with a context manager::

    with runtrail.run(config={"lr": 0.1}) as run:
        for step in range(1000):
            run.log({"loss": compute_loss()}, step=step)
"""

from __future__ import annotations

__version__ = "0.1.0"
__all__ = ["init", "run", "__version__"]

import contextlib
from typing import TYPE_CHECKING, Any, Iterator

if TYPE_CHECKING:
    from runtrail._run import Run


def init(
    project: str | None = None,
    name: str | None = None,
    config: dict[str, Any] | None = None,
    tags: list[str] | None = None,
    notes: str | None = None,
    dir: str | None = None,
    capture_source: bool = True,
    capture_env: bool = True,
    capture_hardware: bool = True,
    capture_git: bool = True,
    resource_interval: float = 15.0,
    mode: str = "online",
    reinit: bool = False,
) -> "Run":
    """Initialize a new experiment run and return a Run object.

    Args:
        project: Project name. Defaults to slug of the current directory name.
        name: Run name. Auto-generated if not provided.
        config: Hyperparameter dict logged at run start.
        tags: Initial list of tags.
        notes: Free-text notes attached to the run.
        dir: Storage root. Defaults to $RUNTRAIL_HOME or ~/.runtrail.
        capture_source: Snapshot Python source files at run start.
        capture_env: Capture Python environment (packages, versions).
        capture_hardware: Capture CPU, RAM, GPU info.
        capture_git: Capture git state (commit, branch, diff).
        resource_interval: Seconds between resource samples (0 = disable).
        mode: "online" (default, writes to disk) | "disabled" (no-op).
        reinit: Allow re-initializing in the same process.

    Returns:
        A Run object with .log(), .log_artifact(), .finish(), etc.
    """
    from runtrail._run import Run  # noqa: PLC0415

    return Run._create(
        project=project,
        name=name,
        config=config,
        tags=tags,
        notes=notes,
        dir=dir,
        capture_source=capture_source,
        capture_env=capture_env,
        capture_hardware=capture_hardware,
        capture_git=capture_git,
        resource_interval=resource_interval,
        mode=mode,
        reinit=reinit,
    )


@contextlib.contextmanager
def run(**kwargs: Any) -> Iterator["Run"]:
    """Context manager that initializes a run and automatically finishes it.

    Usage::

        with runtrail.run(config={"lr": 0.1}) as r:
            r.log({"loss": 0.9})
    """
    r = init(**kwargs)
    try:
        yield r
    except Exception as exc:
        r.finish(status="failed", error=str(exc))
        raise
    else:
        r.finish()
