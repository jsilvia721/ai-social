FROM node:22-alpine AS base

# ── Stage 1: install dependencies ──────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ── Stage 2: build ─────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client for the target platform
RUN npx prisma generate

ENV NEXT_TELEMETRY_DISABLED=1
# Dummy env vars so next build doesn't crash on env validation.
# Real values are injected at runtime via docker-compose / your VPS.
ENV DATABASE_URL=postgresql://placeholder:placeholder@placeholder/placeholder
ENV NEXTAUTH_SECRET=placeholder
ENV NEXTAUTH_URL=http://localhost:3000
ENV GOOGLE_CLIENT_ID=placeholder
ENV GOOGLE_CLIENT_SECRET=placeholder
ENV TWITTER_CLIENT_ID=placeholder
ENV TWITTER_CLIENT_SECRET=placeholder
ENV META_APP_ID=placeholder
ENV META_APP_SECRET=placeholder
ENV ANTHROPIC_API_KEY=placeholder
ENV ALLOWED_EMAILS=placeholder@example.com
ENV MINIO_ENDPOINT=https://placeholder.r2.cloudflarestorage.com
ENV MINIO_ACCESS_KEY=placeholder
ENV MINIO_SECRET_KEY=placeholder
ENV MINIO_BUCKET=ai-social
ENV MINIO_PUBLIC_URL=https://placeholder.r2.dev

RUN npm run build

# ── Stage 3: runtime ───────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Next.js standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma: generated client binary + CLI (for db push on startup) + schema
COPY --from=builder /app/node_modules/.prisma        ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/node_modules/prisma         ./node_modules/prisma
COPY --from=builder /app/prisma                      ./prisma

COPY docker/start.sh ./start.sh
RUN chmod +x ./start.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["./start.sh"]
