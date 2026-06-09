"""Background write queue — keeps I/O off the training hot path.

Architecture
------------
A single daemon ``threading.Thread`` consumes a bounded ``queue.Queue``.
The writer batches up to ``BATCH_SIZE`` messages or ``FLUSH_INTERVAL_MS``
milliseconds, whichever comes first, then flushes to disk in one go.

Message types (plain dataclasses):
  LogScalars  — one step's worth of metric values
  LogResource — one resource sample
  LogEvent    — one structured info/warn/error event
  LogArtifact — artifact path reference (already stored; just update DB)
  AddTag      — add tag(s) to the run
  AddNote     — append note text
  Finalize    — drain queue and stop the thread

Performance contract (NFR-1: < 1% overhead):
  ``run.log()`` calls ``queue.put_nowait()``.  If the queue is full the
  entry is silently dropped and ``dropped_count`` is incremented.  The
  queue ceiling is 10 000 entries (~40 MB of typical metrics).
"""

from __future__ import annotations

import json
import logging
import queue
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Union

from runtrail._store import Store

log = logging.getLogger(__name__)

# Tuning constants
_MAX_QUEUE = 10_000
_BATCH_SIZE = 50
_FLUSH_INTERVAL_S = 0.1   # 100 ms


# ---------------------------------------------------------------------------
# Message types
# ---------------------------------------------------------------------------

@dataclass
class LogScalars:
    step: int
    wall_ms: int
    values: dict[str, float]


@dataclass
class LogResource:
    wall_ms: int
    sample: dict[str, Any]


@dataclass
class LogEvent:
    wall_ms: int
    level: str
    message: str


@dataclass
class AddTag:
    tags: list[str]


@dataclass
class AddNote:
    text: str


@dataclass
class Finalize:
    pass


# NOTE: a runtime assignment (not an annotation), so `from __future__ import
# annotations` does not defer it — use typing.Union to stay Python 3.9 compatible.
_Message = Union[LogScalars, LogResource, LogEvent, AddTag, AddNote, Finalize]


# ---------------------------------------------------------------------------
# Writer thread
# ---------------------------------------------------------------------------

class WriteQueue:
    """Non-blocking write queue backed by a single daemon thread."""

    def __init__(
        self,
        store: Store,
        project_id: str,
        run_id: str,
        started_at_ms: int,
    ) -> None:
        self._store = store
        self._project_id = project_id
        self._run_id = run_id
        self._started_at_ms = started_at_ms

        self._q: queue.Queue[_Message] = queue.Queue(maxsize=_MAX_QUEUE)
        self._dropped = 0
        self._thread = threading.Thread(
            target=self._run,
            name=f"runtrail-writer-{run_id}",
            daemon=True,
        )
        self._stopped = threading.Event()

        # Accumulators for final metric stats (used by _run.py at finish time)
        # key → {"last": float, "best": float, "count": int, "lower_is_better": bool}
        self._metric_stats: dict[str, dict[str, Any]] = {}
        self._stats_lock = threading.Lock()

    def start(self) -> None:
        self._thread.start()

    def put(self, msg: _Message) -> None:
        """Enqueue *msg* non-blocking.  Silently drops if queue is full."""
        try:
            self._q.put_nowait(msg)
        except queue.Full:
            self._dropped += 1

    def flush(self, timeout: float = 5.0) -> None:
        """Block until the queue is drained (synchronous checkpoint)."""
        done = threading.Event()

        class _Barrier:
            pass

        # Use a sentinel object to know when the writer has caught up.
        sentinel: Any = _Barrier()
        try:
            self._q.put(sentinel, timeout=timeout)  # type: ignore[arg-type]
        except queue.Full:
            return
        # Wait until the writer pops the sentinel.
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._q.empty():
                break
            time.sleep(0.005)

    def stop(self) -> None:
        """Send Finalize, wait for the thread to exit."""
        try:
            self._q.put(Finalize(), timeout=2.0)
        except queue.Full:
            pass
        self._thread.join(timeout=10.0)
        self._stopped.set()

    @property
    def dropped_count(self) -> int:
        return self._dropped

    def get_metric_stats(self) -> dict[str, dict[str, Any]]:
        with self._stats_lock:
            return dict(self._metric_stats)

    # ── Writer thread ────────────────────────────────────────────────────────

    def _run(self) -> None:
        scalar_lines: list[str] = []
        resource_lines: list[str] = []
        events: list[dict[str, Any]] = []

        deadline = time.monotonic() + _FLUSH_INTERVAL_S

        while True:
            timeout = max(0.001, deadline - time.monotonic())
            try:
                msg = self._q.get(timeout=timeout)
            except queue.Empty:
                self._flush_batch(scalar_lines, resource_lines, events)
                scalar_lines, resource_lines, events = [], [], []
                deadline = time.monotonic() + _FLUSH_INTERVAL_S
                continue

            # Unknown sentinel from flush() probe — just discard.
            if not isinstance(msg, (LogScalars, LogResource, LogEvent, AddTag, AddNote, Finalize)):
                continue

            if isinstance(msg, Finalize):
                self._flush_batch(scalar_lines, resource_lines, events)
                return

            if isinstance(msg, LogScalars):
                row: dict[str, Any] = {"step": msg.step, "wall_ms": msg.wall_ms}
                row.update(msg.values)
                scalar_lines.append(json.dumps(row))
                self._update_stats(msg.values)

            elif isinstance(msg, LogResource):
                row2: dict[str, Any] = {"wall_ms": msg.wall_ms}
                row2.update(msg.sample)
                resource_lines.append(json.dumps(row2))

            elif isinstance(msg, LogEvent):
                events.append({
                    "wall_ms": msg.wall_ms,
                    "level": msg.level,
                    "message": msg.message,
                })

            elif isinstance(msg, AddTag):
                try:
                    self._store.add_tags(self._run_id, msg.tags)
                except Exception as exc:
                    log.debug("add_tags error: %s", exc)

            elif isinstance(msg, AddNote):
                try:
                    self._store.add_note(self._run_id, msg.text)
                except Exception as exc:
                    log.debug("add_note error: %s", exc)

            # Flush when batch is full.
            total = len(scalar_lines) + len(resource_lines) + len(events)
            if total >= _BATCH_SIZE or time.monotonic() >= deadline:
                self._flush_batch(scalar_lines, resource_lines, events)
                scalar_lines, resource_lines, events = [], [], []
                deadline = time.monotonic() + _FLUSH_INTERVAL_S

    def _flush_batch(
        self,
        scalar_lines: list[str],
        resource_lines: list[str],
        events: list[dict[str, Any]],
    ) -> None:
        if scalar_lines:
            try:
                self._store.append_metrics_batch(
                    self._project_id, self._run_id, scalar_lines
                )
            except Exception as exc:
                log.warning("metrics flush error: %s", exc)

        if resource_lines:
            try:
                self._store.append_resources_batch(
                    self._project_id, self._run_id, resource_lines
                )
            except Exception as exc:
                log.warning("resources flush error: %s", exc)

        if events:
            try:
                self._store.append_events_batch(
                    self._project_id, self._run_id,
                    self._started_at_ms, events,
                )
            except Exception as exc:
                log.warning("events flush error: %s", exc)

    def _update_stats(self, values: dict[str, float]) -> None:
        """Track last/best for each metric (used to populate final_metrics)."""
        with self._stats_lock:
            for k, v in values.items():
                s = self._metric_stats.setdefault(k, {"last": v, "best": v, "count": 0})
                s["last"] = v
                s["count"] += 1
                # Heuristic: metrics with "loss" or "error" in name → lower is better
                lower = "loss" in k or "error" in k or "err" in k
                if lower:
                    if v < s["best"]:
                        s["best"] = v
                else:
                    if v > s["best"]:
                        s["best"] = v
