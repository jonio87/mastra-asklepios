#!/usr/bin/env bash
# Pre-bash firewall: blocks dangerous shell commands
# Runs before Bash tool calls

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.command // empty' 2>/dev/null || true)

ERRORS=""

# Block destructive git commands
if echo "$COMMAND" | grep -Eq 'git\s+(push\s+--force|reset\s+--hard|clean\s+-fd)'; then
  ERRORS="${ERRORS}
BLOCKED: Destructive git command. Never use --force push, --hard reset, or clean -fd."
fi

# Block rm -rf on important directories
if echo "$COMMAND" | grep -Eq 'rm\s+-rf\s+(/|~|\.\.|src|docs|\.claude)'; then
  ERRORS="${ERRORS}
BLOCKED: Dangerous rm -rf target. Check the path carefully."
fi

# Block committing .env files
if echo "$COMMAND" | grep -Eq 'git\s+add.*\.env'; then
  ERRORS="${ERRORS}
BLOCKED: Attempting to git add .env file. This contains secrets."
fi

# Block npm publish without explicit intent
if echo "$COMMAND" | grep -Eq 'npm\s+publish'; then
  ERRORS="${ERRORS}
BLOCKED: npm publish must be done intentionally, not by an AI agent."
fi

if [[ -n "$ERRORS" ]]; then
  echo "$ERRORS"
  exit 2
fi

exit 0
