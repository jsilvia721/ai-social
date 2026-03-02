#!/bin/sh
set -e

# Railway injects PORT=5432 from the Postgres service when DATABASE_URL uses
# ${{Postgres.DATABASE_URL}}. Force the Next.js port to 3000 regardless.
export PORT=3000

echo "[start] Pushing database schema..."
node ./node_modules/prisma/build/index.js db push --url "$DATABASE_URL" \
  && echo "[start] Schema push succeeded." \
  || echo "[start] WARNING: Schema push failed — check DB connectivity. App will start anyway."

echo "[start] Starting Next.js server..."
exec node server.js
