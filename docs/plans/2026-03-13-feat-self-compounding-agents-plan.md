---
title: "feat: Self-Compounding Agents"
type: feat
status: active
date: 2026-03-13
origin: docs/brainstorms/2026-03-13-self-compounding-agents-brainstorm.md
---

# Self-Compounding Agents

## Overview

Add a closed-loop learning system to the issue-worker agent. During implementation, the agent journals re-attempts, workarounds, missing documentation, discovered patterns, and failures. After completing work (or failing), it reviews the journal and creates GitHub issues labeled `claude-self-improvement` for significant learnings. These flow through human review and back into the standard issue-worker pipeline, closing the compound engineering lifecycle.

## Problem Statement / Motivation

When agents encounter friction — missing documentation, undocumented patterns, incorrect rules — the knowledge dies with the conversation. The same mistakes recur across separate issue-worker runs. The `docs/solutions/` system and `/ce:compound` workflow exist but require manual human invocation. This feature automates the discovery side, letting agents propose their own improvements while keeping humans in the approval loop.

(see brainstorm: docs/brainstorms/2026-03-13-self-compounding-agents-brainstorm.md)

## Proposed Solution

Three focused changes:

1. **Create `claude-self-improvement` label** on GitHub for the new issue category
2. **Modify `issue-worker.md`** to add journaling behavior and a self-assessment step
3. **Modify `create-issue` SKILL.md** to accept an optional label parameter for escalation of complex self-improvement issues

### Issue-Worker Changes (the core)

**Journaling (woven into Steps 1-5):** The agent maintains a mental journal. Whenever it encounters friction, it notes the signal type, what happened, what it did instead, and what would have helped. This is prompt-level — no files, no external state.

**Self-Assessment (new step, runs always):** After PR creation OR before `claude-blocked` labeling on failure, the agent reviews its journal and applies a significance filter:

- **Create issue if:** The learning would save future agents time, the fix is actionable, and it's not already documented in CLAUDE.md/rules/docs
- **Skip if:** Task-specific (not generalizable), already documented, too trivial, or transient (network flake, etc.)
- **Cap:** At most 3 self-improvement issues per run to prevent noise

**Lightweight template for direct issue creation:**
```markdown
## Objective
<What should be changed and why — framed as an actionable task>

## Context
Discovered while working on #<original-issue-number>.
<Description of the friction and what would have helped>

**Signal type:** <re-attempt | workaround | missing-docs | discovered-pattern | failure>
**Severity:** <low | medium | high>

## Proposed Change
**Target file:** `<path>`
**Change type:** <add-rule | update-docs | new-solution-doc | add-skill-guidance | fix-config | fix-code>

<Specific description with example content>

## Acceptance Criteria
- [ ] <Specific, verifiable criterion>
- [ ] <Another criterion>
```

**Escalation:** When the proposed fix is complex (multi-file, architectural, or code changes), the agent invokes the `create-issue` skill with a label override to produce a `claude-self-improvement` plan issue instead of the default `claude-plan-review`.

**Report-back update:** Step 6 (Report Back) adds a "Self-improvement" section listing any created issues.

### Create-Issue Skill Changes

Add an optional label parameter. When provided, the skill uses that label instead of the default `claude-plan-review`. This keeps the skill generic and reusable while supporting the self-improvement use case.

## Technical Considerations

- **Token budget:** Journal review is lightweight (scanning mental notes, creating 0-3 issues). The main risk is escalation via `create-issue` which does codebase research. In practice, most self-improvement issues will be simple (add a rule, document a pattern) and use the direct template.
- **Significance filter in prompt:** LLM-based judgment will vary between runs. The explicit criteria and 3-issue cap mitigate noise. Human review is the final gate.
- **Failure path:** Journal review as a "finally" block means even `claude-blocked` runs produce learnings. The review runs before the blocked label is applied, so the agent still has context.
- **No dedup in v1:** Accept that duplicate self-improvement issues may be created across runs. Human closes duplicates. Dedup is a future enhancement.
- **Originating PR dependency:** Self-improvement issues should note when they depend on the originating PR merging first (if they reference code from that PR).

## System-Wide Impact

- **Interaction graph:** Issue-worker creates issues via `gh issue create` → human reviews → adds `claude-ready` → daemon picks up → issue-worker implements. No new callbacks or middleware.
- **Error propagation:** If issue creation fails (GitHub API error), the worker logs it in the report-back comment but does not fail the overall run. The PR is already created.
- **State lifecycle:** No new database state. Labels on GitHub issues are the only state. No orphan risk.
- **API surface parity:** The `create-issue` skill gains an optional parameter but existing callers are unaffected (default behavior unchanged).

## Acceptance Criteria

- [ ] `claude-self-improvement` label exists on the GitHub repo
- [ ] Issue-worker prompt includes journaling instructions woven into Steps 1-5
- [ ] Issue-worker prompt includes self-assessment step that runs after PR creation AND on failure paths
- [ ] Self-assessment uses explicit significance filter criteria and 3-issue cap
- [ ] Lightweight template produces actionable issues with origin reference, proposed change, target file, and acceptance criteria
- [ ] Complex self-improvement escalates to `create-issue` skill with label override
- [ ] Report-back step mentions self-improvement issues created (or "none")
- [ ] `create-issue` skill accepts optional label parameter, defaults to `claude-plan-review` when not provided
- [ ] Existing `create-issue` behavior is unchanged when no label parameter is given

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| Noisy/low-value issues | Explicit significance criteria + 3-issue cap + human review gate |
| Token overhead | Journaling is mental; direct template creation is cheap; escalation is rare |
| Inconsistent filter across runs | Concrete rubric in prompt with examples of what qualifies vs. doesn't |
| Budget exhaustion before journal review | "Finally" block runs early; direct template is cheap (~100 tokens) |
| Duplicate issues across runs | Accept in v1; human closes duplicates; dedup is future enhancement |

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-13-self-compounding-agents-brainstorm.md](docs/brainstorms/2026-03-13-self-compounding-agents-brainstorm.md) — Key decisions: broad signal scope, prompt-native journaling, hybrid issue format, `claude-self-improvement` label, standard pipeline re-entry, markdown-primary fix scope
- **Issue-worker agent:** `.claude/agents/issue-worker.md` — primary modification target
- **Create-issue skill:** `.claude/skills/create-issue/SKILL.md` — add label parameter
- **Existing label automation:** `.github/workflows/approve-plan.yml`, `.github/workflows/unblock-dependents.yml`
- **Solution doc format:** `docs/solutions/` — reference for how compound docs are structured
