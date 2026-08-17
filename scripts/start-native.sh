#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
CONFIG_PATH=$ROOT_DIR/runtime/native-cc-connect/config.toml
BINARY_PATH=${CC_CONNECT_BINARY:-$ROOT_DIR/runtime/bin/cc-connect-local}

. "$SCRIPT_DIR/codex-cli-env.sh"

if [ -L "$CONFIG_PATH" ]; then
  printf '原生模式配置不能是符号链接。\n' >&2
  exit 1
fi
if [ ! -f "$CONFIG_PATH" ]; then
  printf '原生模式配置不存在，请先运行 ./scripts/onboard-native.sh 完成自动安装与配对。\n' >&2
  exit 1
fi
if [ "$(stat -f '%Lp' "$CONFIG_PATH" 2>/dev/null || stat -c '%a' "$CONFIG_PATH" 2>/dev/null)" != "600" ]; then
  printf '原生模式配置权限不安全，应为 600。\n' >&2
  exit 1
fi
if ! node "$SCRIPT_DIR/validate-executable.mjs" "$BINARY_PATH" >/dev/null 2>&1; then
  printf 'cc-connect 本机二进制不存在或权限不安全，请重新运行 ./scripts/build-cc-connect-local.sh。\n' >&2
  exit 1
fi
if ! ensure_codex_cli; then
  printf '未找到可用的 Codex 执行器。请安装并登录 Codex CLI，或安装 ChatGPT/Codex 桌面应用后重试。\n' >&2
  exit 1
fi
if ! codex app-server --help >/dev/null 2>&1; then
  printf '当前 Codex 执行器不支持 app-server，请按官方文档更新 Codex CLI。\n' >&2
  exit 1
fi

unset CLAUDECODE
exec "$BINARY_PATH" -config "$CONFIG_PATH"
