#!/usr/bin/env bash
# daemon-status.test.sh — Unit tests for scripts/daemon-status.sh
#
# Run: bash scripts/__tests__/daemon-status.test.sh

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

assert_contains() {
  local description="$1"
  local needle="$2"
  local haystack="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    pass "$description"
  else
    fail "$description" "output contains '$needle'" "$haystack"
  fi
}

assert_not_contains() {
  local description="$1"
  local needle="$2"
  local haystack="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    fail "$description" "output does NOT contain '$needle'" "$haystack"
  else
    pass "$description"
  fi
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

# --- Setup temp dirs ----------------------------------------------------------
echo ""
echo "=== Daemon Status Script Tests ==="
echo ""

TEST_LOG_DIR=$(mktemp -d)
TEST_STATE_DIR=$(mktemp -d)
cleanup_test_dirs() { rm -rf "$TEST_LOG_DIR" "$TEST_STATE_DIR"; }
trap cleanup_test_dirs EXIT

# mktemp -d already created the dirs

STATUS_SCRIPT="$REPO_ROOT/scripts/daemon-status.sh"

# Helper to run the status script with test dirs
run_status() {
  LOG_DIR="$TEST_LOG_DIR" \
  DAEMON_STATE_DIR="$TEST_STATE_DIR" \
  WORKER_PID_FILE="$TEST_LOG_DIR/.active_pids" \
  bash "$STATUS_SCRIPT" "$@" 2>/dev/null || true
}

# --- Test: Daemon not running -------------------------------------------------
echo "Daemon not running:"

# No PID file at all
rm -f "$TEST_LOG_DIR/.issue-daemon.pid"
rm -f "$TEST_LOG_DIR/.active_pids"

output=$(run_status)
assert_contains "shows 'not running' when no PID file" "not running" "$output"
assert_contains "shows no active workers" "No active workers" "$output"

# PID file with dead PID (use a very high PID unlikely to exist)
echo "99999999" > "$TEST_LOG_DIR/.issue-daemon.pid"
output=$(run_status)
assert_contains "shows 'not running' for dead PID" "not running" "$output"

# --- Test: Daemon running (use own PID as stand-in) --------------------------
echo ""
echo "Daemon running:"

# Use current shell PID as a running process
echo "$$" > "$TEST_LOG_DIR/.issue-daemon.pid"

output=$(run_status)
assert_contains "shows PID number" "$$" "$output"
assert_contains "shows 'running'" "running" "$output"

# --- Test: Mode display -------------------------------------------------------
echo ""
echo "Mode display:"

# Normal mode (no drain, no rate limit)
rm -f "$TEST_STATE_DIR/drain" "$TEST_STATE_DIR/pause-until"
echo "$$" > "$TEST_LOG_DIR/.issue-daemon.pid"
output=$(run_status)
assert_contains "shows normal mode" "normal" "$output"

# Drain mode
touch "$TEST_STATE_DIR/drain"
output=$(run_status)
assert_contains "shows draining mode" "draining" "$output"
rm -f "$TEST_STATE_DIR/drain"

# Rate limited mode
future_epoch=$(( $(date +%s) + 600 ))
echo "$future_epoch" > "$TEST_STATE_DIR/pause-until"
output=$(run_status)
assert_contains "shows rate-limited mode" "rate-limited" "$output"
rm -f "$TEST_STATE_DIR/pause-until"

# --- Test: Worker display -----------------------------------------------------
echo ""
echo "Worker display:"

# Create active_pids with test entries using current PID (so they appear alive)
now_epoch=$(date +%s)
start_epoch=$((now_epoch - 1920))  # 32 minutes ago
echo "$$:45:${start_epoch}:worker" > "$TEST_LOG_DIR/.active_pids"

# Create heartbeat file (fresh — 20 seconds ago)
hb_epoch=$((now_epoch - 20))
echo "$hb_epoch" > "$TEST_LOG_DIR/heartbeat-45"

# Create log file with some content
dd if=/dev/zero of="$TEST_LOG_DIR/issue-45.log" bs=1024 count=350 2>/dev/null

output=$(run_status)
assert_contains "shows issue number #45" "#45" "$output"
assert_contains "shows worker type" "worker" "$output"
assert_contains "shows elapsed time" "32m" "$output"
assert_contains "shows fresh heartbeat ♥" "♥" "$output"
assert_contains "shows log file name" "issue-45.log" "$output"

# --- Test: Plan worker type ---------------------------------------------------
echo ""
echo "Plan worker type:"

start_epoch=$((now_epoch - 720))  # 12 minutes ago
echo "$$:47:${start_epoch}:plan" > "$TEST_LOG_DIR/.active_pids"
echo "$((now_epoch - 10))" > "$TEST_LOG_DIR/heartbeat-47"
echo "some log content" > "$TEST_LOG_DIR/plan-47.log"

output=$(run_status)
assert_contains "shows plan type" "plan" "$output"
assert_contains "shows plan log file" "plan-47.log" "$output"

# --- Test: Heartbeat indicators -----------------------------------------------
echo ""
echo "Heartbeat indicators:"

# Fresh heartbeat (< 60s)
echo "$$:100:${now_epoch}:worker" > "$TEST_LOG_DIR/.active_pids"
echo "$((now_epoch - 30))" > "$TEST_LOG_DIR/heartbeat-100"
echo "x" > "$TEST_LOG_DIR/issue-100.log"
output=$(run_status)
assert_contains "fresh heartbeat shows ♥" "♥" "$output"

# Aging heartbeat (1-5 min)
echo "$((now_epoch - 180))" > "$TEST_LOG_DIR/heartbeat-100"
output=$(run_status)
assert_contains "aging heartbeat shows ♡" "♡" "$output"

# Stale heartbeat (> 5 min)
echo "$((now_epoch - 400))" > "$TEST_LOG_DIR/heartbeat-100"
output=$(run_status)
assert_contains "stale heartbeat shows STALE" "STALE" "$output"

# No heartbeat file
rm -f "$TEST_LOG_DIR/heartbeat-100"
output=$(run_status)
assert_contains "missing heartbeat shows STALE" "STALE" "$output"

# --- Test: Dead worker PID skipped --------------------------------------------
echo ""
echo "Dead worker PID handling:"

echo "99999999:50:${now_epoch}:worker" > "$TEST_LOG_DIR/.active_pids"
echo "x" > "$TEST_LOG_DIR/issue-50.log"
output=$(run_status)
assert_not_contains "dead worker PID is skipped" "#50" "$output"
assert_contains "shows no active workers for dead PIDs" "No active workers" "$output"

# --- Test: Multiple workers ---------------------------------------------------
echo ""
echo "Multiple workers:"

start1=$((now_epoch - 1920))
start2=$((now_epoch - 720))
printf '%s\n' "$$:45:${start1}:worker" "$$:47:${start2}:plan" > "$TEST_LOG_DIR/.active_pids"
echo "$((now_epoch - 20))" > "$TEST_LOG_DIR/heartbeat-45"
echo "$((now_epoch - 10))" > "$TEST_LOG_DIR/heartbeat-47"
dd if=/dev/zero of="$TEST_LOG_DIR/issue-45.log" bs=1024 count=350 2>/dev/null
echo "plan output" > "$TEST_LOG_DIR/plan-47.log"

output=$(run_status)
assert_contains "shows first worker #45" "#45" "$output"
assert_contains "shows second worker #47" "#47" "$output"

# --- Test: Worker count display -----------------------------------------------
echo ""
echo "Worker count display:"

# With workers active
output=$(run_status)
assert_contains "shows worker count" "active" "$output"

# --- Test: Elapsed time formatting (hours) ------------------------------------
echo ""
echo "Elapsed time formatting:"

start_epoch=$((now_epoch - 5520))  # 92 minutes = 1h 32m
echo "$$:60:${start_epoch}:worker" > "$TEST_LOG_DIR/.active_pids"
echo "$now_epoch" > "$TEST_LOG_DIR/heartbeat-60"
echo "x" > "$TEST_LOG_DIR/issue-60.log"
output=$(run_status)
assert_contains "shows hours+minutes format" "1h 32m" "$output"

# --- Test: Verbose flag -------------------------------------------------------
echo ""
echo "Verbose flag (-v):"

echo "$$:70:${now_epoch}:worker" > "$TEST_LOG_DIR/.active_pids"
echo "$now_epoch" > "$TEST_LOG_DIR/heartbeat-70"
printf 'line1\nline2\nline3\nline4\nline5\nline6\nline7\n' > "$TEST_LOG_DIR/issue-70.log"

output=$(run_status -v)
assert_contains "verbose shows log lines" "line3" "$output"
assert_contains "verbose shows last log line" "line7" "$output"

# Non-verbose should NOT show log content
output=$(run_status)
assert_not_contains "non-verbose hides log content" "line3" "$output"

# --- Test: File size formatting -----------------------------------------------
echo ""
echo "File size formatting:"

# Create a file ~350KB
dd if=/dev/zero of="$TEST_LOG_DIR/issue-80.log" bs=1024 count=350 2>/dev/null
echo "$$:80:${now_epoch}:worker" > "$TEST_LOG_DIR/.active_pids"
echo "$now_epoch" > "$TEST_LOG_DIR/heartbeat-80"
output=$(run_status)
assert_contains "shows KB for small files" "KB" "$output"

# Create a file ~1.2MB
dd if=/dev/zero of="$TEST_LOG_DIR/issue-81.log" bs=1024 count=1230 2>/dev/null
echo "$$:81:${now_epoch}:worker" > "$TEST_LOG_DIR/.active_pids"
echo "$now_epoch" > "$TEST_LOG_DIR/heartbeat-81"
output=$(run_status)
assert_contains "shows MB for large files" "MB" "$output"

# --- Test: GitHub progress flag (-g) ------------------------------------------
echo ""
echo "GitHub progress flag (-g):"

# Without -g flag, no GitHub API calls (we test by checking output doesn't have progress tags)
echo "$$:90:${now_epoch}:worker" > "$TEST_LOG_DIR/.active_pids"
echo "$now_epoch" > "$TEST_LOG_DIR/heartbeat-90"
echo "x" > "$TEST_LOG_DIR/issue-90.log"

output=$(run_status)
assert_not_contains "without -g, no progress tag shown" "step_" "$output"

# With -g flag, uses a mock gh command that returns the extracted tag
# (simulates what gh --json -q would return after jq processing)
MOCK_BIN_DIR=$(mktemp -d)
cat > "$MOCK_BIN_DIR/gh" <<'MOCK_GH'
#!/usr/bin/env bash
# Mock gh that returns the extracted progress tag (as jq capture would)
if [[ "$*" == *"issue view"* ]]; then
  echo "step_3_implement"
fi
MOCK_GH
chmod +x "$MOCK_BIN_DIR/gh"

output=$(PATH="$MOCK_BIN_DIR:$PATH" run_status -g)
assert_contains "with -g, shows progress tag" "step_3_implement" "$output"
rm -rf "$MOCK_BIN_DIR"

# With -g flag but no progress comments found (mock returns empty)
MOCK_BIN_DIR2=$(mktemp -d)
cat > "$MOCK_BIN_DIR2/gh" <<'MOCK_GH2'
#!/usr/bin/env bash
echo ""
MOCK_GH2
chmod +x "$MOCK_BIN_DIR2/gh"

output=$(PATH="$MOCK_BIN_DIR2:$PATH" run_status -g)
assert_not_contains "with -g but no progress comments, no tag shown" "step_" "$output"
rm -rf "$MOCK_BIN_DIR2"

# --- Test: Usage includes -g and -a flags -------------------------------------
echo ""
echo "Usage string:"
output=$(LOG_DIR="$TEST_LOG_DIR" DAEMON_STATE_DIR="$TEST_STATE_DIR" bash "$STATUS_SCRIPT" -x 2>&1 || true)
assert_contains "usage shows -g flag" "[-g]" "$output"
assert_contains "usage shows -a flag" "[-a" "$output"

# --- Test: Tmux session display -----------------------------------------------
echo ""
echo "Tmux session display:"

# Set up a worker with a mock tmux that reports a session
echo "$$" > "$TEST_LOG_DIR/.issue-daemon.pid"
now_epoch=$(date +%s)
echo "$$:200:${now_epoch}:worker" > "$TEST_LOG_DIR/.active_pids"
echo "$now_epoch" > "$TEST_LOG_DIR/heartbeat-200"
echo "x" > "$TEST_LOG_DIR/issue-200.log"

# Mock tmux that returns a session matching issue 200
MOCK_TMUX_DIR=$(mktemp -d)
cat > "$MOCK_TMUX_DIR/tmux" <<'MOCK_TMUX'
#!/usr/bin/env bash
if [[ "$1" == "list-sessions" ]]; then
  echo "worker-200"
  echo "worker-300"
fi
MOCK_TMUX
chmod +x "$MOCK_TMUX_DIR/tmux"

output=$(PATH="$MOCK_TMUX_DIR:$PATH" run_status)
assert_contains "shows tmux session name" "tmux:worker-200" "$output"
assert_not_contains "does not show unrelated session" "worker-300" "$output"

# Attach command only shown in verbose mode
assert_not_contains "no attach hint without -v" "tmux attach" "$output"
output=$(PATH="$MOCK_TMUX_DIR:$PATH" run_status -v)
assert_contains "shows attach command with -v" "tmux attach -t 'worker-200'" "$output"

# Test with no tmux available
MOCK_NO_TMUX_DIR=$(mktemp -d)
# Don't put tmux in this dir, but also override PATH to exclude real tmux
output=$(PATH="$MOCK_NO_TMUX_DIR:/usr/bin:/bin" run_status)
assert_not_contains "no tmux info when tmux unavailable" "tmux:" "$output"
assert_not_contains "no attach command when tmux unavailable" "tmux attach" "$output"

# Mock tmux with no matching sessions
MOCK_EMPTY_TMUX_DIR=$(mktemp -d)
cat > "$MOCK_EMPTY_TMUX_DIR/tmux" <<'MOCK_EMPTY'
#!/usr/bin/env bash
if [[ "$1" == "list-sessions" ]]; then
  echo "worker-999"
fi
MOCK_EMPTY
chmod +x "$MOCK_EMPTY_TMUX_DIR/tmux"

output=$(PATH="$MOCK_EMPTY_TMUX_DIR:$PATH" run_status)
assert_not_contains "no tmux info when no session matches" "tmux:" "$output"
assert_not_contains "no attach command when no session matches" "tmux attach" "$output"

rm -rf "$MOCK_TMUX_DIR" "$MOCK_NO_TMUX_DIR" "$MOCK_EMPTY_TMUX_DIR"

# --- Test: -a flag attach to session ------------------------------------------
echo ""
echo "Attach flag (-a):"

# Mock tmux with attach support
MOCK_ATTACH_DIR=$(mktemp -d)
cat > "$MOCK_ATTACH_DIR/tmux" <<'MOCK_ATTACH'
#!/usr/bin/env bash
if [[ "$1" == "list-sessions" ]]; then
  echo "worker-42"
elif [[ "$1" == "attach" ]]; then
  echo "ATTACHED:$3"
fi
MOCK_ATTACH
chmod +x "$MOCK_ATTACH_DIR/tmux"

# Test attach with matching session (note: exec replaces process, so we run in subshell)
# The attach_to_session uses exec, but in the test the mock tmux just echoes
output=$(PATH="$MOCK_ATTACH_DIR:$PATH" run_status -a 42)
assert_contains "attach shows attaching message" "Attaching to tmux session" "$output"
assert_contains "attach targets correct session" "worker-42" "$output"

# Test attach with no matching session
output=$(PATH="$MOCK_ATTACH_DIR:$PATH" LOG_DIR="$TEST_LOG_DIR" DAEMON_STATE_DIR="$TEST_STATE_DIR" bash "$STATUS_SCRIPT" -a 999 2>/dev/null || true)
assert_contains "attach shows error for missing session" "No tmux session found" "$output"
assert_contains "attach mentions issue number" "#999" "$output"

# Test attach when tmux is not available
output=$(PATH="$MOCK_NO_TMUX_DIR:/usr/bin:/bin" LOG_DIR="$TEST_LOG_DIR" DAEMON_STATE_DIR="$TEST_STATE_DIR" bash "$STATUS_SCRIPT" -a 42 2>/dev/null || true)
assert_contains "attach shows error when tmux unavailable" "No tmux session found" "$output"

# Test -a with non-numeric input
output=$(LOG_DIR="$TEST_LOG_DIR" DAEMON_STATE_DIR="$TEST_STATE_DIR" bash "$STATUS_SCRIPT" -a "abc" 2>&1 || true)
assert_contains "rejects non-numeric -a argument" "numeric issue number" "$output"

rm -rf "$MOCK_ATTACH_DIR"

# --- Test: find_tmux_session priority -----------------------------------------
echo ""
echo "Tmux session name matching priority:"

# Mock tmux with both exact and partial matches
MOCK_PRIORITY_DIR=$(mktemp -d)
cat > "$MOCK_PRIORITY_DIR/tmux" <<'MOCK_PRIORITY'
#!/usr/bin/env bash
if [[ "$1" == "list-sessions" ]]; then
  echo "some-other-session-55"
  echo "worker-55"
fi
MOCK_PRIORITY
chmod +x "$MOCK_PRIORITY_DIR/tmux"

echo "$$:55:${now_epoch}:worker" > "$TEST_LOG_DIR/.active_pids"
echo "$now_epoch" > "$TEST_LOG_DIR/heartbeat-55"
echo "x" > "$TEST_LOG_DIR/issue-55.log"

output=$(PATH="$MOCK_PRIORITY_DIR:$PATH" run_status)
assert_contains "prefers exact worker-N session name" "tmux:worker-55" "$output"

rm -rf "$MOCK_PRIORITY_DIR"

# --- Test: CI Health section (no state) ---------------------------------------
echo ""
echo "CI Health section (no state):"

# Ensure daemon is "running" for all CI health tests
echo "$$" > "$TEST_LOG_DIR/.issue-daemon.pid"
# Need at least one live worker to get past the "not running" / "no workers" guards
now_epoch=$(date +%s)
echo "$$:500:${now_epoch}:worker" > "$TEST_LOG_DIR/.active_pids"
echo "$now_epoch" > "$TEST_LOG_DIR/heartbeat-500"
echo "x" > "$TEST_LOG_DIR/issue-500.log"

# No CI monitor state file exists
rm -f "$TEST_STATE_DIR/ci-monitor-state"
rm -f "$TEST_STATE_DIR/ci-monitor-disabled"
output=$(run_status)
assert_contains "shows CI Health header" "CI Health" "$output"
assert_contains "shows no data when no state file" "No data" "$output"

# --- Test: CI Health section (disabled) ---------------------------------------
echo ""
echo "CI Health section (disabled):"

# Disable via sentinel file
touch "$TEST_STATE_DIR/ci-monitor-disabled"
output=$(run_status)
assert_contains "shows disabled status via file" "disabled" "$output"
rm -f "$TEST_STATE_DIR/ci-monitor-disabled"

# Disable via env var
output=$(CI_MONITOR_DISABLED=1 run_status)
assert_contains "shows disabled status via env var" "disabled" "$output"

# --- Test: CI Health section (with state entries) -----------------------------
echo ""
echo "CI Health section (with entries):"

CI_STATE_FILE="$TEST_STATE_DIR/ci-monitor-state"
detected=$((now_epoch - 3600))  # 1h ago

# Write sample entries: 2 rerunning, 1 filed, 1 resolved
echo "1001|rerunning|fp1|${detected}||100|CI Build" > "$CI_STATE_FILE"
echo "1002|rerunning|fp2|${detected}|||PR Check" >> "$CI_STATE_FILE"
echo "1003|filed|fp3|${detected}||200|CI Build" >> "$CI_STATE_FILE"
echo "1004|resolved|fp4|${detected}|||Deploy" >> "$CI_STATE_FILE"

output=$(CI_MONITOR_STATE_FILE="$CI_STATE_FILE" run_status)
assert_contains "shows rerunning count" "rerunning: 2" "$output"
assert_contains "shows filed count" "filed: 1" "$output"
assert_contains "shows resolved count" "resolved: 1" "$output"

# --- Test: CI Health verbose mode ---------------------------------------------
echo ""
echo "CI Health verbose mode:"

output=$(CI_MONITOR_STATE_FILE="$CI_STATE_FILE" run_status -v)
assert_contains "verbose shows run IDs" "1001" "$output"
assert_contains "verbose shows workflow name" "CI Build" "$output"
assert_contains "verbose shows status" "rerunning" "$output"

# Non-verbose should not show individual entries
output=$(CI_MONITOR_STATE_FILE="$CI_STATE_FILE" run_status)
assert_not_contains "non-verbose hides run IDs" "1001" "$output"

# --- Test: CI Health GitHub issue count (with -g flag) ------------------------
echo ""
echo "CI Health GitHub issue count:"

# Without -g, no issue count line
output=$(CI_MONITOR_STATE_FILE="$CI_STATE_FILE" run_status)
assert_not_contains "without -g, no open issues count" "open issues" "$output"

# With -g, mock gh to return a count
MOCK_CI_GH_DIR=$(mktemp -d)
cat > "$MOCK_CI_GH_DIR/gh" <<'MOCK_CI_GH'
#!/usr/bin/env bash
if [[ "$*" == *"issue list"*"ci-failure"* ]]; then
  echo "3"
elif [[ "$*" == *"issue view"* ]]; then
  echo ""
fi
MOCK_CI_GH
chmod +x "$MOCK_CI_GH_DIR/gh"

output=$(PATH="$MOCK_CI_GH_DIR:$PATH" CI_MONITOR_STATE_FILE="$CI_STATE_FILE" run_status -g)
assert_contains "with -g, shows open issue count" "3 open" "$output"

rm -rf "$MOCK_CI_GH_DIR"

# --- Test: CI Health with only some statuses ----------------------------------
echo ""
echo "CI Health with partial statuses:"

echo "2001|filed|fp5|${detected}||300|CI Build" > "$CI_STATE_FILE"
output=$(CI_MONITOR_STATE_FILE="$CI_STATE_FILE" run_status)
assert_contains "shows filed when only status present" "filed: 1" "$output"
# Zero counts should still show
assert_contains "shows zero rerunning" "rerunning: 0" "$output"

rm -f "$CI_STATE_FILE"

# --- Test: Shellcheck ---------------------------------------------------------
echo ""
echo "Shellcheck:"
if shellcheck -x "$STATUS_SCRIPT" 2>/dev/null; then
  pass "shellcheck passes on daemon-status.sh"
else
  fail "shellcheck passes on daemon-status.sh" "no warnings" "warnings found"
fi

# --- Cleanup ------------------------------------------------------------------
rm -rf "$TEST_LOG_DIR" "$TEST_STATE_DIR"

# --- Summary ------------------------------------------------------------------
echo ""
echo "=== Results ==="
echo "  ${TESTS_PASSED}/${TESTS_RUN} passed, ${TESTS_FAILED} failed"
echo ""

if [ "$TESTS_FAILED" -gt 0 ]; then
  exit 1
fi
