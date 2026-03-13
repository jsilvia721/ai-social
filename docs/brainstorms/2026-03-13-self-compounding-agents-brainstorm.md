# Self-Compounding Agents

**Date:** 2026-03-13
**Status:** Brainstorm
**Next step:** `/ce:plan`

## What We're Building

A closed-loop learning system where the issue-worker agent journals its re-attempts, workarounds, and discoveries during implementation work. After completing a task, it reviews its journal and — when something significant surfaces — automatically creates a GitHub issue proposing improvements to project documentation, rules, or skills. These self-improvement issues go through human review before being executed by the same issue-worker pipeline.

This closes the compound engineering lifecycle: agents encounter friction, document it, propose fixes, humans approve, agents implement the fix, and future agents benefit.

## Why This Approach

**Prompt-native journaling** was chosen over a post-completion review agent because:
- The issue-worker already has full context about what went wrong
- No new infrastructure needed — just prompt additions to `issue-worker.md`
- Avoids the complexity of passing conversation transcripts to a separate agent
- Keeps the retrospective lightweight (mental journal, not a separate system)

**Hybrid issue format** balances speed and thoroughness:
- Most self-improvement learnings are simple (add a rule, document a pattern) — a lightweight template handles these efficiently
- Complex/architectural improvements escalate to the full `create-issue` skill for proper decomposition
- The agent already has deep context, so re-researching the codebase would be wasteful for simple fixes

## Key Decisions

### 1. Signal Scope: Broad
The journal captures more than just hard failures:
- **Re-attempts**: Something failed and had to be retried with a different approach
- **Workarounds**: Agent found an unexpected way around a problem (suggests missing docs)
- **Missing documentation**: Agent had to infer patterns not documented in CLAUDE.md/rules
- **Discovered patterns**: Agent found an undocumented convention by reading existing code
- **Hard failures**: Things that broke and required debugging

### 2. Pipeline Scope: Issue-Worker Only (for now)
- The issue-worker is where most implementation friction occurs
- Review sub-agents (kieran-typescript-reviewer, security-sentinel, etc.) are short-lived and focused — less likely to hit systemic issues
- Can expand to other agents later if the pattern proves valuable

### 3. Issue Format: Hybrid Template + Escalation
**Default (lightweight template):**
- What happened (the signal)
- Root cause analysis
- Proposed fix (which file to update, what to add/change)
- Category (rule, documentation, skill, config, code)

**Escalation to create-issue skill when:**
- The fix involves multiple files or architectural changes
- The agent can't determine a clear single-file fix
- The proposed change touches code (not just markdown)

### 4. Label: `claude-self-improvement`
- Follows the `claude-` prefix convention
- Descriptive of purpose
- Distinct from `claude-blocked` (stuck) — these are completed tasks with learnings

### 5. Approval Flow: Standard Pipeline Re-entry
- Human reviews `claude-self-improvement` issues on GitHub
- To approve: remove `claude-self-improvement`, add `claude-ready`
- Issue-worker picks it up like any normal task
- **Future enhancement (out of scope):** Thumbs-up reaction on any `needs-triage` issue triggers approval automatically — this would improve the entire pipeline UX, not just self-improvement

### 6. Fix Scope: Markdown Primarily, Code if Critical
Target files for self-improvement:
- **Primary:** `CLAUDE.md`, `.claude/rules/*.md`, `.claude/skills/*/SKILL.md`, `.claude/agents/*.md`, `docs/solutions/**/*.md`
- **Secondary (if critical):** Test helpers, CI config, shared utilities — only when the agent identifies something like a broken test helper or missing shared utility that caused repeated failures
- **Never:** Feature code, business logic, database schema

### 7. Integration Point: Issue-Worker Step 6.5
The journaling review happens between PR creation (step 5) and reporting back (step 6):
1. Steps 1-5 proceed as normal (assess, plan, implement, review, create PR)
2. **New step 6: Self-assessment** — review the journal, decide if any issues warrant creation
3. Step 7 (was 6): Report back — now also mentions any self-improvement issues created

## How It Works

### During Implementation (Steps 1-5)
The issue-worker maintains a mental journal. Whenever it encounters friction, it notes:
```
JOURNAL ENTRY:
- Signal type: [re-attempt | workaround | missing-docs | discovered-pattern | failure]
- What happened: <brief description>
- What I did instead: <the workaround or fix>
- What would have helped: <what documentation/rule/config would have prevented this>
```

This is prompt-level behavior — no files written, no external state. The agent simply keeps track as part of its reasoning.

### After PR Creation (New Step 6)
The agent reviews its accumulated journal entries and applies a significance filter:
- **Create an issue if:** The learning would prevent future agents from wasting time, the fix is actionable, and it's not already documented
- **Skip if:** The friction was task-specific (not generalizable), already documented somewhere, or too trivial to warrant an issue

For each significant entry, the agent creates a GitHub issue using the lightweight template:

```markdown
## Self-Improvement: <title>

**Signal type:** <re-attempt | workaround | missing-docs | discovered-pattern | failure>
**Triggered during:** #<original-issue-number>
**Severity:** <low | medium | high>

### What Happened
<Description of the friction encountered>

### Root Cause
<Why this happened — what's missing or wrong in project setup>

### Proposed Fix
**Target file:** `<path>`
**Change type:** <add-rule | update-docs | new-solution-doc | add-skill-guidance | fix-config>

<Specific description of what to add or change, with example content if possible>

### Category
<rule | documentation | skill | config | code>
```

Label: `claude-self-improvement`

If the proposed fix is complex (multi-file, architectural, or involves code), the agent escalates by invoking the `create-issue` skill instead of using the lightweight template.

### Human Review
The owner sees `claude-self-improvement` issues in GitHub. For each:
- **Approve:** Remove label, add `claude-ready` → issue-worker implements it
- **Reject:** Close the issue with a comment explaining why
- **Modify:** Edit the issue description, then approve

### Execution
Approved issues flow through the standard issue-worker pipeline:
1. Issue-worker picks up the `claude-ready` issue
2. Implements the fix (updating CLAUDE.md, adding a rule, writing a solution doc, etc.)
3. Creates a PR with tests (if applicable)
4. PR gets reviewed and merged
5. Future agents benefit from the improved documentation

## Future Enhancements (Out of Scope)

- **Thumbs-up reaction approval:** React with 👍 on any issue to trigger `claude-ready` — improves the entire pipeline UX
- **Expand to review agents:** Review sub-agents could surface patterns like "this codebase consistently lacks X"
- **Expand to all agents:** Any agent type could participate in self-compounding
- **Deduplication:** Before creating an issue, check if a similar self-improvement issue already exists
- **Metrics:** Track how many self-improvement issues are created, approved, and how they impact future agent success rates
- **Auto-categorization:** Automatically route self-improvement issues to the right docs/solutions/ category

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Too many low-value issues (noise) | Significance filter in the prompt; human review gate |
| Token overhead on every run | Journaling is mental/prompt-level, not file I/O; self-assessment is brief |
| Agent creates vague/unactionable issues | Template enforces specific target file and change type |
| Circular fixes (agent "improves" something that breaks other agents) | Human review gate; standard TDD pipeline catches regressions |
| Agent journals too aggressively, slowing implementation | Journaling is lightweight annotations, not detailed writeups |
