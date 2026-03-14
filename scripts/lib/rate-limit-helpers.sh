#!/usr/bin/env bash
# rate-limit-helpers.sh — Extracted rate limit helper functions for sourcing.
# These are used by issue-daemon.sh and can be sourced independently for testing.
#
# Required variables (must be set before sourcing):
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
  if grep -qiE 'rate.?limit|HTTP.?429|status.?429|quota|budget.*exceeded|overloaded|hit your.*limit|you.ve.*limit' "$log_file" 2>/dev/null; then
    return 0
  fi

  return 1
}

# --- Reset time parser --------------------------------------------------------
# Parses Anthropic usage limit reset time from log files.
# Error format: "You've hit your limit · resets 8pm (America/New_York)"
#
# Outputs two lines:
#   Line 1: seconds until reset time (0 if parsing fails)
#   Line 2: display string like "8:00 PM ET" (empty if parsing fails)
#
# Arguments: $1=log_file
parse_reset_time() {
  local log_file="$1"

  # Extract reset time line: e.g., "resets 8pm (America/New_York)"
  local reset_line
  reset_line=$(grep -oiE 'resets[[:space:]]+[0-9]{1,2}(:[0-9]{2})?[[:space:]]*(am|pm)[[:space:]]*\(([^)]+)\)' "$log_file" 2>/dev/null | head -1 || echo "")

  if [ -z "$reset_line" ]; then
    echo "0"
    echo ""
    return
  fi

  # Parse time and timezone, compute seconds-until-reset, and format display
  # all in one python3 call to avoid duplicated bash parsing
  python3 -c "
import datetime, zoneinfo, re, sys
try:
    line = '''$reset_line'''
    m = re.search(r'resets\s+(\d{1,2}(?::\d{2})?)\s*(am|pm)\s*\(([^)]+)\)', line, re.IGNORECASE)
    if not m:
        print('0')
        print('')
        sys.exit(0)

    time_str, ampm, tz_name = m.group(1), m.group(2).upper(), m.group(3)

    # Parse hour and minute
    if ':' in time_str:
        hour, minute = int(time_str.split(':')[0]), int(time_str.split(':')[1])
    else:
        hour, minute = int(time_str), 0

    # Convert to 24-hour
    if ampm == 'AM' and hour == 12:
        hour24 = 0
    elif ampm == 'PM' and hour != 12:
        hour24 = hour + 12
    else:
        hour24 = hour

    tz = zoneinfo.ZoneInfo(tz_name)
    now = datetime.datetime.now(tz)
    target = now.replace(hour=hour24, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += datetime.timedelta(days=1)

    seconds = int(target.timestamp()) - int(now.timestamp())
    if seconds > 86400 or seconds <= 0:
        print('0')
        print('')
        sys.exit(0)

    # Format display string
    display_hour = hour
    display_minute = f'{minute:02d}'
    tz_abbrevs = {
        'America/New_York': 'ET', 'America/Chicago': 'CT',
        'America/Denver': 'MT', 'America/Los_Angeles': 'PT',
    }
    tz_abbrev = tz_abbrevs.get(tz_name, tz_name)
    print(seconds)
    print(f'{display_hour}:{display_minute} {ampm} {tz_abbrev}')
except Exception:
    print('0')
    print('')
" 2>/dev/null || {
    echo "0"
    echo ""
  }
}

# --- Circuit breaker ----------------------------------------------------------
# Tracks rapid consecutive failures. If 3+ non-rate-limit failures occur within
# the configured window, triggers a rate limit pause as a safety net.

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
