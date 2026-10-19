'use strict';
/**
 * AURA's music sources. Searching and streaming go through every source that is switched on:
 *   jiosaavn - the main library (jiosaavn.js)
 *   audius   - free full-length songs from independent artists (api.audius.co, no key needed)
 *   jamendo  - free Creative Commons songs (api.jamendo.com, needs a free client id)
 * Songs from Audius and Jamendo get ids that start with "au_" and "jm_" so every part of AURA
 * (playing, queue, library, charts matching) can tell where a song streams from.
 * Runs in Node (server.js) and inside the Android app (bundled by scripts/build-app.js).
 */
const SENV = (typeof process !== 'undefined' && process.env) || (typeof globalThis !== 'undefined' && globalThis.AURA_ENV) || {};
const AUDIUS = (SENV.AUDIUS_BASE || 'https://api.audius.co').replace(/\/$/, '');
const JAMENDO = (SENV.JAMENDO_BASE || 'https://api.jamendo.com/v3.0').replace(/\/$/, '');
const JAMENDO_ID = SENV.AURA_JAMENDO_CLIENT_ID || '';
const APP_NAME = 'AURA';
const SUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const YT_KEY = SENV.AURA_YOUTUBE_API_KEY || '';
const YOUTUBE = (SENV.YOUTUBE_BASE || 'https://www.googleapis.com/youtube/v3').replace(/\/$/, '');
// With a YouTube key, songs play through YouTube and JioSaavn is only the catalogue; AURA_SOURCES can add 'jiosaavn' back as a streaming source.
const ENABLED = String(SENV.AURA_SOURCES || (YT_KEY ? 'youtube,audius,jamendo' : 'jiosaavn,audius,jamendo')).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const js = (typeof require === 'function' && typeof module !== 'undefined') ? require('./jiosaavn') : globalThis.JioSaavn;

const on = (id) => ENABLED.includes(id) && (id !== 'jamendo' || !!JAMENDO_ID) && (id !== 'youtube' || !!YT_KEY);
const sourceOf = (id) => (/^au_/.test(id) ? 'audius' : /^jm_/.test(id) ? 'jamendo' : /^yt_/.test(id) ? 'youtube' : 'jiosaavn');
const charts = () => (typeof require === 'function' && typeof module !== 'undefined') ? require('./charts') : globalThis.AuraCharts;

async function getJSON(url, ms = 6000) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': SUA, Accept: 'application/json' }, signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined });
  } catch (e) { throw new Error(`couldn’t reach it (${(e.cause && e.cause.code) || e.name})`); }
  if (!res.ok) throw new Error(`it answered HTTP ${res.status}`);
  return res.json();
}
const sec = (n) => { const v = Number(n); return Number.isFinite(v) && v > 0 ? Math.round(v) : 0; };

/* ---------------- Audius ---------------- */
function audiusSong(t) {
  if (!t || !t.id || t.is_streamable === false || t.is_delete) return null;
  const a = t.artwork || {};
  return {
    id: 'au_' + t.id,
    title: String(t.title || '').trim(),
    artists: [{ id: '', name: String((t.user && (t.user.name || t.user.handle)) || 'Unknown Artist'), image: '' }],
    album: '', albumId: '',
    image: a['480x480'] || a['1000x1000'] || a['150x150'] || '',
    duration: sec(t.duration),
    year: String(t.release_date || t.created_at || '').slice(0, 4),
    releaseDate: String(t.release_date || t.created_at || '').slice(0, 10),
    language: '', explicit: false, hasLyrics: false,
    label: 'Audius', copyright: '', playCount: Number(t.play_count) || 0,
    url: t.permalink ? 'https://audius.co' + t.permalink : '',
    source: 'audius',
  };
}
async function audiusSearch(q, n = 10) {
  const j = await getJSON(`${AUDIUS}/v1/tracks/search?query=${encodeURIComponent(q)}&limit=${n}&app_name=${APP_NAME}`);
  return (j.data || []).map(audiusSong).filter((s) => s && s.title);
}
const audiusStreamUrl = (id) => `${AUDIUS}/v1/tracks/${encodeURIComponent(String(id).replace(/^au_/, ''))}/stream?app_name=${APP_NAME}`;

/* ---------------- Jamendo ---------------- */
const jamendoAudio = new Map(); // song id -> stream url
function jamendoSong(t) {
  if (!t || !t.id || !t.audio) return null;
  const id = 'jm_' + t.id;
  jamendoAudio.set(id, t.audio);
  return {
    id, title: String(t.name || '').trim(),
    artists: [{ id: '', name: String(t.artist_name || 'Unknown Artist'), image: '' }],
    album: String(t.album_name || ''), albumId: '',
    image: t.image || t.album_image || '',
    duration: sec(t.duration),
    year: String(t.releasedate || '').slice(0, 4), releaseDate: String(t.releasedate || ''),
    language: '', explicit: false, hasLyrics: false,
    label: 'Jamendo', copyright: 'Creative Commons', playCount: 0,
    url: t.shareurl || '', source: 'jamendo',
  };
}
async function jamendoSearch(q, n = 10) {
  const j = await getJSON(`${JAMENDO}/tracks/?client_id=${encodeURIComponent(JAMENDO_ID)}&format=json&limit=${n}&search=${encodeURIComponent(q)}&audioformat=mp32&imagesize=300&boost=popularity_month`);
  if (j.headers && j.headers.status === 'failed') throw new Error(j.headers.error_message || 'Jamendo refused the request');
  return (j.results || []).map(jamendoSong).filter((s) => s && s.title);
}
async function jamendoStreamUrl(id) {
  if (jamendoAudio.has(id)) return jamendoAudio.get(id);
  const j = await getJSON(`${JAMENDO}/tracks/?client_id=${encodeURIComponent(JAMENDO_ID)}&format=json&id=${encodeURIComponent(id.replace(/^jm_/, ''))}&audioformat=mp32`);
  const t = (j.results || [])[0];
  if (!t || !t.audio) throw new Error('This song isn’t available to stream');
  jamendoAudio.set(id, t.audio);
  return t.audio;
}

/* ---------------- YouTube (official Data API for search; YouTube's own embedded player plays it) ---------------- */
const ytCache = new Map();
const isoSec = (d) => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || ''); return m ? (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) : 0; };
async function youtubeSearch(q, n = 8) {
  const key = (q + '|' + n).toLowerCase();
  const hit = ytCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.v; // searches cost quota, so remember them for a while
  const j = await getJSON(`${YOUTUBE}/search?part=snippet&type=video&videoCategoryId=10&videoEmbeddable=true&videoSyndicated=true&maxResults=${n}&q=${encodeURIComponent(q)}&key=${encodeURIComponent(YT_KEY)}`);
  const items = (j.items || []).filter((x) => x.id && x.id.videoId);
  const dur = {};
  if (items.length) {
    try { const d = await getJSON(`${YOUTUBE}/videos?part=contentDetails&id=${items.map((x) => x.id.videoId).join(',')}&key=${encodeURIComponent(YT_KEY)}`); for (const v of d.items || []) dur[v.id] = isoSec(v.contentDetails && v.contentDetails.duration); } catch (_) { /* durations are a nicety */ }
  }
  const C = charts();
  const out = items.map((x) => {
    const sn = x.snippet || {};
    const c = C.cleanVideoTitle(sn.title || '');
    const chan = String(sn.channelTitle || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
    const th = sn.thumbnails || {};
    return {
      id: 'yt_' + x.id.videoId, title: c.title || String(sn.title || ''),
      artists: [{ id: '', name: c.artist || chan || 'Unknown Artist', image: '' }],
      album: '', albumId: '', image: (th.high || th.medium || th.default || {}).url || '',
      duration: dur[x.id.videoId] || 0, year: String(sn.publishedAt || '').slice(0, 4), releaseDate: String(sn.publishedAt || '').slice(0, 10),
      language: '', explicit: false, hasLyrics: false, label: 'YouTube', copyright: '', playCount: 0,
      url: 'https://www.youtube.com/watch?v=' + x.id.videoId, source: 'youtube',
    };
  }).filter((x) => x.title);
  ytCache.set(key, { v: out, exp: Date.now() + 6 * 3600 * 1000 });
  return out;
}


/* The official "most popular music videos" chart: one videos.list call (1 quota unit, versus 100 for a search),
   and it returns the video ids, so playing a chart song needs no search at all. */
const ytSong = (videoId, title, artist, image, extra) => ({
  id: 'yt_' + videoId, title, artists: [{ id: '', name: artist || 'Unknown Artist', image: '' }],
  album: '', albumId: '', image: image || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
  duration: 0, year: '', releaseDate: '', language: '', explicit: false, hasLyrics: false, label: 'YouTube', copyright: '', playCount: 0,
  url: 'https://www.youtube.com/watch?v=' + videoId, source: 'youtube', ...(extra || {}),
});
const ytChartCache = new Map();
async function youtubeChart(cc) {
  if (!YT_KEY) return null;
  const region = ({ world: 'US', uk: 'GB' })[cc] || String(cc).toUpperCase();
  const hit = ytChartCache.get(region);
  if (hit && hit.exp > Date.now()) return hit.v;
  const j = await getJSON(`${YOUTUBE}/videos?part=snippet,contentDetails&chart=mostPopular&videoCategoryId=10&regionCode=${encodeURIComponent(region)}&maxResults=50&key=${encodeURIComponent(YT_KEY)}`);
  const C = charts();
  const out = (j.items || []).map((v) => {
    const sn = v.snippet || {}, c = C.cleanVideoTitle(sn.title || '');
    const chan = String(sn.channelTitle || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
    const th = sn.thumbnails || {};
    return { id: v.id, title: c.title || sn.title || '', artist: c.artist || chan, image: (th.medium || th.high || th.default || {}).url || '', duration: isoSec((v.contentDetails || {}).duration) };
  }).filter((x) => x.id && x.title);
  if (out.length) ytChartCache.set(region, { v: out, exp: Date.now() + 3 * 3600 * 1000 });
  return out;
}

/* ---------------- all sources together ---------------- */
const NAMES = { jiosaavn: 'AURA library', youtube: 'YouTube', audius: 'Audius', jamendo: 'Jamendo' }; // the main library is shown under AURA's own name
function list() {
  return ['jiosaavn', 'youtube', 'audius', 'jamendo'].map((id) => ({
    id, name: NAMES[id], enabled: id === 'jiosaavn' ? true : on(id),
    note: id === 'jiosaavn' ? (on('jiosaavn') ? '' : 'songs and albums only; plays through YouTube') : id === 'youtube' && !YT_KEY && ENABLED.includes('youtube') ? 'needs a YouTube Data API key (AURA_YOUTUBE_API_KEY)' : id === 'jamendo' && !JAMENDO_ID && ENABLED.includes('jamendo') ? 'needs a free client id (AURA_JAMENDO_CLIENT_ID)' : '',
  }));
}

// Search the main library plus the other sources. A source that fails never breaks the others.
async function search(q, type = 'all', page = 1) {
  const main = js.search(q, type, page); // the library is always the catalogue; where songs play from is decided separately
  const extra = [];
  if ((type === 'all' || type === 'songs') && page === 1 && String(q || '').trim()) {
    const n = type === 'songs' ? 10 : 6;
    if (on('youtube')) extra.push(youtubeSearch(q, n).then((r) => ({ yt: r })).catch(() => []));
    if (on('audius')) extra.push(audiusSearch(q, n).catch(() => []));
    if (on('jamendo')) extra.push(jamendoSearch(q, n).catch(() => []));
  }
  const [m, ...more] = await Promise.allSettled([main, ...extra]);
  const settled = more.map((r) => (r.status === 'fulfilled' ? r.value : []));
  const ytRes = (settled.find((v) => v && v.yt) || {}).yt || [];
  const extras = settled.flatMap((v) => (Array.isArray(v) ? v : []));
  if (m.status === 'rejected' && !extras.length && !ytRes.length) throw m.reason;
  const out = m.status === 'fulfilled' ? m.value : { query: q, songs: [], albums: [], artists: [], playlists: [] };
  if (ytRes.length && (out.songs || []).length < 5) extras.unshift(...ytRes.slice(0, 5)); // YouTube fills gaps; known songs already play through it
  if (extras.length) out.songs = [...(out.songs || []), ...extras];
  return out;
}

async function streamUrl(id, opts) {
  const s = sourceOf(String(id));
  if (s === 'audius') return audiusStreamUrl(id);
  if (s === 'jamendo') { const u = await jamendoStreamUrl(String(id)); return opts && Number(opts.bitrate) && Number(opts.bitrate) <= 96 ? u.replace(/format=mp32/, 'format=mp31') : u; } // low qualities use Jamendo's smaller file
  if (s === 'youtube') throw new Error('This song plays in the YouTube player');
  if (!on('jiosaavn')) throw new Error('Songs play through YouTube');
  return js.streamUrl(id, opts);
}

// Another copy of a song from any source (not the one that just failed), found by "title artist".
const words = (t) => String(t || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').split(/[^a-z0-9\u0900-\u097f]+/).filter((w) => w.length > 1);
async function alternate(q, excludeId, opts) {
  const want = words(q);
  if (!want.length) return null;
  const res = await search(q, 'songs', 1).catch(() => null);
  for (const s of (res && res.songs) || []) {
    if (s.id === excludeId) continue;
    const have = new Set(words(s.title + ' ' + (s.artists || []).map((a) => a.name).join(' ')));
    const hit = want.filter((w) => have.has(w)).length;
    if (hit / want.length < 0.6) continue;
    try { return { id: s.id, url: await streamUrl(s.id, opts) }; } catch (_) { /* try the next one */ }
  }
  return null;
}

// The YouTube video that best matches "title artist" (or null). Played by YouTube's own embedded player.
async function youtubeResolve(q) {
  if (!on('youtube')) return null;
  const want = words(q);
  if (!want.length) return null;
  let best = null, bestScore = 0;
  for (const s of await youtubeSearch(q, 6)) {
    const have = new Set(words(s.title + ' ' + s.artists[0].name));
    const score = want.filter((w) => have.has(w)).length / want.length;
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return best && bestScore >= 0.5 ? { id: best.id.replace(/^yt_/, ''), title: best.title, duration: best.duration } : null;
}

// A plain report of whether each source can find and stream a song from where this runs.
async function check(q = 'love') {
  const out = {};
  const probe = async (id, fn) => {
    if (id !== 'jiosaavn' && !on(id)) { out[id] = { enabled: false, note: list().find((x) => x.id === id).note || 'switched off' }; return; }
    try { out[id] = { enabled: true, ...(await fn()) }; } catch (e) { out[id] = { enabled: true, ok: false, detail: e.message }; }
  };
  const audioTest = async (url) => {
    const r = await fetch(url, { headers: { Range: 'bytes=0-1', 'User-Agent': SUA }, redirect: 'follow' });
    return { audio_status: r.status, audio_type: r.headers.get('content-type') || '' };
  };
  await Promise.all([
    probe('youtube', async () => { const r = await youtubeSearch(q, 3); return r[0] ? { ok: true, song: r[0].title, note: 'plays in YouTube’s embedded player' } : { ok: false, detail: 'search found no songs' }; }),
    probe('audius', async () => { const r = await audiusSearch(q, 3); if (!r[0]) return { ok: false, detail: 'search found no songs' }; const a = await audioTest(await streamUrl(r[0].id)); return { ok: a.audio_status < 400, song: r[0].title, ...a }; }),
    probe('jamendo', async () => { const r = await jamendoSearch(q, 3); if (!r[0]) return { ok: false, detail: 'search found no songs' }; const a = await audioTest(await streamUrl(r[0].id)); return { ok: a.audio_status < 400, song: r[0].title, ...a }; }),
    probe('jiosaavn', async () => { if (!on('jiosaavn')) return { ok: true, note: 'catalogue only; songs play through YouTube' }; const r = await js.search(q, 'songs'); if (!r.songs[0]) return { ok: false, detail: 'search found no songs' }; const u = await js.streamUrl(r.songs[0].id); const a = await audioTest(u); return { ok: a.audio_status < 400, song: r.songs[0].title, note: 'checked without the JioSaavn site headers', ...a }; }),
  ]);
  return out;
}

const sources = { list, search, streamUrl, alternate, youtubeResolve, youtubeSearch, youtubeChart, ytSong, sourceOf, check, audiusSearch, jamendoSearch, audiusSong, jamendoSong, enabled: on };
if (typeof module !== 'undefined' && module.exports) module.exports = sources;
else globalThis.AuraSources = sources;
