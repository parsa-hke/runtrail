#!/usr/bin/env bash
# scripts/build.sh — build the full runtrail binary (web → Go).
#
# Usage:
#   ./scripts/build.sh              # build for current platform
#   VERSION=0.1.0 ./scripts/build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="${VERSION:-dev}"
LDFLAGS="-s -w -X github.com/runtrail/runtrail/internal/version.Version=${VERSION}"

echo "==> Building web frontend..."
cd web
if command -v npm &>/dev/null; then
  npm ci
  npm run build
else
  echo "ERROR: npm required" >&2
  exit 1
fi
cd "$ROOT"

echo "==> Syncing dist into internal/webui/dist (embed source)..."
rm -rf internal/webui/dist
cp -R web/dist internal/webui/dist

echo "==> Building Go binary..."
go build -ldflags="${LDFLAGS}" -o runtrail ./cmd/runtrail

echo "==> Done."
echo "    Binary : $(pwd)/runtrail"
echo "    Version: ${VERSION}"
echo "    Size   : $(du -sh runtrail | cut -f1)"
