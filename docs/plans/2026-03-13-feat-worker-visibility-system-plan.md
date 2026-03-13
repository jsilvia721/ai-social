---
title: "feat: Worker Visibility System for Issue Daemon"
type: feat
status: active
date: 2026-03-13
---

# feat: Worker Visibility System for Issue Daemon

## Overview

Add observability to the issue-daemon so we can detect stalled/dead workers, get a quick status overview, and track worker progress through milestones — without tailing individual log files.

## Problem Statement

When the issue-daemon is running with multiple workers, there's no way to know:
- Whether a worker is alive or has silently stalled/died
- How long each worker has been running
- What step a worker is on (tests? review? PR creation?)
- Whether a worker is close to completion or barely started

The only visibility today is GitHub labels (`claude-wip`) and manually tailing per-worker log files. Workers that stall hold their issue in `claude-wip` indefinitely with no timeout or detection.

## Proposed Solution

Three phases of progressively richer observability, all pure bash, all building on the existing `daemon-state.sh` pattern.

### Phase 1: Heartbeat + Stale Detection + Wall-Clock Timeout

**Heartbeat writer:** A background subshell inside `run_worker` (and `run_plan_executor`) that writes the current epoch to a heartbeat file every 30 seconds while `wait`-ing on the Claude process PID. This is the most reliable approach — it proves the host process is alive without requiring the Claude agent to cooperate.

```bash
# Inside run_worker, after spawning claude:
local heartbeat_file="$LOG_DIR/heartbeat-${issue_number}"
(
  while kill -0 "$claude_pid" 2>/dev/null; do
    date +%s > "${heartbeat_file}.tmp" && mv "${heartbeat_file}.tmp" "$heartbeat_file"
    sleep 30
  done
) &
local heartbeat_pid=$!

wait "$claude_pid"
local exit_code=$?

# Cleanup heartbeat writer
kill "$heartbeat_pid" 2>/dev/null || true
wait "$heartbeat_pid" 2>/dev/null || true
rm -f "$heartbeat_file" "${heartbeat_file}.tmp"
```

Key design decisions:
- **Atomic writes** via write-to-tmp + `mv` to prevent partial reads (addresses race condition)
- **30s write interval** (half the stale threshold gives margin)
- **Cleanup on exit** — heartbeat file removed after `wait` returns, preventing false positives from completed workers
- **Daemon startup cleanup** — on daemon start, remove any orphaned heartbeat files from a previous crashed run

**Stale detection:** In the daemon's main poll loop, after the rate-limit check and before spawning new workers, iterate over heartbeat files. If any heartbeat is >5 minutes stale, label the issue `claude-blocked` and comment.

- 5 minutes = 10 missed heartbeats at 30s interval, generous enough to avoid false positives from system load
- Stale detection only runs for workers whose PID is still alive (`kill -0`). If PID is dead and heartbeat file exists, it's an orphan from a crash — clean it up silently.

**Wall-clock timeout:** New `-T <minutes>` flag (default: 60 minutes). The daemon tracks worker start times in the enhanced PID metadata file. Each poll cycle, check elapsed time for all active workers. If over the limit:

1. Call `commit_wip_if_needed` (preserve work, matching rate-limit behavior)
2. Send SIGTERM to the process group (`kill -TERM -- -$pid`), wait 10 seconds, then SIGKILL if still alive
3. Label `claude-blocked`, comment with elapsed time and timeout value
4. Clean up heartbeat file

**Precedence rule:** Timeout check runs first. If a worker is killed by timeout, skip the stale check for that worker in the same cycle. This prevents duplicate comments.

### Phase 2: Status Dashboard CLI

New `scripts/daemon-status.sh` — a read-only script that assembles status from files on disk.

```
$ ./scripts/daemon-status.sh

Issue Daemon Status
  PID: 12345 (running)
  Mode: normal
  Workers: 2/3 active
  Rate limit: none

Active Workers:
  #45  worker    32m elapsed  ♥ 28s ago  issue-45.log (1.2 MB)
  #47  worker    12m elapsed  ♥ 15s ago  issue-47.log (340 KB)

$ ./scripts/daemon-status.sh -v

[... same header ...]

Active Workers:
  #45  worker    32m elapsed  ♥ 28s ago  issue-45.log (1.2 MB)
    > Running ci:check after fixing lint errors...
    > npm run ci:check
    > ✓ ESLint passed
    > ✓ TypeScript passed
    > ✓ Coverage passed
  #47  worker    12m elapsed  ♥ 15s ago  issue-47.log (340 KB)
    > Writing tests for POST /api/posts endpoint
    > ...
```

Data sources:
- **Daemon PID/status**: Read `$LOG_DIR/.issue-daemon.pid`, check `kill -0`
- **Drain mode**: Check `$DAEMON_STATE_DIR/drain` file
- **Rate limit**: Check `$DAEMON_STATE_DIR/pause-until` file
- **Active workers**: Read enhanced PID metadata file (`PID:ISSUE:START_EPOCH:TYPE`)
- **Heartbeat freshness**: Read `$LOG_DIR/heartbeat-{issue}` files
- **Log file size**: `stat` on `$LOG_DIR/issue-{N}.log` or `plan-{N}.log`
- **Verbose log tail**: `tail -5` on the log file

Visual indicators:
- `♥` = heartbeat fresh (< 1 min ago)
- `♡` = heartbeat aging (1-5 min ago)
- `⚠ STALE` = heartbeat stale (> 5 min) or missing

Flags:
- `-v` — verbose mode, show last 5 lines of each worker's log
- `-j` — (future, not in scope) JSON output for automation
- `-w` — watch mode, refresh every 5 seconds (`watch -n 5` wrapper)

### Phase 3: Progress Events

**Agent-side:** Update `.claude/agents/issue-worker.md` to post structured progress comments at key milestones. Each comment includes an HTML comment tag for machine parsing and a human-readable body:

```markdown
<!-- progress:step_1_assess -->
**[Progress]** Complexity assessed: **Moderate** (3 files, follows existing patterns)
```

Milestone tags:
| Tag | When | Issue-worker step |
|-----|------|-------------------|
| `step_1_assess` | After complexity assessment | Step 1 |
| `step_2_plan` | After planning (Moderate+Complex) | Step 2 |
| `step_3_implement` | After tests + implementation pass ci:check | Step 3 |
| `step_4_review` | After all review agents return | Step 4 |
| `step_5_validate` | After test plan validation | Step 5 |
| `step_6_pr` | After PR creation | Step 6 |

For Trivial issues, steps 2 and 4 (full review) are skipped — the agent simply doesn't post those progress comments.

**Dashboard integration:** `daemon-status.sh` can optionally query GitHub for the latest progress comment on each active worker's issue. However, to avoid GitHub API rate limits, this is only done with the `-g` (GitHub) flag, not by default. Without `-g`, the dashboard shows file-based status only.

```
$ ./scripts/daemon-status.sh -g

Active Workers:
  #45  worker  32m elapsed  ♥ 28s ago  step_3_implement  issue-45.log (1.2 MB)
  #47  worker  12m elapsed  ♥ 15s ago  step_1_assess      issue-47.log (340 KB)
```

## Technical Considerations

### Enhanced PID Metadata File

Replace the current flat PID file (`$LOG_DIR/.active_pids`) with a structured format:

```
PID:ISSUE_NUMBER:START_EPOCH:TYPE
```

Example:
```
54321:45:1710345600:worker
54322:47:1710346200:worker
54323:50:1710346800:plan
```

The `active_worker_count` function is updated to parse this format. The dashboard reads it directly. Functions:
- `record_worker(pid, issue, type)` — appends a line
- `remove_worker(pid)` — removes the line
- `list_workers` — returns all lines (caller filters dead PIDs)
- `get_worker_start(pid)` — returns start epoch for timeout calculation

These go in `scripts/lib/daemon-state.sh` to keep state management centralized.

### Plan Executor Coverage

Plan executors participate in all three phases with the same thresholds. The `TYPE` field in the metadata file distinguishes them. Heartbeat files use the same naming: `heartbeat-{issue}` (the issue number is unique regardless of worker type).

### Bash 3 Compatibility

- No associative arrays — use the flat structured PID file with `grep`/`awk` parsing
- No `readarray` — use `while read` loops
- Atomic heartbeat writes via `tmp` + `mv`
- macOS/Linux `stat` difference: use `stat -f%z` (macOS) with `stat -c%s` (Linux) fallback for file sizes
- macOS/Linux `date` difference: existing `daemon-state.sh` pattern (`date -r` vs `date -d`)

### Daemon Restart Safety

On startup, the daemon:
1. Removes orphaned heartbeat files (no matching live PID)
2. Truncates the PID metadata file (existing behavior, extended)
3. Clears drain mode (existing behavior)

This means workers orphaned from a crashed daemon are not tracked by the new instance. This is acceptable — orphaned Claude processes will eventually exhaust their budget/turns and exit.

## Acceptance Criteria

### Phase 1: Heartbeat + Stale Detection + Timeout
- [ ] Background heartbeat writer in `run_worker` writes epoch every 30s to `$LOG_DIR/heartbeat-{issue}`
- [ ] Background heartbeat writer in `run_plan_executor` (same pattern)
- [ ] Heartbeat files use atomic write (tmp + mv)
- [ ] Heartbeat files cleaned up on normal worker exit (success or failure)
- [ ] Orphaned heartbeat files cleaned up on daemon startup
- [ ] Daemon poll loop checks heartbeat freshness for all active workers
- [ ] Workers with heartbeat >5 min stale and live PID get labeled `claude-blocked` with comment "Worker appears stalled (no heartbeat for Xm)"
- [ ] Workers with dead PID and orphaned heartbeat get cleaned up silently
- [ ] New `-T <minutes>` flag for wall-clock timeout (default: 60 min)
- [ ] Enhanced PID metadata file: `PID:ISSUE:START_EPOCH:TYPE`
- [ ] `daemon-state.sh` updated with worker metadata functions
- [ ] Timeout check runs before stale check (prevents duplicate actions)
- [ ] Timed-out workers get WIP committed before kill (matching rate-limit behavior)
- [ ] Timed-out workers killed with SIGTERM, 10s grace, then SIGKILL
- [ ] Timed-out workers labeled `claude-blocked` with comment including elapsed time
- [ ] Tests in `scripts/__tests__/daemon-state.test.sh` for new state functions

### Phase 2: Status Dashboard
- [ ] New `scripts/daemon-status.sh` script
- [ ] Shows daemon PID and running/stopped status
- [ ] Shows daemon mode (normal, draining, rate-limited)
- [ ] Shows active worker count and max workers
- [ ] Shows per-worker: issue #, type, elapsed time, heartbeat age, log file size
- [ ] Visual heartbeat indicators (♥ fresh, ♡ aging, ⚠ STALE)
- [ ] `-v` flag shows last 5 lines of each worker's log
- [ ] `-w` flag for watch mode (refresh every 5s)
- [ ] Works when daemon is not running (shows "not running" + any orphaned state)
- [ ] Bash 3 compatible (macOS)
- [ ] Tests in `scripts/__tests__/daemon-status.test.sh`

### Phase 3: Progress Events
- [ ] `.claude/agents/issue-worker.md` updated with progress comment instructions at each milestone
- [ ] Progress comments use `<!-- progress:tag -->` format for machine parsing
- [ ] Human-readable body with `**[Progress]**` prefix
- [ ] Trivial issues skip planning and full review milestones (no comment for skipped steps)
- [ ] `-g` flag on `daemon-status.sh` fetches latest progress tag from GitHub per active worker
- [ ] Progress tags displayed in dashboard when `-g` is used

## Dependencies & Risks

**Dependencies:**
- None external. All changes are within the scripts directory and agent definition.

**Risks:**
- **Heartbeat subshell reliability** — If the background subshell dies before the main process, heartbeats stop and false stale detection occurs. Mitigated by the 5-minute threshold (generous) and PID liveness cross-check.
- **Process group kills** — `kill -TERM -- -$pid` requires the worker to be a process group leader. The `claude` CLI may or may not create its own process group. If not, individual PID kill is the fallback, but child processes may be orphaned. Test this during implementation.
- **GitHub API rate limits** — Phase 3 adds more `gh issue comment` calls. The existing daemon already makes many API calls per cycle. Progress comments are infrequent (5-6 per issue over 30-60 min) so this should be fine, but monitor if running many workers.
- **Agent compliance** — Phase 3 relies on the Claude agent following instructions to post progress comments. Agent instructions are best-effort — the agent may skip them under budget pressure. This is acceptable since Phases 1-2 provide the critical visibility.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `scripts/lib/daemon-state.sh` | Modify | Add worker metadata functions (record, remove, list, get_start) |
| `scripts/issue-daemon.sh` | Modify | Add heartbeat writer, stale detection, timeout flag, enhanced PID tracking |
| `scripts/daemon-status.sh` | Create | Status dashboard CLI |
| `.claude/agents/issue-worker.md` | Modify | Add progress comment instructions at milestones |
| `scripts/__tests__/daemon-state.test.sh` | Modify | Tests for new state functions |
| `scripts/__tests__/daemon-status.test.sh` | Create | Tests for status dashboard |

## Sources & References

- `scripts/issue-daemon.sh` — existing daemon implementation (461 lines)
- `scripts/lib/daemon-state.sh` — shared state library (rate limit, drain mode)
- `scripts/bug-monitor.sh` — reference for dual-output logging pattern
- `scripts/__tests__/daemon-state.test.sh` — test framework pattern to follow
- `.claude/agents/issue-worker.md` — current 8-step agent workflow
