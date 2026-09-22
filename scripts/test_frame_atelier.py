"""Real HTTP regression tests; isolated server, no user project or model calls."""
import concurrent.futures
import http.client
import importlib.util
import json
import threading
import time
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("atelier", Path(__file__).with_name("serve-frame-atelier.py"))
atelier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(atelier)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.server = atelier.Server(port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        _, body, _ = self.request("GET", "session", headers={"X-Frame-Atelier": "1"})
        self.auth = {"Authorization": f"Bearer {body['token']}"}

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, method, path, value=None, headers=None, raw=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        data = json.dumps(value).encode() if value is not None else raw
        request_headers = {"Content-Type": "application/json", **(headers or {})}
        path = path if path.startswith("/") else f"/api/frame-atelier/{path}"
        connection.request(method, path, body=data, headers=request_headers)
        response = connection.getresponse()
        body = response.read()
        result = (response.status, json.loads(body) if "application/json" in response.getheader("Content-Type", "") else body, dict(response.getheaders()))
        connection.close()
        return result

    def test_auth_origin_and_dns_rebinding_do_not_mutate_state(self):
        for headers, expected in [({}, 401), ({"Authorization": "Bearer invalid"}, 401),
                                  ({**self.auth, "Origin": "https://untrusted.invalid"}, 403),
                                  ({**self.auth, "Origin": "null"}, 403),
                                  ({**self.auth, "Host": "untrusted.invalid"}, 403),
                                  ({**self.auth, "Sec-Fetch-Site": "cross-site"}, 403)]:
            status, _, response_headers = self.request("POST", "state", {"injected": True}, headers)
            self.assertEqual(status, expected)
            self.assertNotIn("Access-Control-Allow-Origin", response_headers)
            self.assertIsNone(self.server.state["last_state"])
        for headers in ({}, {"X-Frame-Atelier": "1", "Origin": "https://untrusted.invalid"},
                        {"X-Frame-Atelier": "1", "Sec-Fetch-Site": "cross-site"}):
            self.assertEqual(self.request("GET", "session", headers=headers)[0], 403)
        self.assertEqual(self.request("OPTIONS", "state", headers={"Origin": "https://untrusted.invalid"})[0], 403)
        origin = f"http://127.0.0.1:{self.server.server_port}"
        self.assertEqual(self.request("POST", "state", {"valid": True}, {**self.auth, "Origin": origin})[0], 200)
        self.assertEqual(self.server.state["last_state"], {"valid": True})

    def test_invalid_payloads_fail_without_server_crash(self):
        for value in [[], "text", 12]:
            self.assertEqual(self.request("POST", "state", value, self.auth)[0], 400)
        self.assertEqual(self.request("POST", "state", headers=self.auth, raw=b"{")[0], 400)
        self.assertEqual(self.request("POST", "state", {}, {**self.auth, "Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("POST", "state", headers={**self.auth, "Content-Length": str(atelier.MAX_BODY + 1)})[0], 413)
        for value in [{"name": []}, {"name": "inspect", "timeout": "2"}, {"name": "inspect", "payload": []}, {"name": "shell"}]:
            self.assertEqual(self.request("POST", "command", value, self.auth)[0], 400)
        self.assertEqual(self.request("POST", "result", {"id": [], "ok": True}, self.auth)[0], 400)
        self.assertEqual(self.request("GET", "health", headers=self.auth)[0], 200)

    def test_command_poll_result_round_trip_is_not_redelivered(self):
        with concurrent.futures.ThreadPoolExecutor() as pool:
            submitted = pool.submit(self.request, "POST", "command", {"name": "inspect", "timeout": 3}, self.auth)
            commands = []
            for _ in range(100):
                commands = self.request("GET", "poll", headers=self.auth)[1]["commands"]
                if commands:
                    break
                time.sleep(0.01)
            self.assertEqual(len(commands), 1)
            self.assertEqual(self.request("GET", "poll", headers=self.auth)[1]["commands"], [])
            result = {"id": commands[0]["id"], "ok": True, "result": {"frame_count": 2}}
            self.assertEqual(self.request("POST", "result", result, self.auth)[0], 200)
            response = submitted.result(timeout=4)
            self.assertEqual(response[0], 200)
            self.assertEqual(response[1]["result"], {"frame_count": 2})
            self.assertEqual(self.request("POST", "result", result, self.auth)[0], 404)

    def test_timeout_is_removed_and_never_executed_later(self):
        status, body, _ = self.request("POST", "command", {"name": "add_frame", "timeout": 1}, self.auth)
        self.assertEqual(status, 504)
        self.assertFalse(body["may_have_executed"])
        self.assertEqual(self.request("GET", "poll", headers=self.auth)[1]["commands"], [])

    def test_static_files_are_an_explicit_allowlist(self):
        for path in ["/Unone/AGENTS.md", "/Unone/.git/config", "/UnoneUI/", "/Unone/web/frame-atelier/%2e%2e/main.js"]:
            self.assertEqual(self.request("GET", path)[0], 404)
        for path in ["/Unone/web/frame-atelier/", "/Unone/web/frame-atelier/main.js"]:
            status, _, headers = self.request("GET", path)
            self.assertEqual(status, 200)
            self.assertEqual(headers["X-Frame-Options"], "DENY")


if __name__ == "__main__":
    unittest.main()
