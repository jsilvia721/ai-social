#!/usr/bin/env bash
# cloudwatch-query.sh — Query CloudWatch Logs for error-level events from
# SST-created Lambda log groups.
#
# Usage:
#   source scripts/lib/cloudwatch-query.sh
#   cloudwatch_discover_log_groups         # list SST Lambda log groups
#   cloudwatch_query_errors <since_ms> <log_group> [severity]
#
# Output: one JSON object per error line to stdout:
#   { "timestamp": <epoch_ms>, "message": "...", "logGroup": "...", "logStream": "..." }
#
# Requirements: aws CLI, jq

set -euo pipefail

# Discover SST-created Lambda log groups
# Outputs one log group name per line
cloudwatch_discover_log_groups() {
  aws logs describe-log-groups \
    --log-group-name-prefix "/aws/lambda" \
    --query 'logGroups[].logGroupName' \
    --output json 2>/dev/null \
  | jq -r '.[]' 2>/dev/null || true
}

# Query a single log group for error events since a given timestamp.
#
# Arguments:
#   $1 — start time in epoch milliseconds
#   $2 — log group name
#   $3 — severity level: "error" (default) or "warn"
#
# Outputs one JSON object per matching event to stdout.
cloudwatch_query_errors() {
  local since_ms="$1"
  local log_group="$2"
  local severity="${3:-error}"

  local filter_pattern
  if [ "$severity" = "warn" ]; then
    filter_pattern="?ERROR ?FATAL ?Unhandled ?TypeError ?ReferenceError ?BRIEF_FAILED ?PUBLISH_FAILED ?WARN ?WARNING"
  else
    filter_pattern="?ERROR ?FATAL ?Unhandled ?TypeError ?ReferenceError ?BRIEF_FAILED ?PUBLISH_FAILED"
  fi

  local raw_events
  raw_events=$(aws logs filter-log-events \
    --log-group-name "$log_group" \
    --start-time "$since_ms" \
    --filter-pattern "$filter_pattern" \
    --query 'events[].{timestamp: timestamp, message: message, logStream: logStreamName}' \
    --output json 2>/dev/null || echo "[]")

  # Add logGroup to each event and output as individual JSON objects
  echo "$raw_events" | jq -c --arg lg "$log_group" \
    '.[] | . + {logGroup: $lg}' 2>/dev/null || true
}

# Normalize a log message by replacing dynamic values with placeholders.
# Produces identical output to the TypeScript normalizeMessage() for the same input.
# Used before fingerprint hashing to ensure dedup across dynamic values.
#
# Rules (applied sequentially):
#   1. UUIDs → <UUID>
#   2. CUIDs/nanoids (25+ lowercase alphanum starting with letter) → <ID>
#   3. ISO timestamps → <TIMESTAMP>
#   4. Datetime strings (YYYY-MM-DD HH:MM:SS) → <TIMESTAMP>
#   5. Standalone numbers → <N>
#   6. Query strings → stripped
#   7. Collapse whitespace + trim
#
# Arguments:
#   $1 — raw message
normalize_message() {
  local msg="$1"
  msg=$(echo "$msg" \
    | sed -E 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<UUID>/g' \
    | sed -E 's/(^|[^a-zA-Z0-9])([a-z][a-z0-9]{24,})([^a-zA-Z0-9]|$)/\1<ID>\3/g' \
    | sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z?/<TIMESTAMP>/g' \
    | sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}/<TIMESTAMP>/g' \
    | sed -E 's/(^|[^a-zA-Z0-9_./:-])[0-9]+([^a-zA-Z0-9_./:-]|$)/\1<N>\2/g' \
    | sed -E 's/\?[^ ]*//g' \
    | sed -E 's/[[:space:]]+/ /g' \
    | sed -E 's/^ //;s/ $//')
  echo "$msg"
}

# Extract a concise error summary from a log message.
# Strips timestamps, request IDs, and truncates to ~120 chars.
#
# Arguments:
#   $1 — raw log message
extract_error_summary() {
  local msg="$1"
  # Strip common Lambda log prefixes (timestamp + request ID)
  local cleaned
  cleaned=$(echo "$msg" \
    | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.Z]+[[:space:]]*//' \
    | sed -E 's/^[0-9a-f-]{36}[[:space:]]*//' \
    | sed -E 's/^(ERROR|FATAL|WARN(ING)?)[[:space:]]*//' \
    | head -1)
  # Truncate to 120 chars
  echo "${cleaned:0:120}"
}

# Extract file paths relative to src/ from a stack trace.
#
# Arguments:
#   $1 — stack trace text
extract_suggested_files() {
  local stack="$1"
  echo "$stack" \
    | grep -oE 'src/[^ :)]+' 2>/dev/null \
    | sort -u \
    | head -10 || true
}
