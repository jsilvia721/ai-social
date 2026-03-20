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
LABEL_PLAN="plan"
LABEL_NEEDS_HUMAN_REVIEW="needs-human-review"
LOG_DIR="./logs/issue-daemon"  # made absolute after REPO_ROOT is set below
RATE_LIMIT_PAUSE_SECONDS=900
WALL_TIMEOUT=60            # wall-clock timeout in minutes per worker
HEARTBEAT_INTERVAL=30      # seconds between heartbeat writes
STALE_THRESHOLD=300        # seconds before a heartbeat is considered stale (5 min)
TMUX_MODE="auto"           # "auto" (detect), "on" (force), "off" (disable)
LABEL_NEEDS_REBASE="needs-manual-rebase"

# --- Parse flags --------------------------------------------------------------
while getopts "w:i:b:T:t:" opt; do
  case $opt in
    w) MAX_WORKERS=$OPTARG ;;
    i) POLL_INTERVAL=$OPTARG ;;
    b) MAX_BUDGET=$OPTARG ;;
    T) WALL_TIMEOUT=$OPTARG ;;
    t) TMUX_MODE=$OPTARG ;;
    *) echo "Usage: $0 [-w workers] [-i interval] [-b budget] [-T timeout_min] [-t on|off|auto]" && exit 1 ;;
  esac
done

# --- Setup --------------------------------------------------------------------
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
LOG_DIR="$REPO_ROOT/logs/issue-daemon"
mkdir -p "$LOG_DIR"

# Define log() early — sourced libraries (conflict-resolver.sh, etc.) call it during init
log() {
  echo "[daemon $(date '+%H:%M:%S')] $*"
}

# Source the shared state library
# shellcheck source=scripts/lib/daemon-state.sh
source "scripts/lib/daemon-state.sh"
ensure_state_dir

# Source conflict resolver early — cleanup_stale_conflict_worktrees is called during init
# shellcheck source=scripts/lib/conflict-resolver.sh
source "scripts/lib/conflict-resolver.sh"

# Source startup reconciliation for orphaned WIP issues
# shellcheck source=scripts/lib/daemon-reconcile.sh
source "scripts/lib/daemon-reconcile.sh"

# Clear stale drain mode from a previous run (drain is runtime-only)
if is_drain_mode; then
  clear_drain_mode
fi

PID_FILE="${WORKER_PID_FILE:-$LOG_DIR/.active_pids}"
export WORKER_PID_FILE="$PID_FILE"

# Singleton guard — prevent multiple daemon instances from running simultaneously.
# Must run BEFORE any cleanup operations to avoid interfering with a running daemon's state.
DAEMON_PID_FILE="$LOG_DIR/.issue-daemon.pid"
if [ -f "$DAEMON_PID_FILE" ]; then
  existing_pid=$(cat "$DAEMON_PID_FILE" 2>/dev/null || echo "")
  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "ERROR: Another daemon instance is already running (PID $existing_pid). Exiting." >&2
    exit 1
  fi
  rm -f "$DAEMON_PID_FILE"
fi
# Atomic PID file creation — noclobber prevents TOCTOU race between simultaneous starts
if ! ( set -o noclobber; echo $$ > "$DAEMON_PID_FILE" ) 2>/dev/null; then
  echo "ERROR: Race condition — another daemon instance claimed the PID file. Exiting." >&2
  exit 1
fi

: > "$PID_FILE"  # truncate on start

# Clean up orphaned heartbeat and stale-notified files from a previous run
for hb_file in "$LOG_DIR"/heartbeat-* "$LOG_DIR"/.stale-notified-*; do
  [ -f "$hb_file" ] && rm -f "$hb_file"
done

# Clean up PR-check marker files from a previous run
for pr_file in "$LOG_DIR"/.pr-check-*; do
  [ -f "$pr_file" ] && rm -f "$pr_file"
done

# Clean up stale conflict worktrees from a previous run (crash recovery)
cleanup_stale_conflict_worktrees

# Reap orphaned processes matching a pattern with ppid=1 (parent daemon died).
# $1 — pgrep pattern, $2 — label for log messages
reap_orphans() {
  local pattern="$1" label="$2"
  for orphan_pid in $(pgrep -f "$pattern" 2>/dev/null || true); do
    [ -z "$orphan_pid" ] && continue
    orphan_ppid=$(ps -o ppid= -p "$orphan_pid" 2>/dev/null | tr -d ' ')
    if [ "$orphan_ppid" = "1" ]; then
      echo "[daemon] Killing orphaned $label PID $orphan_pid: $(ps -o args= -p "$orphan_pid" 2>/dev/null || echo unknown)"
      kill -TERM "$orphan_pid" 2>/dev/null || true
    fi
  done
}
reap_orphans "docker (compose|ps|info)" "Docker process"
reap_orphans "shell-snapshots/snapshot-zsh" "Claude shell wrapper"

# Reconcile orphaned WIP issues — any issue still labeled claude-wip with no
# matching PID file entry gets transitioned to claude-interrupted (crash recovery)
reconcile_orphaned_wip_issues

# Kill a tmux session for a given issue number (if it exists).
# $1 — issue_number
kill_worker_tmux_session() {
  local issue_number="$1"
  if [ "$TMUX_ENABLED" = "true" ] && command -v tmux >/dev/null 2>&1; then
    local tmux_session="worker-${issue_number}"
    if tmux has-session -t "$tmux_session" 2>/dev/null; then
      log "Killing tmux session $tmux_session"
      tmux kill-session -t "$tmux_session" 2>/dev/null || true
    fi
  fi
}

# Kill an entire process group (SIGTERM, wait 10s, SIGKILL fallback).
# $1 — PID of the process group leader
kill_process_group() {
  local pid="$1"
  # Guard against invalid PIDs (empty, 0, or 1 would kill unintended processes)
  if [ -z "$pid" ] || [ "$pid" -le 1 ] 2>/dev/null; then
    echo "[daemon] WARNING: refusing to kill process group for invalid PID: '$pid'"
    return 1
  fi
  # Attempt process group kill first; fall back to regular kill
  if ! kill -TERM -- -"$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
  # Poll for exit (10s max, 1s intervals)
  local i=0
  while [ "$i" -lt 10 ]; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 1
    i=$((i + 1))
  done
  # Still alive — SIGKILL
  if kill -0 "$pid" 2>/dev/null; then
    if ! kill -KILL -- -"$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  fi
}

# Kill all worker tmux sessions by scanning the PID file for issue numbers.
kill_all_worker_tmux_sessions() {
  if [ "$TMUX_ENABLED" = "true" ] && command -v tmux >/dev/null 2>&1; then
    while IFS=: read -r _pid issue _epoch _type; do
      [ -n "$issue" ] || continue
      local tmux_session="worker-${issue}"
      if tmux has-session -t "$tmux_session" 2>/dev/null; then
        echo "[daemon] Killing tmux session $tmux_session"
        tmux kill-session -t "$tmux_session" 2>/dev/null || true
      fi
    done < "$PID_FILE"
  fi
}

cleanup() {
  echo "[daemon] Shutting down..."
  while IFS=: read -r pid _issue _epoch _type; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "[daemon] Stopping worker PID $pid (process group kill)"
      kill_process_group "$pid"
    fi
  done < "$PID_FILE"
  # Kill any orphaned tmux sessions
  kill_all_worker_tmux_sessions
  # Remove all heartbeat and stale-notified files
  for hb_file in "$LOG_DIR"/heartbeat-* "$LOG_DIR"/.stale-notified-*; do
    [ -f "$hb_file" ] && rm -f "$hb_file"
  done
  # Remove PR-check and PR-discovery marker files
  for pr_file in "$LOG_DIR"/.pr-check-* "$LOG_DIR"/.pr-discovered-*; do
    [ -f "$pr_file" ] && rm -f "$pr_file"
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

# Detect stdbuf for line-buffered output on worker spawns
STDBUF_PREFIX=""
if command -v stdbuf >/dev/null 2>&1; then
  STDBUF_PREFIX="stdbuf -oL -eL"
  log "Using stdbuf for line-buffered worker output"
else
  log "WARNING: stdbuf not found — worker logs may be block-buffered and incomplete on kill"
fi

# Detect tmux for --tmux=classic support
TMUX_ENABLED=false
case "$TMUX_MODE" in
  on)
    if command -v tmux >/dev/null 2>&1; then
      TMUX_ENABLED=true
      log "Tmux mode: forced ON"
    else
      log "WARNING: tmux not found — tmux mode requested but not available, continuing without tmux"
    fi
    ;;
  off)
    log "Tmux mode: disabled"
    ;;
  auto)
    if command -v tmux >/dev/null 2>&1; then
      TMUX_ENABLED=true
      log "Tmux mode: auto-detected (tmux available)"
    else
      log "WARNING: tmux not found — continuing without tmux"
    fi
    ;;
  *)
    log "WARNING: unknown TMUX_MODE '$TMUX_MODE', defaulting to auto"
    if command -v tmux >/dev/null 2>&1; then
      TMUX_ENABLED=true
    fi
    ;;
esac

# Build tmux CLI flags (empty when disabled)
TMUX_FLAGS=""
if [ "$TMUX_ENABLED" = "true" ]; then
  TMUX_FLAGS="--tmux=classic"
fi

# Source rate limit helpers (detect_rate_limit, parse_reset_time, format_reset_display,
# record_failure, check_circuit_breaker)
# shellcheck source=scripts/lib/rate-limit-helpers.sh
source "scripts/lib/rate-limit-helpers.sh"

# conflict-resolver.sh already sourced during init (before cleanup_stale_conflict_worktrees)

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

  # Kill all other active workers — rate limit is account-wide
  kill_all_active_workers_for_rate_limit "$issue_number"
}

# --- Global rate limit halt ---------------------------------------------------
# When one worker detects a rate limit, kill ALL other active workers since the
# API limit is account-wide. Commits WIP, transitions labels, and cleans up.
# Arguments: $1=triggering_issue_number (skip this worker — already handled by caller)
kill_all_active_workers_for_rate_limit() {
  local triggering_issue="$1"

  [ -f "$PID_FILE" ] || return 0

  while IFS=: read -r w_pid w_issue w_start w_type; do
    [ -n "$w_pid" ] || continue
    [ -n "$w_issue" ] || continue

    # Skip the triggering issue's worker (already handled by caller)
    if [ "$w_issue" = "$triggering_issue" ]; then
      continue
    fi

    # Only kill live workers
    if ! kill -0 "$w_pid" 2>/dev/null; then
      continue
    fi

    log "Rate limit halt: killing worker PID $w_pid for issue #${w_issue} (type: ${w_type})"

    # Commit WIP before killing
    commit_wip_if_needed "$w_issue"

    # Kill the process group
    kill_process_group "$w_pid"

    # Clean up tmux session
    kill_worker_tmux_session "$w_issue"

    # Transition labels: claude-wip → claude-interrupted
    gh issue edit "$w_issue" --remove-label "$LABEL_WIP" --add-label "$LABEL_INTERRUPTED" 2>/dev/null || true
    gh issue comment "$w_issue" --body "Worker interrupted by account-wide API rate limit (triggered by issue #${triggering_issue}). Will auto-retry after cooldown." 2>/dev/null || true

    # Remove heartbeat and stale marker files
    rm -f "$LOG_DIR/heartbeat-${w_issue}" "$LOG_DIR/.stale-notified-${w_pid}"

    # Remove from PID file so slots are freed immediately after cooldown
    remove_worker "$w_pid"
  done < "$PID_FILE"
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

    if [ "$TMUX_ENABLED" = "true" ]; then
      # Wrap resume in a named tmux session for observability
      local tmux_session="worker-${issue_number}"
      tmux kill-session -t "$tmux_session" 2>/dev/null || true
      tmux new-session -d -s "$tmux_session" \
        "cd '$worktree_path' && $STDBUF_PREFIX claude -p '$resume_prompt' \
          --agent 'issue-worker' \
          --resume '$session_id' \
          --max-budget-usd '$MAX_BUDGET' \
          --allowedTools 'Agent,Bash,Edit,Glob,Grep,Read,Write,Skill' \
          2>&1 | tee -a '$log_file'"
      # Get the PID of the shell running inside tmux
      local claude_pid
      claude_pid=$(tmux list-panes -t "$tmux_session" -F '#{pane_pid}' 2>/dev/null | head -1)
    else
      (cd "$worktree_path" && perl -e 'use POSIX; POSIX::setsid(); exec @ARGV' \
        $STDBUF_PREFIX claude -p "$resume_prompt" \
        --agent "issue-worker" \
        --resume "$session_id" \
        --max-budget-usd "$MAX_BUDGET" \
        --allowedTools "Agent,Bash,Edit,Glob,Grep,Read,Write,Skill" \
        >> "$log_file" 2>&1) &
      local claude_pid=$!
    fi
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

    # shellcheck disable=SC2086
    (perl -e 'use POSIX; POSIX::setsid(); exec @ARGV' \
      $STDBUF_PREFIX claude -p "$prompt" \
      --agent "issue-worker" \
      --worktree \
      $TMUX_FLAGS \
      --session-id "$session_id" \
      --max-budget-usd "$MAX_BUDGET" \
      --allowedTools "Agent,Bash,Edit,Glob,Grep,Read,Write,Skill" \
      2>&1 | tee "$log_file") &
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

  # Verify a PR was actually created for this issue (regardless of exit code)
  local pr_url
  pr_url=$(gh pr list --search "Closes #${issue_number}" --json url -q '.[0].url' 2>/dev/null || echo "")
  if [ -z "$pr_url" ]; then
    # Also check for "closes #N" in PR body with issue number in branch name
    pr_url=$(gh pr list --search "${issue_number}" --json url,body -q ".[] | select(.body | test(\"#${issue_number}\")) | .url" 2>/dev/null | head -1 || echo "")
  fi

  # Fetch current labels and state to detect already-complete issues
  local issue_info
  issue_info=$(gh issue view "$issue_number" --json labels,state -q '{labels: [.labels[].name], state: .state}' 2>/dev/null || echo '{"labels":[],"state":""}')
  local current_labels
  current_labels=$(echo "$issue_info" | jq -r '.labels[]' 2>/dev/null || echo "")
  local issue_state
  issue_state=$(echo "$issue_info" | jq -r '.state' 2>/dev/null || echo "")

  if [ $exit_code -eq 0 ] && [ -n "$pr_url" ]; then
    log "Worker for issue #${issue_number} completed successfully (PR: ${pr_url})"
    gh issue edit "$issue_number" --remove-label "$LABEL_WIP" --add-label "$LABEL_DONE" 2>/dev/null || true
    clear_session_id "$issue_number"
  elif echo "$current_labels" | grep -q "$LABEL_DONE" || [ "$issue_state" = "CLOSED" ]; then
    # Worker already handled the issue (e.g., Step 1b: acceptance criteria already met)
    log "Worker for issue #${issue_number} completed — no PR needed (issue already marked done/closed)"
    gh issue edit "$issue_number" --remove-label "$LABEL_WIP" 2>/dev/null || true
    clear_session_id "$issue_number"
  elif detect_rate_limit "$exit_code" "$log_file"; then
    # Rate limit check after success path — prevents false positives on genuine successes
    # but catches rate limits that exit 0 (e.g., "You've hit your limit" graceful shutdown)
    commit_wip_if_needed "$issue_number"
    handle_rate_limit_exit "$issue_number" "$runtime" "Worker" "$log_file"
    kill_worker_tmux_session "$issue_number"
    clean_worktree "$issue_number"
    remove_worker "$self_pid"
    return
  else
    record_failure
    if [ $exit_code -eq 0 ] && [ -z "$pr_url" ]; then
      log "Worker for issue #${issue_number} exited cleanly but no PR was created (likely hit budget limit)"
    else
      log "Worker for issue #${issue_number} failed (exit code: $exit_code)"
    fi
    # Check if Claude already labeled it as blocked
    if ! echo "$current_labels" | grep -q "$LABEL_BLOCKED"; then
      gh issue edit "$issue_number" --remove-label "$LABEL_WIP" --add-label "$LABEL_BLOCKED" 2>/dev/null || true
      local fail_reason="exit code $exit_code"
      if [ $exit_code -eq 0 ] && [ -z "$pr_url" ]; then
        fail_reason="no PR created (possible budget limit). Add label '$LABEL_RESUME' to resume this session."
      fi
      gh issue comment "$issue_number" --body "Claude Code worker finished but did not complete: ${fail_reason}. Check logs at \`$log_file\` for details." 2>/dev/null || true
    fi
  fi

  kill_worker_tmux_session "$issue_number"
  clean_worktree "$issue_number"
  remove_worker "$self_pid"
}

# --- Plan executor function ---------------------------------------------------
run_plan_executor() {
  local issue_number="$1"
  local issue_title="$2"
  local log_file="$LOG_DIR/plan-${issue_number}.log"

  log "Starting plan-executor for issue #${issue_number}: ${issue_title}"

  # Idempotency guard: if plan already has claude-active, it was already executed
  local current_labels
  current_labels=$(gh issue view "$issue_number" --json labels -q '.labels[].name' 2>/dev/null)
  if echo "$current_labels" | grep -q "$LABEL_ACTIVE"; then
    log "Plan #${issue_number} already has '$LABEL_ACTIVE' label — skipping (already executed)"
    gh issue edit "$issue_number" --remove-label "$LABEL_WIP" 2>/dev/null || true
    return
  fi

  # Label as in-progress
  gh issue edit "$issue_number" --remove-label "$LABEL_APPROVED" --add-label "$LABEL_WIP" 2>/dev/null || true

  # Record start time
  local start_time
  start_time=$(date +%s)

  # Run Claude in background so heartbeat can run concurrently
  # shellcheck disable=SC2086
  (perl -e 'use POSIX; POSIX::setsid(); exec @ARGV' \
    $STDBUF_PREFIX claude -p "$(cat <<EOF
You are the plan-executor agent. Process approved plan issue #${issue_number}.

Read the full issue with: gh issue view ${issue_number} --json title,body,labels

Follow your agent instructions exactly — parse the plan items, create work issues
with correct labels and dependencies, post a summary, and close out the plan issue.

If parsing fails, comment on the issue and add the label "claude-blocked".
EOF
)" \
    --agent "plan-executor" \
    --worktree \
    $TMUX_FLAGS \
    --max-budget-usd "$MAX_BUDGET" \
    --allowedTools "Bash,Glob,Grep,Read" \
    2>&1 | tee "$log_file") &
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

  if [ $exit_code -eq 0 ]; then
    log "Plan-executor for issue #${issue_number} completed successfully"
    # plan-executor handles its own label transitions (approved -> done)
    # but ensure WIP is removed if still present
    gh issue edit "$issue_number" --remove-label "$LABEL_WIP" 2>/dev/null || true
  elif detect_rate_limit "$exit_code" "$log_file"; then
    # Rate limit check after success path — prevents false positives on genuine successes
    handle_rate_limit_exit "$issue_number" "$runtime" "Plan-executor" "$log_file"
    kill_worker_tmux_session "$issue_number"
    clean_worktree "$issue_number"
    remove_worker "$self_pid"
    return
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

  kill_worker_tmux_session "$issue_number"
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
  # shellcheck disable=SC2086
  (perl -e 'use POSIX; POSIX::setsid(); exec @ARGV' \
    $STDBUF_PREFIX claude -p "$(cat <<EOF
You are the bug-investigator agent. Investigate bug issue #${issue_number}.

Read the full issue with: gh issue view ${issue_number} --json title,body,labels

Follow your agent instructions exactly — read the bug issue, investigate the codebase
to find the root cause, and create a plan issue for fixing it.

If you get stuck, comment on the issue and add the label "claude-blocked".
EOF
)" \
    --agent "bug-investigator" \
    --worktree \
    $TMUX_FLAGS \
    --max-budget-usd "$MAX_BUDGET" \
    --allowedTools "Bash,Glob,Grep,Read" \
    2>&1 | tee "$log_file") &
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

  if [ $exit_code -eq 0 ]; then
    log "Bug-investigator for issue #${issue_number} completed successfully"
    # bug-investigator handles its own label transitions (bug-investigate -> bug-planned)
    # but ensure WIP is removed if still present
    gh issue edit "$issue_number" --remove-label "$LABEL_WIP" 2>/dev/null || true
  elif detect_rate_limit "$exit_code" "$log_file"; then
    # Rate limit check after success path — prevents false positives on genuine successes
    handle_rate_limit_exit "$issue_number" "$runtime" "Bug-investigator" "$log_file"
    kill_worker_tmux_session "$issue_number"
    remove_worker "$self_pid"
    return
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

  kill_worker_tmux_session "$issue_number"
  remove_worker "$self_pid"
}

# --- Plan writer function -----------------------------------------------------
run_plan_writer() {
  local issue_number="$1"
  local issue_title="$2"
  local log_file="$LOG_DIR/plan-writer-${issue_number}.log"

  log "Starting plan-writer for issue #${issue_number}: ${issue_title}"

  # Label as in-progress
  gh issue edit "$issue_number" --add-label "$LABEL_WIP" 2>/dev/null || true

  # Record start time
  local start_time
  start_time=$(date +%s)

  # Run Claude in background so heartbeat can run concurrently
  # shellcheck disable=SC2086
  (perl -e 'use POSIX; POSIX::setsid(); exec @ARGV' \
    $STDBUF_PREFIX claude -p "$(cat <<EOF
You are the plan-writer agent. Write a full plan for stub plan issue #${issue_number}.

Read the full issue with: gh issue view ${issue_number} --json title,body,labels

Follow your agent instructions exactly — research the codebase, write a structured plan
with PLAN_ITEMS markers, and update the issue.

If you get stuck, comment on the issue and add the label "claude-blocked".
EOF
)" \
    --agent "plan-writer" \
    --worktree \
    $TMUX_FLAGS \
    --max-budget-usd "$MAX_BUDGET" \
    --allowedTools "Bash,Glob,Grep,Read" \
    2>&1 | tee "$log_file") &
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

  if [ $exit_code -eq 0 ]; then
    log "Plan-writer for issue #${issue_number} completed successfully"
    # plan-writer adds needs-human-review itself; just remove WIP
    gh issue edit "$issue_number" --remove-label "$LABEL_WIP" 2>/dev/null || true
  elif detect_rate_limit "$exit_code" "$log_file"; then
    # Rate limit check after success path — prevents false positives on genuine successes
    handle_rate_limit_exit "$issue_number" "$runtime" "Plan-writer" "$log_file"
    kill_worker_tmux_session "$issue_number"
    remove_worker "$self_pid"
    return
  else
    record_failure
    log "Plan-writer for issue #${issue_number} failed (exit code: $exit_code)"
    local labels
    labels=$(gh issue view "$issue_number" --json labels -q '.labels[].name' 2>/dev/null)
    if ! echo "$labels" | grep -q "$LABEL_BLOCKED"; then
      gh issue edit "$issue_number" --remove-label "$LABEL_WIP" --add-label "$LABEL_BLOCKED" 2>/dev/null || true
      gh issue comment "$issue_number" --body "Plan-writer exited with code $exit_code. Check logs at \`$log_file\` for details." 2>/dev/null || true
    fi
  fi

  kill_worker_tmux_session "$issue_number"
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
log "Started (workers=$MAX_WORKERS, poll=${POLL_INTERVAL}s, budget=\$${MAX_BUDGET}, timeout=${WALL_TIMEOUT}m, tmux=$TMUX_ENABLED)"
log "Watching for issues labeled '${LABEL_RESUME}', '${LABEL_INTERRUPTED}', '${LABEL_APPROVED}', '${LABEL_PLAN}', '${LABEL_BUG_INVESTIGATE}', and '${LABEL_READY}'..."
log "PID file: ${DAEMON_PID_FILE} (send SIGUSR1 to toggle drain mode)"

RECONCILE_INTERVAL=5  # reconcile every N poll cycles (~5 min at 60s interval)
cycle_count=0

while true; do
  # Reset per-cycle spawn deduplication set
  spawned_this_cycle=""
  cycle_count=$((cycle_count + 1))

  # --- 0. Periodic reconciliation (every RECONCILE_INTERVAL cycles) ---
  # Catches issues stuck in claude-wip with no active worker during long daemon runs.
  if [ $((cycle_count % RECONCILE_INTERVAL)) -eq 0 ]; then
    reconcile_orphaned_wip_issues
  fi

  # --- 1. Drain mode check ---
  if is_drain_mode; then
    active=$(active_worker_count)
    if [ "$active" -eq 0 ]; then
      clear_drain_mode
      kill_all_worker_tmux_sessions
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

    # Dead worker — clean up orphaned state and transition labels
    if ! kill -0 "$w_pid" 2>/dev/null; then
      log "Worker PID $w_pid for issue #${w_issue} is dead — cleaning up orphaned state"
      commit_wip_if_needed "$w_issue"
      kill_worker_tmux_session "$w_issue"

      # Check if issue still has claude-wip label before transitioning
      # Note: TOCTOU race between view and edit is inherent to GitHub API (no atomic
      # compare-and-swap for labels). The window is narrow since the daemon is single-threaded.
      dead_labels=$(gh issue view "$w_issue" --json labels -q '.labels[].name' 2>/dev/null || true)
      if [ -z "$dead_labels" ]; then
        # gh issue view failed (rate limit, network error) — log warning but still proceed
        # with cleanup. The label may stay as claude-wip, but the startup reconciliation
        # loop will catch it on next daemon restart.
        log "WARNING: Could not fetch labels for issue #${w_issue} — label transition skipped"
      elif echo "$dead_labels" | grep -q "$LABEL_WIP"; then
        if [ "$w_type" = "worker" ]; then
          # Workers are idempotent — transition to interrupted for auto-retry
          gh issue edit "$w_issue" --remove-label "$LABEL_WIP" --add-label "$LABEL_INTERRUPTED" 2>/dev/null || true
          gh issue comment "$w_issue" --body "Worker process died unexpectedly (PID $w_pid no longer running). Transitioning to \`$LABEL_INTERRUPTED\` for auto-retry." 2>/dev/null || true
        else
          # Non-workers (plan, plan-writer, bug-investigate) are not idempotent — block for manual review
          gh issue edit "$w_issue" --remove-label "$LABEL_WIP" --add-label "$LABEL_BLOCKED" 2>/dev/null || true
          gh issue comment "$w_issue" --body "Worker process died unexpectedly (PID $w_pid, type: $w_type). Transitioning to \`$LABEL_BLOCKED\` — manual review required since $w_type tasks are not idempotent." 2>/dev/null || true
        fi
      fi

      rm -f "$LOG_DIR/heartbeat-${w_issue}" "$LOG_DIR/.stale-notified-${w_pid}" "$LOG_DIR/.pr-check-${w_issue}" "$LOG_DIR/.pr-discovered-${w_issue}"
      remove_worker "$w_pid"
      continue
    fi

    # Wall-clock timeout check (runs before stale check)
    elapsed=$(( now_epoch - w_start ))
    if [ "$elapsed" -ge "$wall_timeout_secs" ]; then
      elapsed_min=$(( elapsed / 60 ))
      log "Worker PID $w_pid for issue #${w_issue} exceeded wall-clock timeout (${elapsed_min}m > ${WALL_TIMEOUT}m)"
      commit_wip_if_needed "$w_issue"
      kill_process_group "$w_pid"
      kill_worker_tmux_session "$w_issue"
      gh issue edit "$w_issue" --remove-label "$LABEL_WIP" --add-label "$LABEL_BLOCKED" 2>/dev/null || true
      gh issue comment "$w_issue" --body "Worker timed out after ${elapsed_min} minutes (wall-clock limit: ${WALL_TIMEOUT}m). Check logs at \`$LOG_DIR/issue-${w_issue}.log\`." 2>/dev/null || true
      rm -f "$LOG_DIR/heartbeat-${w_issue}" "$LOG_DIR/.stale-notified-${w_pid}" "$LOG_DIR/.pr-check-${w_issue}" "$LOG_DIR/.pr-discovered-${w_issue}"
      remove_worker "$w_pid"
      continue
    fi

    # Completion detection: check if a PR already exists for workers running >5 min
    if [ "$w_type" = "worker" ] && [ "$elapsed" -ge 300 ]; then
      pr_check_file="$LOG_DIR/.pr-check-${w_issue}"
      do_pr_check=false
      if [ ! -f "$pr_check_file" ]; then
        do_pr_check=true
      else
        last_pr_check=$(cat "$pr_check_file" 2>/dev/null || echo "0")
        pr_check_age=$(( now_epoch - last_pr_check ))
        if [ "$pr_check_age" -ge 300 ]; then
          do_pr_check=true
        fi
      fi
      if [ "$do_pr_check" = "true" ]; then
        echo "$now_epoch" > "$pr_check_file"
        existing_pr=$(gh pr list --search "Closes #${w_issue}" --state all --json url -q '.[0].url' 2>/dev/null || echo "")
        if [ -n "$existing_pr" ]; then
          # PR exists — check if discovery marker exists
          pr_discovery_file="$LOG_DIR/.pr-discovered-${w_issue}"
          if [ ! -f "$pr_discovery_file" ]; then
            # First discovery — record the epoch
            echo "$now_epoch" > "$pr_discovery_file"
            log "PR discovered for issue #${w_issue}: $existing_pr (will force-kill in 5 min if still running)"
          else
            discovery_epoch=$(cat "$pr_discovery_file" 2>/dev/null || echo "$now_epoch")
            since_discovery=$(( now_epoch - discovery_epoch ))
            if [ "$since_discovery" -ge 300 ]; then
              log "Worker PID $w_pid for issue #${w_issue} still running >5 min after PR discovered — force-killing"
              kill_process_group "$w_pid"
              kill_worker_tmux_session "$w_issue"
              gh issue edit "$w_issue" --remove-label "$LABEL_WIP" --add-label "$LABEL_DONE" 2>/dev/null || true
              rm -f "$LOG_DIR/heartbeat-${w_issue}" "$LOG_DIR/.stale-notified-${w_pid}" "$pr_check_file" "$pr_discovery_file"
              remove_worker "$w_pid"
              continue
            fi
          fi
        fi
      fi
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
        elif [ "$w_type" = "plan-writer" ]; then
          stale_log_file="$LOG_DIR/plan-writer-${w_issue}.log"
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

  # --- Lightweight CI failure check (replaces ci-health-monitor.sh) ---
  # Query open daemon PRs with failing CI. If a PR has had failing checks for >30 min,
  # file a bug-report issue for the issue-worker to fix. Runs inline, no worker slot.
  ci_fail_prs=$(gh pr list --state open --json number,headRefName,statusCheckRollup,updatedAt \
    -q '[.[] | select(.headRefName | startswith("issue-")) | select(.statusCheckRollup != null) | select([.statusCheckRollup[] | select(.conclusion == "FAILURE")] | length > 0)] | .[] | @json' 2>/dev/null || echo "")
  if [ -n "$ci_fail_prs" ]; then
    while IFS= read -r pr_json; do
      ci_pr_num=$(echo "$pr_json" | jq -r '.number')
      ci_pr_updated=$(echo "$pr_json" | jq -r '.updatedAt')
      # Check if updated >30 min ago (stale failure, not a just-pushed PR)
      # Strip fractional seconds (.123Z -> Z) for macOS date compatibility
      ci_pr_updated_clean=$(echo "$ci_pr_updated" | sed 's/\.[0-9]*Z$/Z/')
      ci_updated_epoch=$(date -jf "%Y-%m-%dT%H:%M:%SZ" "$ci_pr_updated_clean" +%s 2>/dev/null || date -d "$ci_pr_updated" +%s 2>/dev/null || echo "0")
      ci_age=$(( now_epoch - ci_updated_epoch ))
      if [ "$ci_age" -ge 1800 ]; then
        # Check if we already filed an issue for this PR's CI failure
        ci_marker="$LOG_DIR/.ci-fail-filed-${ci_pr_num}"
        if [ ! -f "$ci_marker" ]; then
          log "PR #${ci_pr_num} has failing CI for >30 min — filing bug-report for issue-worker"
          ci_issue_url=$(gh issue create \
            --title "CI failure on PR #${ci_pr_num}" \
            --label "bug-report,claude-ready" \
            --body "PR #${ci_pr_num} has failing CI checks for >30 minutes. Investigate and fix the CI failure. PR URL: $(gh pr view "$ci_pr_num" --json url -q '.url' 2>/dev/null || echo "unknown")" \
            2>/dev/null || echo "")
          if [ -n "$ci_issue_url" ]; then
            echo "$now_epoch" > "$ci_marker"
            log "Filed CI failure issue: $ci_issue_url"
          fi
        fi
      fi
    done <<< "$ci_fail_prs"
  fi
  # Clean up stale CI failure markers for PRs that are no longer open or no longer failing
  for ci_marker_file in "$LOG_DIR"/.ci-fail-filed-*; do
    [ -f "$ci_marker_file" ] || continue
    marker_pr="${ci_marker_file##*.ci-fail-filed-}"
    # Remove marker if >24h old (allows re-filing for regressions)
    marker_epoch=$(cat "$ci_marker_file" 2>/dev/null || echo "0")
    if [ $(( now_epoch - marker_epoch )) -ge 86400 ]; then
      rm -f "$ci_marker_file"
    fi
  done

  active=$(active_worker_count)
  available_slots=$(( MAX_WORKERS - active ))

  if [ "$available_slots" -gt 0 ]; then
    # --- Priority 0: Resume manually-triggered issues (claude-resume label) ---
    resume_issues=$(gh issue list \
      --state open \
      --label "$LABEL_RESUME" \
      --limit "$available_slots" \
      --json number,title \
      -q 'sort_by(.number) | .[] | @json' 2>/dev/null || echo "")

    if [ -n "$resume_issues" ]; then
      while IFS= read -r issue_json; do
        number=$(echo "$issue_json" | jq -r '.number')
        title=$(echo "$issue_json" | jq -r '.title')

        wip_check=$(gh issue view "$number" --json labels -q '.labels[].name' 2>/dev/null | grep -c "$LABEL_WIP" || true)
        if [ "$wip_check" -gt 0 ]; then
          log "Skipping resume issue #${number} (already WIP)"
          continue
        fi

        if echo "$spawned_this_cycle" | grep -qw "$number"; then
          log "Skipping issue #${number} (already spawned this cycle)"
          continue
        fi

        run_worker "$number" "$title" "false" "true" &
        record_worker "$!" "$number" "worker"
        spawned_this_cycle="$spawned_this_cycle $number"
        log "Spawned resume worker PID $! for issue #${number}"
      done <<< "$resume_issues"

      # Recalculate available slots
      active=$(active_worker_count)
      available_slots=$(( MAX_WORKERS - active ))
    fi

    # --- Priority 0.5: Retry interrupted issues (auto rate-limit retries) ---
    # Re-check rate limit pause (may have been set by kill_all_active_workers_for_rate_limit mid-cycle)
    if is_rate_limit_paused; then available_slots=0; fi
    if [ "$available_slots" -gt 0 ]; then
    interrupted_issues=$(gh issue list \
      --state open \
      --label "$LABEL_INTERRUPTED" \
      --limit "$available_slots" \
      --json number,title \
      -q 'sort_by(.number) | .[] | @json' 2>/dev/null || echo "")

    if [ -n "$interrupted_issues" ]; then
      while IFS= read -r issue_json; do
        number=$(echo "$issue_json" | jq -r '.number')
        title=$(echo "$issue_json" | jq -r '.title')

        wip_check=$(gh issue view "$number" --json labels -q '.labels[].name' 2>/dev/null | grep -c "$LABEL_WIP" || true)
        if [ "$wip_check" -gt 0 ]; then
          log "Skipping interrupted issue #${number} (already WIP)"
          continue
        fi

        if echo "$spawned_this_cycle" | grep -qw "$number"; then
          log "Skipping issue #${number} (already spawned this cycle)"
          continue
        fi

        run_worker "$number" "$title" "true" "false" &
        record_worker "$!" "$number" "worker"
        spawned_this_cycle="$spawned_this_cycle $number"
        log "Spawned retry worker PID $! for interrupted issue #${number}"
      done <<< "$interrupted_issues"

      # Recalculate available slots
      active=$(active_worker_count)
      available_slots=$(( MAX_WORKERS - active ))
    fi
    fi

    # --- Priority 1: Approved plans (create work issues quickly) ---
    if is_rate_limit_paused; then available_slots=0; fi
    if [ "$available_slots" -gt 0 ]; then
      approved_issues=$(gh issue list \
        --state open \
        --label "$LABEL_APPROVED" \
        --limit "$available_slots" \
        --json number,title,body \
        -q 'sort_by(.number) | .[] | @json' 2>/dev/null || echo "")

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

          if echo "$spawned_this_cycle" | grep -qw "$number"; then
            log "Skipping issue #${number} (already spawned this cycle)"
            continue
          fi

          # Check if this is a plan (has plan markers) or a single work item
          if echo "$body" | grep -q "PLAN_ITEMS_START"; then
            run_plan_executor "$number" "$title" &
            record_worker "$!" "$number" "plan"
            spawned_this_cycle="$spawned_this_cycle $number"
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

    # --- Priority 1.25: Stub plan issues (plan-writer) ---
    if is_rate_limit_paused; then available_slots=0; fi
    if [ "$available_slots" -gt 0 ]; then
      # Find issues labeled "plan" that are not already in progress or completed
      plan_issues=$(gh issue list \
        --state open \
        --label "$LABEL_PLAN" \
        --limit "$available_slots" \
        --json number,title,labels \
        -q 'sort_by(.number) | .[] | @json' 2>/dev/null || echo "")

      if [ -n "$plan_issues" ]; then
        while IFS= read -r issue_json; do
          number=$(echo "$issue_json" | jq -r '.number')
          title=$(echo "$issue_json" | jq -r '.title')

          # Filter out issues with exclusion labels
          issue_labels=$(echo "$issue_json" | jq -r '.labels[].name' 2>/dev/null)
          skip=false
          for exclude_label in "$LABEL_NEEDS_HUMAN_REVIEW" "$LABEL_WIP" "$LABEL_APPROVED" "$LABEL_BLOCKED" "$LABEL_DONE" "$LABEL_ACTIVE"; do
            if echo "$issue_labels" | grep -qx "$exclude_label"; then
              skip=true
              break
            fi
          done
          if [ "$skip" = "true" ]; then
            log "Skipping plan issue #${number} (has exclusion label)"
            continue
          fi

          if echo "$spawned_this_cycle" | grep -qw "$number"; then
            log "Skipping issue #${number} (already spawned this cycle)"
            continue
          fi

          run_plan_writer "$number" "$title" &
          record_worker "$!" "$number" "plan-writer"
          spawned_this_cycle="$spawned_this_cycle $number"
          log "Spawned plan-writer PID $! for issue #${number}"
        done <<< "$plan_issues"

        # Recalculate available slots
        active=$(active_worker_count)
        available_slots=$(( MAX_WORKERS - active ))
      fi
    fi

    # --- Priority 1.5: Bug investigation issues ---
    if is_rate_limit_paused; then available_slots=0; fi
    if [ "$available_slots" -gt 0 ]; then
      bug_issues=$(gh issue list \
        --state open \
        --label "$LABEL_BUG_INVESTIGATE" \
        --limit "$available_slots" \
        --json number,title \
        -q 'sort_by(.number) | .[] | @json' 2>/dev/null || echo "")

      if [ -n "$bug_issues" ]; then
        while IFS= read -r issue_json; do
          number=$(echo "$issue_json" | jq -r '.number')
          title=$(echo "$issue_json" | jq -r '.title')

          wip_check=$(gh issue view "$number" --json labels -q '.labels[].name' 2>/dev/null | grep -c "$LABEL_WIP" || true)
          if [ "$wip_check" -gt 0 ]; then
            log "Skipping bug issue #${number} (already WIP)"
            continue
          fi

          if echo "$spawned_this_cycle" | grep -qw "$number"; then
            log "Skipping issue #${number} (already spawned this cycle)"
            continue
          fi

          run_bug_investigator "$number" "$title" &
          record_worker "$!" "$number" "bug-investigate"
          spawned_this_cycle="$spawned_this_cycle $number"
          log "Spawned bug-investigator PID $! for issue #${number}"
        done <<< "$bug_issues"

        # Recalculate available slots
        active=$(active_worker_count)
        available_slots=$(( MAX_WORKERS - active ))
      fi
    fi

    # --- Priority 2: Ready work issues ---
    if is_rate_limit_paused; then available_slots=0; fi
    if [ "$available_slots" -gt 0 ]; then
      issues=$(gh issue list \
        --state open \
        --label "$LABEL_READY" \
        --limit "$available_slots" \
        --json number,title \
        -q 'sort_by(.number) | .[] | @json' 2>/dev/null || echo "")

      if [ -n "$issues" ]; then
        while IFS= read -r issue_json; do
          number=$(echo "$issue_json" | jq -r '.number')
          title=$(echo "$issue_json" | jq -r '.title')

          wip_check=$(gh issue view "$number" --json labels -q '.labels[].name' 2>/dev/null | grep -c "$LABEL_WIP" || true)
          if [ "$wip_check" -gt 0 ]; then
            log "Skipping issue #${number} (already WIP)"
            continue
          fi

          if echo "$spawned_this_cycle" | grep -qw "$number"; then
            log "Skipping issue #${number} (already spawned this cycle)"
            continue
          fi

          run_worker "$number" "$title" &
          record_worker "$!" "$number" "worker"
          spawned_this_cycle="$spawned_this_cycle $number"
          log "Spawned worker PID $! for issue #${number}"
        done <<< "$issues"
      fi
    fi

    # --- Priority 3: Conflict resolution (lowest priority, inline, no worker slot) ---
    # Detect daemon PRs with merge conflicts. Attempt clean rebase or mechanical
    # lockfile resolution. Non-mechanical conflicts → label needs-manual-rebase.
    # Processes at most 1 PR per poll cycle.
    conflict_pr=""
    conflict_branch=""
    conflict_base=""

    # First: check newly detected conflicting PRs
    conflicting_json=$(detect_conflicting_prs 2>/dev/null || echo "[]")
    select_conflict_candidate "$conflicting_json" || true

    # Second: check needs-manual-rebase PRs eligible for retry (base branch advanced)
    if [ -z "$conflict_pr" ]; then
      rebase_prs=$(gh pr list --state open --label "$LABEL_NEEDS_REBASE" \
        --json number,headRefName,baseRefName \
        -q '.[] | @json' 2>/dev/null || echo "")
      if [ -n "$rebase_prs" ]; then
        while IFS= read -r pr_json; do
          pr_num=$(echo "$pr_json" | jq -r '.number')
          pr_branch=$(echo "$pr_json" | jq -r '.headRefName')
          pr_base=$(echo "$pr_json" | jq -r '.baseRefName')
          [ -n "$pr_base" ] && [ "$pr_base" != "null" ] || pr_base="main"
          _validate_pr_number "$pr_num" 2>/dev/null || continue
          _validate_branch_name "$pr_branch" 2>/dev/null || continue
          _validate_branch_name "$pr_base" 2>/dev/null || continue
          if should_retry "$pr_num" "$pr_base"; then
            conflict_pr="$pr_num"
            conflict_branch="$pr_branch"
            conflict_base="$pr_base"
            break
          fi
        done <<< "$rebase_prs"
      fi
    fi

    # Process the selected conflict PR (at most 1 per cycle)
    if [ -n "$conflict_pr" ] && [ -n "$conflict_branch" ]; then
      log "Processing conflict PR #${conflict_pr} (branch: ${conflict_branch}, base: ${conflict_base})"
      ensure_conflict_state_dir
      worktree_path="${REPO_ROOT}/.claude/worktrees/conflict-pr-${conflict_pr}"

      rebase_result=0
      attempt_clean_rebase "$conflict_pr" "$conflict_branch" "$conflict_base" || rebase_result=$?

      if [ "$rebase_result" -eq 0 ]; then
        # Clean rebase succeeded — push (CI runs automatically on push)
        if push_rebased_branch "$conflict_pr"; then
          handle_resolution_success "$conflict_pr" "$conflict_base" "$worktree_path"
          log "Conflict resolved for PR #${conflict_pr} — rebased and pushed"
        else
          handle_resolution_failure "$conflict_pr" "Push --force-with-lease failed" "$conflict_base"
        fi
        cleanup_conflict_worktree "$conflict_pr"

      elif [ "$rebase_result" -eq 1 ]; then
        # Conflicts — try mechanical lockfile resolution
        mechanical_result=0
        handle_mechanical_conflicts "$conflict_pr" "$conflict_base" || mechanical_result=$?

        if [ "$mechanical_result" -eq 0 ]; then
          if push_rebased_branch "$conflict_pr"; then
            handle_resolution_success "$conflict_pr" "$conflict_base" "$worktree_path"
            log "Mechanical conflict resolved for PR #${conflict_pr}"
          else
            handle_resolution_failure "$conflict_pr" "Push --force-with-lease failed after lockfile resolution" "$conflict_base"
          fi
        else
          # Non-mechanical conflicts — label for manual rebase (no agent spawn)
          handle_resolution_failure "$conflict_pr" "Non-mechanical conflicts require manual resolution" "$conflict_base"
        fi
        cleanup_conflict_worktree "$conflict_pr"

      else
        # rebase_result == 2 — unexpected error
        handle_resolution_failure "$conflict_pr" "Unexpected error during rebase" "$conflict_base"
        cleanup_conflict_worktree "$conflict_pr"
      fi
    fi
  else
    log "All $MAX_WORKERS worker slots occupied, waiting..."
  fi

  sleep "$POLL_INTERVAL"
done
