'use strict';
/* AURA account screen + streaming quality choices, in a real browser against the mock.
   Needs the mock and server running (see browser-test.js). Usage: node test/account-test.js [screenshot-dir] */
const { chromium } = require('playwright');
const out = process.argv[2] || '.';
const BASE = process.env.AURA_URL || 'http://127.0.0.1:3000/';

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const log = [], fail = [];
  const ok = (cond, msg) => { (cond ? log : fail).push((cond ? 'PASS ' : 'FAIL ') + msg); };
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => fail.push('PAGEERROR ' + e.message));
  const ev = (f, a) => pg.evaluate(f, a);
  const authErr = () => ev(() => (document.querySelector('#auth .auth-err') || {}).textContent || '');

  await pg.goto(BASE);
  await pg.waitForSelector('#auth:not([hidden]) #auth-up');
  ok(true, 'first launch shows Create Account');
  await pg.screenshot({ path: out + '/a1-signup.png' });

  await pg.fill('#au-name', 'Rahul Soni'); await pg.fill('#au-email', 'rahul@example.com');
  await pg.fill('#au-pass', 'short'); await pg.fill('#au-pass2', 'short'); await pg.click('#auth-up button[type=submit]');
  ok(/8 characters/.test(await authErr()), 'rejects a short password');
  await pg.fill('#au-pass', 'longpassword1'); await pg.fill('#au-pass2', 'different123'); await pg.click('#auth-up button[type=submit]');
  ok(/don’t match/.test(await authErr()), 'rejects mismatched passwords');
  await pg.fill('#au-pass2', 'longpassword1'); await pg.click('#auth-up button[type=submit]');
  await pg.waitForSelector('#auth[hidden]', { state: 'attached' });
  ok(await ev(() => S.profile.name === 'Rahul Soni'), 'account created, profile named');
  ok(await ev(() => !/longpassword1/.test(localStorage.getItem('aura-account-v1'))), 'password not stored in plain text');

  await pg.waitForSelector('text=Top Picks for You', { timeout: 8000 });
  await ev(() => go('profile', undefined, true));
  await pg.waitForSelector('[data-act="aura-signout"]');
  ok(await ev(() => /Streaming quality/.test(document.getElementById('view').textContent)), 'Profile shows Streaming quality');
  await pg.click('[data-act="aura-signout"]');
  await pg.waitForSelector('#auth:not([hidden]) #auth-in');
  await pg.fill('#au-pass', 'wrongpassword'); await pg.click('#auth-in button[type=submit]');
  await pg.waitForFunction(() => /Wrong password/.test((document.querySelector('#auth .auth-err') || {}).textContent));
  ok(true, 'wrong password refused');
  await pg.fill('#au-pass', 'longpassword1'); await pg.click('#auth-in button[type=submit]');
  await pg.waitForSelector('#auth[hidden]', { state: 'attached' });
  ok(true, 'signs back in');

  await pg.reload();
  await pg.waitForSelector('text=Top Picks for You', { timeout: 8000 });
  ok(await ev(() => document.getElementById('auth').hidden), 'stays signed in after reload');

  // Profile: no JioSaavn sign-in any more; streaming quality choices instead
  await ev(() => go('profile', undefined, true));
  await pg.waitForSelector('[data-act="quality"]');
  ok(await ev(() => !/jio\s?saavn/i.test(document.getElementById('view').textContent) && !document.querySelector('[data-act="js-connect"]')), 'Profile has no JioSaavn sign-in');
  const qs = await ev(() => [...document.querySelectorAll('[data-act="quality"]')].map((b) => b.dataset.k));
  ok(JSON.stringify(qs) === JSON.stringify(['48', '96', '128', '160', '320']), 'quality choices: ' + qs.join(', '));
  ok(await ev(() => document.querySelector('[data-act="quality"].on').dataset.k === '128'), 'Normal (128) is the default');
  await pg.click('[data-act="quality"][data-k="160"]');
  ok(await ev(() => S.settings.quality === '160' && document.querySelector('[data-act="quality"].on').dataset.k === '160'), 'choosing High saves and marks it');
  ok(!(await ev(() => !!document.querySelector('[data-act="js-signout"]'))), 'no leftover JioSaavn controls');
  await pg.reload(); await pg.waitForSelector('text=Top Picks for You', { timeout: 8000 });
  ok(await ev(() => S.settings.quality === '160'), 'quality remembered after reload');

  await ev(() => go('new', undefined, true));
  await pg.waitForSelector('.top-songs .trow');
  await pg.click('.top-songs .trow');
  await pg.waitForTimeout(2000);
  ok(await ev(() => S.playing && S.pos > 0.5), 'song plays at the chosen quality');
  const mock = await (await fetch('http://127.0.0.1:4555/log')).json();
  ok(mock.some((l) => /generateAuthToken 160/.test(l)), 'the library was asked for 160 kbps');
  // Highest isn't offered for every song: AURA falls back to the normal quality instead of failing
  await ev(() => go('profile', undefined, true)); await pg.waitForSelector('[data-act="quality"]');
  await pg.click('[data-act="quality"][data-k="320"]');
  await ev(() => go('new', undefined, true)); await pg.waitForSelector('.top-songs .trow');
  await pg.click('.top-songs .trow:nth-child(2)');
  await pg.waitForTimeout(2500);
  ok(await ev(() => S.playing && S.pos > 0.5), 'Highest falls back to normal when the library has no such file');
  const mock2 = await (await fetch('http://127.0.0.1:4555/log')).json();
  ok(mock2.some((l) => /generateAuthToken 320/.test(l)) && mock2.some((l) => /generateAuthToken 128/.test(l)), 'asked for 320, then played 128');
  const gone = await ev(() => fetch('/api/account/connect', { method: 'POST' }).then((r) => r.status));
  ok(gone === 405 || gone === 404, 'sign-in endpoint removed (' + gone + ')');

  await pg.setViewportSize({ width: 390, height: 844 });
  await ev(() => signOut()); await pg.waitForSelector('#auth:not([hidden])');
  await pg.screenshot({ path: out + '/a3-signin-phone.png' });

  console.log([...log, ...fail].join('\n'));
  await b.close();
  process.exit(fail.length ? 1 : 0);
})();
