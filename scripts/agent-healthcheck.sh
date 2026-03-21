#!/usr/bin/env bash
# agent-healthcheck.sh — Docker health check for the agent container.
#
# Strategy: query the status server first (fast, no side effects).
# Fall back to process check during startup before the status server is ready.
#
# Exit codes:
#   0 — healthy
#   1 — unhealthy

set -euo pipefail

STATUS_PORT="${AGENT_STATUS_PORT:-7420}"

# Primary: status server health endpoint
if curl -sf "http://127.0.0.1:${STATUS_PORT}/health" > /dev/null 2>&1; then
  exit 0
fi

# Fallback during startup: check if daemon process is alive
if pgrep -f "issue-daemon\.sh" > /dev/null 2>&1; then
  exit 0
fi

echo "UNHEALTHY: No agent process found"
exit 1
