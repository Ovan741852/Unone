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
import os
import re
import stat
from urllib.parse import unquote, urlsplit


def filesystem_path(value):
    """Use extended Win32 file paths without changing the machine's path policy."""
    value = os.path.abspath(os.path.normpath(os.fspath(value)))
    if os.name != "nt":
        return value
    if value.startswith("\\\\?\\"):
        return value
    if value.startswith("\\\\"):
        return "\\\\?\\UNC\\" + value[2:]
    return "\\\\?\\" + value


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
        kwargs["directory"] = filesystem_path(kwargs.get("directory") or os.getcwd())
        super().__init__(*args, **kwargs)

    def request_path(self, url):
        # Decode the original URL once. A literal encoded '%' is a filename,
        # never another opportunity to interpret traversal or separators.
        decoded = unquote(urlsplit(url).path, errors="strict")
        parts = decoded.split("/")
        if "\\" in decoded or ":" in decoded or "\0" in decoded or any(p in (".", "..") for p in parts):
            raise ValueError("Invalid player URL path")
        path = Path(self.directory).joinpath(*(part for part in parts if part))
        return filesystem_path(path), decoded

    def translate_path(self, path):
        # stdlib send_head calls this again for open/isdir/index selection.
        # Normalize separators too: extended Win32 paths reject '/' suffixes.
        return self.request_path(path)[0]

    def checked_path(self, value):
        root = Path(self.directory).resolve()
        candidate = Path(value)
        relative = candidate.relative_to(root)
        current = root
        for part in relative.parts:
            current = current / part
            info = current.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
                raise ValueError("Linked player paths are not served")
        target = candidate.resolve()
        target.relative_to(root)
        return target

    def checked_request_target(self):
        """Shared GET/HEAD path admission, including the selected directory index."""
        try:
            path, decoded = self.request_path(self.path)
            target = self.checked_path(path)
            if decoded.endswith("/") and target.is_file():
                raise ValueError("A file URL cannot end with a slash")
            if target.is_dir() and urlsplit(self.path).path.endswith("/"):
                for index in self.index_pages:
                    if (target / index).is_file():
                        return self.checked_path(target / index)
            return target
        except (OSError, ValueError, UnicodeError):
            self.send_error(404, "File not found")
            return None

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
        if self.checked_request_target() is None:
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404, "File not found")
        return None


class PlayerServer(ThreadingHTTPServer):
    request_queue_size = 128


def create_server(directory, bind="127.0.0.1", port=8190, cache_releases=True):
    root = Path(filesystem_path(directory)).resolve(strict=True)
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
