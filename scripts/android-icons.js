#!/usr/bin/env node
'use strict';
/* Puts the AURA logo on the Android launcher icon and splash screen.
   Run after `npx cap add android`. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const res = path.join(root, 'android', 'app', 'src', 'main', 'res');
const icons = path.join(root, 'resources', 'android');
if (!fs.existsSync(res)) { console.error('android/ not found. Run `npx cap add android` first.'); process.exit(1); }

// launcher icons for every screen density
for (const dir of fs.readdirSync(icons)) {
  const from = path.join(icons, dir);
  if (!fs.statSync(from).isDirectory()) continue;
  const to = path.join(res, dir);
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(to, f));
}
// use the full-bleed logo instead of Android's adaptive icon template
fs.rmSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true, force: true });

// splash screen: replace every splash.png the template ships with
let n = 0;
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f === 'splash.png') { fs.copyFileSync(path.join(icons, 'splash.png'), p); n++; }
  }
})(res);

// status bar and window colours to match the app
const values = path.join(res, 'values');
const colors = path.join(values, 'colors.xml');
fs.mkdirSync(values, { recursive: true });
let xml = fs.existsSync(colors) ? fs.readFileSync(colors, 'utf8') : '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n';
const set = (name, val) => {
  const re = new RegExp(`<color name="${name}">[^<]*</color>`);
  xml = re.test(xml) ? xml.replace(re, `<color name="${name}">${val}</color>`) : xml.replace('</resources>', `    <color name="${name}">${val}</color>\n</resources>`);
};
set('colorPrimary', '#111514'); set('colorPrimaryDark', '#111514'); set('colorAccent', '#3AC9BE');
fs.writeFileSync(colors, xml);

console.log(`AURA icons installed; ${n} splash image(s) replaced.`);
