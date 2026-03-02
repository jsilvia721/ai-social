#!/bin/sh
set -e

echo "[start] Pushing database schema..."
node ./node_modules/prisma/build/index.js db push

echo "[start] Starting Next.js server..."
exec node server.js
