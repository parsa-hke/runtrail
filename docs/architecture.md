# Architecture

runtrail is two independent components that communicate only through a shared,
human-inspectable store on disk. Neither requires the other to be running.

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
│  Go binary  `runtrail`                                            │
│  ┌────────────┐  ┌───────────────┐  ┌──────────────────────────┐  │
│  │  CLI       │  │ HTTP API      │  │  WebSocket fan-out       │  │
│  │  (cobra)   │  │ (chi)         │  │  (gorilla/websocket)     │  │
│  └────────────┘  └───────────────┘  └──────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  embedded SPA (//go:embed dist/*)                           │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

## Components

- **Python SDK** (`sdk/runtrail/`) — the write side. Provides the logging API,
  auto-capture (git, environment, hardware, source snapshots), a background write
  pipeline, and a resource sampler. Writes only to `~/.runtrail/`.
- **Go binary** (`cmd/runtrail`, `internal/`) — the read side. A single
  statically linked binary that bundles the CLI (cobra), the HTTP API + WebSocket
  server (chi + gorilla/websocket), and the embedded React SPA. Reads the store;
  writes only in `--mutations` mode.
- **Frontend** (`web/`) — a Vite + React + TypeScript SPA. Built to `web/dist`,
  copied into `internal/webui/dist`, and embedded into the Go binary via
  `//go:embed` so the binary ships the UI with no separate server.

## Key principles

1. **Storage is the contract.** The on-disk format (see
   [schema.md](schema.md)) is the only coupling between the SDK and the binary.
   Each can be developed and released independently as long as the format is
   honored.
2. **Pure-Go where possible.** SQLite access uses `modernc.org/sqlite` (no cgo),
   so `CGO_ENABLED=0` cross-compilation produces every platform binary with one
   command and keeps the binary under the 50 MB budget.
3. **Append-only metrics during a run.** Active runs append JSONL; metrics are
   finalized to Parquet on completion. This makes live tailing trivial and crash
   recovery automatic.
4. **Content-addressed artifacts.** A file's SHA-256 is its storage key, so the
   same artifact across runs is stored once.
5. **No network calls by default.** The SDK never opens a socket; the server
   binds `127.0.0.1` by default.

## Data flow

1. A training script calls `runtrail.init()` → a run row and directory are
   created under `~/.runtrail/<project>/runs/<id>/`.
2. `run.log()` enqueues metrics; a background writer appends them as JSONL.
3. `run.finish()` flushes the queue and finalizes JSONL → Parquet.
4. `runtrail ui` reads the store, serves the API/WebSocket, and embeds the SPA.
   For live runs, an fsnotify watcher fans out new metrics over WebSocket.

## Repository layout

| Path | Contents |
|------|----------|
| `sdk/` | Python SDK package and tests. |
| `cmd/runtrail/` | Go binary entrypoint. |
| `internal/` | Go implementation: `cli`, `server`, `store`, `diff`, `domain`, `webui`. |
| `web/` | React + TypeScript frontend (Vite). |
| `docs/` | Reference documentation. |
| `SPEC.md` | The complete build specification. |

For the precise on-disk format, see [schema.md](schema.md). For usage, see
[sdk.md](sdk.md) and [cli.md](cli.md).
