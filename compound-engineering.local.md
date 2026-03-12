---
review_agents:
  - kieran-typescript-reviewer
  - code-simplicity-reviewer
  - security-sentinel
  - performance-oracle
  - architecture-strategist
  - data-integrity-guardian
  - deployment-verification-agent
plan_review_agents:
  - kieran-typescript-reviewer
  - code-simplicity-reviewer
  - architecture-strategist
---

# Review Context

- Next.js 16 App Router with TypeScript, deployed on AWS Lambda via SST v3 Ion
- Prisma 7 with dual adapter (Neon WebSocket for Lambda, pg.Pool for local/CI)
- All API routes require auth via `getServerSession` — scope queries to `session.user.id`
- OAuth tokens are AES-256-GCM encrypted — review crypto usage carefully
- Platform publishing via Blotato unified API — check SSRF guards on media URLs
- Dark mode only, Tailwind v4 + shadcn/ui (canary)
- Coverage thresholds enforced: 75% statements/branches/lines, 70% functions
- SST v3 Ion deploys to AWS Lambda/CloudFront with 14+ secrets from SSM Parameter Store
- EventBridge crons: publish (every minute, concurrency: 1), metrics (every hour, cap 50)
- Prior deployment failures documented in docs/solutions/ — check before any infra changes
