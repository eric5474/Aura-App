'use strict';
/* New Home and the Spotify / Apple Music / YouTube Music chart pages, in a real browser against the mock.
   Server must run with JIOSAAVN_BASE, AURA_CHARTS_KWORB=http://127.0.0.1:4555/kworb, AURA_CHARTS_APPLE=http://127.0.0.1:4555/apple.
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

  for (const [name, expectCharts] of [['Spotify Charts', 21], ['Apple Music Charts', 15], ['YouTube Music Charts', 16]]) {
    await ev(() => go('home', undefined, true)); await pg.waitForSelector('.csrcs');
    await pg.click(`.csrc:has-text("${name}")`);
    await pg.waitForSelector('.cchart');
    const n = await ev(() => document.querySelectorAll('.cchart').length);
    ok(n === expectCharts, `${name} lists all its charts (${n})`);
    if (name === 'Spotify Charts') await pg.screenshot({ path: out + '/h2-spotify-charts.png' });
    await pg.click('.cchart:first-child');
    await pg.waitForSelector('.crow');
    const rows = await ev(() => [...document.querySelectorAll('.crow')].map((r) => r.querySelector('b').textContent + ' / ' + r.querySelector('small').textContent));
    ok(rows.length === 6 && /^Mock Song 4 & Friends \/ Pritam$/.test(rows[0]), `${name}: first chart shows ranked songs (${rows[0]})`);
    if (name === 'YouTube Music Charts') ok(!rows.some((r) => /Gameplay/.test(r)) && !rows.some((r) => /Official/.test(r)), 'YouTube: Music table used, video suffixes cleaned');
    if (name === 'Spotify Charts') {
      await pg.screenshot({ path: out + '/h3-chart.png' });
      await pg.click('.crow:nth-child(2)'); await pg.waitForTimeout(2200);
      const p = await ev(() => ({ t: curTrack() && curTrack().title, playing: S.playing, pos: S.pos, q: S.queue.map((id) => TR[id].title) }));
      ok(/Mock Song 7/.test(p.t) && p.playing && p.pos > 0.5, 'tapping a chart song plays it from the library (' + p.t + ')');
      ok(p.q.length === 4 && !p.q.some((t) => /Nonexistent/.test(t)), 'queue skips songs the library lacks (' + p.q.length + ' queued)');
      await pg.click('.crow:nth-child(3)');
      await pg.waitForFunction(() => /isn’t in AURA’s library/.test(document.getElementById('toast').textContent), null, { timeout: 5000 });
      ok(true, 'a song the library lacks says so');
    }
  }
  await ev(() => back()); 
  console.log([...log, ...fail].join('\n'));
  await b.close();
  process.exit(fail.length ? 1 : 0);
})();
