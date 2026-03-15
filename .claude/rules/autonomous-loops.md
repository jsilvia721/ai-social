---
# Always-loaded: no paths filter — applies to all autonomous loop usage
---

# Autonomous Loops (Ralph Wiggum)

Guidance for using autonomous loop plugins (e.g., Ralph Wiggum) that run Claude Code iteratively without human intervention.

## When to Use

Autonomous loops excel at **mechanical tasks with verifiable completion criteria**:

- Bug fixes with a failing test (loop runs until test passes)
- TDD feature implementation (write specs first, loop implements until green)
- Refactoring with existing test coverage as the safety net
- Bulk code changes following a consistent pattern (e.g., migrate 20 files to a new API)
- Lint/type-error cleanup where `ci:check` is the exit condition

## When NOT to Use

Do not use autonomous loops for:

- **Architectural decisions** — loops optimize for "make it pass," not "make it right"
- **Security-sensitive changes** — auth, encryption, access control require human judgment
- **UI/UX work** — visual quality can't be verified by a test suite alone
- **Ambiguous requirements** — if the task isn't precisely defined, the loop will invent its own interpretation
- **Schema migrations** — require careful human review of data implications
- **First-time patterns** — if no existing code shows the pattern, plan it in conversation first

## Prerequisite: Tier 1 Hooks

**Autonomous loops should only be used with Tier 1 pre-push hooks active.** These hooks run `npm run ci:check` (lint + typecheck + coverage) before any push, preventing the loop from pushing broken code. Without hooks, a loop can silently push regressions.

Verify hooks are installed:
```bash
test -f .git/hooks/pre-push && echo "hooks installed" || echo "MISSING — install before using loops"
```

## Optimal Iteration Counts

| Task Type | Iterations | Rationale |
|-----------|-----------|-----------|
| Bug fix (failing test exists) | 15–20 | Focused scope, clear exit condition |
| Feature implementation (TDD) | 40–50 | Needs test writing + implementation + edge cases |
| Refactor with tests | 20–25 | Tests constrain scope, but touch many files |
| Bulk pattern migration | 20–30 | Repetitive but each file may have quirks |

Start with the lower bound. If the loop completes early, that's ideal. If it hits the cap, review what's left before adding more iterations.

## Two-Phase Workflow (Recommended)

### Phase 1: Plan in Conversation

Use a normal Claude Code conversation to:

1. Explore the problem space and understand requirements
2. Create a concrete plan (checklist of steps, files to modify, test strategy)
3. Write the plan to a file or issue comment

### Phase 2: Autonomous Execution

Feed the loop **only the plan** — not the original ambiguous request:

```
Ralph prompt: "Follow the plan in docs/plans/<plan-file>.md exactly.
Run npm run ci:check after each logical change.
Stop when all checklist items are complete and ci:check passes."
```

This separation prevents the loop from re-interpreting requirements and keeps it focused on mechanical execution.

## Prompt Best Practices

Write prompts with **measurable exit criteria** and **explicit constraints**:

- **Measurable criteria:** "All tests in `src/__tests__/api/posts.test.ts` pass" — not "fix the posts API"
- **Explicit constraints:** "Do not modify files outside `src/lib/blotato/`" — prevents scope creep
- **TDD-first:** "Write the test first, verify it fails, then implement" — matches project convention
- **XML completion promise:** Include a clear done condition the loop can recognize:
  ```
  When ci:check passes and all acceptance criteria are met,
  commit with message "feat: <description>" and stop.
  ```
- **Reference existing patterns:** "Follow the pattern in `src/app/api/posts/route.ts`" — reduces invention
- **Cap file changes:** "This should touch at most 3 files" — prevents runaway refactors

## Cost Expectations

| Model | Approximate Cost | Notes |
|-------|-----------------|-------|
| Sonnet | ~$10/hr | Good default for mechanical tasks |
| Opus | ~$30/hr | Use only for complex reasoning tasks |

**Per-session estimates:**
- 20-iteration Sonnet session: $15–30
- 50-iteration Sonnet session: $30–60

Monitor costs in the Claude Code dashboard. If a loop is burning through iterations without progress, stop it early — the problem likely needs human decomposition.

## Human Review Checklist

After every autonomous loop session, verify:

- [ ] **Git log** — review all commits the loop made (`git log --oneline origin/main..HEAD`)
- [ ] **ci:check** — run `npm run ci:check` yourself (don't trust the loop's claim)
- [ ] **Diff review** — read the full diff (`git diff origin/main...HEAD`), looking for:
  - Unnecessary file changes or scope creep
  - Suppressed lint rules or skipped tests
  - Hardcoded values that should be configurable
  - Removed code that shouldn't have been removed
- [ ] **Visual check** — if UI was touched, open the page in a browser
- [ ] **Regression check** — run the full test suite, not just the files the loop touched

## Common Failure Modes

### Loop never ends
**Symptom:** Hits iteration cap without completing.
**Cause:** Ambiguous exit criteria or a bug the loop can't solve.
**Fix:** Stop, review progress, refine the prompt or solve the blocker manually.

### Loop ends too early
**Symptom:** Claims completion but acceptance criteria aren't met.
**Cause:** Prompt didn't include all criteria, or criteria aren't machine-verifiable.
**Fix:** Add explicit verification commands to the prompt (e.g., "run this test and confirm output").

### Quality degrades over iterations
**Symptom:** Later commits introduce hacks, suppress warnings, or skip edge cases.
**Cause:** The loop is "trying harder" to meet criteria by cutting corners.
**Fix:** Review at the midpoint. If quality is dropping, stop and reassess the approach.

### Scope creep
**Symptom:** Loop modifies files outside the intended scope.
**Cause:** Prompt didn't constrain the file set.
**Fix:** Always include explicit file/directory constraints in the prompt.
