'use strict';
/* Theme picker in a real browser.  AURA_URL=http://127.0.0.1:5055/ node tests/theme_test.js [screenshot-dir] */
const { chromium } = require('playwright');
const BASE = process.env.AURA_URL || 'http://127.0.0.1:5000/';
const out = process.argv[2] || '/tmp/claude-0';
(async () => {
  const b = await chromium.launch();
  const log = [], fail = [];
  const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
  const ctx = await b.newContext({ viewport: { width: 1100, height: 800 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => fail.push('PAGEERROR ' + e.message));
  await pg.route('https://www.youtube.com/**', (r) => r.abort());
  const css = (v) => pg.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), v);
  await pg.goto(BASE); await pg.waitForSelector('.track');
  ok((await css('--c1')) === '#d9480f' && (await css('--c2')) === '#0b0b0b', 'default is the orange-to-black gradient');
  ok(/linear-gradient/.test(await pg.evaluate(() => getComputedStyle(document.body).backgroundImage)), 'page background is a gradient');
  ok((await css('--text')) === '#ffffff', 'dark gradient uses white text');
  await pg.screenshot({ path: out + '/theme-default.png' });
  await pg.click('#theme-btn'); await pg.waitForTimeout(350);
  ok(await pg.evaluate(() => document.getElementById('theme-panel').classList.contains('open')), 'Theme button opens the panel');
  const n = await pg.locator('.sw').count();
  ok(n >= 12, n + ' presets');
  ok((await pg.getAttribute('.sw[data-id="ember"]', 'aria-pressed')) === 'true', 'the current preset is marked');
  await pg.screenshot({ path: out + '/theme-panel.png' });
  await pg.click('.sw[data-id="ocean"]');
  ok((await css('--c1')) === '#0575e6' && (await pg.getAttribute('.sw[data-id="ocean"]', 'aria-pressed')) === 'true', 'a preset applies instantly');
  // custom colours
  await pg.locator('#th-c1').evaluate((el) => { el.value = '#ff00aa'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.locator('#th-c2').evaluate((el) => { el.value = '#001100'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.locator('#th-accent').evaluate((el) => { el.value = '#00ffcc'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.locator('#th-angle').evaluate((el) => { el.value = '90'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  ok((await css('--c1')) === '#ff00aa' && (await css('--c2')) === '#001100' && (await css('--accent')) === '#00ffcc' && (await css('--angle')) === '90deg', 'any custom colours, accent and angle apply');
  ok((await css('--on-accent')) === '#111111', 'text on a bright accent is dark');
  ok(await pg.evaluate(() => document.querySelector('.sw[aria-pressed="true"]') === null), 'no preset is marked for a custom mix');
  // light gradient flips the text
  await pg.locator('#th-c1').evaluate((el) => { el.value = '#ffffff'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.locator('#th-c2').evaluate((el) => { el.value = '#ffe6cc'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  ok((await css('--text')) === '#14161b', 'a light gradient switches to dark text');
  const contrast = await pg.evaluate(() => { const T = window.ChartTheme; const t = getComputedStyle(document.documentElement).getPropertyValue('--text').trim(); return T.ratio(T.rgb(t), T.rgb('#ffffff')); });
  ok(contrast >= 7, 'dark text on light is readable (contrast ' + contrast.toFixed(1) + ')');
  await pg.screenshot({ path: out + '/theme-light.png' });
  // every preset keeps text readable against its own mix
  const bad = await pg.evaluate(() => {
    const T = window.ChartTheme, res = [];
    for (const p of T.PRESETS) {
      T.apply(p);
      const text = T.rgb(getComputedStyle(document.documentElement).getPropertyValue('--text').trim());
      const a = T.rgb(p.c1), c = T.rgb(p.c2);
      for (const bg of [a, c]) {
        const light = text[0] < 128;
        const panel = light ? bg.map((v) => v * 0.36 + 255 * 0.64) : bg.map((v) => v * 0.58);   // glass panel over the gradient
        if (T.ratio(text, panel) < 4.5) res.push(p.id + ' ' + T.ratio(text, panel).toFixed(1));
      }
    }
    return res;
  });
  ok(!bad.length, 'every preset keeps text readable (' + (bad.join(', ') || 'all ≥ 4.5') + ')');
  await pg.evaluate(() => window.ChartTheme.set({ c1: '#ff00aa', c2: '#001100', accent: '#00ffcc', angle: 90 }));
  // swap, persistence
  await pg.click('#th-swap');
  ok((await css('--c1')) === '#001100', 'Swap colours reverses the gradient');
  await pg.reload(); await pg.waitForSelector('.track');
  ok((await css('--c1')) === '#001100' && (await css('--accent')) === '#00ffcc', 'the choice is remembered after reload');
  await pg.keyboard.press('Escape');
  await pg.click('#theme-btn'); await pg.click('#th-random');
  const rc = await css('--c1');
  ok(/^#[0-9a-f]{6}$/.test(rc), 'Surprise me picks a gradient (' + rc + ')');
  await pg.click('#th-reset');
  ok((await css('--c1')) === '#d9480f' && (await css('--angle')) === '160deg', 'Reset returns to orange and black');
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(350);
  ok(!(await pg.evaluate(() => document.getElementById('theme-panel').classList.contains('open'))), 'Escape closes the panel');
  await pg.setViewportSize({ width: 390, height: 800 }); await pg.click('#theme-btn'); await pg.waitForTimeout(350);
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll on a phone with the panel open');
  await pg.screenshot({ path: out + '/theme-phone.png' });
  console.log(log.join('\n')); if (fail.length) { console.log(fail.join('\n')); process.exitCode = 1; } else console.log('\nAll checks passed');
  await b.close();
})();
