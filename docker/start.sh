#!/bin/sh
set -e

echo "[start] Syncing database schema..."
node node_modules/prisma/build/index.js db push --accept-data-loss

echo "[start] Starting Next.js server..."
exec node server.js
