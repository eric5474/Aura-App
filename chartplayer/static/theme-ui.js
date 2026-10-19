'use strict';
/* The Theme panel: presets, custom colours, angle, swap, random, reset. Uses ChartTheme from theme.js. */
(function () {
  const T = window.ChartTheme, $ = (id) => document.getElementById(id);
  const panel = $('theme-panel'), veil = $('veil'), btn = $('theme-btn');
  const same = (a, b) => a.c1.toLowerCase() === b.c1.toLowerCase() && a.c2.toLowerCase() === b.c2.toLowerCase() && a.accent.toLowerCase() === b.accent.toLowerCase() && Number(a.angle) === Number(b.angle);

  const sw = $('swatches');
  T.PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sw'; b.dataset.id = p.id; b.title = p.name;
    const i = document.createElement('i');
    i.style.background = `linear-gradient(${p.angle}deg, ${p.c1}, ${p.c2})`; i.style.setProperty('--dot', p.accent);
    const n = document.createElement('span'); n.textContent = p.name;
    b.append(i, n);
    b.addEventListener('click', () => { T.set({ c1: p.c1, c2: p.c2, accent: p.accent, angle: p.angle }); sync(); });
    sw.append(b);
  });

  function sync() {
    const t = T.get();
    $('th-c1').value = t.c1; $('th-c2').value = t.c2; $('th-accent').value = t.accent;
    $('th-angle').value = t.angle; $('th-angle-v').textContent = t.angle + '°';
    sw.querySelectorAll('.sw').forEach((b) => b.setAttribute('aria-pressed', String(same(T.PRESETS.find((p) => p.id === b.dataset.id), t))));
  }
  const live = (id, key) => $(id).addEventListener('input', (e) => { T.set({ [key]: key === 'angle' ? Number(e.target.value) : e.target.value }); sync(); });
  live('th-c1', 'c1'); live('th-c2', 'c2'); live('th-accent', 'accent'); live('th-angle', 'angle');
  $('th-swap').addEventListener('click', () => { const t = T.get(); T.set({ c1: t.c2, c2: t.c1 }); sync(); });
  $('th-reset').addEventListener('click', () => { T.reset(); sync(); });
  $('th-random').addEventListener('click', () => {
    const h = Math.floor(Math.random() * 360), h2 = (h + 40 + Math.floor(Math.random() * 200)) % 360;
    const hsl = (hh, s, l) => { const a = s * Math.min(l, 1 - l); const f = (n) => { const k = (n + hh / 30) % 12; const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(255 * c).toString(16).padStart(2, '0'); }; return '#' + f(0) + f(8) + f(4); };
    T.set({ c1: hsl(h, 0.75, 0.42 + Math.random() * 0.15), c2: hsl(h2, 0.7, 0.05 + Math.random() * 0.12), accent: hsl((h + 20) % 360, 0.95, 0.62), angle: [135, 150, 160, 180, 200][Math.floor(Math.random() * 5)] });
    sync();
  });

  function open(on) {
    panel.classList.toggle('open', on); veil.hidden = !on; panel.setAttribute('aria-hidden', String(!on));
    if (on) { sync(); $('theme-close').focus(); } else btn.focus();
  }
  btn.addEventListener('click', () => open(true));
  $('theme-close').addEventListener('click', () => open(false));
  veil.addEventListener('click', () => open(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('open')) open(false); });
  sync();
})();
