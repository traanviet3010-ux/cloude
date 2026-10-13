import crypto from 'node:crypto';

const ADMIN_PASSWORD = String(process.env.GM_ADMIN_PASSWORD || '');
const SESSION_SECRET = String(process.env.GM_SESSION_SECRET || '');
const COOKIE = 'hieusro_gm';
const TTL_MS = 12 * 60 * 60 * 1000;
export const DISABLED_PASSWORD = 'DISABLED_UNTIL_OWNER_SETS_PASSWORD';

if (!ADMIN_PASSWORD) throw new Error('GM_ADMIN_PASSWORD is required');
if (Buffer.byteLength(SESSION_SECRET, 'utf8') < 32) throw new Error('GM_SESSION_SECRET must be at least 32 bytes');

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return out;
}

function sign(body) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
}

export function loginEnabled() {
  return ADMIN_PASSWORD !== DISABLED_PASSWORD;
}

export function passwordMatches(value) {
  const a = Buffer.from(String(value || ''), 'utf8');
  const b = Buffer.from(ADMIN_PASSWORD, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function issueSession() {
  const payload = Buffer.from(JSON.stringify({ role: 'gm', exp: Date.now() + TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function validSession(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.role === 'gm' && Number.isFinite(data.exp) && data.exp > Date.now();
  } catch {
    return false;
  }
}

export function sessionCookie(token, seconds = Math.floor(TTL_MS / 1000)) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
}
