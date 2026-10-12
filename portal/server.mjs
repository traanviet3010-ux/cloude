import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

const PORT = Number(process.env.PORT || 10000);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const GAME_URL = process.env.GAME_URL || 'https://opensro-mobile-test.onrender.com';
const SRO_PROVISIONING_URL = (process.env.SRO_PROVISIONING_URL || '').replace(/\/$/, '');
const SRO_PROVISIONING_TOKEN = process.env.SRO_PROVISIONING_TOKEN || '';

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'accounts.sqlite'));
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA synchronous=FULL;
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT NOT NULL PRIMARY KEY,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0,1)),
    game_synced INTEGER NOT NULL DEFAULT 0 CHECK (game_synced IN (0,1)),
    game_synced_at_ms INTEGER
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS accounts_folded_id ON accounts(lower(id));
  CREATE UNIQUE INDEX IF NOT EXISTS accounts_folded_email ON accounts(lower(email));
`);

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon']
]);

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
}

function json(res, status, body) {
  securityHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}

function validAccountId(value) {
  if (typeof value !== 'string') return false;
  if (!value || value.trim() !== value || Buffer.byteLength(value, 'utf8') > 64) return false;
  if (value === '__open_dev__') return false;
  for (const ch of value) if (/\p{Cc}/u.test(ch)) return false;
  return true;
}

function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validPassword(value) {
  if (typeof value !== 'string') return false;
  const bytes = Buffer.byteLength(value, 'utf8');
  return bytes >= 8 && bytes <= 72;
}

const attempts = new Map();
function allowRegistration(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const max = 10;
  const current = attempts.get(ip) || [];
  const recent = current.filter(t => now - t < windowMs);
  if (recent.length >= max) {
    attempts.set(ip, recent);
    return false;
  }
  recent.push(now);
  attempts.set(ip, recent);
  return true;
}

async function provisionGameAccount(id, password) {
  if (!SRO_PROVISIONING_URL || !SRO_PROVISIONING_TOKEN) return { synced: false };
  const response = await fetch(`${SRO_PROVISIONING_URL}/v1/accounts`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${SRO_PROVISIONING_TOKEN}`
    },
    body: JSON.stringify({ id, password }),
    signal: AbortSignal.timeout(10000)
  });
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(body?.message || `Provisioning failed (${response.status})`);
    error.code = body?.code || 'PROVISIONING_FAILED';
    throw error;
  }
  return { synced: true, account: body };
}

async function handleRegister(req, res) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (!allowRegistration(ip)) return json(res, 429, { ok: false, code: 'RATE_LIMIT', message: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.' });

  let body;
  try { body = await readJson(req); }
  catch (error) {
    return json(res, 400, { ok: false, code: error.message, message: 'Dữ liệu gửi lên không hợp lệ.' });
  }

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = body.password;
  const confirmPassword = body.confirmPassword;

  if (!validAccountId(id)) return json(res, 400, { ok: false, code: 'INVALID_ID', message: 'Tên tài khoản không hợp lệ hoặc dài quá 64 byte.' });
  if (!validEmail(email)) return json(res, 400, { ok: false, code: 'INVALID_EMAIL', message: 'Email không hợp lệ.' });
  if (!validPassword(password)) return json(res, 400, { ok: false, code: 'INVALID_PASSWORD', message: 'Mật khẩu phải từ 8 đến 72 byte.' });
  if (password !== confirmPassword) return json(res, 400, { ok: false, code: 'PASSWORD_MISMATCH', message: 'Mật khẩu nhập lại không khớp.' });

  const duplicate = db.prepare('SELECT id FROM accounts WHERE lower(id)=lower(?) OR lower(email)=lower(?) LIMIT 1').get(id, email);
  if (duplicate) return json(res, 409, { ok: false, code: 'ACCOUNT_EXISTS', message: 'Tên tài khoản hoặc email đã được sử dụng.' });

  let provisioned = { synced: false };
  try {
    provisioned = await provisionGameAccount(id, password);
  } catch (error) {
    if (error.code === 'ACCOUNT_EXISTS') return json(res, 409, { ok: false, code: 'ACCOUNT_EXISTS', message: 'Tài khoản game đã tồn tại.' });
    return json(res, 503, { ok: false, code: error.code || 'GAME_SERVER_OFFLINE', message: 'Máy chủ tài khoản game chưa sẵn sàng. Vui lòng thử lại sau.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const now = Date.now();
  try {
    db.prepare(`INSERT INTO accounts(id,email,password_hash,created_at_ms,game_synced,game_synced_at_ms)
                VALUES(?,?,?,?,?,?)`).run(id, email, passwordHash, now, provisioned.synced ? 1 : 0, provisioned.synced ? now : null);
  } catch {
    return json(res, 409, { ok: false, code: 'ACCOUNT_EXISTS', message: 'Tên tài khoản hoặc email đã được sử dụng.' });
  }

  return json(res, 201, {
    ok: true,
    account: { id, createdAt: new Date(now).toISOString(), gameSynced: provisioned.synced },
    message: provisioned.synced
      ? 'Tạo tài khoản thành công. Anh có thể dùng tài khoản này để đăng nhập game.'
      : 'Tạo tài khoản website thành công. GameWorld riêng chưa được nối nên tài khoản chưa đăng nhập game được.'
  });
}

function statusPayload() {
  const total = db.prepare('SELECT count(*) AS n FROM accounts').get().n;
  const synced = db.prepare('SELECT count(*) AS n FROM accounts WHERE game_synced=1').get().n;
  return {
    ok: true,
    server: 'HieuSRO',
    portalOnline: true,
    gameAccountSync: Boolean(SRO_PROVISIONING_URL && SRO_PROVISIONING_TOKEN),
    totalAccounts: Number(total),
    syncedAccounts: Number(synced),
    gameUrl: GAME_URL
  };
}

function serveFile(req, res) {
  const url = new URL(req.url, 'http://local');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const candidate = path.resolve(PUBLIC, '.' + pathname);
  const relative = path.relative(PUBLIC, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(candidate, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Không tìm thấy');
      return;
    }
    securityHeaders(res);
    res.setHeader('Content-Type', MIME.get(path.extname(candidate).toLowerCase()) || 'application/octet-stream');
    res.setHeader('Cache-Control', path.extname(candidate) === '.html' ? 'no-cache' : 'public, max-age=3600');
    fs.createReadStream(candidate).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, statusPayload());
  if (req.method === 'POST' && url.pathname === '/api/register') return handleRegister(req, res);
  if (req.method === 'GET' && url.pathname === '/play') {
    res.writeHead(302, { Location: GAME_URL });
    return res.end();
  }
  serveFile(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`HieuSRO portal listening on :${PORT}`);
  console.log(`Game account provisioning: ${SRO_PROVISIONING_URL ? 'enabled' : 'pending'}`);
});
