# AURA: Listen to your heart’s desire

AURA is a personal music player. This folder holds the app and a small backend that connects it to the **JioSaavn** catalogue. You get JioSaavn's home feed, search, albums, artists, playlists, charts, radio stations and lyrics, and the songs stream inside AURA.

> **For personal use only.** JioSaavn has no public developer API. AURA uses the same web endpoints the jiosaavn.com player uses, streams at the free-tier bitrate (128 kbps), and doesn't download or unlock premium quality. Don't host it publicly or share it with others. JioSaavn can change these endpoints at any time without notice.

## Run it

You need **Node.js 18 or newer** ([nodejs.org](https://nodejs.org)). The computer version needs nothing from npm.

```bash
cd aura
node server.js
```

Then open **http://localhost:3000**.

AURA detects the backend by itself and switches from its built-in sample songs to the live JioSaavn catalogue.

### Listen on your phone (same Wi-Fi)

```bash
HOST=0.0.0.0 node server.js          # Windows PowerShell: $env:HOST="0.0.0.0"; node server.js
```

Open `http://<your-computer's-IP>:3000` on the phone. Use **Add to Home Screen** to get the AURA icon and a full-screen app.

### Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to serve on |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` to allow other devices on your network |
| `AURA_LANGUAGES` | `hindi,english` | Languages for the home feed and stations, e.g. `hindi,english,punjabi,tamil` |
| `AURA_BITRATE` | `128` | Stream bitrate requested from JioSaavn |

## Your own private AURA on Render (free)

AURA can run on [Render](https://render.com)'s free plan so you can open it from anywhere. It's password-protected: AURA refuses to start in the cloud without `AURA_PASSWORD`, because it's your personal player, not a public site.

1. Sign up at render.com with **Sign in with GitHub**.
2. Choose **New + → Blueprint**, pick the **Aura-App** repository, and confirm. Render reads `render.yaml`.
3. When asked for **AURA_PASSWORD**, type a password only you know, then press **Apply**.
4. When the deploy finishes, open the `https://aura-….onrender.com` address. Your browser asks for a login: type any username and your AURA password.
5. On your phone, open the same address in Chrome and use **Add to Home screen**.

Notes:
- Free services sleep after 15 minutes without visits; the first visit afterwards takes about a minute.
- Every push to `main` redeploys automatically.
- If a song can't play, AURA shows the reason. Music is only licensed in some countries, and Render's servers are outside India.

## Android app (APK)

The Android app works on its own. The phone talks to JioSaavn directly, so no computer or server is needed.

**Get the APK:**
1. Push to the `main` branch, or open the **Actions** tab, choose **Build Android APK** and press **Run workflow**.
2. Wait about 5–8 minutes for the run to turn green.
3. Open the run, scroll to **Artifacts** and download **AURA-android**. It's a zip containing `AURA.apk`.

**Install it on your phone:**
1. Copy `AURA.apk` to the phone, or download the artifact on the phone and unzip it there.
2. Tap the APK. When Android asks, allow **Install unknown apps** for your browser or file manager.
3. Open AURA from your home screen.

To update, install a newer APK over the old one. Your library and playlists stay.

**Differences from the computer version:**
- The equalizer can't change songs in the app, because they play straight from JioSaavn. Volume, queue, lyrics, stations and everything else work.
- It's a debug build for your own phone. Don't share it or put it on the Play Store.
- The Android back button closes menus and full-screen views, then goes back a screen. On Home it sends AURA to the background, so music keeps playing.

**Build it on your own computer instead** (needs Android Studio and JDK 17):
```bash
npm install
npm run build:app
npx cap add android        # first time only
npm run android:icons      # first time only
npm run android:apk        # APK at android/app/build/outputs/apk/debug/app-debug.apk
```

## Colour themes
AURA opens in an orange-to-black gradient. In **Settings → Appearance** you can pick one of 16 colour themes (or Classic, the original teal look that follows your system's light/dark setting), or make your own: any gradient start colour, end colour and accent colour, the gradient angle, swap, random and reset. Text colour adjusts to stay readable. The choice is saved on the device.

## Accounts

**AURA account.** The first time AURA opens, it asks you to create an account (name, email, password). It's kept on that device only: the password is stored as a salted PBKDF2 hash, never in plain text. Forgot it? "Reset AURA on this device" removes the account but keeps your library and playlists. Each device (browser, phone app) has its own account.

**Streaming quality (Profile → Streaming quality).** Pick Data saver (48 kbps), Low (96), Normal (128), High (160) or Highest (320). AURA asks the music library for that quality; if a song doesn't come in it, the normal quality plays. Jamendo uses its smaller file for Data saver and Low. YouTube and Audius songs choose their own quality. It applies from the next song.

**Theme (Profile → Theme).** Pick a colour theme or make your own, and set a background picture with a blur from 10% to 50%. See "Colour themes" below.

## Music sources (streaming from several places)

AURA finds and streams songs from every source that's switched on, in this order, so a chart song missing from one is found in another:

| Source | What it gives | Setup |
|---|---|---|
| AURA library | The main catalogue (JioSaavn, hidden behind AURA's name) | none |
| Audius | Free full-length songs from independent artists | none |
| Jamendo | Free Creative Commons songs | a free client id: create an app at devportal.jamendo.com, then set `AURA_JAMENDO_CLIENT_ID` (on Render: Environment tab). For the Android app, add it as a GitHub repository secret named `AURA_JAMENDO_CLIENT_ID`. |

`AURA_SOURCES` (default `jiosaavn,audius,jamendo`) turns sources on or off. Search results list the main library first, then the others; each song streams from its own source. Check what works from where AURA runs: open `/api/sources/check` (the Profile screen also lists the sources). The big-label chart hits mostly live in the main library; Audius and Jamendo carry independent and Creative Commons music.

If a song won't play from one source (or the stream is refused), AURA looks the same song up in the other sources and plays that copy. YouTube is not used as an audio source: YouTube only allows its own player to play its audio.

`/api/health` shows the running build and how many charts each service has, so you can tell whether a deploy is current.

## Charts on Home

Each service also has its own category in the sidebar (Spotify Charts, Apple Music Charts, YouTube Music Charts); its page lists all of that service's charts, grouped (Apple: top songs, top albums, top music videos). Home shows Top Picks for You and Recently Played first, then three chart options: **Spotify Charts**, **Apple Music Charts** and **YouTube Music Charts**. Each opens every chart from that service (by country); tapping a chart shows its ranked songs, and tapping a song plays it from AURA's own library (the first 20 songs from the one you tap are queued; songs the library doesn't have are skipped and say so).

Where the lists come from (they give rank, title and artist only):
- **Spotify:** kworb.net's public copies of Spotify's daily and weekly country charts (Spotify's own charts need a login).
- **Apple Music:** Apple's public "Most Played" song feeds.
- **YouTube:** kworb.net's trending music videos per country. YouTube has no public Music chart feed, so this is the closest public list; video titles are cleaned up to "artist - song" before matching.

Charts are cached for 30 minutes. If a source changes its pages, that chart shows "Couldn't load this chart" while the others keep working. Test overrides: `AURA_CHARTS_KWORB`, `AURA_CHARTS_APPLE`.

## What's connected

| AURA screen | JioSaavn data |
|---|---|
| Home | Trending now, top charts, new releases, editorial playlists, radio stations, plus your Made for You mixes |
| New | New albums, hot tracks and charts |
| Radio | Featured and artist stations; a station from any song, artist or category |
| Search | Songs, albums, artists and playlists as you type; a Library toggle searches only your saved music |
| Browse categories | Bollywood, Romance, Party, Punjabi, Tamil, Lo-Fi and more, each with a station |
| Album / Artist / Playlist | Full track lists, top songs, discography, similar artists, bio, followers |
| Lyrics | JioSaavn lyrics when available (plain text, not time-synced) |
| Autoplay | When your queue ends, AURA keeps playing songs similar to the last one |
| Get Info | Album, artists, release date, language, label, copyright and a link to the song on JioSaavn |

Your library, playlists, loved songs, recently played items and settings are saved in your browser. The equalizer, Sound Check, sleep timer, queue, shuffle and repeat all work on the live streams.

## Backend API

- `GET /api/sources`, `GET /api/sources/check`: the music sources and a working check
- `GET /api/charts`: the list of chart sources and their charts
- `GET /api/charts/:source/:chart`: one chart's ranked songs (`spotify`, `apple`, `youtube`)

- `GET /api/diagnose`: checks each playback step


All routes return JSON. The front end uses them, and you can call them directly.

| Route | Returns |
|---|---|
| `GET /api/health` | `{ ok: true }` |
| `GET /api/home` | `{ sections: [{ key, title, items: [card] }] }` |
| `GET /api/search?q=&type=all\|songs\|albums\|artists\|playlists&page=1` | `{ songs, albums, artists, playlists }` |
| `GET /api/songs/:id[,id…]` | `{ songs }` |
| `GET /api/albums/:id` | album with `songs` |
| `GET /api/artists/:id` | artist with `topSongs`, `albums`, `singles`, `similar`, `bio` |
| `GET /api/playlists/:id` | playlist with `songs` |
| `GET /api/lyrics/:id` | `{ lines, copyright }` |
| `GET /api/radio/song/:id?n=20` | songs similar to a song |
| `GET /api/radio/featured?name=&lang=&kind=featured\|artist` | songs from a JioSaavn station |
| `GET /api/stream/:id[?br=48|96|128|160|320]` | the audio stream (supports seeking with HTTP Range) |

A song looks like `{ id, title, artists:[{id,name,image}], album, albumId, image, duration, year, releaseDate, language, explicit, hasLyrics, label, copyright, url }`.

Responses from JioSaavn are cached in memory for 10 minutes. Stream links are fetched when you press play and renewed automatically when they expire.

## Files

```
server.js            web server, API routes, audio streaming (computer version)
jiosaavn.js          JioSaavn client and data clean-up
public/index.html    the AURA app (it also runs on its own with sample songs)
public/remote.js     switches the app to the live catalogue when the server is running
public/logo-*.png    app icons; manifest.webmanifest for Add to Home Screen
test/                a stand-in JioSaavn server and an automated browser test
app/native.js        Android app glue: calls JioSaavn from the phone, back button
scripts/             builds the app's web files (www/) and installs icons
resources/android/   launcher icons and splash screen made from the AURA logo
capacitor.config.json  Android app settings (name, id, colours)
.github/workflows/   the GitHub Actions job that builds the APK
```

## Troubleshooting

- **"Couldn’t load JioSaavn" or empty pages:** check that you can open jiosaavn.com in your browser. JioSaavn is not available in every country; outside India you may need to be on an Indian network.
- **A song is skipped with "Couldn’t play":** some tracks aren't licensed for web streaming. AURA moves on to the next one.
- **Port already in use:** run `PORT=3100 node server.js`.
- **Something broke after a JioSaavn change:** all endpoint names and response handling are in `jiosaavn.js`.

## Testing without JioSaavn

```bash
node test/mock-jiosaavn.js &                                   # fake JioSaavn on port 4555
JIOSAAVN_BASE=http://127.0.0.1:4555/api.php node server.js &
npx playwright install chromium && node test/browser-test.js   # needs: npm i playwright
```
