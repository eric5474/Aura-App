'use strict';
/* AURA account screen + JioSaavn Pro sign-in, in a real browser against the mock.
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
  ok(await ev(() => /128 kbps/.test(document.getElementById('view').textContent)), 'quality 128 kbps before JioSaavn sign-in');
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

  // JioSaavn: wrong password, free account, Pro account
  await ev(() => go('profile', undefined, true));
  const connect = async (cookie) => { await pg.click('[data-act="js-connect"]'); await pg.fill('#js-cookie', cookie); await pg.click('#js-login-form button[type=submit]'); };
  await connect('L=hindi; sess=WRONG');
  await pg.waitForFunction(() => /didn’t recognise/.test((document.querySelector('#js-login-form .auth-err') || {}).textContent));
  ok(true, 'unknown JioSaavn cookie refused');
  await pg.click('[data-act="close-modal"]');
  await connect('L=hindi; sess=F123; geo=DE');
  await pg.waitForSelector('[data-act="js-signout"]');
  ok(await ev(() => /doesn’t show Pro/.test(document.getElementById('view').textContent) && /128 kbps/.test(document.getElementById('view').textContent)), 'free account stays at 128 kbps (a Pro promo elsewhere in the reply doesn’t count)');
  await pg.click('[data-act="js-signout"]'); await pg.waitForSelector('[data-act="js-connect"]');
  await connect('cookie: L=hindi; sess=P123; geo=DE');
  await pg.waitForSelector('[data-act="js-signout"]');
  ok(await ev(() => /320 kbps/.test(document.getElementById('view').textContent)), 'Pro account shows 320 kbps');
  await pg.click('[data-act="js-signout"]'); await pg.waitForSelector('[data-act="js-connect"]');
  await pg.click('[data-act="js-connect"]'); await pg.waitForSelector('#js-cookie');
  await pg.screenshot({ path: out + '/a2-connect.png' });
  await pg.click('[data-act="close-modal"]');
  await connect('L=hindi; sess=P123');
  await pg.waitForSelector('[data-act="js-signout"]');
  await pg.screenshot({ path: out + '/a2-profile-pro.png' });

  // forged token is ignored by the server
  ok(await ev(async () => (await (await fetch('/api/account/status?acct=forged')).json()).signedIn === false), 'forged account token ignored');

  await ev(() => go('new', undefined, true));
  await pg.waitForSelector('.top-songs .trow');
  await pg.click('.top-songs .trow');
  await pg.waitForTimeout(2000);
  ok(await ev(() => S.playing && S.pos > 0.5 && /acct=/.test(document.querySelector('audio') ? '' : '') === false), 'song plays while signed in');
  const mock = await (await fetch('http://127.0.0.1:4555/log')).json();
  ok(mock.some((l) => /generateAuthToken 320 signed-in/.test(l)), 'stream asked for 320 kbps with the Pro account');

  await pg.setViewportSize({ width: 390, height: 844 });
  await ev(() => signOut()); await pg.waitForSelector('#auth:not([hidden])');
  await pg.screenshot({ path: out + '/a3-signin-phone.png' });

  console.log([...log, ...fail].join('\n'));
  await b.close();
  process.exit(fail.length ? 1 : 0);
})();
