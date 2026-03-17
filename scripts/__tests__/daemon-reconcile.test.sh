#!/usr/bin/env bash
# daemon-reconcile.test.sh — Unit tests for startup reconciliation of orphaned WIP issues
#
# Run: bash scripts/__tests__/daemon-reconcile.test.sh

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

assert_contains() {
  local description="$1"
  local needle="$2"
  local haystack="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    pass "$description"
  else
    fail "$description" "contains '$needle'" "$haystack"
  fi
}

# --- Test setup ---------------------------------------------------------------
echo ""
echo "=== Daemon Startup Reconciliation Tests ==="
echo ""

TEST_LOG_DIR=$(mktemp -d)
TEST_PID_FILE="$TEST_LOG_DIR/.active_pids"

# Track gh CLI calls for verification
GH_CALL_LOG="$TEST_LOG_DIR/gh_calls.log"
: > "$GH_CALL_LOG"

# Create a mock gh script
MOCK_BIN_DIR="$TEST_LOG_DIR/bin"
mkdir -p "$MOCK_BIN_DIR"

# --- Helpers ------------------------------------------------------------------

# Set up a mock gh that returns specified issue numbers for list queries
# and logs edit/comment calls.
# $1 — space-separated list of issue numbers to return from 'gh issue list'
setup_mock_gh() {
  local issues="$1"
  cat > "$MOCK_BIN_DIR/gh" << 'GHEOF'
#!/usr/bin/env bash
echo "$*" >> "$GH_CALL_LOG"
if [ "$1" = "issue" ] && [ "$2" = "list" ]; then
  # Return mock issue numbers from env var
  for num in $MOCK_WIP_ISSUES; do
    echo "$num"
  done
  exit 0
fi
# For edit/comment, just succeed silently
exit 0
GHEOF
  chmod +x "$MOCK_BIN_DIR/gh"
  export MOCK_WIP_ISSUES="$issues"
  export GH_CALL_LOG
}

# Source just the reconciliation function from the daemon.
# We extract it to avoid running the entire daemon script.
# Instead, we define the function inline and test it.
#
# The function needs: log(), PID_FILE, LABEL_WIP, LABEL_INTERRUPTED, and gh on PATH.

# Minimal log function for testing
log() {
  echo "[daemon] $*" >> "$TEST_LOG_DIR/daemon.log"
}

# Export for subshells
export -f log
export TEST_LOG_DIR

# --- Define the function under test -------------------------------------------
# This mirrors the implementation that will be added to issue-daemon.sh.
# We source it from the actual file once implemented; for now define inline.

# Source the actual reconciliation function from daemon
source_reconcile_function() {
  LABEL_WIP="claude-wip"
  LABEL_INTERRUPTED="claude-interrupted"
  export PID_FILE="$TEST_PID_FILE"
  export PATH="$MOCK_BIN_DIR:$PATH"

  # Source the function from the daemon script by extracting it
  # We use a helper that defines reconcile_orphaned_wip_issues
  source "$REPO_ROOT/scripts/lib/daemon-reconcile.sh"
}

# --- Tests --------------------------------------------------------------------

echo "--- reconcile_orphaned_wip_issues ---"

# Test 1: No WIP issues found — should do nothing
: > "$TEST_PID_FILE"
: > "$GH_CALL_LOG"
: > "$TEST_LOG_DIR/daemon.log"
setup_mock_gh ""
source_reconcile_function
reconcile_orphaned_wip_issues
gh_edits=$({ grep -c "issue edit" "$GH_CALL_LOG" 2>/dev/null || true; })
assert_eq "No WIP issues: no edits made" "0" "$gh_edits"

# Test 2: WIP issue with matching PID entry — should NOT reconcile
: > "$TEST_PID_FILE"
echo "12345:42:1700000000:worker" >> "$TEST_PID_FILE"
: > "$GH_CALL_LOG"
: > "$TEST_LOG_DIR/daemon.log"
setup_mock_gh "42"
source_reconcile_function
reconcile_orphaned_wip_issues
gh_edits=$({ grep -c "issue edit" "$GH_CALL_LOG" 2>/dev/null || true; })
assert_eq "Matching PID entry: no edits made" "0" "$gh_edits"

# Test 3: WIP issue with NO matching PID entry — should reconcile
: > "$TEST_PID_FILE"
echo "12345:99:1700000000:worker" >> "$TEST_PID_FILE"
: > "$GH_CALL_LOG"
: > "$TEST_LOG_DIR/daemon.log"
setup_mock_gh "42"
source_reconcile_function
reconcile_orphaned_wip_issues
gh_edits=$({ grep -c "issue edit" "$GH_CALL_LOG" 2>/dev/null || true; })
assert_eq "Orphaned issue: edit calls made" "2" "$gh_edits"
# Should remove claude-wip and add claude-interrupted
gh_edit_calls=$(grep "issue edit" "$GH_CALL_LOG" 2>/dev/null || echo "")
assert_contains "Removes claude-wip label" "remove-label claude-wip" "$gh_edit_calls"
assert_contains "Adds claude-interrupted label" "add-label claude-interrupted" "$gh_edit_calls"
# Should post a comment
gh_comments=$({ grep -c "issue comment" "$GH_CALL_LOG" 2>/dev/null || true; })
assert_eq "Orphaned issue: comment posted" "1" "$gh_comments"

# Test 4: Empty PID file — ALL WIP issues are orphaned
: > "$TEST_PID_FILE"
: > "$GH_CALL_LOG"
: > "$TEST_LOG_DIR/daemon.log"
setup_mock_gh "10 20 30"
source_reconcile_function
reconcile_orphaned_wip_issues
# 3 issues × 2 edit calls each = 6 edit calls
gh_edits=$({ grep -c "issue edit" "$GH_CALL_LOG" 2>/dev/null || true; })
assert_eq "Empty PID file: all 3 issues reconciled (6 edits)" "6" "$gh_edits"
gh_comments=$({ grep -c "issue comment" "$GH_CALL_LOG" 2>/dev/null || true; })
assert_eq "Empty PID file: 3 comments posted" "3" "$gh_comments"

# Test 5: Missing PID file — ALL WIP issues are orphaned
rm -f "$TEST_PID_FILE"
: > "$GH_CALL_LOG"
: > "$TEST_LOG_DIR/daemon.log"
setup_mock_gh "10 20"
source_reconcile_function
reconcile_orphaned_wip_issues
gh_edits=$({ grep -c "issue edit" "$GH_CALL_LOG" 2>/dev/null || true; })
assert_eq "Missing PID file: all 2 issues reconciled (4 edits)" "4" "$gh_edits"

# Test 6: Mixed — some orphaned, some active
: > "$TEST_PID_FILE"
echo "12345:10:1700000000:worker" >> "$TEST_PID_FILE"
echo "12346:30:1700000000:worker" >> "$TEST_PID_FILE"
: > "$GH_CALL_LOG"
: > "$TEST_LOG_DIR/daemon.log"
setup_mock_gh "10 20 30"
source_reconcile_function
reconcile_orphaned_wip_issues
# Only issue 20 should be reconciled (10 and 30 have matching PIDs)
gh_edits=$({ grep -c "issue edit" "$GH_CALL_LOG" 2>/dev/null || true; })
assert_eq "Mixed: only orphaned issue reconciled (2 edits)" "2" "$gh_edits"
gh_comments=$({ grep -c "issue comment" "$GH_CALL_LOG" 2>/dev/null || true; })
assert_eq "Mixed: only 1 comment posted" "1" "$gh_comments"

# Test 7: Logs each reconciliation action
: > "$TEST_PID_FILE"
: > "$GH_CALL_LOG"
: > "$TEST_LOG_DIR/daemon.log"
setup_mock_gh "42"
source_reconcile_function
reconcile_orphaned_wip_issues
log_output=$(cat "$TEST_LOG_DIR/daemon.log")
assert_contains "Logs reconciliation" "Reconciling orphaned WIP issue #42" "$log_output"

# Test 8: Logs summary even when no orphans found
: > "$TEST_PID_FILE"
echo "12345:42:1700000000:worker" >> "$TEST_PID_FILE"
: > "$GH_CALL_LOG"
: > "$TEST_LOG_DIR/daemon.log"
setup_mock_gh "42"
source_reconcile_function
reconcile_orphaned_wip_issues
log_output=$(cat "$TEST_LOG_DIR/daemon.log")
assert_contains "Logs startup check" "Startup reconciliation" "$log_output"

# --- Cleanup ------------------------------------------------------------------
rm -rf "$TEST_LOG_DIR"

echo ""
echo "=== Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed ==="
[ "$TESTS_FAILED" -eq 0 ] || exit 1
