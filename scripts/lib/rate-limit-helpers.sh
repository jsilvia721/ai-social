#!/usr/bin/env bash
# rate-limit-helpers.sh — Extracted rate limit helper functions for sourcing.
# These are used by issue-daemon.sh and can be sourced independently for testing.
#
# Required variables (must be set before sourcing):
#   LOG_DIR — directory for log files
#   RATE_LIMIT_PAUSE_SECONDS — default pause duration in seconds
#   CIRCUIT_BREAKER_FILE — path to failure timestamps file
#   CIRCUIT_BREAKER_WINDOW — seconds to look back for failures
#   CIRCUIT_BREAKER_THRESHOLD — number of failures to trigger breaker

set -euo pipefail

# --- Rate limit detection -----------------------------------------------------
# Returns 0 if rate limited, 1 if not.
# Arguments: $1=exit_code, $2=log_file
detect_rate_limit() {
  local exit_code="$1"
  local log_file="$2"

  # Successful exit is not a rate limit
  if [ "$exit_code" -eq 0 ]; then
    return 1
  fi

  # Check log file for rate limit indicators
  if grep -qiE 'rate.?limit|HTTP.?429|status.?429|quota|budget.*exceeded|overloaded|hit.*limit|you.*limit' "$log_file" 2>/dev/null; then
    return 0
  fi

  return 1
}

# --- Reset time parser --------------------------------------------------------
# Parses Anthropic usage limit reset time from log files.
# Error format: "You've hit your limit · resets 8pm (America/New_York)"
# Returns: seconds until reset time, or 0 if parsing fails.
# Arguments: $1=log_file
parse_reset_time() {
  local log_file="$1"

  # Extract reset time line: e.g., "resets 8pm (America/New_York)"
  local reset_line
  reset_line=$(grep -oiE 'resets\s+[0-9]{1,2}(:[0-9]{2})?\s*(am|pm)\s*\(([^)]+)\)' "$log_file" 2>/dev/null | head -1 || echo "")

  if [ -z "$reset_line" ]; then
    echo "0"
    return
  fi

  # Parse components: time (e.g., "8pm" or "8:30pm") and timezone (e.g., "America/New_York")
  local time_part tz_part
  time_part=$(echo "$reset_line" | sed -E 's/[Rr][Ee][Ss][Ee][Tt][Ss][[:space:]]+([0-9]{1,2}(:[0-9]{2})?[[:space:]]*[aApP][mM]).*/\1/' | tr -d ' ')
  tz_part=$(echo "$reset_line" | sed -E 's/.*\(([^)]+)\)/\1/')

  if [ -z "$time_part" ] || [ -z "$tz_part" ]; then
    echo "0"
    return
  fi

  # Normalize time_part: "8pm" -> "8:00 PM", "8:30pm" -> "8:30 PM"
  local hour minute ampm
  if echo "$time_part" | grep -qE ':'; then
    hour=$(echo "$time_part" | sed -E 's/^([0-9]{1,2}):.*/\1/')
    minute=$(echo "$time_part" | sed -E 's/^[0-9]{1,2}:([0-9]{2}).*/\1/')
    ampm=$(echo "$time_part" | sed -E 's/.*([aApP][mM])/\1/' | tr '[:lower:]' '[:upper:]')
  else
    hour=$(echo "$time_part" | sed -E 's/^([0-9]{1,2}).*/\1/')
    minute="00"
    ampm=$(echo "$time_part" | sed -E 's/[0-9]+([aApP][mM])/\1/' | tr '[:lower:]' '[:upper:]')
  fi

  # Convert to 24-hour format
  local hour24
  if [ "$ampm" = "AM" ]; then
    if [ "$hour" -eq 12 ]; then
      hour24=0
    else
      hour24=$hour
    fi
  else
    if [ "$hour" -eq 12 ]; then
      hour24=12
    else
      hour24=$(( hour + 12 ))
    fi
  fi

  # Get today's date in the target timezone and construct the target epoch
  local target_epoch
  # Try GNU date first (Linux), then macOS/python3 fallback
  target_epoch=$(TZ="$tz_part" date -d "today ${hour24}:${minute}:00" +%s 2>/dev/null) || \
    target_epoch=$(python3 -c "
import datetime, zoneinfo, sys
try:
    tz = zoneinfo.ZoneInfo('$tz_part')
    now = datetime.datetime.now(tz)
    target = now.replace(hour=$hour24, minute=int('$minute'), second=0, microsecond=0)
    if target <= now:
        target += datetime.timedelta(days=1)
    print(int(target.timestamp()))
except Exception:
    print(0)
" 2>/dev/null) || {
    echo "0"
    return
  }

  if [ -z "$target_epoch" ] || [ "$target_epoch" = "0" ]; then
    echo "0"
    return
  fi

  local now_epoch
  now_epoch=$(date +%s)

  # If target is in the past, it means tomorrow
  if [ "$target_epoch" -le "$now_epoch" ]; then
    target_epoch=$(( target_epoch + 86400 ))
  fi

  local seconds_until=$(( target_epoch - now_epoch ))

  # Sanity check: if more than 24 hours away, something is wrong
  if [ "$seconds_until" -gt 86400 ]; then
    echo "0"
    return
  fi

  echo "$seconds_until"
}

# Format a reset time for display in issue comments.
# Arguments: $1=log_file
# Outputs: formatted time string like "8:00 PM ET" or empty if unparseable
format_reset_display() {
  local log_file="$1"

  local reset_line
  reset_line=$(grep -oiE 'resets\s+[0-9]{1,2}(:[0-9]{2})?\s*(am|pm)\s*\(([^)]+)\)' "$log_file" 2>/dev/null | head -1 || echo "")

  if [ -z "$reset_line" ]; then
    echo ""
    return
  fi

  # Extract the time and timezone for display
  local time_part tz_part
  time_part=$(echo "$reset_line" | sed -E 's/[Rr][Ee][Ss][Ee][Tt][Ss][[:space:]]+([0-9]{1,2}(:[0-9]{2})?[[:space:]]*[aApP][mM]).*/\1/' | tr -d ' ')
  tz_part=$(echo "$reset_line" | sed -E 's/.*\(([^)]+)\)/\1/')

  # Format nicely: "8pm" -> "8:00 PM", "8:30pm" -> "8:30 PM"
  local hour minute ampm
  if echo "$time_part" | grep -qE ':'; then
    hour=$(echo "$time_part" | sed -E 's/^([0-9]{1,2}):.*/\1/')
    minute=$(echo "$time_part" | sed -E 's/^[0-9]{1,2}:([0-9]{2}).*/\1/')
    ampm=$(echo "$time_part" | sed -E 's/.*([aApP][mM])/\1/' | tr '[:lower:]' '[:upper:]')
  else
    hour=$(echo "$time_part" | sed -E 's/^([0-9]{1,2}).*/\1/')
    minute="00"
    ampm=$(echo "$time_part" | sed -E 's/[0-9]+([aApP][mM])/\1/' | tr '[:lower:]' '[:upper:]')
  fi

  # Map timezone to abbreviation for display
  local tz_abbrev
  case "$tz_part" in
    America/New_York)  tz_abbrev="ET" ;;
    America/Chicago)   tz_abbrev="CT" ;;
    America/Denver)    tz_abbrev="MT" ;;
    America/Los_Angeles) tz_abbrev="PT" ;;
    *)                 tz_abbrev="$tz_part" ;;
  esac

  echo "${hour}:${minute} ${ampm} ${tz_abbrev}"
}

# --- Circuit breaker ----------------------------------------------------------
# Tracks rapid consecutive failures. If 3+ non-rate-limit failures occur within
# 60 seconds, triggers a rate limit pause as a safety net.

# Record a failure timestamp for circuit breaker tracking.
record_failure() {
  echo "$(date +%s)" >> "$CIRCUIT_BREAKER_FILE"
}

# Check if circuit breaker should trip. Returns 0 if tripped, 1 if not.
# Also cleans entries older than the window.
check_circuit_breaker() {
  [ -f "$CIRCUIT_BREAKER_FILE" ] || return 1

  local now
  now=$(date +%s)
  local cutoff=$(( now - CIRCUIT_BREAKER_WINDOW ))
  local tmp
  tmp=$(mktemp)
  local count=0

  while IFS= read -r ts; do
    [ -n "$ts" ] || continue
    if [ "$ts" -ge "$cutoff" ] 2>/dev/null; then
      echo "$ts" >> "$tmp"
      count=$(( count + 1 ))
    fi
  done < "$CIRCUIT_BREAKER_FILE"

  mv "$tmp" "$CIRCUIT_BREAKER_FILE"

  if [ "$count" -ge "$CIRCUIT_BREAKER_THRESHOLD" ]; then
    return 0
  fi
  return 1
}
