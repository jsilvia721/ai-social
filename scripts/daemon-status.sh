#!/usr/bin/env bash
# daemon-status.sh — Show the current state of the issue daemon.
#
# Usage:
#   ./scripts/daemon-status.sh         # default status display
#   ./scripts/daemon-status.sh -v      # verbose: show last 5 lines of each worker's log
#   ./scripts/daemon-status.sh -w      # watch mode: refresh every 5 seconds
#   ./scripts/daemon-status.sh -v -w   # verbose + watch
#
# Requirements:
#   - Run from the repo root (or set LOG_DIR and DAEMON_STATE_DIR env vars)

set -euo pipefail

# --- Configuration -----------------------------------------------------------
VERBOSE=0
WATCH=0
LOG_DIR="${LOG_DIR:-./logs/issue-daemon}"
WATCH_INTERVAL=5

# --- Parse flags --------------------------------------------------------------
while getopts "vw" opt; do
  case $opt in
    v) VERBOSE=1 ;;
    w) WATCH=1 ;;
    *) echo "Usage: $0 [-v] [-w]" && exit 1 ;;
  esac
done

# --- Setup --------------------------------------------------------------------
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

# Source the shared state library
# shellcheck source=scripts/lib/daemon-state.sh
source "scripts/lib/daemon-state.sh"

# --- Helpers ------------------------------------------------------------------

# Get file size in bytes (cross-platform).
get_file_size() {
  local file="$1"
  # macOS: stat -f%z; Linux: stat -c%s
  stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo "0"
}

# Format bytes to human-readable KB/MB.
format_size() {
  local bytes="$1"
  if [ "$bytes" -ge 1048576 ]; then
    # MB with one decimal
    local mb_int=$((bytes / 1048576))
    local mb_frac=$(( (bytes % 1048576) * 10 / 1048576 ))
    echo "${mb_int}.${mb_frac} MB"
  elif [ "$bytes" -ge 1024 ]; then
    local kb=$((bytes / 1024))
    echo "${kb} KB"
  else
    echo "${bytes} B"
  fi
}

# Format elapsed seconds to Xm or Xh Ym.
format_elapsed() {
  local secs="$1"
  local mins=$((secs / 60))
  if [ "$mins" -ge 60 ]; then
    local hours=$((mins / 60))
    local rem_mins=$((mins % 60))
    echo "${hours}h ${rem_mins}m"
  else
    echo "${mins}m"
  fi
}

# Get heartbeat indicator for an issue.
# $1 — issue number
heartbeat_indicator() {
  local issue="$1"
  local hb_file="$LOG_DIR/heartbeat-${issue}"
  local now
  now=$(date +%s)

  if [ ! -f "$hb_file" ]; then
    echo "⚠ STALE (no heartbeat)"
    return
  fi

  local hb_epoch
  hb_epoch=$(cat "$hb_file" 2>/dev/null || echo "0")
  local age=$((now - hb_epoch))

  if [ "$age" -lt 60 ]; then
    echo "♥ ${age}s ago"
  elif [ "$age" -lt 300 ]; then
    local age_min=$((age / 60))
    echo "♡ ${age_min}m ago"
  else
    local age_min=$((age / 60))
    echo "⚠ STALE ${age_min}m ago"
  fi
}

# Try to detect MAX_WORKERS from daemon's command line.
# $1 — daemon PID
detect_max_workers() {
  local daemon_pid="$1"
  local cmdline=""

  # Try macOS ps first, then Linux /proc
  cmdline=$(ps -o args= -p "$daemon_pid" 2>/dev/null || true)
  if [ -z "$cmdline" ] && [ -f "/proc/${daemon_pid}/cmdline" ]; then
    # /proc/cmdline uses null bytes as separators
    cmdline=$(tr '\0' ' ' < "/proc/${daemon_pid}/cmdline" 2>/dev/null || true)
  fi

  if [ -n "$cmdline" ]; then
    # Extract -w flag value
    local max_w=""
    max_w=$(echo "$cmdline" | grep -oE '\-w [0-9]+' | awk '{print $2}' || true)
    if [ -n "$max_w" ]; then
      echo "$max_w"
      return
    fi
  fi

  echo ""
}

# Get the log file for a worker.
# $1 — issue number, $2 — type (worker or plan)
get_log_file() {
  local issue="$1"
  local type="$2"
  if [ "$type" = "plan" ]; then
    echo "plan-${issue}.log"
  else
    echo "issue-${issue}.log"
  fi
}

# --- Display ------------------------------------------------------------------

show_status() {
  local daemon_pid=""
  local daemon_running=0
  local pid_file="$LOG_DIR/.issue-daemon.pid"

  echo "Issue Daemon Status"

  # Check daemon PID
  if [ -f "$pid_file" ]; then
    daemon_pid=$(cat "$pid_file" 2>/dev/null || echo "")
    if [ -n "$daemon_pid" ] && kill -0 "$daemon_pid" 2>/dev/null; then
      daemon_running=1
      echo "  PID: ${daemon_pid} (running)"
    else
      echo "  PID: — (not running)"
    fi
  else
    echo "  PID: — (not running)"
  fi

  if [ "$daemon_running" -eq 0 ]; then
    echo ""
    echo "No active workers."
    return
  fi

  # Mode
  if is_drain_mode; then
    echo "  Mode: draining"
  elif is_rate_limit_paused; then
    local expiry
    expiry=$(get_pause_until_display)
    echo "  Mode: rate-limited (until ${expiry})"
  else
    echo "  Mode: normal"
  fi

  # Count active (alive) workers
  local active_count=0
  local worker_lines=""
  local pid_metadata_file="${WORKER_PID_FILE:-$LOG_DIR/.active_pids}"

  if [ -f "$pid_metadata_file" ]; then
    while IFS=: read -r pid issue start_epoch type; do
      # Skip empty lines
      [ -z "$pid" ] && continue
      # Validate PID is numeric
      case "$pid" in *[!0-9]*) continue ;; esac
      # Check if PID is alive
      if kill -0 "$pid" 2>/dev/null; then
        active_count=$((active_count + 1))
        worker_lines="${worker_lines}${pid}:${issue}:${start_epoch}:${type}
"
      fi
    done < "$pid_metadata_file"
  fi

  # Worker count display
  local max_workers=""
  max_workers=$(detect_max_workers "$daemon_pid")
  if [ -n "$max_workers" ]; then
    echo "  Workers: ${active_count}/${max_workers} active"
  else
    echo "  Workers: ${active_count} active"
  fi

  # Rate limit
  if ! is_rate_limit_paused; then
    echo "  Rate limit: none"
  fi

  if [ "$active_count" -eq 0 ]; then
    echo ""
    echo "No active workers."
    return
  fi

  # Active workers detail
  echo ""
  echo "Active Workers:"

  echo "$worker_lines" | while IFS=: read -r pid issue start_epoch type; do
    [ -z "$pid" ] && continue

    local now
    now=$(date +%s)
    local elapsed=$((now - start_epoch))
    local elapsed_str
    elapsed_str=$(format_elapsed "$elapsed")

    local hb_str
    hb_str=$(heartbeat_indicator "$issue")

    local log_name
    log_name=$(get_log_file "$issue" "$type")
    local log_path="$LOG_DIR/$log_name"

    local size_str="(missing)"
    if [ -f "$log_path" ]; then
      local size_bytes
      size_bytes=$(get_file_size "$log_path")
      size_str="$log_name ($(format_size "$size_bytes"))"
    fi

    printf '  #%-4s %-9s %s elapsed  %s  %s\n' \
      "$issue" "$type" "$elapsed_str" "$hb_str" "$size_str"

    if [ "$VERBOSE" -eq 1 ] && [ -f "$log_path" ]; then
      echo "    --- last 5 lines ---"
      tail -5 "$log_path" | while IFS= read -r line; do
        echo "    $line"
      done
      echo ""
    fi
  done
}

# --- Main ---------------------------------------------------------------------

if [ "$WATCH" -eq 1 ]; then
  while true; do
    clear
    show_status
    sleep "$WATCH_INTERVAL"
  done
else
  show_status
fi
