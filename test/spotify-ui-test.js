'use strict';
/* Spotify-style shell + two home screens + service home pages. Usage: AURA_URL=http://127.0.0.1:3111/ node test/spotify-ui-test.js [dir] */
const { chromium } = require('playwright');
const BASE = process.env.AURA_URL || 'http://127.0.0.1:3000/';
const out = process.argv[2] || '/tmp/claude-0';
(async () => {
  const b = await chromium.launch(); const log = [], fail = [];
  const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
  const pg = await b.newPage({ viewport: { width: 1360, height: 900 } });
  pg.on('pageerror', (e) => fail.push('PAGEERROR ' + e.message));
  await pg.addInitScript(() => { try { localStorage.setItem('aura-account-v1', JSON.stringify({ name: 'T', email: 't@t.com', salt: 's', alg: 'pbkdf2', hash: 'x' })); localStorage.setItem('aura-session-v1', JSON.stringify({ email: 't@t.com' })); } catch (e) {} });
  await pg.goto(BASE); await pg.waitForSelector('.sp-hello', { timeout: 8000 });
  const box = (sel) => pg.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
  const p = await box('#player'), v = await box('#view'), sd = await box('#sidebar');
  ok(p.y > v.y + v.h - 2 && p.w > 1000, `player bar runs along the bottom (y ${Math.round(p.y)}, w ${Math.round(p.w)})`);
  ok(sd.x < v.x && Math.abs(sd.y - v.y) < 2, 'library sidebar and main card sit side by side');
  ok(await pg.evaluate(() => /Good (morning|afternoon|evening)/.test(document.querySelector('.sp-hello').textContent)), 'Spotify-style greeting');
  ok(await pg.evaluate(() => document.querySelectorAll('.sp-short').length > 0), 'shortcut grid has items');
  ok(await pg.evaluate(() => /Top charts/.test(document.querySelector('#view').textContent)), 'Top charts shelf');
  await pg.waitForSelector('.sp-ctile', { timeout: 6000 }).then(() => ok(true, 'chart tiles load'), () => ok(false, 'chart tiles load'));
  await pg.screenshot({ path: out + '/sp-home.png' });
  await pg.click('[data-home-style="apple"]');
  await pg.waitForSelector('text=Top Picks for You');
  ok(await pg.evaluate(() => localStorage.getItem('aura-home-v1') === 'apple' && !document.querySelector('.sp-hello')), 'Apple Music-style home, choice remembered');
  await pg.screenshot({ path: out + '/ap-home.png' });
  await pg.click('[data-home-style="spotify"]'); await pg.waitForSelector('.sp-hello');
  for (const [sid, title, cls] of [['spotify', 'Charts', 'svc-spotify'], ['apple', 'Top Charts', 'svc-apple']]) {
    await pg.evaluate((x) => go('charts', x, true), sid);
    await pg.waitForSelector(`.${cls} .svc-hero`, { timeout: 6000 });
    await pg.waitForSelector(`.${cls} .cp-row`, { timeout: 6000 }).then(() => ok(true, sid + ' page lists its top songs'), () => ok(false, sid + ' page lists its top songs'));
    ok(await pg.evaluate((t) => document.querySelector('.svc-hero h1').textContent === t, title), sid + ' page title ' + title);
    ok(await pg.evaluate(() => document.querySelectorAll('.sp-ctile').length >= 6), sid + ' page has chart tiles');
    await pg.screenshot({ path: `${out}/svc-${sid}.png` });
    await pg.click(`.${cls} .sp-ctile`); await pg.waitForSelector('.cp .cp-row', { timeout: 6000 }).then(() => ok(true, sid + ' tile opens the chart'), () => ok(false, sid + ' tile opens the chart'));
  }
  console.log(log.join('\n')); if (fail.length) { console.log(fail.join('\n')); await b.close(); process.exit(1); }
  await b.close();
})();
