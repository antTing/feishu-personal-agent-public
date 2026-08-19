#!/bin/sh
set -eu
umask 077

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

exec node "$SCRIPT_DIR/onboard-native.mjs" "$@"
