---
status: complete
priority: p2
issue_id: "015"
tags: [code-review, testing, coverage]
dependencies: []
---

# P2 — Missing Test Files for Blotato Callback, Posts Ownership Check, and Approve/Reject Path

## Problem Statement

Three test files are absent from the plan's new files list but are required to meet the 75% branch coverage threshold enforced in CI:

1. `src/__tests__/api/connect/blotato-callback.test.ts` — plan says "mirror twitter-callback.test.ts" but the file isn't listed
2. `src/__tests__/api/posts.test.ts` update — Phase 9 adds a cross-workspace ownership check to `POST /api/posts` but the existing test file isn't listed for update
3. `PATCH /api/posts/[id]` approve/reject test — Phase 10 adds atomic `updateMany` claim; no test exists or is listed

## Findings

- Source: code-simplicity-reviewer (Findings 1, 2, 3)
- The blotato callback has three distinct branches: missing state cookie, state mismatch, account_claimed collision, happy path upsert — all must be covered for the 75% branch threshold
- The `updateMany` CAS and 409 response path in the approve route are critical correctness paths with no test coverage

## Proposed Solutions

### Add to Phase 4 new files:
- `src/__tests__/api/connect/blotato-callback.test.ts`
  - Test: missing state cookie → redirect with error
  - Test: state mismatch → redirect with error
  - Test: account already claimed by another business (after unique constraint) → 409
  - Test: valid callback → SocialAccount upserted

### Update in Phase 9:
- `src/__tests__/api/posts.test.ts`
  - Add: `POST /api/posts` with `socialAccountId` belonging to different business → 403
  - Add: valid post creation with correct `businessId` ownership

### Add to Phase 10 new files:
- `src/__tests__/api/posts/[id]/review.test.ts`
  - Test: approve → `updateMany` claims post, sets SCHEDULED (or PUBLISHING → see todo-012)
  - Test: approve on already-processed post → 409
  - Test: non-member cannot approve → 404
  - Test: reject → sets DRAFT

**Effort:** Medium | **Risk:** Low

## Recommended Action

Add all three test files to the plan's new files list and acceptance criteria. Write them during the corresponding implementation phases.

## Technical Details

- **Affected files:** New test files as listed above
- **Plan phases:** Phase 4, Phase 9, Phase 10

## Acceptance Criteria

- [ ] `blotato-callback.test.ts` covers all 4 branches (missing cookie, state mismatch, claimed, happy path)
- [ ] `posts.test.ts` updated for cross-workspace ownership check
- [ ] `[id]/review.test.ts` covers atomic claim, 409 on double-approve, non-member 404, reject
- [ ] CI branch coverage remains ≥75% after M1 implementation

## Work Log

- 2026-03-07: Identified by code-simplicity-reviewer (Findings 1, 2, 3) during plan review
