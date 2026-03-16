#!/usr/bin/env bash
# issue-daemon-spawn-dedup.test.sh — Tests for per-cycle spawn deduplication
# and synchronous label swap in issue-daemon.sh
#
# Run: bash scripts/__tests__/issue-daemon-spawn-dedup.test.sh

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

echo ""
echo "=== Spawn deduplication and synchronous label swap tests ==="
echo ""

# --- spawned_this_cycle variable ----------------------------------------------
echo "spawned_this_cycle variable:"

assert_grep "spawned_this_cycle is declared/reset at top of poll cycle" \
  'declare -A spawned_this_cycle' "$DAEMON_SCRIPT"

# --- Label swaps NOT inside backgrounded functions ----------------------------
echo ""
echo "Label swaps removed from backgrounded functions:"

# Extract function bodies using awk (macOS compatible)
run_worker_body=$(awk '/^run_worker\(\) \{/,/^}/' "$DAEMON_SCRIPT")
run_plan_executor_body=$(awk '/^run_plan_executor\(\) \{/,/^}/' "$DAEMON_SCRIPT")
run_bug_investigator_body=$(awk '/^run_bug_investigator\(\) \{/,/^}/' "$DAEMON_SCRIPT")

# run_worker should NOT have the claude-ready -> claude-wip swap for fresh starts
if echo "$run_worker_body" | grep -qE 'remove-label.*LABEL_READY.*add-label.*LABEL_WIP'; then
  fail "run_worker does NOT swap claude-ready labels internally" \
    "no fresh-start label swap in run_worker" "found label swap"
else
  pass "run_worker does NOT swap claude-ready labels internally"
fi

# run_plan_executor should NOT have the label swap inside
if echo "$run_plan_executor_body" | grep -qE 'remove-label.*LABEL_APPROVED.*add-label.*LABEL_WIP'; then
  fail "run_plan_executor does NOT swap labels internally" \
    "no label swap in run_plan_executor" "found label swap"
else
  pass "run_plan_executor does NOT swap labels internally"
fi

# run_bug_investigator should NOT have the label swap inside
if echo "$run_bug_investigator_body" | grep -qE 'remove-label.*LABEL_BUG_INVESTIGATE.*add-label.*LABEL_WIP'; then
  fail "run_bug_investigator does NOT swap labels internally" \
    "no label swap in run_bug_investigator" "found label swap"
else
  pass "run_bug_investigator does NOT swap labels internally"
fi

# --- Synchronous label swaps in main loop -------------------------------------
echo ""
echo "Synchronous label swaps in main loop (before spawn):"

# Priority 2 section should have label swap before run_worker
p2_section=$(awk '/Priority 2: Ready work issues/,/Priority 3/' "$DAEMON_SCRIPT")
if echo "$p2_section" | grep -q 'remove-label.*LABEL_READY.*add-label.*LABEL_WIP'; then
  pass "Priority 2 section has label swap for ready issues"
else
  fail "Priority 2 section has label swap for ready issues" \
    "label swap in main loop" "not found"
fi

# Priority 1 section should have label swap before run_plan_executor
p1_section=$(awk '/Priority 1: Approved plans/,/Priority 1\.25/' "$DAEMON_SCRIPT")
if echo "$p1_section" | grep -q 'remove-label.*LABEL_APPROVED.*add-label.*LABEL_WIP'; then
  pass "Priority 1 section has label swap for approved plans"
else
  fail "Priority 1 section has label swap for approved plans" \
    "label swap in main loop" "not found"
fi

# --- Dedup checks at all spawn points ----------------------------------------
echo ""
echo "Dedup checks at all spawn points:"

assert_grep "spawned_this_cycle check exists before spawn calls" \
  'spawned_this_cycle\[' "$DAEMON_SCRIPT"

assert_grep "spawned_this_cycle is populated after spawn" \
  'spawned_this_cycle\[.*\]=1' "$DAEMON_SCRIPT"

# Count spawn points and dedup checks
spawn_count=$(grep -cE 'run_worker.*&|run_plan_executor.*&|run_bug_investigator.*&|run_plan_writer.*&' "$DAEMON_SCRIPT" || true)
dedup_check_count=$(grep -c 'spawned_this_cycle\[' "$DAEMON_SCRIPT" || true)
if [ "$dedup_check_count" -ge "$spawn_count" ]; then
  pass "dedup references ($dedup_check_count) >= spawn point count ($spawn_count)"
else
  fail "dedup check at every spawn point" \
    "at least $spawn_count dedup references" "$dedup_check_count dedup references"
fi

# --- Resume and retry still have their own label swaps ------------------------
echo ""
echo "Resume and retry label swaps preserved:"

if echo "$run_worker_body" | grep -q 'LABEL_RESUME'; then
  pass "run_worker still handles resume label"
else
  fail "run_worker still handles resume label" "LABEL_RESUME reference" "not found"
fi

if echo "$run_worker_body" | grep -q 'LABEL_INTERRUPTED'; then
  pass "run_worker still handles retry/interrupted label"
else
  fail "run_worker still handles retry/interrupted label" "LABEL_INTERRUPTED reference" "not found"
fi

# --- Summary ------------------------------------------------------------------
echo ""
echo "=== Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed ==="

if [ "$TESTS_FAILED" -gt 0 ]; then
  exit 1
fi
