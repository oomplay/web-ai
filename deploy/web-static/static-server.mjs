// =============================================================================
// Minimal static file server for apps/web/dist (production frontend).
// =============================================================================
// Why this exists: the Node API (apps/api) intentionally serves NO static
// files, so `https://chat.kiwicraft.in/` needs a second loopback-only origin
// server. cloudflared routes:
//   /api/*        -> 127.0.0.1:8787 (the API)
//   everything    -> 127.0.0.1:8788 (this server)
// The public TLS termination stays at Cloudflare Edge; this process binds
// 127.0.0.1 only and is never directly reachable from the internet.
//
// Zero npm dependencies (node:http + node:fs only) so `npm ci` on the host
// stays untouched. Run under systemd as the unprivileged `web-ai` user:
//   ExecStart=/usr/bin/node deploy/web-static/static-server.mjs
// with WorkingDirectory=/opt/web-ai. The server resolves the dist dir
// relative to its own file location, so the CWD only matters for nothing.
// =============================================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.STATIC_PORT ?? '8788', 10);
const DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'apps',
  'web',
  'dist',
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function serveFile(res, filePath, cacheControl) {
  let body;
  try {
    body = fs.readFileSync(filePath);
  } catch {
    send(res, 404, 'not found\n');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  send(res, 200, body, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);

  // Path traversal guard: resolve and require the result to stay in DIST.
  const resolved = path.resolve(path.join(DIST, pathname));
  if (resolved !== DIST && !resolved.startsWith(DIST + path.sep)) {
    send(res, 403, 'forbidden\n');
    return;
  }

  let filePath = resolved;
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    // SPA fallback: the app is a single-page client-side router, so any
    // unknown non-asset path serves index.html (200, not 404).
    if (path.extname(pathname) === '') {
      filePath = path.join(DIST, 'index.html');
    } else {
      send(res, 404, 'not found\n');
      return;
    }
  }

  // Hashed bundle assets are content-addressed; cache them for a year.
  // index.html / robots.txt / sitemap.xml / ads.txt must revalidate.
  const isHashedAsset = pathname.startsWith('/assets/');
  serveFile(
    res,
    filePath,
    isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  );
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[web-static] serving ${DIST} on http://${HOST}:${PORT}`);
});
