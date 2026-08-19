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
# Keep the existing Codex desktop-app discovery for Codex installations, but
# let cc-connect perform the native readiness check for Claude/ACP agents.
AGENT_TYPE=$(awk '
  /^\[projects\.agent\]$/ { in_agent=1; next }
  /^\[/ { if (in_agent) exit }
  in_agent && /^type[[:space:]]*=/ { gsub(/["[:space:]]/, "", $3); print $3; exit }
' "$CONFIG_PATH")
case "$AGENT_TYPE" in
  codex)
    if ! ensure_codex_cli; then
      printf '未找到可用的 Codex 执行器。请安装并登录 Codex CLI，或将 Codex 可执行文件加入 PATH。\n' >&2
      exit 1
    fi
    if ! codex app-server --help >/dev/null 2>&1; then
      printf '当前 Codex 执行器不支持 app-server，请按官方文档更新 Codex CLI。\n' >&2
      exit 1
    fi
    ;;
  claudecode)
    if ! command -v claude >/dev/null 2>&1; then
      printf '未找到 Claude Code（claude）。请先安装并登录，再启动 cc-connect。\n' >&2
      exit 1
    fi
    ;;
  acp)
    if ! command -v agent >/dev/null 2>&1; then
      printf '未找到 Cursor Agent ACP（agent）。请先安装并登录，再启动 cc-connect。\n' >&2
      exit 1
    fi
    ;;
  *)
    printf '原生配置中的 Agent 类型无法识别，请检查 [projects.agent].type。\n' >&2
    exit 1
    ;;
esac

unset CLAUDECODE
exec "$BINARY_PATH" -config "$CONFIG_PATH"
