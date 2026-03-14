---
name: pr-screenshots
description: Capture mobile and desktop screenshots of UI changes and embed S3 URLs in PR descriptions
allowed-tools: Bash, Read, Glob, Grep, mcp__playwright__browser_navigate, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_resize, mcp__playwright__browser_snapshot, mcp__playwright__browser_close
---

# PR Screenshots for UI Changes

Capture screenshots of affected pages when a PR touches UI files (`src/components/**`, `src/app/**/*.tsx`). Upload to S3 and embed in the PR description.

**Arguments:** $ARGUMENTS — optional flags:
- `--branch <name>` — override the branch name for S3 key (default: current git branch)
- `--pages <path1,path2>` — comma-separated list of page paths to screenshot (default: auto-detect from changed files)

## Process

### 1. Ensure Dev Server is Running

Verify the dev server is available:
```bash
curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000
```

If not running, start it:
```bash
npm run dev > /tmp/pr-screenshots-dev-server.log 2>&1 &
echo $! > /tmp/pr-screenshots-dev-server.pid
```

Wait up to 30 seconds for it to be ready. If the dev server cannot start (missing env vars, database not running), skip screenshots and report the failure.

### 2. Determine Affected Pages

If `--pages` was provided, use those paths. Otherwise, detect affected pages from the current branch's changed files:
```bash
git diff --name-only origin/main...HEAD -- 'src/components/**' 'src/app/**/*.tsx'
```

Map changed files to their page routes (e.g., `src/app/dashboard/posts/page.tsx` → `/dashboard/posts`).

### 3. Authenticate (if needed)

Navigate to the test session endpoint to set the auth cookie:
```
browser_navigate -> http://localhost:3000/api/test/session?email=jsilvia721@gmail.com
```

### 4. Capture Screenshots at Both Viewports

For each affected page:

1. **Mobile (375×812):** Resize browser, navigate to the page, wait for load, take screenshot.
2. **Desktop (1440×900):** Resize browser, navigate to the page, wait for load, take screenshot.

### 5. Upload to S3

Upload each screenshot to S3 via `uploadBuffer()` from `src/lib/storage.ts` with key:
```
screenshots/pr/<branch>/<page>-<width>.png
```

**Do NOT save screenshots to the local filesystem.** Use `uploadBuffer()` from `src/lib/storage.ts` to upload directly to S3. Never use `fs.writeFileSync()` or Playwright's `screenshot({ path })` to save files locally.

### 6. Output Markdown

Output a `## Screenshots` section with embedded S3 URLs as markdown images, ready to paste into a PR description.

### 7. Cleanup

If the skill started a dev server in step 1, shut it down:
```bash
kill $(cat /tmp/pr-screenshots-dev-server.pid) 2>/dev/null || true
rm -f /tmp/pr-screenshots-dev-server.pid /tmp/pr-screenshots-dev-server.log
```

Close the browser session.
