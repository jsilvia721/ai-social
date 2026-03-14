# Bug Monitor Self-Reporting

**Date:** 2026-03-13
**Status:** Brainstorm complete

## What We're Building

A self-reporting capability for the bug monitor daemon (`scripts/bug-monitor.sh`) so that when the monitor itself encounters errors — GitHub API failures, DB connection issues, CloudWatch query failures — it creates GitHub issues tracking its own health, using the same issue pipeline it already uses for app bugs.

## Why

The bug monitor currently logs its own errors to `logs/bug-monitor/daemon.log`, but nobody checks that file proactively. If the monitor silently fails (e.g., GitHub API 404, psql connection drop), errors go unnoticed and app bugs stop getting reported. The monitor needs to "eat its own dog food" and report its own failures through the same GitHub issue system it uses for everything else.

## Key Decisions

### 1. Circuit breaker: local health file fallback
When the monitor can't reach GitHub (the most common self-error scenario), it writes to a local health file (e.g., `logs/bug-monitor/.self-health.json`) with error category, count, and timestamps. On the next successful cycle where GitHub is reachable, it reads the health file and files the issue then. This avoids the infinite loop of "can't report to GitHub that GitHub is down."

### 2. Per-category GitHub issues
Each error category gets its own issue rather than a single rolling health issue:
- **GitHub API failures** — rate limits, 404s, auth issues
- **DB connection failures** — psql timeouts, connection refused
- **CloudWatch query failures** — AWS CLI errors, permission issues

This makes triage easier and lets different people/agents address different infrastructure problems independently.

### 3. Separate label: `bug-monitor-health`
Self-reported issues use a distinct label (`bug-monitor-health`) instead of the standard `bug-report` label. This keeps them visually separate from app bugs and allows filtering.

### 4. Report on first failure
No threshold — escalate immediately on the first self-error. These are infrastructure-level failures that indicate the monitoring pipeline itself is degraded. Transient failures are acceptable noise because they're rare and important to know about.

### 5. Deduplication via existing patterns
Reuse the same fingerprinting + cooldown + GitHub issue search logic already in the monitor. Self-errors get fingerprinted like any other error (e.g., `sha256("SELF:github_api_failure")`). Cooldown prevents duplicate issues within 30 minutes.

## Approach

### How it works

1. **Wrap failure points** — Each place the monitor currently logs an error and continues (`log "Error: ..."`) also calls a new `record_self_error` function that writes to the local health file.

2. **Health file format** — JSON lines in `.self-health.json`, one per error occurrence:
   ```json
   {"category":"github_api","message":"failed to create issue for: Bug [unknown]: ...","timestamp":"2026-03-13T19:54:31Z"}
   ```

3. **Flush at end of cycle** — At the end of each poll cycle (after CloudWatch + DB polls), call `flush_self_errors` which:
   - Reads the health file
   - Groups by category
   - For each category with errors: fingerprint it, check cooldown/dedup, create or comment on a GitHub issue
   - Clears the health file on success
   - If GitHub is still unreachable, leaves the file for next cycle

4. **Issue format** — Same structure as app bug issues but with:
   - Title: `Bug Monitor Health: <category>` (e.g., `Bug Monitor Health: GitHub API failures`)
   - Label: `bug-monitor-health` instead of `bug-report`
   - Body: aggregated error messages, count, time range, suggested remediation

5. **Max self-issues per cycle** — Cap at 1-2 self-issues per cycle (separate from the existing `MAX_ISSUES_PER_CYCLE=5` for app bugs) to prevent runaway self-reporting.

## Open Questions

None — all key decisions resolved during brainstorm.

## Out of Scope

- Alternative notification channels (Slack, email) — GitHub issues are sufficient for now
- Dashboard/UI for monitor health — log file + GitHub issues cover this
- Auto-restart or self-healing — the monitor already degrades gracefully; this is about visibility
