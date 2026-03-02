#!/bin/sh
set -e

# Railway injects PORT=5432 from the Postgres service. Force port 3000.
export PORT=3000

# Disable TLS cert verification for this process. The Postgres TCP proxy cert
# is for postgres.railway.internal, not the proxy hostname, so verification
# fails. Acceptable for a staging environment. Remove once private networking works.
export NODE_TLS_REJECT_UNAUTHORIZED=0

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

# ── Network diagnostics ────────────────────────────────────────────────────────
echo "[diag] Running network diagnostics..."
cat > /tmp/diag.js << 'EOF'
const net = require('net');
const dns = require('dns').promises;

async function tcpTest(host, port) {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = new net.Socket();
    sock.setTimeout(5000);
    sock.on('connect', () => {
      const ms = Date.now() - start;
      console.log('[diag]   TCP ' + host + ':' + port + ' => CONNECTED (' + ms + 'ms)');
      // Read first bytes from server (Postgres sends nothing until client speaks,
      // but if it immediately closes we'll see that here).
      let hex = '';
      sock.setTimeout(2000);
      sock.on('data', (b) => { hex += b.toString('hex'); });
      sock.on('timeout', () => {
        console.log('[diag]   Server first bytes (2s): ' + (hex || '(silence — expected for Postgres)'));
        sock.destroy();
        resolve(true);
      });
      sock.on('close', () => {
        console.log('[diag]   Server first bytes: ' + (hex || '(none)') + ' — server closed connection immediately');
        resolve(true);
      });
      sock.on('error', (e) => {
        console.log('[diag]   Post-connect error: ' + e.message);
        resolve(true);
      });
    });
    sock.on('timeout', () => {
      console.log('[diag]   TCP ' + host + ':' + port + ' => TIMEOUT (5s)');
      sock.destroy();
      resolve(false);
    });
    sock.on('error', (e) => {
      console.log('[diag]   TCP ' + host + ':' + port + ' => ERROR: ' + e.message);
      resolve(false);
    });
    sock.connect(port, host);
  });
}

async function main() {
  console.log('[diag] DATABASE_URL (redacted):', (process.env.DATABASE_URL || '').replace(/:([^:@]+)@/, ':***@'));

  // DNS resolution
  const hosts = ['postgres.railway.internal'];
  if (process.env.RAILWAY_TCP_PROXY_DOMAIN) hosts.push(process.env.RAILWAY_TCP_PROXY_DOMAIN);
  for (const h of hosts) {
    try {
      const addrs = await dns.lookup(h, { all: true });
      console.log('[diag] DNS ' + h + ': ' + addrs.map(a => a.address + ' (IPv' + a.family + ')').join(', '));
    } catch (e) {
      console.log('[diag] DNS ' + h + ': FAILED - ' + e.message);
    }
  }

  // TCP connectivity
  const proxyDomain = process.env.RAILWAY_TCP_PROXY_DOMAIN;
  const proxyPort   = parseInt(process.env.RAILWAY_TCP_PROXY_PORT || '0', 10);
  if (proxyDomain && proxyPort) {
    await tcpTest(proxyDomain, proxyPort);
  }
  await tcpTest('postgres.railway.internal', 5432);

  // pg driver test
  let Pool;
  try { Pool = require('pg').Pool; } catch (e) { console.log('[diag] pg not found:', e.message); return; }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 1000,
    max: 1,
  });
  try {
    const res = await pool.query('SELECT current_database() AS db, current_user AS usr, version() AS ver');
    const row = res.rows[0];
    console.log('[diag] pg query OK — db=' + row.db + ', user=' + row.usr);
    console.log('[diag] pg server: ' + row.ver.split(',')[0]);
  } catch (e) {
    console.log('[diag] pg query FAILED: ' + e.message);
    if (e.code) console.log('[diag] pg error code: ' + e.code);
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch(e => console.log('[diag] Unhandled error:', e.message));
EOF
node /tmp/diag.js 2>&1 || true
echo "[diag] Done."
# ── End diagnostics ────────────────────────────────────────────────────────────

echo "[start] Pushing database schema..."
node ./node_modules/prisma/build/index.js db push --url "$DATABASE_URL" \
  && echo "[start] Schema push succeeded." \
  || echo "[start] WARNING: Schema push failed — continuing anyway."

echo "[start] Starting Next.js server..."
exec node server.js
