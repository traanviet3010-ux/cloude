import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi, securityHeaders } from './api.mjs';

const PORT = Number(process.env.PORT || 10000);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png']
]);

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
  try {
    const url = new URL(req.url, 'http://local');
    if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') {
      return await handleApi(req, res, url);
    }
    serveFile(req, res);
  } catch (error) {
    console.error('GM request failed:', error.message);
    if (!res.headersSent) {
      securityHeaders(res);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: 'Có lỗi hệ thống GM.' }));
    }
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`HieuSRO GM Web listening on :${PORT}`));
