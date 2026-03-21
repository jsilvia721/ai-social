#!/usr/bin/env bash
# agent-entrypoint.sh — Container entrypoint for the autonomous agent.
#
# Responsibilities:
#   1. Validate required environment variables
#   2. Clone the repo from the read-only mount into a writable location
#   3. Configure git with credential helper (no token on disk)
#   4. Start the status server in the background
#   5. Run the issue-daemon (foreground, so trap handlers fire on exit)
#
# The read-only workspace at /workspace cannot support git worktree operations
# (which write to .git/worktrees/). This script clones into /agent-workdir/repo
# so the daemon has full git access.

set -euo pipefail

WORKSPACE_RO="/workspace"
WORKDIR="/agent-workdir"
REPO_DIR="${WORKDIR}/repo"
STATUS_PORT="${AGENT_STATUS_PORT:-7420}"

# --- Validation --------------------------------------------------------------

log() {
  echo "[entrypoint] $(date '+%H:%M:%S') $*"
}

die() {
  echo "[entrypoint] FATAL: $*" >&2
  exit 1
}

# Required env vars
[ -n "${ANTHROPIC_API_KEY:-}" ] || die "ANTHROPIC_API_KEY is not set"
[ -n "${GITHUB_TOKEN:-}" ]     || die "GITHUB_TOKEN is not set"

# Workspace must be mounted
[ -f "${WORKSPACE_RO}/package.json" ] || die "Workspace not mounted at ${WORKSPACE_RO}"

# --- Derive repo URL from mounted workspace ----------------------------------

# Read the GitHub remote URL from the read-only mount (portable, not hardcoded)
GITHUB_URL=$(git -C "${WORKSPACE_RO}" remote get-url origin 2>/dev/null | sed 's|git@github.com:|https://github.com/|; s|\.git$||')
GITHUB_URL="${GITHUB_URL%.git}"
if [ -z "$GITHUB_URL" ]; then
  die "Could not determine GitHub remote URL from workspace"
fi

# --- Clone repo into writable location ---------------------------------------

if [ -d "${REPO_DIR}/.git" ]; then
  log "Repo already exists at ${REPO_DIR}, pulling latest..."
  cd "$REPO_DIR"
  git fetch origin --prune || log "Warning: git fetch failed (continuing with existing state)"
  git reset --hard origin/main 2>/dev/null || git reset --hard origin/master 2>/dev/null || true
else
  log "Cloning repo from read-only mount into ${REPO_DIR}..."
  git clone --reference "${WORKSPACE_RO}" "file://${WORKSPACE_RO}" "${REPO_DIR}"
  cd "$REPO_DIR"
fi

# Set remote to GitHub HTTPS (no token in URL — credential helper handles auth)
git remote set-url origin "${GITHUB_URL}.git" 2>/dev/null || git remote add origin "${GITHUB_URL}.git"

# --- Git configuration -------------------------------------------------------

git config user.name "ai-social-agent"
git config user.email "agent@ai-social.local"

# Credential helper injects GITHUB_TOKEN at runtime without persisting to disk.
# The token never appears in .git/config, git error messages, or process listings.
git config credential.helper '!f() { echo "username=x-access-token"; echo "password=${GITHUB_TOKEN}"; }; f'

# Trust the repo directory (required for git operations as non-root)
git config --global --add safe.directory "${REPO_DIR}"

# --- Install dependencies ----------------------------------------------------

if [ -f "package-lock.json" ]; then
  log "Installing npm dependencies..."
  npm ci --ignore-scripts || die "npm ci failed — check package-lock.json"
fi

# --- Start status server in background ---------------------------------------

log "Starting status server on port ${STATUS_PORT}..."
node scripts/agent-status-server.js &
STATUS_PID=$!

# Ensure status server is killed on exit (works because we don't exec below)
cleanup() {
  kill "$STATUS_PID" 2>/dev/null || true
}
trap cleanup EXIT

# --- Run the issue daemon (foreground) ----------------------------------------

log "Starting issue daemon — status at http://localhost:${STATUS_PORT}/status"

# Run in foreground (not exec) so the shell stays alive and the trap fires on exit.
# This ensures the status server is cleaned up when the daemon exits.
bash scripts/issue-daemon.sh "$@"
