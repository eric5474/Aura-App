#!/usr/bin/env python3
"""Daily sync: Spotify Top 50 Global -> YouTube video ids (via ytmusicapi) -> charts.db.

Run it once a day (cron, Task Scheduler, or a Render cron job):
    python sync.py

Needs SPOTIPY_CLIENT_ID and SPOTIPY_CLIENT_SECRET in the environment (see .env.example).
It never uses the YouTube Data API, so there is no search quota to run out of.
"""
import argparse
import hashlib
import logging
import os
import re
import sys
import time

import db

log = logging.getLogger("sync")

SOURCE = "spotify_global"
TOP50_GLOBAL_PLAYLIST = "37i9dQZEVXbMDoHDwVN2tF"
KWORB_GLOBAL = os.environ.get("CHARTS_KWORB_URL", "https://kworb.net/spotify/country/global_daily.html")
PAUSE = float(os.environ.get("SYNC_PAUSE_SECONDS", "0.4"))  # be polite to YouTube Music between lookups


# ---------------------------------------------------------------- Spotify
def get_spotify():
    import spotipy
    from spotipy.oauth2 import SpotifyClientCredentials

    if not (os.environ.get("SPOTIPY_CLIENT_ID") and os.environ.get("SPOTIPY_CLIENT_SECRET")):
        raise SystemExit("Set SPOTIPY_CLIENT_ID and SPOTIPY_CLIENT_SECRET (see .env.example).")
    return spotipy.Spotify(auth_manager=SpotifyClientCredentials(), requests_timeout=20, retries=3)


def _track_from_item(item):
    t = item.get("track") or item.get("item") or {}
    if not t or not t.get("name"):
        return None
    isrc = ((t.get("external_ids") or {}).get("isrc") or "").strip().upper()
    artists = ", ".join(a.get("name", "") for a in t.get("artists", []) if a.get("name"))
    return {"title": t["name"], "artist": artists, "isrc": isrc, "spotify_id": t.get("id"),
            "duration": (t.get("duration_ms") or 0) / 1000}


def fetch_playlist(sp, playlist_id):
    """The playlist's tracks in order: title, artist, isrc."""
    out, offset = [], 0
    while True:
        page = sp.playlist_items(playlist_id, limit=50, offset=offset, additional_types=("track",))
        items = page.get("items", [])
        for it in items:
            tr = _track_from_item(it)
            if tr:
                out.append(tr)
        offset += len(items)
        if not items or not page.get("next"):
            return out


def fetch_via_kworb(sp, limit=50):
    """Fallback. Spotify no longer lets new apps read its own editorial playlists (the call answers 404/403),
    so take the same chart's track ids from kworb.net and ask Spotify for each track's ISRC."""
    import requests

    html = requests.get(KWORB_GLOBAL, timeout=20, headers={"User-Agent": "Mozilla/5.0"}).text
    ids, seen = [], set()
    for m in re.finditer(r'track/([A-Za-z0-9]{22})\.html', html):
        if m.group(1) not in seen:
            seen.add(m.group(1))
            ids.append(m.group(1))
    ids = ids[:limit]
    if not ids:
        raise RuntimeError("kworb returned no tracks")
    out = []
    for i in range(0, len(ids), 50):
        for t in sp.tracks(ids[i:i + 50]).get("tracks", []):
            tr = _track_from_item({"track": t}) if t else None
            if tr:
                out.append(tr)
    order = {tid: n for n, tid in enumerate(ids)}
    out.sort(key=lambda t: order.get(t["spotify_id"], 999))
    return out


def fetch_chart(sp, playlist_id):
    try:
        tracks = fetch_playlist(sp, playlist_id)
        if tracks:
            return tracks, "playlist"
        log.warning("The playlist was empty; trying the kworb fallback")
    except Exception as e:  # editorial playlists are blocked for new Spotify apps
        log.warning("Couldn't read playlist %s (%s); trying the kworb fallback", playlist_id, e)
    return fetch_via_kworb(sp), "kworb"


# ---------------------------------------------------------------- YouTube Music matching
def _words(s):
    s = re.sub(r"\(.*?\)|\[.*?\]", " ", (s or "").lower())
    return {w for w in re.split(r"[^\w]+", s) if len(w) > 1}


def _overlap(want, have):
    return len(want & have) / len(want) if want else 1.0


def looks_right(track, result):
    """Is this YouTube Music result the same song? Checks title words, artist words and length."""
    if not result.get("videoId"):
        return False
    title_ok = _overlap(_words(track["title"]), _words(result.get("title"))) >= 0.6
    res_artists = " ".join(a.get("name", "") for a in (result.get("artists") or []))
    artist_ok = _overlap(_words(track["artist"].split(",")[0]), _words(res_artists + " " + (result.get("title") or ""))) >= 0.5
    d1, d2 = track.get("duration") or 0, result.get("duration_seconds") or 0
    length_ok = not (d1 and d2) or abs(d1 - d2) <= 12
    return title_ok and artist_ok and length_ok


def find_video(ytm, track, tries=2):
    """YouTube video id for a track: search the ISRC first, then 'Artist - Title'. None if nothing fits."""
    queries = []
    if track.get("isrc") and not track["isrc"].startswith("NOISRC"):
        queries.append(("isrc", track["isrc"]))
    queries.append(("text", f"{track['artist'].split(',')[0]} - {track['title']}"))
    for kind, q in queries:
        for attempt in range(tries):
            try:
                results = ytm.search(q, filter="songs", limit=5) or []
                break
            except Exception as e:
                log.warning("  search %r failed (%s)%s", q, e, " - retrying" if attempt + 1 < tries else "")
                results = []
                time.sleep(1.0)
        for r in results:
            if looks_right(track, r):
                log.debug("  matched by %s: %s", kind, r["videoId"])
                return r["videoId"]
    return None


# ---------------------------------------------------------------- main
def run(sp, ytm, conn, playlist_id=TOP50_GLOBAL_PLAYLIST, refresh=False, pause=PAUSE):
    tracks, how = fetch_chart(sp, playlist_id)
    log.info("Got %d tracks from Spotify (%s)", len(tracks), how)
    known = {} if refresh else db.existing_video_ids(conn, SOURCE)
    rows, matched, failed = [], 0, 0
    for rank, t in enumerate(tracks, start=1):
        key = t["isrc"] or "NOISRC-" + hashlib.sha1(f"{t['artist']}|{t['title']}".lower().encode()).hexdigest()[:12]
        t["isrc"] = key
        vid = known.get(key)
        if vid:
            log.info("%2d. %s - %s (already matched)", rank, t["artist"], t["title"])
            matched += 1
        else:
            try:
                vid = find_video(ytm, t)
            except Exception as e:  # one bad track must never stop the run
                log.error("%2d. %s - %s: unexpected error %s", rank, t["artist"], t["title"], e)
                vid = None
            if vid:
                matched += 1
                log.info("%2d. %s - %s -> %s", rank, t["artist"], t["title"], vid)
            else:
                failed += 1
                log.warning("%2d. %s - %s: no YouTube match", rank, t["artist"], t["title"])
            time.sleep(pause)
        rows.append({"rank": rank, "isrc": key, "title": t["title"], "artist": t["artist"], "youtube_video_id": vid})
    stamp = db.save_chart(conn, SOURCE, rows)
    log.info("Saved %d tracks (%d with a YouTube id, %d without) at %s", len(rows), matched, failed, stamp)
    return {"saved": len(rows), "matched": matched, "unmatched": failed, "how": how}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--playlist", default=os.environ.get("SPOTIFY_PLAYLIST_ID", TOP50_GLOBAL_PLAYLIST))
    ap.add_argument("--db", default=None, help="SQLite file (default charts.db next to this script)")
    ap.add_argument("--refresh", action="store_true", help="look every track up again, even ones already matched")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    try:
        sp = get_spotify()
        from ytmusicapi import YTMusic
        ytm = YTMusic()
        conn = db.connect(args.db)
        run(sp, ytm, conn, args.playlist, args.refresh)
    except SystemExit:
        raise
    except Exception as e:
        log.error("Sync failed: %s", e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
