"""公开演示不接受文件上传，避免客户资料落盘或进入模型。"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler


def send_upload_rejected(handler: BaseHTTPRequestHandler) -> None:
    payload = json.dumps(
        {
            "error": {
                "code": "UPLOAD_DISABLED",
                "message": "当前版本不接收文件上传；请用文本框提交虚构或脱敏描述。",
            }
        },
        ensure_ascii=False,
    ).encode("utf-8")
    handler.send_response(501)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)
