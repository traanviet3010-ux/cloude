import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { createClient } from 'redis';

const PORT = Number(process.env.PORT || 10000);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const GAME_URL = process.env.GAME_URL || 'https://opensro-mobile-test.onrender.com';
const REDIS_URL = process.env.REDIS_URL || '';
const SRO_PROVISIONING_URL = (process.env.SRO_PROVISIONING_URL || '').replace(/\/$/, '');
const SRO_PROVISIONING_TOKEN = process.env.SRO_PROVISIONING_TOKEN || '';

if (!REDIS_URL) throw new Error('REDIS_URL is required for the account registry');
const registry = createClient({ url: REDIS_URL });
registry.on('error', error => console.error('account registry error:', error.message));
await registry.connect();

const ACCOUNT_SET = 'hieusro:accounts';
const SYNCED_SET = 'hieusro:accounts:synced';
const accountKey = folded => `hieusro:account:${Buffer.from(folded).toString('base64url')}`;
const emailKey = email => `hieusro:email:${Buffer.from(email).toString('base64url')}`;
const foldId = id => id.replace(/[A-Z]/g, c => c.toLowerCase());

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

const reserveAccountScript = `
if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
redis.call('HSET', KEYS[1],
  'id', ARGV[1],
  'email', ARGV[2],
  'passwordHash', ARGV[3],
  'createdAtMs', ARGV[4],
  'disabled', '0',
  'gameSynced', '0')
redis.call('SET', KEYS[2], ARGV[5])
redis.call('SADD', KEYS[3], ARGV[5])
return 1
`;

async function removeLocalAccount(folded, email) {
  const encoded = Buffer.from(folded).toString('base64url');
  await registry.multi()
    .del(accountKey(folded))
    .del(emailKey(email))
    .sRem(ACCOUNT_SET, encoded)
    .sRem(SYNCED_SET, encoded)
    .exec();
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

  const folded = foldId(id);
  const encoded = Buffer.from(folded).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 12);
  const now = Date.now();

  let reserved;
  try {
    reserved = await registry.eval(reserveAccountScript, {
      keys: [accountKey(folded), emailKey(email), ACCOUNT_SET],
      arguments: [id, email, passwordHash, String(now), encoded]
    });
  } catch (error) {
    console.error('account reserve failed:', error.message);
    return json(res, 503, { ok: false, code: 'DATABASE_UNAVAILABLE', message: 'Database tài khoản đang bận. Vui lòng thử lại.' });
  }
  if (Number(reserved) !== 1) return json(res, 409, { ok: false, code: 'ACCOUNT_EXISTS', message: 'Tên tài khoản hoặc email đã được sử dụng.' });

  let provisioned = { synced: false };
  try {
    provisioned = await provisionGameAccount(id, password);
  } catch (error) {
    await removeLocalAccount(folded, email).catch(() => {});
    if (error.code === 'ACCOUNT_EXISTS') return json(res, 409, { ok: false, code: 'ACCOUNT_EXISTS', message: 'Tài khoản game đã tồn tại.' });
    return json(res, 503, { ok: false, code: error.code || 'GAME_SERVER_OFFLINE', message: 'Máy chủ tài khoản game chưa sẵn sàng. Vui lòng thử lại sau.' });
  }

  if (provisioned.synced) {
    await registry.multi()
      .hSet(accountKey(folded), { gameSynced: '1', gameSyncedAtMs: String(Date.now()) })
      .sAdd(SYNCED_SET, encoded)
      .exec();
  }

  return json(res, 201, {
    ok: true,
    account: { id, createdAt: new Date(now).toISOString(), gameSynced: provisioned.synced },
    message: provisioned.synced
      ? 'Tạo tài khoản thành công. Anh có thể dùng tài khoản này để đăng nhập game.'
      : 'Tạo tài khoản website thành công. GameWorld riêng chưa được nối nên tài khoản chưa đăng nhập game được.'
  });
}

async function statusPayload() {
  const [total, synced] = await Promise.all([
    registry.sCard(ACCOUNT_SET),
    registry.sCard(SYNCED_SET)
  ]);
  return {
    ok: true,
    server: 'HieuSRO',
    portalOnline: true,
    registry: 'Render Key Value',
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
  try {
    if (req.method === 'GET' && url.pathname === '/healthz') {
      await registry.ping();
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, await statusPayload());
    if (req.method === 'POST' && url.pathname === '/api/register') return handleRegister(req, res);
    if (req.method === 'GET' && url.pathname === '/play') {
      res.writeHead(302, { Location: GAME_URL });
      return res.end();
    }
    serveFile(req, res);
  } catch (error) {
    console.error('request failed:', error.message);
    if (!res.headersSent) return json(res, 500, { ok: false, message: 'Có lỗi hệ thống. Vui lòng thử lại.' });
    res.end();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`HieuSRO portal listening on :${PORT}`);
  console.log('Account registry: Render Key Value connected');
  console.log(`Game account provisioning: ${SRO_PROVISIONING_URL ? 'enabled' : 'pending'}`);
});
