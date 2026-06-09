"""Storage layer — SQLite metadata DB + filesystem layout.

Responsible for:
- Creating and migrating ``runtrail.db``.
- Writing/updating run rows.
- Appending JSONL metric/resource/event lines.
- Content-addressed artifact storage.
- Finalizing JSONL → Parquet on run completion.
- Atomic file writes throughout (write-to-tmp then rename).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import sqlite3
import tempfile
import time
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Schema — kept in-module so the SDK has zero file-read requirements.
# ---------------------------------------------------------------------------

_SCHEMA_SQL = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS schema_version (
    version    INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    path         TEXT,
    description  TEXT,
    default_tags TEXT,
    baselines    TEXT,
    saved_views  TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL,
    started_at      INTEGER NOT NULL,
    ended_at        INTEGER,
    duration_s      REAL,
    user            TEXT,
    host            TEXT,
    pid             INTEGER,
    branch          TEXT,
    commit_hash     TEXT,
    dirty           INTEGER DEFAULT 0,
    cmd             TEXT,
    exit_code       INTEGER,
    error           TEXT,
    notes           TEXT,
    pinned          INTEGER DEFAULT 0,
    hparams_json    TEXT,
    final_json      TEXT,
    hardware_json   TEXT,
    env_json        TEXT,
    dataset         TEXT,
    dataset_hash    TEXT
);

CREATE INDEX IF NOT EXISTS runs_project_started ON runs(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS runs_status          ON runs(status);

CREATE TABLE IF NOT EXISTS tags (
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    tag    TEXT NOT NULL,
    PRIMARY KEY (run_id, tag)
);
CREATE INDEX IF NOT EXISTS tags_tag ON tags(tag);

CREATE TABLE IF NOT EXISTS artifacts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      TEXT    NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    type        TEXT,
    size_bytes  INTEGER NOT NULL,
    sha256      TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    UNIQUE (run_id, name)
);
CREATE INDEX IF NOT EXISTS artifacts_run    ON artifacts(run_id);
CREATE INDEX IF NOT EXISTS artifacts_sha256 ON artifacts(sha256);

CREATE TABLE IF NOT EXISTS packages (
    run_id  TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    name    TEXT NOT NULL,
    version TEXT,
    PRIMARY KEY (run_id, name)
);

CREATE TABLE IF NOT EXISTS events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id  TEXT    NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    ts_ms   INTEGER NOT NULL,
    level   TEXT    NOT NULL,
    message TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS events_run_ts ON events(run_id, ts_ms);

CREATE TABLE IF NOT EXISTS final_metrics (
    run_id      TEXT    NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    value       REAL,
    best        REAL,
    last        REAL,
    step_count  INTEGER,
    PRIMARY KEY (run_id, name)
);
CREATE INDEX IF NOT EXISTS final_metrics_name_value ON final_metrics(name, value);
"""

_SCHEMA_VERSION = 1


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------

class Store:
    """Thin wrapper around the runtrail SQLite database and file layout."""

    def __init__(self, home: Path) -> None:
        self.home = home
        self._db_path = home / "runtrail.db"
        self._conn: sqlite3.Connection | None = None

    # ── Connection ──────────────────────────────────────────────────────────

    def open(self) -> None:
        """Open the SQLite connection and apply schema if needed."""
        self.home.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(
            str(self._db_path),
            check_same_thread=False,
            timeout=10.0,
            isolation_level=None,  # autocommit; we manage transactions manually
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA synchronous=NORMAL")
        self._conn = conn
        self._apply_schema()

    def close(self) -> None:
        if self._conn:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None

    @property
    def conn(self) -> sqlite3.Connection:
        if self._conn is None:
            raise RuntimeError("Store is not open")
        return self._conn

    def _apply_schema(self) -> None:
        """Create tables and record schema version if not already present.

        ``executescript`` always issues an implicit COMMIT before running, so
        we cannot wrap it in our BEGIN IMMEDIATE helper.  Instead we run it
        bare, then use a normal transaction just for the version insert.
        """
        # executescript handles its own transaction (implicit COMMIT first).
        self.conn.executescript(_SCHEMA_SQL)

        # Now check/insert the schema version row in a proper transaction.
        with _transaction(self.conn):
            row = self.conn.execute(
                "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1"
            ).fetchone()
            if row is None:
                self.conn.execute(
                    "INSERT INTO schema_version VALUES (?, ?)",
                    (_SCHEMA_VERSION, int(time.time())),
                )

    # ── Projects ────────────────────────────────────────────────────────────

    def upsert_project(
        self,
        project_id: str,
        name: str,
        path: str | None = None,
    ) -> None:
        """Insert or update a project row (no-op if already current)."""
        now = int(time.time())
        with _transaction(self.conn):
            self.conn.execute(
                """
                INSERT INTO projects (id, name, path, default_tags, baselines,
                                      saved_views, created_at, updated_at)
                VALUES (?, ?, ?, '[]', '[]', '[]', ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name       = excluded.name,
                    path       = COALESCE(excluded.path, path),
                    updated_at = excluded.updated_at
                """,
                (project_id, name, path, now, now),
            )
        # Create project directory
        proj_dir(self.home, project_id).mkdir(parents=True, exist_ok=True)

    # ── Runs ────────────────────────────────────────────────────────────────

    def insert_run(
        self,
        run_id: str,
        project_id: str,
        name: str,
        started_at: int,
        user: str,
        host: str,
        pid: int,
        cmd: str,
        hparams: dict[str, Any] | None = None,
        tags: list[str] | None = None,
        notes: str | None = None,
    ) -> None:
        """Create the run directory, meta.json, and the SQLite row."""
        rdir = run_dir(self.home, project_id, run_id)
        rdir.mkdir(parents=True, exist_ok=True)

        meta: dict[str, Any] = {
            "id": run_id,
            "project": project_id,
            "name": name,
            "status": "running",
            "started_at": started_at,
            "user": user,
            "host": host,
            "pid": pid,
            "cmd": cmd,
            "hparams": hparams or {},
            "tags": tags or [],
            "notes": notes or "",
        }
        _write_json_atomic(rdir / "meta.json", meta)
        if hparams:
            _write_json_atomic(rdir / "hparams.json", hparams)

        with _transaction(self.conn):
            self.conn.execute(
                """
                INSERT INTO runs
                    (id, project_id, name, status, started_at,
                     user, host, pid, cmd, hparams_json, notes)
                VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id, project_id, name, started_at,
                    user, host, pid, cmd,
                    json.dumps(hparams) if hparams else None,
                    notes,
                ),
            )
            if tags:
                self.conn.executemany(
                    "INSERT OR IGNORE INTO tags (run_id, tag) VALUES (?, ?)",
                    [(run_id, t) for t in tags],
                )

    def update_git(
        self,
        run_id: str,
        branch: str | None,
        commit_hash: str | None,
        dirty: bool,
    ) -> None:
        with _transaction(self.conn):
            self.conn.execute(
                """UPDATE runs SET branch=?, commit_hash=?, dirty=?
                   WHERE id=?""",
                (branch, commit_hash, int(dirty), run_id),
            )

    def update_hardware_env(
        self,
        run_id: str,
        project_id: str,
        hardware: dict[str, Any],
        env: dict[str, Any],
        packages: list[tuple[str, str]],
    ) -> None:
        rdir = run_dir(self.home, project_id, run_id)
        _write_json_atomic(rdir / "env.json", {"hardware": hardware, "env": env})

        with _transaction(self.conn):
            self.conn.execute(
                "UPDATE runs SET hardware_json=?, env_json=? WHERE id=?",
                (json.dumps(hardware), json.dumps(env), run_id),
            )
            if packages:
                self.conn.executemany(
                    "INSERT OR IGNORE INTO packages (run_id, name, version) VALUES (?,?,?)",
                    [(run_id, n, v) for n, v in packages],
                )

    def finish_run(
        self,
        run_id: str,
        project_id: str,
        status: str,
        ended_at: int,
        duration_s: float,
        final_metrics: dict[str, dict[str, float]] | None = None,
        error: str | None = None,
        exit_code: int | None = None,
    ) -> None:
        """Mark the run finished and write final metric summaries."""
        final_json: dict[str, float] = {}
        if final_metrics:
            final_json = {k: v.get("last", 0.0) for k, v in final_metrics.items()}

        rdir = run_dir(self.home, project_id, run_id)
        meta_path = rdir / "meta.json"
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text())
                meta.update(
                    status=status,
                    ended_at=ended_at,
                    duration_s=duration_s,
                    final=final_json,
                    error=error,
                )
                _write_json_atomic(meta_path, meta)
            except Exception as exc:
                log.warning("could not update meta.json: %s", exc)

        with _transaction(self.conn):
            self.conn.execute(
                """UPDATE runs
                   SET status=?, ended_at=?, duration_s=?, final_json=?,
                       error=?, exit_code=?
                   WHERE id=?""",
                (
                    status, ended_at, duration_s,
                    json.dumps(final_json) if final_json else None,
                    error, exit_code, run_id,
                ),
            )
            if final_metrics:
                for metric_name, stats in final_metrics.items():
                    self.conn.execute(
                        """INSERT OR REPLACE INTO final_metrics
                           (run_id, name, value, best, last, step_count)
                           VALUES (?,?,?,?,?,?)""",
                        (
                            run_id, metric_name,
                            stats.get("last"),
                            stats.get("best"),
                            stats.get("last"),
                            stats.get("count", 0),
                        ),
                    )

    def add_tags(self, run_id: str, tags: list[str]) -> None:
        with _transaction(self.conn):
            self.conn.executemany(
                "INSERT OR IGNORE INTO tags (run_id, tag) VALUES (?,?)",
                [(run_id, t) for t in tags],
            )

    def add_note(self, run_id: str, text: str) -> None:
        with _transaction(self.conn):
            self.conn.execute(
                "UPDATE runs SET notes = COALESCE(notes || char(10), '') || ? WHERE id=?",
                (text, run_id),
            )

    # ── Metrics JSONL ───────────────────────────────────────────────────────

    def append_metrics_batch(
        self,
        project_id: str,
        run_id: str,
        lines: list[str],
    ) -> None:
        """Append pre-serialised JSONL lines to metrics.jsonl."""
        path = run_dir(self.home, project_id, run_id) / "metrics.jsonl"
        _append_lines(path, lines)

    def append_resources_batch(
        self,
        project_id: str,
        run_id: str,
        lines: list[str],
    ) -> None:
        path = run_dir(self.home, project_id, run_id) / "resources.jsonl"
        _append_lines(path, lines)

    def append_events_batch(
        self,
        project_id: str,
        run_id: str,
        started_ms: int,
        entries: list[dict[str, Any]],
    ) -> None:
        """Append events to events.jsonl AND insert into the events SQLite table."""
        path = run_dir(self.home, project_id, run_id) / "events.jsonl"
        lines = [json.dumps(e) for e in entries]
        _append_lines(path, lines)
        with _transaction(self.conn):
            self.conn.executemany(
                "INSERT INTO events (run_id, ts_ms, level, message) VALUES (?,?,?,?)",
                [
                    (run_id, e.get("wall_ms", 0), e.get("level", "info"), e.get("message", ""))
                    for e in entries
                ],
            )

    # ── Artifacts ───────────────────────────────────────────────────────────

    def store_artifact(
        self,
        project_id: str,
        run_id: str,
        src_path: Path,
        name: str,
        artifact_type: str = "binary",
    ) -> str:
        """Copy *src_path* into the content-addressed store. Returns sha256."""
        sha = _sha256_file(src_path)
        dest = _artifact_blob_path(self.home, project_id, sha)
        dest.parent.mkdir(parents=True, exist_ok=True)

        if not dest.exists():
            # Atomic copy: write to tmp in same dir then rename.
            tmp = dest.with_suffix(".tmp")
            shutil.copy2(src_path, tmp)
            tmp.rename(dest)

        size = src_path.stat().st_size
        now = int(time.time())
        with _transaction(self.conn):
            self.conn.execute(
                """INSERT OR REPLACE INTO artifacts
                   (run_id, name, type, size_bytes, sha256, created_at)
                   VALUES (?,?,?,?,?,?)""",
                (run_id, name, artifact_type, size, sha, now),
            )
        return sha

    # ── Source snapshots ────────────────────────────────────────────────────

    def snapshot_source(
        self,
        project_id: str,
        run_id: str,
        files: list[tuple[Path, str]],
    ) -> None:
        """Copy source files into the run's source/ directory.

        Args:
            files: list of (absolute_path, relative_dest_path) tuples.
        """
        src_dir = run_dir(self.home, project_id, run_id) / "source"
        for abs_path, rel in files:
            dest = src_dir / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            try:
                shutil.copy2(abs_path, dest)
            except Exception as exc:
                log.debug("source snapshot skip %s: %s", abs_path, exc)

    # ── Parquet finalization ─────────────────────────────────────────────────

    def finalize_metrics(self, project_id: str, run_id: str) -> None:
        """Convert metrics.jsonl → metrics.parquet (long format), then delete JSONL."""
        rdir = run_dir(self.home, project_id, run_id)
        _jsonl_to_parquet(rdir / "metrics.jsonl", rdir / "metrics.parquet")

    def finalize_resources(self, project_id: str, run_id: str) -> None:
        rdir = run_dir(self.home, project_id, run_id)
        _jsonl_to_parquet(rdir / "resources.jsonl", rdir / "resources.parquet")


# ---------------------------------------------------------------------------
# Path helpers (used by both Store and callers)
# ---------------------------------------------------------------------------

def home_dir() -> Path:
    """Return the runtrail home directory from env or default."""
    return Path(os.environ.get("RUNTRAIL_HOME", Path.home() / ".runtrail"))


def proj_dir(home: Path, project_id: str) -> Path:
    return home / "projects" / project_id


def run_dir(home: Path, project_id: str, run_id: str) -> Path:
    return proj_dir(home, project_id) / "runs" / run_id


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _transaction(conn: sqlite3.Connection):
    """Context manager for a BEGIN IMMEDIATE … COMMIT/ROLLBACK block."""
    import contextlib

    @contextlib.contextmanager
    def _ctx():
        conn.execute("BEGIN IMMEDIATE")
        try:
            yield conn
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise

    return _ctx()


def _write_json_atomic(path: Path, data: Any) -> None:
    """Write *data* as JSON to *path* atomically (tmp → rename)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, default=str))
    tmp.replace(path)


def _append_lines(path: Path, lines: list[str]) -> None:
    """Append JSONL lines to *path*, creating it if necessary."""
    if not lines:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        for line in lines:
            f.write(line)
            f.write("\n")


def _sha256_file(path: Path) -> str:
    """Return the lowercase hex SHA-256 digest of a file."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _sha256_path(path: Path) -> str:
    """Return sha256 of the path string itself (for dataset fingerprinting)."""
    return hashlib.sha256(str(path).encode()).hexdigest()


def _artifact_blob_path(home: Path, project_id: str, sha: str) -> Path:
    return proj_dir(home, project_id) / "artifacts" / sha[:2] / sha[2:4] / sha


def _jsonl_to_parquet(jsonl_path: Path, parquet_path: Path) -> None:
    """Convert a metrics/resources JSONL file to Parquet long format.

    Schema: step INT64, wall_ms INT64, metric STRING, value DOUBLE.
    Silently skips if the JSONL doesn't exist or pyarrow is unavailable.
    """
    if not jsonl_path.exists():
        return
    try:
        import pyarrow as pa  # type: ignore[import]
        import pyarrow.parquet as pq  # type: ignore[import]
    except ImportError:
        log.debug("pyarrow not available — skipping Parquet finalization")
        return

    steps: list[int] = []
    wall_ms_list: list[int] = []
    metrics: list[str] = []
    values: list[float] = []

    try:
        with jsonl_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                step = int(row.get("step", 0))
                wm = int(row.get("wall_ms", 0))
                for k, v in row.items():
                    if k in ("step", "wall_ms"):
                        continue
                    try:
                        fv = float(v)
                    except (TypeError, ValueError):
                        continue
                    steps.append(step)
                    wall_ms_list.append(wm)
                    metrics.append(k)
                    values.append(fv)
    except Exception as exc:
        log.warning("could not read %s for Parquet conversion: %s", jsonl_path, exc)
        return

    if not steps:
        return

    table = pa.table(
        {
            "step": pa.array(steps, type=pa.int64()),
            "wall_ms": pa.array(wall_ms_list, type=pa.int64()),
            "metric": pa.array(metrics, type=pa.string()),
            "value": pa.array(values, type=pa.float64()),
        }
    )
    tmp = parquet_path.with_suffix(".tmp.parquet")
    pq.write_table(table, str(tmp), compression="snappy")
    tmp.replace(parquet_path)
    try:
        jsonl_path.unlink()
    except Exception:
        pass
