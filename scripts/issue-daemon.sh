#!/usr/bin/env bash
# issue-daemon.sh — Polls GitHub Issues labeled "claude-ready" and spawns
# Claude Code instances in isolated worktrees to implement them.
#
# Usage:
#   ./scripts/issue-daemon.sh                  # defaults: 1 worker, 60s poll, $10 budget
#   ./scripts/issue-daemon.sh -w 3 -i 30 -b 15 # 3 parallel workers, 30s poll, $15 budget
#
# Requirements:
#   - gh CLI authenticated
#   - claude CLI on PATH
#   - Run from the repo root

set -euo pipefail

# --- Configuration -----------------------------------------------------------
MAX_WORKERS=1          # max parallel Claude instances
POLL_INTERVAL=60       # seconds between polls
MAX_BUDGET=10          # max USD per issue
MAX_TURNS=50           # max agentic turns per issue
LABEL_READY="claude-ready"
LABEL_WIP="claude-wip"
LABEL_DONE="claude-done"
LABEL_BLOCKED="claude-blocked"
LOG_DIR="./logs/issue-daemon"

# --- Parse flags --------------------------------------------------------------
while getopts "w:i:b:t:" opt; do
  case $opt in
    w) MAX_WORKERS=$OPTARG ;;
    i) POLL_INTERVAL=$OPTARG ;;
    b) MAX_BUDGET=$OPTARG ;;
    t) MAX_TURNS=$OPTARG ;;
    *) echo "Usage: $0 [-w workers] [-i interval] [-b budget] [-t turns]" && exit 1 ;;
  esac
done

# --- Setup --------------------------------------------------------------------
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
mkdir -p "$LOG_DIR"

ACTIVE_PIDS=()

cleanup() {
  echo "[daemon] Shutting down..."
  for pid in "${ACTIVE_PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      echo "[daemon] Stopping worker PID $pid"
      kill "$pid" 2>/dev/null || true
    fi
  done
  exit 0
}
trap cleanup SIGINT SIGTERM

log() {
  echo "[daemon $(date '+%H:%M:%S')] $*"
}

# --- Worker function ----------------------------------------------------------
run_worker() {
  local issue_number="$1"
  local issue_title="$2"
  local log_file="$LOG_DIR/issue-${issue_number}.log"

  log "Starting worker for issue #${issue_number}: ${issue_title}"

  # Label as in-progress
  gh issue edit "$issue_number" --remove-label "$LABEL_READY" --add-label "$LABEL_WIP" 2>/dev/null || true

  # Run Claude in an isolated worktree
  claude -p "$(cat <<EOF
You are the issue-worker agent. Implement GitHub issue #${issue_number}.

Read the full issue with: gh issue view ${issue_number} --json title,body,labels,assignees

Follow your agent instructions exactly — assess complexity, plan if needed,
implement with TDD, run ci:check, review based on complexity tier, and create a PR.

If you get stuck, comment on the issue and add the label "claude-blocked".
EOF
)" \
    --agent "issue-worker" \
    --max-turns "$MAX_TURNS" \
    --max-budget-usd "$MAX_BUDGET" \
    --allowedTools "Agent,Bash,Edit,Glob,Grep,Read,Write,Skill" \
    > "$log_file" 2>&1

  local exit_code=$?

  if [ $exit_code -eq 0 ]; then
    log "Worker for issue #${issue_number} completed successfully"
    gh issue edit "$issue_number" --remove-label "$LABEL_WIP" --add-label "$LABEL_DONE" 2>/dev/null || true
  else
    log "Worker for issue #${issue_number} failed (exit code: $exit_code)"
    # Check if Claude already labeled it as blocked
    local labels
    labels=$(gh issue view "$issue_number" --json labels -q '.labels[].name' 2>/dev/null)
    if ! echo "$labels" | grep -q "$LABEL_BLOCKED"; then
      gh issue edit "$issue_number" --remove-label "$LABEL_WIP" --add-label "$LABEL_BLOCKED" 2>/dev/null || true
      gh issue comment "$issue_number" --body "Claude Code worker exited with code $exit_code. Check logs at \`$log_file\` for details." 2>/dev/null || true
    fi
  fi
}

# --- Reap finished workers ----------------------------------------------------
reap_workers() {
  local still_active=()
  for pid in "${ACTIVE_PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      still_active+=("$pid")
    fi
  done
  ACTIVE_PIDS=("${still_active[@]+"${still_active[@]}"}")
}

# --- Main loop ----------------------------------------------------------------
log "Started (workers=$MAX_WORKERS, poll=${POLL_INTERVAL}s, budget=\$${MAX_BUDGET}, turns=$MAX_TURNS)"
log "Watching for issues labeled '${LABEL_READY}'..."

while true; do
  reap_workers

  available_slots=$(( MAX_WORKERS - ${#ACTIVE_PIDS[@]} ))

  if [ "$available_slots" -gt 0 ]; then
    # Fetch up to available_slots issues
    issues=$(gh issue list \
      --state open \
      --label "$LABEL_READY" \
      --limit "$available_slots" \
      --json number,title \
      -q '.[]' 2>/dev/null || echo "")

    if [ -n "$issues" ]; then
      echo "$issues" | while IFS= read -r issue_json; do
        number=$(echo "$issue_json" | jq -r '.number')
        title=$(echo "$issue_json" | jq -r '.title')

        # Skip if already being worked on (defensive check)
        wip_check=$(gh issue view "$number" --json labels -q '.labels[].name' 2>/dev/null | grep -c "$LABEL_WIP" || true)
        if [ "$wip_check" -gt 0 ]; then
          log "Skipping issue #${number} (already WIP)"
          continue
        fi

        run_worker "$number" "$title" &
        ACTIVE_PIDS+=($!)
        log "Spawned worker PID $! for issue #${number}"
      done
    fi
  else
    log "All $MAX_WORKERS worker slots occupied, waiting..."
  fi

  sleep "$POLL_INTERVAL"
done
