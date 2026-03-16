#!/usr/bin/env bash
# PreToolUse hook: blocks /ce:work on brainstorm-originated plans.
# Brainstorm plans have `origin: docs/brainstorms/...` in YAML frontmatter.
# These must go through /create-issue and human approval before work begins.
#
# Receives JSON on stdin with tool_name, tool_input, session_id, cwd.
# Exit 2 = block the action. Exit 0 = allow.
# Fails open if jq is missing or no plan files exist.

set -euo pipefail

# Fail open if jq is not installed
if ! command -v jq &>/dev/null; then
  echo "WARNING: jq not found, brainstorm approval guard disabled" >&2
  exit 0
fi

# Read stdin once
INPUT=$(cat)

# Extract the skill name from tool_input.skill
SKILL=$(echo "$INPUT" | jq -r '.tool_input.skill // empty')

# Only intercept work-related skill invocations
case "$SKILL" in
  work|ce:work|compound-engineering:ce:work|compound-engineering:workflow:ce:work)
    ;;
  *)
    exit 0
    ;;
esac

# Extract args to find plan file path
ARGS=$(echo "$INPUT" | jq -r '.tool_input.args // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Try to find the plan file path from args
PLAN_FILE=""
if [[ -n "$ARGS" ]]; then
  # Look for a docs/plans/*.md path in the args
  PLAN_FILE=$(echo "$ARGS" | grep -o 'docs/plans/[^ ]*\.md' | head -1 || true)
fi

# Fallback: find most recently modified plan file
if [[ -z "$PLAN_FILE" ]]; then
  if [[ -n "$CWD" ]] && [[ -d "$CWD/docs/plans" ]]; then
    PLAN_FILE=$(ls -t "$CWD"/docs/plans/*-plan.md 2>/dev/null | head -1 || true)
    # Make relative if we got an absolute path
    if [[ -n "$PLAN_FILE" ]]; then
      PLAN_FILE="${PLAN_FILE#$CWD/}"
    fi
  elif [[ -d "docs/plans" ]]; then
    PLAN_FILE=$(ls -t docs/plans/*-plan.md 2>/dev/null | head -1 || true)
  fi
fi

# No plan file found — fail open
if [[ -z "$PLAN_FILE" ]]; then
  exit 0
fi

# Resolve to absolute path if needed
if [[ "$PLAN_FILE" != /* ]]; then
  if [[ -n "$CWD" ]]; then
    PLAN_FILE="$CWD/$PLAN_FILE"
  fi
fi

# Plan file doesn't exist — fail open
if [[ ! -f "$PLAN_FILE" ]]; then
  exit 0
fi

# Check the first 10 lines for brainstorm origin in YAML frontmatter
if head -10 "$PLAN_FILE" | grep -q 'origin:.*docs/brainstorms/'; then
  echo "BLOCKED: This plan originated from a brainstorm (has 'origin: docs/brainstorms/...' in frontmatter)." >&2
  echo "Brainstorm plans require human approval before work begins." >&2
  echo "Use /create-issue to create a work issue, then wait for /go approval." >&2
  exit 2
fi

# No brainstorm origin — allow
exit 0
