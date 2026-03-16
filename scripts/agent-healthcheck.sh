#!/usr/bin/env bash
# agent-healthcheck.sh — Docker health check for the agent container.
#
# Checks:
#   1. The issue-daemon process is running
#   2. Node.js is available
#   3. gh CLI is authenticated (if GITHUB_TOKEN is set)
#   4. The workspace is mounted
#
# Exit codes:
#   0 — healthy
#   1 — unhealthy

set -euo pipefail

# Check 1: issue-daemon or node process is running
if ! pgrep -f "issue-daemon\|node\|claude" > /dev/null 2>&1; then
  echo "UNHEALTHY: No agent process found"
  exit 1
fi

# Check 2: Node.js is available
if ! node --version > /dev/null 2>&1; then
  echo "UNHEALTHY: Node.js not available"
  exit 1
fi

# Check 3: gh CLI works (if token is set)
if [ -n "${GITHUB_TOKEN:-}" ]; then
  if ! gh auth status > /dev/null 2>&1; then
    echo "UNHEALTHY: gh CLI not authenticated"
    exit 1
  fi
fi

# Check 4: Workspace is mounted and contains package.json
if [ ! -f /workspace/package.json ]; then
  echo "UNHEALTHY: Workspace not mounted or missing package.json"
  exit 1
fi

echo "HEALTHY: All checks passed"
exit 0
