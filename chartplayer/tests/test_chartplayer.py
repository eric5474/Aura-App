"""Offline tests: Spotify and YouTube Music are replaced by small fakes.   python -m unittest discover -s tests"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db  # noqa: E402
import sync  # noqa: E402
from app import create_app  # noqa: E402


def item(name, artist, isrc, ms=200000, tid=None):
    return {"track": {"name": name, "id": tid or name[:3], "duration_ms": ms,
                      "artists": [{"name": artist}], "external_ids": {"isrc": isrc} if isrc else {}}}


class FakeSpotify:
    def __init__(self, items, fail=False):
        self.items, self.fail = items, fail

    def playlist_items(self, pid, limit=50, offset=0, additional_types=()):
        if self.fail:
            raise RuntimeError("404 Not Found")
        chunk = self.items[offset:offset + limit]
        return {"items": chunk, "next": "x" if offset + limit < len(self.items) else None}


class FakeYT:
    """Answers ISRC searches for some songs, text searches for others, and can blow up on one query."""
    def __init__(self):
        self.by_isrc = {}
        self.by_text = {}
        self.calls = []
        self.explode_on = set()

    def search(self, q, filter=None, limit=5):
        self.calls.append(q)
        if q in self.explode_on:
            raise RuntimeError("boom")
        return self.by_isrc.get(q) or self.by_text.get(q.lower()) or []


def res(vid, title, artist, secs=200):
    return {"videoId": vid, "title": title, "artists": [{"name": artist}], "duration_seconds": secs}


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "charts.db")
        self.conn = db.connect(self.path)
        self.yt = FakeYT()
        self.items = [item("Song A", "Artist A", "US1"), item("Song B", "Artist B", "US2"), item("Song C", "Artist C", "US3")]
        self.yt.by_isrc["US1"] = [res("vidA", "Song A", "Artist A")]
        self.yt.by_text["artist b - song b"] = [res("vidB", "Song B", "Artist B")]   # no ISRC hit: text search finds it
        # Song C: nothing anywhere

    def tearDown(self):
        self.conn.close(); self.dir.cleanup()

    def run_sync(self, sp=None, **kw):
        return sync.run(sp or FakeSpotify(self.items), self.yt, self.conn, pause=0, **kw)

    def rows(self):
        return {r["isrc"]: r for r in db.chart_rows(self.conn, sync.SOURCE)}

    def test_isrc_first_then_text_and_unmatched_kept(self):
        out = self.run_sync()
        self.assertEqual((out["matched"], out["unmatched"]), (2, 1))
        r = self.rows()
        self.assertEqual(r["US1"]["youtube_video_id"], "vidA")
        self.assertEqual(r["US2"]["youtube_video_id"], "vidB")
        self.assertIsNone(r["US3"]["youtube_video_id"])
        self.assertEqual(self.yt.calls[0], "US1")                 # ISRC tried first
        self.assertIn("US2", self.yt.calls)                       # tried for B too ...
        self.assertLess(self.yt.calls.index("US2"), self.yt.calls.index("Artist B - Song B"))  # ... before the text search
        self.assertEqual([x["rank"] for x in db.chart_rows(self.conn, sync.SOURCE)], [1, 2, 3])

    def test_idempotent_no_duplicates_and_no_repeat_lookups(self):
        self.run_sync()
        calls = len(self.yt.calls)
        self.run_sync()
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM charts").fetchone()[0], 3)
        new_calls = self.yt.calls[calls:]
        self.assertNotIn("US1", new_calls)                        # already matched: not searched again
        self.assertTrue(all("Song A" not in c and "Song B" not in c for c in new_calls))

    def test_chart_changes_update_rank_and_drop_old(self):
        self.run_sync()
        self.items = [self.items[1], item("Song D", "Artist D", "US4"), self.items[0]]
        self.yt.by_isrc["US4"] = [res("vidD", "Song D", "Artist D")]
        self.run_sync()
        r = self.rows()
        self.assertEqual(sorted(r), ["US1", "US2", "US4"])        # C left the chart
        self.assertEqual((r["US2"]["rank"], r["US4"]["rank"], r["US1"]["rank"]), (1, 2, 3))
        self.assertEqual(r["US2"]["youtube_video_id"], "vidB")

    def test_one_failing_track_does_not_stop_the_run(self):
        self.yt.explode_on = {"US1", "Artist A - Song A"}
        out = self.run_sync()
        self.assertEqual(out["saved"], 3)
        self.assertEqual(self.rows()["US2"]["youtube_video_id"], "vidB")

    def test_old_video_id_survives_a_failed_refresh(self):
        self.run_sync()
        self.yt.by_isrc.clear(); self.yt.by_text.clear()
        self.run_sync(refresh=True)
        self.assertEqual(self.rows()["US1"]["youtube_video_id"], "vidA")

    def test_wrong_song_is_rejected(self):
        self.yt.by_isrc["US1"] = [res("wrong", "Totally Different", "Someone Else")]
        self.yt.by_text["artist a - song a"] = []
        self.run_sync()
        self.assertIsNone(self.rows()["US1"]["youtube_video_id"])

    def test_wrong_length_is_rejected(self):
        self.yt.by_isrc["US1"] = [res("long", "Song A", "Artist A", secs=900)]   # a 15 minute mix
        self.run_sync()
        self.assertNotEqual(self.rows()["US1"]["youtube_video_id"], "long")

    def test_track_without_isrc_gets_a_stable_key(self):
        self.items = [item("Song Z", "Artist Z", "")]
        self.yt.by_text["artist z - song z"] = [res("vidZ", "Song Z", "Artist Z")]
        self.run_sync(); self.run_sync()
        k = list(self.rows())
        self.assertEqual(len(k), 1); self.assertTrue(k[0].startswith("NOISRC-"))
        self.assertEqual(self.rows()[k[0]]["youtube_video_id"], "vidZ")

    def test_playlist_blocked_falls_back_to_kworb(self):
        class Fallback(FakeSpotify):
            def tracks(self, ids):
                return {"tracks": [item("Song A", "Artist A", "US1", tid=i)["track"] for i in ids]}
        orig = sync.fetch_via_kworb
        sync.fetch_via_kworb = lambda sp, limit=50: sync.fetch_playlist.__globals__["_track_from_item"] and \
            [dict(sync._track_from_item(item("Song A", "Artist A", "US1")), spotify_id="x")]
        try:
            out = self.run_sync(sp=Fallback(self.items, fail=True))
        finally:
            sync.fetch_via_kworb = orig
        self.assertEqual(out["how"], "kworb")
        self.assertEqual(list(self.rows()), ["US1"])

    def test_pagination(self):
        self.items = [item(f"Song {i}", f"Artist {i}", f"X{i:03d}") for i in range(120)]
        tracks = sync.fetch_playlist(FakeSpotify(self.items), "p")
        self.assertEqual(len(tracks), 120)


class ApiTests(unittest.TestCase):
    def test_charts_endpoint(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "c.db")
            conn = db.connect(path)
            db.save_chart(conn, "spotify_global", [
                {"rank": 2, "isrc": "B", "title": "Two", "artist": "Y", "youtube_video_id": None},
                {"rank": 1, "isrc": "A", "title": "One", "artist": "X", "youtube_video_id": "vid1"}])
            conn.close()
            c = create_app(path).test_client()
            j = c.get("/api/charts").get_json()
            self.assertEqual([t["rank"] for t in j["tracks"]], [1, 2])
            self.assertEqual(j["tracks"][0]["youtube_video_id"], "vid1")
            self.assertEqual((j["count"], j["matched"]), (2, 1))
            self.assertTrue(j["last_updated"])
            self.assertEqual(c.get("/api/charts?source=nope").get_json()["count"], 0)
            self.assertEqual(c.get("/api/sources").get_json(), {"sources": ["spotify_global"]})
            self.assertEqual(c.get("/").status_code, 200)
            self.assertEqual(c.get("/app.js").status_code, 200)
            self.assertEqual(c.get("/../db.py").status_code, 404)


if __name__ == "__main__":
    unittest.main()
