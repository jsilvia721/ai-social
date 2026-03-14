#!/usr/bin/env bash
# issue-daemon-rate-limit.test.sh — Tests for rate limit detection, reset time
# parsing, circuit breaker, and set_rate_limit_pause_until.
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

assert_gt() {
  local description="$1"
  local expected_gt="$2"
  local actual="$3"
  if [ "$actual" -gt "$expected_gt" ] 2>/dev/null; then
    pass "$description"
  else
    fail "$description" "> $expected_gt" "$actual"
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

# We need to source functions from issue-daemon.sh without running the main loop.
# Extract the functions we need by sourcing a subset.
# Instead, let's define the functions inline by extracting them.

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

# Test: "you've hit your limit" variant (case insensitive)
log_file="$TEST_LOG_DIR/test-you-limit.log"
echo "you've reached your limit for today" > "$log_file"
if detect_rate_limit 1 "$log_file"; then
  pass "detects 'you limit' variant"
else
  fail "detects 'you limit' variant" "rate limited" "not rate limited"
fi

# Test: non-rate-limit failure
log_file="$TEST_LOG_DIR/test-other-error.log"
echo "TypeError: Cannot read properties of undefined" > "$log_file"
if detect_rate_limit 1 "$log_file"; then
  fail "non-rate-limit error is not detected" "not rate limited" "rate limited"
else
  pass "non-rate-limit error is not detected"
fi

# --- parse_reset_time tests ---------------------------------------------------
echo ""
echo "parse_reset_time:"

# Test: standard format "8pm (America/New_York)"
log_file="$TEST_LOG_DIR/test-parse-8pm.log"
echo "You've hit your limit · resets 8pm (America/New_York)" > "$log_file"
result=$(parse_reset_time "$log_file")
if [ "$result" -gt 0 ] 2>/dev/null; then
  pass "parses '8pm (America/New_York)' — returns positive seconds ($result)"
else
  fail "parses '8pm (America/New_York)'" "positive seconds" "$result"
fi

# Test: format with minutes "8:30pm (America/New_York)"
log_file="$TEST_LOG_DIR/test-parse-830pm.log"
echo "You've hit your limit · resets 8:30pm (America/New_York)" > "$log_file"
result=$(parse_reset_time "$log_file")
if [ "$result" -gt 0 ] 2>/dev/null; then
  pass "parses '8:30pm (America/New_York)' — returns positive seconds ($result)"
else
  fail "parses '8:30pm (America/New_York)'" "positive seconds" "$result"
fi

# Test: AM format "6am (America/Chicago)"
log_file="$TEST_LOG_DIR/test-parse-6am.log"
echo "You've hit your limit · resets 6am (America/Chicago)" > "$log_file"
result=$(parse_reset_time "$log_file")
if [ "$result" -gt 0 ] 2>/dev/null; then
  pass "parses '6am (America/Chicago)' — returns positive seconds ($result)"
else
  fail "parses '6am (America/Chicago)'" "positive seconds" "$result"
fi

# Test: no reset time in log — returns 0
log_file="$TEST_LOG_DIR/test-parse-none.log"
echo "Some random error message" > "$log_file"
result=$(parse_reset_time "$log_file")
assert_eq "returns 0 when no reset time found" "0" "$result"

# Test: malformed reset time — returns 0
log_file="$TEST_LOG_DIR/test-parse-malformed.log"
echo "resets sometime later" > "$log_file"
result=$(parse_reset_time "$log_file")
assert_eq "returns 0 for malformed reset time" "0" "$result"

# Test: sanity — result should be less than 24 hours
log_file="$TEST_LOG_DIR/test-parse-sanity.log"
echo "You've hit your limit · resets 8pm (America/New_York)" > "$log_file"
result=$(parse_reset_time "$log_file")
if [ "$result" -gt 0 ] && [ "$result" -le 86400 ]; then
  pass "result is between 0 and 86400 seconds ($result)"
else
  # 0 is acceptable if we can't parse (e.g., no python3)
  if [ "$result" = "0" ]; then
    pass "returns 0 (graceful fallback when parsing unavailable)"
  else
    fail "result is reasonable" "0-86400" "$result"
  fi
fi

# --- format_reset_display tests -----------------------------------------------
echo ""
echo "format_reset_display:"

# Test: standard format
log_file="$TEST_LOG_DIR/test-format-8pm.log"
echo "You've hit your limit · resets 8pm (America/New_York)" > "$log_file"
result=$(format_reset_display "$log_file")
assert_eq "formats '8pm ET'" "8:00 PM ET" "$result"

# Test: with minutes
log_file="$TEST_LOG_DIR/test-format-830pm.log"
echo "You've hit your limit · resets 8:30pm (America/New_York)" > "$log_file"
result=$(format_reset_display "$log_file")
assert_eq "formats '8:30pm ET'" "8:30 PM ET" "$result"

# Test: Chicago timezone
log_file="$TEST_LOG_DIR/test-format-ct.log"
echo "You've hit your limit · resets 6am (America/Chicago)" > "$log_file"
result=$(format_reset_display "$log_file")
assert_eq "formats '6am CT'" "6:00 AM CT" "$result"

# Test: Pacific timezone
log_file="$TEST_LOG_DIR/test-format-pt.log"
echo "You've hit your limit · resets 5pm (America/Los_Angeles)" > "$log_file"
result=$(format_reset_display "$log_file")
assert_eq "formats '5pm PT'" "5:00 PM PT" "$result"

# Test: no reset time
log_file="$TEST_LOG_DIR/test-format-none.log"
echo "Some random error" > "$log_file"
result=$(format_reset_display "$log_file")
assert_eq "returns empty when no reset time" "" "$result"

# --- set_rate_limit_pause_until tests -----------------------------------------
echo ""
echo "set_rate_limit_pause_until:"

# Test: accepts absolute epoch
future_epoch=$(( $(date +%s) + 3600 ))
set_rate_limit_pause_until "$future_epoch"
stored_epoch=$(cat "$TEST_STATE_DIR/pause-until")
assert_eq "stores absolute epoch directly" "$future_epoch" "$stored_epoch"

# Test: is_rate_limit_paused returns true for future epoch
if is_rate_limit_paused; then
  pass "is_rate_limit_paused returns true for future epoch"
else
  fail "is_rate_limit_paused returns true for future epoch" "paused" "not paused"
fi
clear_rate_limit_pause

# Test: past epoch is auto-cleared
past_epoch=$(( $(date +%s) - 60 ))
set_rate_limit_pause_until "$past_epoch"
if is_rate_limit_paused; then
  fail "past epoch is auto-cleared" "not paused" "paused"
else
  pass "past epoch is auto-cleared"
fi

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
