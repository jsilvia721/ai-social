#!/usr/bin/env bash
# issue-daemon-helpers.test.sh — Tests for agent lifecycle helper functions
# (agent_wait, agent_cleanup, agent_check_rate_limit) and consolidated issue fetch.
#
# Run: bash scripts/__tests__/issue-daemon-helpers.test.sh

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

# Helper: extract a bash function body from script by name
extract_function() {
  local func_name="$1"
  local file="$2"
  awk "
    /^${func_name}\\(\\)/ { found=1; next }
    found && /^[a-z_]+\\(\\) \\{/ { exit }
    found && /^# ---/ { exit }
    found { print }
  " "$file"
}

echo ""
echo "=== Agent Lifecycle Helper Tests ==="

# ==============================================================================
# Part 1: Helper function definitions
# ==============================================================================
echo ""
echo "Helper function definitions:"

assert_grep "agent_wait function defined" \
  '^agent_wait\(\)' "$DAEMON_SCRIPT"

assert_grep "agent_cleanup function defined" \
  '^agent_cleanup\(\)' "$DAEMON_SCRIPT"

assert_grep "agent_check_rate_limit function defined" \
  '^agent_check_rate_limit\(\)' "$DAEMON_SCRIPT"

# ==============================================================================
# Part 2: agent_wait internals
# ==============================================================================
echo ""
echo "agent_wait internals:"

agent_wait_body=$(extract_function "agent_wait" "$DAEMON_SCRIPT")

if echo "$agent_wait_body" | grep -q 'wait "\$claude_pid"'; then
  pass "agent_wait calls wait on claude_pid"
else
  fail "agent_wait calls wait on claude_pid" "found" "not found"
fi

if echo "$agent_wait_body" | grep -q 'AGENT_EXIT_CODE='; then
  pass "agent_wait sets AGENT_EXIT_CODE"
else
  fail "agent_wait sets AGENT_EXIT_CODE" "found" "not found"
fi

if echo "$agent_wait_body" | grep -q 'stop_heartbeat'; then
  pass "agent_wait calls stop_heartbeat"
else
  fail "agent_wait calls stop_heartbeat" "found" "not found"
fi

if echo "$agent_wait_body" | grep -q 'AGENT_RUNTIME='; then
  pass "agent_wait sets AGENT_RUNTIME"
else
  fail "agent_wait sets AGENT_RUNTIME" "found" "not found"
fi

if echo "$agent_wait_body" | grep -q 'AGENT_SELF_PID='; then
  pass "agent_wait sets AGENT_SELF_PID"
else
  fail "agent_wait sets AGENT_SELF_PID" "found" "not found"
fi

# ==============================================================================
# Part 3: agent_cleanup internals
# ==============================================================================
echo ""
echo "agent_cleanup internals:"

agent_cleanup_body=$(extract_function "agent_cleanup" "$DAEMON_SCRIPT")

if echo "$agent_cleanup_body" | grep -q 'kill_worker_tmux_session'; then
  pass "agent_cleanup calls kill_worker_tmux_session"
else
  fail "agent_cleanup calls kill_worker_tmux_session" "found" "not found"
fi

if echo "$agent_cleanup_body" | grep -q 'clean_worktree'; then
  pass "agent_cleanup calls clean_worktree"
else
  fail "agent_cleanup calls clean_worktree" "found" "not found"
fi

if echo "$agent_cleanup_body" | grep -q 'remove_worker'; then
  pass "agent_cleanup calls remove_worker"
else
  fail "agent_cleanup calls remove_worker" "found" "not found"
fi

# Ordering: kill_tmux → clean_worktree → remove_worker
if echo "$agent_cleanup_body" | \
   awk '/kill_worker_tmux/{t=1} /clean_worktree/{if(t) c=1} /remove_worker/{if(c) r=1} END{exit !r}'; then
  pass "agent_cleanup ordering: tmux → clean → remove"
else
  fail "agent_cleanup ordering: tmux → clean → remove" "correct order" "wrong order"
fi

# ==============================================================================
# Part 4: agent_check_rate_limit internals
# ==============================================================================
echo ""
echo "agent_check_rate_limit internals:"

agent_rate_body=$(extract_function "agent_check_rate_limit" "$DAEMON_SCRIPT")

if echo "$agent_rate_body" | grep -q 'detect_rate_limit'; then
  pass "agent_check_rate_limit calls detect_rate_limit"
else
  fail "agent_check_rate_limit calls detect_rate_limit" "found" "not found"
fi

if echo "$agent_rate_body" | grep -q 'commit_wip_if_needed'; then
  pass "agent_check_rate_limit calls commit_wip_if_needed"
else
  fail "agent_check_rate_limit calls commit_wip_if_needed" "found" "not found"
fi

if echo "$agent_rate_body" | grep -q 'handle_rate_limit_exit'; then
  pass "agent_check_rate_limit calls handle_rate_limit_exit"
else
  fail "agent_check_rate_limit calls handle_rate_limit_exit" "found" "not found"
fi

if echo "$agent_rate_body" | grep -q 'agent_cleanup'; then
  pass "agent_check_rate_limit calls agent_cleanup"
else
  fail "agent_check_rate_limit calls agent_cleanup" "found" "not found"
fi

# ==============================================================================
# Part 5: Runner functions use helpers
# ==============================================================================
echo ""
echo "Runner functions use helpers:"

run_worker_body=$(extract_function "run_worker" "$DAEMON_SCRIPT")
run_plan_body=$(extract_function "run_plan_executor" "$DAEMON_SCRIPT")

# run_worker uses agent_wait
if echo "$run_worker_body" | grep -q 'agent_wait'; then
  pass "run_worker calls agent_wait"
else
  fail "run_worker calls agent_wait" "found" "not found"
fi

# run_worker uses agent_cleanup
if echo "$run_worker_body" | grep -q 'agent_cleanup'; then
  pass "run_worker calls agent_cleanup"
else
  fail "run_worker calls agent_cleanup" "found" "not found"
fi

# run_worker uses agent_check_rate_limit
if echo "$run_worker_body" | grep -q 'agent_check_rate_limit'; then
  pass "run_worker calls agent_check_rate_limit"
else
  fail "run_worker calls agent_check_rate_limit" "found" "not found"
fi

# run_plan_executor uses agent_wait
if echo "$run_plan_body" | grep -q 'agent_wait'; then
  pass "run_plan_executor calls agent_wait"
else
  fail "run_plan_executor calls agent_wait" "found" "not found"
fi

# run_plan_executor uses agent_cleanup
if echo "$run_plan_body" | grep -q 'agent_cleanup'; then
  pass "run_plan_executor calls agent_cleanup"
else
  fail "run_plan_executor calls agent_cleanup" "found" "not found"
fi

# run_plan_executor uses agent_check_rate_limit
if echo "$run_plan_body" | grep -q 'agent_check_rate_limit'; then
  pass "run_plan_executor calls agent_check_rate_limit"
else
  fail "run_plan_executor calls agent_check_rate_limit" "found" "not found"
fi

# run_worker reads AGENT_EXIT_CODE from agent_wait
if echo "$run_worker_body" | grep -q 'AGENT_EXIT_CODE'; then
  pass "run_worker reads AGENT_EXIT_CODE"
else
  fail "run_worker reads AGENT_EXIT_CODE" "found" "not found"
fi

# run_worker reads AGENT_RUNTIME from agent_wait
if echo "$run_worker_body" | grep -q 'AGENT_RUNTIME'; then
  pass "run_worker reads AGENT_RUNTIME"
else
  fail "run_worker reads AGENT_RUNTIME" "found" "not found"
fi

# run_worker reads AGENT_SELF_PID from agent_wait
if echo "$run_worker_body" | grep -q 'AGENT_SELF_PID'; then
  pass "run_worker reads AGENT_SELF_PID"
else
  fail "run_worker reads AGENT_SELF_PID" "found" "not found"
fi

# ==============================================================================
# Part 6: Consolidated issue fetch
# ==============================================================================
echo ""
echo "Consolidated issue fetch:"

# Single gh issue list call in main loop
assert_grep "single consolidated gh issue list call" \
  'all_open_issues=.*gh issue list' "$DAEMON_SCRIPT"

# issues_with_label helper defined
assert_grep "issues_with_label helper defined" \
  'issues_with_label\(\)' "$DAEMON_SCRIPT"

# issues_with_both_labels helper defined
assert_grep "issues_with_both_labels helper defined" \
  'issues_with_both_labels\(\)' "$DAEMON_SCRIPT"

# issues_plan_eligible helper defined
assert_grep "issues_plan_eligible helper defined" \
  'issues_plan_eligible\(\)' "$DAEMON_SCRIPT"

# Priority sections use helpers instead of direct gh issue list calls
assert_grep "Priority 0 uses issues_with_label" \
  'issues_with_label.*LABEL_RESUME' "$DAEMON_SCRIPT"

assert_grep "Priority 0.5 uses issues_with_label" \
  'issues_with_label.*LABEL_INTERRUPTED' "$DAEMON_SCRIPT"

assert_grep "Priority 1 uses issues_with_label" \
  'issues_with_label.*LABEL_APPROVED' "$DAEMON_SCRIPT"

assert_grep "Priority 2 uses issues_with_label" \
  'issues_with_label.*LABEL_READY' "$DAEMON_SCRIPT"

# WIP filtering is done in jq, not per-issue gh issue view
assert_grep "issues_with_label filters out WIP in jq" \
  'index..wip.*not' "$DAEMON_SCRIPT"

# No per-issue WIP checks in priority sections (replaced by bulk fetch filtering)
# Count direct gh issue view calls in the priority dispatch section
priority_section=$(awk '/Priority 0: Resume/,/Priority 3: Conflict/' "$DAEMON_SCRIPT")
wip_view_count=$(echo "$priority_section" | grep -c 'gh issue view.*labels.*WIP' || true)
if [ "$wip_view_count" -eq 0 ]; then
  pass "no per-issue gh issue view WIP checks in priority dispatch"
else
  fail "no per-issue gh issue view WIP checks in priority dispatch" "0 calls" "$wip_view_count calls"
fi

# ==============================================================================
# Part 7: Syntax and shellcheck
# ==============================================================================
echo ""
echo "Syntax:"

if bash -n "$DAEMON_SCRIPT" 2>&1; then
  pass "bash -n syntax check passes"
else
  fail "bash -n syntax check passes" "no errors" "syntax errors"
fi

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
