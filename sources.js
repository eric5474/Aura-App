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
const ENABLED = String(SENV.AURA_SOURCES || 'jiosaavn,audius,jamendo').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const js = (typeof require === 'function' && typeof module !== 'undefined') ? require('./jiosaavn') : globalThis.JioSaavn;

const on = (id) => ENABLED.includes(id) && (id !== 'jamendo' || !!JAMENDO_ID);
const sourceOf = (id) => (/^au_/.test(id) ? 'audius' : /^jm_/.test(id) ? 'jamendo' : 'jiosaavn');

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

/* ---------------- all sources together ---------------- */
const NAMES = { jiosaavn: 'AURA library', audius: 'Audius', jamendo: 'Jamendo' }; // the main library is shown under AURA's own name
function list() {
  return ['jiosaavn', 'audius', 'jamendo'].map((id) => ({
    id, name: NAMES[id], enabled: on(id),
    note: id === 'jamendo' && !JAMENDO_ID && ENABLED.includes('jamendo') ? 'needs a free client id (AURA_JAMENDO_CLIENT_ID)' : '',
  }));
}

// Search the main library plus the other sources. A source that fails never breaks the others.
async function search(q, type = 'all', page = 1) {
  const main = on('jiosaavn') ? js.search(q, type, page) : Promise.resolve({ query: q, songs: [], albums: [], artists: [], playlists: [] });
  const extra = [];
  if ((type === 'all' || type === 'songs') && page === 1 && String(q || '').trim()) {
    const n = type === 'songs' ? 10 : 6;
    if (on('audius')) extra.push(audiusSearch(q, n).catch(() => []));
    if (on('jamendo')) extra.push(jamendoSearch(q, n).catch(() => []));
  }
  const [m, ...more] = await Promise.allSettled([main, ...extra]);
  const extras = more.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (m.status === 'rejected' && !extras.length) throw m.reason;
  const out = m.status === 'fulfilled' ? m.value : { query: q, songs: [], albums: [], artists: [], playlists: [] };
  if (extras.length) out.songs = [...(out.songs || []), ...extras];
  return out;
}

async function streamUrl(id, acct) {
  const s = sourceOf(String(id));
  if (s === 'audius') return audiusStreamUrl(id);
  if (s === 'jamendo') return jamendoStreamUrl(String(id));
  return js.streamUrl(id, acct);
}

// A plain report of whether each source can find and stream a song from where this runs.
async function check(q = 'love') {
  const out = {};
  const probe = async (id, fn) => {
    if (!on(id)) { out[id] = { enabled: false, note: list().find((x) => x.id === id).note || 'switched off' }; return; }
    try { out[id] = { enabled: true, ...(await fn()) }; } catch (e) { out[id] = { enabled: true, ok: false, detail: e.message }; }
  };
  const audioTest = async (url) => {
    const r = await fetch(url, { headers: { Range: 'bytes=0-1', 'User-Agent': SUA }, redirect: 'follow' });
    return { audio_status: r.status, audio_type: r.headers.get('content-type') || '' };
  };
  await Promise.all([
    probe('audius', async () => { const r = await audiusSearch(q, 3); if (!r[0]) return { ok: false, detail: 'search found no songs' }; const a = await audioTest(await streamUrl(r[0].id)); return { ok: a.audio_status < 400, song: r[0].title, ...a }; }),
    probe('jamendo', async () => { const r = await jamendoSearch(q, 3); if (!r[0]) return { ok: false, detail: 'search found no songs' }; const a = await audioTest(await streamUrl(r[0].id)); return { ok: a.audio_status < 400, song: r[0].title, ...a }; }),
    probe('jiosaavn', async () => { const r = await js.search(q, 'songs'); if (!r.songs[0]) return { ok: false, detail: 'search found no songs' }; const u = await js.streamUrl(r.songs[0].id); const a = await audioTest(u); return { ok: a.audio_status < 400, song: r.songs[0].title, note: 'checked without the JioSaavn site headers', ...a }; }),
  ]);
  return out;
}

const sources = { list, search, streamUrl, sourceOf, check, audiusSearch, jamendoSearch, audiusSong, jamendoSong, enabled: on };
if (typeof module !== 'undefined' && module.exports) module.exports = sources;
else globalThis.AuraSources = sources;
