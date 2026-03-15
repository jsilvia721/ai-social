#!/usr/bin/env bash
# issue-daemon-tmux.test.sh — Tests for tmux support in issue-daemon.sh
#
# Run: bash scripts/__tests__/issue-daemon-tmux.test.sh

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
echo "=== Tmux Support Tests ==="

# ==============================================================================
# Part 1: Configuration
# ==============================================================================
echo ""
echo "Configuration:"

assert_grep "TMUX_MODE config var exists" \
  '^TMUX_MODE=' "$DAEMON_SCRIPT"

assert_grep "TMUX_MODE defaults to auto" \
  'TMUX_MODE="auto"' "$DAEMON_SCRIPT"

# ==============================================================================
# Part 2: -t flag in getopts
# ==============================================================================
echo ""
echo "-t flag:"

assert_grep "-t flag in getopts" \
  'getopts.*t:' "$DAEMON_SCRIPT"

assert_grep "-t flag sets TMUX_MODE" \
  't) TMUX_MODE=\$OPTARG' "$DAEMON_SCRIPT"

# ==============================================================================
# Part 3: Tmux detection
# ==============================================================================
echo ""
echo "Tmux detection:"

assert_grep "tmux detection function or logic exists" \
  'TMUX_ENABLED' "$DAEMON_SCRIPT"

assert_grep "checks if tmux is installed" \
  'command -v tmux' "$DAEMON_SCRIPT"

assert_grep "logs warning when tmux not available" \
  'tmux not found|tmux not installed|tmux.*not available' "$DAEMON_SCRIPT"

assert_grep "handles TMUX_MODE=on" \
  'on\)' "$DAEMON_SCRIPT"

assert_grep "handles TMUX_MODE=off" \
  'off\)' "$DAEMON_SCRIPT"

assert_grep "TMUX_FLAGS set to --tmux=classic when enabled" \
  'TMUX_FLAGS=.*--tmux=classic' "$DAEMON_SCRIPT"

# ==============================================================================
# Part 4: Worker spawn — tmux flags
# ==============================================================================
echo ""
echo "Worker spawns with tmux:"

run_worker_body=$(extract_function 'run_worker' "$DAEMON_SCRIPT")

# Fresh start path uses TMUX_FLAGS (which resolves to --tmux=classic when enabled)
if echo "$run_worker_body" | grep -q 'TMUX_FLAGS'; then
  pass "run_worker fresh start uses TMUX_FLAGS (--tmux=classic)"
else
  fail "run_worker fresh start uses TMUX_FLAGS (--tmux=classic)" "found" "not found"
fi

# Fresh start path still uses --worktree
if echo "$run_worker_body" | grep -q '\-\-worktree'; then
  pass "run_worker fresh start uses --worktree"
else
  fail "run_worker fresh start uses --worktree" "found" "not found"
fi

# ==============================================================================
# Part 5: Plan-executor, bug-investigator, plan-writer get tmux + worktree
# ==============================================================================
echo ""
echo "Other worker types get tmux + worktree:"

plan_executor_body=$(extract_function 'run_plan_executor' "$DAEMON_SCRIPT")
bug_investigator_body=$(extract_function 'run_bug_investigator' "$DAEMON_SCRIPT")
plan_writer_body=$(extract_function 'run_plan_writer' "$DAEMON_SCRIPT")

# Plan-executor
if echo "$plan_executor_body" | grep -q '\-\-worktree'; then
  pass "run_plan_executor uses --worktree"
else
  fail "run_plan_executor uses --worktree" "found" "not found"
fi

if echo "$plan_executor_body" | grep -q 'TMUX_FLAGS'; then
  pass "run_plan_executor uses TMUX_FLAGS (--tmux=classic)"
else
  fail "run_plan_executor uses TMUX_FLAGS (--tmux=classic)" "found" "not found"
fi

# Bug-investigator
if echo "$bug_investigator_body" | grep -q '\-\-worktree'; then
  pass "run_bug_investigator uses --worktree"
else
  fail "run_bug_investigator uses --worktree" "found" "not found"
fi

if echo "$bug_investigator_body" | grep -q 'TMUX_FLAGS'; then
  pass "run_bug_investigator uses TMUX_FLAGS (--tmux=classic)"
else
  fail "run_bug_investigator uses TMUX_FLAGS (--tmux=classic)" "found" "not found"
fi

# Plan-writer
if echo "$plan_writer_body" | grep -q '\-\-worktree'; then
  pass "run_plan_writer uses --worktree"
else
  fail "run_plan_writer uses --worktree" "found" "not found"
fi

if echo "$plan_writer_body" | grep -q 'TMUX_FLAGS'; then
  pass "run_plan_writer uses TMUX_FLAGS (--tmux=classic)"
else
  fail "run_plan_writer uses TMUX_FLAGS (--tmux=classic)" "found" "not found"
fi

# ==============================================================================
# Part 6: Resume path gets tmux session
# ==============================================================================
echo ""
echo "Resume path tmux:"

# Resume path should have tmux support (either via tmux new-session or --tmux)
if echo "$run_worker_body" | grep -q 'tmux new-session\|tmux_wrap_resume\|--tmux'; then
  pass "resume path has tmux support"
else
  fail "resume path has tmux support" "tmux new-session or --tmux" "not found"
fi

# ==============================================================================
# Part 7: Log capture still works
# ==============================================================================
echo ""
echo "Log capture:"

# All worker types should still write to log files
assert_grep "run_worker writes to log_file" \
  'log_file' "$DAEMON_SCRIPT"

# tee should be used for log capture when tmux is active
assert_grep "tee used for log capture" \
  'tee' "$DAEMON_SCRIPT"

# ==============================================================================
# Part 8: Startup log mentions tmux
# ==============================================================================
echo ""
echo "Startup logging:"

assert_grep "startup log mentions tmux" \
  'tmux|TMUX' "$DAEMON_SCRIPT"

# ==============================================================================
# Part 9: Conditional tmux (TMUX_ENABLED check)
# ==============================================================================
echo ""
echo "Conditional tmux application:"

# Worker functions should check TMUX_ENABLED before applying tmux flags
assert_grep "TMUX_ENABLED check in worker spawns" \
  'TMUX_ENABLED' "$DAEMON_SCRIPT"

# ==============================================================================
# Part 10: Syntax and shellcheck
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
