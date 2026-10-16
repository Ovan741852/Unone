"""Serve an exported Web player with deterministic module/WASM MIME types.

Python's system MIME registry varies across hosts, especially for .mjs on
Windows. This development server uses explicit types. Use --no-cache when replacing a server that had incorrect MIME.
Non-release entry files are never cached; hashed releases retain immutable caching.
It needs only Python's standard library and never rewrites the exported player.
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re


class PlayerHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".ttf": "font/ttf",
        ".otf": "font/otf",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
    }

    protocol_version = "HTTP/1.1"

    def __init__(self, *args, cache_releases=True, **kwargs):
        self.cache_releases = cache_releases
        super().__init__(*args, **kwargs)

    def immutable_generation(self):
        return self.cache_releases and re.search(r"/releases/[0-9a-f]{64}/", self.path.split("?", 1)[0]) is not None

    def end_headers(self):
        self.send_header("Cache-Control", "public, max-age=31536000, immutable" if self.immutable_generation() else "no-store")
        super().end_headers()

    def send_head(self):
        # An old server may have cached these same files with the wrong MIME.
        # Always send a fresh response rather than validating that stale header.
        if not self.immutable_generation():
            for name in ("If-Modified-Since", "If-None-Match"):
                if name in self.headers:
                    del self.headers[name]
        target = Path(self.translate_path(self.path)).resolve()
        try:
            target.relative_to(Path(self.directory).resolve())
        except ValueError:
            self.send_error(404, "File not found")
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404, "File not found")
        return None


class PlayerServer(ThreadingHTTPServer):
    request_queue_size = 128


def create_server(directory, bind="127.0.0.1", port=8190, cache_releases=True):
    root = Path(directory).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("--directory must name an existing directory")
    return PlayerServer((bind, port), partial(PlayerHandler, directory=str(root), cache_releases=cache_releases))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", help="Exported player directory (legacy positional form)")
    parser.add_argument("--directory", dest="export_directory", help="Exported player directory")
    parser.add_argument("--no-cache", action="store_true", help="Force fresh responses, including immutable releases")
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8190)
    args = parser.parse_args()
    if bool(args.directory) == bool(args.export_directory):
        parser.error("provide exactly one directory, positional or --directory")
    directory = args.export_directory or args.directory
    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")
    try:
        server = create_server(directory, args.bind, args.port, cache_releases=not args.no_cache)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    with server:
        host, port = server.server_address
        print(f"Unone Web player: http://{host}:{port}/", flush=True)
        print(f"Serving directory: {Path(directory).resolve()}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
