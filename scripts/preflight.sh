#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
CC_CONFIG="$ROOT_DIR/runtime/cc-connect/config.toml"
CONNECTOR_CONFIG="$ROOT_DIR/runtime/feishu-connector/config.json"
LOCAL_CC="$ROOT_DIR/runtime/bin/cc-connect-local"
WORK_DIR="$ROOT_DIR/agent-workspace"
CONNECTOR_DIR="$ROOT_DIR/feishu-connector"

failures=0

check_command() {
  if command -v "$1" >/dev/null 2>&1; then
    printf 'OK   %-14s available\n' "$1"
  else
    printf 'FAIL %-14s not found\n' "$1"
    failures=$((failures + 1))
  fi
}

check_file() {
  if [ -f "$2" ]; then
    printf 'OK   %-14s present\n' "$1"
  else
    printf 'FAIL %-14s missing\n' "$1"
    failures=$((failures + 1))
  fi
}

file_mode() {
  mac_mode=$(stat -f '%Lp' "$1" 2>/dev/null || true)
  case "$mac_mode" in
    ''|*[!0-7]*) ;;
    *) printf '%s\n' "$mac_mode"; return 0 ;;
  esac
  if stat -c '%a' "$1" >/dev/null 2>&1; then
    stat -c '%a' "$1"
  else
    printf 'unknown\n'
  fi
}

check_mode() {
  actual=$(file_mode "$2")
  if [ "$actual" = "$3" ]; then
    printf 'OK   %-14s mode %s\n' "$1" "$actual"
  else
    printf 'FAIL %-14s expected mode %s, got %s\n' "$1" "$3" "$actual"
    failures=$((failures + 1))
  fi
}

check_command node
check_command npm
check_command codex
check_command pgrep
check_command nc
check_file cc-config "$CC_CONFIG"
check_file feishu-config "$CONNECTOR_CONFIG"
check_file local-cc "$LOCAL_CC"

if [ -f "$CC_CONFIG" ]; then
  check_mode cc-config-mode "$CC_CONFIG" 600
fi
if [ -f "$CONNECTOR_CONFIG" ]; then
  check_mode feishu-mode "$CONNECTOR_CONFIG" 600
fi
if [ -e "$LOCAL_CC" ] && ! node "$SCRIPT_DIR/validate-executable.mjs" "$LOCAL_CC" >/dev/null 2>&1; then
  printf 'FAIL %-14s unsafe file type or mode; expected an owner-only regular executable\n' local-cc-mode
  failures=$((failures + 1))
elif [ -e "$LOCAL_CC" ]; then
  printf 'OK   %-14s owner-only executable\n' local-cc-mode
fi
if [ -d "$ROOT_DIR/runtime/cc-connect" ]; then
  check_mode cc-runtime "$ROOT_DIR/runtime/cc-connect" 700
fi
if [ -d "$ROOT_DIR/runtime/feishu-connector" ]; then
  check_mode connector-dir "$ROOT_DIR/runtime/feishu-connector" 700
fi

if [ -d "$CONNECTOR_DIR/node_modules/@larksuiteoapi/node-sdk" ]; then
  printf 'OK   %-14s installed\n' feishu-sdk
else
  printf 'FAIL %-14s run: npm install --prefix feishu-connector\n' feishu-sdk
  failures=$((failures + 1))
fi

if [ -d "$WORK_DIR" ]; then
  printf 'OK   %-14s present\n' workspace
else
  printf 'FAIL %-14s missing\n' workspace
  failures=$((failures + 1))
fi

CONNECTOR_VALIDATE=$(mktemp "${TMPDIR:-/tmp}/feishu-connector-validate.XXXXXX")
if (
  cd "$ROOT_DIR"
  FEISHU_CONNECTOR_CONFIG="$CONNECTOR_CONFIG" node --input-type=module -e '
    import { loadConfig } from "./feishu-connector/src/config.js";
    const config = await loadConfig();
    if (config.feishu.allowedUserIds.length === 0) throw new Error("allowedUserIds is empty");
  ' 2>"$CONNECTOR_VALIDATE"
); then
  printf 'OK   %-14s parsed\n' connector-json
else
  printf 'FAIL %-14s invalid, insecure, or missing owner allowlist\n' connector-json
  if grep -q 'private runtime layout' "$CONNECTOR_VALIDATE"; then
    printf 'HINT %-14s existing private config uses an older runtime layout; migrate it locally without exposing values\n' connector-json
  elif grep -Eq 'regular file|symbolic link|accessible by group|expected mode 600' "$CONNECTOR_VALIDATE"; then
    printf 'HINT %-14s private file type or permissions are unsafe\n' connector-json
  elif grep -q 'loopback host' "$CONNECTOR_VALIDATE"; then
    printf 'HINT %-14s Bridge and Management URLs must stay on loopback\n' connector-json
  fi
  failures=$((failures + 1))
fi
rm -f "$CONNECTOR_VALIDATE"

if codex login status >/dev/null 2>&1; then
  printf 'OK   %-14s logged in\n' codex-auth
elif [ "${PREFLIGHT_REQUIRE_CODEX_AUTH:-0}" = "1" ]; then
  printf 'FAIL %-14s no supported login detected\n' codex-auth
  failures=$((failures + 1))
else
  printf 'WARN %-14s no login detected; API-based setups may verify separately\n' codex-auth
fi

if [ "$failures" -ne 0 ]; then
  printf '\nPreflight failed: %s check(s).\n' "$failures"
  exit 1
fi

printf '\nPreflight passed. Run: ./scripts/start.sh\n'
