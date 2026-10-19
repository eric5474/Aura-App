'use strict';
/* Chart player: loads the chart from /api/charts and plays each song's YouTube video in the IFrame Player. */
(function () {
  const $ = (id) => document.getElementById(id);
  const listEl = $('list'), metaEl = $('meta'), emptyEl = $('empty'), toastEl = $('toast');
  const S = { tracks: [], cur: -1, playing: false, ready: false, pending: null, player: null, timer: 0 };
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const playable = (i) => i >= 0 && i < S.tracks.length && !!S.tracks[i].youtube_video_id && !S.tracks[i].failed;

  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { toastEl.hidden = true; }, 3500);
  }

  /* ---------- list ---------- */
  function render() {
    listEl.textContent = '';
    S.tracks.forEach((t, i) => {
      const li = document.createElement('li');
      li.className = 'track' + (playable(i) ? '' : ' off');
      li.dataset.i = i;
      const rank = document.createElement('div'); rank.className = 'rank'; rank.textContent = t.rank;
      const mid = document.createElement('div');
      const name = document.createElement('div'); name.className = 'name'; name.textContent = t.title;
      const who = document.createElement('div'); who.className = 'who'; who.textContent = t.artist;
      mid.append(name, who);
      const side = document.createElement('div');
      if (!t.youtube_video_id) { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'no match'; side.append(tag); }
      else if (t.failed) { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'can’t play'; side.append(tag); }
      else { const bars = document.createElement('span'); bars.className = 'bars'; bars.innerHTML = '<i></i><i></i><i></i>'; side.append(bars); }
      li.append(rank, mid, side);
      listEl.append(li);
    });
    mark();
  }
  function mark() {
    [...listEl.children].forEach((li, i) => {
      li.classList.toggle('current', i === S.cur);
      li.classList.toggle('playing', i === S.cur && S.playing);
    });
    const t = S.tracks[S.cur];
    $('now-title').textContent = t ? t.title : 'Pick a song';
    $('now-artist').textContent = t ? t.artist : '';
    $('toggle').textContent = S.playing ? '⏸' : '▶';
    $('toggle').setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
    if ('mediaSession' in navigator && t) {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist }); } catch (e) { /* optional */ }
    }
  }

  /* ---------- YouTube IFrame Player ---------- */
  function loadYouTube() {
    window.onYouTubeIframeAPIReady = () => {
      const vars = { playsinline: 1, controls: 0, disablekb: 1, fs: 0, rel: 0 };
      if (/^https?:$/.test(location.protocol)) vars.origin = location.origin;
      S.player = new window.YT.Player('player', {
        width: '200', height: '200', playerVars: vars,
        events: { onReady: onReady, onStateChange: onState, onError: onError },
      });
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => toast('Couldn’t load the YouTube player. Check your connection.');
    document.head.append(s);
  }
  function onReady() {
    S.ready = true;
    if (S.pending !== null) { const i = S.pending; S.pending = null; start(i); }
  }
  function onState(e) {
    const YTS = window.YT.PlayerState;
    if (e.data === YTS.PLAYING) { S.playing = true; tick(true); }
    else if (e.data === YTS.PAUSED) { S.playing = false; tick(false); }
    else if (e.data === YTS.ENDED) { S.playing = false; tick(false); next(true); }
    mark();
  }
  function onError() {
    const t = S.tracks[S.cur];
    if (t) { t.failed = true; toast('“' + t.title + '” can’t be played here. Skipping.'); render(); }
    setTimeout(() => next(true), 600);
  }

  function start(i) {
    if (!playable(i)) return;
    S.cur = i;
    if (!S.ready) { S.pending = i; mark(); return; }
    S.player.loadVideoById(S.tracks[i].youtube_video_id);
    S.playing = true;
    mark();
  }
  function step(dir, fromEnd) {
    for (let i = S.cur + dir; i >= 0 && i < S.tracks.length; i += dir) if (playable(i)) return start(i);
    if (fromEnd) { S.playing = false; mark(); toast('End of the chart'); }
  }
  function next(fromEnd) { step(1, fromEnd); }
  function prev() {
    if (S.ready && S.player.getCurrentTime && S.player.getCurrentTime() > 3) return S.player.seekTo(0, true);
    step(-1, false);
  }
  function toggle() {
    if (S.cur < 0) return step(1, false);
    if (!S.ready) return;
    if (S.playing) S.player.pauseVideo(); else S.player.playVideo();
  }

  /* ---------- progress ---------- */
  function tick(on) {
    clearInterval(S.timer);
    if (on) S.timer = setInterval(progress, 500);
    progress();
  }
  function progress() {
    if (!S.ready || !S.player.getDuration) return;
    const d = S.player.getDuration() || 0, c = S.player.getCurrentTime() || 0;
    $('t-cur').textContent = fmt(c); $('t-dur').textContent = fmt(d);
    if (!progress.drag) $('seek').value = d ? Math.round((c / d) * 1000) : 0;
  }
  $('seek').addEventListener('input', () => { progress.drag = true; });
  $('seek').addEventListener('change', (e) => {
    progress.drag = false;
    if (S.ready) S.player.seekTo((S.player.getDuration() || 0) * (e.target.value / 1000), true);
  });

  /* ---------- wiring ---------- */
  listEl.addEventListener('click', (e) => { const li = e.target.closest('.track'); if (li) start(Number(li.dataset.i)); });
  $('toggle').addEventListener('click', toggle);
  $('next').addEventListener('click', () => next(false));
  $('prev').addEventListener('click', prev);
  $('play-all').addEventListener('click', () => start(S.tracks.findIndex((_, i) => playable(i))));
  document.addEventListener('keydown', (e) => { if (e.code === 'Space' && !/INPUT|BUTTON/.test(e.target.tagName)) { e.preventDefault(); toggle(); } });
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('nexttrack', () => next(false));
      navigator.mediaSession.setActionHandler('previoustrack', prev);
      navigator.mediaSession.setActionHandler('play', toggle);
      navigator.mediaSession.setActionHandler('pause', toggle);
    } catch (e) { /* optional */ }
  }

  /* ---------- boot ---------- */
  async function boot() {
    try {
      const r = await fetch('/api/charts');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      S.tracks = j.tracks || [];
      emptyEl.hidden = S.tracks.length > 0;
      const when = j.last_updated ? new Date(j.last_updated).toLocaleString() : 'never';
      metaEl.textContent = S.tracks.length ? `${j.matched} of ${j.count} songs ready · updated ${when}` : 'No chart yet';
      render();
    } catch (e) {
      metaEl.textContent = 'Couldn’t load the chart (' + e.message + ')';
    }
    loadYouTube();
  }
  boot();
})();
