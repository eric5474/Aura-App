'use strict';
/* Chart pages laid out per service. Usage: AURA_URL=http://127.0.0.1:3111/ node test/charts-native-test.js [dir] */
const { chromium } = require('playwright');
const BASE = process.env.AURA_URL || 'http://127.0.0.1:3000/';
const out = process.argv[2] || '/tmp/claude-0';
(async () => {
  const b = await chromium.launch(); const log = [], fail = [];
  const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
  const pg = await b.newPage({ viewport: { width: 1360, height: 900 } });
  pg.on('pageerror', (e) => fail.push('PAGEERROR ' + e.message));
  await pg.addInitScript(() => { try { localStorage.setItem('aura-account-v1', JSON.stringify({ name: 'T', email: 't@t.com', salt: 's', alg: 'pbkdf2', hash: 'x' })); localStorage.setItem('aura-session-v1', JSON.stringify({ email: 't@t.com' })); } catch (e) {} });
  await pg.goto(BASE); await pg.waitForSelector('text=Top Picks for You', { timeout: 8000 });
  const cat = await pg.evaluate(() => fetch('/api/charts').then((r) => r.json()));
  for (const [sid, cls] of [['spotify', 'cp-spotify'], ['apple', 'cp-apple'], ['youtube', 'cp-youtube']]) {
    const s = cat.sources.find((x) => x.id === sid); if (!s) { fail.push('no source ' + sid); continue; }
    const id = s.charts[0].id;
    await pg.evaluate(([a, c]) => go('chart', a + ':' + c), [sid, id]);
    try { await pg.waitForSelector(`.${cls} .cp-row`, { timeout: 6000 }); } catch (e) { fail.push('no rows ' + sid); continue; }
    ok(await pg.evaluate((c) => document.querySelectorAll('.' + c + ' .cp-row').length > 0, cls), sid + ' rows render');
    ok(await pg.evaluate((c) => !!document.querySelector('.' + c + ' select[data-chart-place]'), cls), sid + ' has a country picker');
    const acc = await pg.evaluate((c) => getComputedStyle(document.querySelector('.' + c + ' .cp-play')).backgroundColor, cls);
    ok(sid === 'spotify' ? acc === 'rgb(30, 215, 96)' : sid === 'apple' ? acc === 'rgb(250, 35, 59)' : acc === 'rgb(255, 255, 255)', sid + ' accent ' + acc);
    if (sid === 'spotify') ok(await pg.evaluate(() => document.querySelectorAll('.cp-tab').length === 2 && !!document.querySelector('.cp-cols')), 'spotify Daily/Weekly tabs + table header');
    if (sid === 'apple') ok(await pg.evaluate(() => !!document.querySelector('.cp-mosaic') && /Top 100/.test(document.querySelector('.cp h1').textContent)), 'apple Top 100 header + mosaic');
    const n = await pg.evaluate(() => document.querySelectorAll('.cp-select, select[data-chart-place] option').length);
    if (n > 2) { // switching country navigates
      const v = await pg.evaluate(() => { const o = [...document.querySelectorAll('select[data-chart-place] option')].find((x) => !x.selected); return o.value; });
      await pg.selectOption('select[data-chart-place]', v);
      await pg.waitForFunction((x) => document.querySelector('select[data-chart-place]') && document.querySelector('select[data-chart-place]').value === x, v, { timeout: 6000 }).then(() => ok(true, sid + ' country switch'), () => ok(false, sid + ' country switch'));
    }
    await pg.screenshot({ path: `${out}/cp-${sid}.png` });
  }
  console.log(log.join('\n')); if (fail.length) { console.log(fail.join('\n')); process.exit(1); }
  await b.close();
})();
