#!/usr/bin/env bash
# PreToolUse hook: blocks Edit/Write to agent infrastructure files.
# These files should only be modified in interactive sessions, never by
# automated agent workers. Defense-in-depth against prompt injection.
#
# Receives JSON on stdin with tool_name, tool_input, session_id, cwd.
# Exit 2 = block the action. Exit 0 = allow.

set -euo pipefail

# Fail open if jq is not installed
if ! command -v jq &>/dev/null; then
  exit 0
fi

INPUT=$(cat)

TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Only check Edit and Write tools
if [[ "$TOOL" != "Edit" && "$TOOL" != "Write" ]]; then
  exit 0
fi

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Check if this is an automated agent session (running in a worktree)
# Interactive sessions run from the repo root; agent workers run in .claude/worktrees/
if [[ "$FILE_PATH" != *"/.claude/worktrees/"* ]]; then
  # Not in a worktree — this is likely an interactive session, allow
  exit 0
fi

# Block edits to agent infrastructure files from automated sessions
BLOCKED_PATTERNS=(
  "/.claude/agents/"
  "/.claude/hooks/"
  "/.claude/settings.json"
)

for pattern in "${BLOCKED_PATTERNS[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo "Blocked: automated agents cannot modify agent infrastructure files ($pattern). This change requires human review." >&2
    exit 2
  fi
done

exit 0
