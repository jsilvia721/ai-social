#!/bin/sh
set -e

# Railway injects PORT=5432 from the Postgres service. Force port 3000.
export PORT=3000

# Disable TLS cert verification (fallback for proxy SSL connections).
export NODE_TLS_REJECT_UNAUTHORIZED=0

# ── Choose DATABASE_URL ────────────────────────────────────────────────────────
# postgres.railway.internal resolves to both IPv4 and IPv6. Railway's Postgres
# listens on IPv4 only on the private mesh, so connecting via the hostname lets
# Node.js pick IPv6 → ECONNREFUSED. Fix: resolve to IPv4 and patch DATABASE_URL
# in-place (preserving the injected credentials). sslmode=disable — no SSL on
# the private network.
PRIVATE_URL=$(node -e "
const dns = require('dns');
dns.lookup('postgres.railway.internal', { family: 4 }, function(err, addr) {
  if (err || !addr) { process.exit(1); }
  try {
    const u = new URL(process.env.DATABASE_URL);
    u.hostname = addr;
    u.port     = '5432';
    u.search   = '?sslmode=disable';
    process.stdout.write(u.toString());
  } catch (e) { process.exit(1); }
});
" 2>/dev/null || true)

if [ -n "$PRIVATE_URL" ]; then
  export DATABASE_URL="$PRIVATE_URL"
  echo "[start] DB: private IPv4 (postgres.railway.internal → sslmode=disable)"
else
  echo "[start] DB: using injected DATABASE_URL (private IPv4 resolution failed)"
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
        console.log('[diag]   TCP ' + host + ':' + port + ' => OK (' + ms + 'ms) — server closed' + (hex ? ', bytes: ' + hex.slice(0, 20) : ''));
        resolve(true);
      });
      sock.on('error', () => { resolve(true); });
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

  try {
    const r = await dns.lookup('postgres.railway.internal', { all: true });
    console.log('[diag] DNS postgres.railway.internal: ' + r.map(a => a.address + ' (IPv' + a.family + ')').join(', '));
  } catch (e) { console.log('[diag] DNS postgres.railway.internal: FAIL - ' + e.message); }

  await tcpTest(dbHost, dbPort);
  if (dbHost !== 'postgres.railway.internal') {
    await tcpTest('postgres.railway.internal', 5432);
  }

  let pg;
  try { pg = require('/app/node_modules/pg'); }
  catch (e) { console.log('[diag] pg not found: ' + e.message); return; }

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
    console.log('[diag] pg query FAIL: ' + e.message + (e.code ? ' (code=' + e.code + ')' : ''));
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
