#!/usr/bin/env bash
# Stop hook: checks for stray files in the working tree.
# Receives JSON on stdin with stop_hook_active, session_id, cwd.
# Informational only (always exits 0). Writes stray file list to stderr.

set -euo pipefail

# Fail open if jq is not installed
if ! command -v jq &>/dev/null; then
  exit 0
fi

# Read stdin once
INPUT=$(cat)

# Check stop_hook_active to prevent infinite loops
STOP_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')
if [[ "$STOP_ACTIVE" == "true" ]]; then
  exit 0
fi

# Get stray files from git status, filtering out sensitive patterns
STRAY_FILES=$(git status --short 2>/dev/null | grep -v -E '\.(env|pem|key)' | grep -v -E '\.env\.' || true)

if [[ -n "$STRAY_FILES" ]]; then
  echo "⚠️  Stray files detected:" >&2
  echo "$STRAY_FILES" >&2
fi

exit 0
