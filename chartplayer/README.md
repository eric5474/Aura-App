# Chart Player

Spotify's Top 50 Global chart, played through YouTube. Three small pieces:

| File | Job |
|---|---|
| `sync.py` | Once a day: read the chart from Spotify, find each song's YouTube video id with `ytmusicapi`, save to `charts.db` (SQLite) |
| `app.py` | Flask server: `GET /api/charts` returns the chart with video ids, and serves the player page |
| `static/index.html`, `app.js`, `style.css` | The player: list of songs, YouTube IFrame Player, play / pause / previous / next, auto-advance |

```
pip install -r requirements.txt
cp .env.example .env        # fill in the two Spotify values, then load them (export / set) in your shell
python sync.py              # fills charts.db  (run it daily: cron, Task Scheduler, ...)
python app.py               # open http://127.0.0.1:5000
```

Get the Spotify values (free) at developer.spotify.com/dashboard: create an app, copy Client ID and Client Secret into `SPOTIPY_CLIENT_ID` and `SPOTIPY_CLIENT_SECRET`.

## How the sync works
- Tracks come from the "Top 50 Global" playlist (title, artist, ISRC).
- **Heads-up:** Spotify stopped letting new apps read its own editorial playlists, so that call may answer 404/403. When it does, `sync.py` takes the same chart's track ids from kworb.net and asks Spotify for each track's ISRC, so you still get the full list.
- For each track it searches YouTube Music with the **ISRC first**, then `Artist - Title`. A result is only accepted if its title, artist and length fit the Spotify track, so a wrong song is never saved.
- **Zero YouTube quota:** lookups use `ytmusicapi` only. The Google YouTube Data API is not used anywhere.
- **Idempotent:** one row per (source, ISRC). Running again updates ranks, adds new songs, removes songs that left the chart, and doesn't search songs it already matched (`--refresh` searches everything again). A video id found earlier is kept if a later lookup fails.
- **Resilient:** each track is wrapped so a failed lookup is logged and the run moves on; the chart is written in one transaction.
- Tracks Spotify gives no ISRC for get a stable `NOISRC-…` key.

Table `charts`: `rank, source, isrc, title, artist, youtube_video_id, last_updated` (primary key `source, isrc`).

## Things to know
- `ytmusicapi` is an unofficial library. It only finds video ids (it never touches audio), but it can break when YouTube Music changes; `pip install -U ytmusicapi` usually fixes it.
- Playback is YouTube's own IFrame player. YouTube's rules want it visible, so it stays as a small box; songs whose video can't be embedded are skipped and marked "can't play".
- No equalizer and no background play on phones: the browser can pause an embedded video when the screen is off.

## Tests
```
python -m unittest discover -s tests     # sync + API, with fake Spotify and YouTube Music
CHARTS_DB=/tmp/t.db python app.py &      # then, with a few rows in that db:
node tests/frontend_test.js              # the page in a browser with a fake YouTube player
```
