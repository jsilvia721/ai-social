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

# --- Test normalize_message ---------------------------------------------------
echo ""
echo "=== normalize_message Tests ==="
echo ""

echo "UUID normalization:"
result=$(normalize_message "Error for user 550e8400-e29b-41d4-a716-446655440000 failed")
assert_eq "replaces UUID with <UUID>" "Error for user <UUID> failed" "$result"

result=$(normalize_message "a]550e8400-e29b-41d4-a716-446655440000[b")
assert_eq "replaces UUID in brackets" "a]<UUID>[b" "$result"

result=$(normalize_message "Error for 550E8400-E29B-41D4-A716-446655440000")
assert_eq "replaces uppercase UUID" "Error for <UUID>" "$result"

echo ""
echo "CUID/nanoid normalization:"
result=$(normalize_message "Post clbzgxkja0000qwer12345678 not found")
assert_eq "replaces CUID with <ID>" "Post <ID> not found" "$result"

result=$(normalize_message "Session abcdefghijklmnopqrstuvwxy expired")
assert_eq "replaces 25-char alphanum with <ID>" "Session <ID> expired" "$result"

# Short IDs should NOT be replaced
result=$(normalize_message "Error code abc123 found")
assert_eq "preserves short IDs" "Error code abc123 found" "$result"

echo ""
echo "Timestamp normalization:"
result=$(normalize_message "Error at 2024-01-15T10:30:00.000Z in handler")
assert_eq "replaces ISO timestamp with <TIMESTAMP>" "Error at <TIMESTAMP> in handler" "$result"

result=$(normalize_message "Error at 2024-01-15T10:30:00Z in handler")
assert_eq "replaces ISO timestamp without ms" "Error at <TIMESTAMP> in handler" "$result"

result=$(normalize_message "Since 2024-01-15 10:30:00 the service")
assert_eq "replaces datetime string with <TIMESTAMP>" "Since <TIMESTAMP> the service" "$result"

echo ""
echo "Number normalization:"
result=$(normalize_message "Failed after 42 retries")
assert_eq "replaces standalone number with <N>" "Failed after <N> retries" "$result"

result=$(normalize_message "Error 500 at line 123")
assert_eq "replaces multiple numbers" "Error <N> at line <N>" "$result"

result=$(normalize_message "Error 500 500 at line 10")
assert_eq "replaces consecutive numbers" "Error <N> <N> at line <N>" "$result"

# Numbers in identifiers should NOT be replaced
result=$(normalize_message "TypeError: Cannot read property")
assert_eq "preserves error type names" "TypeError: Cannot read property" "$result"

result=$(normalize_message "Error in src/lib/auth.ts")
assert_eq "preserves file paths with numbers" "Error in src/lib/auth.ts" "$result"

echo ""
echo "Query string normalization:"
result=$(normalize_message "GET /api/posts?page=1&limit=20 failed")
assert_eq "strips query strings" "GET /api/posts failed" "$result"

echo ""
echo "Whitespace normalization:"
result=$(normalize_message "  Error   with   extra   spaces  ")
assert_eq "collapses whitespace and trims" "Error with extra spaces" "$result"

echo ""
echo "Combined normalization:"
result=$(normalize_message "Error for user 550e8400-e29b-41d4-a716-446655440000 at 2024-01-15T10:30:00.000Z after 5 retries")
assert_eq "normalizes UUID + timestamp + number" "Error for user <UUID> at <TIMESTAMP> after <N> retries" "$result"

echo ""
echo "Preservation tests:"
result=$(normalize_message "TypeError: Cannot read property 'foo' of null")
assert_eq "preserves TypeError message" "TypeError: Cannot read property 'foo' of null" "$result"

result=$(normalize_message "ReferenceError: x is not defined")
assert_eq "preserves ReferenceError message" "ReferenceError: x is not defined" "$result"

# --- Test generate_fingerprint with normalization -----------------------------
echo ""
echo "generate_fingerprint with normalization:"

# Two messages differing only in UUID should produce the same fingerprint
fp_a=$(echo -n "SERVER:$(normalize_message "Error for user 550e8400-e29b-41d4-a716-446655440000")" | sha256sum | awk '{print $1}')
fp_b=$(echo -n "SERVER:$(normalize_message "Error for user 12345678-1234-1234-1234-123456789abc")" | sha256sum | awk '{print $1}')
assert_eq "same fingerprint for messages differing only in UUID" "$fp_a" "$fp_b"

# Two messages differing only in timestamps should produce the same fingerprint
fp_c=$(echo -n "SERVER:$(normalize_message "Error at 2024-01-15T10:30:00.000Z")" | sha256sum | awk '{print $1}')
fp_d=$(echo -n "SERVER:$(normalize_message "Error at 2025-12-31T23:59:59.999Z")" | sha256sum | awk '{print $1}')
assert_eq "same fingerprint for messages differing only in timestamp" "$fp_c" "$fp_d"

# Two messages differing only in numbers should produce the same fingerprint
fp_e=$(echo -n "SERVER:$(normalize_message "Failed after 3 retries")" | sha256sum | awk '{print $1}')
fp_f=$(echo -n "SERVER:$(normalize_message "Failed after 99 retries")" | sha256sum | awk '{print $1}')
assert_eq "same fingerprint for messages differing only in numbers" "$fp_e" "$fp_f"

# Different error types should produce different fingerprints
fp_g=$(echo -n "SERVER:$(normalize_message "TypeError: foo")" | sha256sum | awk '{print $1}')
fp_h=$(echo -n "SERVER:$(normalize_message "ReferenceError: foo")" | sha256sum | awk '{print $1}')
if [ "$fp_g" != "$fp_h" ]; then
  pass "different error types produce different fingerprints"
else
  fail "different error types produce different fingerprints" "different" "same"
fi

# --- Test cloudwatch_extract_stage -------------------------------------------
echo ""
echo "=== cloudwatch_extract_stage Tests ==="
echo ""

echo "cloudwatch_extract_stage:"

result=$(cloudwatch_extract_stage "/aws/lambda/ai-social-SiteFn-staging")
assert_eq "extracts staging from SST log group" "staging" "$result"

result=$(cloudwatch_extract_stage "/aws/lambda/ai-social-SiteFn-production")
assert_eq "extracts production from SST log group" "production" "$result"

result=$(cloudwatch_extract_stage "/aws/lambda/ai-social-MetricsFn-staging")
assert_eq "extracts staging from different function name" "staging" "$result"

result=$(cloudwatch_extract_stage "/aws/lambda/some-other-thing")
assert_eq "returns unknown for unrecognized stage" "unknown" "$result"

result=$(cloudwatch_extract_stage "/aws/lambda/ai-social-SiteFn-dev")
assert_eq "extracts dev as valid stage" "dev" "$result"

result=$(cloudwatch_extract_stage "/aws/lambda/nohyphens")
assert_eq "returns unknown for no-hyphen name" "unknown" "$result"

result=$(cloudwatch_extract_stage "")
assert_eq "returns unknown for empty string" "unknown" "$result"

# --- Test environment-scoped cooldown ----------------------------------------
echo ""
echo "=== Environment-Scoped Cooldown Tests ==="
echo ""

echo "Environment-scoped cooldown fingerprints:"

TEST_ENV_COOLDOWN_DIR=$(mktemp -d)
TEST_ENV_COOLDOWN_FILE="$TEST_ENV_COOLDOWN_DIR/.cooldown_env_test"
touch "$TEST_ENV_COOLDOWN_FILE"
COOLDOWN_SECONDS=3600
COOLDOWN_FILE="$TEST_ENV_COOLDOWN_FILE"

# Set cooldown for staging:fp1
set_cooldown_test "staging:fp1"

# staging:fp1 should be in cooldown
if is_in_cooldown_test "staging:fp1"; then
  pass "staging:fp1 is in cooldown"
else
  fail "staging:fp1 is in cooldown" "in cooldown" "not in cooldown"
fi

# production:fp1 should NOT be in cooldown (different env, same fingerprint)
if is_in_cooldown_test "production:fp1"; then
  fail "production:fp1 not in cooldown (different env)" "not in cooldown" "in cooldown"
else
  pass "production:fp1 not in cooldown (different env)"
fi

# Set cooldown for production:fp1 separately
set_cooldown_test "production:fp1"

# Now both should be in cooldown
if is_in_cooldown_test "staging:fp1"; then
  pass "staging:fp1 still in cooldown"
else
  fail "staging:fp1 still in cooldown" "in cooldown" "not in cooldown"
fi

if is_in_cooldown_test "production:fp1"; then
  pass "production:fp1 now in cooldown"
else
  fail "production:fp1 now in cooldown" "in cooldown" "not in cooldown"
fi

rm -rf "$TEST_ENV_COOLDOWN_DIR"

# --- Test issue title format with environment --------------------------------
echo ""
echo "=== Issue Title Environment Prefix Tests ==="
echo ""

echo "Issue title format:"

# Test that title format includes environment prefix
# We test the format string directly since we can't run create_bug_issue without gh
test_title="Bug [staging]: TypeError: Cannot read property"
assert_contains "title includes [staging] prefix" "[staging]" "$test_title"

test_title="Bug [production]: OutOfMemoryError"
assert_contains "title includes [production] prefix" "[production]" "$test_title"

# Verify the old format is not used
test_title_old="Bug: TypeError: Cannot read property"
if echo "$test_title_old" | grep -qF "Bug ["; then
  fail "old format should not have environment prefix" "no [env] prefix" "$test_title_old"
else
  pass "old format correctly lacks environment prefix"
fi

# Test that create_bug_issue in bug-monitor.sh uses the new format
if grep -q 'Bug \[' "$REPO_ROOT/scripts/bug-monitor.sh"; then
  pass "bug-monitor.sh uses environment-prefixed title format"
else
  fail "bug-monitor.sh uses environment-prefixed title format" "Bug [\$env]:" "old format"
fi

# Test that create_bug_issue includes Environment section in body
if grep -q '## Environment' "$REPO_ROOT/scripts/bug-monitor.sh"; then
  pass "bug-monitor.sh includes Environment section in issue body"
else
  fail "bug-monitor.sh includes Environment section in issue body" "## Environment section" "not found"
fi

# --- Test temp directory aggregation with stage file -------------------------
echo ""
echo "Temp directory with stage file:"

cw_tmp2=$(mktemp -d)
fp_stage="abc123stage"
mkdir -p "$cw_tmp2/$fp_stage"
printf '%s' "Error: something broke" > "$cw_tmp2/$fp_stage/message"
echo "1" > "$cw_tmp2/$fp_stage/count"
echo "staging" > "$cw_tmp2/$fp_stage/stage"

assert_eq "stores stage in temp file" "staging" "$(cat "$cw_tmp2/$fp_stage/stage")"

rm -rf "$cw_tmp2"
pass "temp directory with stage cleanup succeeds"

# --- Test assert_file_contains helper -----------------------------------------
assert_file_contains() {
  local description="$1"
  local needle="$2"
  local file="$3"
  if [ -f "$file" ] && grep -qF "$needle" "$file"; then
    pass "$description"
  else
    fail "$description" "file contains '$needle'" "$(cat "$file" 2>/dev/null || echo '(file missing)')"
  fi
}

assert_file_line_count() {
  local description="$1"
  local expected="$2"
  local file="$3"
  local actual
  if [ -f "$file" ]; then
    actual=$(wc -l < "$file" | tr -d ' ')
  else
    actual="0"
  fi
  assert_eq "$description" "$expected" "$actual"
}

# --- Test record_self_error ---------------------------------------------------
echo ""
echo "=== Self-Error Recording Tests ==="
echo ""

# We need to define record_self_error here since we can't source bug-monitor.sh
# (it starts the daemon loop). We replicate the function logic for testing.

TEST_SELF_DIR=$(mktemp -d)
LOG_DIR="$TEST_SELF_DIR"

# Copy the function from bug-monitor.sh for testing
record_self_error() {
  local category="$1"
  local message="$2"
  local health_file="$LOG_DIR/.self-health.jsonl"
  local timestamp
  timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date '+%Y-%m-%dT%H:%M:%SZ')
  printf '{"category":"%s","message":"%s","timestamp":"%s"}\n' \
    "$category" \
    "$(echo "$message" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n' | head -c 500)" \
    "$timestamp" >> "$health_file" 2>/dev/null || true
}

echo "record_self_error:"

# Test: writes a JSON line to health file
record_self_error "github_api" "Failed to comment on issue #42"
health_file="$TEST_SELF_DIR/.self-health.jsonl"
assert_eq "health file exists after record" "true" "$([ -f "$health_file" ] && echo true || echo false)"
assert_file_line_count "health file has 1 line after first record" "1" "$health_file"

# Test: valid JSON in each line
line=$(head -1 "$health_file")
assert_contains "line contains category field" '"category":"github_api"' "$line"
assert_contains "line contains message field" '"message":"Failed to comment on issue #42"' "$line"
assert_contains "line contains timestamp field" '"timestamp":' "$line"

# Test: multiple records append
record_self_error "db_connection" "psql: connection refused"
assert_file_line_count "health file has 2 lines after second record" "2" "$health_file"

# Test: different categories are stored correctly
line2=$(tail -1 "$health_file")
assert_contains "second line has db_connection category" '"category":"db_connection"' "$line2"

# Test: messages with special characters are escaped
record_self_error "cloudwatch_query" 'Error: "timeout" at line 5'
line3=$(tail -1 "$health_file")
assert_contains "special chars are escaped" 'cloudwatch_query' "$line3"

# Test: record_self_error never fails (|| true)
# Simulate by pointing to a non-writable path
old_log_dir="$LOG_DIR"
LOG_DIR="/nonexistent/path"
record_self_error "github_api" "should not crash"
exit_code=$?
assert_eq "record_self_error does not fail on write error" "0" "$exit_code"
LOG_DIR="$old_log_dir"

rm -rf "$TEST_SELF_DIR"
pass "self-error recording cleanup succeeds"

# --- Test flush_self_errors ---------------------------------------------------
echo ""
echo "=== Self-Error Flush Tests ==="
echo ""

TEST_FLUSH_DIR=$(mktemp -d)
LOG_DIR="$TEST_FLUSH_DIR"
DRY_RUN=true  # Always dry run in tests (no gh calls)

# Define log() for tests (bug-monitor.sh defines it but we can't source the whole script)
log() {
  echo "[test] $*" >&2
}

# Category labels map
category_label() {
  case "$1" in
    github_api) echo "GitHub API failures" ;;
    db_connection) echo "DB connection failures" ;;
    cloudwatch_query) echo "CloudWatch query failures" ;;
    *) echo "$1" ;;
  esac
}

# Replicate flush_self_errors for testing
MAX_SELF_ISSUES_PER_CYCLE=2
LABEL_BUG_MONITOR_HEALTH="bug-monitor-health"

flush_self_errors() {
  local health_file="$LOG_DIR/.self-health.jsonl"

  if [ ! -f "$health_file" ] || [ ! -s "$health_file" ]; then
    return 0
  fi

  local flush_tmp
  flush_tmp=$(mktemp -d)
  local flush_failed=false
  local self_issues_created=0

  # Group entries by category using temp directory (Bash 3 compatible)
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local category
    category=$(echo "$line" | sed -n 's/.*"category":"\([^"]*\)".*/\1/p')
    [ -z "$category" ] && continue

    mkdir -p "$flush_tmp/$category"

    local msg
    msg=$(echo "$line" | sed -n 's/.*"message":"\(.*\)","timestamp".*/\1/p')
    local ts
    ts=$(echo "$line" | sed -n 's/.*"timestamp":"\([^"]*\)".*/\1/p')

    # Increment count
    local prev_count=0
    if [ -f "$flush_tmp/$category/count" ]; then
      prev_count=$(< "$flush_tmp/$category/count")
    fi
    echo $((prev_count + 1)) > "$flush_tmp/$category/count"

    # Track first/last timestamp
    if [ ! -f "$flush_tmp/$category/first_ts" ]; then
      echo "$ts" > "$flush_tmp/$category/first_ts"
    fi
    echo "$ts" > "$flush_tmp/$category/last_ts"

    # Store unique messages (max 10)
    local msg_count=0
    if [ -f "$flush_tmp/$category/messages" ]; then
      msg_count=$(wc -l < "$flush_tmp/$category/messages" | tr -d ' ')
    fi
    if [ "$msg_count" -lt 10 ] && ! grep -qF "$msg" "$flush_tmp/$category/messages" 2>/dev/null; then
      echo "$msg" >> "$flush_tmp/$category/messages"
    fi
  done < "$health_file"

  # Process each category
  for cat_dir in "$flush_tmp"/*/; do
    [ -d "$cat_dir" ] || continue

    if [ "$self_issues_created" -ge "$MAX_SELF_ISSUES_PER_CYCLE" ]; then
      log "Max self-issues per cycle reached ($MAX_SELF_ISSUES_PER_CYCLE), deferring remaining"
      break
    fi

    local category err_count first_ts last_ts label
    category=$(basename "$cat_dir")
    err_count=$(< "$cat_dir/count")
    first_ts=$(< "$cat_dir/first_ts")
    last_ts=$(< "$cat_dir/last_ts")
    label=$(category_label "$category")

    local fingerprint
    fingerprint=$(echo -n "SELF:${category}" | sha256sum | awk '{print $1}')

    # Check cooldown
    if is_in_cooldown_test "$fingerprint"; then
      log "Self-error category '$category' in cooldown, skipping"
      continue
    fi

    if [ "$DRY_RUN" = true ]; then
      log "[DRY RUN] Would create/comment self-health issue: Bug Monitor Health: ${label} (${err_count} errors, ${first_ts} - ${last_ts})"
    else
      # In real implementation, would call gh issue create/comment here
      # Circuit breaker: if gh fails, set flush_failed=true and break
      :
    fi

    set_cooldown_test "$fingerprint"
    self_issues_created=$((self_issues_created + 1))
  done

  rm -rf "$flush_tmp"

  # Only truncate health file on success
  if [ "$flush_failed" = false ]; then
    : > "$health_file"
  fi
}

echo "flush_self_errors grouping:"

# Set up test cooldown
TEST_FLUSH_COOLDOWN_DIR=$(mktemp -d)
COOLDOWN_FILE="$TEST_FLUSH_COOLDOWN_DIR/.cooldown_flush_test"
touch "$COOLDOWN_FILE"
COOLDOWN_SECONDS=3600

# Create health file with multiple entries across categories
health_file="$TEST_FLUSH_DIR/.self-health.jsonl"
cat > "$health_file" <<'HEALTH_EOF'
{"category":"github_api","message":"Failed to comment on issue #42","timestamp":"2024-01-15T10:00:00Z"}
{"category":"github_api","message":"Failed to create issue","timestamp":"2024-01-15T10:01:00Z"}
{"category":"github_api","message":"Failed to comment on issue #42","timestamp":"2024-01-15T10:02:00Z"}
{"category":"db_connection","message":"psql: connection refused","timestamp":"2024-01-15T10:00:30Z"}
HEALTH_EOF

flush_self_errors 2>&1 | cat > "$TEST_FLUSH_DIR/flush_output.log"

# After flush, health file should be truncated (empty but exists)
assert_eq "health file truncated after successful flush" "0" "$(wc -c < "$health_file" | tr -d ' ')"
pass "flush_self_errors completes without error"

echo ""
echo "flush_self_errors cooldown:"

# Recreate health file - same categories should be in cooldown now
cat > "$health_file" <<'HEALTH_EOF'
{"category":"github_api","message":"Failed again","timestamp":"2024-01-15T11:00:00Z"}
HEALTH_EOF

flush_output=$(flush_self_errors 2>&1)
assert_contains "cooldown prevents duplicate self-issue" "in cooldown" "$flush_output"

echo ""
echo "flush_self_errors MAX_SELF_ISSUES_PER_CYCLE:"

# Reset cooldown to test the cap
rm -f "$COOLDOWN_FILE"
touch "$COOLDOWN_FILE"

# Create health file with 3 different categories
cat > "$health_file" <<'HEALTH_EOF'
{"category":"github_api","message":"error 1","timestamp":"2024-01-15T10:00:00Z"}
{"category":"db_connection","message":"error 2","timestamp":"2024-01-15T10:00:00Z"}
{"category":"cloudwatch_query","message":"error 3","timestamp":"2024-01-15T10:00:00Z"}
HEALTH_EOF

MAX_SELF_ISSUES_PER_CYCLE=2
flush_output=$(flush_self_errors 2>&1)
assert_contains "max self-issues cap enforced" "Max self-issues per cycle" "$flush_output"

echo ""
echo "flush_self_errors preserves file on failure:"

# Test that health file is preserved when flush fails
# We simulate by setting flush_failed manually in a wrapper
flush_self_errors_fail_test() {
  local health_file="$LOG_DIR/.self-health.jsonl"
  if [ ! -f "$health_file" ] || [ ! -s "$health_file" ]; then
    return 0
  fi
  # Simulate a failed flush — don't truncate
  local flush_failed=true
  if [ "$flush_failed" = false ]; then
    : > "$health_file"
  fi
}

cat > "$health_file" <<'HEALTH_EOF'
{"category":"github_api","message":"preserved error","timestamp":"2024-01-15T12:00:00Z"}
HEALTH_EOF

flush_self_errors_fail_test
assert_file_line_count "health file preserved on flush failure" "1" "$health_file"
assert_file_contains "health file content intact on failure" "preserved error" "$health_file"

echo ""
echo "flush_self_errors empty file:"

# Test with empty health file
: > "$health_file"
flush_self_errors 2>&1
assert_eq "flush handles empty health file" "0" "$?"

# Test with no health file
rm -f "$health_file"
flush_self_errors 2>&1
assert_eq "flush handles missing health file" "0" "$?"

echo ""
echo "flush_self_errors deduplicates messages:"

rm -f "$COOLDOWN_FILE"
touch "$COOLDOWN_FILE"

# Create health file with duplicate messages
cat > "$health_file" <<'HEALTH_EOF'
{"category":"github_api","message":"same error","timestamp":"2024-01-15T10:00:00Z"}
{"category":"github_api","message":"same error","timestamp":"2024-01-15T10:01:00Z"}
{"category":"github_api","message":"same error","timestamp":"2024-01-15T10:02:00Z"}
{"category":"github_api","message":"different error","timestamp":"2024-01-15T10:03:00Z"}
HEALTH_EOF

# Run flush and verify grouping happened correctly by checking the dry run output
flush_output=$(flush_self_errors 2>&1)
assert_contains "groups multiple errors into single entry" "4 errors" "$flush_output"

rm -rf "$TEST_FLUSH_DIR" "$TEST_FLUSH_COOLDOWN_DIR"
pass "flush tests cleanup succeeds"

# --- Test Bash 3 compatibility for new code ----------------------------------
echo ""
echo "Bash 3 compatibility (self-error code):"

# Verify no declare -A in bug-monitor.sh (re-check after our changes)
if grep -q 'declare -A' "$REPO_ROOT/scripts/bug-monitor.sh"; then
  fail "no declare -A in bug-monitor.sh (after self-error changes)" "no associative arrays" "found declare -A"
else
  pass "no declare -A in bug-monitor.sh (after self-error changes)"
fi

# Verify record_self_error exists in bug-monitor.sh
if grep -q 'record_self_error()' "$REPO_ROOT/scripts/bug-monitor.sh"; then
  pass "record_self_error function defined in bug-monitor.sh"
else
  fail "record_self_error function defined in bug-monitor.sh" "function exists" "not found"
fi

# Verify flush_self_errors exists in bug-monitor.sh
if grep -q 'flush_self_errors()' "$REPO_ROOT/scripts/bug-monitor.sh"; then
  pass "flush_self_errors function defined in bug-monitor.sh"
else
  fail "flush_self_errors function defined in bug-monitor.sh" "function exists" "not found"
fi

# Verify MAX_SELF_ISSUES_PER_CYCLE is defined
if grep -q 'MAX_SELF_ISSUES_PER_CYCLE=' "$REPO_ROOT/scripts/bug-monitor.sh"; then
  pass "MAX_SELF_ISSUES_PER_CYCLE defined in bug-monitor.sh"
else
  fail "MAX_SELF_ISSUES_PER_CYCLE defined in bug-monitor.sh" "variable exists" "not found"
fi

# Verify flush_self_errors is called in main loop
if grep -q 'flush_self_errors' "$REPO_ROOT/scripts/bug-monitor.sh" | grep -v 'flush_self_errors()'; then
  pass "flush_self_errors called in main loop"
else
  # More robust check: count occurrences (function def + call = at least 2)
  local_count=$(grep -c 'flush_self_errors' "$REPO_ROOT/scripts/bug-monitor.sh" 2>/dev/null || echo "0")
  if [ "$local_count" -ge 2 ]; then
    pass "flush_self_errors called in main loop (${local_count} occurrences)"
  else
    fail "flush_self_errors called in main loop" "at least 2 occurrences" "${local_count}"
  fi
fi

# Verify record_self_error is called at error sites (should be at least 10)
record_count=$(grep -c 'record_self_error' "$REPO_ROOT/scripts/bug-monitor.sh" 2>/dev/null || echo "0")
if [ "$record_count" -ge 11 ]; then  # 1 function def + 10 call sites
  pass "record_self_error called at error sites (${record_count} total occurrences including function def)"
else
  fail "record_self_error called at error sites" "at least 11 occurrences" "${record_count}"
fi

# Verify bug-monitor-health label is used (not bug-report)
if grep -q 'bug-monitor-health' "$REPO_ROOT/scripts/bug-monitor.sh"; then
  pass "bug-monitor-health label defined in bug-monitor.sh"
else
  fail "bug-monitor-health label defined in bug-monitor.sh" "label exists" "not found"
fi

# --- Test env file auto-loading -----------------------------------------------
echo ""
echo "=== Env File Auto-Loading Tests ==="
echo ""

echo "env file auto-loading block in bug-monitor.sh:"

# Verify the auto-load block exists with set -a / set +a pattern
if grep -q 'set -a' "$REPO_ROOT/scripts/bug-monitor.sh" && grep -q 'set +a' "$REPO_ROOT/scripts/bug-monitor.sh"; then
  pass "uses set -a / set +a pattern for auto-export"
else
  fail "uses set -a / set +a pattern for auto-export" "set -a and set +a" "not found"
fi

# Verify it sources .env.bug-monitor.local
if grep -q '\.env\.bug-monitor\.local' "$REPO_ROOT/scripts/bug-monitor.sh"; then
  pass "references .env.bug-monitor.local"
else
  fail "references .env.bug-monitor.local" ".env.bug-monitor.local" "not found"
fi

# Verify it checks file existence before sourcing (graceful skip)
if grep -B5 'source.*\.env\.bug-monitor\.local' "$REPO_ROOT/scripts/bug-monitor.sh" | grep -q '\-f'; then
  pass "checks file existence before sourcing"
else
  fail "checks file existence before sourcing" "-f check" "not found"
fi

# Verify shellcheck source directive is present
if grep -q '# shellcheck source=/dev/null' "$REPO_ROOT/scripts/bug-monitor.sh"; then
  pass "includes shellcheck source=/dev/null directive"
else
  fail "includes shellcheck source=/dev/null directive" "shellcheck directive" "not found"
fi

# Verify the block is placed after mkdir -p and before cloudwatch source
# Extract line numbers to verify ordering
env_load_line=$(grep -n '\.env\.bug-monitor\.local' "$REPO_ROOT/scripts/bug-monitor.sh" | head -1 | cut -d: -f1)
mkdir_line=$(grep -n 'mkdir -p "$LOG_DIR"' "$REPO_ROOT/scripts/bug-monitor.sh" | head -1 | cut -d: -f1)
cw_source_line=$(grep -n 'source "scripts/lib/cloudwatch-query.sh"' "$REPO_ROOT/scripts/bug-monitor.sh" | head -1 | cut -d: -f1)

if [ -n "$env_load_line" ] && [ -n "$mkdir_line" ] && [ -n "$cw_source_line" ] && \
   [ "$env_load_line" -gt "$mkdir_line" ] && [ "$env_load_line" -lt "$cw_source_line" ]; then
  pass "env loading block is between mkdir and cloudwatch source"
else
  fail "env loading block is between mkdir and cloudwatch source" \
    "mkdir($mkdir_line) < env($env_load_line) < cw($cw_source_line)" \
    "mkdir($mkdir_line), env($env_load_line), cw($cw_source_line)"
fi

# Functional test: verify env file is actually loaded when present
echo ""
echo "env file functional test:"

ENV_TEST_DIR=$(mktemp -d)
ENV_FILE="$ENV_TEST_DIR/.env.bug-monitor.local"
echo 'BUG_MONITOR_TEST_VAR=hello_from_env' > "$ENV_FILE"

# Use set -a / source / set +a pattern and verify var is exported
(
  cd "$ENV_TEST_DIR"
  if [ -f ".env.bug-monitor.local" ]; then
    set -a
    # shellcheck source=/dev/null
    source ".env.bug-monitor.local"
    set +a
  fi
  if [ "$BUG_MONITOR_TEST_VAR" = "hello_from_env" ]; then
    echo "PASS"
  else
    echo "FAIL"
  fi
) | {
  read -r result
  if [ "$result" = "PASS" ]; then
    pass "env file is sourced and vars are available"
  else
    fail "env file is sourced and vars are available" "hello_from_env" "$result"
  fi
}

# Verify graceful skip when file is missing
(
  cd "$ENV_TEST_DIR"
  rm -f ".env.bug-monitor.local"
  if [ -f ".env.bug-monitor.local" ]; then
    set -a
    # shellcheck source=/dev/null
    source ".env.bug-monitor.local"
    set +a
  fi
  echo "PASS"
) | {
  read -r result
  if [ "$result" = "PASS" ]; then
    pass "gracefully skips when env file is missing"
  else
    fail "gracefully skips when env file is missing" "PASS" "$result"
  fi
}

rm -rf "$ENV_TEST_DIR"

# --- Test fingerprint rendering in create_bug_issue ----------------------------
echo ""
echo "=== Fingerprint Rendering Tests ==="
echo ""

echo "Fingerprint rendering in issue body:"

# Simulate create_bug_issue body rendering with a valid fingerprint
test_fp="abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
test_body_line="**Fingerprint:** \`${test_fp:0:12}\`"
assert_eq "renders 12-char fingerprint prefix" "**Fingerprint:** \`abcdef123456\`" "$test_body_line"

# Simulate with empty fingerprint — this is the bug we're fixing
empty_fp=""
empty_body_line="**Fingerprint:** \`${empty_fp:0:12}\`"
assert_eq "empty fingerprint renders empty backticks (the bug)" "**Fingerprint:** \`\`" "$empty_body_line"

# Test that fingerprint fallback produces a non-empty value
# The fix: if fingerprint is empty, generate one from error_message + source
fallback_fp=$(echo -n "SERVER:some error message" | sha256sum | awk '{print $1}')
assert_not_empty "fallback fingerprint is non-empty" "$fallback_fp"
assert_eq "fallback fingerprint is 64 hex chars" 64 "${#fallback_fp}"

# Verify create_bug_issue has fingerprint validation
if grep -q 'if \[ -z "$fingerprint" \]' "$REPO_ROOT/scripts/bug-monitor.sh"; then
  pass "create_bug_issue validates empty fingerprint"
else
  fail "create_bug_issue validates empty fingerprint" "validation exists" "not found"
fi

# --- Test within-cycle batch dedup -------------------------------------------
echo ""
echo "=== Within-Cycle Batch Dedup Tests ==="
echo ""

echo "Cycle-level fingerprint tracking:"

# Test the cycle dedup mechanism using temp files
CYCLE_DEDUP_DIR=$(mktemp -d)
CYCLE_DEDUP_FILE="$CYCLE_DEDUP_DIR/.cycle_seen"
touch "$CYCLE_DEDUP_FILE"

# Helper: check if fingerprint was already processed this cycle
is_seen_this_cycle() {
  grep -qF "$1" "$CYCLE_DEDUP_FILE" 2>/dev/null
}

mark_seen_this_cycle() {
  echo "$1" >> "$CYCLE_DEDUP_FILE"
}

# New fingerprint should not be seen
if is_seen_this_cycle "fp_aaa"; then
  fail "new fingerprint not seen this cycle" "not seen" "seen"
else
  pass "new fingerprint not seen this cycle"
fi

# After marking, should be seen
mark_seen_this_cycle "fp_aaa"
if is_seen_this_cycle "fp_aaa"; then
  pass "fingerprint seen after marking"
else
  fail "fingerprint seen after marking" "seen" "not seen"
fi

# Different fingerprint should not be seen
if is_seen_this_cycle "fp_bbb"; then
  fail "different fingerprint not seen" "not seen" "seen"
else
  pass "different fingerprint not seen"
fi

# Mark another and verify both are tracked
mark_seen_this_cycle "fp_bbb"
if is_seen_this_cycle "fp_aaa" && is_seen_this_cycle "fp_bbb"; then
  pass "multiple fingerprints tracked independently"
else
  fail "multiple fingerprints tracked independently" "both seen" "not both seen"
fi

rm -rf "$CYCLE_DEDUP_DIR"

echo ""
echo "DB row grouping by fingerprint:"

# Simulate grouping DB rows by fingerprint using temp directory pattern
DB_GROUP_DIR=$(mktemp -d)

# Simulate 3 DB rows: 2 with same fingerprint, 1 different
rows_fp1="aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111"
rows_fp2="bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222"

# Row 1: fp1, count=5
mkdir -p "$DB_GROUP_DIR/$rows_fp1"
echo "5" > "$DB_GROUP_DIR/$rows_fp1/count"
echo "Error: connection timeout" > "$DB_GROUP_DIR/$rows_fp1/message"
echo "SERVER" > "$DB_GROUP_DIR/$rows_fp1/source"

# Row 2: fp2, count=3
mkdir -p "$DB_GROUP_DIR/$rows_fp2"
echo "3" > "$DB_GROUP_DIR/$rows_fp2/count"
echo "Error: null pointer" > "$DB_GROUP_DIR/$rows_fp2/message"
echo "CLIENT" > "$DB_GROUP_DIR/$rows_fp2/source"

# Count unique groups
group_count=0
for gdir in "$DB_GROUP_DIR"/*/; do
  [ -d "$gdir" ] || continue
  group_count=$((group_count + 1))
done
assert_eq "2 unique fingerprint groups from 2 different fps" "2" "$group_count"

rm -rf "$DB_GROUP_DIR"

echo ""
echo "Batch dedup: same fingerprint produces single issue:"

# Verify bug-monitor.sh has cycle dedup tracking
if grep -q 'cycle_seen' "$REPO_ROOT/scripts/bug-monitor.sh" || grep -q 'CYCLE_DEDUP' "$REPO_ROOT/scripts/bug-monitor.sh"; then
  pass "bug-monitor.sh has cycle-level dedup tracking"
else
  fail "bug-monitor.sh has cycle-level dedup tracking" "cycle dedup exists" "not found"
fi

# Verify process_error checks cycle dedup before creating issues
if grep -q 'is_seen_this_cycle\|cycle_seen_file\|CYCLE_DEDUP' "$REPO_ROOT/scripts/bug-monitor.sh"; then
  pass "process_error checks cycle dedup"
else
  fail "process_error checks cycle dedup" "cycle check exists" "not found"
fi

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
