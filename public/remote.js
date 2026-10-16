/* AURA live mode.
   Loaded by index.html only when AURA is served by its backend (server.js).
   Replaces the built-in sample catalogue and synthesizer with the JioSaavn catalogue,
   streamed through the local server. Everything else (library, playlists, queue,
   lyrics panel, Now Playing, menus, settings) keeps working on the live data. */
(function () {
'use strict';
window.AURA_REMOTE = true;
window.__booted = 1;

const RKEY = 'aura-live-v1', CKEY = 'aura-live-cache-v1';
const RPL = {};            // JioSaavn playlists by id
const SR = {};             // search results by query
const LOADED = new Set(), PENDING = {}, ERR = {};
let HOME = null, renderKeys = new Set();

/* ---------------- API ---------------- */
async function api(path) {
  if (window.AURA_API) return window.AURA_API(path); // Android app: JioSaavn is called directly from the phone
  const r = await fetch(path, { headers: { Accept: 'application/json' } });
  let j = {};
  try { j = await r.json(); } catch (_) {}
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
const enc = encodeURIComponent;
const hue = (id) => hash(String(id)) % 360;
const safeId = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '_');
// AURA shows its own name everywhere; the music service behind it stays out of sight.
const brand = (v) => (v == null ? v : String(v).replace(/jio\s?saavn(\s+pro)?/gi, 'AURA'));
const cleanErr = (m) => String(m || '').replace(/Couldn.t reach JioSaavn[^)]*\)?/i, 'Couldn’t connect. Check your internet connection')
  .replace(/JioSaavn \S+ failed with HTTP (\d+)/i, 'The music library didn’t respond ($1)').replace(/JioSaavn:?\s*/gi, '').replace(/jio\s?saavn/gi, 'the music library');
const _toast = toast;
toast = function (m) { _toast(cleanErr(m)); };
const niceDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? dLong(d) : (d || '');

/* ---------------- ingest JioSaavn data into AURA's maps ---------------- */
function ingArtist(a) {
  if (!a || !a.name) return null;
  const id = a.id ? String(a.id) : 'n_' + safeId(a.name);
  const h = hue(id);
  const x = ARTISTS[id] || (ARTISTS[id] = { id, name: a.name, remote: 1, genre: null, a: h, b: (h + 50) % 360, bio: '', img: '' });
  if (a.name) x.name = a.name;
  if (a.image && !/artist-default|default-/i.test(a.image)) x.img = a.image;
  return id;
}
function ingSong(s) {
  if (!s || !s.id) return null;
  const artists = (s.artists || []).length ? s.artists : [{ name: 'Unknown Artist' }];
  const ar = ingArtist(artists[0]);
  artists.slice(1).forEach(ingArtist);
  const alId = s.albumId ? String(s.albumId) : 's_' + safeId(s.id);
  if (!AL[alId]) {
    const h = hue(alId);
    AL[alId] = { id: alId, title: s.album || s.title, artist: ar, date: s.releaseDate || s.year || '', type: 'Album', note: '', genre: null,
      a: h, b: (h + 40) % 360, c: (h + 180) % 360, img: s.image, tracks: [], remote: 1, style: 'blob' };
  } else if (!AL[alId].img) AL[alId].img = s.image;
  const t = TR[s.id] || (TR[s.id] = {});
  Object.assign(t, {
    id: s.id, title: s.title, album: alId, artist: ar, artistsText: artists.map((a) => a.name).join(', '),
    genre: 'remote', dur: t.dur || s.duration || 0, n: t.n || 0, explicit: !!s.explicit, lyrics: null,
    hasLyrics: !!s.hasLyrics, remote: 1, img: s.image, year: s.year, lang: s.language, url: s.url,
    label: s.label, copyright: s.copyright, releaseDate: s.releaseDate, seed: 0,
  });
  return s.id;
}
function ingAlbum(a) {
  if (!a || !a.id) return null;
  const id = String(a.id);
  const ar = ingArtist(a.artist && a.artist.name ? a.artist : (a.artists && a.artists[0]) || { name: 'Various Artists' });
  const h = hue(id);
  const x = AL[id] || (AL[id] = { id, a: h, b: (h + 40) % 360, c: (h + 180) % 360, genre: null, remote: 1, style: 'blob', tracks: [], note: '' });
  Object.assign(x, {
    title: a.title || x.title, artist: ar, date: a.releaseDate || a.year || x.date || '',
    type: a.songCount === 1 ? 'Single' : (x.type || 'Album'), img: a.image || x.img, lang: a.language || x.lang,
    songCount: a.songCount || x.songCount, url: a.url || x.url,
  });
  if (a.description) x.note = brand(a.description);
  if (a.copyright) x.copyright = a.copyright;
  if (a.songs) {
    x.tracks = a.songs.map((s) => { const tid = ingSong(s); if (tid) TR[tid].album = id; return tid; }).filter(Boolean);
    x.tracks.forEach((t, i) => { TR[t].n = i + 1; });
    if (x.tracks.length === 1) x.type = 'Single';
    x.full = 1;
  }
  return id;
}
function ingPlaylist(p) {
  if (!p || !p.id) return null;
  const id = String(p.id);
  const x = RPL[id] || (RPL[id] = { id, kind: 'ed', hue: hue(id), tracks: [] });
  Object.assign(x, { name: brand(p.title) || x.name, cur: 'AURA', img: p.image || x.img, count: p.songCount || x.count });
  if (p.description) x.desc = brand(p.description);
  if (p.songs) { x.tracks = p.songs.map(ingSong).filter(Boolean); x.full = 1; }
  return id;
}

/* ---------------- loading helpers ---------------- */
function need(key, fn) {
  renderKeys.add(key);
  if (LOADED.has(key)) return true;
  if (ERR[key]) return 'err';
  if (!PENDING[key]) {
    PENDING[key] = fn().then(() => LOADED.add(key)).catch((e) => { ERR[key] = e.message; })
      .finally(() => { delete PENDING[key]; if (renderKeys.has(key)) { renderView(true); if (key === 'home') renderSidebar(); } });
  }
  return false;
}
const loading = (label = 'Loading…') => `<div class="empty"><span class="spin" role="status" aria-label="${esc(label)}"></span><b>${esc(label)}</b></div>`;
const errBox = (key, what = 'this') => `<div class="empty">${ic('info')}<b>Couldn’t load ${esc(what)}</b><span>${esc(cleanErr(ERR[key]) || 'Please try again in a moment.')}</span><button class="btn" data-act="retry" data-k="${esc(key)}">Try Again</button></div>`;
const ensure = {
  album: (id) => (AL[id] && AL[id].full) ? Promise.resolve() : api('/api/albums/' + enc(id)).then(ingAlbum).then(() => LOADED.add('album:' + id)),
  playlist: (id) => (RPL[id] && RPL[id].full) ? Promise.resolve() : api('/api/playlists/' + enc(id)).then(ingPlaylist).then(() => LOADED.add('pl:' + id)),
  artist: (id) => (ARTISTS[id] && ARTISTS[id].full) ? Promise.resolve() : loadArtist(id).then(() => LOADED.add('artist:' + id)),
};
async function loadArtist(id) {
  const a = await api('/api/artists/' + enc(id));
  const x = ARTISTS[ingArtist({ id: a.id, name: a.name, image: a.image })];
  Object.assign(x, {
    bio: a.bio, followers: a.followers, verified: a.verified, lang: a.language, kindLabel: a.type,
    top: a.topSongs.map(ingSong).filter(Boolean), albums: a.albums.map(ingAlbum).filter(Boolean),
    singles: a.singles.map(ingAlbum).filter(Boolean), similar: a.similar.map(ingArtist).filter(Boolean), full: 1,
  });
}
async function loadHome() {
  HOME = await api('/api/home');
  HOME.sections.forEach((s) => s.items.forEach(ingCard));
}
function ingCard(c) {
  c.title = brand(c.title); c.subtitle = brand(c.subtitle);
  if (c.type === 'song') c.ref = ingSong(c.song);
  else if (c.type === 'album') c.ref = ingAlbum(c.album);
  else if (c.type === 'playlist') c.ref = ingPlaylist(c.playlist);
  else if (c.type === 'artist') c.ref = ingArtist({ id: c.id, name: c.title, image: c.image });
  return c;
}

/* ---------------- artwork ---------------- */
const _albumArt = albumArt;
albumArt = function (id, cls = '') {
  const a = AL[id];
  if (a && a.img) return `<div class="art img ${cls}" style="--a:${a.a}"><img src="${esc(a.img)}" alt="" loading="lazy" decoding="async"></div>`;
  if (a) return _albumArt(id, cls);
  return `<div class="art s-user ${cls}" style="--a:200">${ic('note', 'note')}</div>`;
};
const _avatar = avatar;
avatar = function (id, cls = '') {
  const a = ARTISTS[id];
  if (a && a.img) return `<div class="avatar ${cls}" style="--a:${a.a};--b:${a.b}"><img src="${esc(a.img)}" alt="" loading="lazy" decoding="async"></div>`;
  if (a) return _avatar(id, cls);
  return '';
};
const _plArt = plArt;
plArt = function (p, cls = '') {
  if (p && p.img) return `<div class="art img ${cls}" style="--a:${p.hue || 200}"><img src="${esc(p.img)}" alt="" loading="lazy" decoding="async"></div>`;
  return _plArt(p, cls);
};
function stationCard(c, cls = '') {
  return `<article class="tile ${cls}" data-act="play-rstation" data-name="${esc(c.station.name)}" data-lang="${esc(c.station.language)}" data-kind="${esc(c.station.kind)}" data-img="${esc(c.image)}" tabindex="0">
    <div class="cover-wrap">${c.image ? `<div class="art img ${c.station.kind === 'artist' ? 'round-art' : ''}"><img src="${esc(c.image)}" alt="" loading="lazy"></div>` : stationLabelArt(c.title)}</div>
    <div class="tile-t">${esc(c.title)}</div><div class="tile-s">${c.station.kind === 'artist' ? 'Artist station' : 'Station'}</div></article>`;
}
const stationLabelArt = (t) => `<div class="art s-ed" style="--a:${hue(t)};--b:${(hue(t) + 40) % 360};--c:${(hue(t) + 180) % 360}"><span class="art-by">Station</span><span class="art-t">${esc(t)}</span></div>`;

/* ---------------- shared overrides ---------------- */
playable = function (t) { return !!t; };
artistTile = function (id) {
  const a = ARTISTS[id];
  if (!a) return '';
  return `<article class="tile round" data-go="artist" data-id="${esc(id)}" data-ctx="artist:${esc(id)}" tabindex="0">${avatar(id)}<div class="tile-t">${esc(a.name)}</div><div class="tile-s">Artist</div></article>`;
};
const _plById = plById;
plById = function (id) {
  const p = _plById(id);
  if (p) return p;
  return RPL[id] ? Object.assign({ kind: 'ed' }, RPL[id]) : null;
};
mixes = function () {
  const ok = (id) => TR[id] && S.love[id] !== -1;
  const loved = Object.keys(S.love).filter((k) => S.love[k] === 1 && TR[k]);
  const fav = [...new Set(loved.concat(seeded(libSongIds(), 'fav')))].filter(ok).slice(0, 25);
  const trend = HOME ? [...new Set(HOME.sections.flatMap((s) => s.items).filter((c) => c.type === 'song').map((c) => c.ref))].filter(ok) : [];
  const replay = [...new Set(S.history)].filter(ok).slice(0, 25);
  return [
    { id: 'mix-fav', kind: 'mix', name: 'Favourites Mix', cur: 'Made for you', desc: 'Songs you love and songs in your library.', hue: 330, tracks: fav },
    { id: 'mix-new', kind: 'mix', name: 'Trending Mix', cur: 'Made for you', desc: 'What’s trending right now.', hue: 180, tracks: trend },
    { id: 'mix-chill', kind: 'mix', name: 'Replay Mix', cur: 'Made for you', desc: 'The songs you played most recently.', hue: 150, tracks: replay },
  ].filter((m) => m.tracks.length);
};
const _recentTile = recentTile;
recentTile = function (x) {
  if (x.t === 'rstation') return stationCard({ title: x.id, image: x.img || '', station: { name: x.id, language: x.lang || '', kind: x.kind || 'featured' } });
  if (x.t === 'album' && !AL[x.id]) return '';
  if (x.t === 'artist' && !ARTISTS[x.id]) return '';
  return _recentTile(x);
};

/* ---------------- playback: stream through the backend ---------------- */
const SILENT = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
const audio = new Audio();
audio.preload = 'auto';
let endGuard = { id: null, at: 0 };
const AE = {
  ctx: null, ok: true, track: null, playing: false, offset: 0, want: 0,
  init() {
    if (this.ctx || !this.ok) return;
    // In the Android app the phone plays JioSaavn's audio directly, so the equalizer can't process it.
    if (window.AURA_NATIVE) { this.ok = false; return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      const c = this.ctx = new C();
      this.eq = [['lowshelf', 120], ['peaking', 1000], ['highshelf', 6000]].map(([type, f]) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; return b; });
      this.comp = c.createDynamicsCompressor(); this.vol = c.createGain();
      this.eq[0].connect(this.eq[1]); this.eq[1].connect(this.eq[2]); this.eq[2].connect(this.comp); this.comp.connect(this.vol); this.vol.connect(c.destination);
      c.createMediaElementSource(audio).connect(this.eq[0]);
      applySound();
    } catch (e) { this.ok = false; this.ctx = null; }
  },
  now() { return performance.now() / 1000; },
  position() { return this.track && audio.dataset.id === this.track.id ? audio.currentTime : this.offset; },
  play(t, off = 0) {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    this.track = t; this.playing = true; this.offset = off;
    if (audio.dataset.id !== t.id) {
      audio.dataset.id = t.id; audio.dataset.retried = ''; this.want = off;
      if (window.AURA_STREAM_URL) {
        const id = t.id;
        // Start a silent clip inside the tap so Android lets this player start the real song a moment later.
        if (!audio.dataset.unlocked) { audio.dataset.unlocked = '1'; audio.src = SILENT; const p0 = audio.play(); if (p0) p0.catch(() => {}); }
        window.AURA_STREAM_URL(id).then((u) => {
          if (audio.dataset.id !== id) return;
          audio.src = u;
          if (this.playing) audio.play().catch(() => {});
        }).catch((e) => { toast(e.message); if (S.playing) setTimeout(next, 700); });
        return;
      }
      audio.src = '/api/stream/' + enc(t.id);
    }
    else if (Math.abs(audio.currentTime - off) > 0.25) audio.currentTime = off;
    const pr = audio.play();
    if (pr) pr.catch((err) => { if (err && err.name === 'NotAllowedError') { S.playing = false; this.playing = false; updateAll(); toast('Press Play to start listening'); } });
  },
  pause() { audio.pause(); this.playing = false; this.offset = audio.currentTime; },
  seekTo(o) { this.offset = o; if (audio.readyState > 0) audio.currentTime = o; else this.want = o; },
  halt() {},
  setVolume(v) { if (this.vol) this.vol.gain.setTargetAtTime(v * v * 0.95, this.ctx.currentTime, 0.03); else audio.volume = Math.min(1, v * v); },
};
audio.addEventListener('loadedmetadata', () => {
  const t = TR[audio.dataset.id];
  if (t && Number.isFinite(audio.duration) && audio.duration > 0) t.dur = audio.duration;
  if (E.want) { audio.currentTime = E.want; E.want = 0; }
  updateProgress(true);
});
audio.addEventListener('ended', () => { if (S.playing && curId() === audio.dataset.id) onEnded(); });
audio.addEventListener('error', () => {
  if (!audio.dataset.id || !audio.getAttribute('src') || audio.src.startsWith('data:')) return;
  const t = TR[audio.dataset.id];
  if (window.AURA_STREAM_URL && t && !audio.dataset.retried) { // stream link expired: get a fresh one once
    const id = t.id, at = audio.currentTime;
    audio.dataset.retried = '1';
    window.JioSaavn.forgetStream(id);
    window.AURA_STREAM_URL(id).then((u) => { if (audio.dataset.id !== id) return; E.want = at; audio.src = u; if (S.playing) audio.play().catch(() => {}); })
      .catch(() => { toast(`Couldn’t play “${t.title}”. Skipping.`); if (S.playing) setTimeout(next, 700); });
    return;
  }
  toast(`Couldn’t play “${t ? t.title : 'this song'}”. Skipping.`);
  audio.dataset.id = '';
  if (S.playing) setTimeout(next, 700);
});
audio.addEventListener('waiting', () => { const s = document.querySelector('.lcd-title'); if (s) s.dataset.wait = '1'; });
const _onEnded = onEnded;
onEnded = function () {
  const id = curId();
  if (endGuard.id === id && Date.now() - endGuard.at < 1500) return;
  endGuard = { id, at: Date.now() };
  _onEnded();
};
setMedia = function () {
  try {
    const t = curTrack();
    if (!t || !('mediaSession' in navigator)) return;
    const art = (AL[t.album] && AL[t.album].img) || t.img;
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artistsText || ARTISTS[t.artist].name, album: AL[t.album] ? AL[t.album].title : '', artwork: art ? [{ src: art, sizes: '500x500', type: 'image/jpeg' }] : [] });
    [['play', togglePlay], ['pause', togglePlay], ['nexttrack', next], ['previoustrack', prev]].forEach(([a, f]) => navigator.mediaSession.setActionHandler(a, () => f()));
    navigator.mediaSession.setActionHandler('seekto', (d) => seek(d.seekTime));
  } catch (e) {}
};

/* ---------------- stations & autoplay ---------------- */
async function radioFrom(id) { const r = await api('/api/radio/song/' + enc(id)); return r.songs.map(ingSong).filter(Boolean); }
extendAutoplay = function () {
  const id = curId();
  if (!id) return false;
  radioFrom(id).then((ids) => {
    const seen = new Set(S.queue.concat(S.history.slice(0, 40)));
    const add = ids.filter((x) => !seen.has(x) && S.love[x] !== -1);
    if (!add.length) { stopAtEnd(); return; }
    if (S.autoFrom < 0) S.autoFrom = S.queue.length;
    S.queue.push(...add); if (S.orig) S.orig.push(...add);
    S.qi++; startTrack(0);
  }).catch(() => { stopAtEnd(); toast('Autoplay couldn’t find more songs'); });
  return 'pending';
};
stationFrom = function (tid) {
  const t = TR[tid];
  toast(`Starting a station from “${t.title}”…`);
  radioFrom(tid).then((ids) => { S.shuffle = false; playList([tid, ...ids.filter((x) => x !== tid)], 0, `${t.title} Station`); })
    .catch((e) => toast(e.message));
};
playArtist = function (id, sh) {
  ensure.artist(id).then(() => {
    const a = ARTISTS[id];
    if (!a.top || !a.top.length) return toast('No songs found for this artist');
    playList(a.top, 0, a.name, { shuffle: sh, recent: ['artist', id] });
  }).catch((e) => toast(e.message));
};
artistStation = function (id) {
  toast(`Starting ${ARTISTS[id] ? ARTISTS[id].name : 'artist'} station…`);
  ensure.artist(id).then(async () => {
    const a = ARTISTS[id];
    if (!a.top || !a.top.length) throw new Error('No songs found for this artist');
    const more = await radioFrom(a.top[0]).catch(() => []);
    const ids = [...new Set([a.top[0], ...more, ...a.top.slice(1, 4)])];
    S.shuffle = false; playList(ids, 0, `${a.name} Station`, { recent: ['artist', id] });
  }).catch((e) => toast(e.message));
};
function playFeatured(name, lang, kind, image) {
  toast(`Tuning in to ${name}…`);
  api(`/api/radio/featured?name=${enc(name)}&lang=${enc(lang || '')}&kind=${enc(kind || 'featured')}`).then((r) => {
    const ids = r.songs.map(ingSong).filter(Boolean);
    if (!ids.length) throw new Error(`${name} has no songs right now`);
    S.shuffle = false; playList(ids, 0, `${name} Station`);
    S.recent = [{ t: 'rstation', id: name, lang, kind, img: image || '' }].concat(S.recent.filter((x) => !(x.t === 'rstation' && x.id === name))).slice(0, 14);
    persist();
  }).catch((e) => toast(e.message));
}
playStation = function (term, label) {
  const r = SR[term], seed = r && r.songs && r.songs[0];
  if (!r) { toast(`Starting ${label || term + ' station'}…`); return api('/api/search?q=' + enc(term)).then((x) => { SR[term] = x; if (x.songs && x.songs.length) playStation(term, label); else toast('No songs found for ' + term); }).catch((e) => toast(e.message)); }
  if (!seed) return toast('No songs found for ' + term);
  if (!label) toast(`Starting ${term} station…`);
  const first = r.songs.slice(0, 5).map(ingSong).filter(Boolean);
  radioFrom(first[0]).then((ids) => { S.shuffle = false; playList([...new Set([...first, ...ids])], 0, label || `${term} Station`); })
    .catch(() => { S.shuffle = false; playList(first, 0, label || `${term} Station`); });
};

/* ---------------- lyrics (plain text from JioSaavn, not time-synced) ---------------- */
const _lyricsHTML = lyricsHTML;
lyricsHTML = function (t, cls = '') {
  if (!t || !t.remote) return _lyricsHTML(t, cls);
  if (t.lines) return `<div class="lyr static ${cls}">${t.lines.map((l) => `<p class="${l ? '' : 'gap'}">${l ? esc(l) : '• • •'}</p>`).join('')}${t.lyrCopy ? `<p class="lyr-msg" style="font-size:12px">${esc(t.lyrCopy)}</p>` : ''}</div>`;
  if (t.hasLyrics) { loadLyrics(t); return `<div class="lyr ${cls}"><p class="lyr-msg">Loading lyrics…</p></div>`; }
  return `<div class="lyr ${cls}"><p class="lyr-msg">Lyrics aren’t available for this song.</p></div>`;
};
function loadLyrics(t) {
  if (t._lyr) return;
  t._lyr = 1;
  api('/api/lyrics/' + enc(t.id)).then((r) => {
    t.lines = r.lines && r.lines.some(Boolean) ? r.lines : null;
    t.lyrCopy = r.copyright || '';
    if (!t.lines) t.hasLyrics = false;
  }).catch(() => { t.hasLyrics = false; }).finally(() => { if (curId() === t.id) { renderPanel(); renderFull(); } });
}

/* ---------------- Get Info ---------------- */
infoModal = function (id) {
  const t = TR[id], a = AL[t.album] || {};
  const row = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : '';
  openModal(`<div class="modal-head"><h3>Get Info</h3><button class="tbtn sm" data-act="close-modal" aria-label="Close">${ic('close')}</button></div>
   <div class="modal-body"><div class="info-head">${albumArt(t.album)}<div><b>${esc(t.title)}</b><span class="muted">${esc(t.artistsText || ARTISTS[t.artist].name)}</span></div></div>
   <dl class="kv">${row('Album', esc(a.title || ''))}${row('Artists', esc(t.artistsText || ''))}${row('Released', esc(niceDate(t.releaseDate) || t.year || ''))}${row('Language', esc(t.lang ? cap(t.lang) : ''))}
   ${row('Duration', fmt(t.dur))}${row('Label', esc(t.label || ''))}${row('Lyrics', t.lines ? 'Available' : t.hasLyrics ? 'Available' : 'Not available')}${row('Copyright', esc(t.copyright || ''))}
   </dl></div>
   <div class="modal-foot"><button class="btn" data-act="close-modal">Done</button></div>`);
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------------- tiles for JioSaavn cards ---------------- */
function cardTile(c) {
  switch (c.type) {
    case 'song': {
      const t = TR[c.ref];
      if (!t) return '';
      return `<article class="tile" data-act="play-song" data-id="${esc(t.id)}" data-ctx="song:${esc(t.id)}" tabindex="0"><div class="cover-wrap">${albumArt(t.album)}<div class="hover-btns"><button class="hb play" data-act="play-song" data-id="${esc(t.id)}" aria-label="Play ${esc(t.title)}">${ic('play')}</button><button class="hb" data-menu="song:${esc(t.id)}" aria-label="More options">${ic('more')}</button></div></div><div class="tile-t">${esc(t.title)}</div><div class="tile-s">${esc(t.artistsText)}</div></article>`;
    }
    case 'album': return AL[c.ref] ? albumTile(c.ref) : '';
    case 'playlist': { const p = plById(c.ref); return p ? plTile(p, esc(c.subtitle || p.cur)) : ''; }
    case 'artist': return artistTile(c.ref);
    case 'station': return stationCard(c);
    default: return '';
  }
}
const heroOf = (c, label) => {
  if (!c) return '';
  if (c.type === 'station') return `<article class="hero-card" data-act="play-rstation" data-name="${esc(c.station.name)}" data-lang="${esc(c.station.language)}" data-kind="${esc(c.station.kind)}" data-img="${esc(c.image)}" tabindex="0"><div class="hero-label">${label}</div><div class="hero-art">${c.image ? `<div class="art img"><img src="${esc(c.image)}" alt="" loading="lazy"></div>` : stationLabelArt(c.title)}</div><div class="hero-cap"><b>${esc(c.title)}</b><span>Station · Tap to listen</span></div></article>`;
  const go = c.type === 'album' ? `data-go="album" data-id="${esc(c.ref)}"` : c.type === 'playlist' ? `data-go="playlist" data-id="${esc(c.ref)}"` : `data-act="play-song" data-id="${esc(c.ref)}"`;
  const art = c.type === 'playlist' ? plArt(plById(c.ref)) : albumArt(c.type === 'album' ? c.ref : TR[c.ref].album);
  return `<article class="hero-card" ${go} tabindex="0"><div class="hero-label">${label}</div><div class="hero-art">${art}</div><div class="hero-cap"><b>${esc(c.title)}</b><span>${esc(c.subtitle || '')}</span></div></article>`;
};
const sectionShelf = (s, more) => shelf(esc(s.title), s.items.map(cardTile).filter(Boolean), more, s.subtitle ? esc(s.subtitle) : '');
const secByKey = (re) => HOME ? HOME.sections.filter((s) => re.test(s.key)) : [];
const allCards = (type) => HOME ? HOME.sections.flatMap((s) => s.items).filter((c) => c.type === type) : [];

/* ---------------- views: AURA's own layout, filled with the live library ---------------- */
const tagline = '<p class="tagline">Listen to your heart’s desire</p>';
const uniq = (a) => [...new Set(a.filter(Boolean))];
const feedRefs = (type) => uniq((HOME ? HOME.sections : []).flatMap((s) => s.items).filter((c) => c.type === type).map((c) => c.ref));
const feedStations = () => (HOME ? HOME.sections : []).flatMap((s) => s.items).filter((c) => c.type === 'station');
const feedArtists = () => uniq([...feedRefs('song').map((t) => TR[t] && TR[t].artist), ...feedRefs('album').map((a) => AL[a] && AL[a].artist), ...feedRefs('artist')])
  .filter((a) => ARTISTS[a] && !a.startsWith('n_'));
function homeWait(title, sub) {
  const n = need('home', loadHome);
  if (n === 'err') return head(title, sub) + errBox('home', 'your music');
  if (!n) return head(title, sub) + (title === 'Home' ? tagline : '') + loading();
  return null;
}
const heroAlbum = (id, label) => `<article class="hero-card" data-go="album" data-id="${esc(id)}" tabindex="0"><div class="hero-label">${label}</div><div class="hero-art">${albumArt(id)}</div><div class="hero-cap"><b>${esc(AL[id].title)}</b><span>${esc((ARTISTS[AL[id].artist] || {}).name || '')}</span></div></article>`;
const heroPl = (p, label) => `<article class="hero-card" data-go="playlist" data-id="${esc(p.id)}" tabindex="0"><div class="hero-label">${label}</div><div class="hero-art">${plArt(p)}</div><div class="hero-cap"><b>${esc(p.name)}</b><span>${esc(p.desc || p.cur || '')}</span></div></article>`;
const heroLive = (label) => { const { show } = liveShow(); return `<article class="hero-card" data-act="play-live" tabindex="0"><div class="hero-label">${label}</div><div class="hero-art">${liveArt('AURA One · Live', esc(show[0]))}</div><div class="hero-cap"><b>${esc(show[0])}</b><span>${esc(show[1])} · Listen live</span></div></article>`; };
const stationTiles = () => feedStations().filter((c) => c.station.kind !== 'artist').map((c) => stationCard(c));

VIEWS.home = function () {
  const wait = homeWait('Home'); if (wait) return wait;
  const mx = mixes(), albums = feedRefs('album'), pls = feedRefs('playlist').map(plById).filter(Boolean);
  const loved = Object.keys(S.love).filter((k) => S.love[k] === 1 && TR[k]).slice(0, 8);
  const picks = [mx[0] ? heroPl(mx[0], 'Made for you') : pls[0] ? heroPl(pls[0], 'Playlist') : '', albums[0] ? heroAlbum(albums[0], 'New release') : '', heroLive('Live now')].join('');
  return head('Home') + tagline +
    `<section><div class="shelf-head" style="margin-top:8px"><h2>Top Picks for You</h2></div><div class="heroes">${picks}</div></section>` +
    shelf('Recently Played', S.recent.map(recentTile).filter(Boolean)) +
    shelf('Made for You', mx.map((m) => plTile(m, m.desc)), 'madeforyou') +
    shelf('New Releases', albums.slice(0, 12).map((id) => albumTile(id)), 'new') +
    (loved.length ? `<section><div class="shelf-head"><h2>Songs You Love</h2></div><div class="top-songs">${trackList(loved, 'Songs You Love', { art: 1, noAlb: 1 })}</div></section>` : '') +
    shelf('Playlists for You', pls.map((p) => plTile(p))) +
    shelf('Stations for You', stationTiles()) +
    shelf('Artists You Might Like', feedArtists().slice(0, 12).map(artistTile));
};
VIEWS.new = function () {
  const sub = 'The latest releases, updated every day.';
  const wait = homeWait('New', sub); if (wait) return wait;
  const albums = feedRefs('album'), hot = feedRefs('song').slice(0, 10), pls = feedRefs('playlist').map(plById).filter(Boolean);
  return head('New', sub) +
    (albums.length ? `<section><div class="shelf-head" style="margin-top:8px"><h2>New Releases</h2></div><div class="grid">${albums.map((id) => albumTile(id, esc((ARTISTS[AL[id].artist] || {}).name || ''))).join('')}</div></section>` : '') +
    (hot.length ? `<section><div class="shelf-head"><h2>Hot Tracks</h2></div><div class="top-songs">${trackList(hot, 'Hot Tracks', { art: 1, noAlb: 1 })}</div></section>` : '') +
    shelf('Updated Playlists', pls.map((p) => plTile(p, 'Updated this week')));
};
// AURA One's shows play a station built from these search terms
const SHOW_TERMS = { pop: 'Bollywood', indie: 'Indie', jazz: 'Jazz', lofi: 'Lo-Fi', electronic: 'EDM', rnb: 'R&B', rock: 'Rock', hiphop: 'Hip Hop', synthwave: 'Retro', ambient: 'Instrumental', classical: 'Classical' };
playLive = function () { const { show } = liveShow(); playStation(SHOW_TERMS[show[2][0]] || 'Bollywood', `AURA One · ${show[0]}`); };
VIEWS.radio = function () {
  const wait = homeWait('Radio'); if (wait) return wait;
  const { i, show, start } = liveShow();
  const hh = (h) => String(h % 24).padStart(2, '0') + ':00';
  const up = [1, 2, 3].map((k) => { const j = (i + k) % 6; return `<div class="sched-row"><span>${hh(6 + j * 4)}</span><span><b>${esc(SHOWS[j][0])}</b><small>${esc(SHOWS[j][1])} · ${SHOWS[j][2].map((g) => GENRES[g].name).join(', ')}</small></span></div>`; }).join('');
  const recentSt = S.recent.filter((x) => x.t === 'rstation');
  const artists = uniq([...libArtistIds(), ...feedArtists()]).filter((a) => ARTISTS[a] && !a.startsWith('n_')).slice(0, 12);
  return head('Radio') +
    `<div class="live" style="--a:350;--b:20"><div class="live-main"><span class="live-badge">LIVE</span><span class="eyebrow" style="color:rgba(255,255,255,.8)">AURA One · ${hh(start)}–${hh(start + 4)}</span><h2>${esc(show[0])}</h2><p>${esc(show[1])}. ${show[2].map((g) => GENRES[g].name).join(', ')} all show long.</p><button class="btn" data-act="play-live">${ic('play')}Listen Now</button></div>
     <div class="live-sched"><h4>Coming up</h4>${up}</div></div>` +
    shelf('Recently Played Stations', recentSt.map(recentTile)) +
    shelf('Stations for You', stationTiles()) +
    `<section><div class="shelf-head"><h2>Stations by Genre</h2></div><div class="cats">${CATS.map(([n, h]) => `<button class="cat" style="--a:${h}" data-act="play-station" data-id="${esc(n)}"><b>${esc(n)}</b><span>${ic('radio')}Station</span></button>`).join('')}</div></section>` +
    shelf('Stations from Artists', artists.map((a) => `<article class="tile round" data-act="artist-station" data-id="${esc(a)}" tabindex="0">${avatar(a)}<div class="tile-t">${esc(ARTISTS[a].name)}</div><div class="tile-s">Station</div></article>`));
};
const CATS = [['Bollywood', 25], ['Romance', 340], ['Party', 300], ['Pop', 330], ['Punjabi', 40], ['Indie', 96], ['Hip Hop', 46], ['90s', 220], ['Devotional', 50], ['Tamil', 190], ['Telugu', 270], ['Ghazal', 30], ['Sufi', 140], ['Rock', 6], ['Lo-Fi', 160], ['Classical', 220]];
const MOODS_LIVE = [['Chill', 165], ['Focus', 212], ['Workout', 8], ['Late Night', 292], ['Sleep', 236], ['Sunday Morning', 36], ['Road Trip', 20], ['Heartbreak', 330]];
const browseCats = () => `<div class="shelf-head" style="margin-top:6px"><h2>Browse Categories</h2></div><div class="cats">${CATS.map(([n, h]) => `<button class="cat" style="--a:${h}" data-go="genre" data-id="${esc(n)}"><b>${esc(n)}</b><span>Playlists, songs and albums</span></button>`).join('')}</div>
  <div class="shelf-head"><h2>Moods &amp; Activities</h2></div><div class="cats">${MOODS_LIVE.map(([n, h]) => `<button class="cat" style="--a:${h}" data-go="genre" data-id="${esc(n)}"><b>${esc(n)}</b><span>Songs for the moment</span></button>`).join('')}</div>`;
let searchTimer = 0;
searchResults = function () {
  const q = S.search.trim();
  if (!q) return browseCats();
  const lib = S.scope === 'lib';
  const seg = `<div class="toolbar"><div class="seg"><button class="${lib ? '' : 'on'}" data-act="scope" data-k="all">AURA</button><button class="${lib ? 'on' : ''}" data-act="scope" data-k="lib">Your Library</button></div></div>`;
  if (lib) return seg + libSearch(q);
  const r = SR[q];
  if (!r) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      api('/api/search?q=' + enc(q)).then((res) => { SR[q] = res; }).catch((e) => { SR[q] = { error: e.message }; })
        .finally(() => { if (S.search.trim() === q && cur().name === 'search') updateSearch(S.search); });
    }, 280);
    return seg + loading('Searching…');
  }
  if (r.error) return seg + `<div class="empty">${ic('info')}<b>Search didn’t work</b><span>${esc(r.error)}</span></div>`;
  const songsIds = r.songs.map(ingSong).filter(Boolean), albums = r.albums.map(ingAlbum).filter(Boolean),
    artists = r.artists.map(ingArtist).filter(Boolean), pls = r.playlists.map(ingPlaylist).filter(Boolean);
  const none = !songsIds.length && !albums.length && !artists.length && !pls.length;
  const top = [
    ...artists.slice(0, 1).map((a) => `<button class="tr-card" data-go="artist" data-id="${esc(a)}">${avatar(a)}<span><b>${esc(ARTISTS[a].name)}</b><small>Artist</small></span></button>`),
    ...albums.slice(0, 1).map((a) => `<button class="tr-card" data-go="album" data-id="${esc(a)}">${albumArt(a, 'mini')}<span><b>${esc(AL[a].title)}</b><small>Album · ${esc(ARTISTS[AL[a].artist].name)}</small></span></button>`),
    ...songsIds.slice(0, 1).map((t) => `<button class="tr-card" data-act="play-song" data-id="${esc(t)}">${albumArt(TR[t].album, 'mini')}<span><b>${esc(TR[t].title)}</b><small>Song · ${esc(TR[t].artistsText)}</small></span></button>`),
  ];
  return seg + (none ? `<div class="empty">${ic('search')}<b>No results for “${esc(q)}”</b><span>Check the spelling or try another word.</span></div>` : '') +
    (top.length ? `<section><div class="shelf-head" style="margin-top:6px"><h2>Top Results</h2></div><div class="top-results">${top.join('')}</div></section>` : '') +
    (songsIds.length ? `<section><div class="shelf-head"><h2>Songs</h2></div>${trackList(songsIds, 'Search: ' + q, { art: 1 })}</section>` : '') +
    shelf('Albums', albums.map((a) => albumTile(a))) + shelf('Artists', artists.map(artistTile)) + shelf('Playlists', pls.map((p) => plTile(plById(p))));
};
function libSearch(q) {
  const m = (s) => String(s || '').toLowerCase().includes(q.toLowerCase());
  const tr = libSongIds().filter((id) => m(TR[id].title) || m(TR[id].artistsText) || m((AL[TR[id].album] || {}).title));
  const al = libAlbumIds().filter((a) => AL[a] && (m(AL[a].title) || m(ARTISTS[AL[a].artist].name)));
  const pl = libPlaylists().filter((p) => m(p.name));
  if (!tr.length && !al.length && !pl.length) return `<div class="empty">${ic('search')}<b>Nothing in your library matches “${esc(q)}”</b><span>Switch to AURA to search everything.</span></div>`;
  return (tr.length ? `<section><div class="shelf-head" style="margin-top:6px"><h2>Songs</h2></div>${trackList(tr.slice(0, 20), 'Library search', { art: 1 })}</section>` : '') +
    shelf('Albums', al.map((a) => albumTile(a))) + shelf('Playlists', pl.map((p) => plTile(p)));
}
VIEWS.genre = function (term) {
  const key = 'cat:' + term;
  const n = need(key, () => api('/api/search?q=' + enc(term)).then((r) => { SR[term] = r; }));
  const h = hue(term);
  const banner = `<div class="banner-art" style="--a:${h};--b:${(h + 50) % 360}"><div><div class="eyebrow">Category</div><h1>${esc(term)}</h1><div class="dbtns"><button class="btn primary" data-act="play-station" data-id="${esc(term)}">${ic('radio')}Play Station</button></div></div></div>`;
  if (n === 'err') return banner + errBox(key, term);
  if (!n) return banner + loading();
  const r = SR[term];
  const pls = r.playlists.map(ingPlaylist).filter(Boolean), tr = r.songs.map(ingSong).filter(Boolean), al = r.albums.map(ingAlbum).filter(Boolean);
  return banner + shelf('Playlists', pls.map((p) => plTile(plById(p)))) +
    (tr.length ? `<section><div class="shelf-head"><h2>Top Songs</h2></div><div class="top-songs">${trackList(tr.slice(0, 12), term, { art: 1, noAlb: 1 })}</div></section>` : '') +
    shelf('Albums', al.map((a) => albumTile(a)));
};
VIEWS.album = function (id) {
  const key = 'album:' + id;
  if (!(AL[id] && AL[id].full)) {
    const n = need(key, () => ensure.album(id));
    if (n === 'err') return errBox(key, 'this album');
    if (!n) return AL[id] ? `<header class="dhead">${albumArt(id)}<div class="dinfo"><div class="eyebrow">Album</div><h1>${esc(AL[id].title)}</h1></div></header>${loading()}` : loading();
  }
  const a = AL[id], art = ARTISTS[a.artist] || { name: '' };
  const more = art.albums ? art.albums.filter((x) => x !== id) : [];
  return `<header class="dhead">${albumArt(id)}<div class="dinfo"><div class="eyebrow">${esc(a.type || 'Album')}</div><h1>${esc(a.title)}</h1>
     <button class="by" data-go="artist" data-id="${esc(a.artist)}">${esc(art.name)}</button>
     <p class="muted">${[a.lang ? cap(a.lang) : '', String(a.date || '').slice(0, 4)].filter(Boolean).join(' · ')}</p>${a.note ? `<p class="note">${esc(a.note)}</p>` : ''}
     <div class="dbtns">${playBtns('play-album', id, !a.tracks.length)}<button class="tbtn round" data-act="lib-album" data-id="${esc(id)}" aria-label="${inLibAlbum(id) ? 'In your library' : 'Add to library'}" title="${inLibAlbum(id) ? 'In your library' : 'Add to library'}">${ic(inLibAlbum(id) ? 'check' : 'plus')}</button><button class="tbtn round" data-menu="album:${esc(id)}" aria-label="More options">${ic('more')}</button></div></div></header>
   ${trackList(a.tracks, a.title, { noAlb: 1 }, ['album', id])}
   <p class="tfoot">${esc(niceDate(a.date))}<br>${songs(a.tracks.length)}, ${mins(a.tracks)}${a.copyright ? '<br>' + esc(a.copyright) : ''}</p>
   ${shelf('More by ' + esc(art.name), more.map((x) => albumTile(x)))}`;
};
VIEWS.artist = function (id) {
  const a0 = ARTISTS[id];
  if (!a0) return VIEWS.missing();
  const local = id.startsWith('n_');
  if (!local && !a0.full) {
    const key = 'artist:' + id, n = need(key, () => ensure.artist(id));
    if (n === 'err') return errBox(key, a0.name);
    if (!n) return `<div class="banner-art" style="--a:${a0.a};--b:${a0.b}"><div><div class="eyebrow">Artist</div><h1>${esc(a0.name)}</h1></div></div>${loading()}`;
  }
  const a = ARTISTS[id];
  const top = local ? Object.keys(TR).filter((t) => TR[t].artist === id).slice(0, 10) : a.top || [];
  return `<div class="banner-art" style="--a:${a.a};--b:${a.b}">${a.img ? `<img src="${esc(a.img)}" alt="" style="position:absolute;right:22px;bottom:22px;width:min(170px,30vw);aspect-ratio:1;border-radius:50%;object-fit:cover;box-shadow:0 12px 40px rgba(0,0,0,.35)">` : ''}
     <div style="position:relative;max-width:calc(100% - min(190px,32vw))"><div class="eyebrow">${a.verified ? 'Verified artist' : 'Artist'}${a.followers ? ' · ' + a.followers.toLocaleString('en-GB') + ' followers' : ''}</div><h1>${esc(a.name)}</h1>
     <div class="dbtns"><button class="btn primary" data-act="play-artist" data-id="${esc(id)}" ${top.length ? '' : 'disabled'}>${ic('play')}Play</button><button class="btn" data-act="play-artist" data-shuffle="1" data-id="${esc(id)}" ${top.length ? '' : 'disabled'}>${ic('shuffle')}Shuffle</button>${local ? '' : `<button class="btn" data-act="artist-station" data-id="${esc(id)}">${ic('radio')}Station</button>`}</div></div></div>
   ${top.length ? `<section><div class="shelf-head" style="margin-top:6px"><h2>Top Songs</h2></div><div class="top-songs">${trackList(top, a.name + ' Top Songs', { art: 1, noAlb: 1, noArtist: 1 }, ['artist', id])}</div></section>` : ''}
   ${shelf('Albums', (a.albums || []).map((x) => albumTile(x, String(AL[x].date || '').slice(0, 4))))}
   ${shelf('Singles', (a.singles || []).map((x) => albumTile(x, String(AL[x].date || '').slice(0, 4))))}
   ${shelf('Similar Artists', (a.similar || []).map(artistTile))}
   ${a.bio ? `<section><div class="shelf-head"><h2>About ${esc(a.name)}</h2></div><p class="about bio">${esc(a.bio)}</p></section>` : ''}`;
};
const _playlistView = VIEWS.playlist;
VIEWS.playlist = function (id) {
  if (RPL[id] && !RPL[id].full) {
    const key = 'pl:' + id, n = need(key, () => ensure.playlist(id));
    if (n === 'err') return errBox(key, 'this playlist');
    if (!n) return `<header class="dhead">${plArt(plById(id))}<div class="dinfo"><div class="eyebrow">Playlist</div><h1>${esc(RPL[id].name)}</h1></div></header>${loading()}`;
  }
  return _playlistView(id);
};
const _renderView = renderView;
renderView = function (keep) { renderKeys = new Set(); _renderView(keep); };

/* ---------------- actions that need data first ---------------- */
const _act = act;
act = function (n, el, e) {
  const id = el.dataset.id, sh = !!el.dataset.shuffle;
  switch (n) {
    case 'retry': { const k = el.dataset.k; delete ERR[k]; LOADED.delete(k); renderView(true); return; }
    case 'play-rstation': return playFeatured(el.dataset.name, el.dataset.lang, el.dataset.kind, el.dataset.img);
    case 'play-song': { const t = TR[id]; if (!t) return; return playList([id], 0, t.title); }
    case 'play-album': return ensure.album(id).then(() => { const a = AL[id]; playList(a.tracks, 0, a.title, { shuffle: sh, recent: ['album', id] }); }).catch((x) => toast(x.message));
    case 'play-pl': {
      if (RPL[id]) return ensure.playlist(id).then(() => { const p = plById(id); playList(p.tracks, 0, p.name, { shuffle: sh, recent: ['pl', id] }); }).catch((x) => toast(x.message));
      return _act(n, el, e);
    }
    case 'lib-album': return ensure.album(id).then(() => { libAlbum(id); persist(); }).catch((x) => toast(x.message));
    default: return _act(n, el, e);
  }
};
const _openMenu = openMenu;
openMenu = function (key, pos) {
  const [k, id] = key.split(':');
  if (k === 'album' && AL[id] && !AL[id].full) { ensure.album(id).then(() => { if (MENU) _openMenu(key, MENU.pos); }).catch(() => {}); }
  if (k === 'pl' && RPL[id] && !RPL[id].full) { ensure.playlist(id).then(() => { if (MENU) _openMenu(key, MENU.pos); }).catch(() => {}); }
  _openMenu(key, pos);
};

/* ---------------- settings: About tab ---------------- */
const _settingsModal = settingsModal;
settingsModal = function (tab) {
  _settingsModal(tab);
  const snd = document.querySelector('#modal-root fieldset[data-tab="sound"]');
  if (snd && window.AURA_NATIVE) snd.innerHTML = `<p><b>Equalizer</b></p><p class="muted">In the Android app, songs stream directly to the app, so the equalizer can’t change them. It works when you use AURA on your computer with <code>node server.js</code>. Your phone’s own sound settings still apply.</p>`;
  const f = document.querySelector('#modal-root fieldset[data-tab="about"]');
  if (f) f.innerHTML = `<img class="about-logo" src="${LOGO}" alt="AURA logo"><p><b>AURA</b> · <i>Listen to your heart’s desire.</i></p>
    <p>${window.AURA_NATIVE ? 'You’re listening to AURA’s live library, streamed straight to this phone.' : 'You’re listening to AURA’s live library, streamed through the AURA server on this computer.'}</p>
    <p class="muted">Your library, playlists, loved songs and settings are saved in this browser. Lyrics aren’t time-synced.</p>
    <button type="button" class="btn" data-act="reset-live" style="align-self:flex-start">${ic('trash')}Clear Library</button>`;
};
const _act2 = act;
act = function (n, el, e) {
  if (n === 'reset-live') { try { localStorage.removeItem(RKEY); localStorage.removeItem(CKEY); } catch (x) {} location.reload(); return; }
  return _act2(n, el, e);
};

/* ---------------- persistence ---------------- */
persist = function () {
  try {
    localStorage.setItem(RKEY, JSON.stringify({ lib: S.lib, playlists: S.playlists, love: S.love, recent: S.recent, settings: S.settings, theme: S.theme, volume: S.volume, profile: S.profile, plays: S.plays, listen: Math.round(S.listen) }));
    const tids = new Set([...Object.keys(S.lib.songs), ...S.playlists.flatMap((p) => p.tracks), ...Object.keys(S.love), ...S.history.slice(0, 60),
      ...Object.entries(S.plays).sort((a, b) => b[1] - a[1]).slice(0, 100).map(([id]) => id)]);
    Object.keys(S.lib.albums).forEach((a) => ((AL[a] && AL[a].tracks) || []).forEach((t) => tids.add(t)));
    Object.keys(S.lib.playlists).forEach((p) => ((RPL[p] && RPL[p].tracks) || []).forEach((t) => tids.add(t)));
    const tr = {}, al = {}, ar = {}, pl = {};
    const keepAr = (id) => { if (ARTISTS[id]) { const { top, albums, singles, similar, full, ...rest } = ARTISTS[id]; ar[id] = rest; } };
    tids.forEach((id) => { const t = TR[id]; if (!t) return; const { lines, _lyr, lyrCopy, ...rest } = t; tr[id] = rest; if (AL[t.album]) al[t.album] = { ...AL[t.album], full: 0, tracks: [] }; keepAr(t.artist); });
    Object.keys(S.lib.albums).forEach((a) => { if (AL[a]) { al[a] = { ...AL[a] }; keepAr(AL[a].artist); } });
    S.recent.forEach((x) => {
      if (x.t === 'album' && AL[x.id]) { al[x.id] = al[x.id] || { ...AL[x.id], full: 0, tracks: [] }; keepAr(AL[x.id].artist); }
      if (x.t === 'pl' && RPL[x.id]) pl[x.id] = { ...RPL[x.id], full: 0, tracks: [] };
      if (x.t === 'artist') keepAr(x.id);
    });
    Object.keys(S.lib.playlists).forEach((p) => { if (RPL[p]) pl[p] = { ...RPL[p] }; });
    localStorage.setItem(CKEY, JSON.stringify({ tr, al, ar, pl }));
  } catch (e) {}
};

/* ---------------- boot ---------------- */
async function start() {
  try { const h = await api('/api/health'); if (!h.ok) throw new Error('down'); }
  catch (e) { window.AURA_REMOTE = false; window.__booted = 0; bootDemo(); return; }
  // swap the sample catalogue for the live one
  for (const m of [TR, AL, ARTISTS, EDI]) for (const k of Object.keys(m)) delete m[k];
  ALBUMS.length = 0; EDITORIAL.length = 0; ALL_TRACKS.length = 0;
  let sv = {}, c = {};
  try { sv = JSON.parse(localStorage.getItem(RKEY)) || {}; } catch (e) {}
  try { c = JSON.parse(localStorage.getItem(CKEY)) || {}; } catch (e) {}
  Object.assign(ARTISTS, c.ar || {}); Object.assign(AL, c.al || {}); Object.assign(TR, c.tr || {}); Object.assign(RPL, c.pl || {});
  Object.values(AL).forEach((a) => { if (a.full && a.tracks.some((t) => !TR[t])) { a.full = 0; } });
  Object.values(RPL).forEach((p) => { p.tracks = (p.tracks || []).filter((t) => TR[t]); if (p.full && !p.tracks.length) p.full = 0; });
  S.lib = sv.lib || { albums: {}, songs: {}, playlists: {} };
  S.playlists = (sv.playlists || []).map((p) => ({ ...p, tracks: p.tracks.filter((t) => TR[t]) }));
  S.love = sv.love || {};
  S.recent = sv.recent || [];
  if (sv.profile) S.profile = sv.profile;
  S.plays = sv.plays || {}; S.listen = sv.listen || 0;
  if (sv.settings) Object.assign(S.settings, sv.settings);
  if (sv.theme) S.theme = sv.theme;
  if (typeof sv.volume === 'number') S.volume = sv.volume;
  Object.keys(S.lib.songs).forEach((t) => { if (!TR[t]) delete S.lib.songs[t]; });
  Object.keys(S.lib.albums).forEach((a) => { if (!AL[a]) delete S.lib.albums[a]; });
  Object.assign(E, AE);
  document.body.classList.add('aura-live');
  applyTheme(); renderSidebar(); renderPlayer(); renderPanel(); renderView();
  document.body.classList.add('paused');
}
start();
})();
