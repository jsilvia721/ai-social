#!/bin/sh
set -e

# Railway injects PORT=5432 from the Postgres service. Force port 3000.
export PORT=3000

echo "[start] Pushing database schema..."
# Prisma's Rust engine needs sslaccept=accept_invalid_certs to connect through
# Railway's TCP proxy — the proxy cert is issued for postgres.railway.internal,
# not the shinkansen proxy hostname, so standard cert verification fails.
# Build the push URL by adding those params without mutating DATABASE_URL itself.
PUSH_URL=$(node -e "
try {
  const u = new URL(process.env.DATABASE_URL);
  u.searchParams.set('sslmode', 'require');
  u.searchParams.set('sslaccept', 'accept_invalid_certs');
  process.stdout.write(u.toString());
} catch (e) { process.stdout.write(process.env.DATABASE_URL || ''); }
" 2>/dev/null || echo "$DATABASE_URL")

node ./node_modules/prisma/build/index.js db push --url "$PUSH_URL" \
  && echo "[start] Schema push succeeded." \
  || echo "[start] WARNING: Schema push failed — continuing anyway."

echo "[start] Starting Next.js server..."
exec node server.js
