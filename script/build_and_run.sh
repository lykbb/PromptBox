#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
MODE="${1:-run}"
OUTPUT_DIR="$ROOT_DIR/release/PromptBox-Desktop-$(date +%Y%m%d-%H%M%S)"
# Only stop an executable produced by this repository, never another application with the same name.
for PID in $(pgrep -x PromptBox || true); do
  EXECUTABLE="$(ps -p "$PID" -o comm=)"
  case "$EXECUTABLE" in "$ROOT_DIR"/release/*/PromptBox.app/Contents/MacOS/PromptBox) kill -TERM "$PID" ;; esac
done
PROMPTBOX_OUTPUT_DIR="$OUTPUT_DIR" bash scripts/package-desktop-mac.sh
APP_BUNDLE="$OUTPUT_DIR/PromptBox.app"
case "$MODE" in
  run) open -n "$APP_BUNDLE" ;;
  --verify) open -n "$APP_BUNDLE"; sleep 2; pgrep -x PromptBox ;;
  --debug) lldb -- "$APP_BUNDLE/Contents/MacOS/PromptBox" ;;
  --logs|--telemetry) open -n "$APP_BUNDLE"; /usr/bin/log stream --info --predicate 'process == "PromptBox"' ;;
  *) echo "用法：$0 [run|--verify|--debug|--logs|--telemetry]" >&2; exit 2 ;;
esac
