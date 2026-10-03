"""Real HTTP regression tests; isolated server, no user project or model calls."""
import concurrent.futures
import http.client
import importlib.util
import json
import tempfile
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

    def test_codex_status_and_structured_operations_are_authenticated(self):
        self.assertEqual(self.request("GET", "codex/status")[0], 401)
        status, body, _ = self.request("GET", "codex/status", headers=self.auth)
        self.assertEqual(status, 200)
        self.assertEqual(body["provider"], "codex-cli")
        self.assertIn("ready", body)
        for operation in ("shell", "imagegen", "arbitrary"):
            code, result, _ = self.request("POST", "codex/generate", {"operation": operation, "context": {}}, self.auth)
            self.assertEqual(code, 400)
            self.assertEqual(result["error"], "CODEX_OPERATION_NOT_ALLOWED")

    def test_codex_json_schemas_preserve_tree_depth_and_prompt_boundaries(self):
        plan_schema = atelier._output_schema("plan", {})
        self.assertEqual(plan_schema["required"], ["planning"])
        panel_schema = atelier._output_schema("panel_plan", {})
        self.assertEqual(panel_schema["properties"]["panels"]["items"]["properties"]["rect"]["required"], ["x", "y", "width", "height"])
        tree = atelier._output_schema("panel_children", {"user_request": "add a label"})
        self.assertIn("panel_update", tree["required"])
        self.assertIn("children", tree["properties"])
        self.assertEqual(tree["properties"]["panel_update"]["required"], ["name", "purpose", "type", "variant", "rect"])
        allowed_types = tree["properties"]["panel_update"]["properties"]["type"]["enum"]
        self.assertIn("image", allowed_types)
        self.assertIn("label", allowed_types)
        self.assertIn(None, allowed_types)
        def assert_strict_objects(schema):
            if isinstance(schema, dict):
                if "object" in (schema.get("type") if isinstance(schema.get("type"), list) else [schema.get("type")]):
                    self.assertEqual(set(schema.get("properties", {})), set(schema.get("required", [])))
                for value in schema.values():
                    assert_strict_objects(value)
            elif isinstance(schema, list):
                for value in schema:
                    assert_strict_objects(value)
        assert_strict_objects(tree)
        prompt = atelier._codex_prompt("panel_children", {"user_request": "make a card"})
        self.assertIn("never invent, assume, or add business rules", prompt)
        self.assertIn("Every supported node kind may own children", prompt)
        with self.assertRaises(atelier.CodexError):
            atelier._codex_prompt("panel_children", {"large": "x" * atelier.MAX_CODEX_INPUT})

    def test_image_import_validates_auth_type_signature_and_only_serves_generated_names(self):
        png = b"\x89PNG\r\n\x1a\n" + b"test-image-payload"
        with tempfile.TemporaryDirectory(prefix="atelier-image-test-") as temporary_root:
            self.server.root = Path(temporary_root)
            self.assertEqual(self.request("POST", "assets/import", headers={"Content-Type": "image/png"}, raw=png)[0], 401)
            self.assertEqual(self.request("POST", "assets/import", headers={**self.auth, "Content-Type": "image/jpeg"}, raw=png)[0], 415)
            self.assertEqual(self.request("POST", "assets/import", headers={**self.auth, "Content-Type": "image/png"}, raw=b"not-an-image")[0], 400)
            status, body, _ = self.request("POST", "assets/import", headers={**self.auth, "Content-Type": "image/png"}, raw=png)
            self.assertEqual(status, 201)
            self.assertRegex(body["asset_url"], r"^/Unone/web/frame-atelier/assets/imported/asset-[0-9a-f]{32}\.png$")
            served, actual_bytes, headers = self.request("GET", body["asset_url"])
            self.assertEqual(served, 200)
            self.assertEqual(actual_bytes, png)
            self.assertEqual(next(value for key, value in headers.items() if key.lower() == "content-type"), "image/png")
            self.assertEqual(self.request("GET", "/Unone/web/frame-atelier/assets/imported/anything.png")[0], 404)
            webp = b"RIFF" + (12).to_bytes(4, "little") + b"WEBP" + b"test"
            self.assertEqual(self.request("POST", "assets/import", headers={**self.auth, "Content-Type": "image/webp"}, raw=webp)[0], 201)

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
