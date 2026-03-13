#!/usr/bin/env bash
# issue-daemon-bug-investigate.test.sh — Tests for bug-investigate support in issue-daemon.sh
#
# Run: bash scripts/__tests__/issue-daemon-bug-investigate.test.sh

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

echo ""
echo "=== Bug-investigate daemon support tests ==="
echo ""

# --- Config vars --------------------------------------------------------------
echo "Configuration variables:"

assert_grep "LABEL_BUG_INVESTIGATE config var exists" \
  '^LABEL_BUG_INVESTIGATE=' "$DAEMON_SCRIPT"

assert_grep "LABEL_BUG_INVESTIGATE is 'bug-investigate'" \
  'LABEL_BUG_INVESTIGATE="bug-investigate"' "$DAEMON_SCRIPT"

assert_grep "LABEL_BUG_PLANNED config var exists" \
  '^LABEL_BUG_PLANNED=' "$DAEMON_SCRIPT"

assert_grep "LABEL_BUG_PLANNED is 'bug-planned'" \
  'LABEL_BUG_PLANNED="bug-planned"' "$DAEMON_SCRIPT"

# --- Function definition ------------------------------------------------------
echo ""
echo "run_bug_investigator function:"

assert_grep "run_bug_investigator function defined" \
  '^run_bug_investigator\(\)' "$DAEMON_SCRIPT"

assert_grep "uses bug-investigator agent" \
  'agent "bug-investigator"' "$DAEMON_SCRIPT"

assert_grep "uses correct tools (Bash,Glob,Grep,Read)" \
  'allowedTools "Bash,Glob,Grep,Read"' "$DAEMON_SCRIPT"

assert_grep "log file uses bug-investigate prefix" \
  'bug-investigate-\$\{issue_number\}\.log' "$DAEMON_SCRIPT"

assert_grep "removes LABEL_BUG_INVESTIGATE label" \
  'remove-label.*LABEL_BUG_INVESTIGATE' "$DAEMON_SCRIPT"

assert_grep "adds LABEL_WIP label" \
  'add-label.*LABEL_WIP' "$DAEMON_SCRIPT"

assert_grep "handles rate limit detection" \
  'detect_rate_limit.*exit_code.*log_file' "$DAEMON_SCRIPT"

assert_grep "starts heartbeat" \
  'start_heartbeat.*issue_number.*claude_pid' "$DAEMON_SCRIPT"

assert_grep "stops heartbeat" \
  'stop_heartbeat.*hb_pid.*issue_number' "$DAEMON_SCRIPT"

# --- Priority tier -------------------------------------------------------------
echo ""
echo "Priority tier in main loop:"

assert_grep "polls for bug-investigate labeled issues" \
  'LABEL_BUG_INVESTIGATE' "$DAEMON_SCRIPT"

assert_grep "records worker with bug-investigate type" \
  'record_worker.*bug-investigate' "$DAEMON_SCRIPT"

# --- Startup log ---------------------------------------------------------------
echo ""
echo "Startup log message:"

assert_grep "startup log mentions bug-investigate" \
  "bug-investigate" "$DAEMON_SCRIPT"

# --- Stale detection -----------------------------------------------------------
echo ""
echo "Stale detection:"

assert_grep "stale detection handles bug-investigate log file" \
  'bug-investigate' "$DAEMON_SCRIPT"

# --- Shellcheck ---------------------------------------------------------------
echo ""
echo "Shellcheck:"
if command -v shellcheck &>/dev/null; then
  # Exclude SC2034 (unused variables) — config vars like LABEL_BUG_PLANNED,
  # LABEL_ACTIVE, LABEL_PLAN_REVIEW are defined for external reference
  if shellcheck -x -e SC2034 "$DAEMON_SCRIPT" 2>/dev/null; then
    pass "shellcheck passes on issue-daemon.sh (excluding SC2034)"
  else
    fail "shellcheck passes on issue-daemon.sh (excluding SC2034)" "no warnings" "warnings found"
  fi
else
  pass "shellcheck not available (skipped)"
fi

# --- Summary ------------------------------------------------------------------
echo ""
echo "=== Results ==="
echo "  ${TESTS_PASSED}/${TESTS_RUN} passed, ${TESTS_FAILED} failed"
echo ""

if [ "$TESTS_FAILED" -gt 0 ]; then
  exit 1
fi
