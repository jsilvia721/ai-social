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

**Default test email:** `josh@jsilvia.com` — used for all auth endpoint calls below. Referenced as `{testEmail}`.

**Never stop and ask the user for help.** Attempt autonomous recovery, create self-improvement issues for unrecoverable blockers, and continue auditing whatever pages remain accessible. Only abort if zero pages can be loaded.

## Process

### 1. Parse Arguments

Parse `$ARGUMENTS` for flags:
- Extract `--url <value>` if present; otherwise use `https://d11oxnidmahp76.cloudfront.net`
- Check for `--dry-run`, `--page <path>`, `--mobile-only`, `--desktop-only`

Determine if the target is local: `baseUrl` contains `localhost` or `127.0.0.1`.

### 2. Preflight — Check Target and Auth

Run a single curl to check both reachability and auth:

```bash
curl -s -o /dev/null -w "%{http_code}" --max-time 5 {baseUrl}/api/test/session?email={testEmail}
```

- **HTTP 200:** Server is up and auth endpoint works. Proceed to step 3.
- **HTTP 404:** Server is running but `PLAYWRIGHT_E2E` is not set. If target is local, proceed to step 2a. If remote, create a self-improvement issue (`[QA-Infra] Remote auth endpoint returned 404 — PLAYWRIGHT_E2E not set on staging`) and abort.
- **Connection refused / timeout:** Server is not responding. If target is local, proceed to step 2a. If remote, create a self-improvement issue (`[QA-Infra] Remote target unreachable: {baseUrl}`) and abort.

#### 2a. Autonomous Dev Server Startup (localhost only)

**Only run this sub-step if the target is local** (`localhost` or `127.0.0.1`). Never attempt server management for remote URLs.

1. **Kill any existing process on port 3000:**
   ```bash
   lsof -ti:3000 | xargs kill -9 2>/dev/null || true
   ```

2. **Start the dev server with `PLAYWRIGHT_E2E=true`:**
   ```bash
   PLAYWRIGHT_E2E=true npm run dev > /tmp/qa-audit-dev-server.log 2>&1 &
   echo $! > /tmp/qa-audit-dev-server.pid
   ```

3. **Wait for the server to be ready (up to 30s):**
   ```bash
   for i in $(seq 1 30); do
     curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:3000 | grep -q "200\|307\|302" && break
     sleep 1
   done
   ```

4. **Re-verify auth after restart:**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/api/test/session?email={testEmail}
   ```
   - If HTTP 200: Update `baseUrl` to `http://localhost:3000` and proceed to step 3.
   - If still failing: Check `tail -50 /tmp/qa-audit-dev-server.log` for errors. Create a self-improvement issue with the log output and abort.

### 3. Authenticate via Browser

Navigate to the test session endpoint to set the auth cookie in the Playwright browser context:

```
browser_navigate -> {baseUrl}/api/test/session?email={testEmail}
```

This sets a `next-auth.session-token` cookie. All subsequent `browser_navigate` calls in the same session will include it automatically.

**Verify auth works end-to-end:** Navigate to `/dashboard`:

```
browser_navigate -> {baseUrl}/dashboard
```

Use `browser_snapshot` to check the page content:
- **If dashboard content loads** (sidebar, page heading visible): Auth confirmed. Proceed.
- **If redirected to sign-in page:** Retry once — navigate back to the auth endpoint, wait 2 seconds, then try `/dashboard` again. If still redirected, create a self-improvement issue (`[QA-Infra] Auth cookie not persisting across navigations`) and continue auditing any pages that are accessible.

### 4. Resolve Dynamic Route Parameters

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

### 5. Build Route List

Use this route manifest. For each route with dynamic params, substitute the values from step 4. **Skip any route whose required param is null.**

| Path | Label | Dynamic Param |
|------|-------|---------------|
| `/dashboard` | Dashboard Home | -- |
| `/dashboard/accounts` | Accounts | -- |
| `/dashboard/analytics` | Analytics | -- |
| `/dashboard/briefs` | Content Briefs | -- |
| `/dashboard/businesses` | Businesses | -- |
| `/dashboard/businesses/new` | New Business | -- |
| `/dashboard/businesses/[id]/onboard` | Business Onboarding | `[id]` -> `businessId` |
| `/dashboard/insights` | Strategy Insights | -- |
| `/dashboard/posts` | Posts | -- |
| `/dashboard/posts/new` | New Post | -- |
| `/dashboard/posts/[id]/edit` | Edit Post | `[id]` -> `postId` |
| `/dashboard/posts/repurpose/[groupId]` | Repurpose Post | `[groupId]` -> `repurposeGroupId` |
| `/dashboard/review` | Review Queue | -- |
| `/dashboard/strategy` | Strategy | -- |

If `--page <path>` was provided, filter to only that route.

### 6. Crawl and Screenshot Each Page

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

5. **Record the screenshot** -- keep it in context for analysis in the next step

**Per-page error handling:** If a page fails to load (timeout, crash, error):
- Record the failure with the error details.
- **Do not stop the audit.** Skip this page and continue with the next route.
- If 3+ consecutive pages fail with the same error (e.g., all redirect to sign-in), stop the crawl early -- this is a systematic issue. Create a single self-improvement issue for the root cause (e.g., `[QA-Infra] All pages redirect to sign-in -- auth session lost`) rather than per-page issues.

### 7. Analyze Screenshots

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

### 8. Create GitHub Issues (unless `--dry-run`)

Only create issues for findings with **confidence >= 0.7**.

For each high-confidence finding, create a GitHub issue:

```bash
gh issue create \
  --title "[QA] <Page Label>: <Finding Title>" \
  --label "qa-audit" --label "needs-triage" \
  --label "<simple-fix|complex>" \
  --body "$(cat <<'EOF'
**Severity:** <severity>
**Confidence:** <N>%
**Viewport:** <mobile|desktop|both>
**Page:** <Page Label> (`<resolved-path>`)

<Finding description -- what's wrong and how to fix it>

## Suggested Files

- `<suggested file path>`

## Complexity

<Simple fix -- likely a CSS or copy change in 1-2 files. | Complex fix -- may require logic or architectural changes.>

---
_Generated by QA/UX audit skill_
EOF
)"
```

Use `simple-fix` label for simple findings, `complex` for complex ones.

**Deduplication:** Before creating issues, run:
```bash
gh issue list --label qa-audit --json title --limit 200
```
Skip any finding whose title closely matches an existing open issue (same page label and similar description).

### 9. Summary Report

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
- **QA issues created:** count (or "dry run -- none created")
- **Infrastructure issues created:** count and links

If `--dry-run`, just report findings without creating issues.

### 10. Cleanup

After the audit completes (whether fully or partially):

1. **Close the browser session:**
   ```
   browser_close
   ```

2. **If the skill started a dev server in step 2a, shut it down:**
   ```bash
   kill $(cat /tmp/qa-audit-dev-server.pid) 2>/dev/null || true
   rm -f /tmp/qa-audit-dev-server.pid /tmp/qa-audit-dev-server.log
   ```

## Self-Improvement Issue Template

When creating self-improvement issues for infrastructure blockers, use this format:

```bash
gh issue create \
  --title "[QA-Infra] <blocker description>" \
  --label "qa-audit" --label "claude-self-improvement" \
  --body "$(cat <<'QEOF'
## What was attempted
<exact steps taken by the QA audit skill>

## What failed
<exact error message or behavior observed>

## Error output
<relevant log output, curl responses, or error messages — use indented blocks>

## Suggested fix
<what would need to change to prevent this>

## Context
Encountered during autonomous QA audit run.
QEOF
)"
```

After creating the issue, log the URL in the audit output and continue auditing remaining pages.

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
