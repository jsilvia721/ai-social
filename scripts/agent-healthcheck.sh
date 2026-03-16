#!/usr/bin/env bash
# agent-healthcheck.sh — Health check for the agent container.
# Verifies that essential tools are available and the repo is mounted.
# Exit 0 = healthy, Exit 1 = unhealthy.

set -euo pipefail

errors=()

# Check essential binaries
for cmd in node git gh jq claude; do
  if ! command -v "$cmd" &>/dev/null; then
    errors+=("missing: $cmd")
  fi
done

# Check Node.js version is 22+
node_major=$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || echo "0")
if [ "$node_major" -lt 22 ]; then
  errors+=("node version too old: v${node_major} (need 22+)")
fi

# Check repo is mounted
if [ ! -d /repo/.git ] && [ ! -f /repo/package.json ]; then
  errors+=("repo not mounted at /repo")
fi

# Check writable workdir
if [ ! -w /workdir ]; then
  errors+=("/workdir is not writable")
fi

# Report results
if [ ${#errors[@]} -gt 0 ]; then
  echo "UNHEALTHY: ${errors[*]}"
  exit 1
fi

echo "HEALTHY: all checks passed"
exit 0
