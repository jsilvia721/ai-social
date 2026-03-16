# Brainstorm: Attempt Ledger — Learning from Failed Fix Attempts

**Date:** 2026-03-16
**Status:** Draft
**Participants:** Josh, Claude

## Problem Statement

The autonomous development pipeline currently has no memory of failed fix attempts. When an agent completes work, CI passes, and a PR merges, the system considers the issue resolved. But sometimes the fix doesn't actually solve the user-facing problem — the agent just didn't test the right thing. When Josh comes back with the same problem (sometimes rephrased), the agent starts from scratch with no awareness that this is a retry, leading to:

- **Wasted cost** — paying for 3 attempts at the same fix
- **Repeated mistakes** — the agent may try the same insufficient approach again
- **No compounding** — failed attempts contain valuable signal about what *doesn't* work, but it's lost

Real example: social media post metrics not displaying in the UI — 3 separate attempts, none solved it.

## What We're Building

An **Attempt Ledger** system that:

1. **Records failed attempts** — when an issue is re-opened, the system automatically creates a structured record of what was tried, what changed (PR diffs), and the implicit reason it failed (the problem persists)
2. **Detects related attempts** — when the issue-worker picks up a new issue, it uses semantic similarity (LLM-based) to search for related failed attempts in the ledger before planning
3. **Forces differentiation** — if related attempts are found, the agent must produce a differentiation plan explaining: what was tried before, why it likely failed, and how this attempt will be different
4. **Compounds learning** — successful fixes of previously-failed problems get extra detail in docs/solutions/ explaining what the failed attempts missed

## Why This Approach

### Chosen: Attempt Ledger (Approach A)

Builds on the existing `docs/solutions/` infrastructure and the `learnings-researcher` subagent pattern. Adds a new category (`failed-attempts/`) with structured records that the agent searches during its planning phase.

**Why not Issue Genealogy (Approach B)?** Over-engineered for current scale. Embeddings store and similarity search infrastructure is heavy. The semantic matching can be done inline with an LLM call during the issue-worker's planning step.

**Why not Retrospective Gate (Approach C)?** File-based matching is too coarse — misses semantic connections between differently-described versions of the same problem. No persistent learning record.

## Key Decisions

1. **Failure signal: Issue re-open** — when a previously-closed issue is re-opened, this is the trigger to create a failed-attempt record. No new commands or labels needed. Natural to Josh's workflow.

2. **Matching: Semantic similarity via LLM** — at work time (when the issue-worker starts planning), it sends the new issue description to the LLM along with summaries of recent failed-attempt records and asks "are any of these related?" No embeddings store needed.

3. **Timing: Work time, not creation time** — the matching and context injection happens when the issue-worker picks up the issue, not when the issue is created. This keeps issue creation lightweight and puts the intelligence where it matters (the agent's planning phase).

4. **Storage: `docs/solutions/failed-attempts/`** — structured markdown files with YAML frontmatter following the existing solutions pattern. Each record includes: original issue, PR that attempted the fix, files changed, approach summary, and (when known) why it was insufficient.

5. **Differentiation requirement** — when related failed attempts are found, the agent must include a "Prior Attempts" section in its plan explaining what was tried and how its approach differs. This is a planning gate, not a blocking gate.

6. **Successful resolution compounds back** — when a fix finally works for a previously-failed problem, the compound step (docs/solutions/) explicitly references the failed attempts and documents what they missed.

## Design Details

### Failed Attempt Record Structure

```markdown
---
title: "Metrics not displaying in post detail UI"
date: 2026-03-16
original_issue: "#123"
attempted_pr: "#124"
files_changed:
  - src/components/PostMetrics.tsx
  - src/app/api/metrics/route.ts
approach_summary: "Added metrics fetch to post detail page"
failure_reason: "unknown — issue re-opened"
related_attempts:
  - docs/solutions/failed-attempts/metrics-display-attempt-1.md
status: failed
tags: [metrics, ui, post-detail]
---

## What Was Tried
[Auto-generated summary of the PR diff and approach]

## What Changed
[List of files modified with brief description of changes]

## Why It Likely Failed
[Initially "unknown — issue re-opened", updated if later attempts reveal the root cause]

## Lessons
[Populated after a successful fix resolves the underlying problem]
```

### Issue-Worker Integration Points

1. **New step after learnings-researcher** — "Attempt Ledger Search"
   - Summarize the current issue in 2-3 sentences
   - Search `docs/solutions/failed-attempts/` for semantic matches
   - If matches found: inject full attempt records into planning context
   - Require "Prior Attempts" section in the implementation plan

2. **GitHub Action on issue re-open** — "Record Failed Attempt"
   - Triggered by `issues: reopened` event
   - Finds the most recent merged PR linked to that issue
   - Extracts PR diff summary, files changed, approach
   - Creates a failed-attempt record in `docs/solutions/failed-attempts/`

3. **Enhanced compound step** — when the fix that finally works is for a problem with failed attempts:
   - Cross-reference the successful approach with failed attempts
   - Update failed attempt records with "Why It Likely Failed" (now known)
   - Create a richer solution doc that captures the full journey

### Semantic Matching (Lightweight)

No embeddings store. At work time, the issue-worker:

1. Reads all files in `docs/solutions/failed-attempts/` (expected to be a small, curated set)
2. Sends the new issue description + failed attempt titles/summaries to the LLM
3. Asks: "Which of these failed attempts, if any, are related to this new issue?"
4. If matches: reads the full attempt records and includes them in planning context

This scales fine for dozens of failed attempts. If the ledger grows to hundreds, we can add frontmatter-based pre-filtering (by component, tags) before the LLM call.

## Open Questions

None — all key decisions resolved during brainstorming.

## Scope Boundaries

**In scope:**
- GitHub Action to create failed-attempt records on issue re-open
- Failed-attempt record format and storage in docs/solutions/failed-attempts/
- Issue-worker integration: search ledger, inject context, require differentiation
- Enhanced compound step for successful resolutions of previously-failed problems

**Out of scope (for now):**
- Proactive matching at issue creation time (can add later)
- Embeddings-based search (LLM inline matching is sufficient at current scale)
- Automated verification that a fix actually works (separate, larger problem)
- Dashboard/metrics for attempt success rates (future /metrics skill)
