#!/usr/bin/env bash
# daemon-status.sh — Show the current state of the issue daemon.
#
# Usage:
#   ./scripts/daemon-status.sh         # default status display
#   ./scripts/daemon-status.sh -v      # verbose: show last 5 lines of each worker's log
#   ./scripts/daemon-status.sh -w      # watch mode: refresh every 5 seconds
#   ./scripts/daemon-status.sh -g      # fetch latest GitHub progress tag per active worker
#   ./scripts/daemon-status.sh -a 123  # attach to tmux session for issue #123
#   ./scripts/daemon-status.sh -v -w -g # all flags combined
#
# Requirements:
#   - Run from the repo root (or set LOG_DIR and DAEMON_STATE_DIR env vars)

set -euo pipefail

# --- Configuration -----------------------------------------------------------
VERBOSE=0
WATCH=0
GITHUB=0
ATTACH_ISSUE=""
LOG_DIR="${LOG_DIR:-./logs/issue-daemon}"
WATCH_INTERVAL=5

# --- Parse flags --------------------------------------------------------------
while getopts "vwga:" opt; do
  case $opt in
    v) VERBOSE=1 ;;
    w) WATCH=1 ;;
    g) GITHUB=1 ;;
    a) ATTACH_ISSUE="$OPTARG" ;;
    *) echo "Usage: $0 [-v] [-w] [-g] [-a <issue>]" && exit 1 ;;
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
  case "$hb_epoch" in *[!0-9]*|"") hb_epoch=0 ;; esac
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

# Get the latest progress tag for an issue from GitHub comments.
# $1 — issue number
# Returns the tag (e.g., "step_3_implement") or empty string.
get_progress_tag() {
  local issue="$1"
  gh issue view "$issue" --json comments \
    -q '[.comments[].body | capture("<!-- progress:(?<t>[a-z0-9_]+) -->") | .t] | last // empty' 2>/dev/null || true
}

# Find the tmux session name for a given issue number.
# Checks for sessions named "worker-<issue>" (resume path) or containing
# the issue number (fresh-start --tmux=classic path).
# $1 — issue number
# Returns session name or empty string.
find_tmux_session() {
  local issue="$1"

  # Bail if tmux is not available or no server is running
  if ! command -v tmux >/dev/null 2>&1; then
    return
  fi

  local sessions
  sessions=$(tmux list-sessions -F '#{session_name}' 2>/dev/null) || return

  # Priority 1: exact match on "worker-<issue>" (daemon resume path)
  if echo "$sessions" | grep -qxF "worker-${issue}"; then
    echo "worker-${issue}"
    return
  fi

  # Priority 2: session name ending with "-<issue>" (--tmux=classic worktree naming)
  local match
  match=$(echo "$sessions" | grep -E "(^|-)${issue}\$" | head -1)
  if [ -n "$match" ]; then
    echo "$match"
    return
  fi
}

# Attach to the tmux session for a given issue number.
# $1 — issue number
attach_to_session() {
  local issue="$1"
  local session
  session=$(find_tmux_session "$issue")

  if [ -z "$session" ]; then
    echo "No tmux session found for issue #${issue}."
    exit 1
  fi

  echo "Attaching to tmux session '${session}' for issue #${issue}..."
  exec tmux attach -t "$session"
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
    case "$daemon_pid" in *[!0-9]*) daemon_pid="" ;; esac
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
      [ -z "$pid" ] && continue
      # Validate all fields
      case "$pid" in *[!0-9]*) continue ;; esac
      case "$issue" in *[!0-9]*|"") continue ;; esac
      case "$start_epoch" in *[!0-9]*|"") continue ;; esac
      case "$type" in worker|plan) ;; *) continue ;; esac
      # Check if PID is alive
      if kill -0 "$pid" 2>/dev/null; then
        active_count=$((active_count + 1))
        worker_lines="${worker_lines}${pid}:${issue}:${start_epoch}:${type}
"
      fi
    done < "$pid_metadata_file"
  fi

  # Worker count display
  echo "  Workers: ${active_count} active"

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

    local log_name="issue-${issue}.log"
    [ "$type" = "plan" ] && log_name="plan-${issue}.log"
    local log_path="$LOG_DIR/$log_name"

    local size_str="(missing)"
    if [ -f "$log_path" ]; then
      local size_bytes
      size_bytes=$(get_file_size "$log_path")
      size_str="$log_name ($(format_size "$size_bytes"))"
    fi

    local progress_str=""
    if [ "$GITHUB" -eq 1 ]; then
      local tag
      tag=$(get_progress_tag "$issue")
      if [ -n "$tag" ]; then
        progress_str="  [$tag]"
      fi
    fi

    # Tmux session info
    local tmux_str=""
    local tmux_session
    tmux_session=$(find_tmux_session "$issue")
    if [ -n "$tmux_session" ]; then
      tmux_str="  tmux:${tmux_session}"
    fi

    printf '  #%-4s %-9s %s elapsed  %s%s%s  %s\n' \
      "$issue" "$type" "$elapsed_str" "$hb_str" "$progress_str" "$tmux_str" "$size_str"

    if [ "$VERBOSE" -eq 1 ] && [ -n "$tmux_session" ]; then
      echo "         tmux attach -t ${tmux_session}"
    fi

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

# Handle -a flag: attach to tmux session for an issue
if [ -n "$ATTACH_ISSUE" ]; then
  attach_to_session "$ATTACH_ISSUE"
  exit 0
fi

if [ "$WATCH" -eq 1 ]; then
  while true; do
    clear
    show_status
    sleep "$WATCH_INTERVAL"
  done
else
  show_status
fi
