# Autonomous Engineering Audit — Improvement Plan

**Date:** 2026-03-16
**Source:** Comprehensive audit against compound engineering, Ralph loop, Boris Cherny, and multi-agent orchestration best practices.
**Maturity Level:** Level 4 (AI as Teammate), bordering Level 5

## Current Assessment

**Strengths (no action needed):**
- Full compound engineering loop: brainstorm → plan → decompose → execute → review → compound
- Production-grade issue daemon (`scripts/issue-daemon.sh`, 1532 lines) with priority polling, heartbeat monitoring, circuit breaker, conflict resolution
- 5 purpose-built agents + 14+ compound-engineering review agents
- GitHub Actions orchestration (approve → execute → auto-merge → unblock → close-plans)
- Self-improvement mechanisms (journaling, capped issue creation, solution docs)
- Safety guardrails (PreToolUse blocking, Stop completion verifier, excluded files)

---

## Quick Wins (Week 1 — ~2 hours total)

### 1. Clean up 334 stale worktrees
**Time:** 30 min | **Impact:** Disk space, git performance, branch lock prevention

```bash
# Preview what will be removed
git worktree list | wc -l

# Prune worktrees whose directories no longer exist
git worktree prune

# Remove remaining stale worktrees (those that still exist on disk but are done)
# Review the list first, then bulk remove:
git worktree list --porcelain | grep "^worktree " | grep ".claude/worktrees/" | cut -d' ' -f2 | while read w; do
  BRANCH=$(git -C "$w" branch --show-current 2>/dev/null)
  # Check if branch has been merged or PR closed
  echo "$w → $BRANCH"
done
```

### 2. Add auto-formatter PostToolUse hook
**Time:** 15 min | **Impact:** Eliminates format-related lint failures, saves ~1 iteration per agent run

Add to `.claude/settings.json` hooks section:
```json
"PostToolUse": [
  {
    "matcher": "Write|Edit",
    "hooks": [
      {
        "type": "command",
        "command": "bash -c 'FILE=$(echo \"$TOOL_INPUT\" | jq -r \".file_path // empty\"); if [[ -n \"$FILE\" && \"$FILE\" =~ \\.(ts|tsx|js|jsx|json|css)$ ]]; then npx prettier --write \"$FILE\" 2>/dev/null; fi'",
        "timeout": 10
      }
    ]
  }
]
```

### 3. Slim down CLAUDE.md
**Time:** 30 min | **Impact:** Reduces token cost on every API call across all agents (~1K tokens saved)

Move the "Architecture" section to `.claude/rules/architecture.md` with path matcher:
```yaml
---
paths:
  - "src/**"
  - "sst.config.ts"
  - "prisma/**"
---
```

Remove the "Testing" and "Deployment" detail sections (already fully covered in their respective rules files). Replace with one-line pointers.

Target: CLAUDE.md from 101 lines → ~60 lines, from ~2,800 tokens → ~1,800 tokens.

### 4. Add worktree hygiene to Stop hook
**Time:** 15 min | **Impact:** Prevents worktree accumulation from recurring

Add to `hygiene-check.sh`:
```bash
WORKTREE_COUNT=$(git worktree list 2>/dev/null | wc -l | tr -d ' ')
if [[ $WORKTREE_COUNT -gt 20 ]]; then
  echo "⚠️  $WORKTREE_COUNT worktrees active. Run: git worktree prune" >&2
fi
```

---

## Half-Day Improvements (Week 2)

### 5. Consolidate workflow handbook
**Time:** Half-day | **Impact:** Reduces agent cognitive overhead, single reference for workflow decisions

Create `.claude/rules/workflow-handbook.md` that consolidates the decision tree:
- Task intake → complexity assessment → execution mode selection
- When to brainstorm vs. plan vs. just do it
- Agent selection matrix (which agents for which tasks)
- Review depth by complexity tier
- Compound/solution doc triggers

Keep domain-specific rules files (testing, deployment, security) separate. The handbook is about *how work flows*, not domain knowledge.

### 6. Add /metrics skill for agent effectiveness
**Time:** Half-day | **Impact:** Data-driven agent improvement, visibility into what's working

Create `.claude/skills/metrics/SKILL.md` that queries GitHub for:
- PRs created by agents (merged vs. closed without merge)
- Issues labeled `claude-blocked` (failure rate)
- Issues labeled `claude-done` (success rate)
- Average time from `claude-wip` to PR creation
- Self-improvement issues created vs. acted on
- Worktree count trend

Output as a formatted dashboard. Track over time in `docs/metrics/` markdown files.

### 7. Docker sandbox for autonomous execution
**Time:** Half-day | **Impact:** Limits blast radius for overnight/unattended runs

Create a `Dockerfile.agent` that:
- Installs Node.js 22, git, Claude CLI
- Mounts the repo as a volume (read-only base, writable worktree overlay)
- Sets resource limits (CPU, memory, disk)
- Runs the issue-daemon inside the container
- Exposes daemon-status via a simple HTTP endpoint

Start with a single-worker container. Scale to multi-worker later.

---

## Future Endeavors (Week 3+)

### 8. Structured error recovery taxonomy in issue-worker
**Time:** Half-day | **Impact:** Reduces `claude-blocked` rate by handling common failures intelligently

Add error categorization: CI failure → read output → fix → retry; type error → run tsc → fix; test failure → analyze if test or implementation is wrong; timeout → save WIP.

### 9. Extract agent framework to standalone repo
**Time:** Multi-day | **Impact:** Reusable across projects, independent version control

**What to extract (project-agnostic):**
- `scripts/issue-daemon.sh` + `scripts/lib/daemon-state.sh` + `scripts/daemon-status.sh`
- `.claude/agents/issue-worker.md`, `plan-writer.md`, `plan-executor.md`, `bug-investigator.md`, `conflict-resolver.md`
- `.claude/skills/` (create-issue, batch-work, status, preflight, complexity-router, swarm)
- `.claude/hooks/block-destructive.sh`, `hygiene-check.sh`
- `.github/workflows/` (issue-approve, auto-merge, unblock-dependents, close-completed-plans, finalize-wip)
- `.github/ISSUE_TEMPLATE/claude-task.yml`

**What stays project-specific:**
- CLAUDE.md content (architecture, commands, hard rules specific to this codebase)
- `.claude/rules/` (testing patterns, deployment config, design system, etc.)
- `docs/solutions/` (institutional knowledge)
- `.claude/skills/` (qa-audit, brainstorm-agent, pr-screenshots — project-specific)

**Approach:**
1. Create a new repo (e.g., `claude-agent-framework` or `autonomous-engineering-kit`)
2. Move project-agnostic files there
3. Use git submodule or a setup script to install into target projects
4. Template variables for project-specific values (repo name, test command, coverage thresholds)
5. Version with semver tags so projects can pin to stable releases

### 10. Overnight autonomous pipeline
**Time:** Multi-day | **Impact:** Level 5 transition — fully autonomous development cycles

Wire the daemon to run overnight with:
- Budget cap (e.g., $50/night)
- Priority queue from brainstorm agent's promoted items
- Morning summary report (what was done, what's pending review)
- Docker sandbox (from item 7) for safety

---

## Implementation Sequence (Compounding Order)

```
1. Worktree cleanup        → makes all agents faster immediately
2. Auto-formatter hook      → reduces iteration cycles per agent run
3. CLAUDE.md slim-down      → reduces token cost per API call
4. Hygiene hook             → prevents worktree recurrence
   ─── foundation set ───
5. Workflow handbook        → agents make better routing decisions
6. /metrics skill           → visibility into what to improve next
7. Docker sandbox           → safety for overnight runs
   ─── scaling ready ───
8. Error recovery taxonomy  → reduces blocked rate
9. Framework extraction     → reuse across projects
10. Overnight pipeline      → Level 5 autonomy
```

Each step compounds: clean environment → fewer wasted cycles → lower cost per run → data on what fails → fix failure modes → scale with confidence.
