---
paths:
  - ".claude/skills/swarm/**"
---

# Agent Teams Usage Guide

Applies when working with the `/swarm` skill or Agent Teams feature.

## When to Use Agent Teams vs CE Sub-Agents

**Agent Teams add value when:**
- Large coordinated features where 3+ implementation streams need to agree on interfaces
- Research or review tasks where multiple independent perspectives improve quality
- Work that benefits from persistent teammate sessions with shared task boards

**CE sub-agents are sufficient for (most tasks):**
- Single-stream implementation (one issue at a time)
- Independent parallel work (no shared interfaces)
- Standard research, review, or code generation
- Any task where a single agent can hold all context

## Decision Matrix

| Situation | Tool | Why |
|-----------|------|-----|
| Single issue, clear approach | `issue-worker` | Minimal overhead, full context |
| Multiple independent issues from a plan | `/batch-work` | Parallel execution, no coordination needed |
| Coordinated multi-stream feature (shared interfaces) | `/swarm implement` | Architect designs contracts, workers implement in parallel |
| Multi-perspective code review | `/swarm review` | Security + TypeScript + simplicity in parallel |
| External + internal research | `/swarm research` | Best practices + codebase patterns in parallel |

## Team Size Guidelines

- **Research:** 2-3 agents (one external, one internal, optionally one domain-specific)
- **Implementation:** 3-4 agents (one architect + 2-3 workers). Max 4.
- **Review:** 2-3 agents (each with a different review focus)

**Start small.** 3 focused teammates outperform 5 scattered ones. Each teammate should have 5-6 well-defined tasks.

## Task Sizing

Aim for **5-6 tasks per teammate** with clear file ownership boundaries. Tasks should be:
- Independently testable (each passes `ci:check` alone)
- Non-overlapping in file ownership (no two workers editing the same file)
- Completable in a single session (~30-60 minutes each)

## Known Limitations

- **No session resume:** If a teammate crashes, you cannot resume their session. Re-launch with remaining tasks.
- **Task status lag:** The shared task board may not reflect real-time progress. Check worktree status directly.
- **One team per session:** Cannot run multiple swarms concurrently. Finish or clean up before starting another.
- **No nested teams:** A teammate cannot spawn its own team. Use flat team structures only.
- **Shutdown can be slow:** Teammates may take 30-60 seconds to wind down after completion.
- **Terminal requirements:** Split panes require tmux or iTerm2. VS Code terminal does not support Agent Teams split view.

## Coordination Best Practices

1. **Assign file ownership per teammate** — no two workers should edit the same file
2. **Use delegate mode on the lead** — the lead coordinates, workers execute
3. **Require architect plan approval** for implementation swarms — never skip this gate
4. **Define interface contracts first** — workers code to contracts, not to each other's implementations
5. **Workers report to leader only** — no direct worker-to-worker communication

## Cleanup Procedures

### Normal Cleanup
After a swarm completes:
1. The lead agent handles cleanup automatically
2. Verify: `ls ~/.claude/teams/ 2>/dev/null` should be empty
3. Verify: no orphaned worktrees with `git worktree list`

### Emergency Cleanup
If a swarm crashes, hangs, or leaves stale state:

```bash
# Kill the tmux session if running
tmux kill-session -t claude-swarm 2>/dev/null

# Remove team and task state
rm -rf ~/.claude/teams/<team-name> ~/.claude/tasks/<team-name>

# Or clean all teams
rm -rf ~/.claude/teams/* ~/.claude/tasks/*

# Check for orphaned worktrees
git worktree list
git worktree remove <path>  # for any orphaned worktrees
```

## Rollback (Disabling Agent Teams)

To fully disable:

1. Remove the env var from `.claude/settings.json`:
   ```json
   {
     "env": {}
   }
   ```
2. Optionally delete the skill: `rm -rf .claude/skills/swarm/`
3. Optionally delete this rules file: `rm .claude/rules/agent-teams.md`

The feature flag is the only requirement. Without it, the `/swarm` skill's pre-flight check will abort before spawning any agents.
