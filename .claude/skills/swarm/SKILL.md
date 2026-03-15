---
name: swarm
description: Launch a coordinated agent team for research, implementation, or review work. Accepts a task type and description.
argument-hint: <research|implement|review> <task description or plan issue number>
disable-model-invocation: true
allowed-tools: Bash, Agent, Read, Glob, Grep
---

# Agent Teams — Coordinated Swarm

Launch a coordinated agent team with one of three presets. Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (set in `.claude/settings.json` env).

**Arguments:** `$ARGUMENTS` — `<preset> <task description or plan issue number>`

## Pre-Flight Validation (All Presets)

Before spawning any agents, run these checks:

1. **Env var check:** Verify `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is set to `1`. If not, abort with: "Agent Teams not enabled. Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `.claude/settings.json` env."
2. **Stale team check:** Run `ls ~/.claude/teams/ 2>/dev/null`. If non-empty, warn: "Stale team detected. Clean up with emergency cleanup commands before starting a new team."
3. **Git cleanliness:** Run `git status --short`. If dirty, warn: "Uncommitted changes detected. Commit or stash before starting a team."
4. **Parse arguments:** Extract preset name and task description from `$ARGUMENTS`.

## Presets

### 1. Research Swarm (2 agents)

**When to use:** Gathering external best practices and internal codebase patterns for a feature or decision.

**Cost estimate:** ~$5-10 (haiku model, 2 agents, short sessions)

**Team composition:**
- `researcher-1`: `best-practices-researcher` subagent — external docs, framework patterns, community conventions
- `researcher-2`: `repo-research-analyst` subagent — internal codebase patterns, `docs/solutions/`, existing conventions

**Model:** haiku (Explore-class work, cost-effective)

**Execution:**
1. Parse the task description
2. Launch both agents in parallel with `run_in_background: true`:
   - researcher-1 prompt: "Research external best practices for: <task>. Find official documentation, community patterns, and implementation examples. Return a structured brief."
   - researcher-2 prompt: "Research internal codebase patterns for: <task>. Search docs/solutions/, existing implementations, and conventions. Return a structured brief."
3. Wait for both to complete
4. Synthesize findings into a unified research brief

### 2. Implementation Swarm (3-4 agents, with plan approval gate)

**When to use:** Coordinated multi-stream feature where 3+ implementation streams need to agree on interfaces.

**Cost estimate:** ~$15-40 (sonnet model, 3-4 agents, longer sessions)

**Team composition:**
- `architect`: Plan subagent — designs interface contracts and file ownership boundaries
- `worker-1`, `worker-2` (optionally `worker-3`): general-purpose — claim tasks from the architect's plan

**Model:** sonnet for all agents

**Execution:**
1. Run pre-flight validation
2. Launch `architect` agent:
   - Prompt: "Design an implementation plan for: <task>. Define interface contracts, file ownership per worker, and a task list with 5-6 tasks per teammate. Output a structured plan with clear boundaries."
   - **GATE:** Present the architect's plan to the user. Do NOT proceed until the user approves.
3. After approval, launch worker agents in parallel with `isolation: "worktree"`:
   - Each worker prompt includes:
     - The approved plan section relevant to their assigned tasks
     - CLAUDE.md hard rules
     - TDD protocol: write tests first, then implementation
     - File ownership boundaries: "You own files X, Y, Z. Do not modify files outside your ownership."
4. Wait for all workers to complete
5. Report status table: agent name, assigned tasks, completion status, worktree path

### 3. Review Swarm (3 agents)

**When to use:** Multi-perspective code review where security, type safety, and simplicity all matter.

**Cost estimate:** ~$5-15 (sonnet model, 3 agents, focused review sessions)

**Team composition:**
- `security`: `security-sentinel` subagent
- `typescript`: `kieran-typescript-reviewer` subagent
- `simplicity`: `code-simplicity-reviewer` subagent

**Model:** sonnet for all agents

**Execution:**
1. Generate the diff: `git diff origin/main...HEAD`
2. Launch all 3 review agents in parallel:
   - Each receives the branch diff and the task context
   - Each returns structured findings
3. Wait for all to complete
4. Synthesize and deduplicate findings into a unified review report
5. Group by severity: Critical > High > Medium > Low

## Shutdown Sequence

After all agents complete (or on abort):

1. Request shutdown of all active agents
2. Wait for agent completion confirmation
3. Verify team directory is cleaned up: `ls ~/.claude/teams/ 2>/dev/null`
4. If cleanup incomplete, run emergency cleanup (see below)

## Emergency Cleanup

If a swarm crashes or hangs:

```bash
tmux kill-session -t claude-swarm 2>/dev/null
rm -rf ~/.claude/teams/<team-name> ~/.claude/tasks/<team-name>
```

Replace `<team-name>` with the actual team name, or use `*` to clean all:

```bash
rm -rf ~/.claude/teams/* ~/.claude/tasks/*
```

## Anti-Patterns

**Do not do these:**

- **Single-stream swarms:** If work is sequential or fits in one session, use `issue-worker` directly. Swarms add overhead.
- **Worker broadcasting:** Workers report to the leader only. Never have workers communicate directly with each other.
- **Spawning without a task list:** Workers without a defined task list will explore aimlessly and burn tokens. Always have the architect create a plan first.
- **Skipping the architect gate:** For implementation swarms, the architect's plan MUST be approved before workers start. Unapproved plans lead to wasted parallel work.
- **Nesting swarms:** Never launch a swarm from within a swarm. Never mix `/swarm` with `/batch-work` in the same session. One team per session.

## Disabling Agent Teams

To disable, remove the env var from `.claude/settings.json`:

```json
{
  "env": {}
}
```

No other cleanup needed — the skill and rules file are inert without the feature flag.
