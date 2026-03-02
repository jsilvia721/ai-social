#!/bin/sh
set -e

# Railway injects PORT=5432 from the Postgres service. Force port 3000.
export PORT=3000

# Railway private networking (postgres.railway.internal) uses IPv6 which causes
# ECONNREFUSED in some container configs. If TCP proxy vars are available, use
# the public proxy URL for the app. sslmode=require is the correct mode for
# Railway's TCP proxy (shinkansen.proxy.rlwy.net style hostnames).
if [ -n "${RAILWAY_TCP_PROXY_DOMAIN}" ] && [ -n "${RAILWAY_TCP_PROXY_PORT}" ]; then
  # sslmode=require: server requires SSL. Cert verification is handled in the
  # pg.Pool (ssl: { rejectUnauthorized: false }) rather than the connection
  # string, so the hostname mismatch between proxy and cert doesn't block us.
  # No sslmode in URL — SSL is controlled by pg.Pool's ssl option in db.ts
  # (ssl: { rejectUnauthorized: false }), which allows SSL without cert verify.
  # Including sslmode=require in the URL would override rejectUnauthorized.
  export DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${RAILWAY_TCP_PROXY_DOMAIN}:${RAILWAY_TCP_PROXY_PORT}/${PGDATABASE}"
  echo "[start] DB: public TCP proxy (${RAILWAY_TCP_PROXY_DOMAIN}:${RAILWAY_TCP_PROXY_PORT})"
else
  echo "[start] DB: using injected DATABASE_URL"
fi

echo "[start] Pushing database schema..."
node ./node_modules/prisma/build/index.js db push --url "$DATABASE_URL" \
  && echo "[start] Schema push succeeded." \
  || echo "[start] WARNING: Schema push failed — continuing anyway."

echo "[start] Starting Next.js server..."
exec node server.js
