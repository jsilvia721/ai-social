#!/bin/sh
set -e

echo "[debug] PORT=$PORT HOSTNAME=$HOSTNAME DATABASE_URL_HOST=$(echo $DATABASE_URL | sed 's|.*@||' | sed 's|/.*||')"
echo "[start] Pushing database schema..."
node ./node_modules/prisma/build/index.js db push --url "$DATABASE_URL" \
  && echo "[start] Schema push succeeded." \
  || echo "[start] WARNING: Schema push failed — check DB connectivity. App will start anyway."

echo "[start] Starting Next.js server..."
exec node server.js
