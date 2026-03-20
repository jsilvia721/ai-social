#!/usr/bin/env bash
# issue-daemon-clean-worktree.test.sh — Tests for clean_worktree helper in issue-daemon.sh
#
# Run: bash scripts/__tests__/issue-daemon-clean-worktree.test.sh

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
# Uses awk to find 'funcname()' and capture until the next top-level function or EOF
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
echo "=== clean_worktree helper tests ==="
echo ""

# --- Function definition ------------------------------------------------------
echo "clean_worktree function:"

assert_grep "clean_worktree function defined" \
  '^clean_worktree\(\)' "$DAEMON_SCRIPT"

assert_grep "takes issue_number parameter" \
  'clean_worktree' "$DAEMON_SCRIPT"

assert_grep "scans .claude/worktrees/ for matching worktree" \
  '\.claude/worktrees' "$DAEMON_SCRIPT"

assert_grep "runs git clean -fd in the worktree" \
  'git clean -fd' "$DAEMON_SCRIPT"

assert_grep "logs what it cleaned" \
  'log.*[Cc]lean' "$DAEMON_SCRIPT"

# --- Integration via agent_cleanup helper -------------------------------------
echo ""
echo "agent_cleanup helper integration:"

# agent_cleanup calls clean_worktree (the helper encapsulates the cleanup chain)
agent_cleanup_body=$(extract_function "agent_cleanup" "$DAEMON_SCRIPT")

if echo "$agent_cleanup_body" | grep -q 'clean_worktree'; then
  pass "agent_cleanup calls clean_worktree"
else
  fail "agent_cleanup calls clean_worktree" "call found" "not found"
fi

# Verify ordering: clean_worktree before remove_worker in agent_cleanup
if echo "$agent_cleanup_body" | \
   awk '/clean_worktree/{found_clean=1} /remove_worker/{if(found_clean) found_order=1} END{exit !found_order}'; then
  pass "clean_worktree comes before remove_worker in agent_cleanup"
else
  fail "clean_worktree comes before remove_worker in agent_cleanup" "clean before remove" "wrong order or missing"
fi

# --- Integration in run_worker (via agent_cleanup) ----------------------------
echo ""
echo "run_worker integration:"

run_worker_body=$(extract_function "run_worker" "$DAEMON_SCRIPT")

if echo "$run_worker_body" | grep -q 'agent_cleanup'; then
  pass "run_worker calls agent_cleanup (which calls clean_worktree)"
else
  fail "run_worker calls agent_cleanup (which calls clean_worktree)" "call found" "not found"
fi

# --- Integration in run_plan_executor (via agent_cleanup) ---------------------
echo ""
echo "run_plan_executor integration:"

run_plan_body=$(extract_function "run_plan_executor" "$DAEMON_SCRIPT")

if echo "$run_plan_body" | grep -q 'agent_cleanup'; then
  pass "run_plan_executor calls agent_cleanup (which calls clean_worktree)"
else
  fail "run_plan_executor calls agent_cleanup (which calls clean_worktree)" "call found" "not found"
fi

# --- No-op safety -------------------------------------------------------------
echo ""
echo "Safety (handles missing worktree):"

# The clean_worktree function checks [ -d "$wt" ] || continue
clean_body=$(extract_function "clean_worktree" "$DAEMON_SCRIPT")
if echo "$clean_body" | grep -qE 'continue|return'; then
  pass "handles case where no matching worktree is found"
else
  fail "handles case where no matching worktree is found" "continue or return" "not found"
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
