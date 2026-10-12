import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_COOKIE = 'hieusro_session';

if (!REDIS_URL) throw new Error('REDIS_URL is required for the account registry');
const registry = createClient({ url: REDIS_URL });
registry.on('error', error => console.error('account registry error:', error.message));
await registry.connect();

const ACCOUNT_SET = 'hieusro:accounts';
const SYNCED_SET = 'hieusro:accounts:synced';
const accountKey = folded => `hieusro:account:${Buffer.from(folded).toString('base64url')}`;
const emailKey = email => `hieusro:email:${Buffer.from(email).toString('base64url')}`;
const sessionKey = token => `hieusro:session:${crypto.createHash('sha256').update(token).digest('hex')}`;
const topupKey = folded => `hieusro:topups:${Buffer.from(folded).toString('base64url')}`;
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

function json(res, status, body, extraHeaders = {}) {
  securityHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
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

function cookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    result[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return result;
}

function sessionCookie(token, maxAge = SESSION_TTL_SECONDS) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function requireAccount(req, res) {
  const token = cookies(req)[SESSION_COOKIE];
  if (!token) {
    json(res, 401, { ok: false, code: 'AUTH_REQUIRED', message: 'Vui lòng đăng nhập.' });
    return null;
  }
  const folded = await registry.get(sessionKey(token));
  if (!folded) {
    json(res, 401, { ok: false, code: 'SESSION_EXPIRED', message: 'Phiên đăng nhập đã hết hạn.' }, { 'Set-Cookie': sessionCookie('', 0) });
    return null;
  }
  const account = await registry.hGetAll(accountKey(folded));
  if (!account?.id || account.disabled === '1') {
    await registry.del(sessionKey(token));
    json(res, 401, { ok: false, code: 'AUTH_REQUIRED', message: 'Tài khoản không khả dụng.' }, { 'Set-Cookie': sessionCookie('', 0) });
    return null;
  }
  return { token, folded, account };
}

function accountView(account) {
  return {
    id: account.id,
    email: account.email,
    createdAt: new Date(Number(account.createdAtMs || 0)).toISOString(),
    gameSynced: account.gameSynced === '1',
    silk: Number(account.silk || 0),
    disabled: account.disabled === '1'
  };
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

function provisioningHeaders() {
  return { 'content-type': 'application/json', 'authorization': `Bearer ${SRO_PROVISIONING_TOKEN}` };
}

async function provisionGameAccount(id, password) {
  if (!SRO_PROVISIONING_URL || !SRO_PROVISIONING_TOKEN) return { synced: false };
  const response = await fetch(`${SRO_PROVISIONING_URL}/v1/accounts`, {
    method: 'POST',
    headers: provisioningHeaders(),
    body: JSON.stringify({ id, password }),
    signal: AbortSignal.timeout(10000)
  });
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(body?.message || `Provisioning failed (${response.status})`);
    error.code = body?.code || 'PROVISIONING_FAILED';
    error.status = response.status;
    throw error;
  }
  return { synced: true, account: body };
}

async function updateGamePassword(id, password) {
  if (!SRO_PROVISIONING_URL || !SRO_PROVISIONING_TOKEN) throw new Error('GAME_SERVER_OFFLINE');
  const response = await fetch(`${SRO_PROVISIONING_URL}/v1/accounts/${encodeURIComponent(id)}/password`, {
    method: 'PUT',
    headers: provisioningHeaders(),
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const error = new Error(response.status === 404 ? 'GAME_ACCOUNT_MISSING' : 'GAME_PASSWORD_UPDATE_FAILED');
    error.status = response.status;
    throw error;
  }
}

async function syncGameAccount(id, password) {
  if (!SRO_PROVISIONING_URL || !SRO_PROVISIONING_TOKEN) return { synced: false, restored: false };
  try {
    await updateGamePassword(id, password);
    return { synced: true, restored: false };
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  try {
    const created = await provisionGameAccount(id, password);
    return { synced: created.synced, restored: created.synced };
  } catch (error) {
    if (error.status === 409 || error.code === 'ACCOUNT_EXISTS') {
      await updateGamePassword(id, password);
      return { synced: true, restored: false };
    }
    throw error;
  }
}

async function markGameSync(folded, synced) {
  const encoded = Buffer.from(folded).toString('base64url');
  if (synced) {
    await registry.multi()
      .hSet(accountKey(folded), { gameSynced: '1', gameSyncedAtMs: String(Date.now()) })
      .sAdd(SYNCED_SET, encoded)
      .exec();
  } else {
    await registry.multi()
      .hSet(accountKey(folded), { gameSynced: '0' })
      .sRem(SYNCED_SET, encoded)
      .exec();
  }
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
  'gameSynced', '0',
  'silk', '0')
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
  catch (error) { return json(res, 400, { ok: false, code: error.message, message: 'Dữ liệu gửi lên không hợp lệ.' }); }

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
  try { provisioned = await provisionGameAccount(id, password); }
  catch (error) {
    await removeLocalAccount(folded, email).catch(() => {});
    if (error.code === 'ACCOUNT_EXISTS') return json(res, 409, { ok: false, code: 'ACCOUNT_EXISTS', message: 'Tài khoản game đã tồn tại.' });
    return json(res, 503, { ok: false, code: error.code || 'GAME_SERVER_OFFLINE', message: 'Máy chủ tài khoản game chưa sẵn sàng. Vui lòng thử lại sau.' });
  }

  if (provisioned.synced) await markGameSync(folded, true);

  return json(res, 201, {
    ok: true,
    account: { id, createdAt: new Date(now).toISOString(), gameSynced: provisioned.synced },
    message: provisioned.synced
      ? 'Tạo tài khoản thành công. Anh có thể dùng tài khoản này để đăng nhập game.'
      : 'Tạo tài khoản website thành công. Anh có thể đăng nhập Trung tâm tài khoản ngay.'
  });
}

async function handleLogin(req, res) {
  let body;
  try { body = await readJson(req); }
  catch { return json(res, 400, { ok: false, message: 'Dữ liệu đăng nhập không hợp lệ.' }); }
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!id || !password) return json(res, 400, { ok: false, message: 'Vui lòng nhập tài khoản và mật khẩu.' });
  const folded = foldId(id);
  const account = await registry.hGetAll(accountKey(folded));
  const valid = Boolean(account?.id && account.disabled !== '1' && account.passwordHash && await bcrypt.compare(password, account.passwordHash));
  if (!valid) return json(res, 401, { ok: false, code: 'INVALID_LOGIN', message: 'Tài khoản hoặc mật khẩu không đúng.' });

  let restored = false;
  if (SRO_PROVISIONING_URL && SRO_PROVISIONING_TOKEN) {
    try {
      const sync = await syncGameAccount(account.id, password);
      if (sync.synced) {
        await markGameSync(folded, true);
        account.gameSynced = '1';
        restored = sync.restored;
        if (restored) console.log(`restored missing game account from portal login: ${account.id}`);
      }
    } catch (error) {
      console.error(`game account sync on login failed for ${account.id}:`, error.message);
      await markGameSync(folded, false).catch(() => {});
      account.gameSynced = '0';
    }
  }

  const token = crypto.randomBytes(32).toString('base64url');
  await registry.set(sessionKey(token), folded, { EX: SESSION_TTL_SECONDS });
  return json(res, 200, { ok: true, account: accountView(account), gameAccountRestored: restored }, { 'Set-Cookie': sessionCookie(token) });
}

async function handleLogout(req, res) {
  const token = cookies(req)[SESSION_COOKIE];
  if (token) await registry.del(sessionKey(token));
  return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
}

async function handleMe(req, res) {
  const auth = await requireAccount(req, res);
  if (!auth) return;
  return json(res, 200, { ok: true, account: accountView(auth.account) });
}

async function handleChangePassword(req, res) {
  const auth = await requireAccount(req, res);
  if (!auth) return;
  let body;
  try { body = await readJson(req); }
  catch { return json(res, 400, { ok: false, message: 'Dữ liệu không hợp lệ.' }); }
  const currentPassword = body.currentPassword;
  const newPassword = body.newPassword;
  const confirmPassword = body.confirmPassword;
  if (!validPassword(newPassword)) return json(res, 400, { ok: false, message: 'Mật khẩu mới phải từ 8 đến 72 byte.' });
  if (newPassword !== confirmPassword) return json(res, 400, { ok: false, message: 'Mật khẩu nhập lại không khớp.' });
  if (!await bcrypt.compare(String(currentPassword || ''), auth.account.passwordHash || '')) return json(res, 401, { ok: false, message: 'Mật khẩu hiện tại không đúng.' });

  let synced = false;
  if (SRO_PROVISIONING_URL && SRO_PROVISIONING_TOKEN) {
    try {
      const sync = await syncGameAccount(auth.account.id, newPassword);
      synced = sync.synced;
    } catch {
      return json(res, 503, { ok: false, message: 'Chưa thể đồng bộ mật khẩu sang máy chủ game. Vui lòng thử lại sau.' });
    }
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await registry.hSet(accountKey(auth.folded), { passwordHash });
  await markGameSync(auth.folded, synced).catch(() => {});
  return json(res, 200, { ok: true, message: synced ? 'Đổi mật khẩu và đồng bộ game thành công.' : 'Đổi mật khẩu thành công.' });
}

async function handleTopups(req, res) {
  const auth = await requireAccount(req, res);
  if (!auth) return;
  const rows = await registry.lRange(topupKey(auth.folded), 0, 49);
  const history = rows.map(row => { try { return JSON.parse(row); } catch { return null; } }).filter(Boolean);
  return json(res, 200, {
    ok: true,
    silk: Number(auth.account.silk || 0),
    paymentEnabled: false,
    message: 'Cổng nạp thẻ thật chưa được kết nối. Không nhập mã thẻ cho tới khi hệ thống báo đã mở.',
    history
  });
}

async function statusPayload() {
  const [total, synced] = await Promise.all([registry.sCard(ACCOUNT_SET), registry.sCard(SYNCED_SET)]);
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
    if (req.method === 'GET' && url.pathname === '/healthz') { await registry.ping(); return json(res, 200, { ok: true }); }
    if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, await statusPayload());
    if (req.method === 'POST' && url.pathname === '/api/register') return handleRegister(req, res);
    if (req.method === 'POST' && url.pathname === '/api/login') return handleLogin(req, res);
    if (req.method === 'POST' && url.pathname === '/api/logout') return handleLogout(req, res);
    if (req.method === 'GET' && url.pathname === '/api/me') return handleMe(req, res);
    if (req.method === 'POST' && url.pathname === '/api/change-password') return handleChangePassword(req, res);
    if (req.method === 'GET' && url.pathname === '/api/topups') return handleTopups(req, res);
    if (req.method === 'GET' && url.pathname === '/play') { res.writeHead(302, { Location: GAME_URL }); return res.end(); }
    serveFile(req, res);
  } catch (error) {
    console.error('request failed:', error.message);
    if (!res.headersSent) return json(res, 500, { ok: false, message: 'Có lỗi hệ thống. Vui lòng thử lại.' });
    res.end();
  }
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`HieuSRO portal listening on :${PORT}`);
  console.log('Account registry: Render Key Value connected');
  console.log(`Game account provisioning: ${SRO_PROVISIONING_URL ? 'enabled' : 'pending'}`);
  try {
    const status = await statusPayload();
    console.log(`Account counts: total=${status.totalAccounts}, synced=${status.syncedAccounts}`);
  } catch (error) {
    console.error('Unable to read account counts:', error.message);
  }
});