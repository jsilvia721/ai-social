#!/usr/bin/env bash
# conflict-resolver.test.sh — Unit tests for scripts/lib/conflict-resolver.sh
#
# Run: bash scripts/__tests__/conflict-resolver.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# --- Test framework -----------------------------------------------------------
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

pass() {
  TESTS_RUN=$((TESTS_RUN + 1))
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "  ✓ $1"
}

fail() {
  TESTS_RUN=$((TESTS_RUN + 1))
  TESTS_FAILED=$((TESTS_FAILED + 1))
  echo "  ✗ $1"
  echo "    Expected: $2"
  echo "    Got:      $3"
}

assert_eq() {
  local description="$1"
  local expected="$2"
  local actual="$3"
  if [ "$expected" = "$actual" ]; then
    pass "$description"
  else
    fail "$description" "$expected" "$actual"
  fi
}

assert_file_exists() {
  local description="$1"
  local filepath="$2"
  if [ -f "$filepath" ]; then
    pass "$description"
  else
    fail "$description" "file exists at $filepath" "file missing"
  fi
}

assert_file_not_exists() {
  local description="$1"
  local filepath="$2"
  if [ ! -f "$filepath" ]; then
    pass "$description"
  else
    fail "$description" "file absent at $filepath" "file exists"
  fi
}

assert_file_contains() {
  local description="$1"
  local filepath="$2"
  local pattern="$3"
  if grep -qE "$pattern" "$filepath" 2>/dev/null; then
    pass "$description"
  else
    fail "$description" "file contains /$pattern/" "not found in $filepath"
  fi
}

# --- Setup temp directories ---------------------------------------------------
echo ""
echo "=== Conflict Resolver Library Tests ==="
echo ""

TEST_DIR=$(mktemp -d)
export LOG_DIR="$TEST_DIR/logs"
mkdir -p "$LOG_DIR"

# Provide a no-op log function (library expects it from the daemon)
log() {
  echo "[test $(date '+%H:%M:%S')] $*" >> "$TEST_DIR/test-debug.log"
}

# Source the library
# shellcheck source=scripts/lib/conflict-resolver.sh
source "$REPO_ROOT/scripts/lib/conflict-resolver.sh"

# =============================================================================
# Test: ensure_conflict_state_dir
# =============================================================================
echo "ensure_conflict_state_dir:"

ensure_conflict_state_dir
if [ -d "$LOG_DIR/conflict-state" ]; then
  pass "creates conflict-state directory"
else
  fail "creates conflict-state directory" "directory exists" "directory missing"
fi

# Idempotent
ensure_conflict_state_dir
pass "idempotent on existing directory"

# =============================================================================
# Test: should_retry — no state file
# =============================================================================
echo ""
echo "should_retry:"

# No state file => should retry (first attempt)
if should_retry 999; then
  pass "returns 0 (should retry) when no state file exists"
else
  fail "returns 0 (should retry) when no state file exists" "exit 0" "exit 1"
fi

# =============================================================================
# Test: handle_resolution_failure — creates state file
# =============================================================================
echo ""
echo "handle_resolution_failure (state management):"

# Mock gh commands
gh() {
  case "$1 $2" in
    "pr comment")
      echo "mock: commented on PR" >> "$TEST_DIR/gh-calls.log"
      ;;
    "pr edit")
      echo "mock: edited PR $*" >> "$TEST_DIR/gh-calls.log"
      ;;
    *)
      echo "mock: gh $*" >> "$TEST_DIR/gh-calls.log"
      ;;
  esac
}

# Mock git for base branch SHA
git() {
  case "$*" in
    *"rev-parse origin/main"*)
      echo "abc123def456"
      ;;
    *)
      command git "$@"
      ;;
  esac
}

handle_resolution_failure 42 "test failure reason"

state_file="$LOG_DIR/conflict-state/pr-42.state"
assert_file_exists "creates state file for PR 42" "$state_file"
assert_file_contains "state file has attempt_count=1" "$state_file" "^attempt_count=1$"
assert_file_contains "state file has base_sha_at_failure" "$state_file" "^base_sha_at_failure=abc123def456$"
assert_file_contains "state file has base_branch=main" "$state_file" "^base_branch=main$"
assert_file_contains "state file has last_attempt_epoch" "$state_file" "^last_attempt_epoch=[0-9]+$"

# gh was called to comment and add label
assert_file_contains "gh pr comment was called" "$TEST_DIR/gh-calls.log" "commented on PR"
assert_file_contains "gh pr edit was called" "$TEST_DIR/gh-calls.log" "edited PR"

# =============================================================================
# Test: should_retry — with state file, same base SHA
# =============================================================================
echo ""
echo "should_retry — same base SHA:"

# attempt_count < 3 but base hasn't advanced => should NOT retry
if should_retry 42; then
  fail "returns 1 when base SHA unchanged" "exit 1" "exit 0"
else
  pass "returns 1 when base SHA unchanged"
fi

# =============================================================================
# Test: should_retry — different base SHA
# =============================================================================
echo ""
echo "should_retry — different base SHA:"

git() {
  case "$*" in
    *"rev-parse origin/main"*)
      echo "new789sha000"
      ;;
    *)
      command git "$@"
      ;;
  esac
}

if should_retry 42; then
  pass "returns 0 when base SHA has advanced"
else
  fail "returns 0 when base SHA has advanced" "exit 0" "exit 1"
fi

# =============================================================================
# Test: handle_resolution_failure — increments attempt count
# =============================================================================
echo ""
echo "handle_resolution_failure — increment:"

handle_resolution_failure 42 "second failure"
assert_file_contains "state file has attempt_count=2" "$state_file" "^attempt_count=2$"
assert_file_contains "state file updated base_sha" "$state_file" "^base_sha_at_failure=new789sha000$"

# =============================================================================
# Test: should_retry — max attempts reached
# =============================================================================
echo ""
echo "should_retry — max attempts:"

handle_resolution_failure 42 "third failure"
assert_file_contains "state file has attempt_count=3" "$state_file" "^attempt_count=3$"

# Even with different base SHA, 3 attempts => no retry
git() {
  case "$*" in
    *"rev-parse origin/main"*)
      echo "yetanothsha"
      ;;
    *)
      command git "$@"
      ;;
  esac
}

if should_retry 42; then
  fail "returns 1 when max attempts reached" "exit 1" "exit 0"
else
  pass "returns 1 when max attempts reached (3 attempts)"
fi

# =============================================================================
# Test: should_retry — respects base_branch override
# =============================================================================
echo ""
echo "should_retry — base branch override:"

# Create a state file for PR 50 with base branch "staging"
ensure_conflict_state_dir
cat > "$LOG_DIR/conflict-state/pr-50.state" <<EOF
attempt_count=1
base_sha_at_failure=oldsha123
base_branch=staging
last_attempt_epoch=$(date +%s)
EOF

# Mock git for staging branch
git() {
  case "$*" in
    *"rev-parse origin/staging"*)
      echo "newsha456"
      ;;
    *"rev-parse origin/main"*)
      echo "mainsha789"
      ;;
    *)
      command git "$@"
      ;;
  esac
}

if should_retry 50 "staging"; then
  pass "retries when staging branch has advanced"
else
  fail "retries when staging branch has advanced" "exit 0" "exit 1"
fi

# =============================================================================
# Test: handle_resolution_success — cleans up state
# =============================================================================
echo ""
echo "handle_resolution_success:"

git() {
  case "$*" in
    *"rev-parse"*) echo "someSHA" ;;
    *) command git "$@" ;;
  esac
}

: > "$TEST_DIR/gh-calls.log"
handle_resolution_success 42

assert_file_not_exists "clears state file on success" "$state_file"
assert_file_contains "gh pr comment called on success" "$TEST_DIR/gh-calls.log" "commented on PR"

# =============================================================================
# Test: is_mechanical_conflict
# =============================================================================
CONFLICT_WORKTREE_DIR="$TEST_DIR/mock-worktree"
mkdir -p "$CONFLICT_WORKTREE_DIR"

echo ""
echo "is_mechanical_conflict:"

# Only lockfiles
git() {
  case "$*" in
    *"diff --name-only --diff-filter=U"*)
      echo "package-lock.json"
      ;;
    *) command git "$@" ;;
  esac
}

if is_mechanical_conflict "$CONFLICT_WORKTREE_DIR"; then
  pass "returns 0 (mechanical) when only package-lock.json conflicted"
else
  fail "returns 0 (mechanical) when only package-lock.json conflicted" "exit 0" "exit 1"
fi

# Mixed: lockfile + source
git() {
  case "$*" in
    *"diff --name-only --diff-filter=U"*)
      echo "package-lock.json"
      echo "src/lib/api.ts"
      ;;
    *) command git "$@" ;;
  esac
}

if is_mechanical_conflict "$CONFLICT_WORKTREE_DIR"; then
  fail "returns 1 (not mechanical) when source files also conflicted" "exit 1" "exit 0"
else
  pass "returns 1 (not mechanical) when source files also conflicted"
fi

# =============================================================================
# Test: cleanup_conflict_worktree
# =============================================================================
echo ""
echo "cleanup_conflict_worktree:"

MOCK_WORKTREE="$TEST_DIR/.claude/worktrees/conflict-pr-55"
mkdir -p "$MOCK_WORKTREE"

git() {
  case "$*" in
    *"worktree remove"*)
      local remove_path=""
      for arg in "$@"; do
        case "$arg" in
          worktree|remove|--force) continue ;;
          *) remove_path="$arg" ;;
        esac
      done
      rm -rf "$remove_path" 2>/dev/null || true
      ;;
    *) command git "$@" ;;
  esac
}

CONFLICT_RESOLVER_REPO_ROOT="$TEST_DIR"
cleanup_conflict_worktree 55
if [ ! -d "$MOCK_WORKTREE" ]; then
  pass "cleanup_conflict_worktree removes worktree directory"
else
  fail "cleanup_conflict_worktree removes worktree directory" "directory removed" "directory still exists"
fi

# =============================================================================
# Test: cleanup_stale_conflict_worktrees
# =============================================================================
echo ""
echo "cleanup_stale_conflict_worktrees:"

mkdir -p "$TEST_DIR/.claude/worktrees/conflict-pr-10"
mkdir -p "$TEST_DIR/.claude/worktrees/conflict-pr-20"
mkdir -p "$TEST_DIR/.claude/worktrees/some-other-worktree"

git() {
  case "$*" in
    *"worktree remove"*)
      local remove_path=""
      for arg in "$@"; do
        case "$arg" in
          worktree|remove|--force) continue ;;
          *) remove_path="$arg" ;;
        esac
      done
      rm -rf "$remove_path" 2>/dev/null || true
      ;;
    *) command git "$@" ;;
  esac
}

cleanup_stale_conflict_worktrees

if [ ! -d "$TEST_DIR/.claude/worktrees/conflict-pr-10" ] && [ ! -d "$TEST_DIR/.claude/worktrees/conflict-pr-20" ]; then
  pass "cleanup_stale removes all conflict-pr-* worktrees"
else
  fail "cleanup_stale removes all conflict-pr-* worktrees" "both removed" "some remain"
fi

if [ -d "$TEST_DIR/.claude/worktrees/some-other-worktree" ]; then
  pass "cleanup_stale preserves non-conflict worktrees"
else
  fail "cleanup_stale preserves non-conflict worktrees" "preserved" "removed"
fi
unset CONFLICT_RESOLVER_REPO_ROOT

# =============================================================================
# Test: detect_conflicting_prs — filters correctly
# =============================================================================
echo ""
echo "detect_conflicting_prs:"

gh() {
  case "$*" in
    *"pr list"*)
      cat <<'MOCK_JSON'
[
  {"number":100,"title":"feat: something","headRefName":"issue-100-feat","baseRefName":"main","mergeable":"CONFLICTING"},
  {"number":101,"title":"fix: other","headRefName":"issue-101-fix","baseRefName":"main","mergeable":"MERGEABLE"},
  {"number":102,"title":"feat: third","headRefName":"issue-102-third","baseRefName":"main","mergeable":"CONFLICTING"},
  {"number":200,"title":"manual PR","headRefName":"manual-branch","baseRefName":"main","mergeable":"CONFLICTING"},
  {"number":103,"title":"feat: unknown merge","headRefName":"issue-103-unknown","baseRefName":"main","mergeable":"UNKNOWN"}
]
MOCK_JSON
      ;;
    *)
      echo "mock: gh $*" >> "$TEST_DIR/gh-calls.log"
      ;;
  esac
}
export -f gh

result=$(detect_conflicting_prs)

count=$(echo "$result" | jq 'length')
assert_eq "detect_conflicting_prs returns 2 PRs" "2" "$count"

first_num=$(echo "$result" | jq '.[0].number')
assert_eq "first PR is #100" "100" "$first_num"

second_num=$(echo "$result" | jq '.[1].number')
assert_eq "second PR is #102" "102" "$second_num"

non_issue=$(echo "$result" | jq '[.[] | select(.headRefName | startswith("issue-") | not)] | length')
assert_eq "no non-issue branches in results" "0" "$non_issue"

# =============================================================================
# Test: select_conflict_candidate — iterates all candidates
# =============================================================================
echo ""
echo "select_conflict_candidate:"

rm -f "$LOG_DIR/conflict-state/"*.state 2>/dev/null || true

# Mock should_retry: only PR 789 is retryable
should_retry() {
  local pr="$1"
  if [ "$pr" = "789" ]; then
    return 0
  fi
  return 1
}

three_prs='[
  {"number": 815, "headRefName": "issue-815-feat-a", "baseRefName": "main", "mergeable": "CONFLICTING"},
  {"number": 816, "headRefName": "issue-816-feat-b", "baseRefName": "main", "mergeable": "CONFLICTING"},
  {"number": 789, "headRefName": "issue-789-feat-c", "baseRefName": "main", "mergeable": "CONFLICTING"}
]'

conflict_pr=""
conflict_branch=""
conflict_base=""
select_conflict_candidate "$three_prs"
assert_eq "selects third candidate when first two non-retryable" "789" "$conflict_pr"
assert_eq "sets branch for selected candidate" "issue-789-feat-c" "$conflict_branch"
assert_eq "sets base for selected candidate" "main" "$conflict_base"

# All candidates non-retryable => empty
should_retry() {
  return 1
}

conflict_pr=""
conflict_branch=""
conflict_base=""
result=0
select_conflict_candidate "$three_prs" || result=$?
assert_eq "returns empty when all non-retryable" "" "$conflict_pr"
assert_eq "returns 1 when no candidate found" "1" "$result"

# Empty array => returns 1
conflict_pr=""
result=0
select_conflict_candidate "[]" || result=$?
assert_eq "returns 1 for empty array" "1" "$result"
assert_eq "conflict_pr empty for empty array" "" "$conflict_pr"

# Null baseRefName defaults to main
should_retry() {
  return 0
}
null_base_pr='[{"number": 100, "headRefName": "issue-100-test", "baseRefName": null, "mergeable": "CONFLICTING"}]'
conflict_pr=""
conflict_branch=""
conflict_base=""
select_conflict_candidate "$null_base_pr"
assert_eq "null baseRefName defaults to main" "main" "$conflict_base"
assert_eq "selects PR with null base" "100" "$conflict_pr"

# Restore should_retry to real implementation
source "$REPO_ROOT/scripts/lib/conflict-resolver.sh"

# =============================================================================
# Test: Input validation
# =============================================================================
echo ""
echo "Input validation:"

if _validate_pr_number "123" 2>/dev/null; then
  pass "valid PR number accepted"
else
  fail "valid PR number accepted" "exit 0" "exit 1"
fi

if _validate_pr_number "not-a-number" 2>/dev/null; then
  fail "invalid PR number rejected" "exit 1" "exit 0"
else
  pass "invalid PR number rejected"
fi

if _validate_branch_name "issue-100-feat/test" 2>/dev/null; then
  pass "valid branch name accepted"
else
  fail "valid branch name accepted" "exit 0" "exit 1"
fi

if _validate_branch_name "branch; rm -rf /" 2>/dev/null; then
  fail "branch name with shell injection rejected" "exit 1" "exit 0"
else
  pass "branch name with shell injection rejected"
fi

# =============================================================================
# Test: Shellcheck
# =============================================================================
echo ""
echo "Shellcheck:"
if shellcheck -x "$REPO_ROOT/scripts/lib/conflict-resolver.sh" 2>/dev/null; then
  pass "shellcheck passes on conflict-resolver.sh"
else
  fail "shellcheck passes on conflict-resolver.sh" "no warnings" "warnings found"
fi

# --- Cleanup ------------------------------------------------------------------
rm -rf "$TEST_DIR"

# Unexport mocks
unset -f gh 2>/dev/null || true
unset -f git 2>/dev/null || true

# --- Summary ------------------------------------------------------------------
echo ""
echo "=== Results ==="
echo "  ${TESTS_PASSED}/${TESTS_RUN} passed, ${TESTS_FAILED} failed"
echo ""

if [ "$TESTS_FAILED" -gt 0 ]; then
  exit 1
fi
