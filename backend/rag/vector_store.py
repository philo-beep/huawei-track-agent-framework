"""索引文档的本地向量检索，保留来源条目与指纹。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:
    from .embed import embed
except ImportError:  # 直接运行单文件时
    from embed import embed


def _dot(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right))


class LocalVectorStore:
    def __init__(self, documents: list[dict[str, Any]]):
        self.documents = [document for document in documents if str(document.get("text") or "").strip()]
        self.vectors = [embed(document.get("text", "")) for document in self.documents]

    @classmethod
    def from_index_file(cls, path: str | Path) -> "LocalVectorStore":
        with Path(path).open("r", encoding="utf-8-sig") as handle:
            index = json.load(handle)
        return cls(index.get("documents") or [])

    def search(self, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        if not query.strip() or top_k < 1:
            return []
        query_vector = embed(query)
        ranked = sorted(
            ((_dot(query_vector, vector), position) for position, vector in enumerate(self.vectors)),
            reverse=True,
        )[:top_k]
        results = []
        for score, position in ranked:
            document = self.documents[position]
            source = document.get("source") or {}
            results.append(
                {
                    "score": round(score, 6),
                    "title": document.get("title"),
                    "product_names": document.get("product_names") or [],
                    "entry": source.get("entry"),
                    "entry_sha256": source.get("entry_sha256"),
                    "archive_aliases": source.get("archive_aliases") or [],
                    "excerpt": str(document.get("text") or "")[:500],
                }
            )
        return results
