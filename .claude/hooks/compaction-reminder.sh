#!/usr/bin/env bash
# Compaction reminder: re-injects critical rules after context compaction
# When Claude compacts its context window, CLAUDE.md instructions can be lost.
# This hook ensures the most critical rules survive compaction.

set -euo pipefail

cat << 'REMINDER'
CRITICAL RULES (re-injected after compaction):
1. No `any` type — use `unknown`, Zod inference, or explicit types
2. No `@ts-ignore` or `@ts-expect-error` — fix the type error
3. No `require()` — ES modules only (import/export)
4. No `console.log` in production code — use logger from src/utils/logger.ts
5. Run `npm run check` before stopping (typecheck + lint + test)
6. Write tests FIRST (TDD) — tests define the contract
7. One file at a time — complete and verify before moving to next
REMINDER

exit 0
