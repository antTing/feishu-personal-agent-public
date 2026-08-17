#!/bin/sh

# Source this file, then call ensure_codex_cli to make an available Codex CLI
# visible to child processes without printing its location.
ensure_codex_cli() {
  if [ -n "${CODEX_CLI_PATH:-}" ]; then
    case "$CODEX_CLI_PATH" in
      /*/codex) ;;
      *) return 1 ;;
    esac
    if [ ! -f "$CODEX_CLI_PATH" ] || [ ! -x "$CODEX_CLI_PATH" ]; then
      return 1
    fi
    fpa_codex_dir=${CODEX_CLI_PATH%/*}
    PATH="$fpa_codex_dir${PATH:+:$PATH}"
    export PATH
    command -v codex >/dev/null 2>&1
    return $?
  fi

  if command -v codex >/dev/null 2>&1; then
    return 0
  fi

  for fpa_codex_candidate in \
    "${HOME:-}/Applications/ChatGPT.app/Contents/Resources/codex" \
    "${HOME:-}/Applications/Codex.app/Contents/Resources/codex" \
    "/Applications/ChatGPT.app/Contents/Resources/codex" \
    "/Applications/Codex.app/Contents/Resources/codex"
  do
    if [ -f "$fpa_codex_candidate" ] && [ -x "$fpa_codex_candidate" ]; then
      fpa_codex_dir=${fpa_codex_candidate%/*}
      PATH="$fpa_codex_dir${PATH:+:$PATH}"
      export PATH
      command -v codex >/dev/null 2>&1
      return $?
    fi
  done

  return 1
}
