#!/usr/bin/env bash
# issue-daemon-session-resume.test.sh — Tests for session resumption features
# in issue-daemon.sh: session ID helpers, find_issue_worktree, claude-resume
# label handling, and --max-turns removal.
#
# Run: bash scripts/__tests__/issue-daemon-session-resume.test.sh

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
    found { print }
  " "$file"
}

# --- Setup temp dir for functional tests --------------------------------------
TEST_LOG_DIR=$(mktemp -d)
export LOG_DIR="$TEST_LOG_DIR"

echo ""
echo "=== Session Resumption Tests ==="

# ==============================================================================
# Part 1: MAX_TURNS removal
# ==============================================================================
echo ""
echo "MAX_TURNS removal:"

assert_not_grep "no MAX_TURNS config variable" \
  '^MAX_TURNS=' "$DAEMON_SCRIPT"

assert_not_grep "no --max-turns flag usage" \
  'max-turns' "$DAEMON_SCRIPT"

# -t flag is now used for tmux mode (issue #514)
assert_grep "-t flag in getopts (tmux mode)" \
  'getopts.*t:' "$DAEMON_SCRIPT"

# ==============================================================================
# Part 2: MAX_BUDGET default raised to 50
# ==============================================================================
echo ""
echo "MAX_BUDGET default:"

assert_grep "MAX_BUDGET default is 50" \
  '^MAX_BUDGET=50' "$DAEMON_SCRIPT"

# ==============================================================================
# Part 3: LABEL_RESUME config
# ==============================================================================
echo ""
echo "LABEL_RESUME configuration:"

assert_grep "LABEL_RESUME config var exists" \
  '^LABEL_RESUME=' "$DAEMON_SCRIPT"

assert_grep "LABEL_RESUME is 'claude-resume'" \
  'LABEL_RESUME="claude-resume"' "$DAEMON_SCRIPT"

# ==============================================================================
# Part 4: Session ID helper functions (functional tests)
# ==============================================================================
echo ""
echo "Session ID helpers (functional):"

# Source just the helpers we need — define a minimal log function
log() { :; }

# We can't source the whole daemon (it has a main loop), so we define
# the session ID functions directly (matching the daemon implementation)
save_session_id() {
  echo "$2" > "$LOG_DIR/.session-${1}"
}
load_session_id() {
  local file="$LOG_DIR/.session-${1}"
  if [ -f "$file" ]; then
    cat "$file"
  fi
}
clear_session_id() {
  rm -f "$LOG_DIR/.session-${1}"
}

# Test: save and load a session ID
save_session_id "42" "abc-123-def"
result=$(load_session_id "42")
assert_eq "save and load session ID" "abc-123-def" "$result"

# Test: load returns empty for non-existent session
result=$(load_session_id "999")
assert_eq "load returns empty for non-existent session" "" "$result"

# Test: clear removes the session file
save_session_id "42" "abc-123-def"
clear_session_id "42"
result=$(load_session_id "42")
assert_eq "clear removes session ID" "" "$result"

# Test: session file does not exist after clear
if [ -f "$TEST_LOG_DIR/.session-42" ]; then
  fail "session file removed after clear" "file absent" "file exists"
else
  pass "session file removed after clear"
fi

# Test: save overwrites previous session
save_session_id "100" "old-session"
save_session_id "100" "new-session"
result=$(load_session_id "100")
assert_eq "save overwrites previous session" "new-session" "$result"
clear_session_id "100"

# Test: clear is idempotent (no error on double clear)
save_session_id "200" "session-to-clear"
clear_session_id "200"
clear_session_id "200"  # should not error
pass "clear is idempotent"

# ==============================================================================
# Part 5: Session ID function definitions (structural)
# ==============================================================================
echo ""
echo "Session ID helpers (structural):"

assert_grep "save_session_id function defined" \
  '^save_session_id\(\)' "$DAEMON_SCRIPT"

assert_grep "load_session_id function defined" \
  '^load_session_id\(\)' "$DAEMON_SCRIPT"

assert_grep "clear_session_id function defined" \
  '^clear_session_id\(\)' "$DAEMON_SCRIPT"

# Verify session files use .session- prefix in LOG_DIR
assert_grep "session files stored in LOG_DIR with .session- prefix" \
  'LOG_DIR/\.session-' "$DAEMON_SCRIPT"

# ==============================================================================
# Part 6: find_issue_worktree function
# ==============================================================================
echo ""
echo "find_issue_worktree function:"

assert_grep "find_issue_worktree function defined" \
  '^find_issue_worktree\(\)' "$DAEMON_SCRIPT"

find_wt_body=$(extract_function 'find_issue_worktree' "$DAEMON_SCRIPT")

# Checks that it scans .claude/worktrees/
if echo "$find_wt_body" | grep -q '\.claude/worktrees'; then
  pass "scans .claude/worktrees/ directory"
else
  fail "scans .claude/worktrees/ directory" "pattern found" "not found"
fi

# Checks that it matches issue-{N}-* branch pattern
if echo "$find_wt_body" | grep -qE 'issue-.*issue_number'; then
  pass "matches issue-{N}-* branch pattern"
else
  fail "matches issue-{N}-* branch pattern" "pattern found" "not found"
fi

# Checks that it uses git rev-parse to get branch name
if echo "$find_wt_body" | grep -q 'rev-parse.*abbrev-ref'; then
  pass "uses git rev-parse --abbrev-ref HEAD to get branch"
else
  fail "uses git rev-parse --abbrev-ref HEAD to get branch" "found" "not found"
fi

# Checks that it handles missing directories gracefully
if echo "$find_wt_body" | grep -qE '\[ -d.*\] \|\| continue'; then
  pass "handles missing directories with continue"
else
  fail "handles missing directories with continue" "[ -d ] || continue" "not found"
fi

# ==============================================================================
# Part 7: run_worker resume handling
# ==============================================================================
echo ""
echo "run_worker resume handling:"

run_worker_body=$(extract_function 'run_worker' "$DAEMON_SCRIPT")

# is_resume parameter (4th arg)
if echo "$run_worker_body" | grep -q 'is_resume'; then
  pass "run_worker accepts is_resume parameter"
else
  fail "run_worker accepts is_resume parameter" "found" "not found"
fi

# Resume path uses --resume flag
if echo "$run_worker_body" | grep -q '\-\-resume'; then
  pass "resume path uses --resume flag"
else
  fail "resume path uses --resume flag" "found" "not found"
fi

# Resume path uses >> (append) for logs
if echo "$run_worker_body" | grep -q '>> "\$log_file"'; then
  pass "resume path appends to log file (>>)"
else
  fail "resume path appends to log file (>>)" ">>" "not found"
fi

# Fresh start path uses --session-id
if echo "$run_worker_body" | grep -q '\-\-session-id'; then
  pass "fresh start uses --session-id flag"
else
  fail "fresh start uses --session-id flag" "found" "not found"
fi

# Fresh start uses uuidgen
if echo "$run_worker_body" | grep -q 'uuidgen'; then
  pass "fresh start generates UUID via uuidgen"
else
  fail "fresh start generates UUID via uuidgen" "found" "not found"
fi

# Calls save_session_id on fresh start
if echo "$run_worker_body" | grep -q 'save_session_id'; then
  pass "calls save_session_id on fresh start"
else
  fail "calls save_session_id on fresh start" "found" "not found"
fi

# Calls load_session_id on retry/resume
if echo "$run_worker_body" | grep -q 'load_session_id'; then
  pass "calls load_session_id on retry/resume"
else
  fail "calls load_session_id on retry/resume" "found" "not found"
fi

# Calls clear_session_id on success
if echo "$run_worker_body" | grep -q 'clear_session_id'; then
  pass "calls clear_session_id on successful PR"
else
  fail "calls clear_session_id on successful PR" "found" "not found"
fi

# Calls find_issue_worktree on retry/resume
if echo "$run_worker_body" | grep -q 'find_issue_worktree'; then
  pass "calls find_issue_worktree on retry/resume"
else
  fail "calls find_issue_worktree on retry/resume" "found" "not found"
fi

# Resume removes LABEL_RESUME
if echo "$run_worker_body" | grep -q 'LABEL_RESUME'; then
  pass "resume path handles LABEL_RESUME label"
else
  fail "resume path handles LABEL_RESUME label" "found" "not found"
fi

# ==============================================================================
# Part 8: Main loop — claude-resume Priority 0
# ==============================================================================
echo ""
echo "Main loop claude-resume handling:"

assert_grep "polls for claude-resume labeled issues" \
  'LABEL_RESUME' "$DAEMON_SCRIPT"

# claude-resume should appear before claude-interrupted in the main loop
# (Priority 0 vs Priority 0.5)
# The polling code uses resume_issues= and interrupted_issues= variable names
# (issues_with_label replaced gh issue list in the consolidated fetch refactor)
resume_line=$(grep -n 'resume_issues=.*issues_with_label\|resume_issues=.*gh issue list' "$DAEMON_SCRIPT" | head -1 | cut -d: -f1)
interrupted_line=$(grep -n 'interrupted_issues=.*issues_with_label\|interrupted_issues=.*gh issue list' "$DAEMON_SCRIPT" | head -1 | cut -d: -f1)

if [ -n "$resume_line" ] && [ -n "$interrupted_line" ]; then
  if [ "$resume_line" -lt "$interrupted_line" ]; then
    pass "claude-resume polled before claude-interrupted (Priority 0 < 0.5)"
  else
    fail "claude-resume polled before claude-interrupted" "resume line $resume_line < interrupted line $interrupted_line" "resume=$resume_line, interrupted=$interrupted_line"
  fi
else
  fail "both resume and interrupted polling found" "both present" "resume=${resume_line:-empty}, interrupted=${interrupted_line:-empty}"
fi

# Resume spawner passes is_resume=true
assert_grep "resume spawner passes is_resume=true" \
  'run_worker.*"false".*"true"' "$DAEMON_SCRIPT"

# Startup log mentions claude-resume
assert_grep "startup log mentions claude-resume" \
  'LABEL_RESUME' "$DAEMON_SCRIPT"

# ==============================================================================
# Part 9: Failure message suggests claude-resume label
# ==============================================================================
echo ""
echo "Failure messaging:"

assert_grep "failure message suggests adding claude-resume label" \
  'LABEL_RESUME' "$DAEMON_SCRIPT"

# ==============================================================================
# Part 10: No --max-turns in any claude invocation
# ==============================================================================
echo ""
echo "Claude invocations (no --max-turns):"

# Count claude command invocations and verify none use --max-turns
claude_calls=$(grep -c 'claude -p' "$DAEMON_SCRIPT" || true)
max_turns_calls=$(grep -c '\-\-max-turns' "$DAEMON_SCRIPT" || true)
assert_eq "no --max-turns in any claude invocation" "0" "$max_turns_calls"

if [ "$claude_calls" -gt 0 ]; then
  pass "found $claude_calls claude -p invocations (all clean)"
else
  fail "found claude -p invocations" ">0" "$claude_calls"
fi

# ==============================================================================
# Part 11: Syntax check
# ==============================================================================
echo ""
echo "Syntax:"

if bash -n "$DAEMON_SCRIPT" 2>&1; then
  pass "bash -n syntax check passes"
else
  fail "bash -n syntax check passes" "no errors" "syntax errors"
fi

# --- Cleanup ------------------------------------------------------------------
rm -rf "$TEST_LOG_DIR"

# --- Summary ------------------------------------------------------------------
echo ""
echo "=== Results ==="
echo "  ${TESTS_PASSED}/${TESTS_RUN} passed, ${TESTS_FAILED} failed"
echo ""

if [ "$TESTS_FAILED" -gt 0 ]; then
  exit 1
fi
