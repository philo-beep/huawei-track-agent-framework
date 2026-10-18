"""Serve an embedded framework introduction using only the Python standard library."""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


PAGE = """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>华为赛道 · Agent 协作框架</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#f5f7fb;color:#17233b;line-height:1.7}
main{max-width:900px;margin:auto;padding:32px 20px}h1{line-height:1.3}
section{background:white;padding:20px;margin:20px 0;border:1px solid #dce2ed;border-radius:12px}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #e8ebf1}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f0f3f8;padding:16px;border-radius:8px}
.notice{border-left:5px solid #bd4b12}code{overflow-wrap:anywhere}
</style>
</head>
<body><main>
<p>华为赛道项目 · 协作基础设施</p>
<h1>Agent 分工与验收流程</h1>
<section class="notice" aria-label="演示范围">
<h2>这是静态框架介绍与模拟流程</h2>
<p>本页面未接入模型，没有训练或微调，没有启动任何实际 Agent 进程。
示例消息与流程均为模拟，不代表真实任务执行、业务功能或评测成绩。</p>
<p>当前服务仅提供只读介绍页面和健康检查，不展示真实项目看板，不读取项目文件，
不提供文件浏览、任务修改或模型调用接口。</p>
</section>
<section><h2>七个角色的职责</h2>
<table><thead><tr><th scope="col">角色</th><th scope="col">职责</th></tr></thead><tbody>
<tr><td>Orchestrator 主控</td><td>拆分任务、调度角色、跟踪依赖与发布条件。</td></tr>
<tr><td>A 前端</td><td>实现交互页面，遵守接口契约。</td></tr>
<tr><td>B 接口</td><td>维护接口契约与 Mock，协调数据和服务字段。</td></tr>
<tr><td>C 数据</td><td>整理数据来源、质量与交付格式。</td></tr>
<tr><td>D 后端与 Qwen</td><td>按契约实现后端；模型接入、训练与评估须另有明确任务和资源。</td></tr>
<tr><td>E 产品说明</td><td>使产品说明与实际功能一致，审阅发布候选。</td></tr>
<tr><td>QA 独立验收</td><td>检查交付、记录问题、退回修复并复验。</td></tr>
</tbody></table>
<p>角色提示词用于划分职责；七个角色不意味着七个进程同时运行。</p>
</section>
<section><h2>结构化通信示例（模拟）</h2>
<p>消息包含任务 ID、发送方、接收方、类型、载荷、目标任务状态及带时区时间。
下面是固定示例，不会发送消息或修改看板。</p>
<pre>{
  "task_id": "SIMULATION-A-001",
  "from_agent": "A",
  "to_agent": "QA",
  "type": "deliver",
  "payload": {
    "summary": "模拟：页面提交验收",
    "artifacts": ["outputs/A/example.txt"]
  },
  "status": "in_review",
  "timestamp": "2026-10-18T10:00:00+08:00"
}</pre>
</section>
<section><h2>任务流转示例（模拟）</h2>
<ol>
<li>主控 assign：pending → assigned，明确任务与验收标准。</li>
<li>责任角色 fix：assigned → in_progress，开始执行。</li>
<li>责任角色 deliver：in_progress → in_review，交付文件与验证证据。</li>
<li>QA reject：in_review → changes_requested，列出问题与复验条件。</li>
<li>责任角色 fix 后重新 deliver，QA review 通过后变为 done。</li>
<li>发布前核对文件指纹与依赖，并由 E 实际审阅同一发布候选。</li>
</ol>
<p>上述步骤仅作说明；本页面没有执行任务的按钮或后台任务。</p>
</section>
<footer>健康检查：<a href="/healthz">/healthz</a> · Python 标准库只读展示服务</footer>
</main></body></html>""".encode("utf-8")

HEALTH = json.dumps({
    "status": "ok",
    "service": "framework-studio",
    "simulation": True,
    "model_connected": False,
    "training": False,
    "actual_agents_running": False,
}, ensure_ascii=False).encode("utf-8")


class StudioHandler(BaseHTTPRequestHandler):
    server_version = "FrameworkStudio"
    sys_version = ""

    def _respond(self, status, content_type, body, head_only=False):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors https://modelscope.cn https://*.modelscope.cn; base-uri 'none'; form-action 'none'")
        if status == 405:
            self.send_header("Allow", "GET, HEAD")
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def _get(self, head_only=False):
        if self.path == "/":
            self._respond(200, "text/html; charset=utf-8", PAGE, head_only)
        elif self.path == "/healthz":
            self._respond(200, "application/json; charset=utf-8", HEALTH, head_only)
        else:
            self._respond(404, "text/plain; charset=utf-8", b"Not found\n", head_only)

    def do_GET(self):
        self._get()

    def do_HEAD(self):
        self._get(head_only=True)

    def do_POST(self):
        self._respond(405, "text/plain; charset=utf-8", b"Method not allowed\n")

    do_PUT = do_POST
    do_PATCH = do_POST
    do_DELETE = do_POST
    do_OPTIONS = do_POST
    do_TRACE = do_POST
    do_CONNECT = do_POST

    def log_message(self, format_string, *arguments):
        pass


def create_server(host="0.0.0.0", port=7860):
    return ThreadingHTTPServer((host, port), StudioHandler)


def main():
    port = int(os.environ.get("PORT", "7860"))
    if not 1 <= port <= 65535:
        raise ValueError("PORT must be between 1 and 65535")
    with create_server(port=port) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
