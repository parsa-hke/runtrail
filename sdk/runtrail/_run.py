"""Run class — full Phase 1 implementation.

Lifecycle:
  1. _create() opens Store, inserts project + run rows, starts WriteQueue.
  2. Background thread captures git, env/hardware, source snapshot.
  3. ResourceSampler daemon starts polling.
  4. Caller calls run.log() / run.log_artifact() / etc. — all non-blocking.
  5. run.finish() (or context-manager __exit__) drains the queue,
     finalises JSONL → Parquet, closes the store.
  6. atexit handler calls finish() if the process exits without an explicit call.
"""

from __future__ import annotations

import atexit
import io
import logging
import os
import signal
import sys
import threading
import time
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# Module-level registry so atexit can reach active runs.
_active_runs: list["Run"] = []
_active_lock = threading.Lock()


class Run:
    """Represents a single experiment run."""

    id: str
    name: str
    project: str

    def __init__(self) -> None:
        raise RuntimeError("Use runtrail.init() to create a Run.")

    @classmethod
    def _create(
        cls,
        project: str | None,
        name: str | None,
        config: dict[str, Any] | None,
        tags: list[str] | None,
        notes: str | None,
        dir: str | None,
        capture_source: bool,
        capture_env: bool,
        capture_hardware: bool,
        capture_git: bool,
        resource_interval: float,
        mode: str,
        reinit: bool,
    ) -> "Run":
        from runtrail._ids import generate_run_id, slugify
        from runtrail._store import Store, home_dir, run_dir

        obj = object.__new__(cls)

        # ── Disabled / offline no-op mode ──────────────────────────────────
        if mode == "disabled":
            return _make_noop_run(obj, project, name)

        # ── Resolve project / name ─────────────────────────────────────────
        cwd = Path.cwd()
        proj_name = project or os.environ.get("RUNTRAIL_PROJECT") or cwd.name
        proj_id = slugify(proj_name)
        run_name = name or _default_run_name()
        run_id = generate_run_id(run_name)

        obj.id = run_id
        obj.name = run_name
        obj.project = proj_id
        obj._proj_id = proj_id
        obj._started_at = int(time.time() * 1000)
        obj._finished = False
        obj._mode = mode
        obj._step = 0
        obj._config = config or {}

        # ── Home dir ────────────────────────────────────────────────────────
        home = Path(dir) if dir else home_dir()
        obj._home = home

        # ── Store ───────────────────────────────────────────────────────────
        store = Store(home)
        store.open()
        obj._store = store

        store.upsert_project(proj_id, proj_name, str(cwd))
        store.insert_run(
            run_id=run_id,
            project_id=proj_id,
            name=run_name,
            started_at=obj._started_at // 1000,
            user=_username(),
            host=_hostname(),
            pid=os.getpid(),
            cmd=_cmd_line(),
            hparams=config or None,
            tags=tags or [],
            notes=notes,
        )

        # ── WriteQueue ──────────────────────────────────────────────────────
        from runtrail._queue import WriteQueue
        q = WriteQueue(store, proj_id, run_id, obj._started_at)
        q.start()
        obj._queue = q

        # ── Resource sampler ────────────────────────────────────────────────
        obj._sampler = None
        if resource_interval > 0:
            from runtrail._capture.resources import ResourceSampler
            sampler = ResourceSampler(q, interval_s=resource_interval)
            sampler.start()
            obj._sampler = sampler

        # ── Background capture thread ────────────────────────────────────────
        rdir = run_dir(home, proj_id, run_id)
        t = threading.Thread(
            target=_background_capture,
            args=(obj, rdir, capture_git, capture_env, capture_hardware, capture_source),
            name=f"runtrail-capture-{run_id}",
            daemon=True,
        )
        t.start()
        obj._capture_thread = t

        # ── atexit + signal handlers ─────────────────────────────────────────
        with _active_lock:
            _active_runs.append(obj)

        return obj  # type: ignore[return-value]

    # ── Logging ────────────────────────────────────────────────────────────────

    def log(
        self,
        values: dict[str, float],
        step: int | None = None,
        commit: bool = True,
    ) -> None:
        """Log scalar metrics. Non-blocking."""
        if self._finished:
            return
        if step is None:
            step = self._step
        if commit:
            self._step = step + 1
        from runtrail._queue import LogScalars
        wall_ms = int(time.time() * 1000)
        self._queue.put(LogScalars(step=step, wall_ms=wall_ms, values=dict(values)))

    def log_artifact(
        self,
        path: str | os.PathLike[str],
        name: str | None = None,
        type: str = "binary",
    ) -> str:
        """Store a file artifact and return its sha256 hash."""
        if self._finished:
            return ""
        src = Path(path).resolve()
        if not src.exists():
            log.warning("log_artifact: path does not exist: %s", src)
            return ""
        art_name = name or src.name
        try:
            sha = self._store.store_artifact(
                self._proj_id, self.id, src, art_name, type
            )
            return sha
        except Exception as exc:
            log.warning("log_artifact error: %s", exc)
            return ""

    def log_image(self, key: str, img: Any, step: int | None = None) -> None:
        """Log an image (PIL Image or numpy array) as a PNG artifact."""
        if self._finished:
            return
        try:
            import tempfile
            from pathlib import Path as _Path

            buf = io.BytesIO()
            if hasattr(img, "save"):
                # PIL Image
                img.save(buf, format="PNG")
            else:
                # numpy array — try matplotlib
                import matplotlib  # type: ignore[import]
                matplotlib.use("Agg")
                import matplotlib.pyplot as plt
                fig, ax = plt.subplots()
                ax.imshow(img)
                ax.axis("off")
                fig.savefig(buf, format="png", bbox_inches="tight")
                plt.close(fig)

            step_str = f"_{step}" if step is not None else ""
            fname = f"{key}{step_str}.png"
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf:
                tf.write(buf.getvalue())
                tmp_path = _Path(tf.name)
            self.log_artifact(tmp_path, name=fname, type="image")
            tmp_path.unlink(missing_ok=True)
        except Exception as exc:
            log.warning("log_image error: %s", exc)

    def log_figure(self, key: str, fig: Any, step: int | None = None) -> None:
        """Log a matplotlib Figure as a PNG artifact."""
        if self._finished:
            return
        try:
            import tempfile
            from pathlib import Path as _Path

            buf = io.BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight")
            step_str = f"_{step}" if step is not None else ""
            fname = f"{key}{step_str}.png"
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf:
                tf.write(buf.getvalue())
                tmp_path = _Path(tf.name)
            self.log_artifact(tmp_path, name=fname, type="figure")
            tmp_path.unlink(missing_ok=True)
        except Exception as exc:
            log.warning("log_figure error: %s", exc)

    def log_table(self, key: str, rows: Any, columns: list[str]) -> None:
        """Log a table as a CSV artifact."""
        if self._finished:
            return
        try:
            import csv
            import tempfile
            from pathlib import Path as _Path

            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".csv", delete=False, newline=""
            ) as tf:
                writer = csv.writer(tf)
                writer.writerow(columns)
                writer.writerows(rows)
                tmp_path = _Path(tf.name)
            self.log_artifact(tmp_path, name=f"{key}.csv", type="table")
            tmp_path.unlink(missing_ok=True)
        except Exception as exc:
            log.warning("log_table error: %s", exc)

    def use_dataset(
        self,
        path: str | os.PathLike[str],
        name: str | None = None,
    ) -> str:
        """Register a dataset path and return its SHA-256 fingerprint."""
        from runtrail._store import _sha256_path
        src = Path(path).resolve()
        sha = _sha256_path(src)
        ds_name = name or src.name
        try:
            from runtrail._store import _transaction
            with _transaction(self._store.conn):
                self._store.conn.execute(
                    "UPDATE runs SET dataset=?, dataset_hash=? WHERE id=?",
                    (ds_name, sha, self.id),
                )
        except Exception as exc:
            log.warning("use_dataset error: %s", exc)
        return sha

    def add_tag(self, *tags: str) -> None:
        """Add one or more tags to this run."""
        if self._finished:
            return
        from runtrail._queue import AddTag
        self._queue.put(AddTag(tags=list(tags)))

    def add_note(self, text: str) -> None:
        """Append text to the run's notes field."""
        if self._finished:
            return
        from runtrail._queue import AddNote
        self._queue.put(AddNote(text=text))

    def set_summary(self, key: str, value: float) -> None:
        """Write a named summary metric directly to the final_metrics table."""
        if self._finished:
            return
        # Log as a regular scalar (so it appears in the JSONL/Parquet) and
        # also update the in-memory stats accumulator so it shows at finish.
        self.log({key: value})

    def event(self, level: str, message: str) -> None:
        """Emit a structured event (info | warn | error)."""
        if self._finished:
            return
        from runtrail._queue import LogEvent
        wall_ms = int(time.time() * 1000)
        self._queue.put(LogEvent(wall_ms=wall_ms, level=level, message=message))

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    def finish(
        self,
        status: str = "done",
        error: str | None = None,
    ) -> None:
        """Flush all pending writes and mark the run as finished."""
        if self._finished:
            return
        self._finished = True

        # No-op mode — nothing to flush.
        if self._mode == "disabled":
            return

        # Stop resource sampler first so no more messages are enqueued.
        if self._sampler is not None:
            try:
                self._sampler.stop()
            except Exception:
                pass

        # Drain and stop the write queue.
        try:
            self._queue.stop()
        except Exception:
            pass

        ended_at = int(time.time() * 1000)
        duration_s = (ended_at - self._started_at) / 1000.0

        # Finalize metric stats.
        final_metrics = self._queue.get_metric_stats()

        try:
            self._store.finish_run(
                run_id=self.id,
                project_id=self._proj_id,
                status=status,
                ended_at=ended_at // 1000,
                duration_s=duration_s,
                final_metrics=final_metrics or None,
                error=error,
                exit_code=None,
            )
        except Exception as exc:
            log.warning("finish_run error: %s", exc)

        # Convert JSONL → Parquet.
        try:
            self._store.finalize_metrics(self._proj_id, self.id)
        except Exception as exc:
            log.debug("finalize_metrics error: %s", exc)

        try:
            self._store.finalize_resources(self._proj_id, self.id)
        except Exception as exc:
            log.debug("finalize_resources error: %s", exc)

        # Close store connection.
        try:
            self._store.close()
        except Exception:
            pass

        # Remove from active registry.
        with _active_lock:
            try:
                _active_runs.remove(self)
            except ValueError:
                pass

        dropped = self._queue.dropped_count
        if dropped:
            log.warning("runtrail: %d log entries were dropped (queue full)", dropped)

        log.debug("run %s finished with status=%s duration=%.1fs", self.id, status, duration_s)

    def __enter__(self) -> "Run":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: Any,
    ) -> None:
        if exc_type is not None:
            self.finish(status="failed", error=str(exc_val))
        else:
            self.finish()

    def __repr__(self) -> str:
        return f"Run(id={self.id!r}, name={self.name!r}, project={self.project!r})"


# ---------------------------------------------------------------------------
# Background capture thread
# ---------------------------------------------------------------------------

def _background_capture(
    run: "Run",
    rdir: Path,
    capture_git: bool,
    capture_env: bool,
    capture_hardware: bool,
    capture_source: bool,
) -> None:
    """Run all captures in a daemon thread so _create() returns quickly."""
    # Git
    if capture_git:
        try:
            from runtrail._capture import git
            git_info = git.capture(rdir)
            run._store.update_git(
                run.id,
                branch=git_info.get("branch"),
                commit_hash=git_info.get("commit"),
                dirty=bool(git_info.get("dirty")),
            )
        except Exception as exc:
            log.debug("git capture error: %s", exc)

    # Env + hardware
    env_dict: dict[str, Any] = {}
    packages: list[tuple[str, str]] = []
    hw_dict: dict[str, Any] = {}

    if capture_env:
        try:
            from runtrail._capture import env as env_mod
            env_dict, packages = env_mod.capture()
        except Exception as exc:
            log.debug("env capture error: %s", exc)

    if capture_hardware:
        try:
            from runtrail._capture import hardware as hw_mod
            hw_dict = hw_mod.capture()
        except Exception as exc:
            log.debug("hardware capture error: %s", exc)

    if capture_env or capture_hardware:
        try:
            run._store.update_hardware_env(
                run.id, run._proj_id, hw_dict, env_dict, packages
            )
        except Exception as exc:
            log.debug("update_hardware_env error: %s", exc)

    # Source snapshot
    if capture_source:
        try:
            from runtrail._capture import source as src_mod
            files = src_mod.capture(root=Path.cwd())
            if files:
                run._store.snapshot_source(run._proj_id, run.id, files)
        except Exception as exc:
            log.debug("source capture error: %s", exc)


# ---------------------------------------------------------------------------
# atexit handler
# ---------------------------------------------------------------------------

def _atexit_handler() -> None:
    """Finish any runs that weren't explicitly finished."""
    with _active_lock:
        runs = list(_active_runs)
    for run in runs:
        if not run._finished:
            try:
                run.finish(status="done")
            except Exception:
                pass


atexit.register(_atexit_handler)


# ---------------------------------------------------------------------------
# Signal helpers
# ---------------------------------------------------------------------------

def _install_signal_handlers() -> None:
    """Best-effort SIGTERM handler so finish() is called on kill."""
    def _handler(signum: int, frame: Any) -> None:
        _atexit_handler()
        # Re-raise default behaviour
        signal.signal(signum, signal.SIG_DFL)
        os.kill(os.getpid(), signum)

    try:
        signal.signal(signal.SIGTERM, _handler)
    except (OSError, ValueError):
        # Not the main thread or not supported — skip.
        pass


_install_signal_handlers()


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def _default_run_name() -> str:
    """Generate a short human-readable run name from timestamp."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    return now.strftime("run-%Y%m%d-%H%M%S")


def _username() -> str:
    try:
        return os.environ.get("USER") or os.environ.get("USERNAME") or os.getlogin()
    except Exception:
        return "unknown"


def _hostname() -> str:
    try:
        import socket
        return socket.gethostname()
    except Exception:
        return "unknown"


def _cmd_line() -> str:
    try:
        return " ".join(sys.argv)
    except Exception:
        return ""


def _slug(s: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:64] or "default"


# ---------------------------------------------------------------------------
# No-op run for mode="disabled"
# ---------------------------------------------------------------------------

def _make_noop_run(obj: "Run", project: str | None, name: str | None) -> "Run":
    """Return a Run whose every method is a silent no-op (mode='disabled')."""
    from runtrail._ids import generate_run_id, slugify

    cwd_name = os.path.basename(os.getcwd())
    proj_id = slugify(project or cwd_name)
    run_name = name or _default_run_name()
    run_id = generate_run_id(run_name)

    obj.id = run_id
    obj.name = run_name
    obj.project = proj_id
    obj._proj_id = proj_id
    obj._started_at = int(time.time() * 1000)
    obj._finished = False
    obj._mode = "disabled"
    obj._step = 0
    obj._config = {}
    obj._home = Path(os.environ.get("RUNTRAIL_HOME", Path.home() / ".runtrail"))
    obj._store = None  # type: ignore[assignment]
    obj._queue = _NoopQueue()
    obj._sampler = None
    obj._capture_thread = None
    return obj  # type: ignore[return-value]


class _NoopQueue:
    """Drop-in WriteQueue substitute that discards everything."""

    dropped_count = 0

    def put(self, msg: Any) -> None:  # noqa: ANN001
        pass

    def stop(self) -> None:
        pass

    def get_metric_stats(self) -> dict[str, Any]:
        return {}
