---
name: qa-audit
description: Run a visual QA/UX audit of the dashboard using Playwright MCP for screenshots and Claude vision for analysis, then create GitHub issues per finding
allowed-tools: Agent, Bash, Glob, Grep, Read, mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_resize, mcp__playwright__browser_click, mcp__playwright__browser_wait_for, mcp__playwright__browser_console_messages, mcp__playwright__browser_evaluate, mcp__playwright__browser_tabs, mcp__playwright__browser_close
---

# QA/UX Audit Skill

Crawl dashboard pages, take screenshots at mobile and desktop viewports, analyze each screenshot for UI/UX issues, and create GitHub issues for findings. This skill is fully autonomous — it manages its own dev server, authentication, and error recovery without user intervention.

**Arguments:** $ARGUMENTS — optional flags:
- `--url <base>` — override the base URL (default: `https://d11oxnidmahp76.cloudfront.net`)
- `--dry-run` — skip GitHub issue creation, just report findings
- `--page <path>` — audit a single page instead of the full manifest (e.g. `--page /dashboard/posts`)
- `--mobile-only` — only capture mobile viewport (375px)
- `--desktop-only` — only capture desktop viewport (1440px)

## Prerequisites — Autonomous Preflight

Run these three checks in order. If a check fails, attempt autonomous recovery before moving on. **Never stop and ask the user for help** unless all recovery attempts fail and zero pages can be audited.

### Step 1: Check if target is responding

Use Bash to check if the target URL is reachable:

```bash
curl -s -o /dev/null -w "%{http_code}" --max-time 5 {baseUrl}/api/test/session?email=josh@jsilvia.com
```

- **If HTTP 200:** Target is up. Proceed to Step 2.
- **If any other response or timeout:** The target is not responding. If using a remote URL (staging), this is a blocker — create a self-improvement issue (see [Self-Improvement Issue Creation](#self-improvement-issue-creation)) and abort. If using localhost, proceed to the autonomous server startup in Step 3.

### Step 2: Verify auth endpoint works

Use Bash to hit the test session endpoint:

```bash
curl -s -o /dev/null -w "%{http_code}" --max-time 5 {baseUrl}/api/test/session?email=josh@jsilvia.com
```

- **If HTTP 200:** Auth endpoint is working. Proceed to Process step 1.
- **If HTTP 404:** The server is running but `PLAYWRIGHT_E2E` is not set. Proceed to Step 3 to restart with the correct env var.
- **If connection refused or timeout:** Server is down. Proceed to Step 3.

### Step 3: Autonomous dev server management

When the target is localhost (or `--url` points to `localhost:3000`) and auth returns 404 or the server is unreachable, autonomously start a properly configured dev server:

1. **Kill any existing process on port 3000:**
   ```bash
   lsof -ti:3000 | xargs kill -9 2>/dev/null || true
   ```

2. **Wait for port to be freed (up to 5s):**
   ```bash
   for i in $(seq 1 10); do lsof -ti:3000 >/dev/null 2>&1 || break; sleep 0.5; done
   ```

3. **Start the dev server with `PLAYWRIGHT_E2E=true`:**
   ```bash
   PLAYWRIGHT_E2E=true npm run dev > /tmp/qa-audit-dev-server.log 2>&1 &
   echo $! > /tmp/qa-audit-dev-server.pid
   ```

4. **Wait for the server to be ready (up to 30s):**
   ```bash
   for i in $(seq 1 30); do
     curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:3000 | grep -q "200\|307\|302" && break
     sleep 1
   done
   ```

5. **Verify the server started successfully:**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000
   ```
   - If still not responding after 30s, check the log: `tail -50 /tmp/qa-audit-dev-server.log`
   - If the server failed to start, create a self-improvement issue with the error log and abort.

6. **Re-verify auth after restart:**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/api/test/session?email=josh@jsilvia.com
   ```
   - If still returning 404 or error, create a self-improvement issue and abort.
   - If 200, update `baseUrl` to `http://localhost:3000` and proceed.

## Process

### 1. Parse Arguments

Parse `$ARGUMENTS` for flags:
- Extract `--url <value>` if present; otherwise use `https://d11oxnidmahp76.cloudfront.net`
- Check for `--dry-run`, `--page <path>`, `--mobile-only`, `--desktop-only`

### 2. Authenticate

Navigate to the test session endpoint to set the auth cookie in the browser context:

```
browser_navigate -> {baseUrl}/api/test/session?email=josh@jsilvia.com
```

This sets a `next-auth.session-token` cookie. All subsequent `browser_navigate` calls in the same session will include it automatically.

**Verify auth worked:** After navigating, use `browser_snapshot` to check the page content. The endpoint should return a success response (not a 404 or error page).

**If auth fails here** (after preflight passed), attempt recovery:
1. Use `browser_close` to reset the browser session.
2. Re-navigate to the auth endpoint.
3. If still failing, create a self-improvement issue and continue with whatever pages are accessible without auth.

### 3. Auth Recovery Verification

After authentication, verify the session is actually working by navigating to `/dashboard`:

```
browser_navigate -> {baseUrl}/dashboard
```

Use `browser_snapshot` to check the page content:
- **If dashboard content loads** (sidebar, page heading visible): Auth is confirmed working. Proceed.
- **If redirected to sign-in page:** Auth cookie was not set correctly. Attempt recovery:
  1. Navigate back to the auth endpoint: `{baseUrl}/api/test/session?email=josh@jsilvia.com`
  2. Wait 2 seconds for cookie to be set.
  3. Navigate to `/dashboard` again.
  4. If still redirected, create a self-improvement issue titled `[QA-Infra] Auth cookie not persisting across navigations` and continue auditing any pages that don't require auth.

### 4. Database Health Check

While on `/dashboard`, verify the page loads actual content rather than an error page:

- Use `browser_snapshot` to inspect the page.
- **If the page shows a database error, 500 error, or "unable to connect" message:** The database is unreachable. Log this as a blocker, create a self-improvement issue titled `[QA-Infra] Database unreachable during QA audit`, and abort the audit (pages will not render meaningful content without DB).
- **If the page loads with content (even if empty/no data):** Database is healthy. Proceed.

### 5. Resolve Dynamic Route Parameters

Navigate to the audit-params endpoint to get IDs for dynamic routes:

```
browser_navigate -> {baseUrl}/api/test/audit-params
```

Read the JSON response body. It returns:
```json
{
  "businessId": "<id-or-null>",
  "postId": "<id-or-null>",
  "repurposeGroupId": "<id-or-null>"
}
```

Store these values for substituting into dynamic route paths.

**If this endpoint fails:** Log it as a non-fatal error. Skip all routes that require dynamic parameters and continue with static routes only.

### 6. Build Route List

Use this route manifest. For each route with dynamic params, substitute the values from step 5. **Skip any route whose required param is null.**

| Path | Label | Dynamic Param |
|------|-------|---------------|
| `/dashboard` | Dashboard Home | — |
| `/dashboard/accounts` | Accounts | — |
| `/dashboard/analytics` | Analytics | — |
| `/dashboard/briefs` | Content Briefs | — |
| `/dashboard/businesses` | Businesses | — |
| `/dashboard/businesses/new` | New Business | — |
| `/dashboard/businesses/[id]/onboard` | Business Onboarding | `[id]` -> `businessId` |
| `/dashboard/insights` | Strategy Insights | — |
| `/dashboard/posts` | Posts | — |
| `/dashboard/posts/new` | New Post | — |
| `/dashboard/posts/[id]/edit` | Edit Post | `[id]` -> `postId` |
| `/dashboard/posts/repurpose/[groupId]` | Repurpose Post | `[groupId]` -> `repurposeGroupId` |
| `/dashboard/review` | Review Queue | — |
| `/dashboard/strategy` | Strategy | — |

If `--page <path>` was provided, filter to only that route.

### 7. Crawl and Screenshot Each Page

For each route in the manifest:

1. **Resize browser** to the target viewport(s):
   - Mobile: 375x812
   - Desktop: 1440x900
   - Respect `--mobile-only` / `--desktop-only` flags

2. **Navigate** to `{baseUrl}{resolvedPath}`

3. **Wait for page to be ready:**
   - Wait for network idle / page load
   - Wait ~1 second for late renders and animations to settle

4. **Take a full-page screenshot** using `browser_take_screenshot`

5. **Record the screenshot** — keep it in context for analysis in the next step

**Per-page error handling:** If a page fails to load (timeout, crash, error):
- Record the failure with the error details.
- **Do not stop the audit.** Skip this page and continue with the next route.
- If 3+ consecutive pages fail with the same error (e.g., all redirect to sign-in), stop the crawl early — this is a systematic issue. Create a single self-improvement issue for the root cause (e.g., `[QA-Infra] All pages redirect to sign-in — auth session lost`) rather than per-page issues.

### 8. Analyze Screenshots

For each page, analyze the mobile and/or desktop screenshots using your own vision capabilities. Look for:

**Report these issues:**
- Layout issues (overflow, truncation, misalignment, overlapping elements)
- Responsive design problems (content not adapting between mobile/desktop)
- Accessibility concerns (contrast, touch targets, missing labels)
- Visual polish (inconsistent spacing, broken borders, loading state artifacts)
- UX problems (confusing navigation, hidden actions, unclear states)
- Empty states (missing helpful messages when no data exists)

**Do NOT report:**
- Missing or placeholder content (seed data may be limited)
- Issues requiring authentication context (user is assumed logged in)
- Browser-specific rendering (assume modern Chrome)
- Performance issues (this is a visual audit only)

For each finding, assess:
- **Severity:** critical / major / minor / cosmetic
- **Confidence:** 0.0-1.0 (only report findings with confidence >= 0.5)
- **Complexity:** simple (CSS/copy fix, 1-2 files) or complex (logic/architecture change)
- **Viewport:** mobile / desktop / both

### 9. Create GitHub Issues (unless `--dry-run`)

Only create issues for findings with **confidence >= 0.7**.

For each high-confidence finding, create a GitHub issue:

```bash
gh issue create \
  --title "[QA] <Page Label>: <Finding Title>" \
  --label "qa-audit" --label "needs-triage" \
  --label "<simple-fix|needs-plan>" \
  --body "$(cat <<'EOF'
**Severity:** <severity>
**Confidence:** <N>%
**Viewport:** <mobile|desktop|both>
**Page:** <Page Label> (`<resolved-path>`)

<Finding description — what's wrong and how to fix it>

## Suggested Files

- `<suggested file path>`

## Complexity

<Simple fix — likely a CSS or copy change in 1-2 files. | Complex fix — may require logic or architectural changes.>

---
_Generated by QA/UX audit skill_
EOF
)"
```

Use `simple-fix` label for simple findings, `needs-plan` for complex ones.

**Deduplication:** Before creating issues, run:
```bash
gh issue list --label qa-audit --json title --limit 200
```
Skip any finding whose title matches an existing open issue.

### 10. Summary Report

After processing all routes, output a summary table:

```
Route                    | Score | Findings | Status
-------------------------|-------|----------|--------
/dashboard               |  85   | 2        | OK
/dashboard/posts         |  92   | 1        | OK
/dashboard/analytics     |  --   | --       | FAILED (timeout)
...
```

Include:
- **Pages audited:** N of M total routes
- **Pages failed:** list of failed routes with reasons
- **QA issues created:** count (or "dry run — none created")
- **Infrastructure issues created:** count and links

If `--dry-run`, just report findings without creating issues.

## Self-Improvement Issue Creation

When the skill hits an unrecoverable blocker, create a GitHub issue to track the infrastructure problem. This ensures systematic issues are addressed even when the audit cannot proceed.

**Trigger conditions:**
- Dev server won't start after autonomous restart attempt
- Auth still fails after server restart and retry
- Database is unreachable
- Playwright MCP tools are not responding (browser_navigate returns errors)
- 3+ consecutive pages fail with the same systematic error

**Issue format:**
```bash
gh issue create \
  --title "[QA-Infra] <blocker description>" \
  --label "qa-audit" --label "claude-self-improvement" \
  --body "$(cat <<'EOF'
## What was attempted
<exact steps taken by the QA audit skill>

## What failed
<exact error message or behavior observed>

## Error output
```
<relevant log output, curl responses, or error messages>
```

## Suggested fix
<what would need to change to prevent this — e.g., env var configuration, endpoint fix, docker setup>

## Context
Encountered during autonomous QA audit run.
EOF
)"
```

**After creating the issue:**
- Log the issue URL in the audit output.
- **Continue auditing whatever pages are still accessible.** Only abort entirely if zero pages can be loaded.

## Error Recovery Hierarchy

When any step in the audit encounters an error, follow this hierarchy. **Never stop and ask the user for help** unless condition 4 is met.

1. **Attempt autonomous fix:** Retry the operation, restart the server, re-authenticate, or skip the problematic page. Use the specific recovery steps documented in each section above.

2. **If autonomous fix fails:** Create a self-improvement issue (see above) documenting what went wrong and a suggested fix.

3. **Continue with remaining pages:** Even if some pages fail, complete the audit for pages that work. Report failures in the summary.

4. **Only abort entirely if:** Zero pages can be audited (server completely unreachable, auth totally broken, or Playwright MCP tools are non-functional). In this case, create a self-improvement issue and output a clear summary of what was attempted and what failed.

## Suggested Files Reference

When reporting findings, use these file mappings to suggest which files to edit:

| Route | Suggested Files |
|-------|----------------|
| `/dashboard` | `src/app/dashboard/page.tsx` |
| `/dashboard/accounts` | `src/app/dashboard/accounts/page.tsx` |
| `/dashboard/analytics` | `src/app/dashboard/analytics/page.tsx` |
| `/dashboard/briefs` | `src/app/dashboard/briefs/page.tsx` |
| `/dashboard/businesses` | `src/app/dashboard/businesses/page.tsx` |
| `/dashboard/businesses/new` | `src/app/dashboard/businesses/new/page.tsx` |
| `/dashboard/businesses/[id]/onboard` | `src/app/dashboard/businesses/[id]/onboard/page.tsx` |
| `/dashboard/insights` | `src/app/dashboard/insights/page.tsx` |
| `/dashboard/posts` | `src/app/dashboard/posts/page.tsx` |
| `/dashboard/posts/new` | `src/app/dashboard/posts/new/page.tsx` |
| `/dashboard/posts/[id]/edit` | `src/app/dashboard/posts/[id]/edit/page.tsx` |
| `/dashboard/posts/repurpose/[groupId]` | `src/app/dashboard/posts/repurpose/[groupId]/page.tsx` |
| `/dashboard/review` | `src/app/dashboard/review/page.tsx` |
| `/dashboard/strategy` | `src/app/dashboard/strategy/page.tsx` |
