---
name: batch-work
description: Find claude-ready issues and launch parallel issue-worker agents in isolated worktrees
argument-hint: "[--plan <issue-number>] [--max <count>]"
disable-model-invocation: true
allowed-tools: Agent, Bash(gh *), Bash(git worktree *), Read, Glob, Grep
---

# Batch Work Dispatcher

Find `claude-ready` issues and launch parallel issue-worker agents to work on them. Each agent runs in an isolated git worktree.

**Arguments:** $ARGUMENTS — optional flags:
- `--plan <issue-number>` — only pick issues linked to this plan issue
- `--max <count>` — maximum concurrent agents (default: 3, max: 5)

**Important:** This skill dispatches already-created issues. If you have a plan issue that hasn't been broken into work issues yet, run `/plan-executor` first.

## Steps

### 1. Parse Arguments

Extract `--plan <number>` and `--max <count>` from $ARGUMENTS. Default max is 3. Cap at 5.

### 2. Find Claude-Ready Issues

```bash
gh issue list --label claude-ready --json number,title,body,labels --limit 50
```

If `--plan` was specified, filter to only issues whose body contains `#<plan-number>` or whose labels include the plan reference. Sort by issue number (oldest first).

### 3. Validate Issue Count

- If 0 issues found: report "No claude-ready issues found" and stop.
- If more issues than `--max`: take the first `--max` issues. Report which issues were deferred.

### 4. Launch Issue-Worker Agents

For each selected issue, launch an `issue-worker` agent with `isolation: "worktree"`:

```
Agent(
  subagent_type: "issue-worker",
  isolation: "worktree",
  prompt: "Implement GitHub issue #<number>: <title>"
)
```

Launch all agents concurrently (up to the max limit) in a single message with multiple Agent tool calls.

### 5. Monitor and Report

As agents complete, collect their results. Display a status table:

```
📦 Batch Work Report
═══════════════════

Issue  | Title              | Status  | PR
-------|--------------------|---------|---------
#123   | Add widget API     | ✅ Done | #456
#124   | Fix auth bug       | ✅ Done | #457
#125   | Update styles      | ❌ Fail | —

Dispatched: 3 | Succeeded: 2 | Failed: 1
```

For failed agents, include the failure reason. For successful agents, include the PR link.

### 6. Label Management

For successfully completed issues, the issue-worker agent handles labeling. For failed issues, report them so the user can investigate.
