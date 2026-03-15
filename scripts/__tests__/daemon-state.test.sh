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

# --- CI Monitor State Tests ---------------------------------------------------
echo ""
echo "=== CI Monitor State Tests ==="

# Set up CI monitor state file in a fresh temp dir
CI_TEST_STATE_DIR=$(mktemp -d)
export DAEMON_STATE_DIR="$CI_TEST_STATE_DIR"
export CI_MONITOR_STATE_FILE="$CI_TEST_STATE_DIR/ci-monitor-state"
ensure_state_dir

echo ""
echo "ci_monitor_track:"

# Track a new run
ci_monitor_track "12345" "detected" "abc123hash" "Deploy" "" ""
if [ -f "$CI_MONITOR_STATE_FILE" ]; then
  pass "ci_monitor_track creates state file"
else
  fail "ci_monitor_track creates state file" "file exists" "file missing"
fi

line=$(cat "$CI_MONITOR_STATE_FILE")
run_field=$(echo "$line" | cut -d'|' -f1)
status_field=$(echo "$line" | cut -d'|' -f2)
fp_field=$(echo "$line" | cut -d'|' -f3)
detected_field=$(echo "$line" | cut -d'|' -f4)
rerun_field=$(echo "$line" | cut -d'|' -f5)
issue_field=$(echo "$line" | cut -d'|' -f6)
workflow_field=$(echo "$line" | cut -d'|' -f7)
assert_eq "ci_monitor_track run_id field" "12345" "$run_field"
assert_eq "ci_monitor_track status field" "detected" "$status_field"
assert_eq "ci_monitor_track fingerprint field" "abc123hash" "$fp_field"
assert_not_empty "ci_monitor_track detected_epoch field" "$detected_field"
assert_eq "ci_monitor_track rerun_epoch field (empty)" "" "$rerun_field"
assert_eq "ci_monitor_track issue_number field (empty)" "" "$issue_field"
assert_eq "ci_monitor_track workflow_name field" "Deploy" "$workflow_field"

# Track a second run
ci_monitor_track "67890" "rerunning" "def456hash" "CI" "" ""
line_count=$(wc -l < "$CI_MONITOR_STATE_FILE" | tr -d ' ')
assert_eq "ci_monitor_track appends (2 entries)" "2" "$line_count"

echo ""
echo "ci_monitor_status:"

# Get status of existing run
result=$(ci_monitor_status "12345")
assert_eq "ci_monitor_status returns correct status" "detected" "$result"

result=$(ci_monitor_status "67890")
assert_eq "ci_monitor_status returns second entry status" "rerunning" "$result"

# Get status of non-existent run
result=$(ci_monitor_status "99999")
assert_eq "ci_monitor_status returns empty for unknown run" "" "$result"

echo ""
echo "ci_monitor_update:"

# Update status of a run
ci_monitor_update "12345" "rerunning"
result=$(ci_monitor_status "12345")
assert_eq "ci_monitor_update changes status" "rerunning" "$result"

# Update with rerun_epoch
ci_monitor_update "12345" "rerun_ok" "" "1700000000"
result=$(ci_monitor_status "12345")
assert_eq "ci_monitor_update to rerun_ok" "rerun_ok" "$result"
# Check rerun epoch was set
line=$(grep "^12345|" "$CI_MONITOR_STATE_FILE")
rerun_field=$(echo "$line" | cut -d'|' -f5)
assert_eq "ci_monitor_update sets rerun_epoch" "1700000000" "$rerun_field"

# Update with issue number
ci_monitor_update "67890" "filed" "42" ""
result=$(ci_monitor_status "67890")
assert_eq "ci_monitor_update to filed" "filed" "$result"
line=$(grep "^67890|" "$CI_MONITOR_STATE_FILE")
issue_field=$(echo "$line" | cut -d'|' -f6)
assert_eq "ci_monitor_update sets issue_number" "42" "$issue_field"

# Update non-existent run is a no-op (doesn't error)
ci_monitor_update "99999" "filed"
pass "ci_monitor_update on unknown run does not error"

echo ""
echo "ci_monitor_fingerprint_open:"

# Reset state file for fingerprint tests
: > "$CI_MONITOR_STATE_FILE"
ci_monitor_track "100" "filed" "open_fp" "TestWorkflow" "" ""
ci_monitor_track "101" "resolved" "closed_fp" "TestWorkflow" "" ""
ci_monitor_track "102" "detected" "detected_fp" "TestWorkflow" "" ""

# Fingerprint with filed status should return 0 (open)
if ci_monitor_fingerprint_open "open_fp"; then
  pass "ci_monitor_fingerprint_open returns 0 for filed fingerprint"
else
  fail "ci_monitor_fingerprint_open returns 0 for filed fingerprint" "exit 0" "exit 1"
fi

# Fingerprint with resolved status should return 1 (not open)
if ci_monitor_fingerprint_open "closed_fp"; then
  fail "ci_monitor_fingerprint_open returns 1 for resolved fingerprint" "exit 1" "exit 0"
else
  pass "ci_monitor_fingerprint_open returns 1 for resolved fingerprint"
fi

# Fingerprint with detected status should return 1 (not filed = not open)
if ci_monitor_fingerprint_open "detected_fp"; then
  fail "ci_monitor_fingerprint_open returns 1 for detected fingerprint" "exit 1" "exit 0"
else
  pass "ci_monitor_fingerprint_open returns 1 for detected fingerprint"
fi

# Unknown fingerprint should return 1 (not open)
if ci_monitor_fingerprint_open "nonexistent_fp"; then
  fail "ci_monitor_fingerprint_open returns 1 for unknown fingerprint" "exit 1" "exit 0"
else
  pass "ci_monitor_fingerprint_open returns 1 for unknown fingerprint"
fi

echo ""
echo "ci_monitor_prune:"

# Reset state file for pruning tests
: > "$CI_MONITOR_STATE_FILE"
now_epoch=$(date +%s)
old_epoch=$((now_epoch - 8 * 86400))  # 8 days ago
recent_epoch=$((now_epoch - 1 * 86400))  # 1 day ago

# Add old entries (should be pruned)
echo "OLD1|detected|fp1|${old_epoch}||0|Workflow1" >> "$CI_MONITOR_STATE_FILE"
echo "OLD2|filed|fp2|${old_epoch}||0|Workflow2" >> "$CI_MONITOR_STATE_FILE"

# Add recent entries (should be kept)
echo "NEW1|detected|fp3|${recent_epoch}||0|Workflow3" >> "$CI_MONITOR_STATE_FILE"
echo "NEW2|filed|fp4|${recent_epoch}||0|Workflow4" >> "$CI_MONITOR_STATE_FILE"

ci_monitor_prune
line_count=$(wc -l < "$CI_MONITOR_STATE_FILE" | tr -d ' ')
assert_eq "ci_monitor_prune removes entries older than 7 days" "2" "$line_count"

# Verify only recent entries remain
if grep -q "^NEW1|" "$CI_MONITOR_STATE_FILE" && grep -q "^NEW2|" "$CI_MONITOR_STATE_FILE"; then
  pass "ci_monitor_prune keeps recent entries"
else
  fail "ci_monitor_prune keeps recent entries" "NEW1 and NEW2 present" "$(cat "$CI_MONITOR_STATE_FILE")"
fi

if grep -q "^OLD" "$CI_MONITOR_STATE_FILE"; then
  fail "ci_monitor_prune removed old entries" "no OLD entries" "OLD entries found"
else
  pass "ci_monitor_prune removed old entries"
fi

# Test 100-entry cap
: > "$CI_MONITOR_STATE_FILE"
for i in $(seq 1 110); do
  echo "RUN${i}|detected|fp${i}|${recent_epoch}||0|Workflow" >> "$CI_MONITOR_STATE_FILE"
done
ci_monitor_prune
line_count=$(wc -l < "$CI_MONITOR_STATE_FILE" | tr -d ' ')
assert_eq "ci_monitor_prune caps at 100 entries" "100" "$line_count"

# The oldest entries (RUN1-RUN10) should be removed, newest kept
if grep -q "^RUN110|" "$CI_MONITOR_STATE_FILE"; then
  pass "ci_monitor_prune keeps newest entries after cap"
else
  fail "ci_monitor_prune keeps newest entries after cap" "RUN110 present" "$(tail -1 "$CI_MONITOR_STATE_FILE")"
fi

if grep -q "^RUN1|" "$CI_MONITOR_STATE_FILE"; then
  fail "ci_monitor_prune removed oldest entries after cap" "RUN1 absent" "RUN1 present"
else
  pass "ci_monitor_prune removed oldest entries after cap"
fi

echo ""
echo "ci_monitor — missing/empty state file:"

# Missing state file handled gracefully
rm -f "$CI_MONITOR_STATE_FILE"
result=$(ci_monitor_status "12345")
assert_eq "ci_monitor_status on missing file returns empty" "" "$result"

ci_monitor_prune
pass "ci_monitor_prune on missing file does not error"

if ci_monitor_fingerprint_open "any_fp"; then
  fail "ci_monitor_fingerprint_open on missing file returns 1" "exit 1" "exit 0"
else
  pass "ci_monitor_fingerprint_open on missing file returns 1"
fi

# Empty state file handled gracefully
: > "$CI_MONITOR_STATE_FILE"
result=$(ci_monitor_status "12345")
assert_eq "ci_monitor_status on empty file returns empty" "" "$result"

ci_monitor_prune
line_count=$(wc -l < "$CI_MONITOR_STATE_FILE" | tr -d ' ')
# Empty file has 0 lines
if [ "$line_count" -le 1 ]; then
  pass "ci_monitor_prune on empty file is no-op"
else
  fail "ci_monitor_prune on empty file is no-op" "0 or 1 lines" "$line_count"
fi

# Clean up CI monitor temp
rm -rf "$CI_TEST_STATE_DIR"

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
