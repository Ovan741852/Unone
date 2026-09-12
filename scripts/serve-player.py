"""Serve an exported player with explicit JS/WASM MIME types on every OS."""
import argparse
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
    protocol_version = 'HTTP/1.1'
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript',
                      '.wasm': 'application/wasm'}

    def do_GET(self):
        # Mutable local exports must not combine cached engine bytes with new content.
        for header in ('If-Modified-Since', 'If-None-Match'):
            if header in self.headers:
                del self.headers[header]
        super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

class PlayerServer(ThreadingHTTPServer):
    request_queue_size = 128

print(f'Serving {root} on http://{args.bind}:{args.port}/', flush=True)
PlayerServer((args.bind, args.port), partial(Handler, directory=str(root))).serve_forever()
