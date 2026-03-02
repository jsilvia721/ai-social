#!/bin/sh
set -e

# Railway injects PORT=5432 from the Postgres service. Force port 3000.
export PORT=3000

# Disable TLS cert verification for this process (fallback for proxy SSL connections).
export NODE_TLS_REJECT_UNAUTHORIZED=0

# ── Choose DATABASE_URL ────────────────────────────────────────────────────────
# Prefer private networking (lower latency, no SSL complications).
# postgres.railway.internal resolves to both IPv4 and IPv6. Node.js defaults to
# IPv6 (EHOSTUNREACH — not routable between Railway containers). Resolve IPv4
# explicitly and build a no-SSL URL using it.
PRIVATE_IP=$(node -e "
const dns = require('dns');
dns.lookup('postgres.railway.internal', { family: 4 }, function(err, addr) {
  process.stdout.write(err ? '' : (addr || ''));
});
" 2>/dev/null || true)

if [ -n "$PRIVATE_IP" ] && [ -n "${PGUSER}" ] && [ -n "${PGPASSWORD}" ] && [ -n "${PGDATABASE}" ]; then
  # sslmode=disable: private network, no SSL needed
  export DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PRIVATE_IP}:5432/${PGDATABASE}?sslmode=disable"
  echo "[start] DB: private IPv4 ${PRIVATE_IP}:5432 (no SSL)"
elif [ -n "${RAILWAY_TCP_PROXY_DOMAIN}" ] && [ -n "${RAILWAY_TCP_PROXY_PORT}" ] && [ -n "${PGUSER}" ]; then
  # Public TCP proxy. SSL controlled by pg.Pool ssl option in db.ts.
  export DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${RAILWAY_TCP_PROXY_DOMAIN}:${RAILWAY_TCP_PROXY_PORT}/${PGDATABASE}"
  echo "[start] DB: TCP proxy ${RAILWAY_TCP_PROXY_DOMAIN}:${RAILWAY_TCP_PROXY_PORT}"
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
      let hex = '';
      sock.setTimeout(2000);
      sock.on('data', (b) => { hex += b.toString('hex'); });
      sock.on('timeout', () => {
        console.log('[diag]   TCP ' + host + ':' + port + ' => OK (' + ms + 'ms) — server silent (expected for Postgres)');
        sock.destroy(); resolve(true);
      });
      sock.on('close', () => {
        console.log('[diag]   TCP ' + host + ':' + port + ' => OK (' + ms + 'ms) — server closed immediately' + (hex ? ', first bytes: ' + hex.slice(0, 20) : ''));
        resolve(true);
      });
      sock.on('error', (e) => { resolve(true); });
    });
    sock.on('timeout', () => {
      console.log('[diag]   TCP ' + host + ':' + port + ' => TIMEOUT (5s)');
      sock.destroy(); resolve(false);
    });
    sock.on('error', (e) => {
      console.log('[diag]   TCP ' + host + ':' + port + ' => FAIL: code=' + (e.code || '?') + ' msg=' + e.message);
      resolve(false);
    });
    sock.connect(port, host);
  });
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || '';
  let dbHost = '?', dbPort = 5432;
  try { const u = new URL(dbUrl); dbHost = u.hostname; dbPort = parseInt(u.port) || 5432; } catch (_) {}
  console.log('[diag] DATABASE_URL host: ' + dbHost + ':' + dbPort);

  // DNS for private hostname
  try {
    const r = await dns.lookup('postgres.railway.internal', { all: true });
    console.log('[diag] DNS postgres.railway.internal: ' + r.map(a => a.address + ' (IPv' + a.family + ')').join(', '));
  } catch (e) { console.log('[diag] DNS postgres.railway.internal: FAIL - ' + e.message); }

  // TCP: current DATABASE_URL target
  await tcpTest(dbHost, dbPort);

  // TCP: private hostname directly (to see IPv6 vs IPv4 failure)
  if (dbHost !== 'postgres.railway.internal') {
    await tcpTest('postgres.railway.internal', 5432);
  }

  // pg connection test
  let pg;
  try { pg = require('/app/node_modules/pg'); }
  catch (e) { console.log('[diag] pg module not found at /app/node_modules/pg: ' + e.message); return; }

  const sslDisabled = dbUrl.includes('sslmode=disable');
  const pool = new pg.Pool({
    connectionString: dbUrl,
    ...(sslDisabled ? {} : { ssl: { rejectUnauthorized: false } }),
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 1000,
    max: 1,
  });
  try {
    const r = await pool.query('SELECT current_database() AS db, current_user AS usr');
    console.log('[diag] pg query OK — db=' + r.rows[0].db + ', user=' + r.rows[0].usr);
  } catch (e) {
    console.log('[diag] pg query FAIL: ' + e.message + (e.code ? ' (pg code=' + e.code + ')' : ''));
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch(e => console.log('[diag] unhandled:', e.message));
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
