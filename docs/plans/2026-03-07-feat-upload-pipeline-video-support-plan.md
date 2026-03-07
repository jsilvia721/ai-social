---
title: "feat: Upload pipeline video support"
type: feat
status: completed
date: 2026-03-07
origin: docs/plans/2026-03-05-feat-autonomous-social-media-platform-roadmap-plan.md
---

# feat: Upload pipeline video support

## Overview

Upgrade the upload pipeline so users can attach video files (mp4, mov, webm) up to 500MB when composing posts. The presigned URL endpoint already supports this on the backend — the main work is routing the PostComposer UI through that path, adding a progress indicator, fixing video preview rendering, and adding platform-level guards so users can't attach video to platforms that don't support it yet.

## Problem Statement

The PostComposer always uploads through the server-side `POST /api/upload` route, which has a 10MB limit. In production (Lambda behind API Gateway/CloudFront), the hard payload limit is ~6-10MB, making server-side video upload unreliable. The presigned URL endpoint (`GET /api/upload/presigned`) already supports video up to 500MB with browser-direct S3 PUT, but the UI never uses it.

Additionally:
- File input only accepts `video/mp4` — missing .mov and .webm
- Video preview checks `url.endsWith(".mp4")` — other formats render as broken images
- No upload progress indicator for large files
- No platform-level validation prevents attaching video to platforms that can't publish it (Instagram, Facebook, Twitter video publishing is not yet implemented)

## Proposed Solution

### Architecture Decision: All videos through presigned URLs

**All video uploads use the presigned URL path**, regardless of size. The server-side route stays images-only. Rationale:
- Lambda payload limit (~6-10MB) makes server-side video upload unreliable
- Presigned URL endpoint already exists and works
- Consistent code path (no threshold-based routing)
- Progress tracking via XHR is only possible with direct-to-S3 uploads

### Drop .avi support

Remove `video/x-msvideo` from the presigned route. No browser can preview .avi, no social platform accepts it natively, and it adds complexity for zero user value. Users with .avi files should convert first.

## Technical Approach

### 1. Server-side route (`src/app/api/upload/route.ts`)

Remove `video/mp4` from `ALLOWED_TYPES` — videos now go exclusively through presigned URLs. This makes the server-side route images-only, which aligns with the Lambda payload limit.

```typescript
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const EXT_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB (images only)
```

### 2. Presigned route (`src/app/api/upload/presigned/route.ts`)

**Changes:**
- Add image types alongside video types (unified presigned path for all large files and all videos)
- Per-type size limits: images 10MB, videos 500MB
- Remove `video/x-msvideo` (.avi)
- Add `Content-Length` condition to presigned URL to prevent size spoofing
- Validate `fileSize > 0`

```typescript
const ALLOWED_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const IMAGE_MAX_SIZE = 10 * 1024 * 1024;   // 10 MB
const VIDEO_MAX_SIZE = 500 * 1024 * 1024;   // 500 MB

function isVideoType(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

function getMaxSize(mimeType: string): number {
  return isVideoType(mimeType) ? VIDEO_MAX_SIZE : IMAGE_MAX_SIZE;
}
```

**Content-Length enforcement:** Add `ContentLength` to the `PutObjectCommand` so S3 rejects uploads that don't match the declared size:

```typescript
const command = new PutObjectCommand({
  Bucket: BUCKET,
  Key: key,
  ContentType: mimeType,
  ContentLength: fileSizeNum,  // enforces declared size at S3 level
});
```

### 3. PostComposer (`src/components/posts/PostComposer.tsx`)

**File input accept attribute:**
```
accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm"
```

**Video detection:** Replace `f.type === "video/mp4"` with `f.type.startsWith("video/")` throughout.

**Mutual exclusion:** Video and images are mutually exclusive (matches Twitter/TikTok/YouTube behavior). Selecting a video clears existing images; selecting images clears existing video.

**Upload routing in `handleFileSelect`:**
- Images: continue using `POST /api/upload` (server-side, small files)
- Videos: use presigned URL flow:
  1. `GET /api/upload/presigned?mimeType=...&fileSize=...`
  2. `XMLHttpRequest` PUT to the returned `uploadUrl` (not `fetch`, because `fetch` doesn't support `upload.onprogress`)
  3. On completion, use the `publicUrl` from the presigned response

**Progress indicator:** Show upload percentage inline in the media card during presigned uploads. Use `xhr.upload.onprogress` for tracking. Add an abort button that calls `xhr.abort()`.

**Video preview fix:** Replace `url.endsWith(".mp4")` with an extension set check:
```typescript
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm"]);
function isVideoUrl(url: string): boolean {
  return VIDEO_EXTENSIONS.has(url.slice(url.lastIndexOf(".")));
}
```

For `.mov` (limited browser support) and failed `<video>` loads, show a file-type placeholder icon with the filename instead of a broken player.

**Platform video guards:** When the selected account is Instagram, Facebook, or Twitter, disable video file selection and show a tooltip: "Video publishing not yet supported for this platform." TikTok and YouTube allow video.

### 4. S3 CORS configuration (`sst.config.ts`)

The current CORS config only allows PUT from one hardcoded CloudFront domain and lacks `AllowedHeaders`. Update to:
- Include both staging and production CloudFront domains (or use the SST-managed domain)
- Add `AllowedHeaders: ["Content-Type", "Content-Length"]`
- Add `ExposeHeaders: ["ETag"]` (needed for multipart upload completion)

### 5. Storage (`src/lib/storage.ts`)

Update `getPresignedUploadUrl` to accept an optional `contentLength` parameter:

```typescript
export async function getPresignedUploadUrl(
  key: string,
  mimeType: string,
  contentLength?: number,
  expiresInSeconds = 3600
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: mimeType,
    ...(contentLength !== undefined && { ContentLength: contentLength }),
  });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}
```

## System-Wide Impact

**Interaction graph:**
- PostComposer `handleFileSelect` → (video) presigned route → S3 direct PUT → `mediaUrls` state
- PostComposer `handleFileSelect` → (image) server-side route → `uploadFile` → S3 → `mediaUrls` state
- `mediaUrls` → `POST /api/posts` → saved to DB → scheduler picks up → platform `publish*` function
- Platform publish functions fetch media from S3 URL → SSRF guard validates → platform API upload

**Error propagation:**
- Presigned URL generation failure → PostComposer shows error, no S3 upload attempted
- S3 PUT failure (CORS, network, size mismatch) → XHR `onerror`/`onabort` → PostComposer shows error
- Content-Length mismatch → S3 returns 403 → XHR `onerror` → PostComposer shows "Upload failed" error
- Video attached to unsupported platform → blocked at compose time (not at publish time)

**State lifecycle risks:**
- Orphaned S3 objects: user uploads video but never submits post → object stays in S3 forever. Mitigation: add TODO for S3 lifecycle rule (not in scope for this feature).
- Partial upload: connection drops mid-XHR → partial S3 object may or may not exist. S3 simple PUT is atomic — partial uploads don't create objects.

**API surface parity:**
- `POST /api/upload` — remove video/mp4, becomes images-only
- `GET /api/upload/presigned` — add image types, add per-type size limits, add Content-Length enforcement
- `POST /api/posts` — no changes (accepts mediaUrls array as-is)
- `PATCH /api/posts/[id]` — no changes

**Integration test scenarios:**
1. User uploads 50MB mp4 via presigned URL → S3 object created → post submitted → scheduler publishes to YouTube successfully
2. User selects video on Instagram account → file picker is disabled, tooltip explains video not supported
3. User uploads video, then switches to image → video cleared, image uploaded via server-side route
4. User uploads 600MB video → presigned route returns 400 "File too large (max 500 MB)"
5. User uploads image through presigned route (>6MB gif) → works with 10MB image limit enforced

## Acceptance Criteria

### Functional
- [x] Video files (.mp4, .mov, .webm) up to 500MB accepted via presigned URL upload
- [x] Image files continue to work via server-side upload (up to 10MB)
- [x] `POST /api/upload` rejects video files (images only)
- [x] `GET /api/upload/presigned` accepts both images and videos with per-type size limits
- [x] Presigned URL includes Content-Length condition to prevent size spoofing
- [x] PostComposer routes videos through presigned URL, images through server-side
- [x] Progress bar shown during video upload with percentage and abort button
- [x] Video preview renders for .mp4 and .webm; placeholder icon for .mov
- [x] Video and images are mutually exclusive in post attachments
- [x] Video file picker disabled for Instagram, Facebook, Twitter accounts with explanatory tooltip
- [x] S3 CORS updated to allow PUT from staging and production domains with required headers

### Testing
- [x] `src/__tests__/api/upload.test.ts` updated: video/mp4 now rejected (images-only)
- [x] `src/__tests__/api/upload-presigned.test.ts` updated: image types accepted, per-type size limits, Content-Length, .avi removed
- [x] Coverage thresholds maintained (75% statements/lines/branches, 70% functions)

## Dependencies & Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| S3 CORS blocks presigned PUT in staging/prod | High | Critical | Update CORS config in sst.config.ts before testing |
| `.mov` MIME type varies by browser | Medium | Low | Fall back to extension-based detection |
| Large video upload timeout on slow connections | Medium | Medium | XHR progress bar + abort button so user knows status |
| Orphaned S3 objects from abandoned uploads | Low | Low | Future: S3 lifecycle rule to delete unlinked objects after 7 days |
| Platform publish fails for video (Instagram/Facebook/Twitter) | N/A | N/A | Blocked at compose time — video picker disabled for unsupported platforms |

## Out of Scope (Future Work)

- Video publishing support for Instagram (Reels), Facebook (/videos endpoint), Twitter (chunked media upload) — separate features per platform
- S3 multipart upload for files >5GB (not needed at 500MB max)
- Video transcoding or format conversion
- S3 lifecycle rules for orphaned upload cleanup
- Drag-and-drop upload UX

## Sources & References

### Origin
- **Roadmap plan:** [docs/plans/2026-03-05-feat-autonomous-social-media-platform-roadmap-plan.md](../plans/2026-03-05-feat-autonomous-social-media-platform-roadmap-plan.md) — M1 upload pipeline section (lines 146-158)

### Internal References
- Server-side upload route: `src/app/api/upload/route.ts`
- Presigned URL route: `src/app/api/upload/presigned/route.ts`
- Storage module: `src/lib/storage.ts`
- PostComposer: `src/components/posts/PostComposer.tsx`
- S3 CORS config: `sst.config.ts:34-42`
- Upload tests: `src/__tests__/api/upload.test.ts`, `src/__tests__/api/upload-presigned.test.ts`
- SSRF guard: `assertSafeMediaUrl()` in platform files

### External References
- S3 presigned URL docs: https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html
- XHR upload progress: https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/upload
- Browser video format support: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video#browser_compatibility
