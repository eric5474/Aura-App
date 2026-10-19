'use strict';
/**
 * AURA charts: what's popular right now, from three public places.
 *   Spotify   - daily / weekly chart pages published by kworb.net (a public mirror of Spotify's charts)
 *   Apple     - Apple's own public "Most Played" song feeds (rss.marketingtools.apple.com)
 *   YouTube   - kworb.net's trending music videos per country
 * These only give the list (rank, title, artist). The songs themselves play from AURA's library
 * once a song is tapped. Runs in Node (server.js) and inside the Android app (bundled).
 */
const CENV = (typeof process !== 'undefined' && process.env) || (typeof globalThis !== 'undefined' && globalThis.AURA_ENV) || {};
const KWORB = (CENV.AURA_CHARTS_KWORB || 'https://kworb.net').replace(/\/$/, '');
const APPLE = (CENV.AURA_CHARTS_APPLE || 'https://rss.marketingtools.apple.com').replace(/\/$/, '');
const CUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const LIMIT = 50;
const APPLE_LIMIT = 100; // Apple's own lists are Top 100
const CTTL = 30 * 60 * 1000;
const ccache = new Map();

// Country codes each service publishes (kworb lists these for Spotify; Apple has storefronts in the same places).
const SP_CODES = 'in us gb de au ca fr br jp pk ae id it es mx ad ar at by be bo bg cl co cr cy cz dk do ec eg sv ee fi gr gt hn hk hu is ie il kz lv lt lu my mt ma nl nz ni ng no pa py pe ph pl pt ro ru sa sg sk za kr se ch tw th tr ua uy ve vn'.split(' ');
const AP_CODES = 'in us gb de au ca fr br jp pk ae id it es mx ar at be bg cl co cz dk eg fi gr hk hu ie il kr my nl nz ng no pe ph pl pt ro ru sa sg sk za se ch tw th tr ua vn'.split(' ');
let REGION = null;
try { REGION = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (_) { /* old runtime: show the code */ }
const NAME_FIX = { uk: 'GB' };
const place = (c) => { if (c === 'global') return 'Global'; if (c === 'world') return 'Worldwide'; try { return (REGION && REGION.of((NAME_FIX[c] || c).toUpperCase())) || c.toUpperCase(); } catch (_) { return c.toUpperCase(); } };
const SPOTIFY_PLACES = [['global', place('global')], ...SP_CODES.map((c) => [c, place(c)])];
const APPLE_PLACES = AP_CODES.map((c) => [c, place(c)]);
// kworb spells the UK 'uk' on its YouTube pages
const YOUTUBE_PLACES = [['world', 'Worldwide'], ...['in', 'de', 'us', 'uk', 'au', 'ca', 'fr', 'br', 'jp', 'pk', 'ae', 'id', 'it', 'es', 'mx'].map((c) => [c, place(c)])];

const SOURCES = [
  {
    id: 'spotify', name: 'Spotify Charts', blurb: 'The most streamed songs on Spotify, by country.',
    charts: [
      ...SPOTIFY_PLACES.map(([c, n]) => ({ id: `${c}_daily`, name: `Top Songs · ${n}`, desc: 'Daily', group: 'Daily charts', kind: 'songs' })),
      ...SPOTIFY_PLACES.map(([c, n]) => ({ id: `${c}_weekly`, name: `Top Songs · ${n}`, desc: 'Weekly', group: 'Weekly charts', kind: 'songs' })),
    ],
  },
  {
    id: 'apple', name: 'Apple Music Charts', blurb: 'The most played songs, albums and music videos on Apple Music, by country.',
    charts: [
      ...APPLE_PLACES.map(([c, n]) => ({ id: c, name: `Top Songs · ${n}`, desc: 'Most played', group: 'Top songs', kind: 'songs' })),
      ...APPLE_PLACES.map(([c, n]) => ({ id: `${c}_albums`, name: `Top Albums · ${n}`, desc: 'Most played', group: 'Top albums', kind: 'albums' })),
      ...APPLE_PLACES.map(([c, n]) => ({ id: `${c}_videos`, name: `Top Music Videos · ${n}`, desc: 'Most played', group: 'Top music videos', kind: 'songs' })),
    ],
  },
  {
    id: 'youtube', name: 'YouTube Music Charts', blurb: 'Music videos trending on YouTube, by country.',
    charts: YOUTUBE_PLACES.map(([c, n]) => ({ id: c, name: `Trending · ${n}`, desc: 'Music videos', group: 'Trending music videos', kind: 'songs' })),
  },
];
const catalogue = () => SOURCES.map((s) => ({ id: s.id, name: s.name, blurb: s.blurb, charts: s.charts.map((c) => ({ ...c })) }));

/* ---------------- helpers ---------------- */
const CENT = { '&quot;': '"', '&amp;': '&', '&#039;': "'", '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
const cdec = (s) => String(s == null ? '' : s).replace(/&(quot|amp|#0?39|apos|lt|gt|nbsp);/g, (m) => CENT[m] || m)
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();
const strip = (h) => cdec(String(h).replace(/<[^>]*>/g, ' '));

async function getText(url) {
  let res;
  try { res = await fetch(url, { headers: { 'User-Agent': CUA, Accept: 'text/html,application/json,*/*' }, signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined }); }
  catch (e) { throw new Error('Couldn’t reach the chart source. Check your internet connection'); }
  if (!res.ok) throw new Error(`The chart source didn’t respond (${res.status})`);
  return res.text();
}

/* ---------------- parsers ---------------- */
function parseSpotify(html) {
  const tracks = [];
  for (const row of String(html).split(/<tr[\s>]/i).slice(1)) {
    const m = /<a[^>]+href="[^"]*track\/([A-Za-z0-9]{10,30})\.html"[^>]*>([\s\S]*?)<\/a>/i.exec(row);
    if (!m) continue;
    const title = strip(m[2]);
    const cell = row.slice(Math.max(0, row.lastIndexOf('<td', m.index)), m.index); // the "Artist - Title" cell, up to the title link
    const artist = strip(cell).replace(/\s*[-–]\s*$/, '').replace(/\s+,/g, ',').trim();
    if (!title) continue;
    tracks.push({ title, artist, id: m[1] });
    if (tracks.length >= LIMIT) break;
  }
  return tracks;
}

function cleanVideoTitle(raw) {
  let t = cdec(raw)
    .replace(/[\(\[\{][^\)\]\}]*(official|video|lyric|audio|visuali[sz]er|clip|live|mv|m\/v|4k|hd|remaster|premiere|teaser|trailer)[^\)\]\}]*[\)\]\}]/gi, ' ')
    .replace(/\s*[|｜].*$/, '')
    .replace(/\b(official\s+(music\s+)?video|official\s+audio|lyric\s+video|music\s+video)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  t = t.replace(/[\s\-–—:]+$/, '');
  const i = t.search(/\s[-–—]\s/);
  if (i > 0) return { artist: t.slice(0, i).trim(), title: t.slice(i).replace(/^\s[-–—]\s/, '').trim() };
  return { artist: '', title: t };
}

function parseYouTube(html) {
  const pieces = String(html).split(/<table[\s>]/i);
  const tables = [];
  for (let i = 1; i < pieces.length; i++) {
    const prev = pieces[i - 1];
    const heading = strip(i === 1 ? prev : prev.slice(prev.lastIndexOf('</table>') + 8)).slice(-60); // the title just above this table
    const rows = [];
    for (const row of pieces[i].split(/<tr[\s>]/i).slice(1)) {
      const m = /<a[^>]+href="[^"]*video\/([A-Za-z0-9_-]{6,15})\.html"[^>]*>([\s\S]*?)<\/a>/i.exec(row);
      if (m && strip(m[2])) rows.push({ id: m[1], raw: strip(m[2]) });
    }
    if (rows.length) tables.push({ rows, music: /music/i.test(heading) });
  }
  if (!tables.length) return [];
  const pick = tables.find((t) => t.music) || tables[0];
  const seen = new Set();
  const out = [];
  for (const r of pick.rows) {
    const c = cleanVideoTitle(r.raw);
    const key = (c.artist + '|' + c.title).toLowerCase();
    if (!c.title || seen.has(key)) continue;
    seen.add(key);
    out.push({ title: c.title, artist: c.artist, id: r.id, image: `https://i.ytimg.com/vi/${r.id}/mqdefault.jpg` });
    if (out.length >= LIMIT) break;
  }
  return out;
}

function parseApple(text, limit = LIMIT) {
  let j;
  try { j = JSON.parse(text); } catch (_) { throw new Error('Apple Music’s chart came back in an unexpected form'); }
  const res = (j.feed && j.feed.results) || [];
  return res.slice(0, limit).map((r) => ({
    title: cdec(r.name), artist: cdec(r.artistName), id: String(r.id || ''),
    image: r.artworkUrl100 ? String(r.artworkUrl100).replace(/\/\d+x\d+(bb)?\.(jpg|png)$/i, '/300x300bb.jpg') : '',
  })).filter((r) => r.title);
}

/* ---------------- public API ---------------- */
async function chart(source, id) {
  const src = SOURCES.find((s) => s.id === source);
  const meta = src && src.charts.find((c) => c.id === id);
  if (!meta) throw new Error('That chart doesn’t exist');
  const key = `${source}:${id}`;
  const hit = ccache.get(key);
  if (hit && hit.exp > Date.now()) return hit.v;
  let tracks;
  if (source === 'spotify') tracks = parseSpotify(await getText(`${KWORB}/spotify/country/${id}.html`));
  else if (source === 'apple') {
    const [cc, what] = id.split('_'); // 'in' | 'in_albums' | 'in_videos'
    const feed = what === 'albums' ? 'albums' : what === 'videos' ? 'music-videos' : 'songs';
    tracks = parseApple(await getText(`${APPLE}/api/v2/${cc}/music/most-played/${APPLE_LIMIT}/${feed}.json`), APPLE_LIMIT);
  }
  else {
    // official YouTube chart first (needs the API key, costs 1 quota unit); kworb's trending page is the fallback
    try { if (ytHooks) tracks = await ytHooks.official(id); } catch (_) { tracks = null; }
    if (!tracks || !tracks.length) tracks = parseYouTube(await getText(id === 'world' ? `${KWORB}/youtube/trending.html` : `${KWORB}/youtube/trending/${id}.html`));
  }
  if (!tracks.length) throw new Error('This chart is empty right now. Try again later');
  const v = { source, id, title: meta.name, desc: meta.desc, kind: meta.kind || 'songs', sourceName: src.name, tracks: tracks.map((t, i) => ({ rank: i + 1, ...t })) };
  ccache.set(key, { v, exp: Date.now() + CTTL });
  return v;
}

let ytHooks = null; // set by the server: { official(cc) }
const setYouTube = (h) => { ytHooks = h; };
const charts = { setYouTube, catalogue, chart, parseSpotify, parseApple, parseYouTube, cleanVideoTitle };
if (typeof module !== 'undefined' && module.exports) module.exports = charts;
else globalThis.AuraCharts = charts;
