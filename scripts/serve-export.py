"""Local release measurement server using the official player's path policy."""
import argparse
from functools import partial
import gzip
import importlib.util
import io
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("unone_serve_player", Path(__file__).with_name("serve-player.py"))
player = importlib.util.module_from_spec(spec)
spec.loader.exec_module(player)


class Handler(player.PlayerHandler):
    def __init__(self, *args, compress=False, **kwargs):
        self.compress = compress
        kwargs["cache_releases"] = False
        super().__init__(*args, **kwargs)

    def send_head(self):
        target = self.checked_request_target()
        if target is None:
            return None
        if not target.is_file():
            # Preserve stdlib directory-slash redirects and disabled listings.
            return super().send_head()
        try:
            raw = target.read_bytes()
        except OSError:
            self.send_error(404, "File not found")
            return None
        compressed = self.compress and "gzip" in self.headers.get("Accept-Encoding", "")
        data = gzip.compress(raw, mtime=0) if compressed else raw
        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(str(target)))
        self.send_header("Content-Length", str(len(data)))
        if compressed:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.end_headers()
        print(json.dumps({"path": self.path, "raw_bytes": len(raw), "body_bytes": len(data)}), flush=True)
        return io.BytesIO(data)


def create_server(directory, bind="127.0.0.1", port=8174, compress=False):
    root = Path(player.filesystem_path(directory)).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("root must name an existing directory")
    return player.PlayerServer((bind, port), partial(Handler, directory=str(root), compress=compress))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--port", type=int, default=8174)
    parser.add_argument("--gzip", action="store_true")
    parser.add_argument("--bind", default="127.0.0.1")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")
    try:
        server = create_server(args.root, args.bind, args.port, compress=args.gzip)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    with server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
