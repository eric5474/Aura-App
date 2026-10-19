'use strict';
/* A stand-in for www.jiosaavn.com/api.php used by the automated tests.
   Responses follow the api_version=4 shapes the real site returns.
   Run: node test/mock-jiosaavn.js   (port 4555) */
const http = require('http');
const PORT = Number(process.env.MOCK_PORT) || 4555;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const ARTISTS = [
  { id: '459320', name: 'Arijit Singh' }, { id: '456323', name: 'Shreya Ghoshal' },
  { id: '702592', name: 'A.R. Rahman' }, { id: '881158', name: 'Pritam' },
];
const image = (k) => `${ORIGIN}/img/${k}-150x150.jpg`;
const artistRef = (a, role = 'singer') => ({ id: a.id, name: a.name, role, image: image('ar' + a.id), type: 'artist', perma_url: '' });
const SONGS = Array.from({ length: 24 }, (_, i) => {
  const a = ARTISTS[i % 4], b = ARTISTS[(i + 1) % 4], album = 'al' + Math.floor(i / 6);
  return {
    id: 'sg' + i, title: `Mock Song ${i + 1} &amp; Friends`, subtitle: `${a.name} - Mock Album ${Math.floor(i / 6) + 1}`,
    type: 'song', perma_url: `https://www.jiosaavn.com/song/mock-${i}`, image: image('sg' + i), language: i % 2 ? 'hindi' : 'english',
    year: '2025', play_count: String(1000 * i), explicit_content: i === 3 ? '1' : '0', list_count: '0',
    more_info: {
      music: a.name, album_id: album, album: `Mock Album ${Math.floor(i / 6) + 1}`, label: 'Mock Records',
      encrypted_media_url: 'ENC' + i, duration: String(6 + (i % 3)), has_lyrics: i % 2 ? 'false' : 'true',
      copyright_text: '© 2025 Mock Records', release_date: '2025-0' + (1 + (i % 9)) + '-15',
      artistMap: { primary_artists: [artistRef(a)], featured_artists: [], artists: [artistRef(a), artistRef(b, 'music')] },
    },
  };
});
const ALBUMS = [0, 1, 2, 3].map((k) => ({
  id: 'al' + k, title: `Mock Album ${k + 1}`, subtitle: ARTISTS[k].name, header_desc: `Album ${k + 1} description.`, type: 'album',
  perma_url: '', image: image('al' + k), language: 'hindi', year: '2025', play_count: '0', explicit_content: '0', list_count: '6', list_type: 'song',
  list: SONGS.slice(k * 6, k * 6 + 6),
  more_info: { artistMap: { primary_artists: [artistRef(ARTISTS[k])], artists: [] }, song_count: '6', copyright_text: '© 2025 Mock Records', release_date: '2025-05-01' },
}));
const lite = ({ list, ...rest }) => rest;
const PLAYLISTS = [0, 1, 2].map((k) => ({
  id: 'pl' + k, title: `Mock Chart ${k + 1}`, subtitle: 'JioSaavn', type: 'playlist', image: image('pl' + k), list_count: '8',
  header_desc: 'The hottest mock songs.', list: SONGS.slice(k * 5, k * 5 + 8),
  more_info: { song_count: '8', firstname: 'JioSaavn', follower_count: '12345' },
}));
const STATIONS = ['Bollywood Hits', 'Romantic', 'Lo-Fi'].map((n, k) => ({
  id: 'rs' + k, title: n, subtitle: '', type: 'radio_station', image: image('rs' + k),
  more_info: { featured_station_type: 'featured', query: n, language: 'hindi' },
}));
const ARTIST_ST = [{ id: 'ars0', title: 'Arijit Singh', type: 'radio_station', image: image('ar459320'), more_info: { featured_station_type: 'artist', query: 'Arijit Singh', language: 'hindi' } }];

const hashQ = (q) => [...String(q)].reduce((a, c) => a + c.charCodeAt(0), 0);
function handle(fn, p) {
  switch (fn) {
    case 'webapi.getLaunchData':
      return {
        new_trending: [...SONGS.slice(0, 6), lite(ALBUMS[0])], charts: PLAYLISTS.map(lite), new_albums: ALBUMS.map(lite),
        top_playlists: PLAYLISTS.map(lite), radio: STATIONS, artist_recos: ARTIST_ST,
        global_config: { x: 1 },
        modules: { new_trending: { title: 'Trending Now', position: 1 }, charts: { title: 'Top Charts', position: 2 }, new_albums: { title: 'New Releases', position: 3 }, top_playlists: { title: 'Editorial Picks', position: 4 }, radio: { title: 'Radio Stations', position: 5 }, artist_recos: { title: 'Recommended Artist Stations', position: 6 } },
      };
    case 'search.getResults': return { total: 24, start: 1, results: (/mock/i.test(p.q) ? SONGS : SONGS.slice(hashQ(p.q) % 12, hashQ(p.q) % 12 + 8)).slice(0, 20) };
    case 'search.getAlbumResults': return { results: ALBUMS.map(lite) };
    case 'search.getArtistResults': return { results: ARTISTS.map((a) => ({ id: a.id, name: a.name, image: image('ar' + a.id), type: 'artist' })) };
    case 'search.getPlaylistResults': return { results: PLAYLISTS.map(lite) };
    case 'content.getAlbumDetails': return ALBUMS.find((a) => a.id === p.albumid) || { error: { msg: 'Album not found' } };
    case 'playlist.getDetails': return PLAYLISTS.find((a) => a.id === p.listid) || { error: { msg: 'Playlist not found' } };
    case 'song.getDetails': return { songs: SONGS.filter((s) => String(p.pids).split(',').includes(s.id)) };
    case 'artist.getArtistPageDetails': {
      const a = ARTISTS.find((x) => x.id === p.artistId);
      if (!a) return { error: { msg: 'Artist not found' } };
      return { artistId: a.id, name: a.name, image: image('ar' + a.id), follower_count: '987654', isVerified: true, dominantLanguage: 'hindi', dominantType: 'singer',
        bio: JSON.stringify([{ text: `${a.name} is a mock artist.`, title: 'Bio', sequence: 0 }]),
        topSongs: SONGS.filter((s) => s.more_info.artistMap.primary_artists[0].id === a.id), topAlbums: ALBUMS.map(lite), singles: [lite(ALBUMS[3])],
        similarArtists: ARTISTS.filter((x) => x.id !== a.id).map((x) => ({ id: x.id, name: x.name, image: image('ar' + x.id) })) };
    }
    case 'lyrics.getLyrics': return { lyrics: 'First line of the song<br>Second line &amp; more<br><br>Chorus line', lyrics_copyright: 'Lyrics © Mock Publishing', snippet: 'First line' };
    case 'webradio.createEntityStation': case 'webradio.createFeaturedStation': case 'webradio.createArtistStation':
      return { stationid: 'st_' + Math.random().toString(36).slice(2) };
    case 'webradio.getSong': {
      const out = { stationid: p.stationid };
      SONGS.slice(10, 10 + Math.min(Number(p.k) || 10, 10)).forEach((s, i) => { out[i] = { song: s }; });
      return out;
    }
    case 'song.generateAuthToken': return { auth_url: `${ORIGIN}/audio/${String(p.url).replace('ENC', '')}.wav?token=abc`, type: 'wav', bitrate: p.bitrate };
    default: return { error: { msg: 'unknown call ' + fn } };
  }
}

function wav(seconds, freq) {
  const rate = 8000, n = rate * seconds, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 6000), 44 + i * 2);
  return b;
}

const log = [];
http.createServer((req, res) => {
  const u = new URL(req.url, ORIGIN);
  res.setHeader('Access-Control-Allow-Origin', '*'); // lets the app bundle be tested in a normal browser
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (u.pathname === '/api.php') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const p = Object.fromEntries(req.method === 'POST' ? new URLSearchParams(body) : u.searchParams);
      const cookie = req.headers.cookie || '';
      log.push(`${req.method} ${p.__call}${p.bitrate ? ' ' + p.bitrate : ''}${/sess=/.test(cookie) ? ' signed-in' : ''}`);
      // signed in on "jiosaavn.com": cookie sess=P123 (Pro) or sess=F123 (free)
      if (p.__call === 'webapi.getLaunchData' && /sess=[PF]123/.test(cookie)) {
        const pro = /sess=P123/.test(cookie);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ...handle(p.__call, p), promo: { pro: '1' }, user: { uid: 'u1', firstname: pro ? 'Priya' : 'Felix', phone_number: '+4915112345678',
          prstatus: pro ? '1' : '0', pro: pro ? { expiration: String(Math.floor(Date.now() / 1000) + 30 * 86400) } : {} } }));
      }
      if (p.__call === 'song.generateAuthToken' && p.bitrate === '320' && !/sess=P123/.test(cookie)) {
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { msg: 'not pro' } }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(handle(p.__call, p)));
    });
    return;
  }
  if (u.pathname === '/log') { res.end(JSON.stringify(log)); return; }
  const am = u.pathname.match(/^\/audio\/(\d+)\.wav$/);
  if (am) {
    if (u.searchParams.get('token') !== 'abc') { res.writeHead(403); return res.end(); }
    const buf = wav(6 + (Number(am[1]) % 3), 220 + Number(am[1]) * 20);
    const m = (req.headers.range || '').match(/bytes=(\d+)-(\d*)/);
    if (m) {
      const s = Number(m[1]), e = m[2] ? Number(m[2]) : buf.length - 1;
      res.writeHead(206, { 'Content-Type': 'audio/wav', 'Content-Range': `bytes ${s}-${e}/${buf.length}`, 'Content-Length': e - s + 1, 'Accept-Ranges': 'bytes' });
      return res.end(buf.subarray(s, e + 1));
    }
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': buf.length, 'Accept-Ranges': 'bytes' });
    return res.end(buf);
  }
  // chart sources (stand-ins for kworb.net and Apple's chart feed; shapes follow what those sites publish)
  const chartSongs = [4, 7, 'x', 2, 11, 5].map((n, i) => (n === 'x' ? { title: 'Nonexistent Tune', artist: 'Nobody Known', id: 'zz' } : { title: `Mock Song ${n} & Friends`, artist: ARTISTS[(n - 1) % 4].name, id: 'sg' + (n - 1) }));
  if (u.pathname.startsWith('/kworb/spotify/country/')) {
    const rows = chartSongs.map((t, i) => `<tr><td>${i + 1}</td><td class="mp">=</td><td class="text"><div><a href="../artist/${i}.html">${t.artist}</a> - <a href="../track/${String(i).padStart(22, 'a')}.html">${t.title.replace(/&/g, '&amp;')}</a></div></td><td>9</td></tr>`).join('');
    res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(`<html><body><h1>Spotify Daily Chart</h1><table><tr><th>Pos</th><th>P+</th><th>Artist and Title</th></tr>${rows}</table></body></html>`);
  }
  if (u.pathname.startsWith('/kworb/youtube/trending')) {
    const rows = chartSongs.map((t, i) => `<tr><td>${i + 1}</td><td>NEW</td><td><a href="video/vid${i}abcdefg.html">${t.artist} - ${t.title.replace(/&/g, '&amp;')} (Official Music Video)</a></td></tr>`).join('');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<html><body><h2>Overall</h2><table><tr><td>1</td><td><a href="video/gamegamegam.html">Some Gameplay Video</a></td></tr></table><h2>Music</h2><table>${rows}</table></body></html>`);
  }
  if (u.pathname.startsWith('/apple/api/v2/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ feed: { title: 'Top Songs', country: 'us', results: chartSongs.map((t, i) => ({ id: String(100 + i), name: t.title, artistName: t.artist, artworkUrl100: `${ORIGIN}/img/ap${i}/100x100bb.jpg`, kind: 'songs' })) } }));
  }
  if (u.pathname.startsWith('/img/')) {
    const h = [...u.pathname].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,55%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360},60%,25%)"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>`);
  }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => console.log(`mock JioSaavn on ${ORIGIN}`));
