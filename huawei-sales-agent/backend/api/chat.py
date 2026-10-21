"""同源 HTTP 转发工具。业务判断留在 Node 规则引擎。"""

from __future__ import annotations

import http.client

HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


def forward_request(
    host: str,
    port: int,
    method: str,
    path: str,
    headers: dict[str, str],
    body: bytes,
    timeout: float = 130.0,
) -> tuple[int, list[tuple[str, str]], bytes]:
    connection = http.client.HTTPConnection(host, port, timeout=timeout)
    try:
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        payload = response.read()
        return response.status, response.getheaders(), payload
    finally:
        connection.close()
