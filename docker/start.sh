#!/bin/sh
set -e

echo "[start] Pushing database schema..."
node ./node_modules/prisma/build/index.js db push --skip-generate

echo "[start] Starting Next.js server..."
exec node server.js
