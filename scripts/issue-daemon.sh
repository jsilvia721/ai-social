#!/usr/bin/env bash
# issue-daemon.sh — Polls GitHub Issues labeled "claude-ready" and spawns
# Claude Code instances in isolated worktrees to implement them.
#
# Usage:
#   ./scripts/issue-daemon.sh                  # defaults: 1 worker, 60s poll, $50 budget
#   ./scripts/issue-daemon.sh -w 3 -i 30 -b 100 # 3 parallel workers, 30s poll, $100 budget
#
# Signals:
#   SIGUSR1 — toggle drain mode (finish active workers, then exit)
#
# Requirements:
#   - gh CLI authenticated
#   - claude CLI on PATH
#   - Run from the repo root

set -euo pipefail

# --- Configuration -----------------------------------------------------------
MAX_WORKERS=1          # max parallel Claude instances
POLL_INTERVAL=60       # seconds between polls
MAX_BUDGET=50          # max USD per issue (set high for Max plan users)
LABEL_READY="claude-ready"
LABEL_WIP="claude-wip"
LABEL_DONE="claude-done"
LABEL_ACTIVE="claude-active"
LABEL_BLOCKED="claude-blocked"
LABEL_INTERRUPTED="claude-interrupted"
LABEL_RESUME="claude-resume"
LABEL_HUMAN_REVIEW="needs-human-review"
LABEL_APPROVED="claude-approved"
LABEL_BUG_INVESTIGATE="bug-investigate"
LABEL_BUG_PLANNED="bug-planned"
LOG_DIR="./logs/issue-daemon"
RATE_LIMIT_PAUSE_SECONDS=900
WALL_TIMEOUT=60            # wall-clock timeout in minutes per worker
HEARTBEAT_INTERVAL=30      # seconds between heartbeat writes
STALE_THRESHOLD=300        # seconds before a heartbeat is considered stale (5 min)

# --- Parse flags --------------------------------------------------------------
while getopts "w:i:b:T:" opt; do
  case $opt in
    w) MAX_WORKERS=$OPTARG ;;
    i) POLL_INTERVAL=$OPTARG ;;
    b) MAX_BUDGET=$OPTARG ;;
    T) WALL_TIMEOUT=$OPTARG ;;
    *) echo "Usage: $0 [-w workers] [-i interval] [-b budget] [-T timeout_min]" && exit 1 ;;
  esac
done

# --- Setup --------------------------------------------------------------------
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
mkdir -p "$LOG_DIR"

# Source the shared state library
# shellcheck source=scripts/lib/daemon-state.sh
source "scripts/lib/daemon-state.sh"
ensure_state_dir

# Clear stale drain mode from a previous run (drain is runtime-only)
if is_drain_mode; then
  clear_drain_mode
fi

PID_FILE="${WORKER_PID_FILE:-$LOG_DIR/.active_pids}"
export WORKER_PID_FILE="$PID_FILE"
: > "$PID_FILE"  # truncate on start

# Clean up orphaned heartbeat and stale-notified files from a previous run
for hb_file in "$LOG_DIR"/heartbeat-* "$LOG_DIR"/.stale-notified-*; do
  [ -f "$hb_file" ] && rm -f "$hb_file"
done

DAEMON_PID_FILE="$LOG_DIR/.issue-daemon.pid"
echo $$ > "$DAEMON_PID_FILE"

cleanup() {
  echo "[daemon] Shutting down..."
  while IFS=: read -r pid _issue _epoch _type; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "[daemon] Stopping worker PID $pid"
      kill "$pid" 2>/dev/null || true
    fi
  done < "$PID_FILE"
  # Remove all heartbeat and stale-notified files
  for hb_file in "$LOG_DIR"/heartbeat-* "$LOG_DIR"/.stale-notified-*; do
    [ -f "$hb_file" ] && rm -f "$hb_file"
  done
  rm -f "$PID_FILE" "$DAEMON_PID_FILE" "$CIRCUIT_BREAKER_FILE"
  exit 0
}
trap cleanup SIGINT SIGTERM

toggle_drain() {
  if is_drain_mode; then
    clear_drain_mode
    log "Drain mode DISABLED (resuming normal operation)"
  else
    set_drain_mode
    log "Drain mode ENABLED (will exit after active workers finish)"
  fi
}
trap toggle_drain USR1

log() {
  echo "[daemon $(date '+%H:%M:%S')] $*"
}

# Detect stdbuf for line-buffered output on worker spawns
STDBUF_PREFIX=""
if command -v stdbuf >/dev/null 2>&1; then
  STDBUF_PREFIX="stdbuf -oL -eL"
  log "Using stdbuf for line-buffered worker output"
else
  log "WARNING: stdbuf not found — worker logs may be block-buffered and incomplete on kill"
fi

# Source rate limit helpers (detect_rate_limit, parse_reset_time, format_reset_display,
# record_failure, check_circuit_breaker)
# shellcheck source=scripts/lib/rate-limit-helpers.sh
source "scripts/lib/rate-limit-helpers.sh"

# --- Rate limit exit handler --------------------------------------------------
# Shared handler for when a worker/executor hits a rate limit.
# Arguments: $1=issue_number, $2=runtime, $3=worker_type ("Worker"|"Plan-executor")
handle_rate_limit_exit() {
  local issue_number="$1"
  local runtime="$2"
  local worker_type="$3"
  local log_file="$4"

  log "${worker_type} for issue #${issue_number} hit rate limit (runtime: ${runtime}s)"

  # Try to parse reset time from log file for smarter pause duration
  local seconds_until_reset=0
  local reset_display=""
  if [ -n "$log_file" ] && [ -f "$log_file" ]; then
    local parse_output
    parse_output=$(parse_reset_time "$log_file")
    seconds_until_reset=$(echo "$parse_output" | head -1)
    reset_display=$(echo "$parse_output" | tail -1)
  fi

  local comment_suffix
  if [ "$seconds_until_reset" -gt 0 ]; then
    set_rate_limit_pause "$seconds_until_reset"
    comment_suffix="Will auto-retry after ${reset_display}."
    log "Parsed reset time: ${reset_display} (${seconds_until_reset}s from now)"
  else
    set_rate_limit_pause "$RATE_LIMIT_PAUSE_SECONDS"
    comment_suffix="Will auto-retry after cooldown (~$((RATE_LIMIT_PAUSE_SECONDS / 60)) minutes)."
  fi

  gh issue edit "$issue_number" --remove-label "$LABEL_WIP" --add-label "$LABEL_INTERRUPTED" 2>/dev/null || true
  gh issue comment "$issue_number" --body "${worker_type} interrupted by API usage limit (runtime: ${runtime}s). ${comment_suffix}" 2>/dev/null || true
}

# --- Circuit breaker configuration --------------------------------------------
CIRCUIT_BREAKER_FILE="$LOG_DIR/.failure_times"
CIRCUIT_BREAKER_WINDOW=60   # seconds
CIRCUIT_BREAKER_THRESHOLD=3 # failures within window

# --- Worktree lookup ----------------------------------------------------------
# Find the worktree directory for a given issue number.
# Scans for branches matching issue-{N}-*.
# $1 — issue_number. Outputs worktree path or empty string.
find_issue_worktree() {
  local issue_number="$1"
  for wt in .claude/worktrees/*/; do
    [ -d "$wt" ] || continue
    local branch
    branch=$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    if [[ "$branch" == issue-${issue_number}-* ]]; then
      echo "$wt"
      return
    fi
  done
}

# --- WIP commit ---------------------------------------------------------------
# Commit and push any uncommitted work in a worktree for the given issue.
# Arguments: $1=issue_number
commit_wip_if_needed() {
  local issue_number="$1"
  local wt
  wt=$(find_issue_worktree "$issue_number")
  [ -n "$wt" ] || return

  # Check for uncommitted changes (include untracked files — worktree is isolated and .gitignore excludes secrets)
  if [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
    log "Committing WIP changes in worktree for issue #${issue_number}"
    git -C "$wt" add -A 2>/dev/null || true
    git -C "$wt" commit -m "WIP: worker interrupted (issue #${issue_number})" 2>/dev/null || true
  fi

  # Push any unpushed commits
  local branch
  branch=$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  git -C "$wt" push -u origin "$branch" 2>/dev/null || true
}

# --- Worktree cleanup ---------------------------------------------------------
# Run git clean -fd in the worktree for a given issue to remove untracked files.
# Arguments: $1=issue_number
clean_worktree() {
  local issue_number="$1"
  local wt
  wt=$(find_issue_worktree "$issue_number")
  [ -n "$wt" ] || return

  local cleaned
  cleaned=$(git -C "$wt" clean -fd 2>&1 || true)
  if [ -n "$cleaned" ]; then
    log "Cleaned untracked files in worktree for issue #${issue_number}:"
    echo "$cleaned" | while IFS= read -r line; do
      log "  $line"
    done
  fi
}

# --- Heartbeat helper ---------------------------------------------------------
# Start a background heartbeat writer for a given issue/PID.
# $1 — issue_number, $2 — PID to monitor
# Outputs the heartbeat subshell PID to stdout.
start_heartbeat() {
  local issue_number="$1"
  local monitored_pid="$2"
  local hb_file="$LOG_DIR/heartbeat-${issue_number}"

  (
    while kill -0 "$monitored_pid" 2>/dev/null; do
      date +%s > "${hb_file}.tmp" && mv "${hb_file}.tmp" "$hb_file"
      sleep "$HEARTBEAT_INTERVAL"
    done
  ) &
  echo $!
}

# Stop heartbeat and clean up file.
# $1 — heartbeat subshell PID, $2 — issue_number
stop_heartbeat() {
  local hb_pid="$1"
  local issue_number="$2"
  kill "$hb_pid" 2>/dev/null || true
  wait "$hb_pid" 2>/dev/null || true
  rm -f "$LOG_DIR/heartbeat-${issue_number}"
}

# --- Session ID management ----------------------------------------------------
# Save session ID for an issue so we can resume later.
# $1 — issue_number, $2 — session_id
save_session_id() {
  echo "$2" > "$LOG_DIR/.session-${1}"
}

# Load saved session ID for an issue (if any).
# $1 — issue_number. Outputs session ID or empty string.
load_session_id() {
  local file="$LOG_DIR/.session-${1}"
  if [ -f "$file" ]; then
    cat "$file"
  fi
}

# Clear saved session ID for an issue.
# $1 — issue_number
clear_session_id() {
  rm -f "$LOG_DIR/.session-${1}"
}

# --- Worker function ----------------------------------------------------------
run_worker() {
  local issue_number="$1"
  local issue_title="$2"
  local is_retry="${3:-false}"
  local is_resume="${4:-false}"
  local log_file="$LOG_DIR/issue-${issue_number}.log"

  log "Starting worker for issue #${issue_number}: ${issue_title} (retry=$is_retry, resume=$is_resume)"

  if [ "$is_resume" = "true" ]; then
    # Remove resume label
    gh issue edit "$issue_number" --remove-label "$LABEL_RESUME" --add-label "$LABEL_WIP" 2>/dev/null || true
    # Also remove blocked in case it was blocked before resume
    gh issue edit "$issue_number" --remove-label "$LABEL_BLOCKED" 2>/dev/null || true
  elif [ "$is_retry" = "true" ]; then
    # Remove interrupted label for retry
    gh issue edit "$issue_number" --remove-label "$LABEL_INTERRUPTED" --add-label "$LABEL_WIP" 2>/dev/null || true
  else
    # Label as in-progress
    gh issue edit "$issue_number" --remove-label "$LABEL_READY" --add-label "$LABEL_WIP" 2>/dev/null || true
  fi

  # Check if we can resume a previous session
  local session_id=""
  local worktree_path=""
  local can_resume=false

  if [ "$is_retry" = "true" ] || [ "$is_resume" = "true" ]; then
    session_id=$(load_session_id "$issue_number")
    worktree_path=$(find_issue_worktree "$issue_number")
    if [ -n "$session_id" ] && [ -n "$worktree_path" ] && [ -d "$worktree_path" ]; then
      can_resume=true
      log "Resuming session $session_id in worktree $worktree_path"
    else
      log "No resumable session found (session_id=${session_id:-none}, worktree=${worktree_path:-none}), starting fresh"
    fi
  fi

  # Record start time
  local start_time
  start_time=$(date +%s)

  if [ "$can_resume" = "true" ]; then
    # Resume the previous Claude session in the existing worktree
    local resume_prompt
    resume_prompt="Continue working on issue #${issue_number}. You were previously interrupted. Pick up where you left off and complete the implementation. If you already created a PR, verify it's ready. If not, continue with the TDD workflow."

    (cd "$worktree_path" && $STDBUF_PREFIX claude -p "$resume_prompt" \
      --agent "issue-worker" \
      --resume "$session_id" \
      --max-budget-usd "$MAX_BUDGET" \
      --allowedTools "Agent,Bash,Edit,Glob,Grep,Read,Write,Skill" \
      >> "$log_file" 2>&1) &
    local claude_pid=$!
  else
    # Fresh start — generate a new session ID
    session_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
    save_session_id "$issue_number" "$session_id"

    # Build the prompt (with retry context if applicable)
    local retry_prefix=""
    if [ "$is_retry" = "true" ] || [ "$is_resume" = "true" ]; then
      retry_prefix="RETRY: Retrying issue #${issue_number}.

This issue was previously attempted. Check for an existing WIP branch:
  git branch -r --list \"origin/issue-${issue_number}-*\"
If a WIP branch exists, check it out and continue from where the previous attempt left off.
Also read the issue comments for context on what was already done.

"
    fi

    local prompt
    prompt="$(cat <<EOF
You are the issue-worker agent. ${retry_prefix}Implement GitHub issue #${issue_number}.

Read the full issue with: gh issue view ${issue_number} --json title,body,labels,assignees

Follow your agent instructions exactly — assess complexity, plan if needed,
implement with TDD, run ci:check, review based on complexity tier, and create a PR.

If you get stuck, comment on the issue and add the label "claude-blocked".
EOF
)"

    $STDBUF_PREFIX claude -p "$prompt" \
      --agent "issue-worker" \
      --worktree \
      --session-id "$session_id" \
      --max-budget-usd "$MAX_BUDGET" \
      --allowedTools "Agent,Bash,Edit,Glob,Grep,Read,Write,Skill" \
      > "$log_file" 2>&1 &
    local claude_pid=$!
  fi

  # Start heartbeat writer
  local hb_pid
  hb_pid=$(start_heartbeat "$issue_number" "$claude_pid")

  # Wait for Claude to finish
  wait "$claude_pid"
  local exit_code=$?

  # Stop heartbeat
  stop_heartbeat "$hb_pid" "$issue_number"

  local end_time
  end_time=$(date +%s)
  local runtime=$(( end_time - start_time ))

  # Get our own PID for cleanup (Bash 3 compatible)
  local self_pid
  self_pid=$(sh -c 'echo $PPID')

  # Check for rate limit first
  if detect_rate_limit "$exit_code" "$log_file"; then
    commit_wip_if_needed "$issue_number"
    handle_rate_limit_exit "$issue_number" "$runtime" "Worker" "$log_file"
    clean_worktree "$issue_number"
    remove_worker "$self_pid"
    return
  fi

  # Verify a PR was actually created for this issue (regardless of exit code)
  local pr_url
  pr_url=$(gh pr list --search "Closes #${issue_number}" --json url -q '.[0].url' 2>/dev/null || echo "")
  if [ -z "$pr_url" ]; then
    # Also check for "closes #N" in PR body with issue number in branch name
    pr_url=$(gh pr list --search "${issue_number}" --json url,body -q ".[] | select(.body | test(\"#${issue_number}\")) | .url" 2>/dev/null | head -1 || echo "")
  fi

  if [ $exit_code -eq 0 ] && [ -n "$pr_url" ]; then
    log "Worker for issue #${issue_number} completed successfully (PR: ${pr_url})"
    gh issue edit "$issue_number" --remove-label "$LABEL_WIP" --add-label "$LABEL_DONE" 2>/dev/null || true
    clear_session_id "$issue_number"
  else
    record_failure
    if [ $exit_code -eq 0 ] && [ -z "$pr_url" ]; then
      log "Worker for issue #${issue_number} exited cleanly but no PR was created (likely hit budget limit)"
    else
      log "Worker for issue #${issue_number} failed (exit code: $exit_code)"
    fi
    # Check if Claude already labeled it as blocked
    local labels
    labels=$(gh issue view "$issue_number" --json labels -q '.labels[].name' 2>/dev/null)
    if ! echo "$labels" | grep -q "$LABEL_BLOCKED"; then
      gh issue edit "$issue_number" --remove-label "$LABEL_WIP" --add-label "$LABEL_BLOCKED" 2>/dev/null || true
      local fail_reason="exit code $exit_code"
      if [ $exit_code -eq 0 ] && [ -z "$pr_url" ]; then
        fail_reason="no PR created (possible budget limit). Add label '$LABEL_RESUME' to resume this session."
      fi
      gh issue comment "$issue_number" --body "Claude Code worker finished but did not complete: ${fail_reason}. Check logs at \`$log_file\` for details." 2>/dev/null || true
    fi
  fi

  clean_worktree "$issue_number"
  remove_worker "$self_pid"
}

# --- Plan executor function ---------------------------------------------------
run_plan_executor() {
  local issue_number="$1"
  local issue_title="$2"
  local log_file="$LOG_DIR/plan-${issue_number}.log"

  log "Starting plan-executor for issue #${issue_number}: ${issue_title}"

  # Label as in-progress
  gh issue edit "$issue_number" --remove-label "$LABEL_APPROVED" --add-label "$LABEL_WIP" 2>/dev/null || true

  # Record start time
  local start_time
  start_time=$(date +%s)

  # Run Claude in background so heartbeat can run concurrently
  $STDBUF_PREFIX claude -p "$(cat <<EOF
You are the plan-executor agent. Process approved plan issue #${issue_number}.

Read the full issue with: gh issue view ${issue_number} --json title,body,labels

Follow your agent instructions exactly — parse the plan items, create work issues
with correct labels and dependencies, post a summary, and close out the plan issue.

If parsing fails, comment on the issue and add the label "claude-blocked".
EOF
)" \
    --agent "plan-executor" \
    --max-budget-usd "$MAX_BUDGET" \
    --allowedTools "Bash,Glob,Grep,Read" \
    > "$log_file" 2>&1 &
  local claude_pid=$!

  # Start heartbeat writer
  local hb_pid
  hb_pid=$(start_heartbeat "$issue_number" "$claude_pid")

  # Wait for Claude to finish
  wait "$claude_pid"
  local exit_code=$?

  # Stop heartbeat
  stop_heartbeat "$hb_pid" "$issue_number"

  local end_time
  end_time=$(date +%s)
  local runtime=$(( end_time - start_time ))

  # Get our own PID for cleanup (Bash 3 compatible)
  local self_pid
  self_pid=$(sh -c 'echo $PPID')

  # Check for rate limit first
  if detect_rate_limit "$exit_code" "$log_file"; then
    handle_rate_limit_exit "$issue_number" "$runtime" "Plan-executor" "$log_file"
    clean_worktree "$issue_number"
    remove_worker "$self_pid"
    return
  fi

  if [ $exit_code -eq 0 ]; then
    log "Plan-executor for issue #${issue_number} completed successfully"
    # plan-executor handles its own label transitions (approved -> done)
    # but ensure WIP is removed if still present
    gh issue edit "$issue_number" --remove-label "$LABEL_WIP" 2>/dev/null || true
  else
    record_failure
    log "Plan-executor for issue #${issue_number} failed (exit code: $exit_code)"
    local labels
    labels=$(gh issue view "$issue_number" --json labels -q '.labels[].name' 2>/dev/null)
    if ! echo "$labels" | grep -q "$LABEL_BLOCKED"; then
      gh issue edit "$issue_number" --remove-label "$LABEL_WIP" --add-label "$LABEL_BLOCKED" 2>/dev/null || true
      gh issue comment "$issue_number" --body "Plan-executor exited with code $exit_code. Check logs at \`$log_file\` for details." 2>/dev/null || true
    fi
  fi

  clean_worktree "$issue_number"
  remove_worker "$self_pid"
}

# --- Bug investigator function ------------------------------------------------
run_bug_investigator() {
  local issue_number="$1"
  local issue_title="$2"
  local log_file="$LOG_DIR/bug-investigate-${issue_number}.log"

  log "Starting bug-investigator for issue #${issue_number}: ${issue_title}"

  # Label as in-progress
  gh issue edit "$issue_number" --remove-label "$LABEL_BUG_INVESTIGATE" --add-label "$LABEL_WIP" 2>/dev/null || true

  # Record start time
  local start_time
  start_time=$(date +%s)

  # Run Claude in background so heartbeat can run concurrently
  $STDBUF_PREFIX claude -p "$(cat <<EOF
You are the bug-investigator agent. Investigate bug issue #${issue_number}.

Read the full issue with: gh issue view ${issue_number} --json title,body,labels

Follow your agent instructions exactly — read the bug issue, investigate the codebase
to find the root cause, and create a plan issue for fixing it.

If you get stuck, comment on the issue and add the label "claude-blocked".
EOF
)" \
    --agent "bug-investigator" \
    --max-budget-usd "$MAX_BUDGET" \
    --allowedTools "Bash,Glob,Grep,Read" \
    > "$log_file" 2>&1 &
  local claude_pid=$!

  # Start heartbeat writer
  local hb_pid
  hb_pid=$(start_heartbeat "$issue_number" "$claude_pid")

  # Wait for Claude to finish
  wait "$claude_pid"
  local exit_code=$?

  # Stop heartbeat
  stop_heartbeat "$hb_pid" "$issue_number"

  local end_time
  end_time=$(date +%s)
  local runtime=$(( end_time - start_time ))

  # Get our own PID for cleanup (Bash 3 compatible)
  local self_pid
  self_pid=$(sh -c 'echo $PPID')

  # Check for rate limit first
  if detect_rate_limit "$exit_code" "$log_file"; then
    handle_rate_limit_exit "$issue_number" "$runtime" "Bug-investigator" "$log_file"
    remove_worker "$self_pid"
    return
  fi

  if [ $exit_code -eq 0 ]; then
    log "Bug-investigator for issue #${issue_number} completed successfully"
    # bug-investigator handles its own label transitions (bug-investigate -> bug-planned)
    # but ensure WIP is removed if still present
    gh issue edit "$issue_number" --remove-label "$LABEL_WIP" 2>/dev/null || true
  else
    record_failure
    log "Bug-investigator for issue #${issue_number} failed (exit code: $exit_code)"
    local labels
    labels=$(gh issue view "$issue_number" --json labels -q '.labels[].name' 2>/dev/null)
    if ! echo "$labels" | grep -q "$LABEL_BLOCKED"; then
      gh issue edit "$issue_number" --remove-label "$LABEL_WIP" --add-label "$LABEL_BLOCKED" 2>/dev/null || true
      gh issue comment "$issue_number" --body "Bug-investigator exited with code $exit_code. Check logs at \`$log_file\` for details." 2>/dev/null || true
    fi
  fi

  remove_worker "$self_pid"
}

# --- Worker tracking via PID file ---------------------------------------------
active_worker_count() {
  local count=0
  local tmp
  tmp=$(mktemp)
  while IFS=: read -r pid issue epoch type; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "${pid}:${issue}:${epoch}:${type}" >> "$tmp"
      count=$((count + 1))
    fi
  done < "$PID_FILE"
  mv "$tmp" "$PID_FILE"
  echo "$count"
}

# --- Main loop ----------------------------------------------------------------
log "Started (workers=$MAX_WORKERS, poll=${POLL_INTERVAL}s, budget=\$${MAX_BUDGET}, timeout=${WALL_TIMEOUT}m)"
log "Watching for issues labeled '${LABEL_RESUME}', '${LABEL_INTERRUPTED}', '${LABEL_APPROVED}', '${LABEL_BUG_INVESTIGATE}', and '${LABEL_READY}'..."
log "PID file: ${DAEMON_PID_FILE} (send SIGUSR1 to toggle drain mode)"

while true; do
  # --- 1. Drain mode check ---
  if is_drain_mode; then
    active=$(active_worker_count)
    if [ "$active" -eq 0 ]; then
      clear_drain_mode
      log "All workers finished. Drain complete, exiting."
      rm -f "$PID_FILE" "$DAEMON_PID_FILE"
      exit 0
    fi
    log "Drain mode: waiting for $active worker(s) to finish..."
    sleep "$POLL_INTERVAL"
    continue
  fi

  # --- 2. Rate limit pause check ---
  if is_rate_limit_paused; then
    log "Rate-limit paused until $(get_pause_until_display)"
    sleep "$POLL_INTERVAL"
    continue
  fi

  # --- 2b. Circuit breaker check ---
  if check_circuit_breaker; then
    log "Circuit breaker tripped: ${CIRCUIT_BREAKER_THRESHOLD}+ failures in ${CIRCUIT_BREAKER_WINDOW}s. Pausing for $((RATE_LIMIT_PAUSE_SECONDS / 60)) minutes."
    set_rate_limit_pause "$RATE_LIMIT_PAUSE_SECONDS"
    : > "$CIRCUIT_BREAKER_FILE"  # reset after tripping
    sleep "$POLL_INTERVAL"
    continue
  fi

  # --- 3. Stale detection & wall-clock timeout ---
  now_epoch=$(date +%s)
  wall_timeout_secs=$(( WALL_TIMEOUT * 60 ))

  while IFS=: read -r w_pid w_issue w_start w_type; do
    [ -n "$w_pid" ] || continue

    # Dead worker — clean up orphaned state
    if ! kill -0 "$w_pid" 2>/dev/null; then
      rm -f "$LOG_DIR/heartbeat-${w_issue}" "$LOG_DIR/.stale-notified-${w_pid}"
      remove_worker "$w_pid"
      continue
    fi

    # Wall-clock timeout check (runs before stale check)
    elapsed=$(( now_epoch - w_start ))
    if [ "$elapsed" -ge "$wall_timeout_secs" ]; then
      elapsed_min=$(( elapsed / 60 ))
      log "Worker PID $w_pid for issue #${w_issue} exceeded wall-clock timeout (${elapsed_min}m > ${WALL_TIMEOUT}m)"
      commit_wip_if_needed "$w_issue"
      kill -TERM "$w_pid" 2>/dev/null || true
      # Poll for graceful exit (10s max, 1s intervals to stay responsive to signals)
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        kill -0 "$w_pid" 2>/dev/null || break
        sleep 1
      done
      if kill -0 "$w_pid" 2>/dev/null; then
        kill -KILL "$w_pid" 2>/dev/null || true
      fi
      gh issue edit "$w_issue" --remove-label "$LABEL_WIP" --add-label "$LABEL_BLOCKED" 2>/dev/null || true
      gh issue comment "$w_issue" --body "Worker timed out after ${elapsed_min} minutes (wall-clock limit: ${WALL_TIMEOUT}m). Check logs at \`$LOG_DIR/issue-${w_issue}.log\`." 2>/dev/null || true
      rm -f "$LOG_DIR/heartbeat-${w_issue}" "$LOG_DIR/.stale-notified-${w_pid}"
      remove_worker "$w_pid"
      continue
    fi

    # Stale heartbeat check (only notify once per worker via marker file)
    hb_file="$LOG_DIR/heartbeat-${w_issue}"
    stale_marker="$LOG_DIR/.stale-notified-${w_pid}"
    if [ -f "$hb_file" ] && [ ! -f "$stale_marker" ]; then
      hb_epoch=$(cat "$hb_file" 2>/dev/null || echo "0")
      stale_secs=$(( now_epoch - hb_epoch ))
      if [ "$stale_secs" -ge "$STALE_THRESHOLD" ]; then
        stale_min=$(( stale_secs / 60 ))
        stale_log_file="$LOG_DIR/issue-${w_issue}.log"
        if [ "$w_type" = "plan" ]; then
          stale_log_file="$LOG_DIR/plan-${w_issue}.log"
        elif [ "$w_type" = "bug-investigate" ]; then
          stale_log_file="$LOG_DIR/bug-investigate-${w_issue}.log"
        fi
        log "Worker PID $w_pid for issue #${w_issue} appears stalled (no heartbeat for ${stale_min}m)"
        gh issue edit "$w_issue" --remove-label "$LABEL_WIP" --add-label "$LABEL_BLOCKED" 2>/dev/null || true
        gh issue comment "$w_issue" --body "Worker appears stalled (no heartbeat for ${stale_min}m). Check logs at \`$stale_log_file\`." 2>/dev/null || true
        touch "$stale_marker"
      fi
    fi
  done < "$PID_FILE"

  active=$(active_worker_count)
  available_slots=$(( MAX_WORKERS - active ))

  if [ "$available_slots" -gt 0 ]; then
    # --- Priority 0: Resume manually-triggered issues (claude-resume label) ---
    resume_issues=$(gh issue list \
      --state open \
      --label "$LABEL_RESUME" \
      --limit "$available_slots" \
      --json number,title \
      -q '.[] | @json' 2>/dev/null || echo "")

    if [ -n "$resume_issues" ]; then
      while IFS= read -r issue_json; do
        number=$(echo "$issue_json" | jq -r '.number')
        title=$(echo "$issue_json" | jq -r '.title')

        wip_check=$(gh issue view "$number" --json labels -q '.labels[].name' 2>/dev/null | grep -c "$LABEL_WIP" || true)
        if [ "$wip_check" -gt 0 ]; then
          log "Skipping resume issue #${number} (already WIP)"
          continue
        fi

        run_worker "$number" "$title" "false" "true" &
        record_worker "$!" "$number" "worker"
        log "Spawned resume worker PID $! for issue #${number}"
      done <<< "$resume_issues"

      # Recalculate available slots
      active=$(active_worker_count)
      available_slots=$(( MAX_WORKERS - active ))
    fi

    # --- Priority 0.5: Retry interrupted issues (auto rate-limit retries) ---
    if [ "$available_slots" -gt 0 ]; then
    interrupted_issues=$(gh issue list \
      --state open \
      --label "$LABEL_INTERRUPTED" \
      --limit "$available_slots" \
      --json number,title \
      -q '.[] | @json' 2>/dev/null || echo "")

    if [ -n "$interrupted_issues" ]; then
      while IFS= read -r issue_json; do
        number=$(echo "$issue_json" | jq -r '.number')
        title=$(echo "$issue_json" | jq -r '.title')

        wip_check=$(gh issue view "$number" --json labels -q '.labels[].name' 2>/dev/null | grep -c "$LABEL_WIP" || true)
        if [ "$wip_check" -gt 0 ]; then
          log "Skipping interrupted issue #${number} (already WIP)"
          continue
        fi

        run_worker "$number" "$title" "true" "false" &
        record_worker "$!" "$number" "worker"
        log "Spawned retry worker PID $! for interrupted issue #${number}"
      done <<< "$interrupted_issues"

      # Recalculate available slots
      active=$(active_worker_count)
      available_slots=$(( MAX_WORKERS - active ))
    fi
    fi

    # --- Priority 1: Approved plans (create work issues quickly) ---
    if [ "$available_slots" -gt 0 ]; then
      approved_issues=$(gh issue list \
        --state open \
        --label "$LABEL_APPROVED" \
        --limit "$available_slots" \
        --json number,title,body \
        -q '.[] | @json' 2>/dev/null || echo "")

      if [ -n "$approved_issues" ]; then
        while IFS= read -r issue_json; do
          number=$(echo "$issue_json" | jq -r '.number')
          title=$(echo "$issue_json" | jq -r '.title')
          body=$(echo "$issue_json" | jq -r '.body')

          wip_check=$(gh issue view "$number" --json labels -q '.labels[].name' 2>/dev/null | grep -c "$LABEL_WIP" || true)
          if [ "$wip_check" -gt 0 ]; then
            log "Skipping plan #${number} (already WIP)"
            continue
          fi

          # Check if this is a plan (has plan markers) or a single work item
          if echo "$body" | grep -q "PLAN_ITEMS_START"; then
            run_plan_executor "$number" "$title" &
            record_worker "$!" "$number" "plan"
            log "Spawned plan-executor PID $! for issue #${number}"
          else
            # Single work item — route to needs-human-review for human review
            log "Issue #${number} is a single work item (no plan markers), routing to needs-human-review"
            gh issue edit "$number" --remove-label "$LABEL_APPROVED" --add-label "$LABEL_HUMAN_REVIEW" 2>/dev/null || true
            gh issue comment "$number" --body "This is a single work item (not a multi-item plan). Routing to \`needs-human-review\` for human review before work begins." 2>/dev/null || true
          fi
        done <<< "$approved_issues"

        # Recalculate available slots after spawning plan executors
        active=$(active_worker_count)
        available_slots=$(( MAX_WORKERS - active ))
      fi
    fi

    # --- Priority 1.5: Bug investigation issues ---
    if [ "$available_slots" -gt 0 ]; then
      bug_issues=$(gh issue list \
        --state open \
        --label "$LABEL_BUG_INVESTIGATE" \
        --limit "$available_slots" \
        --json number,title \
        -q '.[] | @json' 2>/dev/null || echo "")

      if [ -n "$bug_issues" ]; then
        while IFS= read -r issue_json; do
          number=$(echo "$issue_json" | jq -r '.number')
          title=$(echo "$issue_json" | jq -r '.title')

          wip_check=$(gh issue view "$number" --json labels -q '.labels[].name' 2>/dev/null | grep -c "$LABEL_WIP" || true)
          if [ "$wip_check" -gt 0 ]; then
            log "Skipping bug issue #${number} (already WIP)"
            continue
          fi

          run_bug_investigator "$number" "$title" &
          record_worker "$!" "$number" "bug-investigate"
          log "Spawned bug-investigator PID $! for issue #${number}"
        done <<< "$bug_issues"

        # Recalculate available slots
        active=$(active_worker_count)
        available_slots=$(( MAX_WORKERS - active ))
      fi
    fi

    # --- Priority 2: Ready work issues ---
    if [ "$available_slots" -gt 0 ]; then
      issues=$(gh issue list \
        --state open \
        --label "$LABEL_READY" \
        --limit "$available_slots" \
        --json number,title \
        -q '.[] | @json' 2>/dev/null || echo "")

      if [ -n "$issues" ]; then
        while IFS= read -r issue_json; do
          number=$(echo "$issue_json" | jq -r '.number')
          title=$(echo "$issue_json" | jq -r '.title')

          wip_check=$(gh issue view "$number" --json labels -q '.labels[].name' 2>/dev/null | grep -c "$LABEL_WIP" || true)
          if [ "$wip_check" -gt 0 ]; then
            log "Skipping issue #${number} (already WIP)"
            continue
          fi

          run_worker "$number" "$title" &
          record_worker "$!" "$number" "worker"
          log "Spawned worker PID $! for issue #${number}"
        done <<< "$issues"
      fi
    fi
  else
    log "All $MAX_WORKERS worker slots occupied, waiting..."
  fi

  sleep "$POLL_INTERVAL"
done
