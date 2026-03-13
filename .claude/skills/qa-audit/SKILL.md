---
name: qa-audit
description: Run a visual QA/UX audit of the dashboard using Playwright MCP for screenshots and Claude vision for analysis, then create GitHub issues per finding
allowed-tools: Agent, Bash, Glob, Grep, Read, mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_resize, mcp__playwright__browser_click, mcp__playwright__browser_wait_for, mcp__playwright__browser_console_messages, mcp__playwright__browser_evaluate, mcp__playwright__browser_tabs, mcp__playwright__browser_close
---

# QA/UX Audit Skill

Crawl dashboard pages on the staging environment, take screenshots at mobile and desktop viewports, analyze each screenshot for UI/UX issues, and create GitHub issues for findings.

**Arguments:** $ARGUMENTS — optional flags:
- `--url <base>` — override the base URL (default: `https://d11oxnidmahp76.cloudfront.net`)
- `--dry-run` — skip GitHub issue creation, just report findings
- `--page <path>` — audit a single page instead of the full manifest (e.g. `--page /dashboard/posts`)
- `--mobile-only` — only capture mobile viewport (375px)
- `--desktop-only` — only capture desktop viewport (1440px)

## Prerequisites

1. **Check staging is reachable:**
   Use Playwright MCP `browser_navigate` to load the base URL. If it fails, abort with a clear message. No local dev server is required — staging is the default target.

2. **No external credentials needed.** The skill uses Playwright MCP (browser-based) for screenshots and Claude's own vision for analysis. No ANTHROPIC_API_KEY, AWS creds, or database access required.

## Process

### 1. Parse Arguments

Parse `$ARGUMENTS` for flags:
- Extract `--url <value>` if present; otherwise use `https://d11oxnidmahp76.cloudfront.net`
- Check for `--dry-run`, `--page <path>`, `--mobile-only`, `--desktop-only`

### 2. Authenticate

Navigate to the test session endpoint to set the auth cookie in the browser context:

```
browser_navigate → {baseUrl}/api/test/session?email=test@example.com
```

This sets a `next-auth.session-token` cookie. All subsequent `browser_navigate` calls in the same session will include it automatically.

**Verify auth worked:** After navigating, check that the page didn't return an error. The endpoint should redirect or return a success response.

### 3. Resolve Dynamic Route Parameters

Navigate to the audit-params endpoint to get IDs for dynamic routes:

```
browser_navigate → {baseUrl}/api/test/audit-params
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

### 4. Build Route List

Use this route manifest. For each route with dynamic params, substitute the values from step 3. **Skip any route whose required param is null.**

| Path | Label | Dynamic Param |
|------|-------|---------------|
| `/dashboard` | Dashboard Home | — |
| `/dashboard/accounts` | Accounts | — |
| `/dashboard/analytics` | Analytics | — |
| `/dashboard/briefs` | Content Briefs | — |
| `/dashboard/businesses` | Businesses | — |
| `/dashboard/businesses/new` | New Business | — |
| `/dashboard/businesses/[id]/onboard` | Business Onboarding | `[id]` → `businessId` |
| `/dashboard/insights` | Strategy Insights | — |
| `/dashboard/posts` | Posts | — |
| `/dashboard/posts/new` | New Post | — |
| `/dashboard/posts/[id]/edit` | Edit Post | `[id]` → `postId` |
| `/dashboard/posts/repurpose/[groupId]` | Repurpose Post | `[groupId]` → `repurposeGroupId` |
| `/dashboard/review` | Review Queue | — |
| `/dashboard/strategy` | Strategy | — |

If `--page <path>` was provided, filter to only that route.

### 5. Crawl and Screenshot Each Page

For each route in the manifest:

1. **Resize browser** to the target viewport(s):
   - Mobile: 375×812
   - Desktop: 1440×900
   - Respect `--mobile-only` / `--desktop-only` flags

2. **Navigate** to `{baseUrl}{resolvedPath}`

3. **Wait for page to be ready:**
   - Wait for network idle / page load
   - Wait ~1 second for late renders and animations to settle

4. **Take a full-page screenshot** using `browser_take_screenshot`

5. **Record the screenshot** — keep it in context for analysis in the next step

### 6. Analyze Screenshots

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
- **Confidence:** 0.0–1.0 (only report findings with confidence >= 0.5)
- **Complexity:** simple (CSS/copy fix, 1-2 files) or complex (logic/architecture change)
- **Viewport:** mobile / desktop / both

### 7. Create GitHub Issues (unless `--dry-run`)

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

### 8. Summary Report

After processing all routes, output a summary table:

```
Route                    | Score | Findings
-------------------------|-------|----------
/dashboard               |  85   | 2
/dashboard/posts         |  92   | 1
...
```

If `--dry-run`, just report findings without creating issues.

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
