---
name: status
description: Project pulse check — gathers worktrees, PRs, issues, CI runs, and stale items into a formatted dashboard
context: fork
agent: Explore
allowed-tools: Bash(git worktree list), Bash(gh *)
---

# Project Status Dashboard

Gather project state from multiple sources in parallel and display a formatted dashboard.

**Arguments:** $ARGUMENTS — none expected.

## Data Sources

Gather all 8 data sources. Use parallel execution where possible to minimize latency.

### 1. Active Worktrees

```bash
git worktree list
```

List all worktrees with their branches.

### 2. Open PRs with CI Status

```bash
gh pr list --json number,title,headRefName,statusCheckRollup,updatedAt --limit 20
```

Show PR number, title, branch, and CI status (pass/fail/pending).

### 3. Claude WIP Issues

```bash
gh issue list --label claude-wip --json number,title,assignees,updatedAt --limit 20
```

Issues currently being worked on by agents.

### 4. Claude Ready Issues

```bash
gh issue list --label claude-ready --json number,title,labels,updatedAt --limit 20
```

Issues queued for agent work.

### 5. Plan Issues

```bash
gh issue list --label plan --state open --json number,title,updatedAt --limit 10
```

Open plan issues awaiting execution or approval.

### 6. Needs Human Review

```bash
gh issue list --label needs-human-review --json number,title,updatedAt --limit 20
```

Items requiring human decision or approval.

### 7. Recent CI Runs

```bash
gh run list --limit 10 --json databaseId,displayTitle,status,conclusion,headBranch,createdAt
```

Flag any failures prominently.

### 8. Stale Items

From the data gathered above, identify items not updated in >7 days. Flag these separately.

## Output Format

Display a formatted dashboard:

```
📊 Project Status Dashboard
═══════════════════════════

🌳 Worktrees (N active)
  <branch> → <path>

🔀 Open PRs (N)
  #<num> <title> [<CI status>]

🤖 Agent Activity
  WIP (N):   #<num> <title>
  Ready (N): #<num> <title>

📋 Plans (N open)
  #<num> <title>

👀 Needs Human Review (N)
  #<num> <title>

🏗️ Recent CI (last 10)
  <branch> — <status> (<time>)
  ❌ <branch> — FAILED (<time>)   ← highlight failures

⚠️ Stale Items (>7 days)
  #<num> <title> (last updated <date>)
```

If any section has no items, show "None" instead of an empty section. Always show all 8 sections.
