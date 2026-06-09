#!/usr/bin/env bash
# scripts/release.sh — automate frontend build, cross-compile Go binaries, and package Python SDK.
#
# Usage:
#   VERSION=0.1.0 ./scripts/release.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="${VERSION:-}"
if [ -z "${VERSION}" ]; then
  echo "ERROR: VERSION environment variable is required (e.g., VERSION=0.1.0)" >&2
  exit 1
fi

echo "==> Releasing runtrail version ${VERSION}..."

# 1. Build web frontend
echo "==> Step 1: Building web frontend..."
cd web
if command -v npm &>/dev/null; then
  npm ci
  npm run build
else
  echo "ERROR: npm required" >&2
  exit 1
fi
cd "$ROOT"

# Sync assets
echo "==> Syncing web dist..."
rm -rf internal/webui/dist
cp -R web/dist internal/webui/dist

# 2. Build Python SDK
echo "==> Step 2: Packaging Python SDK..."
cd sdk
if command -v hatch &>/dev/null; then
  hatch build
elif [ -f .venv/bin/python ]; then
  .venv/bin/python -m pip install --upgrade build
  .venv/bin/python -m build
elif command -v python &>/dev/null; then
  python -m pip install --upgrade build
  python -m build
else
  echo "WARNING: hatch or python-build not found, skipping Python SDK packaging"
fi
cd "$ROOT"

# 3. Cross-compile Go binaries
echo "==> Step 3: Cross-compiling Go binaries..."
mkdir -p dist
LDFLAGS="-s -w -X github.com/runtrail/runtrail/internal/version.Version=${VERSION}"

PLATFORMS=(
  "linux/amd64"
  "linux/arm64"
  "darwin/amd64"
  "darwin/arm64"
  "windows/amd64"
)

for PLATFORM in "${PLATFORMS[@]}"; do
  OS="${PLATFORM%/*}"
  ARCH="${PLATFORM#*/}"
  EXT=""
  if [ "${OS}" = "windows" ]; then
    EXT=".exe"
  fi

  OUT_NAME="dist/runtrail-${OS}-${ARCH}${EXT}"
  echo "    Building for ${OS}/${ARCH} -> ${OUT_NAME}"
  
  # Run go build with cross-compilation env vars
  GOOS="${OS}" GOARCH="${ARCH}" CGO_ENABLED=0 go build -ldflags="${LDFLAGS}" -o "${OUT_NAME}" ./cmd/runtrail
done

echo "==> Step 4: Verification..."
ls -lh dist/

echo "==> Done. Ready for release!"
echo "To publish, run:"
echo "  1. git tag -a v${VERSION} -m 'Release v${VERSION}'"
echo "  2. git push origin v${VERSION}"
echo "  3. Upload the binaries in dist/ to the GitHub release"
echo "  4. Publish python package: cd sdk && twine upload dist/*"
