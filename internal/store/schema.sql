-- runtrail schema, version 1.
-- This file is the canonical Go-side schema; the Python SDK keeps the same
-- statements inline in sdk/runtrail/_store.py and both must stay in sync.

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
    run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    type        TEXT,
    size_bytes  INTEGER NOT NULL,
    sha256      TEXT NOT NULL,
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
    run_id  TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    ts_ms   INTEGER NOT NULL,
    level   TEXT NOT NULL,
    message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_run_ts ON events(run_id, ts_ms);

CREATE TABLE IF NOT EXISTS final_metrics (
    run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    value       REAL,
    best        REAL,
    last        REAL,
    step_count  INTEGER,
    PRIMARY KEY (run_id, name)
);
CREATE INDEX IF NOT EXISTS final_metrics_name_value ON final_metrics(name, value);
