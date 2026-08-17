#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
CC_CONFIG="$ROOT_DIR/runtime/cc-connect/config.toml"
CONNECTOR_CONFIG="$ROOT_DIR/runtime/feishu-connector/config.json"
CC_CONNECT="$ROOT_DIR/runtime/bin/cc-connect-local"
RUNTIME_ROOT="$ROOT_DIR/runtime"
SERVICE_STATE="$SCRIPT_DIR/service-state.mjs"

. "$SCRIPT_DIR/codex-cli-env.sh"

umask 077
printf 'startup-stage=wrapper-entered\n' >&2

for required_command in node pgrep nc; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    printf 'Service runtime is missing a required command.\n' >&2
    exit 1
  fi
done

if ! ensure_codex_cli; then
  printf 'Codex runtime is unavailable. Install or sign in to Codex CLI, or install the ChatGPT/Codex desktop app.\n' >&2
  exit 1
fi
if ! codex app-server --help >/dev/null 2>&1; then
  printf 'The available Codex runtime does not support app-server. Update Codex CLI.\n' >&2
  exit 1
fi

if [ ! -f "$CONNECTOR_CONFIG" ]; then
  printf 'Feishu Connector is not configured. Run: ./scripts/init-config.sh\n' >&2
  exit 1
fi

if [ ! -x "$CC_CONNECT" ]; then
  printf 'Local-only cc-connect binary is missing. Run: ./scripts/build-cc-connect-local.sh\n' >&2
  exit 1
fi

if ! node "$SCRIPT_DIR/validate-executable.mjs" "$CC_CONNECT" >/dev/null 2>&1; then
  printf 'Local-only cc-connect binary has an unsafe type or permission mode.\n' >&2
  exit 1
fi

printf 'startup-stage=private-inputs-present\n' >&2

CC_PID=""
CONNECTOR_PID=""
CONTROL_PID=""

kill_tree() (
  pid="$1"
  [ -n "$pid" ] || return 0

  children=$(pgrep -P "$pid" 2>/dev/null || true)
  for child in $children; do
    kill_tree "$child"
  done

  kill -TERM "$pid" 2>/dev/null || true
)

cleanup() {
  trap - EXIT
  printf 'Service wrapper entered exit cleanup.\n' >&2
  request_shutdown
  if [ -n "$CONTROL_PID" ]; then
    kill -TERM "$CONTROL_PID" 2>/dev/null || true
    wait "$CONTROL_PID" 2>/dev/null || true
    node "$SERVICE_STATE" unregister "$$" >/dev/null 2>&1 || true
  fi
}

request_shutdown() {
  trap '' INT TERM
  connector_pid="$CONNECTOR_PID"
  cc_pid="$CC_PID"
  CONNECTOR_PID=""
  CC_PID=""
  kill_tree "$connector_pid"
  kill_tree "$cc_pid"
  if [ -n "$connector_pid" ]; then
    wait "$connector_pid" 2>/dev/null || true
  fi
  if [ -n "$cc_pid" ]; then
    wait "$cc_pid" 2>/dev/null || true
  fi
}

handle_signal() {
  printf 'Service wrapper received a termination signal.\n' >&2
  request_shutdown
  exit 143
}

trap cleanup EXIT
trap handle_signal INT TERM

(
  cd "$ROOT_DIR"
  FEISHU_CONNECTOR_CONFIG="$CONNECTOR_CONFIG" node --input-type=module -e '
  import { loadConfig } from "./feishu-connector/src/config.js";
  await loadConfig();
' >/dev/null 2>&1
)
printf 'startup-stage=config-validated\n' >&2

node "$SERVICE_STATE" serve &
CONTROL_PID=$!
attempt=0
while [ "$attempt" -lt 20 ]; do
  if node "$SERVICE_STATE" active >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$CONTROL_PID" 2>/dev/null; then
    printf 'Service control channel failed to start.\n' >&2
    exit 1
  fi
  sleep 0.1
  attempt=$((attempt + 1))
done
if ! node "$SERVICE_STATE" owned-by "$$" >/dev/null 2>&1 || ! kill -0 "$CONTROL_PID" 2>/dev/null; then
  printf 'Service control channel did not become ready.\n' >&2
  exit 1
fi
printf 'startup-stage=control-ready\n' >&2

if ! BRIDGE_HOST=$(FEISHU_CONNECTOR_CONFIG="$CONNECTOR_CONFIG" node "$SCRIPT_DIR/service-endpoints.mjs" bridge-host 2>/dev/null) ||
   ! BRIDGE_PORT=$(FEISHU_CONNECTOR_CONFIG="$CONNECTOR_CONFIG" node "$SCRIPT_DIR/service-endpoints.mjs" bridge-port 2>/dev/null) ||
   ! MANAGEMENT_HOST=$(FEISHU_CONNECTOR_CONFIG="$CONNECTOR_CONFIG" node "$SCRIPT_DIR/service-endpoints.mjs" management-host 2>/dev/null) ||
   ! MANAGEMENT_PORT=$(FEISHU_CONNECTOR_CONFIG="$CONNECTOR_CONFIG" node "$SCRIPT_DIR/service-endpoints.mjs" management-port 2>/dev/null); then
  printf 'Validated local endpoint configuration could not be read.\n' >&2
  exit 1
fi

cc_start_number=0
while [ "$cc_start_number" -lt 2 ]; do
  "$CC_CONNECT" --config "$CC_CONFIG" --force >/dev/null 2>&1 &
  CC_PID=$!
  attempt=0
  while [ "$attempt" -lt 100 ]; do
    if nc -z "$BRIDGE_HOST" "$BRIDGE_PORT" >/dev/null 2>&1 && nc -z "$MANAGEMENT_HOST" "$MANAGEMENT_PORT" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$CC_PID" 2>/dev/null; then
      wait "$CC_PID" 2>/dev/null || true
      CC_PID=""
      break
    fi
    sleep 0.1
    attempt=$((attempt + 1))
  done
  if [ -n "$CC_PID" ] && nc -z "$BRIDGE_HOST" "$BRIDGE_PORT" >/dev/null 2>&1 && nc -z "$MANAGEMENT_HOST" "$MANAGEMENT_PORT" >/dev/null 2>&1; then
    break
  fi
  cc_start_number=$((cc_start_number + 1))
  if [ "$cc_start_number" -lt 2 ]; then sleep 0.5; fi
done
if ! nc -z "$BRIDGE_HOST" "$BRIDGE_PORT" >/dev/null 2>&1 || ! nc -z "$MANAGEMENT_HOST" "$MANAGEMENT_PORT" >/dev/null 2>&1; then
  printf 'cc-connect exited before local endpoints became ready after retry.\n' >&2
  exit 1
fi
printf 'startup-stage=cc-connect-ready\n' >&2

FEISHU_CONNECTOR_CONFIG="$CONNECTOR_CONFIG" \
SERVICE_STATE_COMMAND="$SERVICE_STATE" \
SERVICE_WRAPPER_PID="$$" \
node "$ROOT_DIR/feishu-connector/src/index.js" &
CONNECTOR_PID=$!
printf 'startup-stage=connector-started\n' >&2

set +e
while kill -0 "$CONNECTOR_PID" 2>/dev/null; do
  if ! kill -0 "$CONTROL_PID" 2>/dev/null || ! node "$SERVICE_STATE" owned-by "$$" >/dev/null 2>&1; then
    printf 'Service control channel stopped unexpectedly.\n' >&2
    request_shutdown
    exit 1
  fi
  if ! kill -0 "$CC_PID" 2>/dev/null; then
    printf 'cc-connect stopped unexpectedly.\n' >&2
    request_shutdown
    exit 1
  fi
  sleep 0.5
done
wait "$CONNECTOR_PID"
CONNECTOR_STATUS=$?
CONNECTOR_PID=""
set -e
printf 'Connector process exited with status %s.\n' "$CONNECTOR_STATUS" >&2
request_shutdown
exit "$CONNECTOR_STATUS"
