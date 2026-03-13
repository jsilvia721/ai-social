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

assert_contains() {
  local description="$1"
  local needle="$2"
  local haystack="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    pass "$description"
  else
    fail "$description" "contains '$needle'" "$haystack"
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

# Files exist after set
if [ -f "$TEST_STATE_DIR/rate-limit-pause" ]; then
  pass "rate-limit-pause file exists after set"
else
  fail "rate-limit-pause file exists after set" "file exists" "file missing"
fi

if [ -f "$TEST_STATE_DIR/pause-until" ]; then
  pass "pause-until file exists after set"
else
  fail "pause-until file exists after set" "file exists" "file missing"
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

# Files removed after clear
if [ ! -f "$TEST_STATE_DIR/rate-limit-pause" ]; then
  pass "rate-limit-pause file removed after clear"
else
  fail "rate-limit-pause file removed after clear" "file missing" "file exists"
fi

if [ ! -f "$TEST_STATE_DIR/pause-until" ]; then
  pass "pause-until file removed after clear"
else
  fail "pause-until file removed after clear" "file missing" "file exists"
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

# Files should be cleaned up by auto-expiry
if [ ! -f "$TEST_STATE_DIR/rate-limit-pause" ]; then
  pass "rate-limit-pause file cleaned up on expiry"
else
  fail "rate-limit-pause file cleaned up on expiry" "file missing" "file exists"
fi

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
