#!/usr/bin/env bash
# ci-health-monitor.test.sh — Unit tests for check_ci_health() in issue-daemon.sh
#
# Run: bash scripts/__tests__/ci-health-monitor.test.sh
#
# Tests the CI health monitoring by stubbing out gh CLI calls and testing
# the core logic functions in isolation.

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

assert_not_contains() {
  local description="$1"
  local needle="$2"
  local haystack="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    fail "$description" "does not contain '$needle'" "$haystack"
  else
    pass "$description"
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

# --- Test setup ---------------------------------------------------------------
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT

export DAEMON_STATE_DIR="$TEST_DIR/state"
export CI_MONITOR_STATE_FILE="$TEST_DIR/state/ci-monitor-state"
mkdir -p "$DAEMON_STATE_DIR"

# Source daemon-state for ci_monitor_* helpers
source "$REPO_ROOT/scripts/lib/daemon-state.sh"

# Create a mock bin dir for stubbing gh
MOCK_BIN="$TEST_DIR/mock-bin"
mkdir -p "$MOCK_BIN"

# Source the CI health functions from issue-daemon.sh
# We extract just the functions we need by sourcing a helper file
# that defines them. Since check_ci_health is defined inline in
# issue-daemon.sh, we'll source the extracted functions.

# First, let's create a minimal wrapper that defines the functions
# we need to test without running the full daemon.
export LOG_DIR="$TEST_DIR/logs"
mkdir -p "$LOG_DIR"

# Stub log function
log() {
  echo "[test $(date '+%H:%M:%S')] $*" >> "$TEST_DIR/daemon.log"
}

# We need the constants
LABEL_CI_FAILURE="ci-failure"
LABEL_BUG_INVESTIGATE="bug-investigate"
CI_MONITOR_RERUN_TIMEOUT=600

# Source the CI health monitor functions
source "$REPO_ROOT/scripts/lib/ci-health-monitor.sh"

echo ""
echo "=== CI Health Monitor Tests ==="
echo ""

# =============================================================================
# Test 1: Escape hatches
# =============================================================================
echo "escape hatches:"

# Test CI_MONITOR_DISABLED env var
export CI_MONITOR_DISABLED=1
output=$(check_ci_health 2>&1 || true)
log_output=$(cat "$TEST_DIR/daemon.log" 2>/dev/null || echo "")
assert_contains "CI_MONITOR_DISABLED=1 skips check" "CI monitor disabled" "$log_output"
unset CI_MONITOR_DISABLED
: > "$TEST_DIR/daemon.log"

# Test ci-monitor-disabled file
touch "$DAEMON_STATE_DIR/ci-monitor-disabled"
output=$(check_ci_health 2>&1 || true)
log_output=$(cat "$TEST_DIR/daemon.log" 2>/dev/null || echo "")
assert_contains "ci-monitor-disabled file skips check" "CI monitor disabled" "$log_output"
rm -f "$DAEMON_STATE_DIR/ci-monitor-disabled"
: > "$TEST_DIR/daemon.log"

# =============================================================================
# Test 2: filter_ci_runs — filters out unwanted runs
# =============================================================================
echo ""
echo "filter_ci_runs:"

# Clean state
rm -f "$CI_MONITOR_STATE_FILE"

# Input: mix of runs (push failures, non-push, cancelled, in_progress, already tracked)
ci_monitor_track "111" "filed" "fp111" "Deploy" "" ""

runs_json='[
  {"databaseId": 100, "conclusion": "failure", "workflowName": "CI", "event": "push", "headSha": "abc123"},
  {"databaseId": 101, "conclusion": "cancelled", "workflowName": "CI", "event": "push", "headSha": "abc124"},
  {"databaseId": 102, "conclusion": "failure", "workflowName": "CI", "event": "pull_request", "headSha": "abc125"},
  {"databaseId": 103, "conclusion": null, "workflowName": "CI", "event": "push", "headSha": "abc126"},
  {"databaseId": 104, "conclusion": "skipped", "workflowName": "Deploy", "event": "push", "headSha": "abc127"},
  {"databaseId": 111, "conclusion": "failure", "workflowName": "Deploy", "event": "push", "headSha": "abc128"},
  {"databaseId": 200, "conclusion": "failure", "workflowName": "Deploy", "event": "push", "headSha": "def456"}
]'

result=$(filter_ci_runs "$runs_json")
result_ids=$(echo "$result" | jq -r '.[].databaseId' 2>/dev/null || echo "")

assert_contains "keeps push failure run 100" "100" "$result_ids"
assert_contains "keeps push failure run 200" "200" "$result_ids"
assert_not_contains "filters cancelled run 101" "101" "$result_ids"
assert_not_contains "filters non-push run 102" "102" "$result_ids"
assert_not_contains "filters in-progress run 103" "103" "$result_ids"
assert_not_contains "filters skipped run 104" "104" "$result_ids"
assert_not_contains "filters already-tracked run 111" "111" "$result_ids"

# =============================================================================
# Test 3: generate_ci_fingerprint
# =============================================================================
echo ""
echo "generate_ci_fingerprint:"

fp=$(generate_ci_fingerprint "CI" "abc123")
assert_not_empty "generates non-empty fingerprint" "$fp"
assert_eq "fingerprint is deterministic" "$fp" "$(generate_ci_fingerprint "CI" "abc123")"

fp2=$(generate_ci_fingerprint "Deploy" "abc123")
if [ "$fp" != "$fp2" ]; then
  pass "different workflow produces different fingerprint"
else
  fail "different workflow produces different fingerprint" "different" "same"
fi

# =============================================================================
# Test 4: truncate_ci_logs
# =============================================================================
echo ""
echo "truncate_ci_logs:"

# Test with error lines
log_input="Line 1: normal output
Line 2: normal output
Line 3: FAIL src/__tests__/api/posts.test.ts
Line 4:   Expected: 200
Line 5:   Received: 500
Line 6: normal output
Line 7: Error: connection refused
Line 8: normal output
Line 9: TypeError: Cannot read property
Line 10: normal output"

result=$(truncate_ci_logs "$log_input")
assert_contains "includes FAIL line" "FAIL" "$result"
assert_contains "includes Error line" "Error:" "$result"
assert_contains "includes TypeError line" "TypeError" "$result"

# Test character limit (4000 chars)
long_log=""
for i in $(seq 1 300); do
  long_log+="Line $i: FAIL this is a test error line that should be truncated eventually
"
done
result=$(truncate_ci_logs "$long_log")
char_count=${#result}
if [ "$char_count" -le 4000 ]; then
  pass "truncates to ≤4000 chars (got $char_count)"
else
  fail "truncates to ≤4000 chars" "≤4000" "$char_count"
fi

# Test line limit (150 lines)
result_lines=$(echo "$result" | wc -l | tr -d ' ')
if [ "$result_lines" -le 150 ]; then
  pass "truncates to ≤150 lines (got $result_lines)"
else
  fail "truncates to ≤150 lines" "≤150" "$result_lines"
fi

# =============================================================================
# Test 5: format_ci_issue_body
# =============================================================================
echo ""
echo "format_ci_issue_body:"

body=$(format_ci_issue_body \
  "https://github.com/test/repo/actions/runs/12345" \
  "CI" \
  "abc123" \
  "Some error logs here" \
  "ci-fp-abc123" \
  "rerun succeeded")

assert_contains "includes run URL" "https://github.com/test/repo/actions/runs/12345" "$body"
assert_contains "includes workflow name" "CI" "$body"
assert_contains "includes commit SHA" "abc123" "$body"
assert_contains "includes error logs" "Some error logs here" "$body"
assert_contains "includes fingerprint" "ci-fp-abc123" "$body"
assert_contains "includes rerun result" "rerun succeeded" "$body"

# =============================================================================
# Test 6: check_ci_health integration — new failure detection + rerun
# =============================================================================
echo ""
echo "check_ci_health — new failure detection:"

# Clean state
rm -f "$CI_MONITOR_STATE_FILE"
: > "$TEST_DIR/daemon.log"

# Stub gh to return a failed run
export GH_STUB_MODE="new_failure"
export PATH="$MOCK_BIN:$PATH"

cat > "$MOCK_BIN/gh" << 'GHSTUB'
#!/usr/bin/env bash
case "$*" in
  *"run list"*)
    echo '[{"databaseId": 500, "conclusion": "failure", "workflowName": "CI", "event": "push", "headSha": "sha500"}]'
    ;;
  *"run rerun"*)
    echo "Requested rerun"
    exit 0
    ;;
  *"run view"*"--log-failed"*)
    echo "FAIL src/__tests__/api/posts.test.ts"
    echo "  Error: expected 200, got 500"
    ;;
  *"run view"*)
    echo '{"status": "completed", "conclusion": "success"}'
    ;;
  *"issue list"*"ci-failure"*)
    echo "[]"
    ;;
  *"issue create"*)
    echo "https://github.com/test/repo/issues/999"
    ;;
  *)
    echo "gh stub: unhandled: $*" >&2
    ;;
esac
GHSTUB
chmod +x "$MOCK_BIN/gh"

check_ci_health
status=$(ci_monitor_status "500")
assert_eq "new failure tracked as rerunning" "rerunning" "$status"

# =============================================================================
# Test 7: check_ci_health — rerun follow-up (success → resolved)
# =============================================================================
echo ""
echo "check_ci_health — rerun success → green check:"

# Set up: run 500 is in rerunning state, gh shows latest main is green
ci_monitor_update "500" "rerunning" "" "$(date +%s)"
: > "$TEST_DIR/daemon.log"

cat > "$MOCK_BIN/gh" << 'GHSTUB'
#!/usr/bin/env bash
case "$*" in
  *"run list"*"--limit 10"*)
    echo '[{"databaseId": 500, "conclusion": "success", "workflowName": "CI", "event": "push", "headSha": "sha500"}]'
    ;;
  *"run list"*"--limit 1"*)
    # Latest run on main is green
    echo '[{"databaseId": 501, "conclusion": "success", "workflowName": "CI", "event": "push", "headSha": "sha501"}]'
    ;;
  *"run view 500"*)
    echo '{"status": "completed", "conclusion": "success"}'
    ;;
  *)
    echo "gh stub: unhandled: $*" >&2
    ;;
esac
GHSTUB
chmod +x "$MOCK_BIN/gh"

check_ci_health
status=$(ci_monitor_status "500")
assert_eq "rerun success + green check → resolved" "resolved" "$status"

# =============================================================================
# Test 8: check_ci_health — rerun failure → file issue
# =============================================================================
echo ""
echo "check_ci_health — rerun failure → file issue:"

# Clean state
rm -f "$CI_MONITOR_STATE_FILE"
: > "$TEST_DIR/daemon.log"
rerun_epoch=$(( $(date +%s) - 60 ))  # rerun started 60s ago
ci_monitor_track "600" "rerunning" "fp600" "CI" "" "$rerun_epoch"

cat > "$MOCK_BIN/gh" << 'GHSTUB'
#!/usr/bin/env bash
case "$*" in
  *"run list"*"--limit 10"*)
    echo '[{"databaseId": 600, "conclusion": "failure", "workflowName": "CI", "event": "push", "headSha": "sha600"}]'
    ;;
  *"run list"*"--limit 1"*)
    echo '[{"databaseId": 600, "conclusion": "failure", "workflowName": "CI", "event": "push", "headSha": "sha600"}]'
    ;;
  *"run view 600"*"--log-failed"*)
    echo "FAIL src/__tests__/api/posts.test.ts"
    echo "  Error: expected 200, got 500"
    echo "  TypeError: Cannot read property 'x' of null"
    ;;
  *"run view 600"*)
    echo '{"status": "completed", "conclusion": "failure"}'
    ;;
  *"issue list"*"ci-failure"*)
    echo "[]"
    ;;
  *"issue create"*)
    echo "https://github.com/test/repo/issues/888"
    ;;
  *)
    echo "gh stub: unhandled: $*" >&2
    ;;
esac
GHSTUB
chmod +x "$MOCK_BIN/gh"

check_ci_health
status=$(ci_monitor_status "600")
assert_eq "rerun failure → filed" "filed" "$status"

# =============================================================================
# Test 9: check_ci_health — rerun timeout → file issue
# =============================================================================
echo ""
echo "check_ci_health — rerun timeout → file issue:"

rm -f "$CI_MONITOR_STATE_FILE"
: > "$TEST_DIR/daemon.log"
old_rerun_epoch=$(( $(date +%s) - 700 ))  # 700s ago > 600s timeout
ci_monitor_track "700" "rerunning" "fp700" "Deploy" "" "$old_rerun_epoch"

cat > "$MOCK_BIN/gh" << 'GHSTUB'
#!/usr/bin/env bash
case "$*" in
  *"run list"*"--limit 10"*)
    echo '[{"databaseId": 700, "conclusion": null, "workflowName": "Deploy", "event": "push", "headSha": "sha700"}]'
    ;;
  *"run list"*"--limit 1"*)
    echo '[{"databaseId": 700, "conclusion": null, "workflowName": "Deploy", "event": "push", "headSha": "sha700"}]'
    ;;
  *"run view 700"*"--log-failed"*)
    echo "Error: deployment timed out"
    ;;
  *"run view 700"*)
    echo '{"status": "in_progress", "conclusion": null}'
    ;;
  *"issue list"*"ci-failure"*)
    echo "[]"
    ;;
  *"issue create"*)
    echo "https://github.com/test/repo/issues/777"
    ;;
  *)
    echo "gh stub: unhandled: $*" >&2
    ;;
esac
GHSTUB
chmod +x "$MOCK_BIN/gh"

check_ci_health
status=$(ci_monitor_status "700")
assert_eq "rerun timeout → filed" "filed" "$status"
log_output=$(cat "$TEST_DIR/daemon.log")
assert_contains "logs timeout" "timed out" "$log_output"

# =============================================================================
# Test 10: Duplicate fingerprint prevention
# =============================================================================
echo ""
echo "duplicate fingerprint prevention:"

rm -f "$CI_MONITOR_STATE_FILE"
: > "$TEST_DIR/daemon.log"
# Create an existing filed entry with the same fingerprint
ci_monitor_track "800" "filed" "fp-dup" "CI" "42" ""

cat > "$MOCK_BIN/gh" << 'GHSTUB'
#!/usr/bin/env bash
case "$*" in
  *"run list"*"--limit 10"*)
    echo '[{"databaseId": 801, "conclusion": "failure", "workflowName": "CI", "event": "push", "headSha": "sha-dup"}]'
    ;;
  *"run rerun"*)
    echo "Requested rerun"
    exit 0
    ;;
  *"run view"*)
    echo '{"status": "completed", "conclusion": "failure"}'
    ;;
  *"issue list"*"ci-failure"*)
    echo "[]"
    ;;
  *"issue create"*)
    echo "ERROR: should not be called" >&2
    exit 1
    ;;
  *)
    echo "gh stub: unhandled: $*" >&2
    ;;
esac
GHSTUB
chmod +x "$MOCK_BIN/gh"

# Override fingerprint to match the existing one
export CI_FINGERPRINT_OVERRIDE="fp-dup"
check_ci_health
unset CI_FINGERPRINT_OVERRIDE

log_output=$(cat "$TEST_DIR/daemon.log")
assert_contains "skips duplicate fingerprint" "duplicate" "$log_output"

# =============================================================================
# Test 11: API errors don't trigger circuit breaker
# =============================================================================
echo ""
echo "API error handling:"

rm -f "$CI_MONITOR_STATE_FILE"
: > "$TEST_DIR/daemon.log"

# Stub gh to fail on run list
cat > "$MOCK_BIN/gh" << 'GHSTUB'
#!/usr/bin/env bash
case "$*" in
  *"run list"*)
    echo "HTTP 502: Bad Gateway" >&2
    exit 1
    ;;
  *)
    echo "gh stub: unhandled: $*" >&2
    ;;
esac
GHSTUB
chmod +x "$MOCK_BIN/gh"

# check_ci_health should not exit with error (no circuit breaker)
if check_ci_health 2>/dev/null; then
  pass "API error does not cause check_ci_health to fail"
else
  fail "API error does not cause check_ci_health to fail" "exit 0" "non-zero exit"
fi

log_output=$(cat "$TEST_DIR/daemon.log")
assert_contains "logs API error" "API error" "$log_output"

# =============================================================================
# Test 12: gh run rerun failure → skip rerun, proceed to filing
# =============================================================================
echo ""
echo "rerun failure handling:"

rm -f "$CI_MONITOR_STATE_FILE"
: > "$TEST_DIR/daemon.log"

cat > "$MOCK_BIN/gh" << 'GHSTUB'
#!/usr/bin/env bash
case "$*" in
  *"run list"*"--limit 10"*)
    echo '[{"databaseId": 900, "conclusion": "failure", "workflowName": "CI", "event": "push", "headSha": "sha900"}]'
    ;;
  *"run rerun"*)
    echo "Error: unable to rerun" >&2
    exit 1
    ;;
  *"run list"*"--limit 1"*)
    echo '[{"databaseId": 900, "conclusion": "failure", "workflowName": "CI", "event": "push", "headSha": "sha900"}]'
    ;;
  *"run view"*"--log-failed"*)
    echo "FAIL test"
    echo "Error: something broke"
    ;;
  *"run view"*)
    echo '{"status": "completed", "conclusion": "failure"}'
    ;;
  *"issue list"*"ci-failure"*)
    echo "[]"
    ;;
  *"issue create"*)
    echo "https://github.com/test/repo/issues/901"
    ;;
  *)
    echo "gh stub: unhandled: $*" >&2
    ;;
esac
GHSTUB
chmod +x "$MOCK_BIN/gh"

check_ci_health
status=$(ci_monitor_status "900")
assert_eq "rerun failure → filed directly" "filed" "$status"
log_output=$(cat "$TEST_DIR/daemon.log")
assert_contains "logs rerun failure" "rerun failed" "$log_output"

# =============================================================================
# Test 13: Green-check before filing
# =============================================================================
echo ""
echo "green-check before filing:"

rm -f "$CI_MONITOR_STATE_FILE"
: > "$TEST_DIR/daemon.log"
rerun_epoch=$(( $(date +%s) - 60 ))
ci_monitor_track "950" "rerunning" "fp950" "CI" "" "$rerun_epoch"

cat > "$MOCK_BIN/gh" << 'GHSTUB'
#!/usr/bin/env bash
case "$*" in
  *"run list"*"--limit 10"*)
    echo '[{"databaseId": 950, "conclusion": "failure", "workflowName": "CI", "event": "push", "headSha": "sha950"}]'
    ;;
  *"run view 950"*)
    echo '{"status": "completed", "conclusion": "failure"}'
    ;;
  *"run list"*"--limit 1"*)
    # Latest main run is NOW green (different, newer run)
    echo '[{"databaseId": 951, "conclusion": "success", "workflowName": "CI", "event": "push", "headSha": "sha951"}]'
    ;;
  *"issue create"*)
    echo "ERROR: should not file" >&2
    exit 1
    ;;
  *)
    echo "gh stub: unhandled: $*" >&2
    ;;
esac
GHSTUB
chmod +x "$MOCK_BIN/gh"

check_ci_health
status=$(ci_monitor_status "950")
assert_eq "green-check skips filing → resolved" "resolved" "$status"

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "=== Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed ==="

if [ "$TESTS_FAILED" -gt 0 ]; then
  exit 1
fi
