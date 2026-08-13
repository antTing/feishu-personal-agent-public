#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if ! command -v node >/dev/null 2>&1; then
  printf 'Node.js is required to generate configuration.\n' >&2
  exit 1
fi

exec node "$SCRIPT_DIR/init-config.mjs" "$@"
