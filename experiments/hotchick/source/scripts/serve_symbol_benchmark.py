"""Serve the exported Unone benchmark with correct JavaScript/WASM MIME types."""
import argparse
import mimetypes
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=8237)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1] / "artifacts" / "symbol-benchmark"
for extension, kind in ((".wasm", "application/wasm"), (".mjs", "application/javascript"),
                        (".js", "application/javascript"), (".webm", "video/webm"), (".webp", "image/webp")):
    mimetypes.add_type(kind, extension)
class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
print(f"Unone symbol benchmark: http://127.0.0.1:{args.port}/", flush=True)
ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=str(root))).serve_forever()
