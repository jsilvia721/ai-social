#!/bin/sh
set -e

echo "[start] Pushing database schema..."
node ./node_modules/prisma/build/index.js db push --url "$DATABASE_URL" \
  && echo "[start] Schema push succeeded." \
  || echo "[start] WARNING: Schema push failed — check DB connectivity. App will start anyway."

echo "[start] Starting Next.js server..."
exec node server.js
