---
name: metrics
description: Agent effectiveness metrics — queries GitHub and git for PR merge rates, issue success/failure rates, time-to-PR, and worktree counts
context: fork
agent: Explore
allowed-tools: Bash(git worktree list), Bash(gh *), Bash(date *), Bash(mkdir *), Bash(cat *)
---

# Agent Effectiveness Metrics

Query GitHub and git for agent effectiveness metrics and output a formatted dashboard.

**Arguments:** $ARGUMENTS — optional: `--save` to persist a snapshot to `docs/metrics/YYYY-MM-DD.md`.

## Data Sources

Gather all 5 data sources. Use parallel execution where possible to minimize latency. Handle errors gracefully — if a query fails, show "Error fetching data" for that section rather than aborting.

### 1. Agent PRs (Merge Rate)

```bash
gh pr list --state all --limit 100 --json number,title,state,mergedAt,closedAt,createdAt,author,headRefName --search "author:app/github-actions"
```

If the above returns no results (no bot PRs), fall back to listing all recent PRs:

```bash
gh pr list --state all --limit 100 --json number,title,state,mergedAt,closedAt,createdAt,headRefName
```

Filter for agent-created PRs by looking for branch names starting with `issue-` (the issue-worker agent naming convention).

Calculate:
- **Total agent PRs**
- **Merged** (has `mergedAt`)
- **Closed without merge** (state is CLOSED and no `mergedAt`)
- **Open** (state is OPEN)
- **Merge rate** = merged / (merged + closed without merge) as percentage. If no closed PRs, show "N/A".

### 2. Issue Label Counts

Run these queries in parallel:

```bash
gh issue list --label claude-done --state all --limit 500 --json number
```

```bash
gh issue list --label claude-blocked --state all --limit 500 --json number
```

```bash
gh issue list --label claude-wip --state open --json number
```

```bash
gh issue list --label needs-human-review --state open --json number
```

Calculate:
- **Completed** (`claude-done` count)
- **Blocked** (`claude-blocked` count)
- **In progress** (`claude-wip` count)
- **Success rate** = completed / (completed + blocked) as percentage. If no data, show "N/A".
- **Needs human review** count

### 3. Time-to-PR (claude-wip to PR Creation)

For issues labeled `claude-wip` that have associated PRs:

```bash
gh issue list --label claude-done --state all --limit 30 --json number,title,createdAt
```

For each of the most recent 10 issues, find associated PRs by checking for branch naming convention or "Closes #N" in PR body:

```bash
gh pr list --state all --limit 100 --json number,body,createdAt,headRefName
```

Match issues to PRs by looking for `issue-<number>-` in the PR branch name (`headRefName`). Calculate time difference between issue `createdAt` and matched PR `createdAt`.

Report:
- **Average time-to-PR** (formatted as hours/minutes)
- **Fastest** and **slowest** times
- **Sample size** (number of matched pairs)

If fewer than 3 matches are found, note "Insufficient data for reliable average."

### 4. Self-Improvement Issues

```bash
gh issue list --state all --limit 100 --json number,title,state,labels --search "Self-improvement:"
```

Calculate:
- **Total created**
- **Open** (not yet acted on)
- **Closed** (acted on)
- **Action rate** = closed / total as percentage

### 5. Worktree Count

```bash
git worktree list
```

Count total worktrees (subtract 1 for the main worktree to get active agent worktrees).

Report:
- **Total worktrees** (including main)
- **Agent worktrees** (total minus 1)

## Output Format

Display a formatted dashboard:

```
🤖 Agent Effectiveness Metrics
══════════════════════════════

📊 PR Merge Rate
  Total agent PRs:     N
  ✅ Merged:           N
  ❌ Closed (no merge): N
  🔄 Open:             N
  Merge rate:          XX%

🏷️ Issue Outcomes
  ✅ Completed (claude-done):    N
  🚫 Blocked (claude-blocked):  N
  🔄 In Progress (claude-wip):  N
  👀 Needs Human Review:         N
  Success rate:                  XX%

⏱️ Time-to-PR (issue creation → PR creation)
  Average:  Xh Ym
  Fastest:  Xh Ym (#NNN)
  Slowest:  Xh Ym (#NNN)
  Sample:   N issues

🔧 Self-Improvement Issues
  Total created:  N
  Open:           N
  Closed:         N
  Action rate:    XX%

🌳 Worktrees
  Total:          N
  Agent (active): N
```

If any section has no data, show "No data available" instead of zeros.

## Snapshot (--save)

If `$ARGUMENTS` contains `--save`:

1. Create directory if needed:
   ```bash
   mkdir -p docs/metrics
   ```

2. Write the dashboard output to `docs/metrics/YYYY-MM-DD.md` (using today's date).

3. If a file for today already exists, overwrite it (snapshots are per-day).

4. Report: "Snapshot saved to `docs/metrics/YYYY-MM-DD.md`"

If `--save` is not specified, only display the dashboard — do not write any files.
