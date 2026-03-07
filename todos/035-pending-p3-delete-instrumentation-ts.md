---
status: complete
priority: p3
issue_id: "035"
tags: [code-review, cleanup, lambda]
dependencies: []
---

# `instrumentation.ts` is an empty stub — should be deleted, not emptied

## Problem Statement

`src/instrumentation.ts` was kept but its body was emptied (exports a `register()` no-op with a comment). Next.js only loads the instrumentation hook if the file exists — keeping an empty file means Next.js still imports and calls `register()` on every cold start for zero effect. The comment explaining the migration belongs in a commit message or PR description, not in a live source file.

## Findings

- **File:** `src/instrumentation.ts` — exports `register()` that does nothing
- Next.js instrumentation hook runs on every Lambda cold start if the file exists
- CLAUDE.md section on Scheduler says: "EventBridge owns scheduling now" — the explanation is already in docs
- Confirmed by: Code Simplicity Reviewer

## Proposed Solutions

### Option A: Delete the file (Recommended)
- `git rm src/instrumentation.ts`
- Pros: No dead code; Next.js does not load the hook; honest codebase
- Effort: Tiny | Risk: None

### Option B: Keep with comment
- Current state — keeps the file as documentation
- Cons: Live code that is a no-op; slightly misleading
- Effort: None

## Recommended Action

Option A — delete it.

## Technical Details

- **Affected files:** `src/instrumentation.ts`
- Check if any tests import this file before deleting

## Acceptance Criteria

- [ ] `src/instrumentation.ts` deleted
- [ ] No TypeScript errors after deletion
- [ ] Build succeeds

## Work Log

- 2026-03-06: Identified by Code Simplicity Reviewer during AWS migration PR review.

## Resources

- PR #2: feat/aws-sst-migration
