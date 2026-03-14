---
name: qa-audit
description: Run a visual QA/UX audit of the dashboard using Playwright MCP for screenshots and Claude vision for analysis, then create GitHub issues per finding
allowed-tools: Agent, Bash, Glob, Grep, Read, mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_resize, mcp__playwright__browser_click, mcp__playwright__browser_wait_for, mcp__playwright__browser_console_messages, mcp__playwright__browser_evaluate, mcp__playwright__browser_tabs, mcp__playwright__browser_close
---

# QA/UX Audit Skill

Crawl dashboard pages, take screenshots at mobile and desktop viewports, analyze each for UI/UX issues, and create GitHub issues for findings. This skill is fully autonomous — never stop to ask the user. Attempt autonomous recovery, create self-improvement issues for unrecoverable blockers, and continue auditing remaining pages. Only abort if zero pages load.

**Arguments:** $ARGUMENTS — optional flags:
- `--url <base>` — override base URL (default: `https://d11oxnidmahp76.cloudfront.net`)
- `--dry-run` — skip GitHub issue creation, just report findings
- `--page <path>` — audit a single page instead of the full manifest
- `--mobile-only` / `--desktop-only` — capture only one viewport

**Default test email:** `jsilvia721@gmail.com` (referenced as `{testEmail}`).

## Process

### 1. Parse Arguments

Extract `--url <value>` (default: `https://d11oxnidmahp76.cloudfront.net`), `--dry-run`, `--page <path>`, `--mobile-only`, `--desktop-only`. Determine if target is local (`localhost` or `127.0.0.1`).

### 2. Preflight — Check Target and Auth

```bash
curl -s -o /dev/null -w "%{http_code}" --max-time 5 {baseUrl}/api/test/session?email={testEmail}
```

- **HTTP 200:** Proceed to step 3.
- **HTTP 404:** `PLAYWRIGHT_E2E` not set. If local, proceed to 2a. If remote, create a self-improvement issue and abort.
- **Connection refused / timeout:** If local, proceed to 2a. If remote, create a self-improvement issue and abort.

#### 2a. Autonomous Dev Server Startup (localhost only)

1. Kill existing process on port 3000:
   ```bash
   lsof -ti:3000 | xargs kill -9 2>/dev/null || true
   ```

2. Start dev server:
   ```bash
   PLAYWRIGHT_E2E=true npm run dev > /tmp/qa-audit-dev-server.log 2>&1 &
   echo $! > /tmp/qa-audit-dev-server.pid
   ```

3. Wait up to 30s for ready:
   ```bash
   for i in $(seq 1 30); do
     curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:3000 | grep -q "200\|307\|302" && break
     sleep 1
   done
   ```

4. Re-verify auth. If still failing, check `tail -50 /tmp/qa-audit-dev-server.log`, create a self-improvement issue, and abort.

### 3. Authenticate via Browser

Navigate to `{baseUrl}/api/test/session?email={testEmail}` to set the auth cookie. Verify by navigating to `/dashboard` and checking with `browser_snapshot` that dashboard content loads. If redirected to sign-in, retry once. If still failing, create a self-improvement issue and continue with accessible pages.

### 4. Resolve Dynamic Route Parameters

Navigate to `{baseUrl}/api/test/audit-params` and read the JSON response (`businessId`, `postId`, `repurposeGroupId`). Store for substituting into dynamic routes. If this endpoint fails, skip dynamic routes and continue with static routes only.

### 5. Build Route List

Dynamically discover routes by scanning `src/app/dashboard/**/page.tsx` files. Map each file path to a route:
- `src/app/dashboard/page.tsx` → `/dashboard`
- `src/app/dashboard/posts/page.tsx` → `/dashboard/posts`
- `src/app/dashboard/posts/[id]/edit/page.tsx` → `/dashboard/posts/[id]/edit` (substitute `[id]` → `postId`)
- `src/app/dashboard/businesses/[id]/onboard/page.tsx` → `/dashboard/businesses/[id]/onboard` (substitute `[id]` → `businessId`)
- `src/app/dashboard/posts/repurpose/[groupId]/page.tsx` → `/dashboard/posts/repurpose/[groupId]` (substitute `[groupId]` → `repurposeGroupId`)

**Dynamic param mapping:** `[id]` in a `businesses` path → `businessId`; `[id]` in a `posts` path → `postId`; `[groupId]` → `repurposeGroupId`. Skip any route whose required param is null.

If `--page <path>` was provided, filter to only that route.

### 6. Crawl and Screenshot Each Page

For each route:

1. **Resize browser** to target viewport(s): Mobile 375x812, Desktop 1440x900. Respect `--mobile-only` / `--desktop-only`.
2. **Navigate** to `{baseUrl}{resolvedPath}`
3. **Wait** for page load + ~1 second for animations to settle
4. **Take a full-page screenshot** using `browser_take_screenshot`
5. **Record** the screenshot for analysis

**Per-page error handling:** Record failures, skip to next route. If 3+ consecutive pages fail with the same error, stop the crawl and create a single self-improvement issue for the root cause.

### 7. Analyze Screenshots

For each page, analyze mobile and/or desktop screenshots. Look for:

**Report:** Layout issues, responsive design problems, accessibility concerns, visual polish issues, UX problems, missing empty states.

**Do NOT report:** Missing placeholder content, auth-context issues, browser-specific rendering, performance issues.

For each finding, assess: severity (critical/major/minor/cosmetic), confidence (0.0-1.0, only report >= 0.5), complexity (simple/complex), viewport (mobile/desktop/both).

### 8. Create GitHub Issues (unless `--dry-run`)

Only create issues for findings with **confidence >= 0.7**.

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

<Finding description — what's wrong and how to fix it>

## Suggested Files

Infer from route path: `src/app/<route>/page.tsx` and related components.

## Complexity

<Simple fix — CSS or copy change in 1-2 files. | Complex fix — logic or architectural changes.>

---
_Generated by QA/UX audit skill_
EOF
)"
```

**Deduplication:** Before creating issues, run `gh issue list --label qa-audit --json title --limit 200`. Skip findings matching existing open issues.

### 9. Summary Report

Output a summary table:

```
Route                    | Score | Findings | Status
-------------------------|-------|----------|--------
/dashboard               |  85   | 2        | OK
/dashboard/posts         |  92   | 1        | OK
```

Include: pages audited (N of M), pages failed (with reasons), QA issues created (or "dry run"), infrastructure issues created.

### 10. Cleanup

1. Close browser: `browser_close`
2. If dev server was started in 2a:
   ```bash
   kill $(cat /tmp/qa-audit-dev-server.pid) 2>/dev/null || true
   rm -f /tmp/qa-audit-dev-server.pid /tmp/qa-audit-dev-server.log
   ```

## Self-Improvement Issue Template

```bash
gh issue create \
  --title "[QA-Infra] <blocker description>" \
  --label "qa-audit" --label "claude-self-improvement" \
  --body "$(cat <<'QEOF'
## What was attempted
<exact steps taken>

## What failed
<exact error or behavior>

## Suggested fix
<what would need to change>

## Context
Encountered during autonomous QA audit run.
QEOF
)"
```

Log the issue URL in audit output and continue auditing remaining pages.
