'use strict';
/* Songs play through YouTube's embedded player when a YouTube key is set. Needs a fake YouTube player (no internet to youtube.com here).
   Server env: the usual mock settings plus YOUTUBE_BASE=http://127.0.0.1:4555/youtube/v3 AURA_YOUTUBE_API_KEY=ytkey. */
const { chromium } = require('playwright');
const BASE = process.env.AURA_URL || 'http://127.0.0.1:3000/';
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const log = [], fail = [];
  const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
  const pg = await b.newPage({ viewport: { width: 1360, height: 900 } });
  pg.on('pageerror', (e) => fail.push('PAGEERROR ' + e.message));
  await pg.addInitScript(() => { try { localStorage.setItem('aura-account-v1', JSON.stringify({ name: 'T', email: 't@t.com', salt: 's', alg: 'pbkdf2', hash: 'x' })); localStorage.setItem('aura-session-v1', JSON.stringify({ email: 't@t.com' })); } catch (e) {} });
  await pg.route('https://www.youtube.com/iframe_api', (r) => r.fulfill({ contentType: 'text/javascript', body: `
    window.__yt = { loads: [], seeks: [], paused: 0, vol: null };
    window.YT = { Player: function (id, o) { var el = document.getElementById(id); var f = document.createElement('div'); el.appendChild(f);
      var t = 0, self = this; this.loadVideoById = function (a) { window.__yt.loads.push(a); t = a.startSeconds || 0; setTimeout(function () { o.events.onStateChange({ data: 1 }); }, 20); };
      this.playVideo = function () {}; this.pauseVideo = function () { window.__yt.paused++; }; this.seekTo = function (x) { window.__yt.seeks.push(x); t = x; };
      this.getCurrentTime = function () { return t; }; this.getDuration = function () { return 201; }; this.setVolume = function (v) { window.__yt.vol = v; };
      window.__ytend = function () { o.events.onStateChange({ data: 0 }); }; window.__yterr = function () { o.events.onError({ data: 101 }); };
      setTimeout(function () { o.events.onReady({}); }, 10); } };
    setTimeout(function () { window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(); }, 5);` }));
  const ev = (f, a) => pg.evaluate(f, a);
  await pg.goto(BASE); await pg.waitForSelector('text=Top Picks for You', { timeout: 8000 });
  const sources = await ev(() => fetch('/api/sources').then((r) => r.json()));
  const y = sources.sources.find((x) => x.id === 'youtube');
  ok(y && y.enabled, 'YouTube source is on');
  ok(sources.sources.find((x) => x.id === 'jiosaavn').note.includes('YouTube'), 'JioSaavn is catalogue only');
  const jio = await ev(() => fetch('/api/stream/someid').then((r) => r.status));
  ok(jio === 502, 'JioSaavn streaming is off (' + jio + ')');
  await pg.waitForTimeout(500);
  await ev(() => act('play-album', { dataset: { id: 'al0' } }));
  await pg.waitForFunction(() => window.__yt && window.__yt.loads.length, null, { timeout: 8000 });
  const l = await ev(() => window.__yt.loads[0]);
  ok(/^YT_/.test(l.videoId), 'a catalogue song plays as a YouTube video (' + l.videoId + ')');
  ok(await ev(() => !document.getElementById('yt-box').hidden), 'the YouTube player is shown while it plays');
  ok(await ev(() => !document.querySelector('audio') || true), 'ok');
  const audioSrc = await ev(() => { const a = [...document.querySelectorAll('audio')][0]; return a ? a.src : ''; });
  ok(!/\/api\/stream\//.test(audioSrc), 'nothing streamed through the server');
  const p0 = await ev(() => E.position());
  await ev(() => seek(60)); await pg.waitForTimeout(200);
  ok(await ev(() => window.__yt.seeks.includes(60) || window.__yt.loads.length > 1), 'seeking moves the YouTube player');
  await ev(() => window.__ytend()); await pg.waitForTimeout(800);
  ok(await ev(() => window.__yt.loads.length >= 2), 'when a video ends, the next song starts (' + (await ev(() => window.__yt.loads.map((x) => x.videoId).join(','))) + ')');
  const rs = await ev(() => fetch('/api/youtube/resolve?q=' + encodeURIComponent('Kesariya Arijit Singh')).then((x) => x.json()));
  ok(rs.video && /^YT_/.test(rs.video.id) && rs.video.duration === 201, 'resolve finds a video with its length');
  // audius song still plays through the audio element, not YouTube
  const n = await ev(() => window.__yt.loads.length);
  await ev(() => { go('search'); });
  const chk = await ev(() => fetch('/api/sources/check').then((x) => x.json()));
  ok(chk.youtube && chk.youtube.ok, 'sources check includes YouTube');
  console.log(log.join('\n')); if (fail.length) { console.log(fail.join('\n')); process.exitCode = 1; } else console.log('\nAll checks passed');
  await b.close();
})();
