# runtrail — On-Disk Schema

This document describes every file and database table that runtrail writes.
The Go binary reads this layout; the Python SDK writes it.

---

## Directory Layout

```
~/.runtrail/                        ← RUNTRAIL_HOME (overridable)
├── runtrail.db                     ← Single SQLite database (WAL mode)
└── projects/
    └── <project-id>/               ← slugified project name
        ├── artifacts/
        │   └── <sha[:2]>/<sha[2:4]>/<sha>   ← content-addressed blobs
        └── runs/
            └── <run-id>/           ← e.g. run-a3f2c8d1
                ├── meta.json       ← run header (id, status, hparams, …)
                ├── hparams.json    ← hyperparameters only (convenience)
                ├── env.json        ← {"hardware": {…}, "env": {…}}
                ├── git_diff.patch  ← present only when dirty=true
                ├── metrics.jsonl   ← written during run; deleted after finalization
                ├── metrics.parquet ← long-format, created at finish()
                ├── resources.jsonl ← written during run; deleted after finalization
                ├── resources.parquet
                ├── events.jsonl    ← structured log events
                └── source/         ← Python source snapshot
                    └── **/*.py
```

> **`<project-id>`** — lowercase alphanumeric + hyphens, max 64 chars, derived
> from the `project` argument passed to `runtrail.init()`.
>
> **`<run-id>`** — `run-` prefix + 8 hex chars derived from SHA-256 of
> `(name, time_ns, pid, hostname)`.

---

## SQLite Tables (`runtrail.db`)

### `schema_version`

| Column       | Type    | Notes                        |
|--------------|---------|------------------------------|
| `version`    | INTEGER | Primary key. Current: **1**. |
| `applied_at` | INTEGER | Unix timestamp (seconds).    |

---

### `projects`

| Column         | Type | Notes                                     |
|----------------|------|-------------------------------------------|
| `id`           | TEXT | PK. Slugified project name.               |
| `name`         | TEXT | Human-readable name.                      |
| `path`         | TEXT | Absolute path of the project directory.   |
| `description`  | TEXT | Optional.                                 |
| `default_tags` | TEXT | JSON array of strings.                    |
| `baselines`    | TEXT | JSON array — baseline run IDs.            |
| `saved_views`  | TEXT | JSON array — saved filter/sort views.     |
| `created_at`   | INT  | Unix timestamp (seconds).                 |
| `updated_at`   | INT  | Unix timestamp (seconds).                 |

---

### `runs`

| Column          | Type    | Notes                                                              |
|-----------------|---------|--------------------------------------------------------------------|
| `id`            | TEXT    | PK. `run-<8hex>`.                                                  |
| `project_id`    | TEXT    | FK → `projects.id`.                                                |
| `name`          | TEXT    | Human-readable run name.                                           |
| `status`        | TEXT    | `running` → `done` / `failed` / `crashed`.                        |
| `started_at`    | INTEGER | Epoch **milliseconds**.                                            |
| `ended_at`      | INTEGER | Epoch milliseconds. NULL while running.                            |
| `duration_s`    | REAL    | Wall time in seconds. NULL while running.                          |
| `user`          | TEXT    | OS username.                                                       |
| `host`          | TEXT    | Hostname.                                                          |
| `pid`           | INTEGER | Process ID.                                                        |
| `branch`        | TEXT    | Git branch (captured async).                                       |
| `commit_hash`   | TEXT    | Full SHA-1 commit hash.                                            |
| `dirty`         | INTEGER | `1` if working tree was dirty at run start.                        |
| `cmd`           | TEXT    | Full command line (`sys.argv` joined).                             |
| `exit_code`     | INTEGER | Process exit code (set by atexit handler if available).            |
| `error`         | TEXT    | Exception message on `failed` runs.                                |
| `notes`         | TEXT    | Free-text; appended via `run.add_note()`.                          |
| `pinned`        | INTEGER | `1` if pinned in the UI.                                           |
| `hparams_json`  | TEXT    | JSON object of hyperparameters.                                    |
| `final_json`    | TEXT    | JSON object of last-value metrics (convenience snapshot).          |
| `hardware_json` | TEXT    | JSON — CPU, RAM, GPU info.                                         |
| `env_json`      | TEXT    | JSON — Python version, virtualenv, conda, CUDA.                    |
| `dataset`       | TEXT    | Dataset name registered via `run.use_dataset()`.                   |
| `dataset_hash`  | TEXT    | SHA-256 of the dataset path string.                                |

**Indexes:** `(project_id, started_at DESC)`, `(status)`.

---

### `tags`

| Column   | Type | Notes                        |
|----------|------|------------------------------|
| `run_id` | TEXT | FK → `runs.id`.              |
| `tag`    | TEXT | Tag string.                  |
| PK       |      | `(run_id, tag)`.             |

---

### `artifacts`

| Column       | Type    | Notes                                                       |
|--------------|---------|-------------------------------------------------------------|
| `id`         | INTEGER | PK autoincrement.                                           |
| `run_id`     | TEXT    | FK → `runs.id`.                                             |
| `name`       | TEXT    | Logical artifact name (e.g. `best_model.pt`).               |
| `type`       | TEXT    | `binary`, `model`, `image`, `figure`, `table`, etc.         |
| `size_bytes` | INTEGER | File size in bytes.                                         |
| `sha256`     | TEXT    | Lowercase hex SHA-256. Blob lives at `artifacts/<2>/<2>/<sha>`. |
| `created_at` | INTEGER | Unix timestamp (seconds).                                   |
| UNIQUE       |         | `(run_id, name)`.                                           |

---

### `packages`

| Column    | Type | Notes                   |
|-----------|------|-------------------------|
| `run_id`  | TEXT | FK → `runs.id`.         |
| `name`    | TEXT | Lowercase package name. |
| `version` | TEXT | Version string.         |
| PK        |      | `(run_id, name)`.       |

---

### `events`

| Column    | Type    | Notes                            |
|-----------|---------|----------------------------------|
| `id`      | INTEGER | PK autoincrement.                |
| `run_id`  | TEXT    | FK → `runs.id`.                  |
| `ts_ms`   | INTEGER | Epoch milliseconds.              |
| `level`   | TEXT    | `info`, `warn`, `error`.         |
| `message` | TEXT    | Free-text message.               |

**Index:** `(run_id, ts_ms)`.

---

### `final_metrics`

Populated when `run.finish()` is called.  One row per metric per run.

| Column       | Type    | Notes                                     |
|--------------|---------|-------------------------------------------|
| `run_id`     | TEXT    | FK → `runs.id`.                           |
| `name`       | TEXT    | Metric name (e.g. `val_loss`).            |
| `value`      | REAL    | Alias of `last` (for simple queries).     |
| `best`       | REAL    | Best observed value. Lower is better for metrics containing `loss`/`error`/`err`; otherwise higher is better. |
| `last`       | REAL    | Last observed value.                      |
| `step_count` | INTEGER | Total number of logged steps.             |
| PK           |         | `(run_id, name)`.                         |

**Index:** `(name, value)` — supports "sort runs by best val_loss" queries.

---

## JSONL Files

All JSONL files use **newline-delimited JSON** (one JSON object per line, UTF-8).
They are written during the run and converted to Parquet on `finish()`.
If the process crashes, the JSONL files remain as the source of truth.

### `metrics.jsonl`

Each line is one call to `run.log()`:

```json
{"step": 42, "wall_ms": 1718000000123, "loss": 0.312, "accuracy": 0.887}
```

### `resources.jsonl`

Each line is one resource sample from the background `ResourceSampler`:

```json
{"wall_ms": 1718000005000, "cpu_percent": 67.3, "ram_used_bytes": 8589934592, "ram_percent": 53.2, "gpu_percent": 94, "gpu_mem_used_bytes": 7516192768, "gpus": [{"index": 0, "gpu_percent": 94, "mem_used_bytes": 7516192768, "mem_percent": 90.1}]}
```

### `events.jsonl`

```json
{"wall_ms": 1718000010000, "level": "info", "message": "Training loop complete"}
```

---

## Parquet Schema

After `finish()`, JSONL is converted to **long format** Parquet (snappy compression).

| Column     | Arrow Type  | Notes                    |
|------------|-------------|--------------------------|
| `step`     | `int64`     | Training step.           |
| `wall_ms`  | `int64`     | Epoch milliseconds.      |
| `metric`   | `string`    | Metric name.             |
| `value`    | `float64`   | Metric value.            |

This long format allows efficient columnar filtering by metric name and step range
without loading all metrics into memory.

---

## Content-Addressed Artifact Blobs

Blob path formula:
```
<RUNTRAIL_HOME>/projects/<project-id>/artifacts/<sha256[:2]>/<sha256[2:4]>/<sha256>
```

Example for SHA-256 `a3f2c8d1e9...`:
```
~/.runtrail/projects/my-project/artifacts/a3/f2/a3f2c8d1e9...
```

This mirrors Git's object store layout. Duplicate files across runs are stored only once.
