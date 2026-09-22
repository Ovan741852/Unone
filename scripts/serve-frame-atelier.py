"""Loopback-only Frame Atelier prototype and authenticated semantic bridge.

Local processes are trusted; websites are not. Never expose this server to LAN.
"""
import argparse
import hmac
import json
import secrets
import threading
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

COMMAND_WAIT_SECONDS = 300
MAX_BODY = 2_000_000
STATIC_FILES = (
    "Unone/web/frame-atelier/index.html", "Unone/web/frame-atelier/main.js",
    "Unone/web/frame-atelier/style.css", "Unone/web/frame-atelier/PROTOCOL.md",
    "UnoneUI/src/components.mjs", "UnoneUI/src/ui-geometry.mjs",
    "UnoneUI/src/ui-contract.mjs",
    "YesSir/_Games/ashen-legion/concept-art/generated-equipment-screen/equipment-screen-mockup-1920x1080-final.png",
)
COMMAND_NAMES = {
    "inspect", "select_frame", "set_profile", "add_frame", "update_frame",
    "analyze_frame", "generate_interface", "analyze_hierarchy", "apply_suggestion",
    "apply_suggested_rect", "keep_current_rect", "add_subframes", "create_draft",
}


class Server(ThreadingHTTPServer):
    def __init__(self, port=8001, root=None):
        self.root = Path(root or Path(__file__).resolve().parents[2]).resolve()
        self.token = secrets.token_urlsafe(32)
        self.commands = {}
        self.state = {"last_state": None, "last_seen": 0.0}
        self.condition = threading.Condition()
        super().__init__(("127.0.0.1", port), Handler)


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript", ".js": "text/javascript"}

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        super().end_headers()

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _guard(self, token=False):
        authority = f"127.0.0.1:{self.server.server_port}"
        origin = self.headers.get("Origin")
        if (self.headers.get_all("Host") != [authority]
                or (origin is not None and origin != f"http://{authority}")
                or self.headers.get("Sec-Fetch-Site", "none") not in ("same-origin", "none")):
            self._json(403, {"error": "LOCAL_ORIGIN_REQUIRED"})
            return False
        if token and not hmac.compare_digest(
                self.headers.get("Authorization", "").encode(),
                f"Bearer {self.server.token}".encode()):
            self._json(401, {"error": "FRAME_ATELIER_AUTH_REQUIRED"})
            return False
        return True

    def do_OPTIONS(self):
        self._json(403, {"error": "CROSS_ORIGIN_NOT_ALLOWED"})

    def send_head(self):
        # Also guards HEAD and denies directory listings / sibling repository reads.
        if not self._guard():
            return None
        path = unquote(urlsplit(self.path).path)
        if path in ("/", "/Unone/", "/Unone/web/frame-atelier/"):
            path = "/Unone/web/frame-atelier/index.html"
        if path.lstrip("/") not in STATIC_FILES:
            self.send_error(404, "Static resource not available")
            return None
        target = self.server.root / path.lstrip("/")
        if target.resolve() != target or not target.is_file():
            self.send_error(404, "Static resource not available")
            return None
        self._static_target = target
        return super().send_head()

    def translate_path(self, path):
        return str(self._static_target)

    def do_GET(self):
        path = urlsplit(self.path).path
        if not path.startswith("/api/frame-atelier/"):
            return super().do_GET()
        if not self._guard(token=path != "/api/frame-atelier/session"):
            return
        if path == "/api/frame-atelier/session":
            # Custom header forces a denied preflight from foreign websites.
            if self.headers.get("X-Frame-Atelier") != "1":
                self._json(403, {"error": "LOCAL_CLIENT_REQUIRED"})
            else:
                self._json(200, {"token": self.server.token})
        elif path == "/api/frame-atelier/health":
            with self.server.condition:
                connected = time.monotonic() - self.server.state["last_seen"] < 3
            self._json(200, {"ready": True, "browser_connected": connected, "protocol": "unone.frame-atelier.v1"})
        elif path == "/api/frame-atelier/poll":
            with self.server.condition:
                self.server.state["last_seen"] = time.monotonic()
                commands = []
                for item in self.server.commands.values():
                    if item["status"] == "queued":
                        item["status"] = "in_flight"
                        commands.append({"id": item["id"], "name": item["name"], "payload": item["payload"]})
            # Never automatically redeliver an operation with an uncertain result.
            self._json(200, {"commands": commands})
        else:
            self._json(404, {"error": "FRAME_ATELIER_ENDPOINT_NOT_FOUND"})

    def do_POST(self):
        if not self._guard(token=True):
            return
        path = urlsplit(self.path).path
        if self.headers.get_content_type() != "application/json":
            self._json(415, {"error": "JSON_CONTENT_TYPE_REQUIRED"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if self.headers.get("Transfer-Encoding") or not 0 < length <= MAX_BODY:
                self._json(413, {"error": "BODY_SIZE_INVALID", "max_bytes": MAX_BODY})
                return
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError("Expected object")
        except (ValueError, UnicodeError):
            self._json(400, {"error": "INVALID_JSON_OBJECT"})
            return

        if path == "/api/frame-atelier/state":
            with self.server.condition:
                self.server.state.update(last_state=payload, last_seen=time.monotonic())
            self._json(200, {"ok": True})
        elif path == "/api/frame-atelier/result":
            if not isinstance(payload.get("id"), str) or not isinstance(payload.get("ok"), bool):
                self._json(400, {"error": "INVALID_COMMAND_RESULT"})
                return
            with self.server.condition:
                item = self.server.commands.get(payload["id"])
                if not item:
                    self._json(404, {"error": "COMMAND_NOT_FOUND"})
                    return
                if item["status"] != "in_flight":
                    self._json(409, {"error": "COMMAND_NOT_IN_FLIGHT"})
                    return
                item.update(status="done" if payload["ok"] else "error", result=payload.get("result"), error=payload.get("error"))
                self.server.condition.notify_all()
            self._json(200, {"ok": True})
        elif path == "/api/frame-atelier/command":
            name, data, timeout = payload.get("name"), payload.get("payload", {}), payload.get("timeout", COMMAND_WAIT_SECONDS)
            if (not isinstance(name, str) or name not in COMMAND_NAMES or not isinstance(data, dict)
                    or type(timeout) is not int or not 1 <= timeout <= COMMAND_WAIT_SECONDS):
                self._json(400, {"error": "INVALID_COMMAND", "timeout_seconds": [1, COMMAND_WAIT_SECONDS]})
                return
            with self.server.condition:
                if len(self.server.commands) >= 32:
                    self._json(429, {"error": "COMMAND_QUEUE_FULL"})
                    return
                command_id = uuid.uuid4().hex
                item = {"id": command_id, "name": name, "payload": data, "status": "queued"}
                self.server.commands[command_id] = item
                self.server.condition.wait_for(lambda: item["status"] in {"done", "error"}, timeout)
                self.server.commands.pop(command_id)
            if item["status"] == "done":
                self._json(200, {"ok": True, "id": command_id, "result": item["result"]})
            elif item["status"] == "error":
                self._json(422, {"ok": False, "id": command_id, "error": item["error"]})
            else:
                self._json(504, {"ok": False, "id": command_id, "error": "FRAME_ATELIER_COMMAND_TIMEOUT",
                                 "may_have_executed": item["status"] == "in_flight", "retry": "Inspect state before retrying; never automatically replay a mutation."})
        else:
            self._json(404, {"error": "FRAME_ATELIER_ENDPOINT_NOT_FOUND"})

    def log_message(self, format, *args):
        if urlsplit(self.path).path not in ("/api/frame-atelier/poll", "/api/frame-atelier/state"):
            super().log_message(format, *args)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8001, help="Loopback port; 0 chooses a free port")
    with Server(port=parser.parse_args().port) as server:
        print(f"Frame Atelier: http://127.0.0.1:{server.server_port}/Unone/web/frame-atelier/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
