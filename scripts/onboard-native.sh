#!/bin/sh
set -eu
umask 077

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

. "$SCRIPT_DIR/codex-cli-env.sh"

if ! ensure_codex_cli; then
  printf '未找到可用的 Codex 执行器。请安装并登录 Codex CLI，或安装 ChatGPT/Codex 桌面应用后重试。\n' >&2
  exit 1
fi
if ! codex app-server --help >/dev/null 2>&1; then
  printf '当前 Codex 执行器不支持 app-server，请按官方文档更新 Codex CLI。\n' >&2
  exit 1
fi

exec node "$SCRIPT_DIR/onboard-native.mjs" "$@"
