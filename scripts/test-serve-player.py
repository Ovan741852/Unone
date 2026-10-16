"""Real HTTP regression for SDK preview MIME and unchanged exported bytes."""
import importlib.util
import mimetypes
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location(
    "serve_web_player", Path(__file__).with_name("serve-player.py"))
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class PreviewTests(unittest.TestCase):
    def test_real_get_head_ignore_host_mime_registry_and_stale_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            contents = {
                "index.html": b"<!doctype html><title>packaging fixture</title>",
                "module.mjs": b"export const ready = true;",
                "module.js": b"export const ready = true;",
                "UPPER.MJS": b"export const uppercase = true;",
                "player.wasm": b"\0asm\x01\0\0\0",
                "config.json": b"{}",
            }
            for name, data in contents.items():
                (root / name).write_bytes(data)
            # Reproduce a host where .mjs/.js/.wasm are registered as text/plain.
            mimetypes.init()
            original = mimetypes.types_map.copy()
            try:
                for extension in (".mjs", ".js", ".wasm"):
                    mimetypes.add_type("text/plain", extension)
                with preview.create_server(root, port=0) as server:
                    thread = threading.Thread(target=server.serve_forever, daemon=True)
                    thread.start()
                    try:
                        base = f"http://127.0.0.1:{server.server_port}/"
                        for name, expected in [
                            ("module.mjs", "text/javascript"),
                            ("module.js", "text/javascript"),
                            ("UPPER.MJS", "text/javascript"),
                            ("player.wasm", "application/wasm"),
                            ("config.json", "application/json"),
                        ]:
                            for method in ("GET", "HEAD"):
                                request = Request(base + name, method=method, headers={
                                    "If-Modified-Since": "Wed, 31 Dec 2098 23:59:59 GMT"})
                                with urlopen(request, timeout=5) as response:
                                    self.assertEqual(response.status, 200)
                                    self.assertEqual(response.headers.get_content_type(), expected)
                                    self.assertEqual(response.headers["Cache-Control"], "no-store")
                                    self.assertEqual(response.read(), contents[name] if method == "GET" else b"")
                    finally:
                        server.shutdown()
                        thread.join(timeout=5)
            finally:
                mimetypes.types_map.clear()
                mimetypes.types_map.update(original)
            self.assertEqual({name: (root / name).read_bytes() for name in contents}, contents)

    def test_rejects_non_directory_before_opening_a_port(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "not-a-directory"
            file.write_bytes(b"fixture")
            with self.assertRaisesRegex(ValueError, "existing directory"):
                preview.create_server(file, port=0)

    def test_release_cache_compatibility_and_forced_mime_refresh(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            relative = "releases/" + "a" * 64 + "/module.mjs"
            path = root / relative
            path.parent.mkdir(parents=True)
            path.write_bytes(b"export const ready = true;")
            for cache_releases in (True, False):
                with preview.create_server(root, port=0, cache_releases=cache_releases) as server:
                    thread = threading.Thread(target=server.serve_forever, daemon=True)
                    thread.start()
                    try:
                        url = f"http://127.0.0.1:{server.server_port}/" + relative
                        request = Request(url, headers={
                            "If-Modified-Since": "Wed, 31 Dec 2098 23:59:59 GMT"})
                        if cache_releases:
                            with self.assertRaises(HTTPError) as raised:
                                urlopen(request, timeout=5)
                            self.assertEqual(raised.exception.code, 304)
                            self.assertIn("immutable", raised.exception.headers["Cache-Control"])
                        else:
                            with urlopen(request, timeout=5) as response:
                                self.assertEqual(response.status, 200)
                                self.assertEqual(response.headers.get_content_type(), "text/javascript")
                                self.assertEqual(response.headers["Cache-Control"], "no-store")
                                self.assertEqual(response.read(), path.read_bytes())
                    finally:
                        server.shutdown()
                        thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
