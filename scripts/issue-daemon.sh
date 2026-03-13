#!/usr/bin/env bash
# issue-daemon.sh — Polls GitHub Issues labeled "claude-ready" and spawns
# Claude Code instances in isolated worktrees to implement them.
#
# Usage:
#   ./scripts/issue-daemon.sh                  # defaults: 1 worker, 60s poll, $10 budget
#   ./scripts/issue-daemon.sh -w 3 -i 30 -b 15 # 3 parallel workers, 30s poll, $15 budget
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
MAX_BUDGET=10          # max USD per issue
MAX_TURNS=200          # max agentic turns per issue (TDD + review agents need many turns)
LABEL_READY="claude-ready"
LABEL_WIP="claude-wip"
LABEL_DONE="claude-done"
LABEL_ACTIVE="claude-active"
LABEL_BLOCKED="claude-blocked"
LABEL_INTERRUPTED="claude-interrupted"
LABEL_PLAN_REVIEW="claude-plan-review"
LABEL_APPROVED="claude-approved"
LOG_DIR="./logs/issue-daemon"
RATE_LIMIT_PAUSE_SECONDS=900

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

# Source the shared state library
# shellcheck source=scripts/lib/daemon-state.sh
source "scripts/lib/daemon-state.sh"
ensure_state_dir

# Clear stale drain mode from a previous run (drain is runtime-only)
if is_drain_mode; then
  clear_drain_mode
fi

PID_FILE="$LOG_DIR/.active_pids"
: > "$PID_FILE"  # truncate on start

DAEMON_PID_FILE="$LOG_DIR/.issue-daemon.pid"
echo $$ > "$DAEMON_PID_FILE"

cleanup() {
  echo "[daemon] Shutting down..."
  while IFS= read -r pid; do
    if kill -0 "$pid" 2>/dev/null; then
      echo "[daemon] Stopping worker PID $pid"
      kill "$pid" 2>/dev/null || true
    fi
  done < "$PID_FILE"
  rm -f "$PID_FILE" "$DAEMON_PID_FILE"
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

# --- Rate limit detection -----------------------------------------------------
# Returns 0 if rate limited, 1 if not.
# Arguments: $1=exit_code, $2=log_file
detect_rate_limit() {
  local exit_code="$1"
  local log_file="$2"

  # Successful exit is not a rate limit
  if [ "$exit_code" -eq 0 ]; then
    return 1
  fi

  # Check log file for rate limit indicators
  if grep -qiE 'rate.?limit|HTTP.?429|status.?429|quota|budget.*exceeded|overloaded' "$log_file" 2>/dev/null; then
    return 0
  fi

  return 1
}

# --- Rate limit exit handler --------------------------------------------------
# Shared handler for when a worker/executor hits a rate limit.
# Arguments: $1=issue_number, $2=runtime, $3=worker_type ("Worker"|"Plan-executor")
handle_rate_limit_exit() {
  local issue_number="$1"
  local runtime="$2"
  local worker_type="$3"

  log "${worker_type} for issue #${issue_number} hit rate limit (runtime: ${runtime}s)"
  set_rate_limit_pause "$RATE_LIMIT_PAUSE_SECONDS"
  gh issue edit "$issue_number" --remove-label "$LABEL_WIP" --add-label "$LABEL_INTERRUPTED" 2>/dev/null || true
  gh issue comment "$issue_number" --body "${worker_type} interrupted by API rate limit (runtime: ${runtime}s). Will auto-retry after cooldown (~$((RATE_LIMIT_PAUSE_SECONDS / 60)) minutes)." 2>/dev/null || true
}

# --- WIP commit ---------------------------------------------------------------
# Commit and push any uncommitted work in a worktree for the given issue.
# Arguments: $1=issue_number
commit_wip_if_needed() {
  local issue_number="$1"

  # Scan worktrees for a branch matching issue-{N}-*
  for wt in .claude/worktrees/*/; do
    [ -d "$wt" ] || continue

    local branch
    branch=$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

    if [[ "$branch" == issue-${issue_number}-* ]]; then
      # Check for uncommitted changes (only tracked files to avoid committing secrets)
      if [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
        log "Committing WIP changes in worktree for issue #${issue_number}"
        git -C "$wt" add -u 2>/dev/null || true
        git -C "$wt" commit -m "WIP: interrupted by rate limit (issue #${issue_number})" 2>/dev/null || true
      fi

      # Push any unpushed commits
      git -C "$wt" push -u origin "$branch" 2>/dev/null || true
      return
    fi
  done
}

# --- Worker function ----------------------------------------------------------
run_worker() {
  local issue_number="$1"
  local issue_title="$2"
  local is_retry="${3:-false}"
  local log_file="$LOG_DIR/issue-${issue_number}.log"

  log "Starting worker for issue #${issue_number}: ${issue_title}"

  if [ "$is_retry" = "true" ]; then
    # Remove interrupted label for retry
    gh issue edit "$issue_number" --remove-label "$LABEL_INTERRUPTED" --add-label "$LABEL_WIP" 2>/dev/null || true
  else
    # Label as in-progress
    gh issue edit "$issue_number" --remove-label "$LABEL_READY" --add-label "$LABEL_WIP" 2>/dev/null || true
  fi

  # Build the prompt (with retry context if applicable)
  local retry_prefix=""
  if [ "$is_retry" = "true" ]; then
    retry_prefix="RETRY: Retrying interrupted issue #${issue_number}.

This issue was previously interrupted by an API rate limit. Check for an existing WIP branch:
  git branch -r --list \"origin/issue-${issue_number}-*\"
If a WIP branch exists, check it out and continue from where the previous attempt left off.

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

  # Record start time
  local start_time
  start_time=$(date +%s)

  # Run Claude in an isolated worktree (--worktree ensures --max-turns applies to the session)
  claude -p "$prompt" \
    --agent "issue-worker" \
    --worktree \
    --max-turns "$MAX_TURNS" \
    --max-budget-usd "$MAX_BUDGET" \
    --allowedTools "Agent,Bash,Edit,Glob,Grep,Read,Write,Skill" \
    > "$log_file" 2>&1

  local exit_code=$?
  local end_time
  end_time=$(date +%s)
  local runtime=$(( end_time - start_time ))

  # Check for rate limit first
  if detect_rate_limit "$exit_code" "$log_file"; then
    commit_wip_if_needed "$issue_number"
    handle_rate_limit_exit "$issue_number" "$runtime" "Worker"
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
  else
    if [ $exit_code -eq 0 ] && [ -z "$pr_url" ]; then
      log "Worker for issue #${issue_number} exited cleanly but no PR was created (likely hit max turns)"
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
        fail_reason="no PR created (possible max turns or budget limit)"
      fi
      gh issue comment "$issue_number" --body "Claude Code worker finished but did not complete: ${fail_reason}. Check logs at \`$log_file\` for details." 2>/dev/null || true
    fi
  fi
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

  # Run Claude with plan-executor agent (read-only, no worktree needed)
  claude -p "$(cat <<EOF
You are the plan-executor agent. Process approved plan issue #${issue_number}.

Read the full issue with: gh issue view ${issue_number} --json title,body,labels

Follow your agent instructions exactly — parse the plan items, create work issues
with correct labels and dependencies, post a summary, and close out the plan issue.

If parsing fails, comment on the issue and add the label "claude-blocked".
EOF
)" \
    --agent "plan-executor" \
    --max-turns "$MAX_TURNS" \
    --max-budget-usd "$MAX_BUDGET" \
    --allowedTools "Bash,Glob,Grep,Read" \
    > "$log_file" 2>&1

  local exit_code=$?
  local end_time
  end_time=$(date +%s)
  local runtime=$(( end_time - start_time ))

  # Check for rate limit first
  if detect_rate_limit "$exit_code" "$log_file"; then
    handle_rate_limit_exit "$issue_number" "$runtime" "Plan-executor"
    return
  fi

  if [ $exit_code -eq 0 ]; then
    log "Plan-executor for issue #${issue_number} completed successfully"
    # plan-executor handles its own label transitions (approved -> done)
    # but ensure WIP is removed if still present
    gh issue edit "$issue_number" --remove-label "$LABEL_WIP" 2>/dev/null || true
  else
    log "Plan-executor for issue #${issue_number} failed (exit code: $exit_code)"
    local labels
    labels=$(gh issue view "$issue_number" --json labels -q '.labels[].name' 2>/dev/null)
    if ! echo "$labels" | grep -q "$LABEL_BLOCKED"; then
      gh issue edit "$issue_number" --remove-label "$LABEL_WIP" --add-label "$LABEL_BLOCKED" 2>/dev/null || true
      gh issue comment "$issue_number" --body "Plan-executor exited with code $exit_code. Check logs at \`$log_file\` for details." 2>/dev/null || true
    fi
  fi
}

# --- Worker tracking via PID file ---------------------------------------------
active_worker_count() {
  local count=0
  local tmp
  tmp=$(mktemp)
  while IFS= read -r pid; do
    if kill -0 "$pid" 2>/dev/null; then
      echo "$pid" >> "$tmp"
      count=$((count + 1))
    fi
  done < "$PID_FILE"
  mv "$tmp" "$PID_FILE"
  echo "$count"
}

# --- Main loop ----------------------------------------------------------------
log "Started (workers=$MAX_WORKERS, poll=${POLL_INTERVAL}s, budget=\$${MAX_BUDGET}, turns=$MAX_TURNS)"
log "Watching for issues labeled '${LABEL_INTERRUPTED}', '${LABEL_APPROVED}', and '${LABEL_READY}'..."
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

  active=$(active_worker_count)
  available_slots=$(( MAX_WORKERS - active ))

  if [ "$available_slots" -gt 0 ]; then
    # --- Priority 0: Retry interrupted issues ---
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

        run_worker "$number" "$title" "true" &
        echo "$!" >> "$PID_FILE"
        log "Spawned retry worker PID $! for interrupted issue #${number}"
      done <<< "$interrupted_issues"

      # Recalculate available slots
      active=$(active_worker_count)
      available_slots=$(( MAX_WORKERS - active ))
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
            echo "$!" >> "$PID_FILE"
            log "Spawned plan-executor PID $! for issue #${number}"
          else
            # Single work item — route to needs-triage for human review
            log "Issue #${number} is a single work item (no plan markers), routing to needs-triage"
            gh issue edit "$number" --remove-label "$LABEL_APPROVED" --add-label "needs-triage" 2>/dev/null || true
            gh issue comment "$number" --body "This is a single work item (not a multi-item plan). Routing to \`needs-triage\` for human review before work begins." 2>/dev/null || true
          fi
        done <<< "$approved_issues"

        # Recalculate available slots after spawning plan executors
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
          echo "$!" >> "$PID_FILE"
          log "Spawned worker PID $! for issue #${number}"
        done <<< "$issues"
      fi
    fi
  else
    log "All $MAX_WORKERS worker slots occupied, waiting..."
  fi

  sleep "$POLL_INTERVAL"
done
