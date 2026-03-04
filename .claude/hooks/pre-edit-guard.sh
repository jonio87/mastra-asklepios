#!/usr/bin/env bash
# Pre-edit guard: blocks writes that introduce known AI code smells
# Runs before Edit/MultiEdit/Write tool calls
# Reference: MSR '26 — AI agents are 9x more prone to use 'any' keyword

set -euo pipefail

INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | jq -r '.file_path // .path // empty' 2>/dev/null || true)
CONTENT=$(echo "$INPUT" | jq -r '.content // .new_str // empty' 2>/dev/null || true)

# Only check TypeScript/JavaScript files
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx) ;;
  *) exit 0 ;;
esac

ERRORS=""

# 1. Block explicit 'any' type (the #1 AI code smell — 9x more common in AI code)
if echo "$CONTENT" | grep -Eq ':\s*any\b|<any>|as\s+any\b'; then
  ERRORS="${ERRORS}
BLOCKED: 'any' type detected. Use a specific type, Zod inference, or 'unknown' instead."
fi

# 2. Block @ts-ignore / @ts-nocheck (AI agents use these to bypass type errors)
if echo "$CONTENT" | grep -Eq '@ts-ignore|@ts-nocheck|@ts-expect-error'; then
  ERRORS="${ERRORS}
BLOCKED: TypeScript suppression comment detected. Fix the type error instead of suppressing it."
fi

# 3. Block console.log in production code (not in test files)
case "$FILE_PATH" in
  *test*|*spec*) ;;
  *)
    if echo "$CONTENT" | grep -Eq 'console\.(log|debug|info)\('; then
      ERRORS="${ERRORS}
WARNING: console.log detected in production code. Use the structured logger (src/utils/logger.ts) instead."
    fi
    ;;
esac

# 4. Block require() — must use ES modules
if echo "$CONTENT" | grep -Eq '\brequire\s*\('; then
  ERRORS="${ERRORS}
BLOCKED: require() detected. Use ES module import/export syntax."
fi

if [[ -n "$ERRORS" ]]; then
  echo "$ERRORS"
  exit 2
fi

exit 0
