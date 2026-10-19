#!/usr/bin/env python3
"""Local API + web player.   python app.py   ->  http://127.0.0.1:5000

GET /api/charts[?source=spotify_global]   the current chart with each track's YouTube video id
GET /api/sources                          which charts are in the database
GET /                                     the player (static/index.html)
"""
import os

from flask import Flask, jsonify, request, send_from_directory

import db

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SOURCE = "spotify_global"


def create_app(db_path=None):
    app = Flask(__name__, static_folder=None)

    def conn():
        return db.connect(db_path)

    @app.get("/api/charts")
    def charts():
        source = request.args.get("source", DEFAULT_SOURCE)
        c = conn()
        try:
            rows = db.chart_rows(c, source)
        finally:
            c.close()
        updated = max((r["last_updated"] for r in rows), default=None)
        res = jsonify({
            "source": source,
            "last_updated": updated,
            "count": len(rows),
            "matched": sum(1 for r in rows if r["youtube_video_id"]),
            "tracks": [{k: r[k] for k in ("rank", "isrc", "title", "artist", "youtube_video_id")} for r in rows],
        })
        res.headers["Cache-Control"] = "no-cache"
        return res

    @app.get("/api/sources")
    def list_sources():
        c = conn()
        try:
            return jsonify({"sources": db.sources(c)})
        finally:
            c.close()

    @app.get("/")
    def index():
        return send_from_directory(os.path.join(HERE, "static"), "index.html")

    @app.get("/<path:name>")
    def assets(name):
        return send_from_directory(os.path.join(HERE, "static"), name)

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "5000")))
