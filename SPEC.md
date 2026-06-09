# runtrail — Implementation Specification

> A local-first experiment tracker for solo ML researchers.
> This document is the **complete build spec** for runtrail. It is intentionally exhaustive: every section is self-contained enough that a coding agent can be pointed at it and produce a working implementation. Read top-to-bottom for orientation; jump to a specific phase or section to implement it.

---

## Table of contents

0. [Document conventions](#0-document-conventions)
1. [Product overview](#1-product-overview)
2. [Architecture](#2-architecture)
3. [Repository layout](#3-repository-layout)
4. [Storage layer (the contract)](#4-storage-layer-the-contract)
   - 4.1 On-disk layout
   - 4.2 SQLite schema
   - 4.3 Metrics format (JSONL → Parquet)
   - 4.4 Resource samples
   - 4.5 Event log
   - 4.6 Artifacts (content-addressed)
   - 4.7 Source snapshots
   - 4.8 IDs, hashing, atomicity
5. [Python SDK](#5-python-sdk)
   - 5.1 Public API
   - 5.2 Lifecycle
   - 5.3 Auto-capture
   - 5.4 Async write pipeline
   - 5.5 Resource sampler
   - 5.6 Concurrency, signals, crash safety
   - 5.7 Configuration & environment
   - 5.8 Packaging
6. [Go core: CLI + server](#6-go-core-cli--server)
   - 6.1 Binary layout
   - 6.2 Configuration & project resolution
   - 6.3 Domain types
   - 6.4 Storage access layer
   - 6.5 CLI commands
   - 6.6 HTTP API
   - 6.7 WebSocket protocol
   - 6.8 Live update fan-out
   - 6.9 Frontend embedding
   - 6.10 Read-only vs mutation mode
7. [Frontend](#7-frontend)
   - 7.1 Stack
   - 7.2 Routing & state
   - 7.3 Data layer
   - 7.4 Pages
   - 7.5 Keyboard model
   - 7.6 Production build pipeline
8. [Diff engine](#8-diff-engine)
9. [Reproducibility tooling (phase 2)](#9-reproducibility-tooling-phase-2)
10. [Sync (phase 2)](#10-sync-phase-2)
11. [Framework integrations (phase 2)](#11-framework-integrations-phase-2)
12. [Non-functional budgets](#12-non-functional-budgets)
13. [Testing strategy](#13-testing-strategy)
14. [Release & distribution](#14-release--distribution)
15. [Phased delivery plan](#15-phased-delivery-plan)
16. [Glossary](#16-glossary)

---

## 0. Document conventions

- **FR-x.y** refers to requirement IDs from the functional requirements document.
- **MUST / SHOULD / MAY** follow RFC 2119 semantics.
- Code blocks marked `python`, `go`, `sql`, `json` are normative — implementations must match the schema/signature shown.
- Snippets marked `pseudocode` are illustrative only.
- File paths starting with `~/.runtrail/` are absolute on the user's machine.
- Repository-relative paths are written without a leading slash, e.g. `cmd/runtrail/main.go`.

---

## 1. Product overview

### 1.1 Vision

A single-binary, local-first experiment tracking tool for solo ML researchers. Where W&B optimizes for organizations, runtrail optimizes for the individual researcher running 50–500 experiments and needing to understand *what changed between them*.

### 1.2 Target user

- **Primary**: solo ML researchers (grad students, independent researchers, small-lab members).
- **Secondary**: ML engineers prototyping before scaling up.
- **Anti-persona**: large teams needing RBAC, audit logs, hosted dashboards. Do not build for them.

### 1.3 Core value propositions (priority order)

1. **Zero setup** — one binary, one `pip install`, one decorator. No account, no cloud, no config required.
2. **Diff-first UX** — comparing two runs is the central operation.
3. **Full reproducibility capture** — code, env, hardware, data hashes, captured automatically.
4. **Owns your data** — everything lives in a local SQLite/file store the user can `grep`, `git`, or back up.
5. **Optional sync** — self-hostable sync server for cross-machine use; never required.

### 1.4 Non-goals

- Multi-user collaboration, permissions, teams.
- Hosted SaaS offering (v1 is OSS-first).
- Hyperparameter sweep orchestration (integrate, don't rebuild).
- Production model monitoring.
- Marketing-style dashboards for stakeholders.

---

## 2. Architecture

### 2.1 Component split

```
┌────────────────────┐        writes        ┌────────────────────────┐
│  Python SDK        │ ───────────────────► │  ~/.runtrail/          │
│  (`runtrail` pkg)  │                      │   ├─ runtrail.db       │
│  - logging API     │                      │   ├─ <proj>/runs/<id>/ │
│  - auto-capture    │                      │   ├─ <proj>/artifacts/ │
│  - resource sampler│                      │   └─ <proj>/snapshots/ │
└────────────────────┘                      └────────────────────────┘
                                                         ▲
                                                  reads  │  reads/writes (mutation mode)
                                                         │
┌──────────────────────────────────────────────────────────────────┐
│  Go binary  `runtrail`                                           │
│  ┌────────────┐  ┌───────────────┐  ┌──────────────────────────┐ │
│  │  CLI       │  │ HTTP API      │  │  WebSocket fan-out       │ │
│  │  (cobra)   │  │ (chi/echo)    │  │  (gorilla/ws or stdlib)  │ │
│  └────────────┘  └───────────────┘  └──────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  embedded SPA (//go:embed dist/*)                            │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 Key principles

1. **Storage is the contract.** The Python SDK writes to `~/.runtrail/`. The Go binary reads (and, in mutation mode, writes) the same files. Neither component depends on the other being running. Both versions can be developed and released independently as long as the on-disk format is honored.
2. **Pure-Go where possible.** Use `modernc.org/sqlite` (pure-Go SQLite, no cgo) so cross-compilation is one command. This is non-negotiable for FR-NFR-4 (binary <50MB) and clean cross-platform builds.
3. **Append-only metrics during a run.** Active runs append JSONL; finalize to Parquet on completion. This makes live tailing trivial and crash recovery automatic.
4. **Content-addressed artifacts.** SHA-256 of the file is the storage key; same file across runs is stored once.
5. **No network calls by default.** The SDK never opens a socket unless sync is explicitly enabled. The server only listens on `127.0.0.1` (configurable, but loopback by default).

### 2.3 Reasoning about phases (anchors implementation order)

- **Phase 1**: SDK writes correct on-disk data. CLI can `ls` / `show` / `rm` / `export`.
- **Phase 2**: Server + UI render that data read-only.
- **Phase 3**: Diff (CLI + UI).
- **Phase 4**: Live runs (WebSocket).
- **Phase 5**: Mutations (notes, tags, delete from UI).
- **Phase 6 (post-MVP)**: Reproduce, sync, framework callbacks.

---

## 3. Repository layout

```
runtrail/
├── go.mod
├── go.sum
├── cmd/
│   └── runtrail/
│       └── main.go                 ← CLI entrypoint, wires cobra commands
├── internal/
│   ├── config/                     ← config resolution, ~/.runtrail/ paths
│   ├── store/                      ← SQLite + Parquet + filesystem access
│   │   ├── schema.go               ← embedded schema.sql + migrations
│   │   ├── projects.go
│   │   ├── runs.go
│   │   ├── metrics.go              ← JSONL tail + Parquet finalize/read
│   │   ├── artifacts.go
│   │   └── events.go
│   ├── domain/                     ← pure types (Run, Project, Metric, ...)
│   ├── diff/                       ← diff computation
│   ├── cli/                        ← cobra subcommands (one file each)
│   │   ├── ls.go
│   │   ├── show.go
│   │   ├── diff.go
│   │   ├── rm.go
│   │   ├── export.go
│   │   ├── import.go
│   │   ├── ui.go
│   │   └── reproduce.go
│   ├── server/
│   │   ├── server.go               ← HTTP setup, middleware, routes
│   │   ├── api_runs.go
│   │   ├── api_diff.go
│   │   ├── api_projects.go
│   │   ├── api_views.go
│   │   ├── ws.go                   ← WebSocket hub + per-run channels
│   │   └── watcher.go              ← inotify/fsevents on ~/.runtrail/
│   └── version/version.go
├── web/                            ← frontend source
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx
│   │   ├── api/
│   │   ├── pages/
│   │   ├── components/
│   │   └── styles/
│   └── dist/                       ← built static files (gitignored, embedded via //go:embed)
├── sdk/                            ← Python SDK source
│   ├── pyproject.toml
│   ├── runtrail/
│   │   ├── __init__.py             ← top-level API (init, run, log_artifact, ...)
│   │   ├── _run.py                 ← Run class
│   │   ├── _store.py               ← SQLite + JSONL writers
│   │   ├── _capture/               ← auto-capture modules
│   │   │   ├── git.py
│   │   │   ├── env.py
│   │   │   ├── hardware.py
│   │   │   ├── source.py
│   │   │   └── resources.py
│   │   ├── _queue.py               ← background write thread + queue
│   │   ├── _ids.py
│   │   └── integrations/           ← phase 2: lightning, hf, keras, tbx
│   └── tests/
├── design/                         ← original handoff bundle (prototype)
├── docs/
│   ├── cli.md
│   ├── sdk.md
│   ├── schema.md                   ← human-readable SQLite/Parquet schema (FR-5.4)
│   └── architecture.md
├── scripts/
│   ├── build.sh                    ← build web → embed → build go binary
│   └── release.sh
├── SPEC.md                         ← this file
├── README.md
└── LICENSE                         ← Apache-2.0
```

### 3.1 Module names

- Go module: `github.com/<org>/runtrail`
- Python package: `runtrail` (PyPI name `runtrail`)
- CLI binary: `runtrail`

---

## 4. Storage layer (the contract)

This is the single most important section of the spec. The SDK writes this format; the Go binary reads it. Both sides must agree exactly.

### 4.1 On-disk layout

```
~/.runtrail/
├── runtrail.db                     ← SQLite, all metadata (projects, runs, artifacts, tags, ...)
├── runtrail.db-wal
├── runtrail.db-shm
├── config.toml                     ← global config (theme, default project, sync URL)
└── projects/
    └── <project_id>/               ← project_id is the slug of the project name
        ├── runs/
        │   └── <run_id>/
        │       ├── meta.json       ← human-readable cached snapshot of the row
        │       ├── metrics.jsonl   ← appended live; finalized at run end
        │       ├── metrics.parquet ← written at run end (replaces .jsonl)
        │       ├── resources.jsonl
        │       ├── resources.parquet
        │       ├── events.jsonl
        │       ├── stdout.log
        │       ├── stderr.log
        │       ├── hparams.json
        │       ├── env.json        ← python+packages+cuda+hardware+os
        │       ├── git_diff.patch  ← uncommitted diff at run start (if dirty)
        │       └── source/         ← snapshot of entry script + imported local modules
        ├── artifacts/
        │   └── <sha256[:2]>/<sha256[2:4]>/<sha256> ← content-addressed blob
        └── snapshots/
            └── <commit_hash>/      ← optional: git archive of clean commits, deduped
```

**Path rules**:
- `<project_id>` is `slugify(project_name)`: lowercase, ASCII, `[a-z0-9-]+`, max 64 chars. Collisions resolved by appending `-<short_uuid>`.
- `<run_id>` is `run-<8 hex chars>` (e.g. `run-a1f3c2b4`), unique across all projects. Generated client-side; collisions trigger regeneration.
- `<sha256>` is the lowercase 64-char hex digest.

### 4.2 SQLite schema

All schema lives in `internal/store/schema.sql`, embedded into the Go binary via `//go:embed`. Migrations are linear and stored in `internal/store/migrations/NNNN_name.sql`.

```sql
-- schema_version 1

CREATE TABLE schema_version (
  version  INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL  -- unix seconds
);

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,        -- slug
  name        TEXT NOT NULL,
  path        TEXT,                    -- the CWD where the project was first seen
  description TEXT,
  default_tags TEXT,                   -- JSON array
  baselines   TEXT,                    -- JSON array of run_ids
  saved_views TEXT,                    -- JSON array of {id,name,query}
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE runs (
  id              TEXT PRIMARY KEY,    -- run-<8 hex>
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL,       -- running | done | failed | killed
  started_at      INTEGER NOT NULL,    -- unix seconds
  ended_at        INTEGER,
  duration_s      REAL,
  user            TEXT,
  host            TEXT,
  pid             INTEGER,             -- training process pid (for stop signal)
  branch          TEXT,
  commit_hash     TEXT,
  dirty           INTEGER DEFAULT 0,   -- 0/1: uncommitted changes present
  cmd             TEXT,                -- full argv joined
  exit_code       INTEGER,
  error           TEXT,                -- short error message if failed
  notes           TEXT,
  pinned          INTEGER DEFAULT 0,
  -- denormalized JSON for fast reads (full data still in files on disk)
  hparams_json    TEXT,                -- {"lr": 0.1, ...}
  final_json      TEXT,                -- {"val_acc": 0.78, "val_loss": 0.83}
  hardware_json   TEXT,                -- {"gpu": "...", "count": 4, "cpu": "...", "ram": "..."}
  env_json        TEXT,                -- {"python": "3.11.7", "cuda": "12.1"}
  dataset         TEXT,
  dataset_hash    TEXT
);
CREATE INDEX runs_project_started ON runs(project_id, started_at DESC);
CREATE INDEX runs_status          ON runs(status);
CREATE INDEX runs_pinned          ON runs(pinned) WHERE pinned = 1;

CREATE TABLE tags (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  tag    TEXT NOT NULL,
  PRIMARY KEY (run_id, tag)
);
CREATE INDEX tags_tag ON tags(tag);

CREATE TABLE artifacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,           -- user-visible name, e.g. "best.ckpt"
  type        TEXT,                    -- model | checkpoint | image | text | json | yaml | binary
  size_bytes  INTEGER NOT NULL,
  sha256      TEXT NOT NULL,           -- file location: <project>/artifacts/<sha[:2]>/<sha[2:4]>/<sha>
  created_at  INTEGER NOT NULL,
  UNIQUE (run_id, name)
);
CREATE INDEX artifacts_run    ON artifacts(run_id);
CREATE INDEX artifacts_sha256 ON artifacts(sha256);

CREATE TABLE packages (                -- pip freeze, one row per package per run
  run_id  TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  version TEXT,
  PRIMARY KEY (run_id, name)
);

CREATE TABLE events (                  -- structured info/warn/error events
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  ts_ms   INTEGER NOT NULL,            -- ms since run start
  level   TEXT NOT NULL,               -- info | warn | error
  message TEXT NOT NULL
);
CREATE INDEX events_run_ts ON events(run_id, ts_ms);

-- Final metrics summary table for fast filter/sort across runs (FR-5.2).
-- Mirrors `final_json` in runs, but with one row per (run, metric_name) so we can
-- sort/filter on arbitrary metrics without parsing JSON.
CREATE TABLE final_metrics (
  run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  value       REAL,
  best        REAL,
  last        REAL,
  step_count  INTEGER,
  PRIMARY KEY (run_id, name)
);
CREATE INDEX final_metrics_name_value ON final_metrics(name, value);
```

**Notes:**

- Use SQLite in WAL mode (`PRAGMA journal_mode=WAL`) for safe concurrent reads while the SDK writes.
- `PRAGMA foreign_keys=ON` on every connection (SQLite default is off).
- Both the SDK (Python) and the Go binary open the same DB. Writes from Python must be batched into short transactions so the Go reader is never blocked for long.
- All times are unix seconds in INTEGER columns. Metrics time series uses milliseconds since run start in a STEP column (see 4.3).

### 4.3 Metrics format

**During a run** — SDK appends to `metrics.jsonl` after each `run.log(...)` call. One JSON object per line:

```json
{"step": 12, "wall_ms": 8421, "loss": 6.92, "acc": 0.014}
```

- `step` (int64): training step index passed by the user. If omitted, the SDK assigns a monotonic counter.
- `wall_ms` (int64): wall-clock ms since `run.start_time`.
- All other keys are user-supplied metric names with float values.
- Lines are flushed every N entries (default 50) or every T ms (default 1000), whichever comes first. On `run.finish()`, the queue is drained.

**On run end** — SDK reads `metrics.jsonl`, writes `metrics.parquet`, then deletes the JSONL. Parquet schema:

```
step       INT64
wall_ms    INT64
metric     STRING       -- long format: one row per (step, metric)
value      DOUBLE
```

Long format keeps the schema fixed regardless of which metrics the user logs. The Go reader pivots to wide format when serving the API.

**Crash recovery** — if `metrics.parquet` is missing but `metrics.jsonl` exists, the Go reader serves directly from JSONL. A periodic background job (server-side, on `runtrail ui` boot) finalizes JSONL → Parquet for any orphaned runs whose status is no longer `running`.

### 4.4 Resource samples

Same format as metrics, separate file: `resources.jsonl` → `resources.parquet`. Sampled at `resource_interval` seconds (default 15.0, FR-2.8 configurable).

Fixed columns per sample:
```json
{"wall_ms": 8421, "cpu_pct": 42.1, "ram_pct": 63.0, "ram_used_bytes": 12345,
 "gpu_count": 4, "gpus": [{"util": 94, "mem_pct": 81, "mem_used_bytes": 12345, "temp_c": 71}, ...],
 "disk_read_bps": 142000000, "disk_write_bps": 12000000}
```

Long format Parquet: `(wall_ms, gpu_id, metric, value)` where `gpu_id` is `-1` for system-level metrics.

### 4.5 Event log

`events.jsonl` is structured info/warn/error events emitted either by the SDK (`run.event("warn", "data loader stalled 4.1s")`) or by the system (checkpoint saved, etc.):

```json
{"wall_ms": 13540, "level": "warn", "message": "data loader stalled 4.1s — workers idle"}
```

Mirrored to the `events` SQLite table for query.

stdout/stderr are captured raw to `stdout.log` / `stderr.log` (tail-able for the live UI).

### 4.6 Artifacts (content-addressed)

When the SDK is asked to log an artifact:

1. Stream the file through SHA-256.
2. Compute the destination path: `~/.runtrail/projects/<proj>/artifacts/<sha[:2]>/<sha[2:4]>/<sha>`.
3. If destination doesn't exist, atomically move/copy the file into place (rename within same FS, copy across FSes).
4. Insert a row into `artifacts` linking `run_id` + `name` + `sha256`.

Result: identical files across runs are stored exactly once. Deletion of a run **must** check for other references before deleting the blob (`SELECT COUNT(*) FROM artifacts WHERE sha256 = ?`).

Artifact types (`type` column): `model`, `checkpoint`, `image`, `text`, `json`, `yaml`, `binary`. Default `binary`. Used only to drive preview rendering in the UI.

### 4.7 Source snapshots

At run start, if `capture_source=True` (default):

1. SDK identifies the **entry script** (`sys.argv[0]` resolved to absolute) and recursively walks its imports to find all `*.py` files **inside the project root** (the CWD or a configured root).
2. Each file is copied to `runs/<run_id>/source/<relative_path>`.
3. If the working tree is clean (`git status --porcelain` empty) and `capture_source_via_git=True`, the SDK skips the file copy and records only `commit_hash`. The Go server, when asked for the source tree, resolves it via `git show` against the configured remote/local repo path.

**Why both modes**: clean checkpoint = just point at git, save disk. Dirty tree = snapshot the actual files because the working state can't be reconstructed.

### 4.8 IDs, hashing, atomicity

- **Run IDs**: `run-<8 hex>` where the hex is `sha256(run_name + start_time_ns + pid + hostname)[:8]`. On collision, retry with random entropy.
- **Project IDs**: slug of the project name; collisions resolved by appending `-<5 hex>`.
- **Atomic file writes**: write to `<path>.tmp` then `rename` (POSIX atomic on same FS). All on-disk JSON files (`meta.json`, `hparams.json`, etc.) follow this pattern.
- **SQLite writes**: always inside `BEGIN IMMEDIATE` ... `COMMIT` to serialize writers; short transactions (<10ms typical).
- **No partial states visible**: a run row is inserted only after the run directory is created and `meta.json` is written.

---

## 5. Python SDK

### 5.1 Public API

```python
# package: runtrail

def init(
    project: str | None = None,        # default: slug of cwd basename
    name: str | None = None,           # default: <model_or_script>-<short_uid>
    config: dict | None = None,        # hyperparameters
    tags: list[str] | None = None,
    notes: str | None = None,
    dir: str | None = None,            # storage root, default $RUNTRAIL_HOME or ~/.runtrail
    capture_source: bool = True,
    capture_env: bool = True,
    capture_hardware: bool = True,
    capture_git: bool = True,
    resource_interval: float = 15.0,   # seconds; 0 disables
    mode: str = "online",              # "online" | "disabled" — both local; "disabled" is no-op
    reinit: bool = False,              # allow nested init in the same process
) -> "Run": ...

def run(**kwargs) -> "Run":            # context manager wrapper
    """with runtrail.run(...) as r: ..."""

def login(*args, **kwargs):            # raises NotImplementedError in v1
    """Placeholder for sync-server auth in phase 2."""
```

The returned `Run` object:

```python
class Run:
    id: str
    name: str
    project: str
    dir: pathlib.Path                  # the run dir on disk

    def log(self, values: dict[str, float], step: int | None = None,
            commit: bool = True) -> None: ...
    def log_artifact(self, path: str | os.PathLike,
                     name: str | None = None,
                     type: str = "binary") -> str: ...   # returns sha256
    def log_image(self, key: str, img, step: int | None = None) -> None: ...
    def log_figure(self, key: str, fig, step: int | None = None) -> None: ...
    def log_table(self, key: str, rows, columns) -> None: ...
    def use_dataset(self, path: str | os.PathLike, name: str | None = None) -> str: ...
    def add_tag(self, *tags: str) -> None: ...
    def add_note(self, text: str) -> None: ...
    def set_summary(self, key: str, value: float) -> None: ...   # writes final_metrics
    def event(self, level: str, message: str) -> None: ...
    def finish(self, status: str = "done", error: str | None = None) -> None: ...
    def __enter__(self) -> "Run": ...
    def __exit__(self, exc_type, exc_val, exc_tb) -> None: ...   # auto-finish
```

`log()` accepts only **JSON-scalar values** (int, float, bool, None). Non-scalars raise `TypeError` — point users at `log_image` / `log_table` / `log_artifact` instead.

### 5.2 Lifecycle

```
init() ─► allocate run_id ─► create run dir ─► write meta.json
        ─► capture (git, env, hw, source) ─► insert SQLite row (status=running)
        ─► start sampler thread ─► start writer thread
        ─► install atexit + SIGTERM/SIGINT handlers ─► return Run

run.log()/log_artifact()/... ─► enqueue ─► writer thread persists

finish() ─► flush queue ─► stop sampler ─► finalize JSONL→Parquet
        ─► update SQLite row (status=done|failed|killed, ended_at, duration_s, final_json)
        ─► cleanup handlers
```

**Implicit finish on crash**: the atexit handler calls `finish(status="failed", error=str(exc))` if the run was not finished explicitly. SIGTERM/SIGINT mark `killed`. The handler is registered last to run first.

### 5.3 Auto-capture

Each module under `sdk/runtrail/_capture/`:

- **`git.py`** — runs `git rev-parse HEAD`, `git rev-parse --abbrev-ref HEAD`, `git status --porcelain`, `git diff HEAD`. Failures (no git, no repo) are recorded as `commit=null`. Diff is saved to `git_diff.patch`.
- **`env.py`** — captures `sys.version_info`, `sys.executable`, `os.environ['VIRTUAL_ENV']` or conda info, then runs `python -m pip freeze` (or reads installed dists via `importlib.metadata.distributions()` for speed — preferred, no subprocess). Result written to `env.json` and `packages` table.
- **`hardware.py`** — CPU model (`/proc/cpuinfo` on Linux, `sysctl -n machdep.cpu.brand_string` on macOS, registry on Windows), total RAM (`psutil.virtual_memory`), GPU info via `pynvml` if available, else parse `nvidia-smi --query-gpu=...`, OS info via `platform.platform()` and `os.uname()`.
- **`source.py`** — discovers Python files imported from inside the project root. Implementation: install a `sys.meta_path` finder *before* user imports (or, simpler: traverse `sys.modules` after `init()` returns and snapshot each module whose `__file__` lives under the project root). The project root defaults to CWD; configurable via env var.
- **`resources.py`** — sampler thread; see 5.5.

All capture functions must **never raise**. They log warnings via `logging` and return partial data on failure.

### 5.4 Async write pipeline

To meet **NFR-1 (<1% overhead)**, all I/O happens off the hot path:

```
                  user thread                     writer thread
                  ───────────                     ─────────────
run.log(values) ──► queue.put(LogEntry)           queue.get() ───► append JSONL
                                                                ───► batch insert
                                                                     events / metrics
```

- A single background `threading.Thread(daemon=True)` consumes a bounded `queue.Queue` (default `maxsize=10_000`).
- Each entry is one of: `LogScalars`, `LogEvent`, `LogArtifactRef`, `Heartbeat`, `Finalize`.
- The writer batches up to 50 entries or 100ms, whichever first, into a single SQLite transaction and JSONL `write()` syscall.
- `run.log(...)` is non-blocking — it puts and returns. If the queue is full (slow disk, busy writer), `log()` drops the entry and increments a `dropped_metrics` counter, then re-attempts on next call. **Never block the training loop.**
- Optional `run.log(..., commit=True)` flushes the queue synchronously (rare path; for users who want to ensure persistence at checkpoints).

### 5.5 Resource sampler

A separate daemon thread sampling at `resource_interval`:

```python
while not stop.is_set():
    sample = build_sample()
    writer_queue.put(sample)
    stop.wait(resource_interval)
```

If `pynvml` is available, NVML handles are opened once at sampler start. Failures (NVML init, GPU disappears) downgrade the sampler to CPU/RAM only, logged once.

### 5.6 Concurrency, signals, crash safety

- **Signals** (Linux/macOS): `SIGINT` and `SIGTERM` handlers mark the run `killed`, flush the queue, and re-raise the signal. On Windows, use `signal.signal(signal.SIGTERM, ...)` and `signal.signal(signal.SIGBREAK, ...)`.
- **atexit**: registered handler calls `finish()` if not already finished. Runs after the user's own atexit handlers (registered earlier).
- **Multiple processes**: runtrail is per-process. Distributed training (DDP) should call `runtrail.init()` only on rank 0. The SDK detects rank via `os.environ.get("RANK", "0")` and becomes a no-op on non-zero ranks unless `init(force=True)` is passed.
- **SQLite locking**: WAL mode + `BEGIN IMMEDIATE` for writes. Retries with exponential backoff on `SQLITE_BUSY` (max 5 retries, 50ms→800ms).

### 5.7 Configuration & environment

Resolution order (later overrides earlier):
1. Built-in defaults.
2. `~/.runtrail/config.toml`.
3. `./runtrail.toml` if present in CWD.
4. Environment variables (`RUNTRAIL_*`).
5. `init()` keyword arguments.

Key env vars:
- `RUNTRAIL_HOME` — storage root (default `~/.runtrail`).
- `RUNTRAIL_PROJECT` — default project name.
- `RUNTRAIL_DISABLED` — when set to `1`, all SDK calls are no-ops (for CI / testing).
- `RUNTRAIL_MODE` — `online` (default) | `disabled`.

### 5.8 Packaging

`sdk/pyproject.toml`:

```toml
[project]
name = "runtrail"
version = "0.1.0"
requires-python = ">=3.9"
dependencies = [
  "pyarrow>=14",      # parquet write
  "psutil>=5.9",      # cpu/ram sampling
]

[project.optional-dependencies]
gpu = ["pynvml>=11"]
matplotlib = ["matplotlib>=3.7"]
all = ["runtrail[gpu,matplotlib]"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

Avoid heavy default deps. `pyarrow` is the only large one; required for Parquet but ML environments usually have it.

---

## 6. Go core: CLI + server

### 6.1 Binary layout

Single binary `runtrail` (cross-compiled for linux/amd64, linux/arm64, darwin/amd64, darwin/arm64, windows/amd64).

Build constraints:
- Pure-Go SQLite (`modernc.org/sqlite`) — no cgo.
- Embedded SPA via `//go:embed web/dist/*`.
- Target size: <50MB stripped (`-ldflags="-s -w"`).

### 6.2 Configuration & project resolution

CLI flags shared across commands:
- `--home <path>`: override `$RUNTRAIL_HOME`.
- `--project <name>`: override auto-detected project.
- `--json`: machine-readable output where applicable.
- `-v/--verbose`: trace logs.

Auto-detection: if `--project` is not set, use the project whose `path` matches `$PWD` (or any ancestor). If multiple projects map to ancestors, prefer the deepest match. If none, fall back to slug of `basename($PWD)`.

### 6.3 Domain types

`internal/domain/` defines pure types:

```go
type Run struct {
    ID          string             `json:"id"`
    ProjectID   string             `json:"project_id"`
    Name        string             `json:"name"`
    Status      Status             `json:"status"`
    StartedAt   time.Time          `json:"started_at"`
    EndedAt     *time.Time         `json:"ended_at,omitempty"`
    DurationS   float64            `json:"duration_s"`
    User        string             `json:"user"`
    Host        string             `json:"host"`
    PID         int                `json:"pid"`
    Branch      string             `json:"branch"`
    Commit      string             `json:"commit"`
    Dirty       bool               `json:"dirty"`
    Cmd         string             `json:"cmd"`
    ExitCode    int                `json:"exit_code"`
    Error       string             `json:"error,omitempty"`
    Notes       string             `json:"notes"`
    Pinned      bool               `json:"pinned"`
    Tags        []string           `json:"tags"`
    HParams     map[string]any     `json:"hparams"`
    Final       map[string]float64 `json:"final"`
    Hardware    Hardware           `json:"hardware"`
    Env         Env                `json:"env"`
    Dataset     string             `json:"dataset"`
    DatasetHash string             `json:"dataset_hash"`
}

type Status string
const (
    StatusRunning Status = "running"
    StatusDone    Status = "done"
    StatusFailed  Status = "failed"
    StatusKilled  Status = "killed"
)

type MetricPoint struct {
    Step   int64              `json:"step"`
    WallMS int64              `json:"wall_ms"`
    Values map[string]float64 `json:"values"`   // wide format for API
}

type Project struct {
    ID          string   `json:"id"`
    Name        string   `json:"name"`
    Path        string   `json:"path"`
    Description string   `json:"description"`
    DefaultTags []string `json:"default_tags"`
    Baselines   []string `json:"baselines"`
    SavedViews  []SavedView `json:"saved_views"`
    Storage     Storage  `json:"storage"`
}
```

### 6.4 Storage access layer

`internal/store/` wraps `database/sql` and the filesystem.

```go
type Store struct {
    db   *sql.DB
    home string  // ~/.runtrail
}

func Open(home string) (*Store, error)
func (s *Store) Close() error

// Projects
func (s *Store) ListProjects(ctx) ([]Project, error)
func (s *Store) GetProject(ctx, id string) (Project, error)
func (s *Store) UpsertProject(ctx, p Project) error

// Runs
func (s *Store) ListRuns(ctx, RunFilter) ([]Run, error)
func (s *Store) GetRun(ctx, id string) (Run, error)
func (s *Store) UpdateRun(ctx, id string, patch RunPatch) error  // mutation mode
func (s *Store) DeleteRun(ctx, id string) error

// Metrics
func (s *Store) ReadMetrics(ctx, runID string, names []string) ([]MetricPoint, error)
func (s *Store) StreamMetrics(ctx, runID string, since int64, names []string) (<-chan MetricPoint, error)
func (s *Store) ReadResources(ctx, runID string) (Resources, error)
func (s *Store) ReadEvents(ctx, runID string, since int64) ([]Event, error)

// Artifacts
func (s *Store) ListArtifacts(ctx, runID string) ([]Artifact, error)
func (s *Store) OpenArtifact(ctx, runID, name string) (io.ReadCloser, int64, error)

// Source
func (s *Store) SourceTree(ctx, runID string) ([]SourceEntry, error)
func (s *Store) SourceFile(ctx, runID, path string) ([]byte, error)
```

`RunFilter` supports the full filter surface (status, tags, hparams ops, dates, free-text). The implementation translates the filter into a parameterized SQL query.

### 6.5 CLI commands

All commands are implemented as cobra subcommands under `internal/cli/`. Each command file exports a `func Cmd() *cobra.Command` wired up in `cmd/runtrail/main.go`.

#### `runtrail ls`
```
runtrail ls [--project <p>] [--status <s>] [--tag <t>] [--limit N] [--json]
```
Output (default, terminal):
```
ID            STATUS   NAME                       VAL_ACC  VAL_LOSS  STARTED
run-a1f3      done     resnet50-aug-cosine        75.9%    0.930     2h ago
run-b8e2      done     resnet50-aug-cosine-lr3e4  78.2%    0.830     1h ago
...
```
With `--json`, emits a JSON array of `Run` summaries (lean — no full hparams/env).

#### `runtrail show <run>`
Pretty-print full run details: hparams, env, hardware, final metrics, command line, tags, notes, artifact list. `--json` for full JSON. Supports prefix matching (`runtrail show a1f3` resolves to `run-a1f3...` if unambiguous).

#### `runtrail diff <a> <b> [<c> ...]`
Compute diff and print side-by-side. With `--only-diff`, hide identical fields. With `--baseline`, use the project's pinned baseline as `<a>`. See section 8 for the diff engine. `--json` emits the full diff payload (same one the API serves).

#### `runtrail rm <run> [--force]`
Prompts `Delete run X? [y/N]` unless `--force`. Removes the run dir, deletes the SQLite row, and decrements artifact reference counts. Artifacts with zero references are deleted from disk.

#### `runtrail export <run> [--output <dir>]`
Produces a self-contained directory containing:
- All files from `runs/<run_id>/`.
- All referenced artifacts (resolved by sha256, copied with original names).
- A `MANIFEST.json` describing what's inside.
- A `README.md` explaining how to re-import.

#### `runtrail import <path>`
Reverse of export. Reads `MANIFEST.json`, copies files into the current `~/.runtrail/` tree, resolving run ID collisions by re-hashing.

#### `runtrail ui [--port 0] [--mutations] [--open] [--host 127.0.0.1]`
Starts the HTTP server (section 6.6) on a free port (when `--port 0`), prints the URL, and optionally opens it in the default browser. `--mutations` enables write endpoints (FR-6.2).

#### `runtrail check` and `runtrail reproduce` — see section 9.

### 6.6 HTTP API

All routes are versioned under `/api/v1/`. JSON bodies and responses. Errors:

```json
{ "error": { "code": "not_found", "message": "run abc not found" } }
```

Codes: `bad_request`, `not_found`, `conflict`, `forbidden` (when mutations disabled), `internal`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/projects` | List projects |
| GET | `/api/v1/projects/:id` | Project details + saved views + baselines |
| PATCH | `/api/v1/projects/:id` | Update settings (mutation mode) |
| GET | `/api/v1/projects/:id/runs` | List runs. Query params: `status`, `tag` (repeatable), `q` (free text), `since`, `until`, `sort` (e.g. `started_at:desc`, `final.val_acc:desc`), `limit`, `cursor`. |
| GET | `/api/v1/runs/:id` | Full run details (everything denormalized) |
| PATCH | `/api/v1/runs/:id` | Body `{name?, notes?, tags?, pinned?}` (mutation mode) |
| DELETE | `/api/v1/runs/:id` | Delete run (mutation mode) |
| POST | `/api/v1/runs/:id/stop` | Send SIGTERM to `pid` (mutation mode, only if status=running) |
| GET | `/api/v1/runs/:id/metrics?names=loss,acc&smoothing=0.6&downsample=1000` | Time-series metrics, wide format |
| GET | `/api/v1/runs/:id/resources` | Resource samples |
| GET | `/api/v1/runs/:id/events?since=0` | Event log |
| GET | `/api/v1/runs/:id/logs?stream=stdout&tail=200` | stdout/stderr tail |
| GET | `/api/v1/runs/:id/artifacts` | Artifact list |
| GET | `/api/v1/runs/:id/artifacts/:name` | Download artifact (stream) |
| GET | `/api/v1/runs/:id/source/tree` | File tree of source snapshot |
| GET | `/api/v1/runs/:id/source/file?path=src/train.py` | File contents |
| GET | `/api/v1/runs/:id/packages` | Pip freeze |
| GET | `/api/v1/diff?ids=run-a,run-b[,run-c]&only_diff=true` | Multi-run diff payload |
| GET | `/api/v1/views` | Saved views (project-scoped) |
| POST | `/api/v1/views` | Save view (mutation mode) |
| DELETE | `/api/v1/views/:id` | Remove (mutation mode) |
| GET | `/api/v1/health` | `{ "ok": true, "version": "..." }` |

**Sorting on metrics** (FR-5.2): `sort=final.val_acc:desc` — the server reads from `final_metrics` table (indexed). For arbitrary `at-step-N`, the server computes from Parquet/JSONL on the fly and caches the result keyed by `(run_id, metric, step)`.

### 6.7 WebSocket protocol

Two endpoints:

#### `WS /api/v1/ws/runs`
Server-to-client broadcast of run-level events:
```json
{ "type": "run.created", "run": {...} }
{ "type": "run.updated", "id": "run-a1f3", "patch": {"status": "done", "duration_s": 19592} }
{ "type": "run.deleted", "id": "run-a1f3" }
```
Client opens once per session. Used to drive the run list and the live rail.

#### `WS /api/v1/ws/runs/:id`
Per-run live stream:
```json
{ "type": "metric", "step": 124, "wall_ms": 8421, "values": {"loss": 2.04, "acc": 0.508} }
{ "type": "resource", "wall_ms": 8421, "cpu_pct": 42, "gpus": [...] }
{ "type": "event", "wall_ms": 8421, "level": "warn", "message": "..." }
{ "type": "log", "stream": "stdout", "text": "epoch 41/300 step 50/1252 ..." }
{ "type": "status", "status": "done" }
```

**Subscription**: client can send `{"subscribe": ["metric", "event"]}` to filter. Default is all.

### 6.8 Live update fan-out

The Go server cannot poll the database on every WS tick (would dominate CPU). Mechanism:

1. **fsnotify** watcher on `~/.runtrail/projects/*/runs/*/`.
2. New file or write to `*.jsonl` triggers a delta read: server seeks from last known offset and parses new lines.
3. Parsed entries are broadcast to all subscribers of that run via an in-memory hub (channel per subscriber, fan-out via select).
4. SQLite-level changes (status transitions) detected by polling `runs.updated_at` once per second — cheap, single query.

On most platforms, fsnotify provides inotify (Linux), FSEvents (macOS), or ReadDirectoryChangesW (Windows). Pure Go: `github.com/fsnotify/fsnotify`.

### 6.9 Frontend embedding

`web/dist/` is built by Vite (section 7.6) and embedded into the binary:

```go
//go:embed all:web/dist
var webFS embed.FS
```

The server mounts it at `/` with index fallback (SPA mode — any non-`/api/` path serves `index.html`).

**Build flow**: `scripts/build.sh` runs `pnpm --filter web build` (or npm/yarn equivalent), then `go build -ldflags="-s -w" ./cmd/runtrail`. CI verifies `web/dist/` exists before the Go build.

### 6.10 Read-only vs mutation mode

Default = read-only. All `PATCH`, `POST`, `DELETE` endpoints respond 403 with:
```json
{"error":{"code":"forbidden","message":"mutations disabled; start with --mutations"}}
```

`--mutations` flag flips a server boolean checked in a middleware before any write handler.

---

## 7. Frontend

The handoff bundle in `design/runtrail-ui/project/` is the visual reference. The production frontend reproduces it in a structured codebase.

### 7.1 Stack

- **Vite + React 18 + TypeScript**.
- **No CSS framework** — keep the CSS variables / inline-style approach from the prototype. The look is deliberate.
- **State**: local component state + a few Zustand stores (`projectStore`, `runsStore`, `wsStore`). No Redux.
- **Data fetching**: TanStack Query (React Query) — handles caching, dedup, retries, and pairs well with WebSocket invalidation.
- **Charts**: hand-rolled SVG (the prototype's `LineChart` and `Sparkline`) — small, fast, themeable. Switch to a library only if a need arises.
- **Routing**: hash-based for v1 (matches prototype; works under any path prefix). Migrate to history API only if needed.

### 7.2 Routing & state

Routes (hash):
- `#/` — run list
- `#/runs/:id` — run detail
- `#/live/:id` — live run view
- `#/diff?ids=a,b[,c]` — diff
- `#/settings` — project settings

A `useRoute()` hook parses the hash (already implemented in `app.jsx`'s `parseHash`).

### 7.3 Data layer

`src/api/client.ts`:

```ts
export const api = {
  listRuns: (params) => http.get('/api/v1/projects/.../runs', params),
  getRun:   (id) => http.get(`/api/v1/runs/${id}`),
  getMetrics: (id, names) => http.get(`/api/v1/runs/${id}/metrics`, { names }),
  diff: (ids) => http.get('/api/v1/diff', { ids: ids.join(',') }),
  patchRun: (id, patch) => http.patch(`/api/v1/runs/${id}`, patch),
  // ...
};
```

WebSocket client:

```ts
export const ws = {
  subscribeRuns(onEvent),       // global feed
  subscribeRun(id, onEvent),    // per-run
};
```

React Query keys: `['runs', filter]`, `['run', id]`, `['metrics', id, names]`. WS events invalidate the relevant keys.

### 7.4 Pages

Each page maps to a file under `src/pages/`. The prototype's JSX files are the visual template — port them, replacing `window.RT_DATA` accesses with React Query hooks.

| Page | Prototype file | New file | Notes |
|---|---|---|---|
| RunList | `src/run-list.jsx` | `src/pages/RunList.tsx` | All filtering/sorting client-side for ≤1000 runs; server-side at higher counts |
| RunDetail | `src/run-detail.jsx` | `src/pages/RunDetail.tsx` | Tabs: overview, metrics, code, artifacts, resources, raw |
| LiveRun | `src/live-run.jsx` | `src/pages/LiveRun.tsx` | Subscribes to per-run WS |
| Diff | `src/diff-view.jsx` | `src/pages/Diff.tsx` | Reads `/api/v1/diff` |
| Settings | `src/project-settings.jsx` | `src/pages/Settings.tsx` | Hits `/api/v1/projects/:id` |
| App shell | `src/app.jsx` | `src/App.tsx` | Top bar, command palette, shortcuts overlay |

Shared components (`src/components/`): `StatusDot`, `LineChart`, `Sparkline`, `KBD`, `Tag`, `Btn`, `IconBtn`, `Checkbox`, `Toast`, etc. — all already present in `src/components.jsx`.

### 7.5 Keyboard model

Preserve the prototype's keybindings exactly. They are documented in `src/data.jsx` `SHORTCUTS` and rendered by the `?` overlay. Bind them in a central `useKeybindings()` hook that handles context (focus is in an input → disable global keys).

### 7.6 Production build pipeline

```bash
cd web
pnpm install
pnpm build      # → web/dist/
```

`vite.config.ts` sets `base: './'` so the embedded assets resolve under any path. Output is split: a small `index.html`, hashed `assets/*.js`, hashed `assets/*.css`. Total bundle target <500KB gzipped.

The Go binary picks up `web/dist` via `//go:embed`. CI gates: `pnpm build` must succeed before `go build`.

---

## 8. Diff engine

Lives in `internal/diff/`. Pure Go, no I/O — takes two (or N) `Run` objects (already loaded from store) and returns a `DiffReport`.

```go
type DiffReport struct {
    HParams  HParamDiff
    Code     CodeDiff
    Env      EnvDiff
    Hardware HardwareDiff
    Metrics  MetricsDiff
    Data     DataDiff
    Insight  Insight    // smart highlighting
}

type HParamDiff struct {
    Added   map[string]any
    Removed map[string]any
    Changed map[string][2]any  // [a_value, b_value]
    Same    map[string]any
}

type Insight struct {
    Winner       string   // "A" | "B" | "tie"
    DeltaMetric  string   // "val_acc"
    DeltaValue   float64
    DeltaPct     float64
    Likely       []string // ranked candidate explanations: "optimizer changed sgd→adamw", ...
    Confidence   float64  // 0..1
}
```

### 8.1 Smart highlighting (FR-4.3) — heuristics

Ranked candidates from most to least impactful:
1. **Different optimizer** → confidence high.
2. **Learning rate differs by ≥10×** → confidence high.
3. **Different scheduler** → confidence medium-high.
4. **Different dataset hash** → confidence very high (this is almost certainly why).
5. **Different model architecture (inferred from `name` or `hparams.model`)** → high.
6. **Different seed only** → low (variance, not a cause).
7. **Different hardware (GPU model)** → low for accuracy, possibly high for speed.
8. **Package version drift** (esp. torch, numpy) → medium.

Confidence is a coarse function of (number of candidates) and (magnitude of metric delta). This is intentionally rough in v1 — we are not running a regression. Document this clearly in the UI ("Heuristic — verify by isolating one change at a time").

### 8.2 Code diff

Compute by invoking `git diff <commit_a> <commit_b>` against the project's git repo. If the repo isn't available, fall back to byte-level diff of the source snapshots stored under each run's `source/` dir.

### 8.3 N-way diff

For `N ≥ 3`, render as a transposed table: rows = parameters, columns = runs. The Go side returns a `MultiDiffReport` with the union of keys; the UI renders it.

---

## 9. Reproducibility tooling (phase 2)

### 9.1 `runtrail reproduce <run> [--docker] [--output <dir>]`

Generates a script that recreates the environment of `<run>`:
- `Dockerfile` (if `--docker`) pinned to the captured Python + CUDA versions.
- `requirements.txt` from the `packages` table.
- `setup.sh` that clones the repo at the captured commit (if remote known) or unpacks `source/`.
- A `run.sh` with the captured command line.

### 9.2 `runtrail check [--against <run>]`

Compares the *current* environment to a captured run. Reports drift: package versions, python version, CUDA, hardware. Exit code 0 if identical, 1 if drift detected. With no `--against`, uses the project's pinned baseline.

### 9.3 Baselines

Settings page allows pinning runs as baselines (FR-4.5). Stored as `projects.baselines` JSON array. Used by:
- `runtrail check` default target.
- Diff view default `<a>`.
- Sidebar reference run list (already in prototype).

---

## 10. Sync (phase 2)

Out of MVP. Architectural placeholders:

- `runtrail sync push [--project p]` / `runtrail sync pull [--project p]`.
- `runtrail-sync` — separate binary, a thin HTTP server accepting authenticated push/pull of run directories.
- **Conflicts**: runs are immutable, so the only conflict is on `notes`/`tags`/`pinned`. Last-write-wins by `updated_at`.
- **Auth**: bearer token, set via `runtrail config sync.token <token>`. No central account system.
- **Telemetry**: zero. No analytics, no ping-home, no crash reporter that calls out (FR-9.4).

---

## 11. Framework integrations (phase 2)

Each integration is a small adapter that turns framework callbacks into `run.log(...)` calls.

- `runtrail.integrations.lightning.RuntrailLogger` — implements `pytorch_lightning.loggers.Logger`.
- `runtrail.integrations.huggingface.RuntrailCallback` — implements `transformers.TrainerCallback`.
- `runtrail.integrations.keras.RuntrailCallback` — subclass of `keras.callbacks.Callback`.
- `runtrail.integrations.tbx` — drop-in for `tensorboardX.SummaryWriter` (FR-10.4).
- `runtrail.integrations.importers` — `from_wandb(path)` / `from_mlflow(path)` that read foreign run dirs and insert as runtrail runs.

Each integration lives in its own submodule with opt-in imports (no top-level import of `pytorch_lightning` etc.).

---

## 12. Non-functional budgets

| ID | Budget | Measurement |
|---|---|---|
| NFR-1 | Logging overhead <1% of training step | Microbench: 10k `run.log(dict)` calls inside a tight loop; total time vs no-op baseline |
| NFR-2 | UI run list <200ms for 1k runs | `curl -w "%{time_total}" /api/v1/projects/x/runs?limit=1000` on warmed-up DB |
| NFR-3 | Diff <500ms typical | Server timing for `/api/v1/diff` on two real runs with full hparams + 200-step metrics |
| NFR-4 | Binary <50MB stripped | `ls -lh runtrail` after `go build -ldflags="-s -w"` |
| NFR-5 | Cold start UI <2s | Time from `runtrail ui` invocation to first UI paint (HEAD `/` returns) |
| NFR-6 | Offline always | Network tests: block egress; SDK + CLI + UI must function fully |
| NFR-7 | Python 3.9+, Linux/Mac/Windows | CI matrix |
| NFR-8 | Apache-2.0 | License headers + LICENSE file |

CI must enforce NFR-4 (size check) and run the benchmarks for NFR-1/2/3 on every PR.

---

## 13. Testing strategy

### 13.1 Python SDK

- **Unit**: every capture module mocked; queue/writer tested in isolation.
- **Integration**: spin up a fake run in a tmpdir, assert files written match the spec in section 4.
- **Crash safety**: send SIGINT mid-run; assert `status=killed`, files consistent.
- **Concurrency**: 100 threads each calling `run.log()`; assert no lost entries (modulo documented drop counter).

### 13.2 Go server

- **Storage**: round-trip every entity (`Project`, `Run`, `Artifact`, `Metric`).
- **API**: table-driven tests against an in-memory tmp `~/.runtrail/`.
- **WebSocket**: golden-event sequences — start a fake run via fsnotify-detected file writes, assert clients receive the expected message sequence.
- **Diff**: known-pair fixtures; golden JSON output.

### 13.3 Frontend

- **Component tests**: vitest + jsdom, focus on `LineChart`, diff parsing, filter logic.
- **Snapshot of rendered pages**: with mock API responses.
- **No e2e for v1** — postpone Playwright until the surface stabilizes.

### 13.4 End-to-end

A `scripts/e2e.sh` that:
1. Builds the binary.
2. Installs the SDK in a venv.
3. Runs a tiny training script that logs 100 steps.
4. Boots `runtrail ui`, hits `/api/v1/...` from `curl`, asserts JSON.
5. Tears down.

Runs in CI on each PR. Must complete in <60s.

---

## 14. Release & distribution

### 14.1 Versioning

SemVer. v0.x = pre-stable, breaking changes allowed with clear changelog notes.

### 14.2 Go binary

- GitHub Actions matrix: linux/amd64, linux/arm64, darwin/amd64, darwin/arm64, windows/amd64.
- Artifacts: `runtrail-<os>-<arch>` and `.tar.gz`/`.zip`.
- Homebrew tap (`brew install <org>/tap/runtrail`).
- Scoop manifest for Windows.

### 14.3 Python SDK

- PyPI: `pip install runtrail`.
- Built with `hatch build`; published with `twine` from CI.
- `pip install runtrail[gpu]` for `pynvml`.

### 14.4 Bundled install (convenience)

`pip install runtrail` could optionally fetch the matching Go binary on first `runtrail ui` invocation, caching to `~/.cache/runtrail/bin/`. Avoids the user needing two install steps. Mark as **opt-in** — never download without prompting.

---

## 15. Phased delivery plan

Each phase has a clear "done when" criterion. Do not advance until met.

### Phase 0 — Foundations (week 0)
- Repo bootstrapped (Go module, Python package, web scaffold).
- LICENSE (Apache-2.0), README stub, this SPEC committed.
- CI green for `go build`, `pytest -q`, `pnpm build`.
- **Done when**: empty `runtrail --help` and `python -c "import runtrail; print(runtrail.__version__)"` both work end-to-end in CI.

### Phase 1 — SDK + storage (weeks 1–2)
- Implement section 4 (on-disk format) and section 5 (SDK).
- A demo script (`examples/quickstart.py`) that creates a fake run, logs 50 scalars and 1 artifact.
- Schema documented in `docs/schema.md`.
- **Done when**: running the demo creates the expected file tree (verified by a snapshot test) and `sqlite3 ~/.runtrail/runtrail.db` shows correct rows.

### Phase 2 — CLI (week 3)
- `runtrail ls`, `runtrail show`, `runtrail rm`, `runtrail export`, `runtrail import`.
- Storage access layer (section 6.4).
- **Done when**: the demo run from phase 1 round-trips through `runtrail export ... && runtrail rm ... && runtrail import ...`, with byte-identical metrics.

### Phase 3 — UI server (read-only) + frontend port (weeks 4–6)
- HTTP API endpoints (section 6.6) except mutations.
- Port the prototype JSX to Vite + React + TS (`web/`). All pages render against real API data.
- Embed `web/dist` in the Go binary.
- **Done when**: `runtrail ui` opens the SPA, all six prototype pages display real data without errors. `NFR-2` measured.

### Phase 4 — Diff (week 7)
- Diff engine (section 8) + `runtrail diff` CLI.
- `/api/v1/diff` endpoint + diff page hooked up.
- Smart-highlight heuristics with confidence.
- **Done when**: diff page renders for any two runs in the demo dataset and `NFR-3` is met.

### Phase 5 — Live runs (weeks 8–9)
- WebSocket protocol (section 6.7) + fsnotify watcher (6.8).
- Live page hooked up: charts tick, logs tail, resources stream.
- `runtrail ui --mutations` enables write endpoints.
- Stop-run button works (sends SIGTERM to `pid`).
- **Done when**: a running training script's metrics appear in the live UI within 500ms of `run.log()` returning.

### Phase 6 — Polish + release (week 10)
- Saved views persisted, mutation tests, NFR enforcement in CI.
- README with quickstart GIF.
- v0.1.0 tag, GitHub release with binaries + PyPI upload.

### Phase 7 (post-MVP) — Reproduce, Sync, Integrations
- `runtrail reproduce`, `runtrail check` (section 9).
- Sync server (section 10).
- Framework callbacks (section 11).

---

## 16. Glossary

- **Run** — one execution of a training script, identified by `run-<8 hex>`.
- **Project** — a logical collection of runs, identified by a slug. Default = slug of the CWD basename.
- **Artifact** — a file (checkpoint, image, etc.) attached to a run. Stored content-addressed.
- **Baseline** — a run pinned as a reference within a project. Used as default diff target.
- **Live run** — a run whose `status=running`. Drives the live UI page and the right-rail in the run list.
- **Mutation mode** — server flag (`runtrail ui --mutations`) that enables `PATCH`/`POST`/`DELETE` endpoints.
- **Snapshot** — captured copy of source code at run time, stored under `runs/<id>/source/`.
- **JSONL → Parquet** — metrics are appended as JSONL during the run, finalized to Parquet on completion.

---

## Appendix A — Quickstart (target UX)

```bash
$ pip install runtrail
$ python train.py
# train.py:
#   import runtrail
#   run = runtrail.init(config={"lr": 0.1, "batch_size": 256})
#   for step in range(1000):
#       run.log({"loss": loss, "acc": acc}, step=step)

$ runtrail ls
ID         STATUS  NAME            VAL_ACC  STARTED
run-a1f3   done    quick-test       —       just now

$ runtrail ui
runtrail: serving on http://127.0.0.1:48213 — opening browser
```

That's the headline experience. Everything in this spec is in service of that.
