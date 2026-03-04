#!/usr/bin/env bash
# Stop quality gate: runs full quality checks when agent finishes a task
# This is the critical gate — catches everything the agent missed

set -euo pipefail

ERRORS=""
WARNINGS=""

# 1. TypeScript type checking (most important — catches 'any' leaks, type errors)
if [[ -f "tsconfig.json" ]] && [[ -d "src" ]]; then
  TSC_OUTPUT=$(npx tsc --noEmit 2>&1 || true)
  if echo "$TSC_OUTPUT" | grep -q "error TS"; then
    ERROR_COUNT=$(echo "$TSC_OUTPUT" | grep -c "error TS" || true)
    ERRORS="${ERRORS}
TypeScript: ${ERROR_COUNT} type error(s) found. Run 'npx tsc --noEmit' to see details."
  fi
fi

# 2. Biome lint + format check (fast — catches formatting, import order, dead code)
if [[ -f "biome.json" ]] || [[ -f "biome.jsonc" ]]; then
  BIOME_OUTPUT=$(npx @biomejs/biome check --no-errors-on-unmatched src/ 2>&1 || true)
  if echo "$BIOME_OUTPUT" | grep -q "Found [1-9]"; then
    ERRORS="${ERRORS}
Biome: lint/format issues found. Run 'npx @biomejs/biome check --write src/' to fix."
  fi
fi

# 3. Check for 'any' type in all .ts files (the #1 AI code smell)
if [[ -d "src" ]]; then
  ANY_COUNT=$(grep -rn ':\s*any\b\|<any>\|as\s\+any\b' src/ --include="*.ts" 2>/dev/null | grep -v 'node_modules' | wc -l | tr -d ' ' || true)
  if [[ "$ANY_COUNT" -gt 0 ]]; then
    ERRORS="${ERRORS}
Found ${ANY_COUNT} 'any' type usage(s) in src/. Replace with specific types or 'unknown'."
  fi
fi

# 4. Check for ts-ignore/ts-nocheck
if [[ -d "src" ]]; then
  SUPPRESS_COUNT=$(grep -rn '@ts-ignore\|@ts-nocheck\|@ts-expect-error' src/ --include="*.ts" 2>/dev/null | grep -v 'node_modules' | wc -l | tr -d ' ' || true)
  if [[ "$SUPPRESS_COUNT" -gt 0 ]]; then
    ERRORS="${ERRORS}
Found ${SUPPRESS_COUNT} TypeScript suppression comment(s). Fix the type errors instead."
  fi
fi

# 5. Run tests if they exist
if [[ -f "package.json" ]] && grep -q '"test"' package.json; then
  TEST_OUTPUT=$(npm test 2>&1 || true)
  if echo "$TEST_OUTPUT" | grep -Eq "FAIL|failed"; then
    FAIL_COUNT=$(echo "$TEST_OUTPUT" | grep -c "FAIL" || true)
    ERRORS="${ERRORS}
Tests: ${FAIL_COUNT} test suite(s) failing. Run 'npm test' to see details."
  fi
fi

# 6. Check for console.log in production code
if [[ -d "src" ]]; then
  CONSOLE_COUNT=$(grep -rn 'console\.\(log\|debug\|info\)(' src/ --include="*.ts" 2>/dev/null | grep -v 'node_modules' | grep -v '\.test\.' | grep -v '\.spec\.' | grep -v 'logger\.ts' | wc -l | tr -d ' ' || true)
  if [[ "$CONSOLE_COUNT" -gt 0 ]]; then
    WARNINGS="${WARNINGS}
Found ${CONSOLE_COUNT} console.log in production code. Use structured logger instead."
  fi
fi

# Output results
if [[ -n "$WARNINGS" ]]; then
  echo "Quality Warnings:$WARNINGS"
fi

if [[ -n "$ERRORS" ]]; then
  echo "Quality Gate FAILED:$ERRORS"
  echo ""
  echo "Fix these issues before committing."
  exit 2
fi

echo "Quality gate passed."
exit 0
