# CLI reference

The `runtrail` binary is the command-line interface and UI server. It reads (and
in mutation mode, writes) the local store at `~/.runtrail/`. No network access is
required.

## Global flags

These apply to every command:

| Flag | Description |
|------|-------------|
| `--home <dir>` | Data directory. Defaults to `$RUNTRAIL_HOME` or `~/.runtrail`. |
| `-p, --project <name>` | Project name. Defaults to the slug of the current directory. |
| `--json` | Emit machine-readable JSON instead of formatted tables. |
| `-v, --verbose` | Enable verbose/trace logging. |

---

## `runtrail ls`

List runs in the current project, newest first.

```bash
runtrail ls
runtrail ls --status done
runtrail ls --tag baseline --limit 20
```

| Flag | Description |
|------|-------------|
| `--limit <n>` | Maximum runs to show (default 50). |
| `--status <s>` | Filter by status: `running`, `done`, `failed`, `killed`. |
| `--tag <t>` | Filter by tag. |

## `runtrail show <run>`

Show full details of a single run: hyperparameters, final metrics, environment,
hardware, git state, tags, and notes.

```bash
runtrail show run-a1f3
runtrail show run-a1f3 --json
```

## `runtrail diff <a> <b> [<c> ...]`

Compare two or more runs side-by-side — the central operation in runtrail.
Highlights differing hyperparameters and metric deltas, and picks a winner.

```bash
runtrail diff run-a1f3 run-b8e2
runtrail diff run-a1f3 run-b8e2 --only-diff
runtrail diff run-a run-b run-c        # N-way comparison
runtrail diff run-b8e2 --baseline      # compare against the project baseline
```

| Flag | Description |
|------|-------------|
| `--baseline` | Use the project baseline as run A. |
| `--only-diff` | Hide fields that are identical across runs. |

## `runtrail rm <run> [--force]`

Delete a run and all of its files (metrics, events, snapshots, artifacts not
referenced by other runs).

```bash
runtrail rm run-a1f3
runtrail rm run-a1f3 --force     # skip the confirmation prompt
```

## `runtrail export <run> [--output <dir>]`

Export a run as a self-contained, portable directory (`MANIFEST.json`, the run
directory, and content-addressed artifacts). Round-trips losslessly with
`import`.

```bash
runtrail export run-a1f3
runtrail export run-a1f3 --output ./run-a1f3-export
```

| Flag | Description |
|------|-------------|
| `-o, --output <dir>` | Output directory (default `<run-id>-export`). |

## `runtrail import <path>`

Import a directory previously produced by `export`.

```bash
runtrail import ./run-a1f3-export
```

## `runtrail ui [flags]`

Start the local HTTP server and open the web UI in a browser. Read-only by
default; pass `--mutations` to enable editing notes/tags and deleting runs from
the UI.

```bash
runtrail ui
runtrail ui --port 8080
runtrail ui --mutations
```

| Flag | Description |
|------|-------------|
| `--host <addr>` | Address to bind (default `127.0.0.1`). |
| `--port <n>` | Port to listen on (`0` picks a free port). |
| `--open` | Open the UI in the default browser (default `true`). |
| `--mutations` | Enable write operations from the UI. |

See also [SDK reference](sdk.md), [storage schema](schema.md), and
[architecture](architecture.md).
