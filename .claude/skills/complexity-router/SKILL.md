---
name: complexity-router
description: Assess task complexity and route to optimal execution mode (single session, sub-agents, or agent teams). Used automatically before implementation begins.
user-invocable: false
allowed-tools: Bash(gh *), Read, Glob, Grep
---

You are the complexity router. Assess the given issue and recommend the optimal execution mode.

## Input

You will receive a GitHub issue number. Read it:
```bash
gh issue view <number> --json title,body,labels
```

## Assessment Criteria

Evaluate these signals from the issue body:

| Signal | Single Session | Sub-agents (CE) | Agent Teams |
|--------|---------------|-----------------|-------------|
| Files to change | 1-3 | 3-8 | 8+ across layers |
| Work item dependencies | All sequential | Independent items | Items sharing interfaces |
| Inter-task communication needed | No | No | Yes |
| Complexity tier (from issue) | Trivial | Moderate | Complex |
| Estimated duration | <30 min | <60 min | >60 min |

## Decision Logic

1. **Read the issue body** — extract the `### Relevant Files` section, `### Acceptance Criteria`, `### Complexity Hint`, and `### Dependencies` sections.
2. **Count estimated files** from the `### Relevant Files` section.
3. **Check if the issue is part of a plan** — look for `<!-- PARENT_PLAN: #N -->` marker. If present, check the parent plan for sibling issues that could run in parallel.
4. **Apply routing rules:**
   - Single issue, ≤3 files, Trivial/Moderate complexity, clear approach → **single session** (default)
   - Part of a plan with 2+ independent sibling items, or 4-8 files → **sub-agents via `/batch-work`**
   - Plan has 3+ items sharing interfaces, or 8+ files across layers, or issue explicitly mentions "coordinate" → **agent teams** (if enabled)

5. **Agent Teams fallback:** Agent Teams routing only activates if `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set. Without it, fall back to sub-agents for complex work.

## Output

Post a comment on the issue with the recommendation:

```bash
gh issue comment <number> --body "<!-- complexity-route -->
**Complexity assessment:** <Trivial|Moderate|Complex>
**Recommended execution mode:** <single-session|sub-agents|agent-teams>
**Reasoning:** <1-2 sentences explaining the routing decision>
**Files estimate:** <N files>
**Parallel siblings:** <N sibling issues that could run concurrently, or 'N/A'>"
```

## Rules

- **Do not implement anything.** You only assess and recommend.
- **Default to single session.** Only recommend sub-agents or agent teams when the signals clearly justify it.
- **Be conservative with agent teams.** The overhead of coordination only pays off for genuinely complex, multi-stream work.
- **Never recommend agent teams if the env var is not set.** Check with: `echo $CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`
