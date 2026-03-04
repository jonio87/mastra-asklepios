#!/usr/bin/env bash
# Post-edit quality: auto-formats after every file edit
# Runs after Edit/MultiEdit/Write tool calls
# This is deterministic — agent doesn't need to remember to format

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.file_path // .path // empty' 2>/dev/null || true)

# Only process TS/JS/JSON files
if [[ "$FILE_PATH" != *.ts && "$FILE_PATH" != *.tsx && "$FILE_PATH" != *.js && "$FILE_PATH" != *.jsx && "$FILE_PATH" != *.json ]]; then
  exit 0
fi

# Auto-format with Biome if available
if command -v npx &>/dev/null && [[ -f "biome.json" || -f "biome.jsonc" ]]; then
  npx --yes @biomejs/biome format --write "$FILE_PATH" 2>/dev/null || true
fi

exit 0
