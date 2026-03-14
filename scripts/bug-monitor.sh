#!/usr/bin/env bash
# bug-monitor.sh — Polls CloudWatch Logs and the ErrorReport DB table for
# errors, deduplicates them, and files GitHub issues labeled for the
# issue-worker pipeline.
#
# Usage:
#   ./scripts/bug-monitor.sh                    # defaults: 5min poll, error level
#   ./scripts/bug-monitor.sh -i 120 -s warn     # 2min poll, include warnings
#   ./scripts/bug-monitor.sh -n                  # dry run
#   ./scripts/bug-monitor.sh -l /aws/lambda/foo  # specific log group (repeatable)
#
# Requirements:
#   - gh CLI authenticated
#   - aws CLI configured
#   - jq on PATH
#   - psql on PATH (for DB queries)
#   - DATABASE_URL env var set
#   - Run from the repo root

set -euo pipefail

# --- Configuration -----------------------------------------------------------
POLL_INTERVAL=300          # seconds between polls (default: 5 minutes)
SEVERITY="error"           # minimum severity: "error" or "warn"
DRY_RUN=false              # if true, print actions without executing
MAX_ISSUES_PER_CYCLE=5     # safety guard: max issues created per poll cycle
MAX_SELF_ISSUES_PER_CYCLE=2  # max self-health issues per poll cycle (separate from app bugs)
MIN_COUNT_THRESHOLD=1      # skip errors seen fewer than this many times (unless FATAL)
COOLDOWN_SECONDS=1800      # don't re-check the same fingerprint within this window (CloudWatch only)
LOG_DIR="./logs/bug-monitor"
LABEL_BUG="bug-report"
LABEL_TRIAGE="needs-triage"
LABEL_BUG_MONITOR_HEALTH="bug-monitor-health"

# User-specified log groups (empty = auto-discover)
declare -a LOG_GROUPS=()

# --- Parse flags --------------------------------------------------------------
while getopts "i:s:nl:" opt; do
  case $opt in
    i) POLL_INTERVAL=$OPTARG ;;
    s) SEVERITY=$OPTARG ;;
    n) DRY_RUN=true ;;
    l) LOG_GROUPS+=("$OPTARG") ;;
    *) echo "Usage: $0 [-i interval] [-s error|warn] [-n] [-l log-group]" && exit 1 ;;
  esac
done

# --- Validation ---------------------------------------------------------------
if [ "$SEVERITY" != "error" ] && [ "$SEVERITY" != "warn" ]; then
  echo "Error: -s must be 'error' or 'warn'" >&2
  exit 1
fi

if ! [[ "$POLL_INTERVAL" =~ ^[1-9][0-9]*$ ]]; then
  echo "Error: -i must be a positive integer" >&2
  exit 1
fi

# --- Setup --------------------------------------------------------------------
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
mkdir -p "$LOG_DIR"

# Auto-load environment file if present (e.g. DATABASE_URL)
if [ -f ".env.bug-monitor.local" ]; then
  set -a
  # shellcheck source=/dev/null
  source ".env.bug-monitor.local"
  set +a
fi

# Source the CloudWatch query helper
# shellcheck source=scripts/lib/cloudwatch-query.sh
source "scripts/lib/cloudwatch-query.sh"

# Source the shared daemon state library
# shellcheck source=scripts/lib/daemon-state.sh
source "scripts/lib/daemon-state.sh"

PID_FILE="$LOG_DIR/.bug-monitor.pid"
COOLDOWN_FILE="$LOG_DIR/.cooldown_cache"
LAST_POLL_FILE="$LOG_DIR/.last_poll_time"

# Check for existing running instance
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Error: bug-monitor already running (PID $(cat "$PID_FILE"))" >&2
  exit 1
fi

# Write our PID
echo $$ > "$PID_FILE"

# Initialize cooldown cache if missing
touch "$COOLDOWN_FILE"

cleanup() {
  log "Shutting down..."
  cleanup_cycle_dedup 2>/dev/null || true
  rm -f "$PID_FILE"
  exit 0
}
trap cleanup SIGINT SIGTERM

log() {
  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[bug-monitor ${timestamp}] $*" >&2
  echo "[bug-monitor ${timestamp}] $*" >> "$LOG_DIR/daemon.log" 2>/dev/null || true
}

# --- Self-error recording -----------------------------------------------------
# Appends a JSON line to the health file. Must never fail (|| true wraps the write).
record_self_error() {
  local category="$1"
  local message="$2"
  local health_file="$LOG_DIR/.self-health.jsonl"
  local timestamp
  timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date '+%Y-%m-%dT%H:%M:%SZ')
  printf '{"category":"%s","message":"%s","timestamp":"%s"}\n' \
    "$category" \
    "$(echo "$message" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n' | head -c 500)" \
    "$timestamp" >> "$health_file" 2>/dev/null || true
}

# Category labels for issue titles
category_label() {
  case "$1" in
    github_api) echo "GitHub API failures" ;;
    db_connection) echo "DB connection failures" ;;
    cloudwatch_query) echo "CloudWatch query failures" ;;
    *) echo "$1" ;;
  esac
}

# Flush self-errors: group by category, create/comment GitHub issues, truncate health file.
# Called at end of each poll cycle. Circuit breaker: flush failures don't recurse.
flush_self_errors() {
  local health_file="$LOG_DIR/.self-health.jsonl"

  if [ ! -f "$health_file" ] || [ ! -s "$health_file" ]; then
    return 0
  fi

  local flush_tmp
  flush_tmp=$(mktemp -d)
  local flush_failed=false
  local self_issues_created=0

  # Group entries by category using temp directory (Bash 3 compatible — no associative arrays)
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local category
    category=$(echo "$line" | sed -n 's/.*"category":"\([^"]*\)".*/\1/p')
    [ -z "$category" ] && continue

    mkdir -p "$flush_tmp/$category"

    local msg
    msg=$(echo "$line" | sed -n 's/.*"message":"\(.*\)","timestamp".*/\1/p')
    local ts
    ts=$(echo "$line" | sed -n 's/.*"timestamp":"\([^"]*\)".*/\1/p')

    # Increment count
    local prev_count=0
    if [ -f "$flush_tmp/$category/count" ]; then
      prev_count=$(< "$flush_tmp/$category/count")
    fi
    echo $((prev_count + 1)) > "$flush_tmp/$category/count"

    # Track first/last timestamp
    if [ ! -f "$flush_tmp/$category/first_ts" ]; then
      echo "$ts" > "$flush_tmp/$category/first_ts"
    fi
    echo "$ts" > "$flush_tmp/$category/last_ts"

    # Store unique messages (max 10)
    local msg_count=0
    if [ -f "$flush_tmp/$category/messages" ]; then
      msg_count=$(wc -l < "$flush_tmp/$category/messages" | tr -d ' ')
    fi
    if [ "$msg_count" -lt 10 ] && ! grep -qF "$msg" "$flush_tmp/$category/messages" 2>/dev/null; then
      echo "$msg" >> "$flush_tmp/$category/messages"
    fi
  done < "$health_file"

  # Process each category
  for cat_dir in "$flush_tmp"/*/; do
    [ -d "$cat_dir" ] || continue

    if [ "$self_issues_created" -ge "$MAX_SELF_ISSUES_PER_CYCLE" ]; then
      log "Max self-issues per cycle reached ($MAX_SELF_ISSUES_PER_CYCLE), deferring remaining"
      break
    fi

    local category err_count first_ts last_ts label
    category=$(basename "$cat_dir")
    err_count=$(< "$cat_dir/count")
    first_ts=$(< "$cat_dir/first_ts")
    last_ts=$(< "$cat_dir/last_ts")
    label=$(category_label "$category")

    local fingerprint
    fingerprint=$(generate_fingerprint "SELF" "$category")

    # Check cooldown
    if is_in_cooldown "$fingerprint"; then
      log "Self-error category '$category' in cooldown, skipping"
      continue
    fi

    if [ "$DRY_RUN" = true ]; then
      log "[DRY RUN] Would create/comment self-health issue: Bug Monitor Health: ${label} (${err_count} errors, ${first_ts} - ${last_ts})"
      set_cooldown "$fingerprint"
      self_issues_created=$((self_issues_created + 1))
      continue
    fi

    # Build messages list for issue body
    local messages_body=""
    if [ -f "$cat_dir/messages" ]; then
      messages_body=$(while IFS= read -r m; do echo "- \`${m}\`"; done < "$cat_dir/messages")
    fi

    # Check for existing open issue
    local existing_url
    existing_url=$(gh issue list \
      --state open \
      --label "$LABEL_BUG_MONITOR_HEALTH" \
      --search "${fingerprint:0:12}" \
      --json number,url \
      -q '.[0].url' 2>/dev/null || echo "")

    if [ -n "$existing_url" ]; then
      local issue_number
      issue_number=$(echo "$existing_url" | grep -oE '[0-9]+$')
      if ! gh issue comment "$issue_number" --body "$(printf '**New self-errors detected:** +%s\n**Time range:** %s — %s\n\n_Automated by bug-monitor daemon_' "$err_count" "$first_ts" "$last_ts")" 2>/dev/null; then
        log "Warning: failed to comment on self-health issue #${issue_number}"
        flush_failed=true
        break
      fi
    else
      local title="Bug Monitor Health: ${label}"
      local body
      body=$(printf "**Fingerprint:** \`%s\`\n\n## Category\n%s\n\n## Errors (%s total)\n%s\n\n## Time Range\n- **First:** %s\n- **Last:** %s\n\n---\n_Filed automatically by bug-monitor daemon_" \
        "${fingerprint:0:12}" "$label" "$err_count" "$messages_body" "$first_ts" "$last_ts")

      if ! gh issue create \
        --title "$title" \
        --label "$LABEL_BUG_MONITOR_HEALTH" \
        --body "$body" 2>/dev/null; then
        log "Warning: failed to create self-health issue for ${label}"
        flush_failed=true
        break
      fi
      log "Created self-health issue: ${title}"
    fi

    set_cooldown "$fingerprint"
    self_issues_created=$((self_issues_created + 1))
  done

  rm -rf "$flush_tmp"

  # Only truncate health file on success
  if [ "$flush_failed" = false ]; then
    : > "$health_file"
  else
    log "Warning: self-error flush had failures, preserving health file for next cycle"
  fi
}

# --- Helpers ------------------------------------------------------------------

# Convert epoch milliseconds to human-readable timestamp (cross-platform)
ms_to_human() {
  local ms="$1"
  local s=$(( ms / 1000 ))
  date -d "@${s}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || \
    date -r "${s}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || \
    echo "$ms"
}

# Matches the API algorithm: sha256(source + ':' + normalizeMessage(message))
generate_fingerprint() {
  local source="$1"
  local message="$2"
  local normalized
  normalized=$(normalize_message "$message")
  echo -n "${source}:${normalized}" | sha256sum | awk '{print $1}'
}

# --- Cooldown check -----------------------------------------------------------
# Returns 0 (true) if fingerprint is in cooldown, 1 (false) otherwise
is_in_cooldown() {
  local fingerprint="$1"
  local now
  now=$(date +%s)

  # Read cooldown file into memory, then rebuild it
  local cooldown_contents
  cooldown_contents=$(cat "$COOLDOWN_FILE" 2>/dev/null || true)

  local tmp
  tmp=$(mktemp)
  local found=false

  while IFS='|' read -r fp ts; do
    if [ -n "$fp" ] && [ $((now - ts)) -lt "$COOLDOWN_SECONDS" ]; then
      echo "${fp}|${ts}" >> "$tmp"
      if [ "$fp" = "$fingerprint" ]; then
        found=true
      fi
    fi
  done <<< "$cooldown_contents"

  mv "$tmp" "$COOLDOWN_FILE"

  if [ "$found" = true ]; then
    return 0  # in cooldown
  fi
  return 1  # not in cooldown
}

# Add a fingerprint to the cooldown cache
set_cooldown() {
  local fingerprint="$1"
  echo "${fingerprint}|$(date +%s)" >> "$COOLDOWN_FILE"
}

# --- Deduplication against GitHub issues --------------------------------------
# Returns the issue URL if a matching open issue exists, empty string otherwise
find_existing_issue() {
  local fingerprint="$1"
  local environment="${2:-}"
  local prefix="${fingerprint:0:12}"

  local labels="$LABEL_BUG"
  if [ -n "$environment" ] && [ "$environment" != "unknown" ]; then
    labels="${labels},env:${environment}"
  fi

  gh issue list \
    --state open \
    --label "$labels" \
    --search "$prefix" \
    --json number,url \
    -q '.[0].url' 2>/dev/null || echo ""
}

# Add an occurrence comment to an existing issue
comment_existing_issue() {
  local issue_url="$1"
  local count="$2"
  local last_seen="$3"
  local environment="${4:-}"

  local issue_number
  issue_number=$(echo "$issue_url" | grep -oE '[0-9]+$')

  if [ "$DRY_RUN" = true ]; then
    log "[DRY RUN] Would comment on issue #${issue_number}: +${count} occurrences"
    return
  fi

  local env_line=""
  if [ -n "$environment" ]; then
    env_line="
**Environment:** ${environment}"
  fi

  gh issue comment "$issue_number" --body "$(cat <<EOF
**New occurrences detected:** +${count}
**Last seen:** ${last_seen}${env_line}

_Automated by bug-monitor daemon_
EOF
)" 2>/dev/null || {
    log "Warning: failed to comment on issue #${issue_number}"
    record_self_error "github_api" "Failed to comment on issue #${issue_number}"
  }
}

# --- Issue creation -----------------------------------------------------------
create_bug_issue() {
  local error_message="$1"
  local source="$2"
  local stack_trace="$3"
  local url="$4"
  local count="$5"
  local first_seen="$6"
  local last_seen="$7"
  local fingerprint="$8"
  local metadata="${9:-}"
  local environment="${10:-}"

  # Validate fingerprint — if empty, generate a fallback from error_message + source
  if [ -z "$fingerprint" ]; then
    log "Warning: empty fingerprint received, generating fallback from message + source"
    fingerprint=$(generate_fingerprint "$source" "$error_message")
  fi

  local summary
  summary=$(extract_error_summary "$error_message")
  local title
  if [ -n "$environment" ]; then
    title="Bug [${environment}]: ${summary}"
  else
    title="Bug: ${summary}"
  fi

  # Extract suggested files from stack trace
  local suggested_files=""
  if [ -n "$stack_trace" ]; then
    suggested_files=$(extract_suggested_files "$stack_trace")
  fi

  # Build the issue body
  local body
  body=$(cat <<EOF
**Fingerprint:** \`${fingerprint:0:12}\`

## Error
\`\`\`
${error_message}
\`\`\`

## Source
\`${source}\`

$(if [ -n "$environment" ]; then
  echo "## Environment"
  echo "\`${environment}\`"
fi)
$(if [ -n "$stack_trace" ]; then
  echo "## Stack Trace"
  echo "\`\`\`"
  echo "$stack_trace"
  echo "\`\`\`"
fi)

## URL/Route
\`${url:-Unknown}\`

## Frequency
- **Count:** ${count}
- **First seen:** ${first_seen}
- **Last seen:** ${last_seen}

$(if [ -n "$suggested_files" ]; then
  echo "## Suggested Files"
  echo "$suggested_files" | while read -r f; do echo "- \`$f\`"; done
fi)

$(if [ -n "$metadata" ]; then
  echo "## Reproduction Context"
  echo "\`\`\`json"
  echo "$metadata"
  echo "\`\`\`"
fi)

---
_Filed automatically by bug-monitor daemon_
EOF
)

  local labels="${LABEL_BUG},${LABEL_TRIAGE}"
  if [ -n "$environment" ] && [ "$environment" != "unknown" ]; then
    labels="${labels},env:${environment}"
  fi

  if [ "$DRY_RUN" = true ]; then
    log "[DRY RUN] Would create issue: ${title}"
    log "[DRY RUN] Labels: ${labels}"
    return
  fi

  local issue_url
  issue_url=$(gh issue create \
    --title "$title" \
    --label "$labels" \
    --body "$body" 2>/dev/null || echo "")

  if [ -n "$issue_url" ]; then
    local issue_number
    issue_number=$(echo "$issue_url" | grep -oE '[0-9]+$')
    log "Created issue #${issue_number}: ${title}"
    echo "$issue_number"
  else
    log "Error: failed to create issue for: ${title}"
    record_self_error "github_api" "Failed to create issue: ${title}"
    echo ""
  fi
}

# --- Cycle-level batch dedup --------------------------------------------------
# Tracks which fingerprints have been processed in the current poll cycle.
# Prevents duplicate issues when GitHub search is eventually consistent.
CYCLE_DEDUP_FILE=""

init_cycle_dedup() {
  CYCLE_DEDUP_FILE=$(mktemp)
}

cleanup_cycle_dedup() {
  [ -n "$CYCLE_DEDUP_FILE" ] && rm -f "$CYCLE_DEDUP_FILE"
  CYCLE_DEDUP_FILE=""
}

is_seen_this_cycle() {
  local fp="$1"
  [ -n "$CYCLE_DEDUP_FILE" ] && grep -qF "$fp" "$CYCLE_DEDUP_FILE" 2>/dev/null
}

mark_seen_this_cycle() {
  local fp="$1"
  [ -n "$CYCLE_DEDUP_FILE" ] && echo "$fp" >> "$CYCLE_DEDUP_FILE"
}

# --- Process a single error (shared by both poll sources) ---------------------
# Checks cooldown, count threshold, deduplication, then creates/comments.
# Echoes issue number if an issue was created, "0" otherwise.
# $10 = source_type: "CLOUDWATCH" applies count threshold + file cooldown,
#                    "DB" skips both (uses acknowledgedAt instead).
# $11 = existing_issue_number: for DB re-triaged errors with known GitHub issue.
process_error() {
  local fp="$1"
  local msg="$2"
  local err_count="$3"
  local source="$4"
  local stack="${5:-}"
  local url="${6:-}"
  local first_seen="$7"
  local last_seen="$8"
  local metadata="${9:-}"
  local source_type="${10:-CLOUDWATCH}"
  local existing_issue_number="${11:-}"
  local environment="${12:-}"

  # Validate fingerprint early — empty fp would cause grep -qF "" to match
  # everything, silently deduping all subsequent errors in the cycle.
  if [ -z "$fp" ]; then
    log "Warning: empty fingerprint in process_error, generating fallback"
    fp=$(generate_fingerprint "$source" "$msg")
  fi

  # Environment-scoped cooldown key
  local cooldown_key="$fp"
  if [ -n "$environment" ]; then
    cooldown_key="${environment}:${fp}"
  fi

  # CloudWatch: check file-based cooldown and count threshold
  if [ "$source_type" = "CLOUDWATCH" ]; then
    if is_in_cooldown "$cooldown_key"; then
      echo "0"
      return
    fi

    # Check if FATAL (always file regardless of count)
    local is_fatal=false
    if echo "$msg" | grep -qE 'FATAL'; then
      is_fatal=true
    fi

    # Skip low-count non-fatal errors
    if [ "$err_count" -lt "$MIN_COUNT_THRESHOLD" ] && [ "$is_fatal" = false ]; then
      log "Skipping low-count error (${err_count}x): $(echo "$msg" | head -c 80)"
      set_cooldown "$cooldown_key"
      echo "0"
      return
    fi
  fi

  # For DB re-triaged errors with a known GitHub issue, check if it's still open
  if [ -n "$existing_issue_number" ]; then
    if ! [[ "$existing_issue_number" =~ ^[0-9]+$ ]]; then
      log "Error: invalid existing issue number '${existing_issue_number}', skipping"
      record_self_error "github_api" "Invalid existing issue number: ${existing_issue_number}"
      echo "0"
      return
    fi

    local issue_state
    issue_state=$(gh issue view "$existing_issue_number" --json state -q '.state' 2>/dev/null || echo "UNKNOWN")

    if [ "$issue_state" = "OPEN" ]; then
      # Issue is still open — comment on it
      local issue_url
      issue_url="https://github.com/$(gh repo view --json nameWithOwner -q '.nameWithOwner')/issues/${existing_issue_number}"
      comment_existing_issue "$issue_url" "$err_count" "$last_seen" "$environment"
      [ "$source_type" = "CLOUDWATCH" ] && set_cooldown "$cooldown_key"
      echo "0"
      return
    fi
    # Issue is closed — create a new one (fix didn't work)
    log "Linked issue #${existing_issue_number} is closed, creating new issue for recurrence"
  fi

  # Within-cycle batch dedup: skip if this fingerprint was already processed
  # in the current poll cycle. GitHub search is eventually consistent, so an
  # issue created seconds ago may not appear in search results yet.
  if is_seen_this_cycle "$fp"; then
    log "Skipping duplicate fingerprint within cycle: ${fp:0:12}"
    [ "$source_type" = "CLOUDWATCH" ] && set_cooldown "$cooldown_key"
    echo "0"
    return
  fi

  # Check for existing open issue by fingerprint search
  local existing_url
  existing_url=$(find_existing_issue "$fp" "$environment")

  if [ -n "$existing_url" ]; then
    comment_existing_issue "$existing_url" "$err_count" "$last_seen" "$environment"
    [ "$source_type" = "CLOUDWATCH" ] && set_cooldown "$cooldown_key"
    mark_seen_this_cycle "$fp"
    echo "0"
    return
  fi

  # Create new issue
  local issue_number
  issue_number=$(create_bug_issue \
    "$msg" "$source" "$stack" "$url" \
    "$err_count" "$first_seen" "$last_seen" "$fp" "$metadata" "$environment")

  [ "$source_type" = "CLOUDWATCH" ] && set_cooldown "$cooldown_key"
  mark_seen_this_cycle "$fp"

  if [ -n "$issue_number" ]; then
    echo "$issue_number"
  else
    echo "0"
  fi
}

# --- Poll CloudWatch Logs ----------------------------------------------------
poll_cloudwatch() {
  local since_ms="$1"
  local issues_created="$2"

  if [ "$issues_created" -ge "$MAX_ISSUES_PER_CYCLE" ]; then
    log "Max issues per cycle reached, skipping CloudWatch poll"
    echo "$issues_created"
    return
  fi

  # Discover or use specified log groups
  local groups=()
  if [ ${#LOG_GROUPS[@]} -gt 0 ]; then
    groups=("${LOG_GROUPS[@]}")
  else
    while IFS= read -r group; do
      [ -n "$group" ] && groups+=("$group")
    done < <(cloudwatch_discover_log_groups)
  fi

  if [ ${#groups[@]} -eq 0 ]; then
    log "No CloudWatch log groups found"
    echo "$issues_created"
    return
  fi

  log "Polling ${#groups[@]} CloudWatch log group(s)..."

  # Collect all errors, group by fingerprint (temp directory for Bash 3 compat)
  local cw_tmp
  cw_tmp=$(mktemp -d)

  for group in "${groups[@]}"; do
    while IFS= read -r event_json; do
      [ -z "$event_json" ] && continue

      local msg ts
      msg=$(echo "$event_json" | jq -r '.message // ""' 2>/dev/null)
      ts=$(echo "$event_json" | jq -r '.timestamp // 0' 2>/dev/null)

      [ -z "$msg" ] && continue

      local fp stage agg_key
      fp=$(generate_fingerprint "SERVER" "$msg")
      stage=$(cloudwatch_extract_stage "$group")
      # Aggregate by fingerprint + stage so the same error in different
      # environments produces separate issues.
      agg_key="${fp}_${stage}"

      if [ ! -d "$cw_tmp/$agg_key" ]; then
        mkdir -p "$cw_tmp/$agg_key"
        printf '%s' "$msg" > "$cw_tmp/$agg_key/message"
        echo "1" > "$cw_tmp/$agg_key/count"
        echo "$ts" > "$cw_tmp/$agg_key/first_seen"
        echo "$ts" > "$cw_tmp/$agg_key/last_seen"
        echo "$group" > "$cw_tmp/$agg_key/log_group"
        echo "$fp" > "$cw_tmp/$agg_key/fingerprint"
        echo "$stage" > "$cw_tmp/$agg_key/stage"
      else
        local prev_count
        prev_count=$(cat "$cw_tmp/$agg_key/count")
        echo $((prev_count + 1)) > "$cw_tmp/$agg_key/count"
        if [ "$ts" -gt "$(cat "$cw_tmp/$agg_key/last_seen")" ] 2>/dev/null; then
          echo "$ts" > "$cw_tmp/$agg_key/last_seen"
        fi
      fi
    done < <(cloudwatch_query_errors "$since_ms" "$group" "$SEVERITY")
  done

  # Process collected errors
  local count="$issues_created"
  for agg_dir in "$cw_tmp"/*/; do
    [ -d "$agg_dir" ] || continue

    if [ "$count" -ge "$MAX_ISSUES_PER_CYCLE" ]; then
      log "Max issues per cycle reached, stopping"
      break
    fi

    local fp stage
    fp=$(cat "$agg_dir/fingerprint")
    stage=$(cat "$agg_dir/stage" 2>/dev/null || echo "")

    local result
    result=$(process_error \
      "$fp" \
      "$(cat "$agg_dir/message")" \
      "$(cat "$agg_dir/count")" \
      "SERVER" \
      "" \
      "$(cat "$agg_dir/log_group")" \
      "$(ms_to_human "$(cat "$agg_dir/first_seen")")" \
      "$(ms_to_human "$(cat "$agg_dir/last_seen")")" \
      "" \
      "CLOUDWATCH" \
      "" \
      "$stage")

    if [ "$result" != "0" ]; then
      count=$((count + 1))
    fi
  done

  rm -rf "$cw_tmp"

  echo "$count"
}

# --- Poll ErrorReport table ---------------------------------------------------
poll_error_reports() {
  local issues_created="$1"
  local db_url="${2:-${DATABASE_URL:-}}"
  local environment="${3:-}"

  if [ "$issues_created" -ge "$MAX_ISSUES_PER_CYCLE" ]; then
    log "Max issues per cycle reached, skipping DB poll"
    echo "$issues_created"
    return
  fi

  if [ -z "$db_url" ]; then
    if [ -n "$environment" ]; then
      log "Warning: DATABASE_URL_${environment^^} not set, skipping ErrorReport poll (${environment})"
      record_self_error "db_connection" "DATABASE_URL_${environment^^} not set"
    else
      log "Warning: DATABASE_URL not set, skipping ErrorReport poll"
      record_self_error "db_connection" "DATABASE_URL not set"
    fi
    echo "$issues_created"
    return
  fi

  local env_label=""
  if [ -n "$environment" ]; then
    env_label=" (${environment})"
  fi
  log "Polling ErrorReport table${env_label} for NEW and re-triage errors..."

  local query="SELECT json_agg(row_to_json(t)) FROM (
    SELECT fingerprint, message, stack, source, url, metadata::text, count,
           \"firstSeenAt\"::text as first_seen, \"lastSeenAt\"::text as last_seen,
           status, \"githubIssueNumber\" as github_issue_number
    FROM \"ErrorReport\"
    WHERE status = 'NEW'
       OR (status = 'ISSUE_CREATED'
           AND \"acknowledgedAt\" IS NOT NULL
           AND \"lastSeenAt\" > \"acknowledgedAt\"
           AND \"acknowledgedAt\" < NOW() - INTERVAL '24 hours')
    ORDER BY count DESC, \"lastSeenAt\" DESC
    LIMIT 20
  ) t;"

  local result
  result=$(psql "$db_url" -t -A -c "$query" 2>>"$LOG_DIR/daemon.log" || echo "null")

  if [ "$result" = "null" ] || [ -z "$result" ]; then
    log "No actionable error reports found"
    echo "$issues_created"
    return
  fi

  local count="$issues_created"

  # Process each error report (use process substitution to avoid subshell)
  while IFS= read -r row; do
    if [ "$count" -ge "$MAX_ISSUES_PER_CYCLE" ]; then
      log "Max issues per cycle reached, stopping"
      break
    fi

    local fp msg stack err_source url metadata err_count first_seen last_seen
    local row_status existing_issue_num
    fp=$(echo "$row" | jq -r '.fingerprint')
    msg=$(echo "$row" | jq -r '.message')
    stack=$(echo "$row" | jq -r '.stack // ""')
    err_source=$(echo "$row" | jq -r '.source')
    url=$(echo "$row" | jq -r '.url // ""')
    metadata=$(echo "$row" | jq -r '.metadata // ""')
    err_count=$(echo "$row" | jq -r '.count')
    first_seen=$(echo "$row" | jq -r '.first_seen')
    last_seen=$(echo "$row" | jq -r '.last_seen')
    row_status=$(echo "$row" | jq -r '.status')
    existing_issue_num=$(echo "$row" | jq -r '.github_issue_number // ""')

    local issue_number
    issue_number=$(process_error \
      "$fp" "$msg" "$err_count" "$err_source" \
      "$stack" "$url" "$first_seen" "$last_seen" "$metadata" \
      "DB" "$existing_issue_num" "$environment")

    if [ "$issue_number" != "0" ] && [ -n "$issue_number" ]; then
      # Validate inputs before SQL interpolation (prevent injection)
      if ! [[ "$issue_number" =~ ^[0-9]+$ ]]; then
        log "Error: invalid issue_number '${issue_number}', skipping DB update"
        record_self_error "db_connection" "Invalid issue_number from DB: ${issue_number}"
        continue
      fi
      if ! [[ "$fp" =~ ^[0-9a-f]{64}$ ]]; then
        log "Error: invalid fingerprint '${fp}', skipping DB update"
        record_self_error "db_connection" "Invalid fingerprint: ${fp}"
        continue
      fi

      # Update ErrorReport status and set acknowledgedAt
      if [ "$DRY_RUN" = false ]; then
        psql "$db_url" -c \
          "UPDATE \"ErrorReport\" SET status = 'ISSUE_CREATED', \"githubIssueNumber\" = ${issue_number}, \"acknowledgedAt\" = NOW() WHERE fingerprint = '${fp}';" \
          2>>"$LOG_DIR/daemon.log" || {
            log "Warning: failed to update ErrorReport for fingerprint ${fp}"
            record_self_error "db_connection" "Failed to update ErrorReport for fingerprint ${fp}"
          }
      else
        log "[DRY RUN] Would update ErrorReport status to ISSUE_CREATED for fingerprint ${fp}"
      fi

      count=$((count + 1))
    else
      # For re-triaged errors that were commented on (not new issue), still update acknowledgedAt
      if [ "$row_status" = "ISSUE_CREATED" ]; then
        if ! [[ "$fp" =~ ^[0-9a-f]{64}$ ]]; then
          log "Error: invalid fingerprint '${fp}', skipping acknowledgedAt update"
          record_self_error "db_connection" "Invalid fingerprint: ${fp}"
          continue
        fi

        if [ "$DRY_RUN" = false ]; then
          psql "$db_url" -c \
            "UPDATE \"ErrorReport\" SET \"acknowledgedAt\" = NOW() WHERE fingerprint = '${fp}';" \
            2>>"$LOG_DIR/daemon.log" || {
              log "Warning: failed to update acknowledgedAt for fingerprint ${fp}"
              record_self_error "db_connection" "Failed to update acknowledgedAt for fingerprint ${fp}"
            }
        else
          log "[DRY RUN] Would update acknowledgedAt for fingerprint ${fp}"
        fi
      fi
    fi
  done < <(echo "$result" | jq -c '.[]' 2>/dev/null)

  echo "$count"
}

# --- Get last poll time -------------------------------------------------------
get_last_poll_ms() {
  if [ -f "$LAST_POLL_FILE" ]; then
    cat "$LAST_POLL_FILE"
  else
    # Default: look back 1 hour on first run
    echo $(( $(date +%s) * 1000 - 3600000 ))
  fi
}

save_poll_time() {
  echo "$(( $(date +%s) * 1000 ))" > "$LAST_POLL_FILE"
}

# --- Main loop ----------------------------------------------------------------
log "Started (interval=${POLL_INTERVAL}s, severity=${SEVERITY}, dry_run=${DRY_RUN})"
if [ ${#LOG_GROUPS[@]} -gt 0 ]; then
  log "Monitoring specific log groups: ${LOG_GROUPS[*]}"
else
  log "Will auto-discover CloudWatch log groups"
fi

while true; do
  local_issues_created=0
  since_ms=$(get_last_poll_ms)
  init_cycle_dedup

  log "--- Poll cycle start (since=$(ms_to_human "$since_ms")) ---"

  if is_rate_limit_paused; then
    log "Note: issue-daemon is rate-limit paused, new issues will queue"
  fi

  # Poll CloudWatch
  local_issues_created=$(poll_cloudwatch "$since_ms" "$local_issues_created")

  # Poll ErrorReport table (multi-environment or single-env fallback)
  if [ -n "${DATABASE_URL_STAGING:-}" ]; then
    local_issues_created=$(poll_error_reports "$local_issues_created" "$DATABASE_URL_STAGING" "staging")
  fi
  if [ -n "${DATABASE_URL_PRODUCTION:-}" ]; then
    local_issues_created=$(poll_error_reports "$local_issues_created" "$DATABASE_URL_PRODUCTION" "production")
  fi
  if [ -z "${DATABASE_URL_STAGING:-}" ] && [ -z "${DATABASE_URL_PRODUCTION:-}" ]; then
    local_issues_created=$(poll_error_reports "$local_issues_created")
  fi

  # Clean up cycle-level dedup tracking
  cleanup_cycle_dedup

  # Flush self-errors before advancing the poll timestamp, so errors from
  # this cycle are reported even if flush partially fails and preserves the file.
  flush_self_errors

  # Save current time for next poll
  save_poll_time

  if [ "$local_issues_created" -gt 0 ]; then
    log "Created ${local_issues_created} issue(s) this cycle"
  else
    log "No new issues this cycle"
  fi

  log "Next poll in ${POLL_INTERVAL}s..."
  sleep "$POLL_INTERVAL"
done
