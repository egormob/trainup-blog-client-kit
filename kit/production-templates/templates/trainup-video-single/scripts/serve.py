#!/usr/bin/env python3
"""Local preview only. No public route, listing, deployment or access credentials."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import argparse

ROOT = Path(__file__).resolve().parents[1]
FILES = {"index.html", "template.css", "landing.css", "player.js", "contacts.js", "gallery.js", "notice.js"}


class Preview(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_head(self):
        name = unquote(urlsplit(self.path).path).lstrip("/") or "index.html"
        path = (ROOT / name).resolve()
        if not path.is_relative_to(ROOT) or not path.is_file() or not (
            name in FILES or name.startswith("assets/")
        ):
            self.send_error(404)
            return None
        return super().send_head()

    def end_headers(self):
        self.send_header("X-Robots-Tag", "noindex, nofollow, nosnippet, noarchive, noimageindex")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8867)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Preview)
    print(f"Local preview: http://127.0.0.1:{args.port}/", flush=True)
    server.serve_forever()
