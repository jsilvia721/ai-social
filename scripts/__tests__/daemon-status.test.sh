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

# --- Test: Usage includes -g flag ---------------------------------------------
echo ""
echo "Usage string:"
output=$(LOG_DIR="$TEST_LOG_DIR" DAEMON_STATE_DIR="$TEST_STATE_DIR" bash "$STATUS_SCRIPT" -x 2>&1 || true)
assert_contains "usage shows -g flag" "[-g]" "$output"

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
