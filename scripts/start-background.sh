#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
RUNTIME_ROOT="$ROOT_DIR/runtime"
LOG_FILE="$RUNTIME_ROOT/personal-agent.log"

umask 077

if node "$SCRIPT_DIR/service-state.mjs" active >/dev/null 2>&1; then
  printf '服务已经在运行或启动中。\n'
  exit 0
fi

node "$SCRIPT_DIR/service-state.mjs" prepare-log
node "$SCRIPT_DIR/detach-service.mjs"

attempt=0
ready_count=0
while [ "$attempt" -lt 20 ]; do
  sleep 1
  if "$SCRIPT_DIR/status.sh" >/dev/null 2>&1; then
    ready_count=$((ready_count + 1))
    if [ "$ready_count" -ge 3 ]; then
      printf '服务已在后台稳定启动。使用 ./scripts/status.sh 查看状态。\n'
      exit 0
    fi
  else
    ready_count=0
  fi
  if ! node "$SCRIPT_DIR/service-state.mjs" active >/dev/null 2>&1 && [ "$attempt" -ge 3 ]; then
    printf '服务启动失败。请在本机私下检查 runtime/personal-agent.log。\n' >&2
    exit 1
  fi
  attempt=$((attempt + 1))
done

printf '服务未在 20 秒内确认就绪；未向其他实例发送停止请求。请运行状态和安全诊断命令。\n' >&2
exit 1
