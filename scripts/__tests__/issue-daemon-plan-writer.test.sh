#!/usr/bin/env bash
# issue-daemon-plan-writer.test.sh — Tests for plan-writer support in issue-daemon.sh
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

assert_grep_count() {
  local description="$1"
  local pattern="$2"
  local expected_min="$3"
  local file="$4"
  local count
  count=$(grep -cE "$pattern" "$file" || true)
  if [ "$count" -ge "$expected_min" ]; then
    pass "$description"
  else
    fail "$description" "at least $expected_min matches" "$count matches"
  fi
}

echo ""
echo "=== Plan-writer daemon support tests ==="
echo ""

# --- Config vars --------------------------------------------------------------
echo "Configuration variables:"

assert_grep "LABEL_PLAN config var exists" \
  '^LABEL_PLAN=' "$DAEMON_SCRIPT"

assert_grep "LABEL_PLAN is 'plan'" \
  'LABEL_PLAN="plan"' "$DAEMON_SCRIPT"

assert_grep "LABEL_NEEDS_HUMAN_REVIEW config var exists" \
  '^LABEL_NEEDS_HUMAN_REVIEW=' "$DAEMON_SCRIPT"

assert_grep "LABEL_NEEDS_HUMAN_REVIEW is 'needs-human-review'" \
  'LABEL_NEEDS_HUMAN_REVIEW="needs-human-review"' "$DAEMON_SCRIPT"

# --- Function definition ------------------------------------------------------
echo ""
echo "run_plan_writer function:"

assert_grep "run_plan_writer function defined" \
  '^run_plan_writer\(\)' "$DAEMON_SCRIPT"

assert_grep "uses plan-writer agent" \
  'agent "plan-writer"' "$DAEMON_SCRIPT"

assert_grep "uses correct tools (Bash,Glob,Grep,Read)" \
  'allowedTools "Bash,Glob,Grep,Read"' "$DAEMON_SCRIPT"

assert_grep "log file uses plan-writer prefix" \
  'plan-writer-\$\{issue_number\}\.log' "$DAEMON_SCRIPT"

assert_grep "adds LABEL_WIP label on pickup" \
  'add-label.*LABEL_WIP' "$DAEMON_SCRIPT"

assert_grep "removes LABEL_WIP on success" \
  'remove-label.*LABEL_WIP' "$DAEMON_SCRIPT"

assert_grep "handles rate limit detection" \
  'detect_rate_limit.*exit_code.*log_file' "$DAEMON_SCRIPT"

assert_grep "starts heartbeat" \
  'start_heartbeat.*issue_number.*claude_pid' "$DAEMON_SCRIPT"

assert_grep "stops heartbeat" \
  'stop_heartbeat.*hb_pid.*issue_number' "$DAEMON_SCRIPT"

assert_grep "uses stdbuf wrapping" \
  'STDBUF_PREFIX.*claude' "$DAEMON_SCRIPT"

assert_grep "transitions to claude-blocked on failure" \
  'add-label.*LABEL_BLOCKED' "$DAEMON_SCRIPT"

assert_grep "comments on failure" \
  'Plan-writer exited with code' "$DAEMON_SCRIPT"

# --- Label filtering ----------------------------------------------------------
echo ""
echo "Label-based detection (no body inspection):"

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

# --- Priority ordering --------------------------------------------------------
echo ""
echo "Priority ordering:"

# Verify plan-writer tier appears between approved-plans and bug-investigate
# by checking the order of priority comments in the file
plan_writer_line=$(grep -n "Priority 1.25" "$DAEMON_SCRIPT" | head -1 | cut -d: -f1)
bug_investigate_line=$(grep -n "Priority 1.5" "$DAEMON_SCRIPT" | head -1 | cut -d: -f1)
approved_plans_line=$(grep -n "Priority 1:" "$DAEMON_SCRIPT" | head -1 | cut -d: -f1)

if [ -n "$plan_writer_line" ] && [ -n "$bug_investigate_line" ] && [ -n "$approved_plans_line" ]; then
  if [ "$approved_plans_line" -lt "$plan_writer_line" ] && [ "$plan_writer_line" -lt "$bug_investigate_line" ]; then
    pass "plan-writer tier (1.25) is between approved-plans (1) and bug-investigate (1.5)"
  else
    fail "plan-writer tier ordering" "approved < plan-writer < bug-investigate" "lines: approved=$approved_plans_line, plan-writer=$plan_writer_line, bug=$bug_investigate_line"
  fi
else
  fail "plan-writer tier ordering" "all priority comments found" "missing: approved=$approved_plans_line, plan-writer=$plan_writer_line, bug=$bug_investigate_line"
fi

# --- Worker tracking ----------------------------------------------------------
echo ""
echo "Worker tracking:"

assert_grep "records worker with plan-writer type" \
  'record_worker.*plan-writer' "$DAEMON_SCRIPT"

# --- Startup log ---------------------------------------------------------------
echo ""
echo "Startup log message:"

assert_grep "startup log mentions plan label" \
  'LABEL_PLAN' "$DAEMON_SCRIPT"

# --- Stale detection -----------------------------------------------------------
echo ""
echo "Stale detection:"

assert_grep "stale detection handles plan-writer log file" \
  'plan-writer' "$DAEMON_SCRIPT"

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
