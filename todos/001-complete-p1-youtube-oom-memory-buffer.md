---
status: pending
priority: p1
issue_id: "001"
tags: [code-review, performance, security, youtube]
dependencies: []
---

# YouTube: Full video buffered into server memory (OOM risk)

## Problem Statement

`publishYouTubeVideo` fetches the S3 presigned video URL and calls `videoRes.arrayBuffer()`, loading the entire file into the Node.js heap before uploading to YouTube. A 500 MB video will OOM Railway's server or hit its memory ceiling before the upload even starts. This directly undermines the presigned-upload flow that was built to avoid this exact problem.

## Findings

- **File:** `src/lib/platforms/youtube/index.ts:47-51`
- The presigned upload endpoint was designed to bypass Railway's size/timeout limits — `publishYouTubeVideo` defeats this by downloading the file server-side anyway
- `arrayBuffer()` materialises the full response body in memory with no size guard
- The YouTube Data API supports resumable uploads that stream the bytes without buffering
- Confirmed by: Performance Oracle, Architecture Strategist, TypeScript Reviewer, Code Simplicity Reviewer

## Proposed Solutions

### Option A: YouTube Resumable Upload API (Recommended)
- Initiate a resumable upload session with YouTube's API (returns an `uploadUri`)
- Stream the S3 object directly to YouTube using pipe/stream forwarding
- Pros: No memory spike, handles network interruptions gracefully, YouTube-recommended approach
- Cons: More complex implementation (~50 lines vs current), requires handling upload status
- Effort: Medium | Risk: Low

### Option B: Server-side streaming with `fetch` + `body` pipe
- Use `fetch(s3Url)` but pipe `response.body` (ReadableStream) directly to the YouTube upload request
- Pros: Simpler than full resumable, avoids full buffer
- Cons: Still consumes a server connection for full duration; no retry on partial failure
- Effort: Small | Risk: Medium

### Option C: Client-side YouTube upload
- Return a YouTube upload URL to the client and let the browser upload directly
- Pros: Zero server memory usage
- Cons: Requires exposing YouTube access token to client; breaks the server-side-only token model
- Effort: Medium | Risk: High (security)

## Recommended Action

Implement Option A (resumable upload). Initiate session server-side (preserving token security), then stream S3 object to YouTube's resumable upload URI.

## Technical Details

- **Affected files:** `src/lib/platforms/youtube/index.ts`
- YouTube Resumable Upload docs: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- The multipart boundary bug (P3-003) should also be fixed in the same pass

## Acceptance Criteria

- [ ] Video publish does not call `arrayBuffer()` on the video response
- [ ] Server memory usage stays flat during a 200MB+ video upload
- [ ] Upload works end-to-end on Railway staging
- [ ] Existing YouTube publish tests updated

## Work Log

- 2026-03-06: Identified by code review agents. Flagged P1.

## Resources

- PR #1: feat/milestone-1-platform-connect
- YouTube Resumable Upload: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
