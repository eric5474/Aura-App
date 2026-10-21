'use strict';
/* Theme section on the Profile page: background picture + blur 10%-50%.
   Usage: AURA_URL=http://127.0.0.1:3111/ node test/bg-test.js [screenshot-dir] */
const { chromium } = require('playwright');
const BASE = process.env.AURA_URL || 'http://127.0.0.1:3000/';
const out = process.argv[2] || '/tmp/claude-0';
(async () => {
  const b = await chromium.launch();
  const log = [], fail = [];
  const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
  const pg = await b.newPage({ viewport: { width: 1360, height: 900 } });
  pg.on('pageerror', (e) => fail.push('PAGEERROR ' + e.message));
  await pg.addInitScript(() => { try { localStorage.setItem('aura-home-v1', 'apple'); if (!localStorage.getItem('aura-account-v1')) { localStorage.setItem('aura-account-v1', JSON.stringify({ name: 'Tester', email: 't@t.com', salt: 's', alg: 'pbkdf2', hash: 'x' })); localStorage.setItem('aura-session-v1', JSON.stringify({ email: 't@t.com' })); } } catch (e) {} });
  const ev = (f, a) => pg.evaluate(f, a);
  const css = (v) => ev((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), v);
  await pg.goto(BASE); await pg.waitForSelector('text=Top Picks for You', { timeout: 8000 });
  await ev(() => go('profile', undefined, true));
  await pg.waitForSelector('#view .pal-grid');
  ok(await ev(() => /Theme/.test(document.querySelector('#view').textContent) && !!document.querySelector('#view .pal-sw')), 'Profile page has a Theme section');
  const sl = await ev(() => { const r = document.querySelector('#view .bg-in'); return { min: r.min, max: r.max, disabled: r.disabled }; });
  ok(sl.min === '10' && sl.max === '50', 'blur slider runs from 10% to 50%');
  ok(sl.disabled, 'slider waits for a picture');
  ok(await ev(() => !document.getElementById('bg-pic') || getComputedStyle(document.getElementById('bg-pic')).display === 'none'), 'no picture by default');
  // make a test picture in the page and upload it
  const png = await ev(() => { const c = document.createElement('canvas'); c.width = 1600; c.height = 900; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 1600, 900); gr.addColorStop(0, '#ff7a00'); gr.addColorStop(1, '#2a0845'); g.fillStyle = gr; g.fillRect(0, 0, 1600, 900); g.fillStyle = '#fff'; g.font = '120px sans-serif'; g.fillText('PICTURE', 500, 480); return c.toDataURL('image/png').split(',')[1]; });
  await pg.setInputFiles('#view #bg-file', { name: 'wall.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await pg.waitForFunction(() => document.documentElement.hasAttribute('data-bgpic'), null, { timeout: 8000 });
  ok(true, 'picture applied as the background');
  ok(await ev(() => /url\("data:image\/jpeg/.test(document.getElementById('bg-pic').style.backgroundImage)), 'stored as a compressed JPEG');
  ok(await ev(() => !document.querySelector('#view .bg-in').disabled && document.querySelector('#view .bg-thumb').style.display !== 'none'), 'slider and preview unlock');
  const setBlur = (v) => ev((x) => { const r = document.querySelector('#view .bg-in'); r.value = x; r.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  await setBlur(10); ok((await css('--bg-blur')) === '4.0px' && /10%/.test(await ev(() => document.querySelector('#view .bg-blur output').textContent)), '10% blur = 4px');
  await setBlur(50); ok((await css('--bg-blur')) === '20.0px', '50% blur = 20px');
  await setBlur(80); ok((await css('--bg-blur')) === '20.0px', 'cannot go past 50%');
  await setBlur(2); ok((await css('--bg-blur')) === '4.0px', 'cannot go below 10%');
  await setBlur(30);
  ok(await ev(() => getComputedStyle(document.getElementById('bg-pic')).filter.includes('blur(12px)')), '30% blur applied to the picture (12px)');
  await pg.waitForTimeout(300); await pg.screenshot({ path: out + '/aura-bg-profile.png' });
  await pg.reload(); await pg.waitForSelector('text=Top Picks for You');
  ok(await ev(() => document.documentElement.hasAttribute('data-bgpic')) && (await css('--bg-blur')) === '12.0px', 'picture and blur remembered after reload');
  await pg.waitForTimeout(300); await pg.screenshot({ path: out + '/aura-bg-home.png' });
  // text stays readable: scrim + theme colours
  ok(await ev(() => /rgba\((0,0,0|255,255,255),\.4\)/.test(getComputedStyle(document.documentElement).getPropertyValue('--scrim').replace(/\s/g, ''))), 'a scrim keeps text readable');
  // works with a light theme and with Classic too
  await ev(() => { window.AuraPalette.set(window.AuraPalette.PRESETS.find((p) => p.id === 'paper')); });
  ok((await css('--scrim')).replace(/\s/g, '') === 'rgba(255,255,255,.4)', 'light theme uses a light scrim');
  await ev(() => window.AuraPalette.classic());
  ok(await ev(() => document.documentElement.hasAttribute('data-bgpic')), 'picture also works with Classic');
  await ev(() => window.AuraPalette.reset());
  await ev(() => go('profile', undefined, true)); await pg.waitForSelector('#view [data-act="bg-remove"]');
  await pg.click('#view [data-act="bg-remove"]');
  ok(await ev(() => !document.documentElement.hasAttribute('data-bgpic')), 'Remove clears the picture');
  await pg.reload(); await pg.waitForSelector('text=Top Picks for You');
  ok(await ev(() => !document.documentElement.hasAttribute('data-bgpic') && localStorage.getItem('aura-bgpic-v1') === null), 'and it stays removed');
  // not an image
  await ev(() => go('profile', undefined, true)); await pg.waitForSelector('#view #bg-file', { state: 'attached' });
  await pg.setInputFiles('#view #bg-file', { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await pg.waitForTimeout(300);
  ok(await ev(() => !document.documentElement.hasAttribute('data-bgpic')), 'a non-image file is refused');
  await pg.setViewportSize({ width: 390, height: 800 }); await pg.waitForTimeout(300);
  ok(await ev(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll on a phone');
  await pg.screenshot({ path: out + '/aura-bg-phone.png' });
  console.log(log.join('\n')); if (fail.length) { console.log(fail.join('\n')); process.exitCode = 1; } else console.log('\nAll checks passed');
  await b.close();
})();
