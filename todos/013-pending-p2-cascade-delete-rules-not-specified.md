---
status: pending
priority: p2
issue_id: "013"
tags: [code-review, database, architecture, data-integrity]
dependencies: ["006"]
---

# P2 — Cascade Delete Rules Not Specified for Business Child Models

## Problem Statement

The plan adds `Business → BusinessMember`, `Business → SocialAccount`, `Business → Post`, and `Business → ContentStrategy` relations but does not specify `onDelete` behavior for any of them. Prisma defaults to `Restrict` for required FK fields — meaning `DELETE /api/businesses/[id]` will fail with a foreign key violation at runtime unless the plan explicitly specifies cascade behavior.

Additionally: if `onDelete: Cascade` is used for `SocialAccount → Post`, deleting a social account also deletes all published historical posts and their metrics permanently.

## Findings

- Source: architecture-strategist (Finding 5), data-integrity-guardian
- Current schema has `onDelete: Cascade` on `User → Account`, `User → Session`, `User → SocialAccount`, `SocialAccount → Post` — these are explicit. New models have none.
- The plan mentions "delete + cascade (owner only)" for business deletion but doesn't specify schema-level cascades

## Proposed Solutions

### Option A — Explicit cascades with historical post preservation (Recommended)
```prisma
model BusinessMember {
  business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model SocialAccount {
  business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
}

model ContentStrategy {
  business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
}

// Post: preserve historical records when SocialAccount is deleted
model Post {
  business      Business       @relation(fields: [businessId], references: [id], onDelete: Cascade)
  socialAccount SocialAccount? @relation(fields: [socialAccountId], references: [id], onDelete: SetNull)
  socialAccountId String?      // nullable — post survives account deletion
}
```

This means:
- Deleting a Business cascades to all its members, accounts, posts, and strategy
- Deleting a SocialAccount nullifies `Post.socialAccountId` but preserves the post record + metrics

**Pros:** Historical posts and metrics survive account disconnection. Business deletion is clean.
**Cons:** `Post.socialAccountId` must become nullable — schema change needed.
**Effort:** Small | **Risk:** Low

### Option B — Cascade everything including posts on account deletion
```prisma
model Post {
  socialAccount SocialAccount @relation(onDelete: Cascade)
}
```

Simpler but loses all historical data when any account is disconnected.

**Effort:** Tiny | **Risk:** High (data loss)

## Recommended Action

Option A — make `Post.socialAccountId` nullable so account deletion preserves historical posts. Document that Business deletion is destructive (all posts deleted).

## Technical Details

- **Affected files:** `prisma/schema.prisma`, Phase 1 migration
- **Plan phase:** Phase 1

## Acceptance Criteria

- [ ] `BusinessMember`, `SocialAccount`, `ContentStrategy` have `onDelete: Cascade` to `Business`
- [ ] `Post` has `onDelete: Cascade` to `Business` (whole workspace deleted)
- [ ] `Post.socialAccountId` is nullable (`String?`) with `onDelete: SetNull` to `SocialAccount`
- [ ] Business deletion via API removes all child records without FK constraint errors
- [ ] Account deletion sets `Post.socialAccountId = null` (preserves post history)
- [ ] Test: delete business → all related records gone; delete account → posts remain with null socialAccountId

## Work Log

- 2026-03-07: Identified by architecture-strategist (Finding 5) during plan review
