# Brainstorm Approval Gate

Applies when working with plans that originated from brainstorm documents.

## Detection

A plan has brainstorm origin if its YAML frontmatter contains:

```yaml
origin: docs/brainstorms/<filename>.md
```

Check the first 10 lines of any plan file in `docs/plans/` for this pattern.

## Rule

**Brainstorm-originated plans MUST NOT be executed directly with `/ce:work`.** They require human approval first.

### Why

Brainstorms explore possibilities — they may contain speculative ideas, multiple approaches, or scope that hasn't been validated. Converting a brainstorm plan directly to work without human review risks implementing the wrong thing or over-building.

### Correct Workflow

1. **Brainstorm** → `/ce:brainstorm` produces `docs/brainstorms/<slug>.md`
2. **Plan** → `/ce:plan` produces `docs/plans/<date>-<slug>-plan.md` with `origin: docs/brainstorms/...`
3. **Create Issue** → use `/create-issue` to create a GitHub issue from the plan
4. **Human Approval** → wait for the human to review and approve via `/go`
5. **Work** → only after approval, execute with `/ce:work`

### What NOT to Do

- ❌ `/ce:brainstorm` → `/ce:plan` → `/ce:work` (skips human approval)
- ❌ Removing the `origin:` field to bypass the gate
- ❌ Suggesting "Start `/ce:work`" as an option for brainstorm plans

### What's Allowed

- ✅ Direct `/ce:plan` → `/ce:work` for plans that did NOT originate from a brainstorm (no `origin: docs/brainstorms/...` field)
- ✅ `/ce:work` on any plan after human approval via `/go`

## Enforcement

This rule is enforced at three levels:

1. **CLAUDE.md Hard Rule** — instructs the agent to always use `/create-issue` for brainstorm plans
2. **This contextual rule** — provides detailed guidance when working with plans
3. **PreToolUse hook** (`.claude/hooks/block-brainstorm-work.sh`) — blocks `/ce:work` invocations when the target plan has brainstorm origin
