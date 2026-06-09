# Changelog

All notable changes to runtrail are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/) (0.x = pre-stable; breaking changes
may occur in minor releases and are called out here).

## [0.1.0] — 2026-06-08

First public release. The complete local-first MVP (SPEC phases 0–6).

### Added

- **Python SDK** — `runtrail.init()` / `runtrail.run()` context manager,
  non-blocking `run.log()`, artifact/image/figure/table logging, tags, notes,
  summaries, and a background write pipeline (JSONL → Parquet on finish).
- **Auto-capture** — git state, Python environment, hardware (CPU/RAM/GPU), and
  source snapshots captured automatically at run start.
- **Local store** — SQLite + Parquet under `~/.runtrail/`, fully
  human-inspectable; content-addressed artifacts.
- **CLI** — `ls`, `show`, `diff`, `rm`, `export`, `import`, and `ui`, with
  `--json` output for scripting.
- **Diff engine** — side-by-side hyperparameter and metric comparison with
  winner heuristic and N-way support, in both the CLI and the UI.
- **Web UI** — `runtrail ui` serves an embedded React SPA (run list, run detail,
  diff, live run, settings). Read-only by default; `--mutations` enables editing
  notes/tags and deleting runs.
- **Live runs** — WebSocket fan-out backed by an fsnotify watcher streams
  metrics, logs, and resource samples into the UI in real time.
- **Distribution** — single static Go binary (5 platforms, pure-Go SQLite),
  `pip install runtrail`, and a tag-triggered release workflow.

[0.1.0]: https://github.com/runtrail/runtrail/releases/tag/v0.1.0
