"""Local presentation host. All simulation/input is delegated to native Unone/Luau."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from urllib.request import Request, urlopen
import mimetypes

PROJECT = Path(__file__).resolve().parents[1]
REPO = PROJECT.parents[1]
STATIC = PROJECT / "viewer"


class TownHost(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send_bytes(self, data, kind, status=200):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        route = unquote(urlsplit(self.path).path)
        if route.startswith("/web/"):
            root, relative = REPO / "web", route[5:]
        elif route.startswith("/assets/external/"):
            root, relative = (PROJECT / "assets/external").resolve(), route[17:]
        elif route.startswith("/assets/"):
            root, relative = PROJECT / "assets", route[8:]
        else:
            root, relative = STATIC, route.lstrip("/") or "index.html"
        target = (root / relative).resolve()
        if not target.is_relative_to(root.resolve()) or not target.is_file():
            self.send_error(404)
            return
        kind = "text/javascript" if target.suffix in (".js", ".mjs") else mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.send_bytes(target.read_bytes(), kind)

    def do_POST(self):
        if self.path != "/api":
            self.send_error(404)
            return
        # A loopback-only, same-origin presentation bridge, not an arbitrary proxy.
        origin = self.headers.get("Origin")
        if origin and origin != f"http://{self.headers.get('Host')}":
            self.send_error(403)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 8192:
                raise ValueError("Invalid request size")
            command = json.loads(self.rfile.read(size))
            if command.get("method") not in {"snapshot", "observations", "input", "pause"}:
                raise ValueError("Unsupported presentation command")
            req = Request(self.server.native_url + "/request", json.dumps(command).encode(), {"Content-Type": "application/json"})
            with urlopen(req, timeout=6) as response:
                result = json.load(response)
            if not result.get("ok"):
                raise ValueError(str(result))
            value = result["value"]
            if command["method"] == "snapshot":
                world = value["observation"]["world"]
                value = {"world": {key: world[key] for key in ("entities", "camera3d", "observations", "frame")}, "performance": value.get("performance")}
                # Model evidence is presentation-only. It never overrides Luau observations.
                value["world"]["observations"].pop("decision_requests", None)
                try:
                    value["world"]["decision_evidence"] = json.loads((PROJECT / ".runtime/nanojev-status.json").read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    value["world"]["decision_evidence"] = {"ready": False, "phase": "unavailable", "fallback": False}
            self.send_bytes(json.dumps(value, ensure_ascii=False).encode(), "application/json; charset=utf-8")
        except Exception as error:
            self.send_bytes(json.dumps({"error": str(error)}).encode(), "application/json", 502)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8088)
    parser.add_argument("--native-port", type=int, default=55433)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), TownHost)
    server.native_url = f"http://127.0.0.1:{args.native_port}"
    print(f"Wuxia town: http://127.0.0.1:{args.port}/ | Luau native: {server.native_url}", flush=True)
    server.serve_forever()
