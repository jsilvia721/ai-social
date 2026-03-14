# In-App Feedback Submission System

**Date:** 2026-03-14
**Status:** Draft
**Participants:** Josh, Claude

## What We're Building

A lightweight in-app feedback system that lets Josh's non-technical business partner submit bug reports, feature requests, and general thoughts while using the platform. Submissions auto-create GitHub issues with a `needs-triage` label, flowing into the existing issue pipeline after manual review.

### The Problem

The business partner is dogfooding the platform but has no easy way to report what he finds. Asking him to use GitHub directly is too technical and creates friction that kills the feedback loop. We need something he can use without thinking — one click, type what's on his mind, done.

### The Solution

A persistent floating "Feedback" button on every dashboard page that opens a minimal modal form.

## Key Decisions

1. **Floating button, not sidebar nav** — Always visible, zero navigation. He can report something the instant he notices it, right in context. Follows the existing `DevToolsToggle` pattern (fixed bottom-right).

2. **Minimal form: text + optional screenshot** — One text area for freeform input. No type picker, no title field. The user just describes what's on their mind. Optional screenshot via existing S3 upload infrastructure. Page URL and timestamp auto-captured for context.

3. **Direct to GitHub, no in-app triage** — Submissions auto-create GitHub issues with a `needs-triage` label. Josh triages in GitHub (where he already works) rather than building a separate admin UI. This dramatically simplifies the build. The `needs-triage` label is the gate — issue-worker only picks up issues when Josh manually approves them.

4. **Prisma model for audit trail** — A `Feedback` model stores each submission with its GitHub issue number. This provides a local record and enables future features (submission history, status tracking) without rebuilding.

## User Flow

```
Partner using dashboard
  → Sees floating "Feedback" button (bottom-right)
  → Clicks it → Modal opens
  → Types description of bug/idea/thought
  → (Optional) Attaches screenshot
  → Clicks "Send"
  → Modal closes with confirmation
  → GitHub issue auto-created with:
    - Title: first ~80 chars of description (or "Feedback from [user]")
    - Body: full description + screenshot + page URL + timestamp
    - Label: needs-triage
  → Josh sees it in GitHub, triages, kicks off issue-worker when ready
```

## Technical Shape (high-level)

- **Floating button component** — Fixed position, bottom-right, visible on all `/dashboard/*` pages. Opens a dialog/modal.
- **Modal form** — Text area + optional file upload (reuse existing S3 presigned URL flow). Submit calls `POST /api/feedback`.
- **API route** (`POST /api/feedback`) — Saves to DB, creates GitHub issue via `octokit` or `gh` CLI, stores issue number back on the record.
- **Prisma model** — `Feedback` with: id, userId, description, screenshotUrl?, pageUrl, githubIssueNumber?, status, timestamps.
- **Auto-captured context** — Page URL passed from the client. User agent available from request headers.

## Why This Approach

- **Maximum simplicity** — One text box is the lowest possible friction. The partner will actually use this because it takes 10 seconds.
- **No new admin UI** — Triaging in GitHub avoids building a separate review page. Josh already lives in GitHub for issue management.
- **Extensible** — The DB model means we can add submission history, in-app triage, or status tracking later without rearchitecting.
- **Leverages existing infra** — S3 uploads, auth, GitHub integration are all in place.

## Open Questions

None — all key decisions resolved during brainstorm.
