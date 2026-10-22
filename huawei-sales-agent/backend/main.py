"""华销智策本地网页入口。

Python 只负责公开端口、同源转发和上传拒绝；四步业务仍由
backend/agent/cloud-server.js 的规则引擎处理。这样既不复制业务逻辑，
也不把 Node 内部端口直接暴露给浏览器。
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

BACKEND = Path(__file__).resolve().parent
RUN_ROOT = BACKEND.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from api.chat import HOP_BY_HOP, forward_request  # noqa: E402
from api.upload import send_upload_rejected  # noqa: E402

CLOUD_SERVER = BACKEND / "agent" / "cloud-server.js"
NODE = shutil.which("node") or "node"


class NodeEngine:
    """启动并守护内部 Node 规则引擎。"""

    def __init__(self, public_origin: str) -> None:
        self.public_origin = public_origin
        self.port = self._free_port()
        self.process: subprocess.Popen[str] | None = None
        self._tail: deque[str] = deque(maxlen=30)

    @staticmethod
    def _free_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(("127.0.0.1", 0))
            return int(probe.getsockname()[1])

    def start(self) -> None:
        if not CLOUD_SERVER.is_file():
            raise RuntimeError(f"缺少业务入口：{CLOUD_SERVER}")
        env = os.environ.copy()
        env.update(
            {
                "PORT": str(self.port),
                "HOST": "127.0.0.1",
                "PUBLIC_ORIGIN": self.public_origin,
                "PLATFORM_PROXY_HOST": "1",
            }
        )
        self.process = subprocess.Popen(
            [NODE, str(CLOUD_SERVER)],
            cwd=str(RUN_ROOT),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        threading.Thread(target=self._drain, daemon=True).start()
        self._wait_ready()

    def _drain(self) -> None:
        assert self.process and self.process.stdout
        for line in self.process.stdout:
            self._tail.append(line.rstrip())

    def _wait_ready(self) -> None:
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if self.process and self.process.poll() is not None:
                raise RuntimeError("Node 规则引擎启动失败：" + " | ".join(self._tail))
            try:
                with urlopen(f"http://127.0.0.1:{self.port}/api/health", timeout=1) as reply:
                    if reply.status == 200:
                        return
            except (URLError, OSError):
                time.sleep(0.15)
        raise RuntimeError("Node 规则引擎 12 秒内未就绪")

    def stop(self) -> None:
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()


class GatewayHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "HuaXiaoZhiCe/1.0"
    sys_version = ""
    node_port = 0

    def do_GET(self) -> None:
        self._proxy()

    def do_POST(self) -> None:
        self._proxy()

    def do_PUT(self) -> None:
        self._proxy()

    def do_PATCH(self) -> None:
        self._proxy()

    def do_DELETE(self) -> None:
        self._proxy()

    def _read_body(self) -> bytes:
        raw_length = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_length)
        except ValueError:
            length = 0
        return self.rfile.read(length) if length > 0 else b""

    def _proxy(self) -> None:
        if self.path.split("?", 1)[0] == "/api/upload":
            self._read_body()
            send_upload_rejected(self)
            return
        body = self._read_body()
        headers = {name: value for name, value in self.headers.items() if name.lower() not in HOP_BY_HOP}
        headers["Host"] = f"127.0.0.1:{self.node_port}"
        headers["X-Forwarded-Proto"] = "http"
        # Node 内部端口仅监听回环地址；由 Python 覆盖真实对端，避免伪造请求头绕过登录限流。
        headers["X-Forwarded-For"] = str(self.client_address[0])
        try:
            status, reply_headers, payload = forward_request(
                "127.0.0.1", self.node_port, self.command, self.path, headers, body
            )
        except (OSError, http.client.HTTPException) as error:
            payload = json.dumps(
                {"error": {"code": "ENGINE_UNAVAILABLE", "message": f"规则引擎暂不可用：{type(error).__name__}"}},
                ensure_ascii=False,
            ).encode("utf-8")
            status, reply_headers = 502, [("Content-Type", "application/json; charset=utf-8")]
        self.send_response(status)
        for name, value in reply_headers:
            if name.lower() not in HOP_BY_HOP | {"content-length"}:
                self.send_header(name, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def log_message(self, format_string: str, *args: object) -> None:
        # 不记录客户输入、Cookie 或查询参数。
        sys.stderr.write("HTTP %s %s\n" % (self.command, self.path.split("?", 1)[0]))


def create_server(host: str, port: int) -> tuple[ThreadingHTTPServer, NodeEngine]:
    server = ThreadingHTTPServer((host, port), GatewayHandler)
    server.daemon_threads = True
    actual_port = int(server.server_address[1])
    public_origin = os.environ.get("PUBLIC_ORIGIN") or f"http://localhost:{actual_port}"
    engine = NodeEngine(public_origin)
    GatewayHandler.node_port = engine.port
    engine.start()
    return server, engine


def main() -> int:
    parser = argparse.ArgumentParser(description="华销智策 —— 针对华为的销售智能体")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7860)
    args = parser.parse_args()
    try:
        server, engine = create_server(args.host, args.port)
    except Exception as error:  # 启动失败只报告类型和受控消息。
        print(f"启动失败：{error}", file=sys.stderr)
        return 1
    url = f"http://localhost:{server.server_address[1]}"
    print("华销智策 —— 针对华为的销售智能体", flush=True)
    print(f"本地访问：{url}", flush=True)
    print("按 Ctrl+C 停止。客户信息仅用于当前会话，不写入磁盘。", flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()
        engine.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
