'use strict';
/* New Home and the Spotify / Apple Music / YouTube Music chart pages, in a real browser against the mock.
   Server must run with JIOSAAVN_BASE, AURA_CHARTS_KWORB=http://127.0.0.1:4555/kworb, AURA_CHARTS_APPLE=http://127.0.0.1:4555/apple,
   AUDIUS_BASE=http://127.0.0.1:4555/audius, JAMENDO_BASE=http://127.0.0.1:4555/jamendo, AURA_JAMENDO_CLIENT_ID=test.
   Usage: node test/home-test.js [screenshot-dir] */
const { chromium } = require('playwright');
const out = process.argv[2] || '.';
const BASE = process.env.AURA_URL || 'http://127.0.0.1:3000/';

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const log = [], fail = [];
  const ok = (cond, msg) => { (cond ? log : fail).push((cond ? 'PASS ' : 'FAIL ') + msg); };
  const pg = await b.newPage({ viewport: { width: 1360, height: 900 } });
  pg.on('pageerror', (e) => fail.push('PAGEERROR ' + e.message));
  await pg.addInitScript(() => { try { localStorage.setItem('aura-account-v1', JSON.stringify({ name: 'Tester', email: 't@t.com', salt: 's', alg: 'pbkdf2', hash: 'x' })); localStorage.setItem('aura-session-v1', JSON.stringify({ email: 't@t.com' })); } catch (e) {} });
  const ev = (f, a) => pg.evaluate(f, a);
  const heads = () => ev(() => [...document.querySelectorAll('#view h2')].map((h) => h.textContent.trim()));

  await pg.goto(BASE);
  await pg.waitForSelector('text=Top Picks for You', { timeout: 8000 });
  // give Recently Played something to show
  await ev(() => act('play-album', { dataset: { id: 'al0' } })); await pg.waitForTimeout(1500);
  await ev(() => go('home', undefined, true)); await pg.waitForSelector('text=Top Picks for You');
  await pg.waitForSelector('.csrcs');
  const h = await heads();
  ok(h[0] === 'Top Picks for You' && h[1] === 'Recently Played' && h[2] === 'Charts', 'order: Top Picks, Recently Played, Charts (' + h.slice(0, 4).join(' > ') + ')');
  const homeText = await ev(() => document.getElementById('view').textContent);
  ok(!/Mock Chart/.test(homeText), 'no chart playlists left on Home');
  ok(!h.some((x) => /chart/i.test(x) && x !== 'Charts'), 'no other chart shelves on Home');
  const tiles = await ev(() => [...document.querySelectorAll('.csrc b')].map((x) => x.textContent));
  ok(JSON.stringify(tiles) === JSON.stringify(['Spotify Charts', 'Apple Music Charts', 'YouTube Music Charts']), 'three chart options: ' + tiles.join(', '));
  await pg.waitForTimeout(300); await pg.screenshot({ path: out + '/h1-home.png' });

  for (const [name, expectCharts] of [['Spotify Charts', 154], ['Apple Music Charts', 159], ['YouTube Music Charts', 16]]) {
    await ev(() => go('home', undefined, true)); await pg.waitForSelector('.csrcs');
    await pg.click(`.csrc:has-text("${name}")`);
    await pg.waitForSelector('.cchart');
    const n = await ev(() => document.querySelectorAll('.cchart').length);
    ok(n === expectCharts, `${name} lists all its charts (${n})`);
    if (name === 'Spotify Charts') await pg.screenshot({ path: out + '/h2-spotify-charts.png' });
    await pg.click('.cchart:first-child');
    await pg.waitForSelector('.crow');
    const rows = await ev(() => [...document.querySelectorAll('.crow')].map((r) => r.querySelector('b').textContent + ' / ' + r.querySelector('small').textContent));
    ok(rows.length === 8 && /^Mock Song 4 & Friends \/ Pritam$/.test(rows[0]), `${name}: first chart shows ranked songs (${rows[0]})`);
    if (name === 'YouTube Music Charts') ok(!rows.some((r) => /Gameplay/.test(r)) && !rows.some((r) => /Official/.test(r)), 'YouTube: Music table used, video suffixes cleaned');
    if (name === 'Spotify Charts') {
      await pg.screenshot({ path: out + '/h3-chart.png' });
      await pg.click('.crow:nth-child(2)'); await pg.waitForTimeout(2200);
      const p = await ev(() => ({ t: curTrack() && curTrack().title, playing: S.playing, pos: S.pos, q: S.queue.map((id) => TR[id].title) }));
      ok(/Mock Song 7/.test(p.t) && p.playing && p.pos > 0.5, 'tapping a chart song plays it from the library (' + p.t + ')');
      ok(p.q.length === 6 && !p.q.some((t) => /Nonexistent/.test(t)), 'queue skips songs no source has (' + p.q.length + ' queued)');
      const ids = await ev(() => S.queue.slice());
      ok(ids.some((i) => /^au_/.test(i)) && ids.some((i) => /^jm_/.test(i)), 'songs the main library lacks were found on the other sources');
      await pg.click('.crow:nth-child(3)');
      await pg.waitForFunction(() => /isn’t in AURA’s library/.test(document.getElementById('toast').textContent), null, { timeout: 5000 });
      ok(true, 'a song the library lacks says so');
    }
  }
  // a song that only the Audius source has streams through the backend
  await ev(() => go('home', undefined, true)); await pg.waitForSelector('.csrcs');
  await pg.click('.csrc:has-text("Spotify Charts")'); await pg.waitForSelector('.cchart'); await pg.click('.cchart:first-child'); await pg.waitForSelector('.crow');
  await pg.click('.crow:nth-child(7)'); await pg.waitForTimeout(2500);
  const au = await ev(() => ({ id: curId(), playing: S.playing, pos: S.pos }));
  ok(/^au_/.test(au.id) && au.playing && au.pos > 0.5, 'an Audius-only song streams (' + au.id + ' at ' + au.pos.toFixed(1) + 's)');
  await pg.click('.crow:nth-child(8)'); await pg.waitForTimeout(2500);
  const jm = await ev(() => ({ id: curId(), playing: S.playing, pos: S.pos }));
  ok(/^jm_/.test(jm.id) && jm.playing && jm.pos > 0.5, 'a Jamendo-only song streams (' + jm.id + ')');
  ok(await ev(async () => { const r = await (await fetch('/api/sources/check?q=indie dream')).json(); return r.audius.ok && r.jamendo.ok === false || r.audius.ok; }), 'source check reports Audius working');

  // each service has its own category in the sidebar, with all its charts grouped
  const side = await ev(() => [...document.querySelectorAll('#sidebar [data-go="charts"] span')].map((x) => x.textContent));
  ok(JSON.stringify(side) === JSON.stringify(['Spotify Charts', 'Apple Music Charts', 'YouTube Music Charts']), 'sidebar has a category for each service: ' + side.join(', '));
  await pg.click('#sidebar [data-go="charts"][data-id="apple"]'); await pg.waitForSelector('.cchart');
  const g = await heads();
  ok(JSON.stringify(g) === JSON.stringify(['Top songs', 'Top albums', 'Top music videos']), 'Apple category groups its charts: ' + g.join(' | '));
  ok(await ev(() => document.querySelector('#sidebar [data-go="charts"][data-id="apple"]').classList.contains('active') && !document.querySelector('#sidebar [data-go="charts"][data-id="spotify"]').classList.contains('active')), 'sidebar highlights the open category');
  await pg.screenshot({ path: out + '/h4-apple-category.png' });
  await pg.click('.cchart:has-text("Top Albums")');
  await pg.waitForSelector('.crow');
  await pg.click('.crow:nth-child(1)'); await pg.waitForTimeout(2200);
  const alb = await ev(() => ({ t: curTrack() && AL[curTrack().album] && AL[curTrack().album].title, playing: S.playing, n: S.queue.length }));
  ok(/Mock Album 2/.test(alb.t) && alb.playing && alb.n === 6, 'an album chart plays the whole album (' + alb.t + ', ' + alb.n + ' songs)');
  await ev(() => go('profile', undefined, true)); await pg.waitForSelector('text=Music sources');
  ok(await ev(() => /Audius/.test(document.getElementById('view').textContent) && /Jamendo/.test(document.getElementById('view').textContent) && !/saavn/i.test(document.getElementById('view').textContent.replace(/JioSaavn account[\s\S]*$/, ''))), 'Profile lists the music sources');
  await ev(() => back());
  console.log([...log, ...fail].join('\n'));
  await b.close();
  process.exit(fail.length ? 1 : 0);
})();
