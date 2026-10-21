"""Python 侧四步调度适配层。

输入经标准输入交给已验证的 Node 规则引擎，避免把业务规则复制成第二套。
当前模式为 rules：不调用千问、不调用 IMA、不访问外网。
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

AGENT_DIR = Path(__file__).resolve().parent
RUN_ROOT = AGENT_DIR.parent.parent
NODE = shutil.which("node") or "node"

_RUNNER = r"""
const fs = require('node:fs');
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', async () => {
  try {
    const runnerPath = process.env.HUAWEI_RUNNER;
    const { runCloud, cloudMarkdown } = require(runnerPath);
    const result = await runCloud(JSON.parse(raw));
    const markdown = process.env.HUAWEI_MARKDOWN === '1';
    process.stdout.write(JSON.stringify(markdown ? cloudMarkdown(result) : result));
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: error && error.message ? String(error.message) : 'RUN_FAILED' }));
    process.exitCode = 1;
  }
});
"""


def run_pipeline(payload: dict[str, Any], *, markdown: bool = False, timeout: int = 130) -> Any:
    """执行四步流程；失败时抛出带受控消息的 RuntimeError。"""
    runner = AGENT_DIR / "cloud-runner.js"
    env = os.environ.copy()
    env["HUAWEI_RUNNER"] = str(runner)
    env["HUAWEI_MARKDOWN"] = "1" if markdown else "0"
    completed = subprocess.run(
        [NODE, "-e", _RUNNER],
        cwd=str(RUN_ROOT),
        env=env,
        input=json.dumps(payload, ensure_ascii=False),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
    )
    try:
        value = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("规则引擎未返回有效 JSON") from error
    if completed.returncode != 0 or (isinstance(value, dict) and set(value) == {"error"}):
        message = value.get("error", "规则引擎执行失败") if isinstance(value, dict) else "规则引擎执行失败"
        raise RuntimeError(str(message)[:500])
    return value


def four_step_summary(result: dict[str, Any]) -> dict[str, Any]:
    """给验收脚本使用的四步完整性摘要，不替代业务结果。"""
    content = (result.get("content") or {}).get("marketing_content") or {}
    pricing = result.get("pricing_result") or {}
    solution = result.get("solution") or {}
    demonstration = solution.get("demonstration_plan") or {}
    return {
        "status": result.get("status"),
        "customer_profile": bool((result.get("customer_analysis") or {}).get("profile")),
        "content_draft": bool(content.get("title") and content.get("body") and content.get("cta")),
        "pricing_calculated": pricing.get("status") == "calculated_demo",
        "pricing_is_not_transaction_quote": pricing.get("actual_transaction_quote") is False,
        "demo_schedule_blocks": len(demonstration.get("schedule") or []),
        "next_actions": len(result.get("next_actions") or []),
        "limitations": list(result.get("limitations") or []),
    }
