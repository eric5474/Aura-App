'use strict';
/* Orange-and-black default and the colour theme picker in AURA's own settings.
   Usage: AURA_URL=http://127.0.0.1:3111/ node test/theme-test.js [screenshot-dir] */
const { chromium } = require('playwright');
const BASE = process.env.AURA_URL || 'http://127.0.0.1:3000/';
const out = process.argv[2] || '/tmp/claude-0';
(async () => {
  const b = await chromium.launch();
  const log = [], fail = [];
  const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
  const pg = await b.newPage({ viewport: { width: 1360, height: 900 } });
  pg.on('pageerror', (e) => fail.push('PAGEERROR ' + e.message));
  await pg.addInitScript(() => { try { if (!localStorage.getItem('aura-account-v1')) { localStorage.setItem('aura-account-v1', JSON.stringify({ name: 'Tester', email: 't@t.com', salt: 's', alg: 'pbkdf2', hash: 'x' })); localStorage.setItem('aura-session-v1', JSON.stringify({ email: 't@t.com' })); } } catch (e) {} });
  const css = (v) => pg.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), v);
  const openLook = async () => { await pg.evaluate(() => { openSettings ? settingsModal('look') : 0; }).catch(() => {}); };
  await pg.goto(BASE); await pg.waitForSelector('text=Top Picks for You', { timeout: 8000 });
  ok((await css('--c1')) === '#d9480f' && (await css('--c2')) === '#0b0b0b', 'default is the orange-to-black gradient');
  ok(/linear-gradient/.test(await pg.evaluate(() => getComputedStyle(document.body).backgroundImage)), 'the page background is a gradient');
  ok((await css('--accent')) === '#ff8a1f', 'accent is orange (not teal)');
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: out + '/aura-ember-home.png' });
  const open = async () => {
    await pg.evaluate(() => { const f = null; if (f) f('look'); });
  };
  const hasFn = await pg.evaluate(() => typeof settingsModal);
  let opened = false;
  if (hasFn === 'function') { await pg.evaluate(() => settingsModal('look')); opened = true; }
  else { const btn = pg.locator('[data-act="settings"]').first(); if (await btn.count()) { await btn.click(); opened = true; } }
  await pg.waitForSelector('.pal-grid', { timeout: 5000 }).catch(() => {});
  if (!(await pg.locator('.pal-grid').count())) { await pg.click('[data-act="stab"][data-k="look"]').catch(() => {}); }
  await pg.waitForSelector('.pal-grid');
  const n = await pg.locator('.pal-sw').count();
  ok(n >= 17, n + ' choices (presets + Classic)');
  ok((await pg.getAttribute('.pal-sw[data-id="ember"]', 'aria-pressed')) === 'true', 'current theme is marked');
  await pg.screenshot({ path: out + '/aura-theme-picker.png' });
  await pg.click('.pal-sw[data-id="ocean"]');
  ok((await css('--c1')) === '#0575e6' && (await css('--accent')) === '#00d4ff', 'a preset applies instantly');
  const setIn = (k, v) => pg.locator(`.pal-in[data-k="${k}"]`).evaluate((el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  await setIn('c1', '#ff00aa'); await setIn('c2', '#001100'); await setIn('accent', '#00ffcc'); await setIn('angle', '90');
  ok((await css('--c1')) === '#ff00aa' && (await css('--c2')) === '#001100' && (await css('--accent')) === '#00ffcc' && (await css('--angle')) === '90deg', 'custom colours, accent and angle apply');
  ok((await css('--accent-fg')) === '#111111', 'text on a bright accent is dark');
  ok(await pg.evaluate(() => !document.querySelector('.pal-sw[aria-pressed="true"]')), 'no preset marked for a custom mix');
  await setIn('c1', '#ffffff'); await setIn('c2', '#ffe6cc');
  ok((await css('--fg')) === '#16181d', 'a light gradient switches to dark text');
  const bad = await pg.evaluate(() => {
    const P = window.AuraPalette, res = [], r = document.documentElement;
    for (const p of P.PRESETS) {
      P.apply(p);
      const fg = getComputedStyle(r).getPropertyValue('--fg').trim().replace('#', '');
      const f = [0, 2, 4].map((i) => parseInt(fg.slice(i, i + 2), 16));
      const dark = f[0] > 128;
      const hexv = (n) => { const h = getComputedStyle(r).getPropertyValue(n).trim().replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
      for (const bgName of ['--surface', '--bg']) { const bg = hexv(bgName); if (P.ratio(f, bg) < 4.5) res.push(p.id + bgName + ' ' + P.ratio(f, bg).toFixed(1)); }
      const muted = getComputedStyle(r).getPropertyValue('--muted');
    }
    return res;
  });
  ok(!bad.length, 'every preset: text readable on cards and background (' + (bad.join(', ') || 'all ≥ 4.5') + ')');
  await pg.evaluate(() => window.AuraPalette.set({ c1: '#ff00aa', c2: '#001100', accent: '#00ffcc', angle: 90 }));
  await pg.click('[data-act="pal-swap"]');
  ok((await css('--c1')) === '#001100', 'Swap colours');
  await pg.reload(); await pg.waitForSelector('text=Top Picks for You');
  ok((await css('--c1')) === '#001100' && (await css('--accent')) === '#00ffcc', 'choice remembered after reload');
  await pg.evaluate(() => settingsModal('look')).catch(() => {});
  await pg.waitForSelector('.pal-grid');
  await pg.click('[data-act="pal-random"]');
  ok(/^#[0-9a-f]{6}$/.test(await css('--c1')), 'Surprise me');
  await pg.click('[data-act="pal-classic"]');
  ok((await css('--c1')) === '' && (await css('--accent')) !== '#ff8a1f', 'Classic restores the original look');
  await pg.reload(); await pg.waitForSelector('text=Top Picks for You');
  ok((await css('--c1')) === '', 'Classic is remembered');
  await pg.evaluate(() => settingsModal('look')); await pg.waitForSelector('.pal-grid');
  await pg.click('[data-act="pal-reset"]');
  ok((await css('--c1')) === '#d9480f' && (await css('--angle')) === '160deg', 'Reset returns to orange and black');
  await pg.evaluate(() => closeModal && closeModal());
  // the main screens in the new colours
  for (const v of ['charts', 'library']) { await pg.evaluate((n) => go(n, undefined, true), v).catch(() => {}); await pg.waitForTimeout(400); }
  await pg.evaluate(() => go('home', undefined, true)); await pg.waitForTimeout(500);
  await pg.screenshot({ path: out + '/aura-ember-home2.png' });
  await pg.setViewportSize({ width: 390, height: 800 }); await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll on a phone');
  await pg.screenshot({ path: out + '/aura-ember-phone.png' });
  console.log(log.join('\n')); if (fail.length) { console.log(fail.join('\n')); process.exitCode = 1; } else console.log('\nAll checks passed');
  await b.close();
})();
