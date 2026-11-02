"""Real HTTP regression for SDK preview MIME and unchanged exported bytes."""
import importlib.util
import gzip
from contextlib import contextmanager
from http.client import HTTPConnection
import mimetypes
import os
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location(
    "serve_web_player", Path(__file__).with_name("serve-player.py"))
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)
export_spec = importlib.util.spec_from_file_location(
    "serve_export", Path(__file__).with_name("serve-export.py"))
measurement = importlib.util.module_from_spec(export_spec)
export_spec.loader.exec_module(measurement)


class PreviewTests(unittest.TestCase):
    server_module = preview
    release_cache_fragment = "immutable"

    @contextmanager
    def serving(self, root):
        with self.server_module.create_server(root, port=0) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                yield server
            finally:
                server.shutdown()
                thread.join(timeout=5)

    def request(self, server, url, method="GET", headers=None):
        connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        try:
            connection.request(method, url, headers=headers or {})
            response = connection.getresponse()
            return response.status, response.headers, response.read()
        finally:
            connection.close()

    @unittest.skipUnless(os.name == "nt", "Actual Windows extended-path regression")
    def test_real_windows_long_png_get_head_and_directory_index(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            extended_root = Path("\\\\?\\" + str(root.resolve()))
            relative = Path("releases") / ("b" * 64) / ("nested-" + "x" * 90) / ("page-" + "y" * 90)
            deep = extended_root / relative
            png = b"\x89PNG\r\n\x1a\nlong-path-binary\x00fixture"
            try:
                deep.mkdir(parents=True)
                (deep / "image.png").write_bytes(png)
                (deep / "index.html").write_bytes(b"<title>long directory index</title>")
                self.assertGreater(len(str(root / relative / "image.png")), 300)
                with self.serving(root) as server:
                    url = "/" + relative.as_posix() + "/image.png"
                    for method in ("GET", "HEAD"):
                        status, headers, body = self.request(server, url, method)
                        self.assertEqual(status, 200)
                        self.assertEqual(headers["Content-Type"], "image/png")
                        self.assertEqual(int(headers["Content-Length"]), len(png))
                        self.assertIn(self.release_cache_fragment, headers["Cache-Control"])
                        self.assertEqual(body, png if method == "GET" else b"")
                    directory_url = "/" + relative.as_posix()
                    status, headers, body = self.request(server, directory_url + "?v=1")
                    self.assertEqual(status, 301)
                    self.assertEqual(headers["Location"], directory_url + "/?v=1")
                    status, _, body = self.request(server, directory_url + "/")
                    self.assertEqual((status, body), (200, b"<title>long directory index</title>"))
                    self.assertEqual(self.request(server, url + "/")[0], 404)
                self.assertEqual((deep / "image.png").read_bytes(), png)
                # The directory passed to the public factory may itself be long.
                with self.serving(root / relative) as server:
                    self.assertEqual(self.request(server, "/image.png")[2], png)
                    self.assertEqual(self.request(server, "/")[2], b"<title>long directory index</title>")
            finally:
                shutil.rmtree(str(extended_root / "releases"))

    def test_directory_index_redirect_no_listing_and_file_trailing_slash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "nested").mkdir()
            (root / "empty").mkdir()
            (root / "nested" / "index.html").write_bytes(b"index fixture")
            with self.serving(root) as server:
                for method in ("GET", "HEAD"):
                    status, headers, body = self.request(server, "/nested?query=1", method)
                    self.assertEqual(status, 301)
                    self.assertEqual(headers["Location"], "/nested/?query=1")
                    self.assertEqual(body, b"")
                    status, _, body = self.request(server, "/nested/", method)
                    self.assertEqual(status, 200)
                    self.assertEqual(body, b"index fixture" if method == "GET" else b"")
                    self.assertEqual(self.request(server, "/nested/index.html/", method)[0], 404)
                    self.assertEqual(self.request(server, "/empty/", method)[0], 404)

    def test_traversal_rejected_and_percent_escapes_decoded_only_once(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_bytes(b"inside")
            (root / "%2e%2e").mkdir()
            (root / "%2e%2e" / "index.html").write_bytes(b"literal encoded directory")
            with self.serving(root) as server:
                for url in ("/../index.html", "/%2e%2e/index.html", "/%2e%2e%2findex.html", "/%2e%2e%5cindex.html", "/nested/../../index.html", "/C:/index.html"):
                    with self.subTest(url=url):
                        self.assertEqual(self.request(server, url)[0], 404)
                status, _, body = self.request(server, "/%252e%252e/index.html")
                self.assertEqual((status, body), (200, b"literal encoded directory"))

    def test_links_including_directory_index_cannot_escape_or_alias_export_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root, outside = parent / "root", parent / "outside"
            root.mkdir()
            outside.mkdir()
            (outside / "index.html").write_bytes(b"outside secret")
            (root / "actual").mkdir()
            (root / "actual" / "index.html").write_bytes(b"inside actual")
            if os.name == "nt":
                import _winapi
                _winapi.CreateJunction(str(outside), str(root / "external"))
                _winapi.CreateJunction(str(root / "actual"), str(root / "alias"))
            else:
                (root / "external").symlink_to(outside, target_is_directory=True)
                (root / "alias").symlink_to(root / "actual", target_is_directory=True)
            with self.serving(root) as server:
                self.assertEqual(self.request(server, "/external/index.html")[0], 404)
                self.assertEqual(self.request(server, "/alias/index.html")[0], 404)
                self.assertEqual(self.request(server, "/actual/")[0], 200)

    def test_linked_directory_index_is_rejected_before_stdlib_open(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "root"
            root.mkdir()
            target = Path(directory) / "outside.txt"
            target.write_bytes(b"must not escape through index.html")
            try:
                (root / "index.html").symlink_to(target)
            except OSError as error:
                if os.name == "nt" and error.winerror == 1314:
                    self.skipTest("Windows file symlink privilege unavailable; real junction coverage runs separately")
                raise
            with self.serving(root) as server:
                self.assertEqual(self.request(server, "/")[0], 404)

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


class MeasurementTests(unittest.TestCase):
    server_module = measurement
    release_cache_fragment = "no-store"
    serving = PreviewTests.serving
    request = PreviewTests.request
    test_real_windows_long_png_get_head_and_directory_index = PreviewTests.test_real_windows_long_png_get_head_and_directory_index
    test_directory_index_redirect_no_listing_and_file_trailing_slash = PreviewTests.test_directory_index_redirect_no_listing_and_file_trailing_slash
    test_traversal_rejected_and_percent_escapes_decoded_only_once = PreviewTests.test_traversal_rejected_and_percent_escapes_decoded_only_once
    test_links_including_directory_index_cannot_escape_or_alias_export_tree = PreviewTests.test_links_including_directory_index_cannot_escape_or_alias_export_tree
    test_linked_directory_index_is_rejected_before_stdlib_open = PreviewTests.test_linked_directory_index_is_rejected_before_stdlib_open

    def test_optional_gzip_get_head_metadata_and_import_has_no_server_side_effect(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = b"export const data = 'gzip fixture';\n" * 100
            (root / "index.html").write_bytes(data)
            with measurement.create_server(root, port=0, compress=True) as server:
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    encoded = None
                    for method in ("GET", "HEAD"):
                        status, headers, body = self.request(server, "/", method, {"Accept-Encoding": "gzip"})
                        self.assertEqual(status, 200)
                        self.assertEqual(headers["Content-Encoding"], "gzip")
                        self.assertEqual(headers["Vary"], "Accept-Encoding")
                        self.assertEqual(headers["Cache-Control"], "no-store")
                        if method == "GET":
                            self.assertEqual(gzip.decompress(body), data)
                            self.assertEqual(len(body), int(headers["Content-Length"]))
                            encoded = body
                        else:
                            self.assertEqual(body, b"")
                            self.assertEqual(int(headers["Content-Length"]), len(encoded))
                    status, headers, body = self.request(server, "/")
                    self.assertEqual((status, body), (200, data))
                    self.assertIsNone(headers.get("Content-Encoding"))
                finally:
                    server.shutdown()
                    thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
