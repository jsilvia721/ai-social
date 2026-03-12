---
paths:
  - "src/components/**"
  - "src/app/**/*.tsx"
  - "e2e/**"
---

# Visual UI Testing

## Tools Available

**Playwright MCP** (`.mcp.json`) — 25 browser tools for navigating, interacting, and inspecting localhost. Default mode uses accessibility tree snapshots (~120 tokens, fast). Say "use Playwright MCP" explicitly in the first message to avoid falling back to Bash-based Playwright.

**agent-browser** (global CLI) — Vercel's headless browser with ref-based element targeting (`@e1`, `@e2`). Used by compound-engineering design agents under the hood. Commands: `agent-browser open <url>`, `agent-browser snapshot`, `agent-browser click @e5`.

## When to Use Visual Verification

- After any UI component change, use Playwright MCP to open localhost and verify the result
- For iterative design polish, use the `design-iterator` agent (compound-engineering) which runs N screenshot-analyze-improve cycles
- For Figma fidelity checks, use `design-implementation-reviewer` or `figma-design-sync` agents
- For responsive testing, explicitly request snapshots at mobile (375px), tablet (768px), and desktop (1440px) widths

## Workflow Patterns

**Quick visual check:** navigate to the changed page with Playwright MCP, take a snapshot, report any issues.

**Iterative refinement:** use the `design-iterator` agent with a target iteration count (e.g., 5 cycles) for deeper polish.

**Responsive validation:** after UI changes, verify at multiple breakpoints — mobile-first is required per project conventions.

## Requirements

- Dev server must be running (`npm run dev`) before using browser tools
- Playwright MCP uses `PLAYWRIGHT_E2E=true` auth bypass when the dev server is started with that env var
- Only use test data in browser sessions — all page content is sent to the Claude API
