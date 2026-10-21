#!/usr/bin/env python3
"""Extract auditable text from IMA media snapshots using stdlib-first rules."""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

TEXT_EXTENSIONS = {".md", ".markdown", ".txt", ".csv", ".json", ".xml", ".yaml", ".yml", ".log"}
HTML_EXTENSIONS = {".html", ".htm"}
BINARY_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg",
    ".mp3", ".m4a", ".wav", ".aac", ".mp4", ".mov", ".avi",
    ".zip", ".epub",
}


def decode_bytes(data: bytes) -> tuple[str, str]:
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "big5"):
        try:
            return data.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace"), "utf-8-replace"


def html_to_text(value: str) -> str:
    value = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", value)
    value = re.sub(r"(?i)<br\s*/?>", "\n", value)
    value = re.sub(r"(?i)</(?:p|div|li|h[1-6]|tr|table)>", "\n", value)
    value = re.sub(r"(?s)<[^>]+>", " ", value)
    value = html.unescape(value)
    value = re.sub(r"[ \t\f\v]+", " ", value)
    value = re.sub(r"\n[ \t]+", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def xml_text(blob: bytes) -> str:
    try:
        root = ET.fromstring(blob)
    except ET.ParseError:
        return ""
    values = [node.text or "" for node in root.iter() if node.tag.endswith("}t") or node.tag.endswith("}v")]
    return "\n".join(value.strip() for value in values if value and value.strip())


def extract_docx(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    lines: list[str] = []
    for paragraph in root.iter():
        if not paragraph.tag.endswith("}p"):
            continue
        pieces = [node.text or "" for node in paragraph.iter() if node.tag.endswith("}t")]
        line = "".join(pieces).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def extract_pptx(path: Path) -> str:
    chunks: list[str] = []
    with zipfile.ZipFile(path) as archive:
        slides = sorted(
            name for name in archive.namelist()
            if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)
        )
        for name in slides:
            text = xml_text(archive.read(name))
            if text:
                chunks.append(f"[{Path(name).stem}]\n{text}")
    return "\n\n".join(chunks)


def extract_xlsx(path: Path) -> str:
    chunks: list[str] = []
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        if "xl/sharedStrings.xml" in names:
            shared = xml_text(archive.read("xl/sharedStrings.xml"))
            if shared:
                chunks.append("[sharedStrings]\n" + shared)
        for name in sorted(item for item in names if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", item)):
            sheet = archive.read(name)
            text = xml_text(sheet)
            if text:
                chunks.append(f"[{Path(name).stem}]\n{text}")
    return "\n\n".join(chunks)


def extract_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader  # type: ignore
    except Exception as exc:
        raise RuntimeError("PDF_EXTRACTOR_UNAVAILABLE") from exc
    reader = PdfReader(str(path))
    pages: list[str] = []
    for index, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        if text:
            pages.append(f"[page {index}]\n{text}")
    return "\n\n".join(pages)


def extract(path: Path, mime_type: str, max_chars: int) -> dict[str, object]:
    suffix = path.suffix.lower()
    if suffix in BINARY_EXTENSIONS or mime_type.startswith(("image/", "audio/", "video/")):
        return {"status": "binary_only", "extractor": None, "text": "", "char_count": 0, "truncated": False}
    if suffix == ".pdf" or mime_type == "application/pdf":
        text, extractor = extract_pdf(path), "pypdf"
    elif suffix == ".docx":
        text, extractor = extract_docx(path), "docx-xml"
    elif suffix == ".pptx":
        text, extractor = extract_pptx(path), "pptx-xml"
    elif suffix in {".xlsx", ".xlsm"}:
        text, extractor = extract_xlsx(path), "xlsx-xml"
    elif suffix in HTML_EXTENSIONS or mime_type.startswith("text/html"):
        raw, encoding = decode_bytes(path.read_bytes())
        text, extractor = html_to_text(raw), f"html-stdlib/{encoding}"
    elif suffix in TEXT_EXTENSIONS or mime_type.startswith("text/"):
        raw, encoding = decode_bytes(path.read_bytes())
        text, extractor = raw, f"text/{encoding}"
    else:
        data = path.read_bytes()
        if b"\x00" in data[:4096]:
            return {"status": "binary_only", "extractor": None, "text": "", "char_count": 0, "truncated": False}
        raw, encoding = decode_bytes(data)
        text, extractor = raw, f"fallback-text/{encoding}"
    truncated = len(text) > max_chars
    if truncated:
        text = text[:max_chars]
    return {
        "status": "ok" if text.strip() else "empty",
        "extractor": extractor,
        "text": text,
        "char_count": len(text),
        "truncated": truncated,
    }


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    parser.add_argument("--mime-type", default="application/octet-stream")
    parser.add_argument("--max-chars", type=int, default=5_000_000)
    args = parser.parse_args()
    try:
        result = extract(Path(args.path), args.mime_type, max(1, args.max_chars))
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"status": "failed", "error": str(exc), "text": "", "char_count": 0, "truncated": False}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())


