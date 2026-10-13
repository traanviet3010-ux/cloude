import { issueSession, loginEnabled, passwordMatches, sessionCookie, validSession } from './auth.mjs';

const CONTROL_URL = (process.env.GAME_CONTROL_URL || 'https://hieusro-game-server.onrender.com/gm-api').replace(/\/$/, '');
const VERSION_CONTROL_URL = (process.env.GAME_VERSION_CONTROL_URL || 'https://hieusro-game-server.onrender.com/gm-version-api').replace(/\/$/, '');
const CONTROL_TOKEN = String(process.env.GM_CONTROL_TOKEN || '');
if (Buffer.byteLength(CONTROL_TOKEN, 'utf8') < 32) throw new Error('GM_CONTROL_TOKEN must be at least 32 bytes');

const attempts = new Map();

export function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}

function json(res, status, body, headers = {}) {
  securityHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function readJson(req, limit = 32768) {
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

function sameOrigin(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return origin === `${proto}://${host}`;
}

function allowLogin(ip) {
  const now = Date.now();
  const rows = (attempts.get(ip) || []).filter(t => now - t < 15 * 60 * 1000);
  if (rows.length >= 8) {
    attempts.set(ip, rows);
    return false;
  }
  rows.push(now);
  attempts.set(ip, rows);
  return true;
}

async function remote(base, path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${CONTROL_TOKEN}`,
      'Accept': 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(35000)
  });
  let data = null;
  try { data = await response.json(); } catch {}
  return { status: response.status, data: data ?? { ok: response.ok } };
}

function control(path, method = 'GET', body) {
  return remote(CONTROL_URL, path, method, body);
}

function versionControl(path, method = 'GET', body) {
  return remote(VERSION_CONTROL_URL, path, method, body);
}

function authenticated(req, res) {
  if (!validSession(req)) {
    json(res, 401, { ok: false, code: 'AUTH_REQUIRED', message: 'Vui lòng đăng nhập GM.' });
    return false;
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method || '') && !sameOrigin(req)) {
    json(res, 403, { ok: false, message: 'Yêu cầu không hợp lệ.' });
    return false;
  }
  return true;
}

export async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true });

  if (req.method === 'POST' && url.pathname === '/api/login') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Yêu cầu không hợp lệ.' });
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (!allowLogin(ip)) return json(res, 429, { ok: false, message: 'Thử đăng nhập quá nhiều lần. Vui lòng chờ.' });
    const body = await readJson(req);
    if (!loginEnabled()) return json(res, 503, { ok: false, code: 'GM_NOT_ACTIVATED', message: 'GM Web chưa được kích hoạt mật khẩu quản trị.' });
    if (!passwordMatches(body.password)) return json(res, 401, { ok: false, message: 'Mật khẩu GM không đúng.' });
    attempts.delete(ip);
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(issueSession()) });
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  if (req.method === 'GET' && url.pathname === '/api/me') {
    const ok = validSession(req);
    return json(res, ok ? 200 : 401, { ok, role: ok ? 'superadmin' : null });
  }

  if (!authenticated(req, res)) return;

  if (req.method === 'GET' && url.pathname === '/api/status') {
    const out = await control('/v1/status');
    return json(res, out.status, out.data);
  }
  if (req.method === 'GET' && url.pathname === '/api/settings') {
    const out = await control('/v1/settings');
    return json(res, out.status, out.data);
  }
  if (req.method === 'PUT' && url.pathname === '/api/settings') {
    const out = await control('/v1/settings', 'PUT', await readJson(req));
    return json(res, out.status, out.data);
  }
  if (req.method === 'POST' && url.pathname === '/api/notice') {
    const out = await control('/v1/notice', 'POST', await readJson(req));
    return json(res, out.status, out.data);
  }

  if (req.method === 'GET' && url.pathname === '/api/economy') {
    const out = await control('/v1/economy');
    return json(res, out.status, out.data);
  }
  if (req.method === 'GET' && url.pathname === '/api/event') {
    const out = await control('/v1/event');
    return json(res, out.status, out.data);
  }
  if (req.method === 'POST' && url.pathname === '/api/event/start') {
    const out = await control('/v1/event/start', 'POST', await readJson(req));
    return json(res, out.status, out.data);
  }
  if (req.method === 'POST' && url.pathname === '/api/event/stop') {
    const out = await control('/v1/event/stop', 'POST', {});
    return json(res, out.status, out.data);
  }
  if (req.method === 'GET' && url.pathname === '/api/monsters') {
    const ref = url.searchParams.get('ref') || '';
    const out = await control(`/v1/monsters?ref=${encodeURIComponent(ref)}`);
    return json(res, out.status, out.data);
  }

  if (req.method === 'GET' && url.pathname === '/api/characters/search') {
    const q = url.searchParams.get('q') || '';
    const out = await control(`/v1/characters/search?q=${encodeURIComponent(q)}`);
    return json(res, out.status, out.data);
  }
  let characterMatch = url.pathname.match(/^\/api\/characters\/([^/]+)$/);
  if (req.method === 'GET' && characterMatch) {
    const name = decodeURIComponent(characterMatch[1]);
    const out = await control(`/v1/characters/${encodeURIComponent(name)}`);
    return json(res, out.status, out.data);
  }
  characterMatch = url.pathname.match(/^\/api\/characters\/([^/]+)\/operation$/);
  if (req.method === 'POST' && characterMatch) {
    const name = decodeURIComponent(characterMatch[1]);
    const out = await control(`/v1/characters/${encodeURIComponent(name)}/operation`, 'POST', await readJson(req));
    return json(res, out.status, out.data);
  }

  if (req.method === 'GET' && url.pathname === '/api/versions') {
    const out = await versionControl('/v1/versions');
    return json(res, out.status, out.data);
  }
  const versionMatch = url.pathname.match(/^\/api\/versions\/(v\d+\.\d+\.\d+)\/rollback$/);
  if (req.method === 'POST' && versionMatch) {
    const body = await readJson(req);
    const out = await versionControl(`/v1/versions/${encodeURIComponent(versionMatch[1])}/rollback`, 'POST', {
      force: body.force === true
    });
    return json(res, out.status, out.data);
  }

  let m = url.pathname.match(/^\/api\/accounts\/([^/]+)$/);
  if (req.method === 'GET' && m) {
    const out = await control(`/v1/accounts/${encodeURIComponent(decodeURIComponent(m[1]))}`);
    return json(res, out.status, out.data);
  }
  m = url.pathname.match(/^\/api\/accounts\/([^/]+)\/disabled$/);
  if (req.method === 'PUT' && m) {
    const out = await control(`/v1/accounts/${encodeURIComponent(decodeURIComponent(m[1]))}/disabled`, 'PUT', await readJson(req));
    return json(res, out.status, out.data);
  }
  m = url.pathname.match(/^\/api\/accounts\/([^/]+)\/password$/);
  if (req.method === 'PUT' && m) {
    const out = await control(`/v1/accounts/${encodeURIComponent(decodeURIComponent(m[1]))}/password`, 'PUT', await readJson(req));
    return json(res, out.status, out.data);
  }

  return json(res, 404, { ok: false, message: 'Không tìm thấy API.' });
}
