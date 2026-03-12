#!/usr/bin/env bash
# bug-monitor.test.sh — Unit tests for bug-monitor.sh helper functions
#
# Run: bash scripts/__tests__/bug-monitor.test.sh
#
# Tests the core logic by sourcing helper functions and testing them in isolation.

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

# --- Source the CloudWatch helper ---------------------------------------------
echo ""
echo "=== CloudWatch Query Helper Tests ==="
echo ""

source "$REPO_ROOT/scripts/lib/cloudwatch-query.sh"

# Test extract_error_summary
echo "extract_error_summary:"

result=$(extract_error_summary "2024-01-15T10:30:00.000Z abc-def-123 ERROR TypeError: Cannot read property 'foo' of null")
assert_contains "strips timestamp and request ID" "TypeError: Cannot read property" "$result"

result=$(extract_error_summary "FATAL OutOfMemoryError: heap space")
assert_contains "strips severity prefix" "OutOfMemoryError" "$result"

result=$(extract_error_summary "Simple error message")
assert_eq "passes through simple messages" "Simple error message" "$result"

long_msg=$(printf '%0.s-' {1..200})
result=$(extract_error_summary "$long_msg")
assert_eq "truncates long messages to 120 chars" 120 "${#result}"

# Test extract_suggested_files
echo ""
echo "extract_suggested_files:"

stack="    at processTicksAndRejections (node:internal/process/task_queues:95:5)
    at Object.handler (src/app/api/posts/route.ts:42:5)
    at runMicrotasks (src/lib/db.ts:10:3)
    at src/lib/auth.ts:55:12"

result=$(extract_suggested_files "$stack")
assert_contains "extracts src/app/api/posts/route.ts" "src/app/api/posts/route.ts" "$result"
assert_contains "extracts src/lib/db.ts" "src/lib/db.ts" "$result"
assert_contains "extracts src/lib/auth.ts" "src/lib/auth.ts" "$result"

result=$(extract_suggested_files "no file paths here")
assert_eq "returns empty for no matches" "" "$result"

# --- Test fingerprint generation ----------------------------------------------
echo ""
echo "=== Bug Monitor Core Tests ==="
echo ""

# We need some functions from bug-monitor.sh but can't source the whole thing
# (it starts the main loop). So test the fingerprint logic directly.
echo "generate_fingerprint (sha256 of source:message):"

fp=$(echo -n "SERVER:TypeError: foo" | sha256sum | awk '{print $1}')
assert_not_empty "generates non-empty fingerprint" "$fp"
assert_eq "fingerprint is 64 hex chars" 64 "${#fp}"

fp2=$(echo -n "SERVER:TypeError: foo" | sha256sum | awk '{print $1}')
assert_eq "same input produces same fingerprint" "$fp" "$fp2"

fp3=$(echo -n "CLIENT:TypeError: foo" | sha256sum | awk '{print $1}')
if [ "$fp" != "$fp3" ]; then
  pass "different source produces different fingerprint"
else
  fail "different source produces different fingerprint" "different" "same"
fi

# --- Test cooldown logic ------------------------------------------------------
echo ""
echo "Cooldown logic:"

TEST_COOLDOWN_DIR=$(mktemp -d)
TEST_COOLDOWN_FILE="$TEST_COOLDOWN_DIR/.cooldown_test"
touch "$TEST_COOLDOWN_FILE"
COOLDOWN_SECONDS=3600
COOLDOWN_FILE="$TEST_COOLDOWN_FILE"

# Test: new fingerprint is not in cooldown
is_in_cooldown_test() {
  local fingerprint="$1"
  local now
  now=$(date +%s)
  local cooldown_contents
  cooldown_contents=$(cat "$COOLDOWN_FILE" 2>/dev/null || true)
  local tmp
  tmp=$(mktemp)
  local found=false
  while IFS='|' read -r fp ts; do
    if [ -n "$fp" ] && [ $((now - ts)) -lt "$COOLDOWN_SECONDS" ]; then
      echo "${fp}|${ts}" >> "$tmp"
      if [ "$fp" = "$fingerprint" ]; then
        found=true
      fi
    fi
  done <<< "$cooldown_contents"
  mv "$tmp" "$COOLDOWN_FILE"
  if [ "$found" = true ]; then
    return 0
  fi
  return 1
}

set_cooldown_test() {
  local fingerprint="$1"
  echo "${fingerprint}|$(date +%s)" >> "$COOLDOWN_FILE"
}

# Fresh fingerprint should not be in cooldown
if is_in_cooldown_test "abc123"; then
  fail "new fingerprint not in cooldown" "not in cooldown" "in cooldown"
else
  pass "new fingerprint not in cooldown"
fi

# After setting cooldown, should be in cooldown
set_cooldown_test "abc123"
if is_in_cooldown_test "abc123"; then
  pass "fingerprint in cooldown after set"
else
  fail "fingerprint in cooldown after set" "in cooldown" "not in cooldown"
fi

# Different fingerprint should not be in cooldown
if is_in_cooldown_test "def456"; then
  fail "different fingerprint not in cooldown" "not in cooldown" "in cooldown"
else
  pass "different fingerprint not in cooldown"
fi

# Expired cooldown should not match
echo "expired_fp|$(($(date +%s) - 7200))" > "$COOLDOWN_FILE"
if is_in_cooldown_test "expired_fp"; then
  fail "expired fingerprint not in cooldown" "not in cooldown" "in cooldown"
else
  pass "expired fingerprint not in cooldown"
fi

rm -rf "$TEST_COOLDOWN_DIR"

# --- Define helper functions from bug-monitor.sh (can't source it directly) ---
ms_to_human() {
  local ms="$1"
  local s=$(( ms / 1000 ))
  date -d "@${s}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || \
    date -r "${s}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || \
    echo "$ms"
}

# --- Test ms_to_human ---------------------------------------------------------
echo ""
echo "ms_to_human (epoch ms to human-readable):"

# Test with a known timestamp: 1700000000000 ms = 2023-11-14 22:13:20 UTC
# We can't assert the exact output (timezone dependent), but we can check format
ms_result=$(ms_to_human 1700000000000)
assert_not_empty "converts epoch ms to non-empty string" "$ms_result"
# Should contain a date-like pattern (YYYY-MM-DD)
if echo "$ms_result" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}'; then
  pass "ms_to_human returns date-formatted string"
else
  fail "ms_to_human returns date-formatted string" "YYYY-MM-DD format" "$ms_result"
fi

# --- Test flag parsing (dry run) ----------------------------------------------
echo ""
echo "Script flag parsing:"

# Test that bad flags exit with error
if bash "$REPO_ROOT/scripts/bug-monitor.sh" -x 2>/dev/null; then
  fail "invalid flag exits with error" "exit 1" "exit 0"
else
  pass "invalid flag exits with error"
fi

# Test that invalid poll interval is rejected
if bash "$REPO_ROOT/scripts/bug-monitor.sh" -i 0 2>/dev/null; then
  fail "zero poll interval rejected" "exit 1" "exit 0"
else
  pass "zero poll interval rejected"
fi

if bash "$REPO_ROOT/scripts/bug-monitor.sh" -i abc 2>/dev/null; then
  fail "non-numeric poll interval rejected" "exit 1" "exit 0"
else
  pass "non-numeric poll interval rejected"
fi

# Test that invalid severity is rejected
if bash "$REPO_ROOT/scripts/bug-monitor.sh" -s debug 2>/dev/null; then
  fail "invalid severity rejected" "exit 1" "exit 0"
else
  pass "invalid severity rejected"
fi

# --- Test Bash 3 compatibility (no declare -A) --------------------------------
echo ""
echo "Bash 3 compatibility:"

# Verify no associative arrays (declare -A) in bug-monitor.sh
if grep -q 'declare -A' "$REPO_ROOT/scripts/bug-monitor.sh"; then
  fail "no declare -A in bug-monitor.sh" "no associative arrays" "found declare -A"
else
  pass "no declare -A in bug-monitor.sh"
fi

# Verify log() writes to stderr, not stdout
# Check that the echo in log() uses >&2 redirection
if grep -A5 '^log()' "$REPO_ROOT/scripts/bug-monitor.sh" | grep -q 'echo.*>&2'; then
  pass "log() writes to stderr"
else
  fail "log() writes to stderr" "echo ... >&2" "no stderr redirect found"
fi

# Test temp directory aggregation pattern (used by poll_cloudwatch)
echo ""
echo "Temp directory aggregation pattern:"

cw_tmp=$(mktemp -d)

# Simulate first occurrence of a fingerprint
fp1="abc123"
mkdir -p "$cw_tmp/$fp1"
printf '%s' "Error: something broke" > "$cw_tmp/$fp1/message"
echo "1" > "$cw_tmp/$fp1/count"
echo "1700000000000" > "$cw_tmp/$fp1/first_seen"
echo "1700000000000" > "$cw_tmp/$fp1/last_seen"
echo "/aws/lambda/foo" > "$cw_tmp/$fp1/log_group"

assert_eq "stores message in temp file" "Error: something broke" "$(cat "$cw_tmp/$fp1/message")"
assert_eq "stores count in temp file" "1" "$(cat "$cw_tmp/$fp1/count")"

# Simulate second occurrence (increment count, update last_seen)
prev_count=$(cat "$cw_tmp/$fp1/count")
echo $((prev_count + 1)) > "$cw_tmp/$fp1/count"
echo "1700000060000" > "$cw_tmp/$fp1/last_seen"

assert_eq "increments count correctly" "2" "$(cat "$cw_tmp/$fp1/count")"
assert_eq "updates last_seen" "1700000060000" "$(cat "$cw_tmp/$fp1/last_seen")"
assert_eq "first_seen unchanged" "1700000000000" "$(cat "$cw_tmp/$fp1/first_seen")"

# Simulate second fingerprint
fp2="def456"
mkdir -p "$cw_tmp/$fp2"
printf '%s' "Error: another thing" > "$cw_tmp/$fp2/message"
echo "1" > "$cw_tmp/$fp2/count"
echo "1700000030000" > "$cw_tmp/$fp2/first_seen"
echo "1700000030000" > "$cw_tmp/$fp2/last_seen"
echo "/aws/lambda/bar" > "$cw_tmp/$fp2/log_group"

# Iterate over fingerprints (the pattern used in poll_cloudwatch)
fp_count=0
for fp_dir in "$cw_tmp"/*/; do
  [ -d "$fp_dir" ] || continue
  fp_count=$((fp_count + 1))
done
assert_eq "iterates over all fingerprints" "2" "$fp_count"

rm -rf "$cw_tmp"
pass "temp directory cleanup succeeds"

# Test that shellcheck passes
echo ""
echo "Shellcheck:"
if shellcheck -x "$REPO_ROOT/scripts/bug-monitor.sh" "$REPO_ROOT/scripts/lib/cloudwatch-query.sh" 2>/dev/null; then
  pass "shellcheck passes on all scripts"
else
  fail "shellcheck passes on all scripts" "no warnings" "warnings found"
fi

# --- Summary ------------------------------------------------------------------
echo ""
echo "=== Results ==="
echo "  ${TESTS_PASSED}/${TESTS_RUN} passed, ${TESTS_FAILED} failed"
echo ""

if [ "$TESTS_FAILED" -gt 0 ]; then
  exit 1
fi
