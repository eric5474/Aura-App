/* AURA Android app glue.
   Bundled into www/remote.js by scripts/build-app.js, between the JioSaavn client and the live-mode adapter.
   In the app there is no server: the phone calls the music library itself (Capacitor's native HTTP gets around the
   browser's cross-site limits) and plays JioSaavn's audio links directly. */
(function () {
  'use strict';
  const js = window.JioSaavn;
  const ch = window.AuraCharts;
  const src = window.AuraSources;
  if (ch.setYouTube) ch.setYouTube({ official: (cc) => src.youtubeChart(cc), song: (id, t, a, img) => src.ytSong(id, t, a, img) });
  window.AURA_NATIVE = true;

  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  const routes = [
    [/^\/api\/health$/, async () => ({ ok: true, source: 'jiosaavn', native: true })],
    [/^\/api\/charts$/, async () => ({ sources: ch.catalogue() })],
    [/^\/api\/charts\/([a-z]+)\/([a-z0-9_]+)$/, (m) => ch.chart(m[1], m[2])],
    [/^\/api\/home$/, () => js.home()],
    [/^\/api\/search$/, (m, q) => src.search(q.get('q'), q.get('type') || 'all', num(q.get('page'), 1))],
    [/^\/api\/youtube\/resolve$/, async (m, q) => ({ video: await src.youtubeResolve(String(q.get('q') || '').slice(0, 200)) })],
    [/^\/api\/sources$/, async () => ({ sources: src.list() })],
    [/^\/api\/sources\/check$/, (m, q) => src.check(q.get('q') || 'love')],
    [/^\/api\/songs\/([^/]+)$/, (m) => js.songs(decodeURIComponent(m[1]).split(',').slice(0, 50))],
    [/^\/api\/albums\/([^/]+)$/, (m) => js.album(decodeURIComponent(m[1]))],
    [/^\/api\/artists\/([^/]+)$/, (m) => js.artist(decodeURIComponent(m[1]))],
    [/^\/api\/playlists\/([^/]+)$/, (m) => js.playlist(decodeURIComponent(m[1]))],
    [/^\/api\/lyrics\/([^/]+)$/, (m) => js.lyrics(decodeURIComponent(m[1]))],
    [/^\/api\/radio\/song\/([^/]+)$/, (m, q) => js.songRadio(decodeURIComponent(m[1]), Math.min(50, num(q.get('n'), 20)))],
    [/^\/api\/radio\/featured$/, (m, q) => js.featuredRadio(q.get('name'), q.get('lang') || '', q.get('kind') || 'featured', Math.min(50, num(q.get('n'), 20)))],
  ];

  window.AURA_API = async function (path) {
    const u = new URL(path, 'https://aura.local');
    for (const [re, fn] of routes) {
      const m = u.pathname.match(re);
      if (m) return fn(m, u.searchParams);
    }
    throw new Error('Unknown request: ' + u.pathname);
  };

  // Audio links: the app is served over https, so ask for JioSaavn's CDN over https too.
  window.AURA_STREAM_URL = async function (id) {
    const url = await src.streamUrl(id, { bitrate: window.AURA_QUALITY || '' }); // the quality picked on the Profile screen
    return url.replace(/^http:\/\/([a-z0-9.-]*saavncdn\.com)/i, 'https://$1');
  };

  // The same song from another source, when this copy won't play.
  window.AURA_STREAM_ALT = async function (id, q) {
    const alt = await src.alternate(q, id, { bitrate: window.AURA_QUALITY || '' });
    return alt ? alt.url.replace(/^http:\/\/([a-z0-9.-]*saavncdn\.com)/i, 'https://$1') : null;
  };

  // Android back button: close what's open, go back a screen, or send the app to the background
  // (so music keeps playing) instead of quitting.
  function setupBackButton() {
    const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!App || !App.addListener) return;
    App.addListener('backButton', () => {
      if (!document.getElementById('ctx').hidden) return closeMenu();
      if (document.getElementById('modal-root').innerHTML) return closeModal();
      if (!document.getElementById('np').hidden) return closeFull();
      if (S.stack.length > 1) return back();
      if (cur().name !== 'home') return go('home', undefined, true);
      if (App.minimizeApp) App.minimizeApp(); else if (App.exitApp) App.exitApp();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupBackButton);
  else setupBackButton();
})();
