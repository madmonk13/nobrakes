"""Dev server for No Brakes with caching disabled, so edits show up on reload.

Usage: python3 tools/serve.py [port]   (default 5175)
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5175
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(NoCacheHandler, directory=root)
    print(f"No Brakes on http://localhost:{port}")
    http.server.ThreadingHTTPServer(("", port), handler).serve_forever()
