'use strict';
/**
 * Minimal JioSaavn client for AURA (personal use).
 * Talks to the same JSON endpoints the jiosaavn.com web player uses and turns the
 * responses into AURA's simple song / album / artist / playlist shapes.
 *
 * Streaming uses JioSaavn's own `song.generateAuthToken` endpoint (the one the web
 * player calls) at a free-tier bitrate. No decryption, no premium-quality unlock,
 * no downloads.
 */

// Runs in Node (server.js) and inside the Android app (bundled by scripts/build-app.js).
const ENV = (typeof process !== 'undefined' && process.env) || (typeof globalThis !== 'undefined' && globalThis.AURA_ENV) || {};
const BASE = ENV.JIOSAAVN_BASE || 'https://www.jiosaavn.com/api.php';
const LANGS = ENV.AURA_LANGUAGES || 'hindi,english';
const BITRATE = String(ENV.AURA_BITRATE || '128');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/* ---------------- tiny TTL cache ---------------- */
const cache = new Map();
const TTL = 10 * 60 * 1000;
function cacheGet(k) { const c = cache.get(k); if (c && c.exp > Date.now()) return c.v; cache.delete(k); return undefined; }
function cacheSet(k, v, ttl = TTL) {
  cache.set(k, { v, exp: Date.now() + ttl });
  if (cache.size > 800) cache.delete(cache.keys().next().value);
}

/* ---------------- HTTP ---------------- */
function parseJSON(text) {
  try { return JSON.parse(text); } catch (_) { /* JioSaavn sometimes prefixes junk */ }
  const i = text.search(/[[{]/);
  if (i >= 0) { try { return JSON.parse(text.slice(i)); } catch (_) {} }
  throw new Error('JioSaavn returned an unexpected response');
}

async function call(fn, params = {}, opt = {}) {
  const q = new URLSearchParams({
    __call: fn, _format: 'json', _marker: '0',
    ctx: opt.ctx || 'web6dot0',
    ...(opt.v4 === false ? {} : { api_version: '4' }),
    ...params,
  });
  const key = q.toString();
  if (!opt.fresh) { const hit = cacheGet(key); if (hit !== undefined) return hit; }

  const init = {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      Cookie: `L=${encodeURIComponent(LANGS)}; DL=english; gdpr_acceptance=true`,
    },
    signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
  };
  let url = `${BASE}?${key}`;
  if (opt.post) {
    init.method = 'POST';
    init.body = key;
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    url = BASE;
  }
  let res;
  try { res = await fetch(url, init); }
  catch (e) { throw new Error(`Couldn't reach JioSaavn (${e.cause?.code || e.name})`); }
  if (!res.ok) throw new Error(`JioSaavn ${fn} failed with HTTP ${res.status}`);
  const data = parseJSON(await res.text());
  if (data && data.error && !opt.allowError) {
    const msg = typeof data.error === 'string' ? data.error : (data.error.msg || JSON.stringify(data.error));
    throw new Error(`JioSaavn: ${msg}`);
  }
  if (!opt.fresh) cacheSet(key, data, opt.ttl);
  return data;
}

/* ---------------- normalisers ---------------- */
const ENT = { '&quot;': '"', '&amp;': '&', '&#039;': "'", '&#39;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
const dec = (s) => String(s ?? '').replace(/&(quot|amp|#0?39|lt|gt|nbsp);/g, (m) => ENT[m] || m).trim();
const img = (u, size = '500x500') => {
  if (!u || typeof u !== 'string') return '';
  return u.replace(/^http:\/\/([a-z0-9.-]*saavncdn\.com)/i, 'https://$1').replace(/\d{2,3}x\d{2,3}(?=\.(jpe?g|png|webp)$)/i, size);
};
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';

// song id -> encrypted media url (needed to ask JioSaavn for a stream link)
const mediaRef = new Map();

function artistsOf(o) {
  const mi = o.more_info || {};
  const map = mi.artistMap || o.artistMap || {};
  const all = map.artists || [];
  const sung = all.filter((a) => /singer|music/i.test(a.role || ''));
  const list = map.primary_artists && map.primary_artists.length ? map.primary_artists : (sung.length ? sung : all);
  if (list.length) {
    const seen = new Set();
    return list.filter((a) => a.id && !seen.has(a.id) && seen.add(a.id))
      .map((a) => ({ id: String(a.id), name: dec(a.name), image: img(a.image) }));
  }
  // legacy format: comma separated names and ids
  const names = dec(o.primary_artists || mi.music || o.singers || o.music || o.subtitle || '').split(/\s*,\s*/).filter(Boolean);
  const ids = String(o.primary_artists_id || '').split(/\s*,\s*/).filter(Boolean);
  return names.map((n, i) => ({ id: ids[i] || '', name: n, image: '' }));
}

function song(s) {
  if (!s || !s.id) return null;
  const mi = s.more_info || {};
  const enc = mi.encrypted_media_url || s.encrypted_media_url;
  if (enc) mediaRef.set(String(s.id), enc);
  return {
    id: String(s.id),
    title: dec(s.title || s.song || s.name),
    artists: artistsOf(s),
    album: dec(mi.album || s.album),
    albumId: String(mi.album_id || s.albumid || s.album_id || ''),
    image: img(s.image),
    duration: num(mi.duration || s.duration),
    year: String(s.year || ''),
    releaseDate: mi.release_date || s.release_date || '',
    language: s.language || '',
    explicit: bool(s.explicit_content),
    hasLyrics: bool(mi.has_lyrics ?? s.has_lyrics),
    label: dec(mi.label || s.label),
    copyright: dec(mi.copyright_text || s.copyright_text),
    playCount: num(s.play_count),
    url: s.perma_url || '',
  };
}

function albumLite(a) {
  if (!a || !a.id) return null;
  const mi = a.more_info || {};
  const artists = artistsOf(a);
  return {
    id: String(a.id),
    title: dec(a.title || a.name),
    artists,
    artist: artists[0] || { id: '', name: dec(mi.music || a.subtitle || 'Various Artists') },
    image: img(a.image),
    year: String(a.year || mi.year || ''),
    releaseDate: mi.release_date || a.release_date || '',
    songCount: num(mi.song_count || a.list_count || a.song_count),
    language: a.language || '',
    url: a.perma_url || '',
  };
}

const artistLite = (a) => (a && (a.id || a.artistId) ? {
  id: String(a.id || a.artistId), name: dec(a.name || a.title), image: img(a.image),
} : null);

function playlistLite(p) {
  if (!p || !p.id) return null;
  const mi = p.more_info || {};
  return {
    id: String(p.id),
    title: dec(p.title || p.listname),
    subtitle: dec(p.subtitle || ''),
    curator: dec(mi.firstname ? `${mi.firstname} ${mi.lastname || ''}` : 'JioSaavn'),
    image: img(p.image),
    songCount: num(mi.song_count || p.list_count || p.count),
    url: p.perma_url || '',
  };
}

function card(it) {
  if (!it || !it.type) return null;
  const mi = it.more_info || {};
  const base = { id: String(it.id || ''), title: dec(it.title || it.name), subtitle: dec(it.subtitle || mi.subtitle || ''), image: img(it.image) };
  switch (it.type) {
    case 'song': { const s = song(it); return s && { ...base, type: 'song', song: s }; }
    case 'album': { const a = albumLite(it); return a && { ...base, type: 'album', album: a }; }
    case 'playlist': { const p = playlistLite(it); return p && { ...base, type: 'playlist', playlist: p }; }
    case 'artist': return { ...base, type: 'artist', id: String(it.id || it.artistid || '') };
    case 'radio_station':
      return {
        ...base, type: 'station',
        station: { name: dec(mi.query || it.title), language: mi.language || '', kind: mi.featured_station_type || 'featured' },
      };
    default: return null;
  }
}

/* ---------------- public API ---------------- */
const SECTION_TITLES = {
  new_trending: 'Trending Now', charts: 'Top Charts', new_albums: 'New Releases', top_playlists: 'Top Playlists',
  radio: 'Radio Stations', artist_recos: 'Artist Stations', city_mod: 'Popular Near You', tag_mixes: 'Mixes',
};

async function home() {
  const d = await call('webapi.getLaunchData', {}, { ttl: 15 * 60 * 1000 });
  const modules = d.modules || {};
  const sections = [];
  for (const [key, val] of Object.entries(d)) {
    if (!Array.isArray(val) || !val.length) continue;
    const items = val.map(card).filter((c) => c && c.id);
    if (!items.length) continue;
    const m = modules[key] || {};
    sections.push({
      key,
      title: dec(m.title) || SECTION_TITLES[key] || key.replace(/^promo:vx:data:\d+$/, 'Featured').replace(/_/g, ' '),
      subtitle: dec(m.subtitle || ''),
      position: num(m.position) || 99,
      items,
    });
  }
  sections.sort((a, b) => a.position - b.position);
  return { sections };
}

async function search(q, type = 'all', page = 1) {
  q = String(q || '').trim();
  if (!q) return { query: q, songs: [], albums: [], artists: [], playlists: [] };
  const p = String(page);
  const get = {
    songs: () => call('search.getResults', { q, p, n: '20' }).then((d) => (d.results || []).map(song).filter(Boolean)),
    albums: () => call('search.getAlbumResults', { q, p, n: '16' }).then((d) => (d.results || []).map(albumLite).filter(Boolean)),
    artists: () => call('search.getArtistResults', { q, p, n: '16' }).then((d) => (d.results || []).map(artistLite).filter(Boolean)),
    playlists: () => call('search.getPlaylistResults', { q, p, n: '16' }).then((d) => (d.results || []).map(playlistLite).filter(Boolean)),
  };
  const kinds = type === 'all' ? Object.keys(get) : [type].filter((k) => get[k]);
  const settled = await Promise.allSettled(kinds.map((k) => get[k]()));
  const out = { query: q, songs: [], albums: [], artists: [], playlists: [] };
  kinds.forEach((k, i) => { if (settled[i].status === 'fulfilled') out[k] = settled[i].value; });
  if (settled.every((s) => s.status === 'rejected')) throw settled[0].reason;
  return out;
}

async function songs(ids) {
  const d = await call('song.getDetails', { pids: ids.join(',') });
  const list = Array.isArray(d.songs) ? d.songs : Object.values(d).filter((x) => x && typeof x === 'object' && x.id);
  return { songs: list.map(song).filter(Boolean) };
}

async function album(id) {
  const d = await call('content.getAlbumDetails', { albumid: id });
  const a = albumLite(d);
  if (!a) throw new Error('Album not found');
  const mi = d.more_info || {};
  return {
    ...a,
    description: dec(d.header_desc || ''),
    copyright: dec(mi.copyright_text || d.copyright_text || ''),
    label: dec(mi.label || ''),
    songs: (d.list || d.songs || []).map(song).filter(Boolean),
  };
}

async function playlist(id) {
  const d = await call('playlist.getDetails', { listid: id, n: '150', p: '1' });
  const p = playlistLite(d);
  if (!p) throw new Error('Playlist not found');
  const mi = d.more_info || {};
  return {
    ...p,
    description: dec(d.header_desc || d.description || ''),
    followers: num(mi.follower_count || d.follower_count),
    songs: (d.list || d.songs || []).map(song).filter(Boolean),
  };
}

function parseBio(bio) {
  if (!bio) return '';
  try {
    const parts = typeof bio === 'string' ? JSON.parse(bio) : bio;
    if (Array.isArray(parts)) return parts.sort((a, b) => num(a.sequence) - num(b.sequence)).map((p) => dec(p.text)).filter(Boolean).join('\n\n');
  } catch (_) {}
  return dec(String(bio));
}

async function artist(id) {
  const d = await call('artist.getArtistPageDetails', {
    artistId: id, n_song: '25', n_album: '25', page: '0', category: '', sort_order: '',
  });
  if (!d || !(d.artistId || d.name)) throw new Error('Artist not found');
  return {
    id: String(d.artistId || id),
    name: dec(d.name),
    image: img(d.image),
    followers: num(d.follower_count),
    verified: bool(d.isVerified),
    language: d.dominantLanguage || '',
    type: d.dominantType || '',
    bio: parseBio(d.bio),
    topSongs: (d.topSongs || []).map(song).filter(Boolean),
    albums: (d.topAlbums || []).map(albumLite).filter(Boolean),
    singles: (d.singles || []).map(albumLite).filter(Boolean),
    similar: (d.similarArtists || []).map(artistLite).filter(Boolean),
  };
}

async function lyrics(id) {
  const d = await call('lyrics.getLyrics', { lyrics_id: id }, { v4: false, allowError: true });
  const text = d && d.lyrics ? String(d.lyrics) : '';
  const lines = text.split(/<br\s*\/?>|\n/i).map((l) => dec(l.replace(/<[^>]+>/g, '')));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return { id, lines, copyright: dec((d && d.lyrics_copyright) || '') };
}

function stationSongs(d, skip) {
  return Object.entries(d || {})
    .filter(([k, v]) => k !== 'stationid' && v && v.song)
    .map(([, v]) => song(v.song))
    .filter((s) => s && s.id !== skip);
}

async function songRadio(id, n = 20) {
  const st = await call('webradio.createEntityStation',
    { entity_id: JSON.stringify([encodeURIComponent(id)]), entity_type: 'queue' }, { ctx: 'android', fresh: true });
  if (!st.stationid) throw new Error('Couldn’t start a station for this song');
  const d = await call('webradio.getSong', { stationid: st.stationid, k: String(n), next: '1' }, { ctx: 'android', fresh: true });
  return { songs: stationSongs(d, id) };
}

async function featuredRadio(name, language = '', kind = 'featured', n = 20) {
  if (!name) throw new Error('Station name is required');
  const fn = kind === 'artist' ? 'webradio.createArtistStation' : 'webradio.createFeaturedStation';
  const st = await call(fn, { name, query: name, language: language || LANGS.split(',')[0] }, { ctx: 'android', fresh: true });
  if (!st.stationid) throw new Error(`Couldn’t tune in to ${name}`);
  const d = await call('webradio.getSong', { stationid: st.stationid, k: String(n), next: '1' }, { ctx: 'android', fresh: true });
  return { name, songs: stationSongs(d) };
}

/* ---------------- streaming ---------------- */
const streamLinks = new Map(); // id -> { url, exp }

async function streamUrl(id) {
  const hit = streamLinks.get(id);
  if (hit && hit.exp > Date.now()) return hit.url;
  if (!mediaRef.has(id)) await songs([id]);
  const ref = mediaRef.get(id);
  if (!ref) throw new Error('This song isn’t available to stream');
  // Ask for a stream link the way the web player does, with a few fallbacks.
  const tries = [{ post: true, v4: false }, { v4: false }, { v4: true }, { v4: false, ctx: 'android' }];
  let tok = null, lastErr = null;
  for (const t of tries) {
    try {
      tok = await call('song.generateAuthToken', { url: ref, bitrate: BITRATE }, { ...t, fresh: true, allowError: true });
      if (tok && tok.auth_url) break;
    } catch (e) { lastErr = e; }
  }
  if (!tok || !tok.auth_url) throw lastErr || new Error('This song isn’t available to stream right now');
  streamLinks.set(id, { url: tok.auth_url, exp: Date.now() + 4 * 60 * 1000 });
  return tok.auth_url;
}
const forgetStream = (id) => streamLinks.delete(id);

const api = { home, search, songs, album, playlist, artist, lyrics, songRadio, featuredRadio, streamUrl, forgetStream, UA, BASE };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else globalThis.JioSaavn = api;
