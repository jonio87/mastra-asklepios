#!/usr/bin/env bash
# Notification hook: alerts the user when Claude needs attention
# Runs on Notification events (when agent stops and waits for input)

set -euo pipefail

INPUT=$(cat)
MESSAGE=$(echo "$INPUT" | jq -r '.message // "Claude Code needs your attention"' 2>/dev/null || true)

# macOS notification
if command -v osascript &>/dev/null; then
  osascript -e "display notification \"$MESSAGE\" with title \"Claude Code\"" 2>/dev/null || true
# Linux notification (notify-send)
elif command -v notify-send &>/dev/null; then
  notify-send "Claude Code" "$MESSAGE" 2>/dev/null || true
fi

exit 0
