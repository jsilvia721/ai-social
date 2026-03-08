---
review_agents:
  - kieran-typescript-reviewer
  - code-simplicity-reviewer
  - security-sentinel
  - performance-oracle
plan_review_agents:
  - kieran-typescript-reviewer
  - code-simplicity-reviewer
---

# Review Context

- Next.js 16 App Router with TypeScript, deployed on AWS Lambda via SST v3 Ion
- Prisma 7 with dual adapter (Neon WebSocket for Lambda, pg.Pool for local/CI)
- All API routes require auth via `getServerSession` — scope queries to `session.user.id`
- OAuth tokens are AES-256-GCM encrypted — review crypto usage carefully
- Platform publishing via Blotato unified API — check SSRF guards on media URLs
- Dark mode only, Tailwind v4 + shadcn/ui (canary)
- Coverage thresholds enforced: 75% statements/branches/lines, 70% functions
