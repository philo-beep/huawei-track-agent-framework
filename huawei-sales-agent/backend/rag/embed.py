"""无外部模型、无网络的中文哈希向量，用于本地检索基线。"""

from __future__ import annotations

import hashlib
import math
import re

DIMENSION = 256


def _features(text: str) -> list[str]:
    normalized = re.sub(r"\s+", " ", str(text or "").lower()).strip()
    features = re.findall(r"[a-z0-9][a-z0-9._+-]*", normalized)
    chinese = re.findall(r"[\u4e00-\u9fff]", normalized)
    features.extend("".join(chinese[index : index + 2]) for index in range(max(0, len(chinese) - 1)))
    features.extend(chinese)
    return features


def embed(text: str) -> list[float]:
    vector = [0.0] * DIMENSION
    for feature in _features(text):
        digest = hashlib.sha256(feature.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "big") % DIMENSION
        sign = 1.0 if digest[4] & 1 else -1.0
        vector[index] += sign
    norm = math.sqrt(sum(value * value for value in vector))
    return [value / norm for value in vector] if norm else vector
