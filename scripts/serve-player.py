"""Serve an exported player with explicit JS/WASM MIME types on every OS."""
import argparse
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory', type=Path)
parser.add_argument('--port', type=int, default=8190)
parser.add_argument('--bind', default='127.0.0.1')
args = parser.parse_args()
root = args.directory.resolve(strict=True)
if not root.is_dir():
    parser.error('directory must be an exported player directory')

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript',
                      '.wasm': 'application/wasm'}

    def immutable_generation(self):
        return re.search(r'/releases/[0-9a-f]{64}/', self.path.split('?', 1)[0]) is not None

    def send_head(self):
        if not self.immutable_generation():
            # Same-second index replacement can have unchanged size/mtime and
            # must not receive a false 304 from SimpleHTTPRequestHandler.
            for name in ('If-Modified-Since', 'If-None-Match'):
                if name in self.headers:
                    del self.headers[name]
        return super().send_head()

    def end_headers(self):
        self.send_header('Cache-Control', 'public, max-age=31536000, immutable'
                         if self.immutable_generation() else 'no-store')
        super().end_headers()

print(f'Serving {root} on http://{args.bind}:{args.port}/', flush=True)
ThreadingHTTPServer((args.bind, args.port), partial(Handler, directory=str(root))).serve_forever()
