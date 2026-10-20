"""四步闭环、来源标注、边界样例和可选 HTTP 冒烟测试。"""

from __future__ import annotations

import http.cookiejar
import json
import os
import sys
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

        cls.server, cls.engine = create_server("127.0.0.1", 0)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.jar = http.cookiejar.CookieJar()
        cls.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cls.jar))
        cls.origin = f"http://localhost:{cls.port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.engine.stop()
        cls.thread.join(timeout=3)

    def get_json(self, path: str) -> dict:
        with self.opener.open(f"{self.origin}{path}", timeout=10) as response:
            return json.loads(response.read())

    def test_health_pages_and_exports(self) -> None:
        health = self.get_json("/api/health")
        self.assertEqual(health["status"], "ok")
        for path in ("/", "/static/css/styles.css", "/static/js/app.js", "/api/source-status", "/api/examples"):
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
