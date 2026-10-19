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
const charts = require('./charts');
const sources = require('./sources');
charts.setYouTube({ official: (cc) => sources.youtubeChart(cc), song: (id, t, a, img) => sources.ytSong(id, t, a, img) });

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PASSWORD = process.env.AURA_PASSWORD || '';
const crypto = require('crypto');

// On a cloud host AURA must be password-protected: it's your personal player, not a public site.
const ON_CLOUD = !!(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME || process.env.KOYEB_APP_NAME);
if (ON_CLOUD && !PASSWORD) {
  console.error('AURA_PASSWORD is not set. Add it in your host\'s environment settings so only you can open AURA.');
  process.exit(1);
}
function allowed(req) {
  if (!PASSWORD) return true;
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return false;
  const given = Buffer.from(m[1], 'base64').toString('utf8').split(':').slice(1).join(':');
  const a = crypto.createHash('sha256').update(given).digest(), b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}
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

// what the JioSaavn web player sends along with audio requests
const SITE_HEADERS = { Referer: 'https://www.jiosaavn.com/', Origin: 'https://www.jiosaavn.com' };

const routes = [
  [/^\/api\/health$/, async () => ({ ok: true, version: 1, build: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || 'local', charts: charts.catalogue().map((c) => c.id + ':' + c.charts.length).join(' ') })],
  [/^\/api\/streamcheck\/([^/]+)$/, async (m) => {
    try {
      const url = await sources.streamUrl(decodeURIComponent(m[1]));
      const r = await fetch(url, { headers: { Range: 'bytes=0-1', 'User-Agent': js.UA, ...(/saavncdn\.com/i.test(url) ? SITE_HEADERS : {}) } });
      return r.ok ? { ok: true } : { ok: false, error: `the song’s audio server refused it (HTTP ${r.status}); it may not be licensed where this server runs` };
    } catch (e) { return { ok: false, error: e.message }; }
  }],
  [/^\/api\/diagnose$/, async (m, q) => {
    // Plain report of each playback step, to see exactly where a song gets refused.
    const report = { server_region: process.env.RENDER_REGION || process.env.AURA_REGION || 'unknown' };
    try {
      const out = await js.search(q.get('q') || 'Kesariya', 'songs');
      const s = out.songs[0];
      if (!s) return { ...report, step: 'search', ok: false, detail: 'search returned no songs' };
      report.song = `${s.title} (${s.id})`;
      let url;
      try { url = await js.streamUrl(s.id); } catch (e) { return { ...report, step: 'stream link', ok: false, detail: e.message }; }
      const u = new URL(url);
      report.audio_host = u.host;
      report.link_is_signed = /[?&](Expires|Signature|token|hdnea|hdntl)/i.test(u.search);
      const tryWith = async (extra) => (await fetch(url, { headers: { Range: 'bytes=0-1', 'User-Agent': js.UA, ...extra } })).status;
      report.with_site_headers_status = await tryWith(SITE_HEADERS);
      const r = await fetch(url, { headers: { Range: 'bytes=0-1', 'User-Agent': js.UA } });
      report.audio_status = r.status;
      const h = {};
      for (const k of ['server', 'x-cache', 'x-amz-cf-pop', 'x-akamai-reference', 'via', 'content-type']) { const v = r.headers.get(k); if (v) h[k] = v; }
      report.audio_headers = h;
      if (!r.ok && report.with_site_headers_status >= 400) {
        const text = (await r.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
        report.audio_body = text;
        report.likely = /country|region|geo|location/i.test(text) ? 'blocked in this country/region'
          : /expired|signature|token/i.test(text) ? 'stream link rejected (signature/expiry)'
          : 'refused by the audio server; see audio_body';
      }
      // AURA always sends the site headers, so that's the test that matters; the bare request is only for comparison.
      const works = report.with_site_headers_status < 400;
      report.audio_status_without_site_headers = r.status;
      delete report.audio_status;
      report.verdict = works ? 'OK: JioSaavn audio works through AURA (a bare request is refused by design, AURA adds the headers)' : 'Refused even with the site headers; see audio_body';
      return { ...report, step: 'audio', ok: works };
    } catch (e) { return { ...report, ok: false, detail: e.message }; }
  }],
  [/^\/api\/charts$/, async () => ({ sources: charts.catalogue() })],
  [/^\/api\/charts\/([a-z]+)\/([a-z0-9_]+)$/, (m) => charts.chart(m[1], m[2])],
  [/^\/api\/home$/, () => js.home()],
  [/^\/api\/search$/, (m, q) => sources.search(q.get('q'), q.get('type') || 'all', Number(q.get('page')) || 1)],
  [/^\/api\/youtube\/resolve$/, async (m, q) => ({ video: await sources.youtubeResolve(String(q.get('q') || '').slice(0, 200)) })],
  [/^\/api\/sources$/, async () => ({ sources: sources.list() })],
  [/^\/api\/sources\/check$/, (m, q) => sources.check(q.get('q') || 'love')],
  [/^\/api\/songs\/([^/]+)$/, (m) => js.songs(decodeURIComponent(m[1]).split(',').slice(0, 50))],
  [/^\/api\/albums\/([^/]+)$/, (m) => js.album(decodeURIComponent(m[1]))],
  [/^\/api\/artists\/([^/]+)$/, (m) => js.artist(decodeURIComponent(m[1]))],
  [/^\/api\/playlists\/([^/]+)$/, (m) => js.playlist(decodeURIComponent(m[1]))],
  [/^\/api\/lyrics\/([^/]+)$/, (m) => js.lyrics(decodeURIComponent(m[1]))],
  [/^\/api\/radio\/song\/([^/]+)$/, (m, q) => js.songRadio(decodeURIComponent(m[1]), Math.min(50, Number(q.get('n')) || 20))],
  [/^\/api\/radio\/featured$/, (m, q) => js.featuredRadio(q.get('name'), q.get('lang') || '', q.get('kind') || 'featured', Math.min(50, Number(q.get('n')) || 20))],
];

async function stream(req, res, id, retried = false, opts = null, q = '', swapped = false) {
  // If this copy of the song can't be played, play the same song from another source (q = "title artist").
  const other = async (why) => {
    const alt = !swapped && q ? await sources.alternate(q, id, opts).catch(() => null) : null;
    if (alt) return stream(req, res, alt.id, false, opts, q, true);
    return sendJSON(res, 502, { error: why });
  };
  let url;
  try { url = await sources.streamUrl(id, opts); } catch (e) { return other(e.message); }
  const headers = { 'User-Agent': js.UA };
  if (/saavncdn\.com/i.test(url)) Object.assign(headers, SITE_HEADERS); // only JioSaavn's audio servers want the site headers
  if (req.headers.range) headers.Range = req.headers.range;
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  let up;
  try { up = await fetch(url, { headers, signal: ac.signal }); }
  catch (e) { if (!res.headersSent && !ac.signal.aborted) await other('Stream unavailable'); return; }
  if ((up.status === 403 || up.status === 410) && !retried) { // signed link expired
    js.forgetStream(id);
    return stream(req, res, id, true, opts, q, swapped);
  }
  if (up.status >= 400) return other(`Stream unavailable (HTTP ${up.status})`);
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
<script>window.AURA_SERVER = true;</script>
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
  if (u.pathname !== '/api/health' && !allowed(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="AURA", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('AURA is private. Enter your AURA password (any username).');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  const sm = u.pathname.match(/^\/api\/stream\/([^/]+)$/);
  if (sm) return stream(req, res, decodeURIComponent(sm[1]), false, { bitrate: ['48', '96', '128', '160', '320'].includes(u.searchParams.get('br')) ? u.searchParams.get('br') : '' }, (u.searchParams.get('q') || '').slice(0, 200));
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
