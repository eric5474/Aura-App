'use strict';
/* End-to-end test of AURA live mode in a real browser.
   Needs: mock (node test/mock-jiosaavn.js), server with JIOSAAVN_BASE pointing at the mock, and Playwright.
   Usage: node test/browser-test.js [screenshot-dir] */
const { chromium } = require('playwright');
const out = process.argv[2] || '.';
const BASE = process.env.AURA_URL || 'http://127.0.0.1:3000/';

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const log = [], fail = [];
  const ok = (cond, msg) => { (cond ? log : fail).push((cond ? 'PASS ' : 'FAIL ') + msg); };
  const pg = await b.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  pg.on('pageerror', (e) => fail.push('PAGEERROR ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/fonts|ERR_TUNNEL|ERR_CONNECTION/.test(m.text())) fail.push('console ' + m.text()); });
  const ev = (f, a) => pg.evaluate(f, a);
  // already signed in to AURA (the sign-in screen has its own test: test/account-test.js)
  await pg.addInitScript(() => { try { localStorage.setItem('aura-account-v1', JSON.stringify({ name: 'Tester', email: 't@t.com', salt: 's', alg: 'pbkdf2', hash: 'x' })); localStorage.setItem('aura-session-v1', JSON.stringify({ email: 't@t.com' })); } catch (e) {} });

  await pg.goto(BASE);
  await pg.waitForSelector('text=Top Picks for You', { timeout: 8000 });
  ok(await ev(() => window.AURA_REMOTE === true), 'live mode active');
  ok(await ev(() => !Object.keys(TR).some((k) => /^glasshouse/.test(k))), 'sample catalogue removed');
  await pg.waitForTimeout(400); await pg.screenshot({ path: out + '/1-home.png' });

  await ev(() => go('new', undefined, true));
  await pg.waitForSelector('.top-songs .trow');
  await pg.click('.top-songs .trow');
  await pg.waitForTimeout(2000);
  const p1 = await ev(() => ({ id: curId(), pos: S.pos, dur: curTrack().dur, playing: S.playing, eq: !!E.ctx }));
  ok(p1.playing && p1.pos > 0.5, `song plays (pos ${p1.pos.toFixed(2)}s of ${p1.dur}s, EQ chain ${p1.eq})`);

  await pg.click('[data-act="panel"][data-p="lyrics"]');
  await pg.waitForTimeout(700);
  const lyr = await ev(() => [...document.querySelectorAll('#panel .lyr p')].map((p) => p.textContent).join(' | '));
  ok(/First line/.test(lyr), 'lyrics load: ' + lyr);

  await pg.fill('#side-q', 'mock');
  await pg.waitForSelector('text=Top Results', { timeout: 6000 });
  await pg.waitForTimeout(300); await pg.screenshot({ path: out + '/2-search.png' });
  ok(await ev(() => document.querySelectorAll('#search-results .trow').length > 5), 'search shows songs');

  await pg.click('.tr-card[data-go="album"]');
  await pg.waitForSelector('.dhead h1');
  await pg.waitForSelector('.tracks .trow');
  await pg.click('.tracks .trow:nth-child(2)');
  await pg.waitForTimeout(1500);
  const p2 = await ev(() => ({ n: curTrack().n, pos: S.pos }));
  ok(p2.n === 2 && p2.pos > 0.3, 'album track 2 plays');
  await ev(() => seek(3)); await pg.waitForTimeout(700);
  ok(await ev(() => S.pos >= 3), 'seek works');
  await pg.screenshot({ path: out + '/3-album.png' });

  const before = await ev(() => curId());
  await pg.waitForTimeout(6500);
  const after = await ev(() => curId());
  ok(before !== after, `advances to next song at the end (${before} -> ${after})`);

  await ev(() => { S.qi = S.queue.length - 1; startTrack(0); }); await pg.waitForTimeout(500);
  await ev(() => next()); await pg.waitForTimeout(1500);
  const ap = await ev(() => ({ len: S.queue.length, from: S.autoFrom, playing: S.playing }));
  ok(ap.from > 0 && ap.len > ap.from && ap.playing, `autoplay adds similar songs (${JSON.stringify(ap)})`);

  await ev(() => go('artist', '459320'));
  await pg.waitForSelector('text=About Arijit Singh', { timeout: 6000 });
  await pg.waitForTimeout(300); await pg.screenshot({ path: out + '/4-artist.png' });
  ok(true, 'artist page');

  await ev(() => go('playlist', 'pl0'));
  await pg.waitForSelector('.tracks .trow');
  await pg.click('[data-act="lib-pl"]');
  await ev(() => { love('sg1'); plModal(null, ['sg1', 'sg2']); });
  await pg.click('#pl-form button[type=submit]'); await pg.waitForTimeout(300);

  await ev(() => go('radio', undefined, true)); await pg.waitForTimeout(300);
  await pg.screenshot({ path: out + '/5-radio.png' });
  await pg.click('.live .btn'); await pg.waitForTimeout(2500);
  const st = await ev(() => ({ label: S.label, playing: S.playing }));
  ok(/AURA One/.test(st.label) && st.playing, 'AURA One plays: ' + st.label);

  await ev(() => go('genre', 'Romance'));
  await pg.waitForSelector('text=Top Songs', { timeout: 6000 });
  await pg.click('.banner-art [data-act="play-station"]'); await pg.waitForTimeout(1300);
  ok(await ev(() => /Romance Station/.test(S.label)), 'category station plays');
  ok(!/saavn/i.test(await ev(() => document.body.innerText)), 'no music-service name shown');

  await ev(() => openFull()); await pg.waitForTimeout(500);
  await pg.screenshot({ path: out + '/6-nowplaying.png' }); await ev(() => closeFull());

  await pg.reload(); await pg.waitForSelector('text=Top Picks for You');
  await ev(() => go('playlists', undefined, true)); await pg.waitForTimeout(300);
  const pls = await ev(() => libPlaylists().map((p) => p.name + ':' + p.tracks.length).join(', '));
  ok(/Untitled Playlist:2/.test(pls) && /Mock Chart 1/.test(pls), 'library survives reload: ' + pls);
  ok(await ev(() => S.love.sg1 === 1), 'loved song survives reload');
  await pg.screenshot({ path: out + '/7-playlists.png' });

  const ph = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  ph.on('pageerror', (e) => fail.push('PHONE ' + e.message));
  await ph.goto(BASE); await ph.waitForSelector('text=Top Picks for You'); await ph.waitForTimeout(400);
  await ph.screenshot({ path: out + '/8-phone.png' });
  ok(!(await ph.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'no sideways scroll on phone');

  console.log(log.concat(fail).join('\n'));
  console.log(fail.length ? `\n${fail.length} problem(s)` : '\nAll checks passed');
  await b.close();
  process.exit(fail.length ? 1 : 0);
})();
