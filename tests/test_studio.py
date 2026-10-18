import http.client
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path

from backend.studio.app import create_server


class StudioHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = create_server("127.0.0.1", 0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        try:
            cls.server.shutdown()
        finally:
            cls.server.server_close()
            cls.thread.join(timeout=5)

    def request(self, method, path, body=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        try:
            connection.request(method, path, body=body)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_home_explains_simulation_in_chinese(self):
        status, headers, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "text/html; charset=utf-8")
        content = body.decode("utf-8")
        self.assertIn("这是静态框架介绍与模拟流程", content)
        self.assertIn("本页面未接入模型", content)
        self.assertIn("没有启动任何实际 Agent 进程", content)
        self.assertIn("QA 独立验收", content)

    def test_health_reports_only_simulation(self):
        status, headers, body = self.request("GET", "/healthz")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/json; charset=utf-8")
        self.assertEqual(json.loads(body), {
            "status": "ok",
            "service": "framework-studio",
            "simulation": True,
            "model_connected": False,
            "training": False,
            "actual_agents_running": False,
        })

    def test_head_has_get_headers_and_no_body(self):
        for path in ("/", "/healthz", "/missing"):
            with self.subTest(path=path):
                status, headers, body = self.request("GET", path)
                head_status, head_headers, head_body = self.request("HEAD", path)
                self.assertEqual(head_status, status)
                self.assertEqual(head_body, b"")
                self.assertEqual(head_headers["Content-Length"], str(len(body)))
                self.assertEqual(head_headers["Content-Type"], headers["Content-Type"])

    def test_unknown_query_and_traversal_paths_do_not_expose_files(self):
        paths = (
            "/missing", "/?query=1", "/healthz?query=1", "/agent.md",
            "/.collaboration/state.json", "/../agent.md", "/%2e%2e/agent.md",
            "/..%5cagent.md", "/backend/studio/app.py",
        )
        for path in paths:
            with self.subTest(path=path):
                status, headers, body = self.request("GET", path)
                self.assertEqual(status, 404)
                self.assertEqual(body, b"Not found\n")
                self.assertEqual(headers["Content-Type"], "text/plain; charset=utf-8")

    def test_disallowed_methods_return_405_and_do_not_write(self):
        previous_directory = Path.cwd()
        with tempfile.TemporaryDirectory(prefix="huawei-studio-http-") as temporary:
            temporary_directory = Path(temporary)
            sentinel = temporary_directory / "sentinel.txt"
            sentinel.write_bytes(b"unchanged")
            try:
                os.chdir(temporary_directory)
                for method in ("POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "CONNECT"):
                    with self.subTest(method=method):
                        status, headers, body = self.request(method, "/sentinel.txt", b"must not be written")
                        self.assertEqual(status, 405)
                        self.assertEqual(headers["Allow"], "GET, HEAD")
                        self.assertEqual(body, b"Method not allowed\n")
                self.assertEqual(sentinel.read_bytes(), b"unchanged")
                self.assertEqual(list(temporary_directory.iterdir()), [sentinel])
            finally:
                os.chdir(previous_directory)

    def test_csp_allows_only_modelscope_framing(self):
        for method, path in (("GET", "/"), ("GET", "/healthz"), ("HEAD", "/")):
            with self.subTest(method=method, path=path):
                status, headers, body = self.request(method, path)
                self.assertEqual(status, 200)
                directives = {
                    directive.strip().split()[0]: directive.strip().split()[1:]
                    for directive in headers["Content-Security-Policy"].split(";")
                    if directive.strip()
                }
                self.assertEqual(directives["frame-ancestors"], [
                    "https://modelscope.cn", "https://*.modelscope.cn",
                ])
                self.assertEqual(directives["default-src"], ["'none'"])
                self.assertEqual(directives["base-uri"], ["'none'"])
                self.assertEqual(directives["form-action"], ["'none'"])
                self.assertEqual(headers["Cache-Control"], "no-store")
                self.assertEqual(headers["X-Content-Type-Options"], "nosniff")


if __name__ == "__main__":
    unittest.main()
