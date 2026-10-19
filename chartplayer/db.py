"""SQLite storage for the chart player. One table, one row per (source, isrc)."""
import os
import sqlite3
from datetime import datetime, timezone

DEFAULT_DB = os.environ.get("CHARTS_DB") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "charts.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS charts (
    rank             INTEGER NOT NULL,
    source           TEXT    NOT NULL,
    isrc             TEXT    NOT NULL,
    title            TEXT    NOT NULL,
    artist           TEXT    NOT NULL,
    youtube_video_id TEXT,
    last_updated     TEXT    NOT NULL,
    PRIMARY KEY (source, isrc)
);
CREATE INDEX IF NOT EXISTS charts_by_rank ON charts (source, rank);
"""


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def connect(path=None):
    conn = sqlite3.connect(path or DEFAULT_DB)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def existing_video_ids(conn, source):
    """isrc -> youtube_video_id for tracks already matched, so a re-run doesn't search them again."""
    rows = conn.execute(
        "SELECT isrc, youtube_video_id FROM charts WHERE source = ? AND youtube_video_id IS NOT NULL", (source,)
    )
    return {r["isrc"]: r["youtube_video_id"] for r in rows}


def save_chart(conn, source, tracks):
    """Idempotent: update rows that exist (by source + isrc), add new ones, drop tracks that left the chart.

    Each track: dict with rank, isrc, title, artist, youtube_video_id (may be None).
    A video id found earlier is kept if this run could not find one.
    Everything happens in one transaction, so a crash never leaves a half-updated chart.
    """
    stamp = now_iso()
    with conn:
        for t in tracks:
            conn.execute(
                """
                INSERT INTO charts (rank, source, isrc, title, artist, youtube_video_id, last_updated)
                VALUES (:rank, :source, :isrc, :title, :artist, :vid, :ts)
                ON CONFLICT(source, isrc) DO UPDATE SET
                    rank = excluded.rank,
                    title = excluded.title,
                    artist = excluded.artist,
                    youtube_video_id = COALESCE(excluded.youtube_video_id, charts.youtube_video_id),
                    last_updated = excluded.last_updated
                """,
                {"rank": t["rank"], "source": source, "isrc": t["isrc"], "title": t["title"],
                 "artist": t["artist"], "vid": t.get("youtube_video_id"), "ts": stamp},
            )
        keep = [t["isrc"] for t in tracks]
        if keep:
            marks = ",".join("?" * len(keep))
            conn.execute(f"DELETE FROM charts WHERE source = ? AND isrc NOT IN ({marks})", [source, *keep])
    return stamp


def chart_rows(conn, source):
    return [dict(r) for r in conn.execute(
        "SELECT rank, source, isrc, title, artist, youtube_video_id, last_updated FROM charts WHERE source = ? ORDER BY rank",
        (source,),
    )]


def sources(conn):
    return [r["source"] for r in conn.execute("SELECT DISTINCT source FROM charts ORDER BY source")]
