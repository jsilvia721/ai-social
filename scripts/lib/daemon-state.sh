#!/usr/bin/env bash
# daemon-state.sh — Shared state management for daemon scripts.
#
# Usage:
#   source scripts/lib/daemon-state.sh
#   ensure_state_dir
#   set_rate_limit_pause [duration_secs]
#   is_rate_limit_paused       # returns 0 if paused, 1 if not
#   clear_rate_limit_pause
#   get_pause_until_display    # returns HH:MM:SS or "unknown"
#   set_drain_mode
#   is_drain_mode              # returns 0 if draining, 1 if not
#   clear_drain_mode
#
# State directory: ./logs/daemon-shared/ (override via DAEMON_STATE_DIR)

set -euo pipefail

DAEMON_STATE_DIR="${DAEMON_STATE_DIR:-./logs/daemon-shared}"

# Create the state directory if it doesn't exist.
ensure_state_dir() {
  mkdir -p "$DAEMON_STATE_DIR"
}

# Set rate limit pause. Writes expiry epoch to pause-until file.
# $1 — duration in seconds (default: 900 = 15 minutes)
set_rate_limit_pause() {
  local duration="${1:-900}"
  local until_epoch=$(( $(date +%s) + duration ))
  ensure_state_dir
  echo "$until_epoch" > "$DAEMON_STATE_DIR/pause-until"
}

# Check if rate limit pause is active.
# Returns 0 if paused, 1 if not. Auto-clears expired pauses.
is_rate_limit_paused() {
  if [ ! -f "$DAEMON_STATE_DIR/pause-until" ]; then
    return 1
  fi

  local until_epoch
  until_epoch=$(cat "$DAEMON_STATE_DIR/pause-until" 2>/dev/null || echo "0")
  local now
  now=$(date +%s)

  if [ "$now" -ge "$until_epoch" ]; then
    # Expired — auto-clear
    clear_rate_limit_pause
    return 1
  fi

  return 0
}

# Remove rate limit pause file.
clear_rate_limit_pause() {
  rm -f "$DAEMON_STATE_DIR/pause-until"
}

# Return human-readable expiry time (HH:MM:SS), or "unknown" if no pause set.
get_pause_until_display() {
  if [ ! -f "$DAEMON_STATE_DIR/pause-until" ]; then
    echo "unknown"
    return
  fi

  local until_epoch
  until_epoch=$(cat "$DAEMON_STATE_DIR/pause-until" 2>/dev/null || echo "")

  if [ -z "$until_epoch" ]; then
    echo "unknown"
    return
  fi

  # macOS: date -r <epoch>; Linux: date -d @<epoch>
  date -r "$until_epoch" '+%H:%M:%S' 2>/dev/null || \
    date -d "@${until_epoch}" '+%H:%M:%S' 2>/dev/null || \
    echo "unknown"
}

# Set drain mode (file-based flag).
set_drain_mode() {
  ensure_state_dir
  touch "$DAEMON_STATE_DIR/drain"
}

# Check if drain mode is active.
# Returns 0 if draining, 1 if not.
is_drain_mode() {
  [ -f "$DAEMON_STATE_DIR/drain" ]
}

# Remove drain mode flag.
clear_drain_mode() {
  rm -f "$DAEMON_STATE_DIR/drain"
}

# --- Worker PID metadata tracking -------------------------------------------
# File format: PID:ISSUE_NUMBER:START_EPOCH:TYPE (one entry per line)
# Override path via WORKER_PID_FILE env var for testing.

# Record a new worker entry.
# $1 — PID, $2 — issue number, $3 — type ("worker" or "plan")
record_worker() {
  local pid="$1"
  local issue="$2"
  local type="$3"
  local start_epoch
  start_epoch=$(date +%s)
  local file="${WORKER_PID_FILE:-./logs/issue-daemon/.active_pids}"
  echo "${pid}:${issue}:${start_epoch}:${type}" >> "$file"
}

# Remove a worker entry by PID.
# $1 — PID to remove
remove_worker() {
  local pid="$1"
  # Validate PID is numeric to prevent regex injection
  case "$pid" in
    *[!0-9]*|"") return 1 ;;
  esac
  local file="${WORKER_PID_FILE:-./logs/issue-daemon/.active_pids}"
  [ -f "$file" ] || return 0
  local tmp
  tmp=$(mktemp)
  grep -v "^${pid}:" "$file" > "$tmp" || true
  mv "$tmp" "$file"
}

# List all worker entries (caller filters dead PIDs).
# Outputs lines in PID:ISSUE:START_EPOCH:TYPE format.
list_workers() {
  local file="${WORKER_PID_FILE:-./logs/issue-daemon/.active_pids}"
  [ -f "$file" ] || return 0
  cat "$file"
}

# Get the start epoch for a given PID.
# $1 — PID to look up. Outputs epoch or empty string.
get_worker_start() {
  local pid="$1"
  local file="${WORKER_PID_FILE:-./logs/issue-daemon/.active_pids}"
  [ -f "$file" ] || return 0
  awk -F: -v pid="$pid" '$1 == pid { print $3 }' "$file"
}
