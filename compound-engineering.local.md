---
review_agents:
  - security-sentinel
  - performance-oracle
  - architecture-strategist
  - quality-guardian
---

## Project Context for Reviewers

Next.js 16 App Router + TypeScript social media management platform. Small private team (2 people). Stack: NextAuth v4, Prisma 7 + PostgreSQL, Railway deployment, Tailwind CSS v4 + shadcn/ui.

Key concerns:
- OAuth security (state/CSRF, token storage, refresh rotation)
- Tokens stored in database (not client-side)
- External API integrations: TikTok, YouTube, Instagram, Facebook, Twitter
- Railway deployment with Postgres connection pooling (pg.Pool via PrismaPg adapter)
- Coverage thresholds enforced: 75% statements/branches/lines, 70% functions
