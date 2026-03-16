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

# Mock gh commands — no export -f needed since library is sourced into same shell
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

# Mock git for main SHA
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
assert_file_contains "state file has main_sha_at_failure" "$state_file" "^main_sha_at_failure=abc123def456$"
assert_file_contains "state file has last_attempt_epoch" "$state_file" "^last_attempt_epoch=[0-9]+$"

# gh was called to comment and add label
assert_file_contains "gh pr comment was called" "$TEST_DIR/gh-calls.log" "commented on PR"
assert_file_contains "gh pr edit was called" "$TEST_DIR/gh-calls.log" "edited PR"

# =============================================================================
# Test: should_retry — with state file, same main SHA
# =============================================================================
echo ""
echo "should_retry — same main SHA:"

# attempt_count < 3 but main hasn't advanced => should NOT retry
if should_retry 42; then
  fail "returns 1 when main SHA unchanged" "exit 1" "exit 0"
else
  pass "returns 1 when main SHA unchanged"
fi

# =============================================================================
# Test: should_retry — different main SHA
# =============================================================================
echo ""
echo "should_retry — different main SHA:"

# Override git to return a different SHA
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
  pass "returns 0 when main SHA has advanced"
else
  fail "returns 0 when main SHA has advanced" "exit 0" "exit 1"
fi

# =============================================================================
# Test: handle_resolution_failure — increments attempt count
# =============================================================================
echo ""
echo "handle_resolution_failure — increment:"

handle_resolution_failure 42 "second failure"
assert_file_contains "state file has attempt_count=2" "$state_file" "^attempt_count=2$"
assert_file_contains "state file updated main_sha" "$state_file" "^main_sha_at_failure=new789sha000$"

# =============================================================================
# Test: should_retry — max attempts reached
# =============================================================================
echo ""
echo "should_retry — max attempts:"

handle_resolution_failure 42 "third failure"
assert_file_contains "state file has attempt_count=3" "$state_file" "^attempt_count=3$"

# Even with different main SHA, 3 attempts => no retry
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
# Test: handle_resolution_success — cleans up state
# =============================================================================
echo ""
echo "handle_resolution_success:"

# Reset git mock
git() {
  case "$*" in
    *"rev-parse"*) echo "someSHA" ;;
    *"log"*) echo "abc1234 feat: some commit" ;;
    *) command git "$@" ;;
  esac
}

: > "$TEST_DIR/gh-calls.log"
handle_resolution_success 42

assert_file_not_exists "clears state file on success" "$state_file"
assert_file_contains "gh pr comment called on success" "$TEST_DIR/gh-calls.log" "commented on PR"

# =============================================================================
# Test: is_excluded_conflict
# =============================================================================
echo ""
echo "is_excluded_conflict:"

# Mock git diff to return excluded files
git() {
  case "$*" in
    *"diff --name-only --diff-filter=U"*)
      echo "prisma/migrations/20240101_init/migration.sql"
      echo "src/lib/db.ts"
      ;;
    *) command git "$@" ;;
  esac
}

CONFLICT_WORKTREE_DIR="$TEST_DIR/mock-worktree"
mkdir -p "$CONFLICT_WORKTREE_DIR"

if is_excluded_conflict 100 "$CONFLICT_WORKTREE_DIR"; then
  pass "returns 0 (excluded) when prisma/migrations/ file conflicted"
else
  fail "returns 0 (excluded) when prisma/migrations/ file conflicted" "exit 0" "exit 1"
fi

# sst.config.ts
git() {
  case "$*" in
    *"diff --name-only --diff-filter=U"*)
      echo "sst.config.ts"
      ;;
    *) command git "$@" ;;
  esac
}

if is_excluded_conflict 101 "$CONFLICT_WORKTREE_DIR"; then
  pass "returns 0 (excluded) when sst.config.ts conflicted"
else
  fail "returns 0 (excluded) when sst.config.ts conflicted" "exit 0" "exit 1"
fi

# Non-excluded files only
git() {
  case "$*" in
    *"diff --name-only --diff-filter=U"*)
      echo "src/lib/api.ts"
      echo "src/components/Button.tsx"
      ;;
    *) command git "$@" ;;
  esac
}

if is_excluded_conflict 102 "$CONFLICT_WORKTREE_DIR"; then
  fail "returns 1 (not excluded) for source files" "exit 1" "exit 0"
else
  pass "returns 1 (not excluded) for source files"
fi

# =============================================================================
# Test: is_mechanical_conflict
# =============================================================================
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

# Create a mock worktree directory
MOCK_WORKTREE="$TEST_DIR/.claude/worktrees/conflict-pr-55"
mkdir -p "$MOCK_WORKTREE"

# Mock git worktree remove to just delete the directory
git() {
  case "$*" in
    *"worktree remove"*)
      # Find the path argument (last non-flag arg before --force)
      local remove_path=""
      local skip_next=false
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

# Override REPO_ROOT for this test
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

# Create multiple mock worktrees
mkdir -p "$TEST_DIR/.claude/worktrees/conflict-pr-10"
mkdir -p "$TEST_DIR/.claude/worktrees/conflict-pr-20"
mkdir -p "$TEST_DIR/.claude/worktrees/some-other-worktree"

# Mock git worktree remove
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

# detect_conflicting_prs calls gh in subshells ($(...)), so we need export -f
gh() {
  case "$*" in
    *"pr list"*)
      cat <<'MOCK_JSON'
[
  {"number":100,"title":"feat: something","headRefName":"issue-100-feat","mergeable":"CONFLICTING"},
  {"number":101,"title":"fix: other","headRefName":"issue-101-fix","mergeable":"MERGEABLE"},
  {"number":102,"title":"feat: third","headRefName":"issue-102-third","mergeable":"CONFLICTING"},
  {"number":200,"title":"manual PR","headRefName":"manual-branch","mergeable":"CONFLICTING"},
  {"number":103,"title":"feat: unknown merge","headRefName":"issue-103-unknown","mergeable":"UNKNOWN"}
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

# Should include issue-100 and issue-102 (CONFLICTING + issue-* branch)
# Should exclude issue-101 (MERGEABLE), manual-200 (not issue-* branch), issue-103 (UNKNOWN)
count=$(echo "$result" | jq 'length')
assert_eq "detect_conflicting_prs returns 2 PRs" "2" "$count"

first_num=$(echo "$result" | jq '.[0].number')
assert_eq "first PR is #100" "100" "$first_num"

second_num=$(echo "$result" | jq '.[1].number')
assert_eq "second PR is #102" "102" "$second_num"

# No non-issue branches
non_issue=$(echo "$result" | jq '[.[] | select(.headRefName | startswith("issue-") | not)] | length')
assert_eq "no non-issue branches in results" "0" "$non_issue"

# =============================================================================
# Test: conflict_log helper
# =============================================================================
echo ""
echo "conflict_log:"

conflict_log 77 "test log message"
log_file="$LOG_DIR/conflict-pr-77.log"
assert_file_exists "creates per-PR log file" "$log_file"
assert_file_contains "log file contains message" "$log_file" "test log message"

# =============================================================================
# Test: acquire_conflict_ack — first call succeeds
# =============================================================================
echo ""
echo "acquire_conflict_ack:"

# Reset mocks — use simple git mock
git() {
  case "$*" in
    *) command git "$@" ;;
  esac
}

if acquire_conflict_ack 200; then
  pass "first acquire succeeds"
else
  fail "first acquire succeeds" "exit 0" "exit 1"
fi

ack_file="$LOG_DIR/conflict-state/pr-200.ack"
assert_file_exists "creates ACK file" "$ack_file"
assert_file_contains "ACK file contains pid" "$ack_file" "^pid="
assert_file_contains "ACK file contains ts" "$ack_file" "^ts="
assert_file_contains "ACK file contains pr=200" "$ack_file" "^pr=200$"

# =============================================================================
# Test: acquire_conflict_ack — second call fails (already locked)
# =============================================================================
echo ""
echo "acquire_conflict_ack — already locked:"

if acquire_conflict_ack 200; then
  fail "second acquire fails" "exit 1" "exit 0"
else
  pass "second acquire fails (already locked by live PID)"
fi

# =============================================================================
# Test: release_conflict_ack — releases lock, allows re-acquire
# =============================================================================
echo ""
echo "release_conflict_ack:"

release_conflict_ack 200
assert_file_not_exists "ACK file removed after release" "$ack_file"

if acquire_conflict_ack 200; then
  pass "re-acquire succeeds after release"
else
  fail "re-acquire succeeds after release" "exit 0" "exit 1"
fi

# Clean up for next tests
release_conflict_ack 200

# =============================================================================
# Test: acquire_conflict_ack — stale ACK (dead PID) is cleaned up
# =============================================================================
echo ""
echo "acquire_conflict_ack — stale ACK (dead PID):"

# Write a fake ACK with a PID that doesn't exist (99999999)
ensure_conflict_state_dir
cat > "$LOG_DIR/conflict-state/pr-201.ack" <<STALE_ACK
pid=99999999
ts=$(date +%s)
pr=201
STALE_ACK

if acquire_conflict_ack 201; then
  pass "acquire succeeds when existing ACK has dead PID"
else
  fail "acquire succeeds when existing ACK has dead PID" "exit 0" "exit 1"
fi

release_conflict_ack 201

# =============================================================================
# Test: acquire_conflict_ack — ACK past TTL is treated as stale
# =============================================================================
echo ""
echo "acquire_conflict_ack — expired TTL:"

# Write ACK with a very old timestamp (TTL is 4500s, use ts from 5000s ago)
old_ts=$(( $(date +%s) - 5000 ))
cat > "$LOG_DIR/conflict-state/pr-202.ack" <<EXPIRED_ACK
pid=$$
ts=${old_ts}
pr=202
EXPIRED_ACK

if acquire_conflict_ack 202; then
  pass "acquire succeeds when existing ACK is past TTL"
else
  fail "acquire succeeds when existing ACK is past TTL" "exit 0" "exit 1"
fi

release_conflict_ack 202

# =============================================================================
# Test: acquire_conflict_ack — live PID within TTL blocks acquisition
# =============================================================================
echo ""
echo "acquire_conflict_ack — live PID within TTL blocks:"

# Write ACK with current PID and recent timestamp
cat > "$LOG_DIR/conflict-state/pr-203.ack" <<LIVE_ACK
pid=$$
ts=$(date +%s)
pr=203
LIVE_ACK

if acquire_conflict_ack 203; then
  fail "acquire blocked by live PID within TTL" "exit 1" "exit 0"
else
  pass "acquire blocked by live PID within TTL"
fi

release_conflict_ack 203

# =============================================================================
# Test: cleanup_stale_ack_files — removes stale, keeps live
# =============================================================================
echo ""
echo "cleanup_stale_ack_files:"

ensure_conflict_state_dir

# Create a stale ACK (dead PID)
cat > "$LOG_DIR/conflict-state/pr-300.ack" <<DEAD_ACK
pid=99999999
ts=$(date +%s)
pr=300
DEAD_ACK

# Create a live ACK (current PID, recent ts)
cat > "$LOG_DIR/conflict-state/pr-301.ack" <<LIVE_ACK2
pid=$$
ts=$(date +%s)
pr=301
LIVE_ACK2

cleanup_stale_ack_files

assert_file_not_exists "stale ACK (dead PID) removed by cleanup" "$LOG_DIR/conflict-state/pr-300.ack"
assert_file_exists "live ACK preserved by cleanup" "$LOG_DIR/conflict-state/pr-301.ack"

# Clean up
rm -f "$LOG_DIR/conflict-state/pr-301.ack"

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
