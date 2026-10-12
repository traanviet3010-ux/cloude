import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 10000);
const PUBLIC = fileURLToPath(new URL("./public/", import.meta.url));
const ASSET_UPSTREAM_HOST = process.env.OPENSRO_ASSET_UPSTREAM_HOST || "opensro.online";
const GAME_UPSTREAM_HOST = process.env.HIEUSRO_GAME_UPSTREAM_HOST || "hieusro-game-server.onrender.com";
const LANGUAGE_COOKIE = "hieusro_lang";
const LOCALIZED_TEXT = /^\/assets\/text\/(textuisystem|textzonename|textdataname|texthelp)\.en\.json$/;
const MESSAGE_TIPS_PATH = "/assets/text/messagetips.en.json";
let localizedTipsCache = { body: null, expiresAt: 0 };

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".wasm", "application/wasm"],
  [".map", "application/json; charset=utf-8"]
]);

function secureHeaders(res) {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function cookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const at = part.indexOf("=");
    if (at < 1) continue;
    if (part.slice(0, at).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(at + 1).trim()); }
    catch { return part.slice(at + 1).trim(); }
  }
  return "";
}

function selectedLanguage(req) {
  return cookie(req, LANGUAGE_COOKIE) === "en" ? "en" : "vi";
}

function localizedRoute(req, pathname) {
  const match = LOCALIZED_TEXT.exec(pathname);
  if (!match || selectedLanguage(req) !== "vi") return null;
  return {
    host: GAME_UPSTREAM_HOST,
    path: `/i18n/${match[1]}.vi.json`,
    localized: true
  };
}

function localCandidate(pathname) {
  const candidate = path.resolve(PUBLIC, "." + pathname);
  const relative = path.relative(PUBLIC, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return candidate;
}

function localFileExists(pathname) {
  const candidate = localCandidate(pathname);
  if (!candidate) return false;
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function copyProxyHeaders(source, target) {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (["connection", "upgrade", "host", "content-length"].includes(lower)) continue;
    target.setHeader(key, value);
  }
}

function upstreamFor(pathname) {
  if (pathname.startsWith("/assets/") || pathname === "/assets") {
    return ASSET_UPSTREAM_HOST;
  }
  return GAME_UPSTREAM_HOST;
}

function proxyHttp(req, res) {
  const parsed = new URL(req.url, "http://local");
  const pathname = decodeURIComponent(parsed.pathname);
  const localized = localizedRoute(req, pathname);
  const upstreamHost = localized?.host || upstreamFor(pathname);
  const upstreamPath = localized?.path || req.url;
  const headers = { ...req.headers, host: upstreamHost };
  headers["x-forwarded-host"] = req.headers.host || "";
  headers["x-forwarded-proto"] = "https";
  delete headers.connection;

  // The asset worker now sends the language cookie to this same-origin edge so
  // localized catalogues can be selected here. Never forward that cookie to
  // the public asset host or game runtime after the selection has been made.
  if (pathname.startsWith("/assets/")) delete headers.cookie;

  const upstream = https.request({
    protocol: "https:",
    hostname: upstreamHost,
    port: 443,
    method: req.method,
    path: upstreamPath,
    headers
  }, upstreamRes => {
    res.statusCode = upstreamRes.statusCode || 502;
    copyProxyHeaders(upstreamRes.headers, res);
    if (pathname.startsWith("/assets/")) {
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    }
    if (LOCALIZED_TEXT.test(pathname) || pathname === MESSAGE_TIPS_PATH) {
      res.setHeader("Vary", "Cookie");
      res.setHeader("Cache-Control", "no-cache");
    }
    console.log(`[proxy] ${req.method} ${req.url} -> ${upstreamHost}${localized ? upstreamPath : ""} ${res.statusCode} lang=${selectedLanguage(req)}`);
    upstreamRes.pipe(res);
  });
  upstream.on("error", error => {
    console.error(`[proxy:error] ${req.method} ${req.url} -> ${upstreamHost}: ${error.message}`);
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`HieuSRO upstream error: ${error.message}`);
  });
  req.pipe(upstream);
}

async function localizedMessageTips(req, res) {
  if (req.method !== "GET" || selectedLanguage(req) !== "vi") return false;
  const now = Date.now();
  try {
    if (!localizedTipsCache.body || localizedTipsCache.expiresAt <= now) {
      const [tipsResponse, helpResponse] = await Promise.all([
        fetch(`https://${ASSET_UPSTREAM_HOST}${MESSAGE_TIPS_PATH}`, { signal: AbortSignal.timeout(10000) }),
        fetch(`https://${GAME_UPSTREAM_HOST}/i18n/texthelp.vi.json`, { signal: AbortSignal.timeout(10000) })
      ]);
      if (!tipsResponse.ok) throw new Error(`English message tips ${tipsResponse.status}`);
      if (!helpResponse.ok) throw new Error(`Vietnamese help text ${helpResponse.status}`);
      const tips = await tipsResponse.json();
      const help = await helpResponse.json();
      const entries = help?.entries && typeof help.entries === "object" ? help.entries : {};
      const apply = row => {
        if (!row || typeof row !== "object" || typeof row.textKey !== "string") return;
        const value = entries[row.textKey];
        if (typeof value === "string" && value) row.text = value;
      };
      for (const row of tips.rows || []) apply(row);
      for (const row of Object.values(tips.rowsById || {})) apply(row);
      for (const row of Object.values(tips.rowsByTextKey || {})) apply(row);
      tips.language = "vi";
      tips.fallbackLanguage = "en";
      localizedTipsCache = {
        body: JSON.stringify(tips),
        expiresAt: now + 5 * 60 * 1000
      };
    }
    secureHeaders(res);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Vary", "Cookie");
    res.end(localizedTipsCache.body);
    console.log(`[i18n] GET ${MESSAGE_TIPS_PATH} -> merged vi catalogue 200`);
    return true;
  } catch (error) {
    console.error(`[i18n:error] message tips: ${error.message}; falling back to English`);
    return false;
  }
}

function serveStatic(req, res) {
  const parsed = new URL(req.url, "http://local");
  let pathname = decodeURIComponent(parsed.pathname);
  if (pathname === "/") pathname = "/index.html";
  const candidate = localCandidate(pathname);
  if (!candidate) {
    res.writeHead(403).end();
    return;
  }

  fs.stat(candidate, (err, stat) => {
    if (!err && stat.isFile()) {
      secureHeaders(res);
      const ext = path.extname(candidate).toLowerCase();
      res.setHeader("Content-Type", MIME.get(ext) || "application/octet-stream");
      if (/\-[\w-]{8,}\.(?:js|css)$/i.test(candidate)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "no-cache");
      }
      if (req.method === "HEAD") {
        res.setHeader("Content-Length", stat.size);
        res.end();
        return;
      }
      fs.createReadStream(candidate).pipe(res);
      return;
    }

    if (!path.extname(pathname)) {
      const index = path.join(PUBLIC, "index.html");
      secureHeaders(res);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      fs.createReadStream(index).pipe(res);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://local").pathname);

    if (pathname.startsWith("/assets/") && localFileExists(pathname)) {
      serveStatic(req, res);
      return;
    }

    if (pathname === MESSAGE_TIPS_PATH && await localizedMessageTips(req, res)) return;

    if (
      pathname.startsWith("/assets/") || pathname === "/assets" ||
      pathname.startsWith("/api/") || pathname === "/api" ||
      pathname.startsWith("/shards/")
    ) {
      proxyHttp(req, res);
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    if (!res.headersSent) res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end(String(error));
  }
});

server.on("upgrade", (req, clientSocket, head) => {
  let pathname;
  try {
    pathname = new URL(req.url, "http://local").pathname;
  } catch {
    clientSocket.destroy();
    return;
  }
  if (!pathname.startsWith("/shards/")) {
    clientSocket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    clientSocket.destroy();
    return;
  }

  const upstreamHost = GAME_UPSTREAM_HOST;
  const upstream = tls.connect({ host: upstreamHost, port: 443, servername: upstreamHost }, () => {
    const requestLines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      const lower = key.toLowerCase();
      if (lower === "host") requestLines.push(`Host: ${upstreamHost}`);
      else if (Array.isArray(value)) for (const v of value) requestLines.push(`${key}: ${v}`);
      else requestLines.push(`${key}: ${value}`);
    }
    requestLines.push("X-Forwarded-Proto: https", "", "");
    upstream.write(requestLines.join("\r\n"));
    if (head?.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });

  const close = () => {
    if (!clientSocket.destroyed) clientSocket.destroy();
    if (!upstream.destroyed) upstream.destroy();
  };
  upstream.on("error", close);
  clientSocket.on("error", close);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`HieuSRO client edge listening on :${PORT}; assets=${ASSET_UPSTREAM_HOST}; game=${GAME_UPSTREAM_HOST}; defaultLang=vi`);
});