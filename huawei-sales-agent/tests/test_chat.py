"""四步闭环、来源标注、边界样例和可选 HTTP 冒烟测试。"""

from __future__ import annotations

import http.cookiejar
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

RUN_ROOT = Path(__file__).resolve().parents[1]
if str(RUN_ROOT) not in sys.path:
    sys.path.insert(0, str(RUN_ROOT))

from backend.agent.agent_core import four_step_summary, run_pipeline
from backend.agent import tools
from backend.rag.vector_store import LocalVectorStore

CASES = json.loads((Path(__file__).with_name("test_cases.json")).read_text(encoding="utf-8"))["cases"]


class PipelineTests(unittest.TestCase):
    def test_manifest_has_no_invented_success(self) -> None:
        health = tools.source_health()
        self.assertEqual(health["manifest_entries"], 7)
        self.assertEqual(health["failed"], 2)
        self.assertEqual(set(health["failed_ids"]), {"vmall-matebook-14-2024", "vmall-matebook-14-harmonyos"})
        manifest = tools.load_manifest()
        for entry in manifest["entries"]:
            if entry["fetch_status"] != "ok":
                self.assertIsNone(entry["raw_path"])
                self.assertIsNone(entry["text_path"])
                self.assertIsNone(entry["price"])

    def test_local_index_and_vector_search_keep_sources(self) -> None:
        index = tools.load_index()
        self.assertGreaterEqual(len(index["documents"]), 100)
        store = LocalVectorStore(index["documents"])
        results = store.search("MateBook 14 屏幕 分辨率", top_k=3)
        self.assertTrue(results)
        for result in results:
            self.assertTrue(result["entry"])
            self.assertTrue(result["entry_sha256"])
            self.assertTrue(result["archive_aliases"])

    def test_all_synthetic_cases_keep_four_step_contract(self) -> None:
        allowed_status = {"demo_ready", "needs_attention", "needs_clarification"}
        for case in CASES:
            with self.subTest(case=case["id"]):
                result = run_pipeline(case["payload"])
                self.assertIn(result["status"], allowed_status)
                self.assertIs(result.get("actual_transaction_quote"), False)
                self.assertEqual(len(result["customer_analysis"]["profile"]), 11)
                self.assertIn("content", result)
                self.assertIn("pricing_result", result)
                self.assertIn("solution", result)
                self.assertIsInstance(result["next_actions"], list)
                self.assertTrue(result["limitations"])
                if result.get("pricing_result"):
                    self.assertIs(result["pricing_result"]["actual_transaction_quote"], False)
                if result["status"] == "demo_ready":
                    self.assertEqual([level["level"] for level in result["pricing_result"]["trace"]], [1, 2, 3, 4])
                    self.assertEqual(result["pricing_result"]["amount_cents"], result["pricing_result"]["unit_amount_cents"] * result["pricing_result"]["quantity"])
                    self.assertEqual(len(result["solution"]["demonstration_plan"]["schedule"]), 4)
                for source in (result.get("official_reference") or {}).get("sources") or []:
                    self.assertTrue(source["url"].startswith("https://"))
                    self.assertTrue(source["text_sha256"])

    def test_full_demo_case(self) -> None:
        case = next(item for item in CASES if item["id"] == "harmony-demo-full")
        result = run_pipeline(case["payload"])
        summary = four_step_summary(result)
        self.assertEqual(result["status"], "demo_ready")
        self.assertTrue(summary["customer_profile"])
        self.assertTrue(summary["content_draft"])
        self.assertTrue(summary["pricing_calculated"])
        self.assertEqual(summary["demo_schedule_blocks"], 4)
        self.assertGreaterEqual(summary["next_actions"], 3)
        self.assertEqual(result["pricing_result"]["unit_amount_cents"], 573000)

    def test_clarification_case_does_not_invent_profile(self) -> None:
        case = next(item for item in CASES if item["id"] == "minimal-information")
        result = run_pipeline(case["payload"])
        self.assertEqual(result["status"], "needs_attention")
        self.assertIsNone(result["content"]["marketing_content"])
        self.assertTrue(result["customer_analysis"]["clarification_questions"])
        profile = result["customer_analysis"]["profile"]
        self.assertEqual(profile["identity"]["status"], "pending")
        self.assertIsNone(profile["identity"]["value"])
        self.assertIsNone(profile["budget"]["value"])


@unittest.skipUnless(os.environ.get("HUAWEI_HTTP_SMOKE") == "1", "设置 HUAWEI_HTTP_SMOKE=1 运行真实本地 HTTP 冒烟")
class GatewayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        from backend.main import create_server

        cls.auth_tmp = tempfile.TemporaryDirectory()
        cls.previous_auth_file = os.environ.get("HUAWEI_AUTH_FILE")
        os.environ["HUAWEI_AUTH_FILE"] = str(Path(cls.auth_tmp.name) / "auth.json")
        cls.server, cls.engine = create_server("127.0.0.1", 0)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.jar = http.cookiejar.CookieJar()
        cls.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cls.jar))
        cls.origin = f"http://localhost:{cls.port}"
        cls.post_json("/api/auth/register", {"username": "smoke_admin", "password": "SmokeAdmin2026!"})
        login = cls.post_json("/api/auth/login", {"username": "smoke_admin", "password": "SmokeAdmin2026!"})
        cls.auth_csrf = login["csrf_token"]

    @classmethod
    def post_json(cls, path: str, value: dict) -> dict:
        request = urllib.request.Request(
            f"{cls.origin}{path}",
            data=json.dumps(value, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json; charset=utf-8", "Origin": cls.origin},
        )
        with cls.opener.open(request, timeout=10) as response:
            return json.loads(response.read())

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.engine.stop()
        cls.thread.join(timeout=3)
        if cls.previous_auth_file is None:
            os.environ.pop("HUAWEI_AUTH_FILE", None)
        else:
            os.environ["HUAWEI_AUTH_FILE"] = cls.previous_auth_file
        cls.auth_tmp.cleanup()

    def get_json(self, path: str) -> dict:
        with self.opener.open(f"{self.origin}{path}", timeout=10) as response:
            return json.loads(response.read())

    def test_health_pages_and_exports(self) -> None:
        health = self.get_json("/api/health")
        self.assertEqual(health["status"], "ok")
        private_request = urllib.request.Request(f"{self.origin}/api/examples", headers={"Origin": self.origin})
        with self.assertRaises(urllib.error.HTTPError) as unauthenticated:
            urllib.request.urlopen(private_request, timeout=10)
        self.assertEqual(unauthenticated.exception.code, 401)
        for path in ("/", "/static/css/styles.css", "/static/js/app.js", "/static/js/auth.js", "/favicon.svg", "/api/source-status", "/api/examples"):
            with self.subTest(path=path):
                with self.opener.open(f"{self.origin}{path}", timeout=10) as response:
                    self.assertEqual(response.status, 200)
                    self.assertTrue(response.read())
        forwarded_origin = self.origin.removeprefix("http://")
        source_request = urllib.request.Request(
            f"{self.origin}/api/source-status",
            headers={"Origin": forwarded_origin},
        )
        with self.opener.open(source_request, timeout=10) as response:
            self.assertEqual(response.status, 200)
            self.assertTrue(response.read())
        examples = self.get_json("/api/examples")
        self.assertTrue(examples["csrf_token"])
        registration = self.post_json("/api/auth/register", {"username": "smoke_member", "password": "SmokeMember2026!"})
        role_request = urllib.request.Request(
            f"{self.origin}/api/admin/users/{registration['user']['id']}",
            data=b'{"role":"viewer"}',
            method="PATCH",
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Origin": self.origin,
                "X-CSRF-Token": self.auth_csrf,
            },
        )
        with self.opener.open(role_request, timeout=10) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read())["user"]["role"], "viewer")
        payload = json.dumps(
            {
                "marketing_input": examples["examples"][0]["marketing_input"],
                "demo_pricing": True,
            },
            ensure_ascii=False,
        ).encode("utf-8")
        request = urllib.request.Request(
            f"{self.origin}/api/runs",
            data=payload,
            method="POST",
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Origin": forwarded_origin,
                "X-CSRF-Token": examples["csrf_token"],
            },
        )
        with self.opener.open(request, timeout=10) as response:
            self.assertEqual(response.status, 202)
            job = json.loads(response.read())
        for _ in range(50):
            status = self.get_json(f"/api/runs/{job['id']}")
            if status["status"] != "running":
                break
            threading.Event().wait(0.1)
        self.assertEqual(status["status"], "completed")
        for fmt in ("json", "markdown"):
            with self.opener.open(f"{self.origin}/api/runs/{job['id']}/export?format={fmt}", timeout=10) as response:
                self.assertEqual(response.status, 200)
                self.assertTrue(response.read())
        upload = urllib.request.Request(f"{self.origin}/api/upload", data=b"x", method="POST", headers={"Content-Type": "text/plain"})
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.opener.open(upload, timeout=10)
        self.assertEqual(caught.exception.code, 501)

    def test_product_match_endpoint_and_export(self) -> None:
        examples = self.get_json("/api/examples")
        self.assertTrue(examples["match_examples"])
        input_value = json.loads(json.dumps(examples["match_examples"][0]["input"]))
        input_value["mode"] = "local"
        input_value["use_cloud_model"] = False
        forwarded_origin = self.origin.removeprefix("http://")
        request = urllib.request.Request(
            f"{self.origin}/api/product-matches",
            data=json.dumps(input_value, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Origin": forwarded_origin,
                "X-CSRF-Token": examples["csrf_token"],
            },
        )
        with self.opener.open(request, timeout=10) as response:
            self.assertEqual(response.status, 202)
            job = json.loads(response.read())
            self.assertEqual(job["kind"], "product-match")
        for _ in range(50):
            status = self.get_json(f"/api/runs/{job['id']}")
            if status["status"] != "running":
                break
            threading.Event().wait(0.1)
        self.assertEqual(status["status"], "completed")
        result = status["result"]
        self.assertIn(result["status"], {"ready", "partial"})
        self.assertTrue(result["candidates"])
        for candidate in result["candidates"]:
            self.assertIn(candidate["status"], {"recommended", "pending_confirmation", "not_recommended"})
            self.assertTrue(candidate["limitations"])
            self.assertTrue(candidate["evidence"])
            self.assertTrue(candidate["criteria_coverage"])
            self.assertIn("operating_system", candidate)
            for reason in candidate["matching_reasons"]:
                self.assertTrue(reason["evidence_ids"])
                self.assertTrue(reason["cited_span"])
        for fmt in ("json", "markdown"):
            with self.opener.open(f"{self.origin}/api/runs/{job['id']}/export?format={fmt}", timeout=10) as response:
                self.assertEqual(response.status, 200)
                self.assertTrue(response.read())


if __name__ == "__main__":
    unittest.main(verbosity=2)
