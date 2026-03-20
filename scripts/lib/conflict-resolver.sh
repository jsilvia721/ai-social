#!/usr/bin/env bash
# conflict-resolver.sh — Inline conflict detection and mechanical resolution for daemon PRs.
#
# Simplified from the original 689-line library + agent-based resolver.
# Now handles: detection, clean rebase, mechanical lockfile resolution, retry logic.
# Non-mechanical conflicts get labeled `needs-manual-rebase` — no agent spawn.
#
# Usage:
#   source scripts/lib/conflict-resolver.sh
#
# Required:
#   LOG_DIR — directory for conflict state files
#   log()  — logging function (provided by the daemon)
#
# Functions:
#   detect_conflicting_prs          — find open daemon PRs with merge conflicts
#   select_conflict_candidate       — pick first retryable PR (sets globals)
#   attempt_clean_rebase            — try a clean git rebase in a worktree
#   push_rebased_branch             — force-with-lease push from worktree
#   handle_mechanical_conflicts     — resolve lockfile-only conflicts
#   is_excluded_conflict            — check if conflicts are in excluded files
#   is_mechanical_conflict          — check if only lockfiles are conflicted
#   handle_resolution_success       — comment, remove label, clean state
#   handle_resolution_failure       — label, comment, record retry state
#   should_retry                    — check if PR should be retried
#   cleanup_conflict_worktree       — remove a single conflict worktree
#   cleanup_stale_conflict_worktrees — remove all conflict worktrees (crash recovery)
#   ensure_conflict_state_dir       — create state directory

set -euo pipefail

# The repo root can be overridden for testing.
CONFLICT_RESOLVER_REPO_ROOT="${CONFLICT_RESOLVER_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# Maximum retry attempts before giving up.
CONFLICT_MAX_RETRIES="${CONFLICT_MAX_RETRIES:-3}"

# Lockfile patterns considered "mechanical" (auto-resolvable).
LOCKFILE_PATTERNS="^package-lock\.json$"

# --- Input validation ---------------------------------------------------------

_validate_pr_number() {
  local val="$1"
  if ! [[ "$val" =~ ^[0-9]+$ ]]; then
    echo "ERROR: invalid pr_number: $val" >&2
    return 1
  fi
}

_validate_branch_name() {
  local val="$1"
  if ! [[ "$val" =~ ^[a-zA-Z0-9._/-]+$ ]]; then
    echo "ERROR: invalid branch name: $val" >&2
    return 1
  fi
}

# --- State directory ----------------------------------------------------------

ensure_conflict_state_dir() {
  mkdir -p "$LOG_DIR/conflict-state"
}

# --- Detection ----------------------------------------------------------------

# Find open daemon PRs with merge conflicts.
# Returns a JSON array of PR objects (number, title, headRefName, baseRefName, mergeable).
detect_conflicting_prs() {
  local pr_json
  pr_json=$(gh pr list --state open --json number,title,headRefName,baseRefName,mergeable 2>/dev/null || echo "[]")

  # Filter to issue-* branches with CONFLICTING status
  # Default null/empty baseRefName to "main"
  echo "$pr_json" | jq '[.[] | select(.headRefName | startswith("issue-")) | select(.mergeable == "CONFLICTING") | .baseRefName = (if (.baseRefName // "") == "" then "main" else .baseRefName end)]'
}

# Select the first retryable conflict candidate from a JSON array of PRs.
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
    [ -n "$candidate_base" ] && [ "$candidate_base" != "null" ] || candidate_base="main"
    if ! _validate_pr_number "$candidate_pr" 2>/dev/null || ! _validate_branch_name "$candidate_branch" 2>/dev/null || ! _validate_branch_name "$candidate_base" 2>/dev/null; then
      log "Skipping conflict PR — invalid PR number or branch name from API"
      continue
    fi
    if ! should_retry "$candidate_pr" "$candidate_base"; then
      log "Skipping conflict PR #${candidate_pr} (retries exhausted or ${candidate_base} unchanged)"
      continue
    fi
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

  # Clean up any existing worktree first
  if [ -d "$worktree_path" ]; then
    git worktree remove "$worktree_path" --force 2>/dev/null || rm -rf "$worktree_path"
  fi

  # Fetch latest (required — documented in worktree-branch-divergence-merge-conflicts.md)
  if ! git fetch origin 2>/dev/null; then
    log "Conflict PR #${pr_number}: git fetch origin failed"
    return 2
  fi

  # Create fresh worktree from the PR branch
  if ! git worktree add "$worktree_path" "origin/${head_branch}" 2>/dev/null; then
    log "Conflict PR #${pr_number}: failed to create worktree from origin/${head_branch}"
    return 2
  fi

  # Abort any stuck rebase state in the worktree
  if [ -d "${worktree_path}/.git/rebase-merge" ] || [ -d "${worktree_path}/.git/rebase-apply" ]; then
    git -C "$worktree_path" rebase --abort 2>/dev/null || true
  fi

  # Attempt rebase — always use baseRefName (fixes #816: never hardcode main)
  local rebase_output
  if rebase_output=$(git -C "$worktree_path" rebase "origin/${base_branch}" 2>&1); then
    return 0
  else
    if echo "$rebase_output" | grep -qiE 'CONFLICT|merge conflict|could not apply'; then
      git -C "$worktree_path" rebase --abort 2>/dev/null || true
      return 1
    else
      log "Conflict PR #${pr_number}: rebase failed with unexpected error"
      git -C "$worktree_path" rebase --abort 2>/dev/null || true
      return 2
    fi
  fi
}

# --- Push ---------------------------------------------------------------------

# Push the rebased branch with --force-with-lease from the worktree.
# $1 — PR number
# Returns: 0 = success, 1 = failure
push_rebased_branch() {
  local pr_number="$1"
  _validate_pr_number "$pr_number" || return 1
  local worktree_path="${CONFLICT_RESOLVER_REPO_ROOT}/.claude/worktrees/conflict-pr-${pr_number}"

  local branch_name
  branch_name=$(git -C "$worktree_path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

  if [ -z "$branch_name" ] || [ "$branch_name" = "HEAD" ]; then
    log "Conflict PR #${pr_number}: could not determine branch name in worktree"
    return 1
  fi

  if git -C "$worktree_path" push --force-with-lease origin "$branch_name" 2>&1; then
    return 0
  else
    log "Conflict PR #${pr_number}: push --force-with-lease failed"
    return 1
  fi
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

  # Re-attempt rebase to get into conflicted state
  git -C "$worktree_path" fetch origin 2>/dev/null || true
  git -C "$worktree_path" rebase "origin/${base_branch}" 2>&1 || true

  local conflicted_files
  conflicted_files=$(git -C "$worktree_path" diff --name-only --diff-filter=U 2>/dev/null || echo "")

  if [ -z "$conflicted_files" ]; then
    return 1
  fi

  # Check all conflicted files are lockfiles
  if ! is_mechanical_conflict "$worktree_path"; then
    git -C "$worktree_path" rebase --abort 2>/dev/null || true
    return 1
  fi

  # Resolve each lockfile: delete conflicted version, regenerate
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    rm -f "${worktree_path}/${file}"
    git -C "$worktree_path" add "$file" 2>/dev/null || true
    (cd "$worktree_path" && npm install --package-lock-only --ignore-scripts 2>/dev/null) || true
    git -C "$worktree_path" add "$file" 2>/dev/null || true
  done <<< "$conflicted_files"

  # Continue the rebase
  if GIT_EDITOR=true git -C "$worktree_path" rebase --continue 2>/dev/null; then
    return 0
  else
    git -C "$worktree_path" rebase --abort 2>/dev/null || true
    return 1
  fi
}

# --- Success/failure handlers -------------------------------------------------

# Handle successful conflict resolution.
# $1 — PR number, $2 — base branch (default: main), $3 — worktree path (optional)
handle_resolution_success() {
  local pr_number="$1"
  local base_branch="${2:-main}"
  local worktree_path="${3:-}"
  _validate_pr_number "$pr_number" || return 1
  _validate_branch_name "$base_branch" || return 1

  local new_head
  if [ -n "$worktree_path" ] && [ -d "$worktree_path" ]; then
    new_head=$(git -C "$worktree_path" rev-parse --short HEAD 2>/dev/null || echo "unknown")
  else
    new_head=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  fi

  gh pr comment "$pr_number" --body "**Conflict auto-resolved** by the daemon. Rebased onto \`origin/${base_branch}\` (new HEAD: \`${new_head}\`). CI checks should run automatically." 2>/dev/null || true
  gh pr edit "$pr_number" --remove-label "needs-manual-rebase" 2>/dev/null || true

  # Clean up retry state
  rm -f "$LOG_DIR/conflict-state/pr-${pr_number}.state"
}

# Handle failed conflict resolution.
# $1 — PR number, $2 — failure reason, $3 — base branch (default: main)
handle_resolution_failure() {
  local pr_number="$1"
  local reason="$2"
  local base_branch="${3:-main}"
  _validate_pr_number "$pr_number" || return 1
  _validate_branch_name "$base_branch" || return 1

  ensure_conflict_state_dir

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

  cat > "$state_file" <<EOF
attempt_count=${attempt_count}
base_sha_at_failure=${base_sha}
base_branch=${base_branch}
last_attempt_epoch=$(date +%s)
EOF

  gh pr edit "$pr_number" --add-label "needs-manual-rebase" 2>/dev/null || true
  gh pr comment "$pr_number" --body "**Automatic conflict resolution failed** (attempt ${attempt_count}/${CONFLICT_MAX_RETRIES}). **Reason:** ${reason}. Will retry automatically when \`${base_branch}\` advances (if attempts remain)." 2>/dev/null || true
}

# --- Retry logic --------------------------------------------------------------

# Check if a PR should be retried.
# Returns 0 if should retry, 1 if not.
should_retry() {
  local pr_number="$1"
  local base_branch_override="${2:-}"
  _validate_pr_number "$pr_number" || return 1
  local state_file="$LOG_DIR/conflict-state/pr-${pr_number}.state"

  # No state file => first attempt
  if [ ! -f "$state_file" ]; then
    return 0
  fi

  local attempt_count
  attempt_count=$(grep '^attempt_count=' "$state_file" | cut -d= -f2 || echo "0")
  [[ "$attempt_count" =~ ^[0-9]+$ ]] || attempt_count=0

  if [ "$attempt_count" -ge "$CONFLICT_MAX_RETRIES" ]; then
    return 1
  fi

  # Determine base branch
  local base_branch
  if [ -n "$base_branch_override" ]; then
    base_branch="$base_branch_override"
  else
    base_branch=$(grep '^base_branch=' "$state_file" | cut -d= -f2 || echo "")
    [ -n "$base_branch" ] || base_branch="main"
  fi
  _validate_branch_name "$base_branch" || return 1

  local recorded_sha
  recorded_sha=$(grep '^base_sha_at_failure=' "$state_file" | cut -d= -f2 || echo "")

  local current_sha
  current_sha=$(git rev-parse "origin/${base_branch}" 2>/dev/null || echo "")

  # Only retry if base branch has advanced
  [ "$recorded_sha" != "$current_sha" ]
}

# --- Worktree cleanup ---------------------------------------------------------

# Remove a single conflict worktree.
cleanup_conflict_worktree() {
  local pr_number="$1"
  _validate_pr_number "$pr_number" || return 1
  local worktree_path="${CONFLICT_RESOLVER_REPO_ROOT}/.claude/worktrees/conflict-pr-${pr_number}"

  if [ -d "$worktree_path" ]; then
    git worktree remove "$worktree_path" --force 2>/dev/null || rm -rf "$worktree_path"
  fi
}

# Remove all conflict-pr-* worktrees (crash recovery on daemon startup).
cleanup_stale_conflict_worktrees() {
  local worktree_dir="${CONFLICT_RESOLVER_REPO_ROOT}/.claude/worktrees"
  [ -d "$worktree_dir" ] || return 0

  for dir in "$worktree_dir"/conflict-pr-*; do
    [ -d "$dir" ] || continue
    local pr_num="${dir##*conflict-pr-}"
    log "Cleaning up stale conflict worktree: $dir (PR #$pr_num)"
    git worktree remove "$dir" --force 2>/dev/null || rm -rf "$dir"
  done
}
