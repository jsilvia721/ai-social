#!/usr/bin/env bash
# issue-daemon-already-complete.test.sh — Tests that run_worker does not apply
# claude-blocked when the issue-worker already marked it as claude-done or closed it.
#
# Run: bash scripts/__tests__/issue-daemon-already-complete.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DAEMON_SCRIPT="$REPO_ROOT/scripts/issue-daemon.sh"

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

assert_grep() {
  local description="$1"
  local pattern="$2"
  local file="$3"
  if grep -qE "$pattern" "$file"; then
    pass "$description"
  else
    fail "$description" "pattern '$pattern' found" "not found"
  fi
}

# Helper: extract a bash function body from script by name
extract_function() {
  local func_name="$1"
  local file="$2"
  awk "
    /^${func_name}\\(\\)/ { found=1; next }
    found && /^[a-z_]+\\(\\) \\{/ { exit }
    found { print }
  " "$file"
}

echo ""
echo "=== Already-Complete Detection Tests ==="

# ==============================================================================
# Part 1: run_worker fetches labels and state before the if/elif/else chain
# ==============================================================================
echo ""
echo "Post-exit label/state fetching:"

run_worker_body=$(extract_function 'run_worker' "$DAEMON_SCRIPT")

# The labels+state fetch must happen BEFORE the PR-success if block
# We check that gh issue view with labels,state appears before the PR if/elif/else
tmp_file=$(mktemp)
echo "$run_worker_body" > "$tmp_file"

assert_grep "run_worker fetches labels and state via gh issue view" \
  'gh issue view.*--json.*labels.*state' "$tmp_file"

# ==============================================================================
# Part 2: run_worker checks for LABEL_DONE before applying LABEL_BLOCKED
# ==============================================================================
echo ""
echo "Already-complete detection:"

assert_grep "run_worker checks for LABEL_DONE in post-exit logic" \
  'LABEL_DONE' "$tmp_file"

# The LABEL_DONE check should appear as an elif between the PR success and blocked paths
# Look for elif with LABEL_DONE or CLOSED
assert_grep "elif branch checks for done label or CLOSED state" \
  'elif.*LABEL_DONE|elif.*CLOSED' "$tmp_file"

# ==============================================================================
# Part 3: Already-complete path clears session and removes WIP
# ==============================================================================
echo ""
echo "Already-complete cleanup:"

# When already complete, should clear session ID
assert_grep "already-complete path calls clear_session_id" \
  'clear_session_id' "$tmp_file"

# ==============================================================================
# Part 4: LABEL_BLOCKED still applied when issue is NOT done/closed and no PR
# ==============================================================================
echo ""
echo "Blocked fallback preserved:"

# The else branch should still have LABEL_BLOCKED
assert_grep "else branch still applies LABEL_BLOCKED" \
  'LABEL_BLOCKED' "$tmp_file"

assert_grep "else branch still calls record_failure" \
  'record_failure' "$tmp_file"

# ==============================================================================
# Part 5: Order verification — already-complete check comes BEFORE blocked fallback
# ==============================================================================
echo ""
echo "Order verification:"

# The LABEL_DONE/CLOSED elif should appear before LABEL_BLOCKED else
done_line=$(echo "$run_worker_body" | grep -n 'LABEL_DONE\|CLOSED' | head -1 | cut -d: -f1)
blocked_line=$(echo "$run_worker_body" | grep -n 'record_failure' | head -1 | cut -d: -f1)

if [ -n "$done_line" ] && [ -n "$blocked_line" ]; then
  if [ "$done_line" -lt "$blocked_line" ]; then
    pass "already-complete check (line $done_line) comes before blocked fallback (line $blocked_line)"
  else
    fail "already-complete check comes before blocked fallback" "done line $done_line < blocked line $blocked_line" "done=$done_line, blocked=$blocked_line"
  fi
else
  fail "both done and blocked checks found" "both present" "done=${done_line:-empty}, blocked=${blocked_line:-empty}"
fi

# ==============================================================================
# Part 6: Syntax check
# ==============================================================================
echo ""
echo "Syntax:"

if bash -n "$DAEMON_SCRIPT" 2>&1; then
  pass "bash -n syntax check passes"
else
  fail "bash -n syntax check passes" "no errors" "syntax errors"
fi

# --- Cleanup ------------------------------------------------------------------
rm -f "$tmp_file"

# --- Summary ------------------------------------------------------------------
echo ""
echo "=== Results ==="
echo "  ${TESTS_PASSED}/${TESTS_RUN} passed, ${TESTS_FAILED} failed"
echo ""

if [ "$TESTS_FAILED" -gt 0 ]; then
  exit 1
fi
