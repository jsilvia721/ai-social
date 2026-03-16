#!/usr/bin/env bash
# daemon-reconcile.sh — Startup reconciliation for orphaned WIP issues.
#
# On daemon startup (after PID guard), queries GitHub for open claude-wip issues
# and cross-references with the PID file. Orphaned issues (no matching PID entry)
# get transitioned to claude-interrupted with a comment explaining the daemon restart.
#
# Required env/globals: log(), PID_FILE, LABEL_WIP, LABEL_INTERRUPTED
# Required on PATH: gh

# Reconcile orphaned WIP issues on daemon startup.
# Queries GitHub for open WIP issues, checks each against PID file entries,
# and transitions orphans to interrupted state.
reconcile_orphaned_wip_issues() {
  log "Startup reconciliation: checking for orphaned WIP issues..."

  # Query GitHub for open WIP issues (cap at 50 to limit API calls)
  local wip_issues
  wip_issues=$(gh issue list --state open --label "$LABEL_WIP" --limit 50 --json number --jq '.[].number' 2>/dev/null || echo "")

  if [ -z "$wip_issues" ]; then
    log "Startup reconciliation: no open WIP issues found"
    return 0
  fi

  local wip_count
  wip_count=$(echo "$wip_issues" | wc -l | tr -d ' ')

  # Read PID file contents once (empty string if file missing/empty)
  local pid_contents=""
  if [ -f "$PID_FILE" ] && [ -s "$PID_FILE" ]; then
    pid_contents=$(cat "$PID_FILE" 2>/dev/null || echo "")
  fi

  local orphan_count=0

  while IFS= read -r issue_number; do
    [ -z "$issue_number" ] && continue
    # Validate issue number is numeric (defense-in-depth against malformed API responses)
    case "$issue_number" in *[!0-9]*|"") continue ;; esac

    # Check if any PID file entry contains this issue number
    # PID file format: PID:ISSUE_NUMBER:START_EPOCH:TYPE — anchor to second field
    if [ -n "$pid_contents" ] && echo "$pid_contents" | grep -q "^[^:]*:${issue_number}:"; then
      continue  # Issue has a matching PID entry — not orphaned
    fi

    # Orphaned — transition to interrupted
    log "Reconciling orphaned WIP issue #${issue_number}: removing $LABEL_WIP, adding $LABEL_INTERRUPTED"
    gh issue edit "$issue_number" --remove-label "$LABEL_WIP" 2>/dev/null || true
    gh issue edit "$issue_number" --add-label "$LABEL_INTERRUPTED" 2>/dev/null || true
    gh issue comment "$issue_number" --body "<!-- daemon:reconcile -->Daemon restarted — this issue was still labeled \`$LABEL_WIP\` with no active worker. Transitioning to \`$LABEL_INTERRUPTED\` for retry." 2>/dev/null || true
    orphan_count=$((orphan_count + 1))
  done <<< "$wip_issues"

  log "Startup reconciliation complete: ${wip_count} WIP issues checked, ${orphan_count} orphaned and transitioned"
}
