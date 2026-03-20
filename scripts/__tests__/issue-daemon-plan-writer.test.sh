#!/usr/bin/env bash
# issue-daemon-plan-writer.test.sh — Tests for plan stub routing in issue-daemon.sh
#
# Phase 1 consolidation: plan stub issues now route to issue-worker directly
# (previously routed to a separate plan-writer agent).
#
# Run: bash scripts/__tests__/issue-daemon-plan-writer.test.sh

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
echo "=== Plan stub routing tests (Phase 1 consolidation) ==="
echo ""

# --- Agent consolidation (plan-writer removed) --------------------------------
echo "Agent consolidation:"

assert_not_grep "run_plan_writer function removed" \
  '^run_plan_writer\(\)' "$DAEMON_SCRIPT"

assert_not_grep "plan-writer agent no longer referenced" \
  'agent "plan-writer"' "$DAEMON_SCRIPT"

assert_not_grep "plan-writer worker type removed" \
  'record_worker.*"plan-writer"' "$DAEMON_SCRIPT"

# --- New routing: plan stubs → issue-worker ------------------------------------
echo ""
echo "Plan stub routing to issue-worker:"

assert_grep "LABEL_PLAN config var exists" \
  '^LABEL_PLAN=' "$DAEMON_SCRIPT"

assert_grep "LABEL_PLAN is 'plan'" \
  'LABEL_PLAN="plan"' "$DAEMON_SCRIPT"

assert_grep "plan stub priority routes to run_worker" \
  'run_worker.*number.*title' "$DAEMON_SCRIPT"

assert_grep "plan stub priority records as worker type" \
  'record_worker.*"worker"' "$DAEMON_SCRIPT"

# --- Label filtering still works -----------------------------------------------
echo ""
echo "Label filtering for plan stubs:"

assert_grep "filters by plan label in main loop" \
  'label.*LABEL_PLAN' "$DAEMON_SCRIPT"

assert_grep "filters out needs-human-review" \
  'LABEL_NEEDS_HUMAN_REVIEW' "$DAEMON_SCRIPT"

assert_grep "filters out claude-wip" \
  'LABEL_WIP' "$DAEMON_SCRIPT"

assert_grep "filters out claude-approved" \
  'LABEL_APPROVED' "$DAEMON_SCRIPT"

assert_grep "filters out claude-blocked" \
  'LABEL_BLOCKED' "$DAEMON_SCRIPT"

assert_grep "filters out claude-done" \
  'LABEL_DONE' "$DAEMON_SCRIPT"

assert_grep "filters out claude-active" \
  'LABEL_ACTIVE' "$DAEMON_SCRIPT"

# --- issue-worker.md has plan-writing mode -------------------------------------
echo ""
echo "issue-worker.md plan-writing mode:"

WORKER_AGENT="$REPO_ROOT/.claude/agents/issue-worker.md"

assert_grep "issue-worker has Plan-Writing Mode section" \
  '### Plan-Writing Mode' "$WORKER_AGENT"

assert_grep "triggers on plan label" \
  'label.*plan' "$WORKER_AGENT"

assert_grep "includes PLAN_ITEMS format" \
  'PLAN_ITEMS_START' "$WORKER_AGENT"

assert_grep "includes escalation path for decomposition failure" \
  'cannot create independently testable work items' "$WORKER_AGENT"

# --- Deleted agent files -------------------------------------------------------
echo ""
echo "Agent files:"

if [ ! -f "$REPO_ROOT/.claude/agents/plan-writer.md" ]; then
  pass "plan-writer.md deleted"
else
  fail "plan-writer.md deleted" "file not found" "file still exists"
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
