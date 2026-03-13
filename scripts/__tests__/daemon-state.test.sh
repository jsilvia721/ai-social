#!/usr/bin/env bash
# daemon-state.test.sh — Unit tests for scripts/lib/daemon-state.sh
#
# Run: bash scripts/__tests__/daemon-state.test.sh

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

assert_not_empty() {
  local description="$1"
  local value="$2"
  if [ -n "$value" ]; then
    pass "$description"
  else
    fail "$description" "non-empty string" "(empty)"
  fi
}

# --- Source the daemon-state lib with a temp state dir ------------------------
echo ""
echo "=== Daemon State Library Tests ==="
echo ""

TEST_STATE_DIR=$(mktemp -d)
export DAEMON_STATE_DIR="$TEST_STATE_DIR"

# shellcheck source=scripts/lib/daemon-state.sh
source "$REPO_ROOT/scripts/lib/daemon-state.sh"

# --- Test ensure_state_dir ---------------------------------------------------
echo "ensure_state_dir:"

# Clean up first to test creation
rm -rf "$TEST_STATE_DIR"
ensure_state_dir
if [ -d "$TEST_STATE_DIR" ]; then
  pass "creates directory when missing"
else
  fail "creates directory when missing" "directory exists" "directory missing"
fi

# Idempotent — doesn't error on existing dir
ensure_state_dir
pass "idempotent on existing directory"

# --- Test rate limit pause lifecycle -----------------------------------------
echo ""
echo "Rate limit pause lifecycle:"

# Initially not paused
if is_rate_limit_paused; then
  fail "initially not paused" "not paused" "paused"
else
  pass "initially not paused"
fi

# Set pause
set_rate_limit_pause
if is_rate_limit_paused; then
  pass "paused after set_rate_limit_pause"
else
  fail "paused after set_rate_limit_pause" "paused" "not paused"
fi

# pause-until contains future epoch
pause_epoch=$(cat "$TEST_STATE_DIR/pause-until")
now_epoch=$(date +%s)
if [ "$pause_epoch" -gt "$now_epoch" ]; then
  pass "pause-until contains future epoch"
else
  fail "pause-until contains future epoch" "> $now_epoch" "$pause_epoch"
fi

# Default duration is ~900 seconds (check it's within 890-910 range)
expected_min=$((now_epoch + 890))
expected_max=$((now_epoch + 910))
if [ "$pause_epoch" -ge "$expected_min" ] && [ "$pause_epoch" -le "$expected_max" ]; then
  pass "default duration is ~900 seconds"
else
  fail "default duration is ~900 seconds" "between $expected_min and $expected_max" "$pause_epoch"
fi

# Clear pause
clear_rate_limit_pause
if is_rate_limit_paused; then
  fail "not paused after clear" "not paused" "paused"
else
  pass "not paused after clear"
fi

# --- Test auto-expiry --------------------------------------------------------
echo ""
echo "Auto-expiry:"

set_rate_limit_pause
# Overwrite pause-until with past epoch
echo "$((now_epoch - 60))" > "$TEST_STATE_DIR/pause-until"

if is_rate_limit_paused; then
  fail "expired pause auto-clears" "not paused" "still paused"
else
  pass "expired pause auto-clears"
fi

# File should be cleaned up by auto-expiry
if [ ! -f "$TEST_STATE_DIR/pause-until" ]; then
  pass "pause-until file cleaned up on expiry"
else
  fail "pause-until file cleaned up on expiry" "file missing" "file exists"
fi

# --- Test get_pause_until_display --------------------------------------------
echo ""
echo "get_pause_until_display:"

# When not set
result=$(get_pause_until_display)
assert_eq "returns 'unknown' when not set" "unknown" "$result"

# When set
set_rate_limit_pause
result=$(get_pause_until_display)
assert_not_empty "returns non-empty when set" "$result"
if [ "$result" != "unknown" ]; then
  pass "returns time string (not 'unknown') when set"
else
  fail "returns time string (not 'unknown') when set" "HH:MM:SS" "unknown"
fi
clear_rate_limit_pause

# --- Test custom duration ----------------------------------------------------
echo ""
echo "Custom duration:"

set_rate_limit_pause 60
custom_epoch=$(cat "$TEST_STATE_DIR/pause-until")
custom_min=$((now_epoch + 50))
custom_max=$((now_epoch + 70))
if [ "$custom_epoch" -ge "$custom_min" ] && [ "$custom_epoch" -le "$custom_max" ]; then
  pass "custom duration of 60 seconds works"
else
  fail "custom duration of 60 seconds works" "between $custom_min and $custom_max" "$custom_epoch"
fi
clear_rate_limit_pause

# --- Test drain mode lifecycle -----------------------------------------------
echo ""
echo "Drain mode lifecycle:"

# Initially not draining
if is_drain_mode; then
  fail "initially not draining" "not draining" "draining"
else
  pass "initially not draining"
fi

# Set drain
set_drain_mode
if is_drain_mode; then
  pass "draining after set_drain_mode"
else
  fail "draining after set_drain_mode" "draining" "not draining"
fi

# Drain file exists
if [ -f "$TEST_STATE_DIR/drain" ]; then
  pass "drain file exists after set"
else
  fail "drain file exists after set" "file exists" "file missing"
fi

# Clear drain
clear_drain_mode
if is_drain_mode; then
  fail "not draining after clear" "not draining" "draining"
else
  pass "not draining after clear"
fi

# Drain file removed
if [ ! -f "$TEST_STATE_DIR/drain" ]; then
  pass "drain file removed after clear"
else
  fail "drain file removed after clear" "file missing" "file exists"
fi

# --- Test idempotency --------------------------------------------------------
echo ""
echo "Idempotency:"

# Double set doesn't error
set_rate_limit_pause
set_rate_limit_pause
pass "double set_rate_limit_pause doesn't error"
clear_rate_limit_pause

# Double clear doesn't error
clear_rate_limit_pause
clear_rate_limit_pause
pass "double clear_rate_limit_pause doesn't error"

set_drain_mode
set_drain_mode
pass "double set_drain_mode doesn't error"
clear_drain_mode

clear_drain_mode
clear_drain_mode
pass "double clear_drain_mode doesn't error"

# --- Test worker tracking (PID metadata) --------------------------------------
echo ""
echo "Worker tracking — record_worker:"

# Set up a temp PID file for worker tracking tests
TEST_LOG_DIR=$(mktemp -d)
export WORKER_PID_FILE="$TEST_LOG_DIR/.active_pids"
: > "$WORKER_PID_FILE"

# record_worker creates entry with PID:ISSUE:START_EPOCH:TYPE format
record_worker "12345" "42" "worker"
line=$(cat "$WORKER_PID_FILE")
pid_field=$(echo "$line" | cut -d: -f1)
issue_field=$(echo "$line" | cut -d: -f2)
epoch_field=$(echo "$line" | cut -d: -f3)
type_field=$(echo "$line" | cut -d: -f4)
assert_eq "record_worker PID field" "12345" "$pid_field"
assert_eq "record_worker issue field" "42" "$issue_field"
assert_not_empty "record_worker epoch field" "$epoch_field"
assert_eq "record_worker type field" "worker" "$type_field"

# Epoch should be close to current time
now_epoch=$(date +%s)
epoch_diff=$(( now_epoch - epoch_field ))
if [ "$epoch_diff" -ge -2 ] && [ "$epoch_diff" -le 2 ]; then
  pass "record_worker epoch is close to current time"
else
  fail "record_worker epoch is close to current time" "within 2s of $now_epoch" "$epoch_field (diff: ${epoch_diff}s)"
fi

echo ""
echo "Worker tracking — list_workers:"

# list_workers returns entries
: > "$WORKER_PID_FILE"
record_worker "111" "10" "worker"
record_worker "222" "20" "plan"
result=$(list_workers)
line_count=$(echo "$result" | wc -l | tr -d ' ')
assert_eq "list_workers returns 2 entries" "2" "$line_count"

# First entry has PID 111
first_pid=$(echo "$result" | head -1 | cut -d: -f1)
assert_eq "list_workers first entry PID" "111" "$first_pid"

# Second entry has type plan
second_type=$(echo "$result" | tail -1 | cut -d: -f4)
assert_eq "list_workers second entry type" "plan" "$second_type"

echo ""
echo "Worker tracking — remove_worker:"

# remove_worker removes by PID
: > "$WORKER_PID_FILE"
record_worker "111" "10" "worker"
record_worker "222" "20" "plan"
record_worker "333" "30" "worker"
remove_worker "222"
result=$(list_workers)
line_count=$(echo "$result" | wc -l | tr -d ' ')
assert_eq "remove_worker leaves 2 entries" "2" "$line_count"

# Verify PID 222 is gone
if echo "$result" | grep -q "^222:"; then
  fail "remove_worker removed PID 222" "PID 222 absent" "PID 222 still present"
else
  pass "remove_worker removed PID 222"
fi

# PID 111 and 333 still present
if echo "$result" | grep -q "^111:" && echo "$result" | grep -q "^333:"; then
  pass "remove_worker kept PIDs 111 and 333"
else
  fail "remove_worker kept PIDs 111 and 333" "both present" "$(echo "$result" | tr '\n' ' ')"
fi

echo ""
echo "Worker tracking — get_worker_start:"

# get_worker_start returns correct epoch
: > "$WORKER_PID_FILE"
record_worker "555" "50" "worker"
start=$(get_worker_start "555")
assert_not_empty "get_worker_start returns epoch" "$start"
start_diff=$(( now_epoch - start ))
if [ "$start_diff" -ge -2 ] && [ "$start_diff" -le 2 ]; then
  pass "get_worker_start epoch is close to current time"
else
  fail "get_worker_start epoch is close to current time" "within 2s of $now_epoch" "$start (diff: ${start_diff}s)"
fi

# get_worker_start returns empty for unknown PID
result=$(get_worker_start "99999")
assert_eq "get_worker_start returns empty for unknown PID" "" "$result"

echo ""
echo "Worker tracking — concurrent operations:"

# Concurrent appends don't corrupt the file
: > "$WORKER_PID_FILE"
for i in $(seq 1 10); do
  record_worker "${i}00" "$i" "worker" &
done
wait
line_count=$(wc -l < "$WORKER_PID_FILE" | tr -d ' ')
assert_eq "10 concurrent record_worker calls produce 10 lines" "10" "$line_count"

# Each line should have 4 colon-separated fields
bad_lines=0
while IFS= read -r line; do
  field_count=$(echo "$line" | awk -F: '{print NF}')
  if [ "$field_count" -ne 4 ]; then
    bad_lines=$((bad_lines + 1))
  fi
done < "$WORKER_PID_FILE"
assert_eq "all lines have 4 fields after concurrent writes" "0" "$bad_lines"

# Clean up worker tracking temp
rm -rf "$TEST_LOG_DIR"

# --- Shellcheck --------------------------------------------------------------
echo ""
echo "Shellcheck:"
if shellcheck -x "$REPO_ROOT/scripts/lib/daemon-state.sh" 2>/dev/null; then
  pass "shellcheck passes on daemon-state.sh"
else
  fail "shellcheck passes on daemon-state.sh" "no warnings" "warnings found"
fi

# --- Cleanup ------------------------------------------------------------------
rm -rf "$TEST_STATE_DIR"

# --- Summary ------------------------------------------------------------------
echo ""
echo "=== Results ==="
echo "  ${TESTS_PASSED}/${TESTS_RUN} passed, ${TESTS_FAILED} failed"
echo ""

if [ "$TESTS_FAILED" -gt 0 ]; then
  exit 1
fi
