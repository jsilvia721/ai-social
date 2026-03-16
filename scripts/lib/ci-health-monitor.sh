#!/usr/bin/env bash
# ci-health-monitor.sh — CI health monitoring for the issue daemon.
#
# Detects failed CI runs on main, triggers reruns, and files issues
# for persistent failures.
#
# Usage:
#   source scripts/lib/ci-health-monitor.sh
#   check_ci_health   # call once per poll cycle (Priority -1)
#
# Dependencies:
#   - scripts/lib/daemon-state.sh (ci_monitor_* functions)
#   - gh CLI
#   - log() function from the daemon
#
# Escape hatches:
#   - CI_MONITOR_DISABLED=1 env var
#   - $DAEMON_STATE_DIR/ci-monitor-disabled file

# Constants (can be overridden before sourcing)
: "${LABEL_CI_FAILURE:=ci-failure}"
: "${LABEL_BUG_INVESTIGATE:=bug-investigate}"
: "${CI_MONITOR_RERUN_TIMEOUT:=600}"

# --- Helper functions ---------------------------------------------------------

# Generate a deterministic fingerprint for a CI failure.
# $1 — workflow name, $2 — head SHA
generate_ci_fingerprint() {
  local workflow="$1"
  local sha="$2"
  # Use CI_FINGERPRINT_OVERRIDE for testing
  if [ -n "${CI_FINGERPRINT_OVERRIDE:-}" ]; then
    echo "$CI_FINGERPRINT_OVERRIDE"
    return
  fi
  echo "ci-${workflow}-${sha}" | shasum -a 256 | cut -c1-16
}

# Filter CI runs JSON to only actionable failures.
# Removes: cancelled, skipped, in-progress, non-push, already-tracked runs.
# $1 — JSON array from gh run list
# Outputs: filtered JSON array
filter_ci_runs() {
  local runs_json="$1"
  local state_file="${CI_MONITOR_STATE_FILE:-${DAEMON_STATE_DIR}/ci-monitor-state}"

  # Build list of already-tracked run IDs
  local tracked_ids=""
  if [ -f "$state_file" ]; then
    tracked_ids=$(awk -F'|' '{print $1}' "$state_file" | tr '\n' ',' | sed 's/,$//')
  fi

  echo "$runs_json" | jq --arg tracked "$tracked_ids" '
    [.[] | select(
      .event == "push" and
      .conclusion == "failure" and
      ((.databaseId | tostring) as $id |
        ($tracked | split(",") | map(select(. != "")) | index($id) | not))
    )]'
}

# Truncate CI log output to relevant error lines.
# Extracts lines matching error patterns with 3 lines context.
# Caps at 150 lines and 4000 characters.
# $1 — raw log text
# Outputs: truncated log text
truncate_ci_logs() {
  local raw_log="$1"

  # Extract lines matching error patterns with context
  local filtered
  filtered=$(echo "$raw_log" | grep -n -B1 -A1 \
    -E '(FAIL|Error:|TypeError|AssertionError|::error::|ReferenceError|SyntaxError)' \
    2>/dev/null || echo "$raw_log" | head -20)

  # Cap at 150 lines
  filtered=$(echo "$filtered" | head -150)

  # Redact potential secrets from log output
  filtered=$(echo "$filtered" | sed -E \
    -e 's/(DATABASE_URL|SECRET|TOKEN|PASSWORD|KEY|PRIVATE_KEY|API_KEY)=[^ ]*/\1=***REDACTED***/g' \
    -e 's/(Bearer |token |sk-)[A-Za-z0-9+/=_-]{20,}/\1***REDACTED***/g')

  # Cap at 4000 characters
  if [ ${#filtered} -gt 4000 ]; then
    filtered="${filtered:0:3985}
...(truncated)"
  fi

  echo "$filtered"
}

# Format the issue body for a CI failure.
# $1 — run URL, $2 — workflow name, $3 — commit SHA,
# $4 — error logs, $5 — fingerprint, $6 — rerun result
format_ci_issue_body() {
  local run_url="$1"
  local workflow="$2"
  local sha="$3"
  local error_logs="$4"
  local fingerprint="$5"
  local rerun_result="$6"

  # Use printf to avoid shell expansion of log content (security: CI logs
  # could contain $() or backticks that would execute in an unquoted heredoc)
  printf '## CI Failure Details\n\n'
  printf '| Field | Value |\n'
  printf '|-------|-------|\n'
  printf '| **Run URL** | %s |\n' "$run_url"
  printf '| **Workflow** | %s |\n' "$workflow"
  printf '| **Commit SHA** | `%s` |\n' "$sha"
  printf '| **Rerun result** | %s |\n' "$rerun_result"
  printf '| **Fingerprint** | `%s` |\n' "$fingerprint"
  printf '\n## Error Logs\n\n```\n%s\n```\n' "$error_logs"
  printf '\n---\n*Filed automatically by the issue daemon CI health monitor.*\n'
}

# --- Main check function ------------------------------------------------------

# check_ci_health — Run at Priority -1 in each poll cycle.
# Does NOT consume a worker slot. Runs inline.
# Does NOT trigger the circuit breaker on API errors.
check_ci_health() {
  # --- Escape hatches ---
  if [ "${CI_MONITOR_DISABLED:-0}" = "1" ]; then
    log "CI monitor disabled via env var"
    return 0
  fi
  if [ -f "${DAEMON_STATE_DIR}/ci-monitor-disabled" ]; then
    log "CI monitor disabled via file"
    return 0
  fi

  # --- Phase 1: Follow up on existing rerunning entries ---
  local state_file="${CI_MONITOR_STATE_FILE:-${DAEMON_STATE_DIR}/ci-monitor-state}"
  if [ -f "$state_file" ]; then
    # Process rerunning entries
    local rerunning_entries
    rerunning_entries=$(awk -F'|' '$2 == "rerunning" { print $0 }' "$state_file" 2>/dev/null || echo "")

    if [ -n "$rerunning_entries" ]; then
      while IFS='|' read -r run_id entry_status fingerprint detected_epoch rerun_epoch issue_num workflow; do
        [ -z "$run_id" ] && continue

        # Check rerun status
        local rerun_result
        rerun_result=$(gh run view "$run_id" --json status,conclusion 2>/dev/null || echo "")
        if [ -z "$rerun_result" ]; then
          log "CI monitor: API error checking rerun status for run $run_id, skipping"
          continue
        fi

        local rerun_status rerun_conclusion
        rerun_status=$(echo "$rerun_result" | jq -r '.status' 2>/dev/null || echo "")
        rerun_conclusion=$(echo "$rerun_result" | jq -r '.conclusion // empty' 2>/dev/null || echo "")

        if [ "$rerun_status" = "completed" ] && [ "$rerun_conclusion" = "success" ]; then
          # Rerun succeeded — check if latest main is green
          log "CI monitor: rerun of run $run_id succeeded"
          ci_monitor_update "$run_id" "resolved"
          continue
        fi

        if [ "$rerun_status" = "completed" ] && [ "$rerun_conclusion" = "failure" ]; then
          # Rerun failed — check green-check before filing
          log "CI monitor: rerun of run $run_id failed, checking green-check"
          _ci_green_check_and_file "$run_id" "$workflow" "$fingerprint" "Rerun failed"
          continue
        fi

        # Still running — check timeout
        local now_epoch
        now_epoch=$(date +%s)
        local elapsed=0
        if [ -n "$rerun_epoch" ] && [ "$rerun_epoch" -gt 0 ] 2>/dev/null; then
          elapsed=$(( now_epoch - rerun_epoch ))
        fi

        if [ "$elapsed" -ge "$CI_MONITOR_RERUN_TIMEOUT" ]; then
          log "CI monitor: rerun of run $run_id timed out (${elapsed}s > ${CI_MONITOR_RERUN_TIMEOUT}s)"
          _ci_green_check_and_file "$run_id" "$workflow" "$fingerprint" "Rerun timed out after ${elapsed}s"
          continue
        fi

        # Still within timeout, skip
      done <<< "$rerunning_entries"
    fi
  fi

  # --- Phase 2: Detect new failures ---
  local runs_json
  runs_json=$(gh run list --branch main --limit 10 \
    --json databaseId,conclusion,workflowName,event,headSha 2>/dev/null || echo "")

  if [ -z "$runs_json" ] || [ "$runs_json" = "null" ]; then
    log "CI monitor: API error fetching run list, skipping"
    return 0
  fi

  # Filter to actionable failures
  local new_failures
  new_failures=$(filter_ci_runs "$runs_json" 2>/dev/null || echo "[]")

  local failure_count
  failure_count=$(echo "$new_failures" | jq 'length' 2>/dev/null || echo "0")

  if [ "$failure_count" -eq 0 ]; then
    return 0
  fi

  # Process each new failure (cap at 3 per cycle to avoid burst filing)
  local i=0
  local processed_this_cycle=0
  local MAX_NEW_FAILURES_PER_CYCLE=3
  while [ "$i" -lt "$failure_count" ] && [ "$processed_this_cycle" -lt "$MAX_NEW_FAILURES_PER_CYCLE" ]; do
    local run_id workflow sha
    run_id=$(echo "$new_failures" | jq -r ".[$i].databaseId")
    workflow=$(echo "$new_failures" | jq -r ".[$i].workflowName")
    sha=$(echo "$new_failures" | jq -r ".[$i].headSha")

    # Validate run_id is numeric (defense against unexpected API responses)
    case "$run_id" in
      *[!0-9]*|""|"null") log "CI monitor: invalid run_id at index $i, skipping"; i=$((i + 1)); continue ;;
    esac

    # Sanitize workflow name — allow only safe characters
    workflow=$(echo "$workflow" | tr -cd '[:alnum:] ._-')

    local fingerprint
    fingerprint=$(generate_ci_fingerprint "$workflow" "$sha")

    # Check for duplicate fingerprint with open issue
    if ci_monitor_fingerprint_open "$fingerprint" 2>/dev/null; then
      log "CI monitor: skipping run $run_id — duplicate fingerprint $fingerprint already filed"
      # Track as detected to avoid re-processing
      ci_monitor_track "$run_id" "detected" "$fingerprint" "$workflow" "" ""
      i=$((i + 1))
      continue
    fi

    # Attempt rerun
    local rerun_ok=true
    if ! gh run rerun "$run_id" --failed 2>/dev/null; then
      log "CI monitor: rerun failed for run $run_id, proceeding to file"
      rerun_ok=false
    fi

    if [ "$rerun_ok" = "true" ]; then
      # Track as rerunning
      local now_epoch
      now_epoch=$(date +%s)
      ci_monitor_track "$run_id" "rerunning" "$fingerprint" "$workflow" "" "$now_epoch"
      log "CI monitor: triggered rerun for run $run_id ($workflow), tracking as rerunning"
    else
      # Rerun failed — skip rerun, proceed directly to filing
      ci_monitor_track "$run_id" "detected" "$fingerprint" "$workflow" "" ""
      _ci_green_check_and_file "$run_id" "$workflow" "$fingerprint" "Rerun could not be triggered"
    fi

    processed_this_cycle=$((processed_this_cycle + 1))
    i=$((i + 1))
  done

  if [ "$processed_this_cycle" -ge "$MAX_NEW_FAILURES_PER_CYCLE" ] && [ "$i" -lt "$failure_count" ]; then
    log "CI monitor: hit per-cycle cap ($MAX_NEW_FAILURES_PER_CYCLE), deferring $((failure_count - i)) remaining failures"
  fi

  # Prune old entries periodically
  ci_monitor_prune 2>/dev/null || true
}

# Internal: Check if latest main is green, then either resolve or file.
# $1 — run ID, $2 — workflow, $3 — fingerprint, $4 — rerun result description
_ci_green_check_and_file() {
  local run_id="$1"
  local workflow="$2"
  local fingerprint="$3"
  local rerun_result="$4"

  # Green-check: is the latest main run now passing?
  local latest_runs
  latest_runs=$(gh run list --branch main --limit 1 \
    --json databaseId,conclusion,workflowName,event 2>/dev/null || echo "[]")

  local latest_conclusion
  latest_conclusion=$(echo "$latest_runs" | jq -r '.[0].conclusion // empty' 2>/dev/null || echo "")

  if [ -n "$latest_conclusion" ]; then
    if [ "$latest_conclusion" = "success" ]; then
      log "CI monitor: latest main run is green — marking run $run_id as resolved"
      ci_monitor_update "$run_id" "resolved"
      return 0
    fi
  fi

  # Check duplicate fingerprint again before filing
  if ci_monitor_fingerprint_open "$fingerprint" 2>/dev/null; then
    log "CI monitor: skipping run $run_id — duplicate fingerprint $fingerprint already filed"
    ci_monitor_update "$run_id" "detected"
    return 0
  fi

  # Fetch failed logs
  local error_logs=""
  local raw_logs
  raw_logs=$(gh run view "$run_id" --log-failed 2>/dev/null || echo "")
  if [ -n "$raw_logs" ]; then
    error_logs=$(truncate_ci_logs "$raw_logs")
  fi

  # Get run URL
  local run_url
  run_url=$(gh run view "$run_id" --json url -q '.url' 2>/dev/null || echo "https://github.com/actions/runs/$run_id")

  # Get commit SHA from state
  local sha=""
  if [ -f "${CI_MONITOR_STATE_FILE:-${DAEMON_STATE_DIR}/ci-monitor-state}" ]; then
    # SHA isn't in state file — fetch from API
    sha=$(gh run view "$run_id" --json headSha -q '.headSha' 2>/dev/null || echo "unknown")
  fi

  local body
  body=$(format_ci_issue_body "$run_url" "$workflow" "$sha" "$error_logs" "$fingerprint" "$rerun_result")

  # File the issue
  local issue_url
  issue_url=$(gh issue create \
    --title "CI failure on main: ${workflow}" \
    --label "$LABEL_BUG_INVESTIGATE" \
    --label "$LABEL_CI_FAILURE" \
    --body "$body" 2>/dev/null || echo "")

  if [ -n "$issue_url" ]; then
    local issue_number
    issue_number=$(echo "$issue_url" | grep -o '[0-9]*$' || echo "")
    ci_monitor_update "$run_id" "filed" "$issue_number" ""
    log "CI monitor: filed issue $issue_url for run $run_id ($workflow)"
  else
    log "CI monitor: API error filing issue for run $run_id, will retry next cycle"
  fi
}
