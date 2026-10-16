#!/usr/bin/env node
'use strict';
/**
 * AURA backend: serves the AURA app and a small JSON API on top of JioSaavn.
 * No dependencies. Node 18 or newer.
 *
 *   node server.js            -> http://localhost:3000
 *   PORT=8080 node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const js = require('./jiosaavn');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function sendJSON(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

const routes = [
  [/^\/api\/health$/, async () => ({ ok: true, source: 'jiosaavn', version: 1 })],
  [/^\/api\/home$/, () => js.home()],
  [/^\/api\/search$/, (m, q) => js.search(q.get('q'), q.get('type') || 'all', Number(q.get('page')) || 1)],
  [/^\/api\/songs\/([^/]+)$/, (m) => js.songs(decodeURIComponent(m[1]).split(',').slice(0, 50))],
  [/^\/api\/albums\/([^/]+)$/, (m) => js.album(decodeURIComponent(m[1]))],
  [/^\/api\/artists\/([^/]+)$/, (m) => js.artist(decodeURIComponent(m[1]))],
  [/^\/api\/playlists\/([^/]+)$/, (m) => js.playlist(decodeURIComponent(m[1]))],
  [/^\/api\/lyrics\/([^/]+)$/, (m) => js.lyrics(decodeURIComponent(m[1]))],
  [/^\/api\/radio\/song\/([^/]+)$/, (m, q) => js.songRadio(decodeURIComponent(m[1]), Math.min(50, Number(q.get('n')) || 20))],
  [/^\/api\/radio\/featured$/, (m, q) => js.featuredRadio(q.get('name'), q.get('lang') || '', q.get('kind') || 'featured', Math.min(50, Number(q.get('n')) || 20))],
];

async function stream(req, res, id, retried = false) {
  let url;
  try { url = await js.streamUrl(id); } catch (e) { return sendJSON(res, 502, { error: e.message }); }
  const headers = { 'User-Agent': js.UA };
  if (req.headers.range) headers.Range = req.headers.range;
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  let up;
  try { up = await fetch(url, { headers, signal: ac.signal }); }
  catch (e) { if (!res.headersSent && !ac.signal.aborted) sendJSON(res, 502, { error: 'Stream unavailable' }); return; }
  if ((up.status === 403 || up.status === 410) && !retried) { // signed link expired
    js.forgetStream(id);
    return stream(req, res, id, true);
  }
  if (up.status >= 400) return sendJSON(res, 502, { error: `Stream unavailable (HTTP ${up.status})` });
  const out = { 'Content-Type': up.headers.get('content-type') || 'audio/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  for (const k of ['content-length', 'content-range']) { const v = up.headers.get(k); if (v) out[k] = v; }
  res.writeHead(up.status, out);
  if (!up.body) return res.end();
  Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res);
}

// index.html is written as a page body (the same file is published as a hosted artifact),
// so the server adds the document shell around it.
const SHELL_HEAD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#111514">
<meta name="description" content="AURA. Listen to your heart’s desire.">
<link rel="icon" href="/logo-64.png" type="image/png">
<link rel="apple-touch-icon" href="/logo-192.png">
<link rel="manifest" href="/manifest.webmanifest">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px/1.4 system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
`;

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    if (file.endsWith('index.html')) buf = Buffer.concat([Buffer.from(SHELL_HEAD), buf, Buffer.from('\n</body>\n</html>\n')]);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  const sm = u.pathname.match(/^\/api\/stream\/([^/]+)$/);
  if (sm) return stream(req, res, decodeURIComponent(sm[1]));
  if (u.pathname.startsWith('/api/')) {
    for (const [re, fn] of routes) {
      const m = u.pathname.match(re);
      if (!m) continue;
      try { return sendJSON(res, 200, await fn(m, u.searchParams)); }
      catch (e) { console.error(`[api] ${u.pathname}: ${e.message}`); return sendJSON(res, 502, { error: e.message }); }
    }
    return sendJSON(res, 404, { error: 'Unknown endpoint' });
  }
  serveStatic(req, res, u.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`AURA is running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (js.BASE !== 'https://www.jiosaavn.com/api.php') console.log(`(using JioSaavn base ${js.BASE})`);
});
