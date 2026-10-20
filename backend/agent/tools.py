"""本地数据访问工具：只读索引、官网清单和受控资产路径。"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

RUN_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = RUN_ROOT.parent / "huawei-sales-agent-data"
INDEX_PATH = DATA_ROOT / "datasets" / "cleaned" / "local_kb_index.json"
MANIFEST_PATH = DATA_ROOT / "datasets" / "raw" / "manifest.json"


def _load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def load_index() -> dict[str, Any]:
    return _load_json(INDEX_PATH)


def load_manifest() -> dict[str, Any]:
    return _load_json(MANIFEST_PATH)


def source_health() -> dict[str, Any]:
    manifest = load_manifest()
    entries = manifest.get("entries") or []
    ok = [entry for entry in entries if entry.get("fetch_status") == "ok"]
    failed = [entry for entry in entries if entry.get("fetch_status") != "ok"]
    return {
        "manifest_entries": len(entries),
        "ok": len(ok),
        "failed": len(failed),
        "failed_ids": [entry.get("id") for entry in failed],
        "pricing_status": manifest.get("pricing_status"),
        "ima_required": manifest.get("ima_required"),
    }


def safe_asset_path(relative: str) -> Path:
    if not isinstance(relative, str) or not relative.startswith("datasets/raw/assets/"):
        raise ValueError("只允许 datasets/raw/assets/ 下的候选图")
    resolved = (DATA_ROOT / relative).resolve()
    allowed = (DATA_ROOT / "datasets" / "raw" / "assets").resolve()
    if not resolved.is_relative_to(allowed) or not resolved.is_file() or resolved.is_symlink():
        raise ValueError("资产不存在、越界或为符号链接")
    return resolved


def asset_sha256(relative: str) -> str:
    return hashlib.sha256(safe_asset_path(relative).read_bytes()).hexdigest()
