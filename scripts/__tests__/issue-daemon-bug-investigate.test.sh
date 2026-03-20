#!/usr/bin/env bash
# issue-daemon-bug-investigate.test.sh — Tests for bug-report routing in issue-daemon.sh
#
# Phase 1 consolidation: bug-report issues now route to issue-worker directly
# (previously routed to a separate bug-investigator agent).
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

assert_not_grep() {
  local description="$1"
  local pattern="$2"
  local file="$3"
  if grep -qE "$pattern" "$file"; then
    fail "$description" "pattern '$pattern' NOT found" "found"
  else
    pass "$description"
  fi
}

echo ""
echo "=== Bug-report routing tests (Phase 1 consolidation) ==="
echo ""

# --- Agent consolidation (bug-investigator removed) ---------------------------
echo "Agent consolidation:"

assert_not_grep "run_bug_investigator function removed" \
  '^run_bug_investigator\(\)' "$DAEMON_SCRIPT"

assert_not_grep "bug-investigator agent no longer referenced" \
  'agent "bug-investigator"' "$DAEMON_SCRIPT"

assert_not_grep "LABEL_BUG_INVESTIGATE config var removed" \
  '^LABEL_BUG_INVESTIGATE=' "$DAEMON_SCRIPT"

assert_not_grep "LABEL_BUG_PLANNED config var removed" \
  '^LABEL_BUG_PLANNED=' "$DAEMON_SCRIPT"

assert_not_grep "bug-investigate worker type removed" \
  'record_worker.*"bug-investigate"' "$DAEMON_SCRIPT"

# --- New routing: bug-report → issue-worker -----------------------------------
echo ""
echo "Bug-report routing to issue-worker:"

assert_grep "LABEL_BUG_REPORT config var exists" \
  '^LABEL_BUG_REPORT=' "$DAEMON_SCRIPT"

assert_grep "LABEL_BUG_REPORT is 'bug-report'" \
  'LABEL_BUG_REPORT="bug-report"' "$DAEMON_SCRIPT"

assert_grep "run_worker removes bug-report label on pickup" \
  'remove-label.*LABEL_BUG_REPORT' "$DAEMON_SCRIPT"

assert_grep "CI failure priority checks for bug-report label" \
  'LABEL_BUG_REPORT' "$DAEMON_SCRIPT"

# --- issue-worker.md has bug investigation mode --------------------------------
echo ""
echo "issue-worker.md bug investigation mode:"

WORKER_AGENT="$REPO_ROOT/.claude/agents/issue-worker.md"

assert_grep "issue-worker has Bug Investigation Mode section" \
  '### Bug Investigation Mode' "$WORKER_AGENT"

assert_grep "triggers on bug-report label" \
  'bug-report.*bug-investigate' "$WORKER_AGENT"

assert_grep "includes investigation steps" \
  'Investigate the codebase' "$WORKER_AGENT"

assert_grep "includes escalation path for investigation failure" \
  'cannot identify a root cause' "$WORKER_AGENT"

# --- Deleted agent files -------------------------------------------------------
echo ""
echo "Agent files:"

if [ ! -f "$REPO_ROOT/.claude/agents/bug-investigator.md" ]; then
  pass "bug-investigator.md deleted"
else
  fail "bug-investigator.md deleted" "file not found" "file still exists"
fi

# --- Shellcheck ---------------------------------------------------------------
echo ""
echo "Shellcheck:"
if command -v shellcheck &>/dev/null; then
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
