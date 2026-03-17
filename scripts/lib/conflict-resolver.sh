#!/usr/bin/env bash
# conflict-resolver.sh — Conflict detection and resolution library for daemon PRs.
#
# Usage:
#   source scripts/lib/conflict-resolver.sh
#
# Required:
#   LOG_DIR — directory for per-PR log files and conflict state
#   log()  — logging function (provided by the daemon)
#
# Functions:
#   detect_conflicting_prs          — find open daemon PRs with merge conflicts
#   attempt_clean_rebase            — try a clean git rebase in a worktree
#   push_rebased_branch             — force-with-lease push from worktree
#   poll_ci_status                  — wait for CI checks to pass/fail
#   handle_mechanical_conflicts     — resolve lockfile-only conflicts
#   is_excluded_conflict            — check if conflicts are in excluded files
#   is_mechanical_conflict          — check if only lockfiles are conflicted
#   handle_resolution_success       — comment, remove label, clean state
#   handle_resolution_failure       — label, comment, record retry state
#   should_retry                    — check if PR should be retried
#   cleanup_conflict_worktree       — remove a single conflict worktree
#   cleanup_stale_conflict_worktrees — remove all conflict worktrees (crash recovery)
#   ensure_conflict_state_dir       — create state directory
#   conflict_log                    — log to per-PR log file
#   acquire_conflict_ack            — atomic ACK lock for a PR (prevents concurrent processing)
#   release_conflict_ack            — release ACK lock for a PR
#   cleanup_stale_ack_files         — remove expired/orphaned ACK files (startup cleanup)

set -euo pipefail

# The repo root can be overridden for testing.
CONFLICT_RESOLVER_REPO_ROOT="${CONFLICT_RESOLVER_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# Maximum retry attempts before giving up.
CONFLICT_MAX_RETRIES="${CONFLICT_MAX_RETRIES:-3}"

# Lockfile patterns considered "mechanical" (auto-resolvable).
# Only package-lock.json — this project uses npm exclusively.
LOCKFILE_PATTERNS="^package-lock\.json$"

# Excluded file patterns (should skip to label).
EXCLUDED_PATTERNS="^(prisma/migrations/|prisma/schema\.prisma|sst\.config\.ts)"

# --- Input validation ---------------------------------------------------------

# Validate that a PR number is a positive integer.
# $1 — value to check
# Returns: 0 if valid, 1 if not
_validate_pr_number() {
  local val="$1"
  if ! [[ "$val" =~ ^[0-9]+$ ]]; then
    echo "ERROR: invalid pr_number: $val" >&2
    return 1
  fi
}

# Validate that a branch name contains only safe characters.
# $1 — branch name to check
# Returns: 0 if valid, 1 if not
_validate_branch_name() {
  local val="$1"
  if ! [[ "$val" =~ ^[a-zA-Z0-9._/-]+$ ]]; then
    echo "ERROR: invalid branch name: $val" >&2
    return 1
  fi
}

# --- Logging ------------------------------------------------------------------

# Log a message to the per-PR log file.
# $1 — PR number, $2+ — message
conflict_log() {
  local pr_number="$1"
  shift
  local log_file="$LOG_DIR/conflict-pr-${pr_number}.log"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$log_file"
}

# --- State directory ----------------------------------------------------------

# Create the conflict state directory if it doesn't exist.
ensure_conflict_state_dir() {
  mkdir -p "$LOG_DIR/conflict-state"
}

# --- Detection ----------------------------------------------------------------

# Find open daemon PRs with merge conflicts.
# Returns a JSON array of PR objects (number, title, headRefName, baseRefName, mergeable).
# Filters to:
#   - issue-* branches only
#   - mergeable=CONFLICTING
#   - most recent commit author is the daemon bot
detect_conflicting_prs() {
  local pr_json
  pr_json=$(gh pr list --state open --json number,title,headRefName,baseRefName,mergeable 2>/dev/null || echo "[]")

  # Filter to issue-* branches with CONFLICTING status
  # Default null/empty baseRefName to "main"
  local candidates
  candidates=$(echo "$pr_json" | jq '[.[] | select(.headRefName | startswith("issue-")) | select(.mergeable == "CONFLICTING") | .baseRefName = (if (.baseRefName // "") == "" then "main" else .baseRefName end)]')

  # The issue-* branch prefix already ensures only daemon PRs are picked up,
  # so no additional author filtering is needed. (Local Claude Code runs commit
  # under the user's Git identity, not app/claude-code-bot.)
  echo "$candidates"
}

# Select the first retryable conflict candidate from a JSON array of PRs.
# Iterates all candidates, skipping those with invalid fields or exhausted retries.
# Sets global variables: conflict_pr, conflict_branch, conflict_base
# $1 — JSON array from detect_conflicting_prs()
# Returns: 0 if a candidate was selected, 1 if none found
select_conflict_candidate() {
  local conflicting_json="$1"
  local count
  count=$(echo "$conflicting_json" | jq 'length')

  conflict_pr=""
  conflict_branch=""
  conflict_base=""

  if [ "$count" -le 0 ]; then
    return 1
  fi

  for i in $(seq 0 $((count - 1))); do
    local candidate_pr candidate_branch candidate_base
    candidate_pr=$(echo "$conflicting_json" | jq -r ".[$i].number")
    candidate_branch=$(echo "$conflicting_json" | jq -r ".[$i].headRefName")
    candidate_base=$(echo "$conflicting_json" | jq -r ".[$i].baseRefName")
    # Null guard: default empty/null baseRefName to "main"
    [ -n "$candidate_base" ] && [ "$candidate_base" != "null" ] || candidate_base="main"
    # Validate extracted values before use in shell commands
    if ! _validate_pr_number "$candidate_pr" 2>/dev/null || ! _validate_branch_name "$candidate_branch" 2>/dev/null || ! _validate_branch_name "$candidate_base" 2>/dev/null; then
      log "Skipping conflict PR — invalid PR number or branch name from API"
      continue
    fi
    # Check if we should retry (skip if retries exhausted or base branch hasn't advanced)
    if ! should_retry "$candidate_pr" "$candidate_base"; then
      log "Skipping conflict PR #${candidate_pr} (retries exhausted or ${candidate_base} unchanged)"
      continue
    fi
    # Found a valid, retryable candidate (globals consumed by caller)
    # shellcheck disable=SC2034
    conflict_pr="$candidate_pr"
    # shellcheck disable=SC2034
    conflict_branch="$candidate_branch"
    # shellcheck disable=SC2034
    conflict_base="$candidate_base"
    return 0
  done

  return 1
}

# --- Rebase -------------------------------------------------------------------

# Attempt a clean rebase of a PR branch onto its base branch.
# Creates a fresh worktree, fetches, and rebases.
# $1 — PR number, $2 — head branch name, $3 — base branch (default: main)
# Returns: 0 = clean rebase, 1 = conflicts, 2 = other error
attempt_clean_rebase() {
  local pr_number="$1"
  local head_branch="$2"
  local base_branch="${3:-main}"
  _validate_pr_number "$pr_number" || return 2
  _validate_branch_name "$head_branch" || return 2
  _validate_branch_name "$base_branch" || return 2
  local worktree_path="${CONFLICT_RESOLVER_REPO_ROOT}/.claude/worktrees/conflict-pr-${pr_number}"

  conflict_log "$pr_number" "Starting clean rebase of $head_branch onto origin/${base_branch}"

  # Clean up any existing worktree first
  if [ -d "$worktree_path" ]; then
    conflict_log "$pr_number" "Removing existing worktree at $worktree_path"
    git worktree remove "$worktree_path" --force 2>/dev/null || rm -rf "$worktree_path"
  fi

  # Fetch latest
  if ! git fetch origin 2>/dev/null; then
    conflict_log "$pr_number" "ERROR: git fetch origin failed"
    return 2
  fi

  # Create fresh worktree from the PR branch
  if ! git worktree add "$worktree_path" "origin/${head_branch}" 2>/dev/null; then
    conflict_log "$pr_number" "ERROR: failed to create worktree from origin/${head_branch}"
    return 2
  fi

  # Abort any stuck rebase state in the worktree
  if [ -d "${worktree_path}/.git/rebase-merge" ] || [ -d "${worktree_path}/.git/rebase-apply" ]; then
    conflict_log "$pr_number" "Aborting stuck rebase state"
    git -C "$worktree_path" rebase --abort 2>/dev/null || true
  fi

  # Attempt rebase
  local rebase_output
  if rebase_output=$(git -C "$worktree_path" rebase "origin/${base_branch}" 2>&1); then
    conflict_log "$pr_number" "Clean rebase succeeded"
    return 0
  else
    # Check if it's a conflict or other error
    if echo "$rebase_output" | grep -qiE 'CONFLICT|merge conflict|could not apply'; then
      conflict_log "$pr_number" "Rebase hit conflicts: $(echo "$rebase_output" | head -5)"
      # Abort the failed rebase so worktree is clean for agent or cleanup
      git -C "$worktree_path" rebase --abort 2>/dev/null || true
      return 1
    else
      conflict_log "$pr_number" "Rebase failed with unexpected error: $rebase_output"
      git -C "$worktree_path" rebase --abort 2>/dev/null || true
      return 2
    fi
  fi
}

# --- Push ---------------------------------------------------------------------

# Push the rebased branch with --force-with-lease from the worktree.
# $1 — PR number
# Returns: 0 = success, 1 = lease rejection or other failure
push_rebased_branch() {
  local pr_number="$1"
  _validate_pr_number "$pr_number" || return 1
  local worktree_path="${CONFLICT_RESOLVER_REPO_ROOT}/.claude/worktrees/conflict-pr-${pr_number}"

  # Determine the branch name from the worktree
  local branch_name
  branch_name=$(git -C "$worktree_path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

  if [ -z "$branch_name" ] || [ "$branch_name" = "HEAD" ]; then
    conflict_log "$pr_number" "ERROR: could not determine branch name in worktree"
    return 1
  fi

  conflict_log "$pr_number" "Pushing $branch_name with --force-with-lease"

  local push_output
  if push_output=$(git -C "$worktree_path" push --force-with-lease origin "$branch_name" 2>&1); then
    conflict_log "$pr_number" "Push succeeded"
    return 0
  else
    conflict_log "$pr_number" "Push failed: $push_output"
    return 1
  fi
}

# --- CI polling ---------------------------------------------------------------

# Poll CI status for a PR until all checks pass, any fails, or timeout.
# $1 — PR number, $2 — timeout in seconds (default: 900)
# Returns: 0 = all pass, 1 = any fail, 2 = timeout
poll_ci_status() {
  local pr_number="$1"
  _validate_pr_number "$pr_number" || return 2
  local timeout="${2:-900}"
  local poll_interval=30
  local start_time
  start_time=$(date +%s)

  conflict_log "$pr_number" "Polling CI status (timeout: ${timeout}s)"

  while true; do
    local elapsed=$(( $(date +%s) - start_time ))
    if [ "$elapsed" -ge "$timeout" ]; then
      conflict_log "$pr_number" "CI polling timed out after ${timeout}s"
      return 2
    fi

    # Get check status
    local checks_output
    checks_output=$(gh pr checks "$pr_number" 2>&1 || true)

    # Check for any failures
    if echo "$checks_output" | grep -qE '\bfail\b'; then
      conflict_log "$pr_number" "CI check failed"
      return 1
    fi

    # Check if all passed (no "pending" or "in_progress" lines)
    if [ -n "$checks_output" ] && ! echo "$checks_output" | grep -qiE 'pending|in_progress|queued'; then
      # If there's output and no pending items, checks are done
      if echo "$checks_output" | grep -qE '\bpass\b'; then
        conflict_log "$pr_number" "All CI checks passed"
        return 0
      fi
    fi

    conflict_log "$pr_number" "CI still running (${elapsed}s elapsed), waiting ${poll_interval}s..."
    sleep "$poll_interval"
  done
}

# --- Conflict classification --------------------------------------------------

# Check if only lockfiles are conflicted (mechanical resolution possible).
# $1 — worktree path
# Returns: 0 = only lockfiles, 1 = non-lockfile conflicts exist
is_mechanical_conflict() {
  local worktree_path="$1"

  local conflicted_files
  conflicted_files=$(git -C "$worktree_path" diff --name-only --diff-filter=U 2>/dev/null || echo "")

  if [ -z "$conflicted_files" ]; then
    return 1
  fi

  while IFS= read -r file; do
    [ -n "$file" ] || continue
    local basename
    basename=$(basename "$file")
    if ! echo "$basename" | grep -qE "$LOCKFILE_PATTERNS"; then
      return 1
    fi
  done <<< "$conflicted_files"

  return 0
}

# Check if any conflicted files are in excluded paths.
# $1 — PR number, $2 — worktree path
# Returns: 0 = has excluded files (should skip), 1 = no excluded files
is_excluded_conflict() {
  local pr_number="$1"
  local worktree_path="$2"

  local conflicted_files
  conflicted_files=$(git -C "$worktree_path" diff --name-only --diff-filter=U 2>/dev/null || echo "")

  if [ -z "$conflicted_files" ]; then
    return 1
  fi

  while IFS= read -r file; do
    [ -n "$file" ] || continue
    if echo "$file" | grep -qE "$EXCLUDED_PATTERNS"; then
      conflict_log "$pr_number" "Excluded conflict file detected: $file"
      return 0
    fi
  done <<< "$conflicted_files"

  return 1
}

# --- Mechanical resolution ----------------------------------------------------

# Attempt to resolve mechanical (lockfile-only) conflicts.
# $1 — PR number, $2 — base branch (default: main)
# Returns: 0 = resolved, 1 = non-mechanical conflicts remain
handle_mechanical_conflicts() {
  local pr_number="$1"
  local base_branch="${2:-main}"
  _validate_pr_number "$pr_number" || return 1
  _validate_branch_name "$base_branch" || return 1
  local worktree_path="${CONFLICT_RESOLVER_REPO_ROOT}/.claude/worktrees/conflict-pr-${pr_number}"

  conflict_log "$pr_number" "Attempting mechanical conflict resolution (base: ${base_branch})"

  # Fetch and start rebase (caller should have already attempted rebase)
  # Re-attempt rebase to get into conflicted state
  git -C "$worktree_path" fetch origin 2>/dev/null || true
  local rebase_output
  rebase_output=$(git -C "$worktree_path" rebase "origin/${base_branch}" 2>&1 || true)

  local conflicted_files
  conflicted_files=$(git -C "$worktree_path" diff --name-only --diff-filter=U 2>/dev/null || echo "")

  if [ -z "$conflicted_files" ]; then
    conflict_log "$pr_number" "No conflicted files found"
    return 1
  fi

  # Check all conflicted files are lockfiles
  if ! is_mechanical_conflict "$worktree_path"; then
    conflict_log "$pr_number" "Non-mechanical conflicts detected, aborting"
    git -C "$worktree_path" rebase --abort 2>/dev/null || true
    return 1
  fi

  # Resolve each lockfile
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    conflict_log "$pr_number" "Resolving mechanical conflict: $file"

    local basename
    basename=$(basename "$file")

    # Delete the conflicted lockfile and regenerate
    rm -f "${worktree_path}/${file}"
    git -C "$worktree_path" add "$file" 2>/dev/null || true
    (cd "$worktree_path" && npm install --package-lock-only --ignore-scripts 2>/dev/null) || true
    git -C "$worktree_path" add "$file" 2>/dev/null || true
  done <<< "$conflicted_files"

  # Continue the rebase
  if git -C "$worktree_path" rebase --continue 2>/dev/null; then
    conflict_log "$pr_number" "Mechanical conflict resolution succeeded"
    return 0
  else
    conflict_log "$pr_number" "Rebase --continue failed after mechanical resolution"
    git -C "$worktree_path" rebase --abort 2>/dev/null || true
    return 1
  fi
}

# --- Success/failure handlers -------------------------------------------------

# Handle successful conflict resolution.
# Comments on PR, removes label, cleans up state file.
# $1 — PR number, $2 — base branch (default: main), $3 — worktree path (optional)
handle_resolution_success() {
  local pr_number="$1"
  local base_branch="${2:-main}"
  local worktree_path="${3:-}"
  _validate_pr_number "$pr_number" || return 1
  _validate_branch_name "$base_branch" || return 1

  conflict_log "$pr_number" "Resolution succeeded — commenting and cleaning up"

  local new_head
  if [ -n "$worktree_path" ] && [ -d "$worktree_path" ]; then
    new_head=$(git -C "$worktree_path" rev-parse --short HEAD 2>/dev/null || echo "unknown")
  else
    new_head=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  fi

  local comment_body
  comment_body="$(cat <<EOF
**Conflict auto-resolved** by the daemon.

Rebased onto \`origin/${base_branch}\` (new HEAD: \`${new_head}\`). CI checks should run automatically.
EOF
)"

  gh pr comment "$pr_number" --body "$comment_body" 2>/dev/null || true
  gh pr edit "$pr_number" --remove-label "needs-manual-rebase" 2>/dev/null || true

  # Clean up retry state
  local state_file="$LOG_DIR/conflict-state/pr-${pr_number}.state"
  rm -f "$state_file"
}

# Handle failed conflict resolution.
# Adds label, comments with reason, records retry state.
# $1 — PR number, $2 — failure reason, $3 — base branch (default: main)
handle_resolution_failure() {
  local pr_number="$1"
  local reason="$2"
  local base_branch="${3:-main}"
  _validate_pr_number "$pr_number" || return 1
  _validate_branch_name "$base_branch" || return 1

  ensure_conflict_state_dir
  conflict_log "$pr_number" "Resolution failed: $reason"

  # Read existing state or start fresh
  local state_file="$LOG_DIR/conflict-state/pr-${pr_number}.state"
  local attempt_count=0

  if [ -f "$state_file" ]; then
    attempt_count=$(grep '^attempt_count=' "$state_file" | cut -d= -f2 || echo "0")
    [[ "$attempt_count" =~ ^[0-9]+$ ]] || attempt_count=0
  fi

  attempt_count=$((attempt_count + 1))

  local base_sha
  base_sha=$(git rev-parse "origin/${base_branch}" 2>/dev/null || echo "unknown")
  local now_epoch
  now_epoch=$(date +%s)

  # Write state file (base_sha_at_failure + base_branch for new format)
  cat > "$state_file" <<EOF
attempt_count=${attempt_count}
base_sha_at_failure=${base_sha}
base_branch=${base_branch}
last_attempt_epoch=${now_epoch}
EOF

  # Add label and comment
  gh pr edit "$pr_number" --add-label "needs-manual-rebase" 2>/dev/null || true

  local comment_body
  comment_body="$(cat <<EOF
**Automatic conflict resolution failed** (attempt ${attempt_count}/${CONFLICT_MAX_RETRIES}).

**Reason:** ${reason}

Will retry automatically when \`${base_branch}\` advances (if attempts remain).
EOF
)"

  gh pr comment "$pr_number" --body "$comment_body" 2>/dev/null || true
}

# --- Retry logic --------------------------------------------------------------

# Check if a PR should be retried.
# Returns 0 if should retry, 1 if not.
# Retries if: attempt_count < max AND current base branch SHA differs from last failure.
# $1 — PR number, $2 — base branch (default: read from state file, fallback to main)
should_retry() {
  local pr_number="$1"
  local base_branch_override="${2:-}"
  _validate_pr_number "$pr_number" || return 1
  local state_file="$LOG_DIR/conflict-state/pr-${pr_number}.state"

  # No state file => first attempt, should try
  if [ ! -f "$state_file" ]; then
    return 0
  fi

  local attempt_count
  attempt_count=$(grep '^attempt_count=' "$state_file" | cut -d= -f2 || echo "0")
  [[ "$attempt_count" =~ ^[0-9]+$ ]] || attempt_count=0

  # Max retries reached
  if [ "$attempt_count" -ge "$CONFLICT_MAX_RETRIES" ]; then
    return 1
  fi

  # Determine base branch: override > state file > fallback "main"
  local base_branch
  if [ -n "$base_branch_override" ]; then
    base_branch="$base_branch_override"
  else
    base_branch=$(grep '^base_branch=' "$state_file" | cut -d= -f2 || echo "")
    [ -n "$base_branch" ] || base_branch="main"
  fi
  _validate_branch_name "$base_branch" || return 1

  # Read SHA: new format (base_sha_at_failure) with fallback to old format (main_sha_at_failure)
  local recorded_sha
  recorded_sha=$(grep '^base_sha_at_failure=' "$state_file" | cut -d= -f2 || echo "")
  if [ -z "$recorded_sha" ]; then
    recorded_sha=$(grep '^main_sha_at_failure=' "$state_file" | cut -d= -f2 || echo "")
  fi

  local current_sha
  current_sha=$(git rev-parse "origin/${base_branch}" 2>/dev/null || echo "")

  # Only retry if base branch has advanced
  if [ "$recorded_sha" = "$current_sha" ]; then
    return 1
  fi

  return 0
}

# --- Worktree cleanup ---------------------------------------------------------

# Remove a single conflict worktree.
# $1 — PR number
cleanup_conflict_worktree() {
  local pr_number="$1"
  _validate_pr_number "$pr_number" || return 1
  local worktree_path="${CONFLICT_RESOLVER_REPO_ROOT}/.claude/worktrees/conflict-pr-${pr_number}"

  if [ -d "$worktree_path" ]; then
    conflict_log "$pr_number" "Removing conflict worktree at $worktree_path"
    git worktree remove "$worktree_path" --force 2>/dev/null || rm -rf "$worktree_path"
  fi
}

# Remove all conflict-pr-* worktrees (crash recovery on daemon startup).
cleanup_stale_conflict_worktrees() {
  local worktree_dir="${CONFLICT_RESOLVER_REPO_ROOT}/.claude/worktrees"

  if [ ! -d "$worktree_dir" ]; then
    return 0
  fi

  for dir in "$worktree_dir"/conflict-pr-*; do
    [ -d "$dir" ] || continue
    local pr_num="${dir##*conflict-pr-}"
    log "Cleaning up stale conflict worktree: $dir (PR #$pr_num)"
    git worktree remove "$dir" --force 2>/dev/null || rm -rf "$dir"
  done
}

# --- ACK locking (prevents concurrent processing of same PR) -----------------

# ACK TTL in seconds — 75 minutes (exceeds WALL_TIMEOUT of 60 min).
CONFLICT_ACK_TTL="${CONFLICT_ACK_TTL:-4500}"

# Acquire an exclusive ACK lock for a PR.
# Uses set -o noclobber for atomic creation (fails if file already exists).
# $1 — PR number
# Returns: 0 = acquired, 1 = already locked (by a live process within TTL)
acquire_conflict_ack() {
  local pr_number="$1"
  _validate_pr_number "$pr_number" || return 1

  ensure_conflict_state_dir
  local ack_file="$LOG_DIR/conflict-state/pr-${pr_number}.ack"

  # If ACK file exists, check if it's stale
  if [ -f "$ack_file" ]; then
    local ack_pid ack_ts
    ack_pid=$(grep '^pid=' "$ack_file" 2>/dev/null | cut -d= -f2 || echo "")
    ack_ts=$(grep '^ts=' "$ack_file" 2>/dev/null | cut -d= -f2 || echo "0")
    [[ "$ack_ts" =~ ^[0-9]+$ ]] || ack_ts=0

    local now
    now=$(date +%s)
    local age=$(( now - ack_ts ))

    # Check if ACK is expired (past TTL)
    if [ "$age" -ge "$CONFLICT_ACK_TTL" ]; then
      conflict_log "$pr_number" "ACK file expired (age=${age}s, TTL=${CONFLICT_ACK_TTL}s) — removing stale ACK"
      rm -f "$ack_file"
    elif [ -n "$ack_pid" ] && ! kill -0 "$ack_pid" 2>/dev/null; then
      # PID is dead — stale ACK from crashed daemon
      conflict_log "$pr_number" "ACK file has dead PID ${ack_pid} — removing stale ACK"
      rm -f "$ack_file"
    else
      # ACK is live and within TTL — cannot acquire
      conflict_log "$pr_number" "ACK already held by PID ${ack_pid} (age=${age}s) — skipping"
      return 1
    fi
  fi

  # Atomic creation with noclobber — prevents TOCTOU race between instances
  local ack_content
  ack_content="pid=$$
ts=$(date +%s)
pr=${pr_number}"

  if ( set -o noclobber; echo "$ack_content" > "$ack_file" ) 2>/dev/null; then
    conflict_log "$pr_number" "ACK acquired (PID=$$)"
    return 0
  else
    conflict_log "$pr_number" "ACK creation race lost — another process acquired it"
    return 1
  fi
}

# Release an ACK lock for a PR.
# $1 — PR number
release_conflict_ack() {
  local pr_number="$1"
  _validate_pr_number "$pr_number" || return 1

  local ack_file="$LOG_DIR/conflict-state/pr-${pr_number}.ack"
  if [ -f "$ack_file" ]; then
    rm -f "$ack_file"
    conflict_log "$pr_number" "ACK released"
  fi
}

# Clean up stale ACK files at daemon startup.
# Removes ACK files with dead PIDs or expired TTL.
cleanup_stale_ack_files() {
  local ack_dir="$LOG_DIR/conflict-state"
  [ -d "$ack_dir" ] || return 0

  for ack_file in "$ack_dir"/pr-*.ack; do
    [ -f "$ack_file" ] || continue

    local ack_pid ack_ts pr_num
    ack_pid=$(grep '^pid=' "$ack_file" 2>/dev/null | cut -d= -f2 || echo "")
    ack_ts=$(grep '^ts=' "$ack_file" 2>/dev/null | cut -d= -f2 || echo "0")
    [[ "$ack_ts" =~ ^[0-9]+$ ]] || ack_ts=0
    pr_num=$(grep '^pr=' "$ack_file" 2>/dev/null | cut -d= -f2 || echo "?")

    local now
    now=$(date +%s)
    local age=$(( now - ack_ts ))
    local stale=false

    # Expired TTL
    if [ "$age" -ge "$CONFLICT_ACK_TTL" ]; then
      stale=true
    fi

    # Dead PID
    if [ -n "$ack_pid" ] && ! kill -0 "$ack_pid" 2>/dev/null; then
      stale=true
    fi

    if [ "$stale" = "true" ]; then
      log "Cleaning up stale ACK file for PR #${pr_num} (pid=${ack_pid}, age=${age}s)"
      rm -f "$ack_file"
    fi
  done
}
