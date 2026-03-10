---
status: closed
priority: p2
issue_id: "043"
tags: [code-review, typescript, quality, fulfillment-engine]
dependencies: []
---

# Duplicate ReviewPost Interface

## Problem Statement

The `ReviewPost` interface is defined identically in `review-queue-client.tsx` (lines 9-19) and `ReviewCard.tsx` (lines 17-27). When the shape changes, having two copies will cause a drift bug.

Additionally, the `status` field is typed as `string` instead of a proper union/enum, and `scheduledAt` uses `Date | string | null` when only `string | null` arrives over the wire from RSC serialization.

## Proposed Solutions

Extract to a shared types file or export from one component and import in the other. Type `status` as a string literal union and `scheduledAt` as `string | null`.

- Effort: Small

## Work Log

- 2026-03-08: Created from code review
