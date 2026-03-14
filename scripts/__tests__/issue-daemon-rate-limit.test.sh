#!/usr/bin/env bash
# issue-daemon-rate-limit.test.sh — Tests for rate limit detection, reset time
# parsing, and circuit breaker.
#
# Run: bash scripts/__tests__/issue-daemon-rate-limit.test.sh

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
export DAEMON_STATE_DIR="$TEST_STATE_DIR"
export LOG_DIR="$TEST_LOG_DIR"

# Source the state library
# shellcheck source=scripts/lib/daemon-state.sh
source "$REPO_ROOT/scripts/lib/daemon-state.sh"
ensure_state_dir

# Set up required variables and source the helper library
RATE_LIMIT_PAUSE_SECONDS=900
CIRCUIT_BREAKER_FILE="$TEST_LOG_DIR/.failure_times"
CIRCUIT_BREAKER_WINDOW=60
CIRCUIT_BREAKER_THRESHOLD=3

# shellcheck source=scripts/lib/rate-limit-helpers.sh
source "$REPO_ROOT/scripts/lib/rate-limit-helpers.sh"

echo ""
echo "=== Rate Limit Detection Tests ==="

# --- detect_rate_limit tests --------------------------------------------------
echo ""
echo "detect_rate_limit:"

# Test: successful exit is never rate limited
log_file="$TEST_LOG_DIR/test-success.log"
echo "Everything is fine" > "$log_file"
if detect_rate_limit 0 "$log_file"; then
  fail "successful exit is not rate limited" "not rate limited" "rate limited"
else
  pass "successful exit is not rate limited"
fi

# Test: 429 in log file
log_file="$TEST_LOG_DIR/test-429.log"
echo "HTTP 429 Too Many Requests" > "$log_file"
if detect_rate_limit 1 "$log_file"; then
  pass "detects HTTP 429"
else
  fail "detects HTTP 429" "rate limited" "not rate limited"
fi

# Test: quota exceeded
log_file="$TEST_LOG_DIR/test-quota.log"
echo "API quota exceeded" > "$log_file"
if detect_rate_limit 1 "$log_file"; then
  pass "detects quota exceeded"
else
  fail "detects quota exceeded" "rate limited" "not rate limited"
fi

# Test: budget exceeded
log_file="$TEST_LOG_DIR/test-budget.log"
echo "budget has been exceeded" > "$log_file"
if detect_rate_limit 1 "$log_file"; then
  pass "detects budget exceeded"
else
  fail "detects budget exceeded" "rate limited" "not rate limited"
fi

# Test: overloaded
log_file="$TEST_LOG_DIR/test-overloaded.log"
echo "API is overloaded" > "$log_file"
if detect_rate_limit 1 "$log_file"; then
  pass "detects overloaded"
else
  fail "detects overloaded" "rate limited" "not rate limited"
fi

# Test: Anthropic usage limit message
log_file="$TEST_LOG_DIR/test-usage-limit.log"
echo "You've hit your limit · resets 8pm (America/New_York)" > "$log_file"
if detect_rate_limit 1 "$log_file"; then
  pass "detects 'hit your limit' (Anthropic usage limit)"
else
  fail "detects 'hit your limit' (Anthropic usage limit)" "rate limited" "not rate limited"
fi

# Test: "you've reached your limit" variant
log_file="$TEST_LOG_DIR/test-you-limit.log"
echo "you've reached your limit for today" > "$log_file"
if detect_rate_limit 1 "$log_file"; then
  pass "detects 'you've limit' variant"
else
  fail "detects 'you've limit' variant" "rate limited" "not rate limited"
fi

# Test: non-rate-limit failure
log_file="$TEST_LOG_DIR/test-other-error.log"
echo "TypeError: Cannot read properties of undefined" > "$log_file"
if detect_rate_limit 1 "$log_file"; then
  fail "non-rate-limit error is not detected" "not rate limited" "rate limited"
else
  pass "non-rate-limit error is not detected"
fi

# Test: false positive guard — "hit the speed limit" should not match
log_file="$TEST_LOG_DIR/test-false-positive.log"
echo "hit the speed limit on the highway" > "$log_file"
if detect_rate_limit 1 "$log_file"; then
  fail "false positive: 'hit the speed limit' should not match" "not rate limited" "rate limited"
else
  pass "false positive: 'hit the speed limit' does not match"
fi

# --- parse_reset_time tests ---------------------------------------------------
echo ""
echo "parse_reset_time (outputs seconds + display):"

# Helper to get seconds and display from parse_reset_time
get_seconds() { echo "$1" | head -1; }
get_display() { echo "$1" | tail -1; }

# Test: standard format "8pm (America/New_York)"
log_file="$TEST_LOG_DIR/test-parse-8pm.log"
echo "You've hit your limit · resets 8pm (America/New_York)" > "$log_file"
result=$(parse_reset_time "$log_file")
seconds=$(get_seconds "$result")
display=$(get_display "$result")
if [ "$seconds" -gt 0 ] 2>/dev/null; then
  pass "parses '8pm (America/New_York)' — returns positive seconds ($seconds)"
else
  fail "parses '8pm (America/New_York)'" "positive seconds" "$seconds"
fi
assert_eq "display for 8pm ET" "8:00 PM ET" "$display"

# Test: format with minutes "8:30pm (America/New_York)"
log_file="$TEST_LOG_DIR/test-parse-830pm.log"
echo "You've hit your limit · resets 8:30pm (America/New_York)" > "$log_file"
result=$(parse_reset_time "$log_file")
seconds=$(get_seconds "$result")
display=$(get_display "$result")
if [ "$seconds" -gt 0 ] 2>/dev/null; then
  pass "parses '8:30pm (America/New_York)' — returns positive seconds ($seconds)"
else
  fail "parses '8:30pm (America/New_York)'" "positive seconds" "$seconds"
fi
assert_eq "display for 8:30pm ET" "8:30 PM ET" "$display"

# Test: AM format "6am (America/Chicago)"
log_file="$TEST_LOG_DIR/test-parse-6am.log"
echo "You've hit your limit · resets 6am (America/Chicago)" > "$log_file"
result=$(parse_reset_time "$log_file")
seconds=$(get_seconds "$result")
display=$(get_display "$result")
if [ "$seconds" -gt 0 ] 2>/dev/null; then
  pass "parses '6am (America/Chicago)' — returns positive seconds ($seconds)"
else
  fail "parses '6am (America/Chicago)'" "positive seconds" "$seconds"
fi
assert_eq "display for 6am CT" "6:00 AM CT" "$display"

# Test: Pacific timezone
log_file="$TEST_LOG_DIR/test-parse-pt.log"
echo "You've hit your limit · resets 5pm (America/Los_Angeles)" > "$log_file"
result=$(parse_reset_time "$log_file")
display=$(get_display "$result")
assert_eq "display for 5pm PT" "5:00 PM PT" "$display"

# Test: no reset time in log — returns 0 + empty
log_file="$TEST_LOG_DIR/test-parse-none.log"
echo "Some random error message" > "$log_file"
result=$(parse_reset_time "$log_file")
seconds=$(get_seconds "$result")
assert_eq "returns 0 when no reset time found" "0" "$seconds"

# Test: malformed reset time — returns 0
log_file="$TEST_LOG_DIR/test-parse-malformed.log"
echo "resets sometime later" > "$log_file"
result=$(parse_reset_time "$log_file")
seconds=$(get_seconds "$result")
assert_eq "returns 0 for malformed reset time" "0" "$seconds"

# Test: sanity — result should be less than 24 hours
log_file="$TEST_LOG_DIR/test-parse-sanity.log"
echo "You've hit your limit · resets 8pm (America/New_York)" > "$log_file"
result=$(parse_reset_time "$log_file")
seconds=$(get_seconds "$result")
if [ "$seconds" -gt 0 ] && [ "$seconds" -le 86400 ]; then
  pass "result is between 0 and 86400 seconds ($seconds)"
else
  if [ "$seconds" = "0" ]; then
    pass "returns 0 (graceful fallback when parsing unavailable)"
  else
    fail "result is reasonable" "0-86400" "$seconds"
  fi
fi

# --- Pause with parsed duration -----------------------------------------------
echo ""
echo "set_rate_limit_pause with parsed duration:"

# Test: using set_rate_limit_pause with parsed seconds works correctly
clear_rate_limit_pause
set_rate_limit_pause 7200  # 2 hours
if is_rate_limit_paused; then
  pass "paused after set_rate_limit_pause with custom duration"
else
  fail "paused after set_rate_limit_pause with custom duration" "paused" "not paused"
fi
stored_epoch=$(cat "$TEST_STATE_DIR/pause-until")
expected_min=$(( $(date +%s) + 7190 ))
expected_max=$(( $(date +%s) + 7210 ))
if [ "$stored_epoch" -ge "$expected_min" ] && [ "$stored_epoch" -le "$expected_max" ]; then
  pass "pause-until epoch is ~7200 seconds from now"
else
  fail "pause-until epoch is ~7200 seconds from now" "between $expected_min and $expected_max" "$stored_epoch"
fi
clear_rate_limit_pause

# --- Circuit breaker tests ----------------------------------------------------
echo ""
echo "Circuit breaker:"

# Clean up any existing state
rm -f "$CIRCUIT_BREAKER_FILE"

# Test: no failures — circuit breaker does not trip
if check_circuit_breaker; then
  fail "no failures — does not trip" "not tripped" "tripped"
else
  pass "no failures — does not trip"
fi

# Test: 2 failures — does not trip
rm -f "$CIRCUIT_BREAKER_FILE"
record_failure
record_failure
if check_circuit_breaker; then
  fail "2 failures — does not trip" "not tripped" "tripped"
else
  pass "2 failures — does not trip"
fi

# Test: 3 failures — trips
rm -f "$CIRCUIT_BREAKER_FILE"
record_failure
record_failure
record_failure
if check_circuit_breaker; then
  pass "3 failures — trips"
else
  fail "3 failures — trips" "tripped" "not tripped"
fi

# Test: old failures are cleaned up (outside window)
rm -f "$CIRCUIT_BREAKER_FILE"
# Write timestamps from 120 seconds ago (outside the 60s window)
old_epoch=$(( $(date +%s) - 120 ))
echo "$old_epoch" >> "$CIRCUIT_BREAKER_FILE"
echo "$old_epoch" >> "$CIRCUIT_BREAKER_FILE"
echo "$old_epoch" >> "$CIRCUIT_BREAKER_FILE"
if check_circuit_breaker; then
  fail "old failures are cleaned up" "not tripped" "tripped"
else
  pass "old failures are cleaned up"
fi

# Verify old entries were removed from the file
remaining=$(wc -l < "$CIRCUIT_BREAKER_FILE" 2>/dev/null | tr -d ' ')
assert_eq "old entries purged from file" "0" "$remaining"

# Test: mix of old and new failures — only new ones count
rm -f "$CIRCUIT_BREAKER_FILE"
old_epoch=$(( $(date +%s) - 120 ))
echo "$old_epoch" >> "$CIRCUIT_BREAKER_FILE"
echo "$old_epoch" >> "$CIRCUIT_BREAKER_FILE"
record_failure
record_failure
if check_circuit_breaker; then
  fail "2 recent + 2 old failures — does not trip" "not tripped" "tripped"
else
  pass "2 recent + 2 old failures — does not trip"
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
