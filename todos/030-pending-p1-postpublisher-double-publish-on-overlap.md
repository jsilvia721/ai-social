---
status: complete
priority: p1
issue_id: "030"
tags: [code-review, architecture, lambda, scheduler, correctness]
dependencies: []
---

# PostPublisher Lambda has no concurrency guard — overlapping invocations double-publish posts

## Problem Statement

EventBridge fires the `PostPublisher` Lambda every 60 seconds regardless of whether the previous invocation is still running. The Lambda timeout is 55 seconds. This means a previous invocation can still be alive when the next fires. Both invocations query `status = 'SCHEDULED' AND scheduledAt <= now`, receive the same due posts, and publish each one twice to the social platform. The DB `status = 'PUBLISHED'` update happens only after the external API call succeeds, so neither invocation can see the other's in-progress work.

On Railway with node-cron, this was safe because the scheduler ran in a single process with a module-level `cronStarted` flag. On Lambda, each invocation is a separate process with no shared state.

At 1-minute rate and 55-second timeout, overlap probability is high whenever any post publish is slow (e.g., a video upload to Twitter).

## Findings

- **File:** `src/lib/scheduler.ts:27-33` — `findMany` with no atomic claim or lock
  ```typescript
  const duePosts = await prisma.post.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now } },
  });
  ```
- **File:** `src/cron/publish.ts` — Lambda handler, no concurrency control
- **File:** `sst.config.ts:68-75` — no `reservedConcurrency: 1` set
- Confirmed by: Performance Oracle

## Proposed Solutions

### Option A: Atomic row-level claim via UPDATE ... RETURNING (Recommended)
Replace the `findMany` with an atomic `UPDATE ... WHERE status='SCHEDULED' AND scheduledAt<=now RETURNING *` inside a transaction. This atomically claims rows and prevents any concurrent invocation from seeing the same posts:

```typescript
const duePosts = await prisma.$transaction(async (tx) => {
  const posts = await tx.post.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now } },
    // select for update
  });
  if (posts.length === 0) return [];
  await tx.post.updateMany({
    where: { id: { in: posts.map(p => p.id) }, status: "SCHEDULED" },
    data: { status: "PROCESSING" }, // intermediate status
  });
  return posts;
});
```
- Requires adding a `PROCESSING` status to the schema
- Pros: Correct even with unlimited Lambda concurrency
- Effort: Medium | Risk: Low

### Option B: Lambda reserved concurrency = 1
- Set `reservedConcurrency: 1` on the PostPublisher Lambda in sst.config.ts
- Only one invocation runs at a time; EventBridge invocation is throttled if one is running
- Pros: Zero schema change; simple
- Cons: Throttled invocations are retried by EventBridge (up to 185 times over 24h) — if a run consistently takes >60s, backlog builds. Also, throttled invocations count as errors.
- Effort: Tiny | Risk: Low

### Option C: Increase EventBridge interval to 2 minutes, reduce timeout to 50s
- Creates a 10-second gap between max execution and next invocation
- Pros: No code change
- Cons: Posts can be published up to 2 minutes late; doesn't fundamentally solve the race
- Effort: Tiny | Risk: Medium

## Recommended Action

Option B immediately (one-line change in sst.config.ts). Option A as a follow-up for correctness at scale.

## Technical Details

- **Affected files:** `sst.config.ts`, `src/lib/scheduler.ts`, `prisma/schema.prisma` (if adding PROCESSING status)
- SST: `job: { ..., concurrency: 1 }` or `transform.function.reservedConcurrentExecutions: 1`

## Acceptance Criteria

- [ ] Concurrent PostPublisher invocations cannot publish the same post twice
- [ ] Verified by: checking platform for duplicate posts after a simulated slow publish
- [ ] Either: reserved concurrency = 1 set, OR atomic claim implemented in scheduler

## Work Log

- 2026-03-06: Identified by Performance Oracle during AWS migration PR review. P1 — blocks merge.

## Resources

- PR #2: feat/aws-sst-migration
