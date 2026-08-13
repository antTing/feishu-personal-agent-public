#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
VERSION="1.4.1"
ARCHIVE_SHA256="b882f9b3d538e0446a85a97231a4213dc06c7529f9a769476e773a288d21ef54"
CACHE_BASE="${XDG_CACHE_HOME:-${HOME}/.cache}/personal-ai-agent"
CACHE_DIR="$CACHE_BASE/cc-connect/v$VERSION"
ARCHIVE="$CACHE_DIR/cc-connect-v$VERSION.tar.gz"
BUILD_DIR=$(mktemp -d "${TMPDIR:-/tmp}/cc-connect-local-build.XXXXXX")
SOURCE_DIR="$BUILD_DIR/cc-connect-$VERSION"
GO_BUILD_CACHE="$BUILD_DIR/go-build-cache"
GO_MODULE_CACHE="$BUILD_DIR/go-module-cache"
GO_TMP_DIR="$BUILD_DIR/go-tmp"
OUTPUT_DIR="$ROOT_DIR/runtime/bin"
OUTPUT="$OUTPUT_DIR/cc-connect-local"
BUILD_TIME=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

cleanup() {
  chmod -R u+w "$BUILD_DIR" 2>/dev/null || true
  rm -rf "$BUILD_DIR"
}
trap cleanup EXIT INT TERM

mkdir -p "$CACHE_DIR" "$GO_BUILD_CACHE" "$GO_MODULE_CACHE" "$GO_TMP_DIR"

if [ ! -f "$ARCHIVE" ]; then
  DOWNLOAD="$ARCHIVE.download"
  rm -f "$DOWNLOAD"
  curl -fL "https://github.com/chenhg5/cc-connect/archive/refs/tags/v$VERSION.tar.gz" -o "$DOWNLOAD"
  mv "$DOWNLOAD" "$ARCHIVE"
fi

if command -v shasum >/dev/null 2>&1; then
  ACTUAL_SHA256=$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')
elif command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA256=$(sha256sum "$ARCHIVE" | awk '{print $1}')
else
  printf 'Neither shasum nor sha256sum is available.\n' >&2
  exit 1
fi

if [ "$ACTUAL_SHA256" != "$ARCHIVE_SHA256" ]; then
  printf 'cc-connect archive checksum mismatch. Remove %s and retry.\n' "$ARCHIVE" >&2
  exit 1
fi

tar -xzf "$ARCHIVE" -C "$BUILD_DIR"

CC_SOURCE_DIR="$SOURCE_DIR" node "$SCRIPT_DIR/patch-cc-connect-local.mjs"

(
  cd "$SOURCE_DIR"
  GOCACHE="$GO_BUILD_CACHE" GOMODCACHE="$GO_MODULE_CACHE" GOTMPDIR="$GO_TMP_DIR" GOTELEMETRY=off \
    go build -tags no_web -trimpath \
      -ldflags "-s -w -X main.version=v$VERSION-local -X main.commit=localhost-bridge -X main.buildTime=$BUILD_TIME" \
      -o "$BUILD_DIR/cc-connect-local" ./cmd/cc-connect
)

mkdir -p "$OUTPUT_DIR"
mv "$BUILD_DIR/cc-connect-local" "$OUTPUT"
chmod 700 "$OUTPUT"
"$OUTPUT" --version
