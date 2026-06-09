# SDK reference

The `runtrail` Python package is how training scripts write runs to the local
store. It has no required configuration and makes no network calls.

```bash
pip install runtrail
pip install "runtrail[gpu]"   # adds pynvml for NVIDIA GPU capture
```

## Quick start

```python
import runtrail

run = runtrail.init(config={"lr": 0.1, "batch_size": 256})

for step in range(1000):
    loss = train_step()
    run.log({"loss": loss}, step=step)

run.finish()
```

Or with the context manager, which finishes automatically (and marks the run
`failed` if an exception propagates):

```python
with runtrail.run(config={"lr": 0.1}) as run:
    for step in range(1000):
        run.log({"loss": compute_loss()}, step=step)
```

## `runtrail.init(...) -> Run`

Initialize a new run and return a `Run`. All arguments are optional.

| Argument | Default | Description |
|----------|---------|-------------|
| `project` | slug of CWD | Project name the run belongs to. |
| `name` | auto-generated | Human-readable run name. |
| `config` | `None` | Hyperparameter dict logged at run start. |
| `tags` | `None` | Initial list of tags. |
| `notes` | `None` | Free-text notes attached to the run. |
| `dir` | `$RUNTRAIL_HOME` or `~/.runtrail` | Storage root. |
| `capture_source` | `True` | Snapshot Python source files at start. |
| `capture_env` | `True` | Capture installed packages and versions. |
| `capture_hardware` | `True` | Capture CPU, RAM, and GPU info. |
| `capture_git` | `True` | Capture commit, branch, and working-tree diff. |
| `resource_interval` | `15.0` | Seconds between resource samples (`0` disables). |
| `mode` | `"online"` | `"online"` writes to disk; `"disabled"` is a no-op. |
| `reinit` | `False` | Allow re-initializing within the same process. |

## The `Run` object

| Method | Description |
|--------|-------------|
| `log(values, step=None, commit=True)` | Log a dict of scalar metrics. Non-blocking. `step` auto-increments when omitted. |
| `log_artifact(path, name=None, type="binary") -> str` | Store a file content-addressed; returns its sha256. |
| `log_image(key, img, step=None)` | Log an image (PIL / ndarray / path). |
| `log_figure(key, fig, step=None)` | Log a matplotlib figure. |
| `log_table(key, rows, columns)` | Log a tabular artifact. |
| `use_dataset(...)` | Record a dataset dependency (hash, path). |
| `add_tag(*tags)` | Add one or more tags. |
| `add_note(text)` | Append a note. |
| `set_summary(key, value)` | Set a summary scalar (e.g. best val_acc). |
| `event(level, message)` | Append a structured event to the run log. |
| `finish(status="done", error=None)` | Flush all pending writes and mark the run complete. |

Attributes: `run.id` (`run-<8 hex>`), `run.name`, `run.project`.

## Logging model

- `log()` is non-blocking — values are enqueued and flushed by a background
  writer, so it stays out of your training hot loop.
- Metrics are appended as JSONL during the run and finalized to Parquet on
  `finish()`.
- Crash safety: an interrupted run leaves a recoverable JSONL trail; a SIGTERM
  or unhandled exception is recorded with the appropriate status.

## Environment variables

| Variable | Effect |
|----------|--------|
| `RUNTRAIL_HOME` | Override the storage root (same as `dir=`). |
| `RUNTRAIL_PROJECT` | Override the default project name (same as `project=`). |

To disable tracking entirely, pass `mode="disabled"` to `init()` — every SDK call
becomes a no-op.

See also [CLI reference](cli.md), [storage schema](schema.md), and
[architecture](architecture.md).
