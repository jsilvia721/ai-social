#!/usr/bin/env bash
# issue-daemon-rate-limit-halt.test.sh — Tests for global rate limit halt
# (kill_all_active_workers_for_rate_limit) and mid-cycle is_rate_limit_paused checks.
#
# Run: bash scripts/__tests__/issue-daemon-rate-limit-halt.test.sh

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

# --- Setup temp dirs ----------------------------------------------------------
TEST_STATE_DIR=$(mktemp -d)
TEST_LOG_DIR=$(mktemp -d)
TEST_PID_FILE="$TEST_LOG_DIR/.active_pids"
PID_FILE="$TEST_PID_FILE"
export DAEMON_STATE_DIR="$TEST_STATE_DIR"
export LOG_DIR="$TEST_LOG_DIR"
export WORKER_PID_FILE="$TEST_PID_FILE"

# Track mock calls
MOCK_CALLS_FILE="$TEST_LOG_DIR/.mock_calls"
: > "$MOCK_CALLS_FILE"

# Source the state library
# shellcheck source=scripts/lib/daemon-state.sh
source "$REPO_ROOT/scripts/lib/daemon-state.sh"
ensure_state_dir

# Set up required variables
RATE_LIMIT_PAUSE_SECONDS=900
CIRCUIT_BREAKER_FILE="$TEST_LOG_DIR/.failure_times"
CIRCUIT_BREAKER_WINDOW=60
CIRCUIT_BREAKER_THRESHOLD=3
TMUX_ENABLED="false"
LABEL_WIP="claude-wip"
LABEL_INTERRUPTED="claude-interrupted"

# Source rate limit helpers
# shellcheck source=scripts/lib/rate-limit-helpers.sh
source "$REPO_ROOT/scripts/lib/rate-limit-helpers.sh"

# --- Mock functions -----------------------------------------------------------
# Mock external commands to avoid side effects

log() {
  echo "[test] $*" >> "$TEST_LOG_DIR/test-debug.log"
}

# Mock gh — record calls but don't actually do anything
gh() {
  echo "gh $*" >> "$MOCK_CALLS_FILE"
}

# Mock kill_process_group — record but don't kill anything
kill_process_group() {
  echo "kill_process_group $1" >> "$MOCK_CALLS_FILE"
}

# Mock kill_worker_tmux_session — record
kill_worker_tmux_session() {
  echo "kill_worker_tmux_session $1" >> "$MOCK_CALLS_FILE"
}

# Mock commit_wip_if_needed — record
commit_wip_if_needed() {
  echo "commit_wip_if_needed $1" >> "$MOCK_CALLS_FILE"
}

# Mock find_issue_worktree — not needed for these tests
find_issue_worktree() {
  echo ""
}

# Source the function under test
# We extract just kill_all_active_workers_for_rate_limit from the daemon script
# by sourcing a helper that defines it.

# Instead of sourcing the whole daemon (which has side effects), define the
# function inline. We'll verify it matches the actual implementation by
# also running integration-style checks.

# Source just the function definition from the daemon script.
# We use a subshell-safe extraction approach.
eval "$(sed -n '/^kill_all_active_workers_for_rate_limit()/,/^}/p' "$REPO_ROOT/scripts/issue-daemon.sh")"

echo ""
echo "=== Global Rate Limit Halt Tests ==="

# --- kill_all_active_workers_for_rate_limit tests -----------------------------
echo ""
echo "kill_all_active_workers_for_rate_limit:"

# Test: empty PID file — no crashes
: > "$TEST_PID_FILE"
: > "$MOCK_CALLS_FILE"
kill_all_active_workers_for_rate_limit "100"
calls=$(cat "$MOCK_CALLS_FILE")
assert_eq "empty PID file — no calls made" "" "$calls"

# Test: single worker entry that IS the triggering issue — skipped
: > "$TEST_PID_FILE"
: > "$MOCK_CALLS_FILE"
# Create a real process to check kill -0 against
sleep 30 &
test_pid=$!
echo "${test_pid}:100:$(date +%s):worker" > "$TEST_PID_FILE"
kill_all_active_workers_for_rate_limit "100"
# Should NOT have called kill_process_group for the triggering issue
if grep -q "kill_process_group" "$MOCK_CALLS_FILE"; then
  fail "skips triggering issue's worker" "no kill_process_group" "$(grep kill_process_group "$MOCK_CALLS_FILE")"
else
  pass "skips triggering issue's worker"
fi
kill "$test_pid" 2>/dev/null || true
wait "$test_pid" 2>/dev/null || true

# Test: multiple workers — kills non-triggering, skips triggering
: > "$TEST_PID_FILE"
: > "$MOCK_CALLS_FILE"
# Create real processes
sleep 30 &
pid_trigger=$!
sleep 30 &
pid_other1=$!
sleep 30 &
pid_other2=$!
echo "${pid_trigger}:100:$(date +%s):worker" > "$TEST_PID_FILE"
echo "${pid_other1}:200:$(date +%s):worker" >> "$TEST_PID_FILE"
echo "${pid_other2}:300:$(date +%s):plan" >> "$TEST_PID_FILE"
kill_all_active_workers_for_rate_limit "100"

# Should have called commit_wip_if_needed for 200 and 300
if grep -q "commit_wip_if_needed 200" "$MOCK_CALLS_FILE"; then
  pass "calls commit_wip_if_needed for worker #200"
else
  fail "calls commit_wip_if_needed for worker #200" "commit_wip_if_needed 200" "$(cat "$MOCK_CALLS_FILE")"
fi
if grep -q "commit_wip_if_needed 300" "$MOCK_CALLS_FILE"; then
  pass "calls commit_wip_if_needed for worker #300"
else
  fail "calls commit_wip_if_needed for worker #300" "commit_wip_if_needed 300" "$(cat "$MOCK_CALLS_FILE")"
fi

# Should have called kill_process_group for other workers
if grep -q "kill_process_group ${pid_other1}" "$MOCK_CALLS_FILE"; then
  pass "calls kill_process_group for worker #200"
else
  fail "calls kill_process_group for worker #200" "kill_process_group ${pid_other1}" "$(cat "$MOCK_CALLS_FILE")"
fi
if grep -q "kill_process_group ${pid_other2}" "$MOCK_CALLS_FILE"; then
  pass "calls kill_process_group for worker #300"
else
  fail "calls kill_process_group for worker #300" "kill_process_group ${pid_other2}" "$(cat "$MOCK_CALLS_FILE")"
fi

# Should NOT have killed the triggering issue
if grep -q "kill_process_group ${pid_trigger}" "$MOCK_CALLS_FILE"; then
  fail "does not kill triggering issue" "no kill for pid ${pid_trigger}" "kill_process_group ${pid_trigger}"
else
  pass "does not kill triggering issue"
fi

# Should have called kill_worker_tmux_session for killed workers
if grep -q "kill_worker_tmux_session 200" "$MOCK_CALLS_FILE"; then
  pass "calls kill_worker_tmux_session for worker #200"
else
  fail "calls kill_worker_tmux_session for worker #200" "kill_worker_tmux_session 200" "$(cat "$MOCK_CALLS_FILE")"
fi

# Should have transitioned labels (gh issue edit)
if grep -q "gh issue edit 200 --remove-label claude-wip --add-label claude-interrupted" "$MOCK_CALLS_FILE"; then
  pass "transitions labels for worker #200"
else
  fail "transitions labels for worker #200" "gh issue edit 200 ..." "$(grep 'gh issue edit' "$MOCK_CALLS_FILE" || echo 'no match')"
fi

# Should have commented on the issue
if grep -q "gh issue comment 200" "$MOCK_CALLS_FILE"; then
  pass "comments on issue #200"
else
  fail "comments on issue #200" "gh issue comment 200" "$(grep 'gh issue comment' "$MOCK_CALLS_FILE" || echo 'no match')"
fi

# Should have cleaned up heartbeat and stale files
# (these are rm -f calls, checked by verifying files don't exist after)
# Create test heartbeat/stale files
touch "$TEST_LOG_DIR/heartbeat-200" "$TEST_LOG_DIR/.stale-notified-${pid_other1}"
touch "$TEST_LOG_DIR/heartbeat-300" "$TEST_LOG_DIR/.stale-notified-${pid_other2}"
# Re-run with fresh mock calls
: > "$MOCK_CALLS_FILE"
: > "$TEST_PID_FILE"
sleep 30 &
pid_trigger2=$!
sleep 30 &
pid_other3=$!
echo "${pid_trigger2}:100:$(date +%s):worker" > "$TEST_PID_FILE"
echo "${pid_other3}:200:$(date +%s):worker" >> "$TEST_PID_FILE"
kill_all_active_workers_for_rate_limit "100"
if [ ! -f "$TEST_LOG_DIR/heartbeat-200" ]; then
  pass "removes heartbeat file for killed worker"
else
  fail "removes heartbeat file for killed worker" "file removed" "file exists"
fi

# Clean up background processes
kill "$pid_trigger" "$pid_other1" "$pid_other2" "$pid_trigger2" "$pid_other3" 2>/dev/null || true
wait 2>/dev/null || true

# Test: dead worker entry — skipped (kill -0 fails)
: > "$TEST_PID_FILE"
: > "$MOCK_CALLS_FILE"
# Use a PID that doesn't exist
echo "99999:200:$(date +%s):worker" > "$TEST_PID_FILE"
kill_all_active_workers_for_rate_limit "100"
if grep -q "kill_process_group" "$MOCK_CALLS_FILE"; then
  fail "skips dead workers" "no kill_process_group" "$(grep kill_process_group "$MOCK_CALLS_FILE")"
else
  pass "skips dead workers"
fi

# --- Function exists in daemon script -----------------------------------------
echo ""
echo "Integration checks:"

if grep -q "^kill_all_active_workers_for_rate_limit()" "$REPO_ROOT/scripts/issue-daemon.sh"; then
  pass "kill_all_active_workers_for_rate_limit defined in issue-daemon.sh"
else
  fail "kill_all_active_workers_for_rate_limit defined in issue-daemon.sh" "function exists" "not found"
fi

# Check it's called from handle_rate_limit_exit
if grep -q "kill_all_active_workers_for_rate_limit" "$REPO_ROOT/scripts/issue-daemon.sh" | grep -v "^kill_all_active_workers_for_rate_limit()"; then
  pass "kill_all_active_workers_for_rate_limit called from handle_rate_limit_exit"
else
  # More robust check — look for the call within handle_rate_limit_exit function body
  if sed -n '/^handle_rate_limit_exit/,/^}/p' "$REPO_ROOT/scripts/issue-daemon.sh" | grep -q "kill_all_active_workers_for_rate_limit"; then
    pass "kill_all_active_workers_for_rate_limit called from handle_rate_limit_exit"
  else
    fail "kill_all_active_workers_for_rate_limit called from handle_rate_limit_exit" "call exists" "not found"
  fi
fi

# Check is_rate_limit_paused appears between priority tiers
tier_checks=$(grep -c "is_rate_limit_paused" "$REPO_ROOT/scripts/issue-daemon.sh" || true)
if [ "$tier_checks" -ge 3 ]; then
  pass "is_rate_limit_paused checked multiple times in main loop ($tier_checks occurrences)"
else
  fail "is_rate_limit_paused checked multiple times in main loop" "≥3" "$tier_checks"
fi

# --- Cleanup ------------------------------------------------------------------
rm -rf "$TEST_STATE_DIR" "$TEST_LOG_DIR"

# --- Summary ------------------------------------------------------------------
echo ""
echo "=== Results ==="
echo "  ${TESTS_PASSED}/${TESTS_RUN} passed, ${TESTS_FAILED} failed"
echo ""

if [ "$TESTS_FAILED" -gt 0 ]; then
  exit 1
fi
