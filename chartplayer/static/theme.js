'use strict';
/* Themes: a two-colour gradient background plus an accent colour. Default is orange to black.
   Loaded in <head> so the saved theme is applied before the page paints. */
(function () {
  const KEY = 'chartplayer-theme-v1';
  const PRESETS = [
    { id: 'ember', name: 'Ember', c1: '#d9480f', c2: '#0b0b0b', accent: '#ff8a1f', angle: 160 },
    { id: 'sunset', name: 'Sunset', c1: '#f12711', c2: '#1a0a2e', accent: '#f5af19', angle: 160 },
    { id: 'lava', name: 'Lava', c1: '#ff3d00', c2: '#2b0000', accent: '#ffb300', angle: 170 },
    { id: 'crimson', name: 'Crimson', c1: '#c31432', c2: '#0a0a0a', accent: '#ff4d6d', angle: 160 },
    { id: 'rose', name: 'Rose', c1: '#e0457b', c2: '#2a0a1a', accent: '#ff9ec4', angle: 150 },
    { id: 'gold', name: 'Gold', c1: '#b9770e', c2: '#1c1400', accent: '#ffd86b', angle: 160 },
    { id: 'forest', name: 'Forest', c1: '#11998e', c2: '#04140f', accent: '#38ef7d', angle: 160 },
    { id: 'mint', name: 'Mint', c1: '#2bbf6a', c2: '#07201a', accent: '#38f9d7', angle: 150 },
    { id: 'ocean', name: 'Ocean', c1: '#0575e6', c2: '#00111f', accent: '#00d4ff', angle: 160 },
    { id: 'midnight', name: 'Midnight', c1: '#1e3a8a', c2: '#020617', accent: '#60a5fa', angle: 170 },
    { id: 'grape', name: 'Grape', c1: '#8e2de2', c2: '#12002b', accent: '#d9a5ff', angle: 160 },
    { id: 'slate', name: 'Slate', c1: '#4b5563', c2: '#0b0f14', accent: '#94a3b8', angle: 160 },
    { id: 'mono', name: 'Mono', c1: '#2b2b2b', c2: '#000000', accent: '#ffffff', angle: 160 },
    { id: 'candy', name: 'Candy', c1: '#ff758c', c2: '#ffb88c', accent: '#7f1d4a', angle: 135 },
    { id: 'aurora', name: 'Aurora', c1: '#00c9ff', c2: '#92fe9d', accent: '#0b1020', angle: 135 },
    { id: 'paper', name: 'Paper', c1: '#fdfbfb', c2: '#dfe4ea', accent: '#e8590c', angle: 160 },
  ];
  const DEFAULT = PRESETS[0];

  const hex = (s) => /^#[0-9a-f]{6}$/i.test(s || '');
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  function load() {
    try {
      const j = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (j && hex(j.c1) && hex(j.c2) && hex(j.accent)) return { c1: j.c1, c2: j.c2, accent: j.accent, angle: Math.min(360, Math.max(0, Number(j.angle) || 0)) };
    } catch (e) { /* private mode etc. */ }
    return { ...DEFAULT };
  }
  function save(t) { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch (e) { /* ignore */ } }

  // Light backgrounds get dark text and a white glass panel; dark ones get white text and a black glass panel.
  function apply(t) {
    const a = rgb(t.c1), b = rgb(t.c2);
    const mean = [0, 1, 2].map((i) => (a[i] + b[i]) / 2);
    const light = lum(mean) > 0.42;
    const r = document.documentElement.style;
    r.setProperty('--c1', t.c1); r.setProperty('--c2', t.c2); r.setProperty('--angle', t.angle + 'deg');
    r.setProperty('--accent', t.accent);
    const acc = rgb(t.accent);
    r.setProperty('--on-accent', ratio(acc, [17, 17, 17]) >= ratio(acc, [255, 255, 255]) ? '#111111' : '#ffffff');
    r.setProperty('--text', light ? '#14161b' : '#ffffff');
    r.setProperty('--muted', light ? 'rgba(20,22,27,.68)' : 'rgba(255,255,255,.7)');
    r.setProperty('--panel', light ? 'rgba(255,255,255,.64)' : 'rgba(0,0,0,.42)');
    r.setProperty('--line', light ? 'rgba(0,0,0,.14)' : 'rgba(255,255,255,.16)');
    r.setProperty('--hover', light ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.1)');
    r.setProperty('color-scheme', light ? 'light' : 'dark');
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t.c1);
    return light;
  }

  let theme = load();
  apply(theme);
  window.ChartTheme = { PRESETS, DEFAULT, get: () => ({ ...theme }), apply, ratio, rgb, hex,
    set(t) { theme = { ...theme, ...t }; apply(theme); save(theme); return { ...theme }; },
    reset() { theme = { ...DEFAULT }; apply(theme); save(theme); return { ...theme }; } };
})();
