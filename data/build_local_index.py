import argparse
import csv
import hashlib
import io
import json
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


ARCHIVE_NAMES = ("华为PC知识库(1).zip", "任德耀新建华为PC知识库.zip")
RUNTIME_DIRECTORY = Path(".collaboration/runtime/local-kb")
EXCLUDED_FACT_PREFIXES = ("00-", "90-", "99-", "P2-", "P3-", "P4-", "P5-", "P6-", "P8-")


def digest(content):
    return hashlib.sha256(content).hexdigest()


def read_text(content):
    return content.decode("utf-8-sig")


def rows_from(content):
    return list(csv.DictReader(io.StringIO(read_text(content))))


def normalize_model(value):
    return re.sub(r"[\s_（）()·-]+", "", value.casefold()).removeprefix("huawei")


def source_urls(text):
    return sorted(set(url.rstrip(".,;，。；") for url in re.findall(r"https?://[^\s<>\]\)\"|]+", text)))


def safe_entry(entry):
    path = PurePosixPath(entry)
    return not path.is_absolute() and ".." not in path.parts and "\\" not in entry and ":" not in entry


def confined_runtime(workspace):
    current = workspace
    for part in RUNTIME_DIRECTORY.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("运行目录含符号链接，停止写入")
    runtime = current.resolve()
    if not runtime.is_relative_to(workspace):
        raise ValueError("运行目录超出主工作区")
    runtime.mkdir(parents=True, exist_ok=True)
    return runtime


def write_atomic(path, content):
    if path.is_symlink() or path.with_suffix(path.suffix + ".tmp").is_symlink():
        raise ValueError("输出目标含符号链接，停止写入")
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(content)
    temporary.replace(path)


def document_kind(relative_entry):
    if relative_entry.startswith(EXCLUDED_FACT_PREFIXES):
        return None
    if relative_entry.startswith("P1-产品参数库/") and relative_entry.endswith("/产品事实.md"):
        return "product_fact"
    if relative_entry.startswith("P1-产品参数库/07-扩展产品目录/") and relative_entry.endswith(".md"):
        return "product_catalog"
    if "/08-官方公开价格快照/" in relative_entry and relative_entry.endswith("-价格卡.md"):
        return "public_price_snapshot"
    return None


def model_from(relative_entry, kind):
    if kind == "product_fact":
        return PurePosixPath(relative_entry).parent.name
    name = PurePosixPath(relative_entry).stem.removesuffix("-价格卡")
    return re.sub(r"^\d+-", "", name)


def load_archives(workspace):
    archives = []
    entries = {}
    unsafe = []
    for archive_name in ARCHIVE_NAMES:
        archive_path = workspace / archive_name
        if not archive_path.is_file():
            raise ValueError("缺少本地来源：" + archive_name)
        archive_info = {"alias": archive_name, "sha256": digest(archive_path.read_bytes()), "file_count": 0}
        with zipfile.ZipFile(archive_path, metadata_encoding="gbk") as archive:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                archive_info["file_count"] += 1
                if not safe_entry(info.filename):
                    unsafe.append({"archive_alias": archive_name, "entry": info.filename})
                    continue
                content = archive.read(info)
                entry_hash = digest(content)
                if info.filename in entries:
                    existing = entries[info.filename]
                    if existing["sha256"] != entry_hash:
                        raise ValueError("双库同路径内容冲突，停止构建：" + info.filename)
                    existing["archive_aliases"].append(archive_name)
                else:
                    entries[info.filename] = {"bytes": content, "sha256": entry_hash, "archive_aliases": [archive_name]}
        archives.append(archive_info)
    if unsafe:
        raise ValueError("ZIP 含不安全路径，停止构建")
    return archives, entries


def build(workspace):
    workspace = Path(workspace).resolve()
    runtime = confined_runtime(workspace)
    archives, entries = load_archives(workspace)
    roots = {entry.split("/", 1)[0] for entry in entries}
    if len(roots) != 1:
        raise ValueError("知识库根目录不唯一，停止构建")
    archive_root = next(iter(roots)) + "/"
    documents = []
    fact_directories = {}
    for entry, data in entries.items():
        relative_entry = entry.removeprefix(archive_root)
        kind = document_kind(relative_entry)
        if not kind:
            continue
        text = data["bytes"].decode("utf-8")
        model = model_from(relative_entry, kind)
        if kind == "product_fact":
            fact_directories[str(PurePosixPath(entry).parent)] = model
        documents.append({
            "id": "doc-" + digest(entry.encode("utf-8"))[:20],
            "kind": kind,
            "product_names": [model],
            "title": next((line.lstrip("# ") for line in text.splitlines() if line.startswith("# ")), model),
            "source": {"provider": "local_zip", "entry": entry, "entry_sha256": data["sha256"],
                       "archive_aliases": data["archive_aliases"], "urls": source_urls(text),
                       "text_location": {"start_line": 1, "end_line": len(text.splitlines()), "scope": "full_original_document"}},
            "text": text,
            "evidence_policy": "原文含全部脚注；须保留SKU、系统、时间与限定条件，未联网复核",
        })

    image_rows = {}
    combined_rows = []
    for entry, data in entries.items():
        if entry.endswith("/全部图片联合检索表.csv"):
            combined_rows = rows_from(data["bytes"])
        if not entry.endswith("/图片索引.csv"):
            continue
        parent = str(PurePosixPath(entry).parent)
        for row in rows_from(data["bytes"]):
            filename = row.get("文件名", "")
            for candidate in (parent + "/" + filename, parent + "/images/" + filename):
                if filename and candidate in entries:
                    image_rows.setdefault(candidate, []).append({"index_entry": entry, "row": row})

    images = []
    assets = runtime / "assets"
    if assets.is_symlink():
        raise ValueError("图片输出目录含符号链接")
    assets.mkdir(exist_ok=True)
    if not assets.resolve().is_relative_to(runtime):
        raise ValueError("图片目录超出运行目录")
    for entry, data in entries.items():
        suffix = PurePosixPath(entry).suffix.lower()
        if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
            continue
        mappings = image_rows.get(entry, [])
        declared_models = set()
        urls = set()
        pages = set()
        descriptions = set()
        source_indexes = []
        association_methods = set()
        for mapping in mappings:
            row = mapping["row"]
            source_indexes.append(mapping["index_entry"])
            if row.get("产品型号"):
                declared_models.add(row["产品型号"])
                association_methods.add("explicit_image_index")
            for field in ("原始图片URL",):
                if row.get(field):
                    urls.add(row[field])
            for field in ("来源页面", "页面来源"):
                if row.get(field):
                    pages.add(row[field])
            for field in ("官网图片说明", "画面说明"):
                if row.get(field):
                    descriptions.add(row[field])
        if not declared_models:
            for fact_directory, model in fact_directories.items():
                if entry.startswith(fact_directory + "/"):
                    declared_models.add(model)
                    association_methods.add("product_directory_association_requires_visual_review")
        target = assets / (data["sha256"] + suffix)
        write_atomic(target, data["bytes"])
        images.append({
            "id": "img-" + digest(entry.encode("utf-8"))[:20],
            "file_name": PurePosixPath(entry).name,
            "product_names": sorted(declared_models),
            "descriptions": sorted(descriptions),
            "local_path": str(target.relative_to(workspace)).replace("\\", "/"),
            "source": {"provider": "local_zip", "entry": entry, "entry_sha256": data["sha256"],
                       "archive_aliases": data["archive_aliases"], "urls": sorted(urls),
                       "page_urls": sorted(pages), "index_entries": sorted(set(source_indexes))},
            "model_association": sorted(association_methods),
            "model_verified": False,
            "usable_as_verified_product_image": False,
            "review_required": "本地图可供人工核对；目录或索引关联不等于画面/配色/SKU与版权核验",
        })

    price_entry = archive_root + "P1-产品参数库/08-官方公开价格快照/官方价格快照.csv"
    price_data = entries[price_entry]
    price_records = [{"provider": "local_zip", "raw_fields": row, "source_entry": price_entry,
                      "source_entry_sha256": price_data["sha256"],
                      "archive_aliases": price_data["archive_aliases"],
                      "is_current_transaction_quote": False,
                      "status": "historical_snapshot_requires_reverification"}
                     for row in rows_from(price_data["bytes"])]
    counts = {kind: sum(document["kind"] == kind for document in documents)
              for kind in ("product_fact", "product_catalog", "public_price_snapshot")}
    quality = {
        "deduplicated_file_count": len(entries),
        "archive_file_counts": [archive["file_count"] for archive in archives],
        "archives_byte_identical": len({archive["sha256"] for archive in archives}) == 1,
        "same_entry_same_hash_count": sum(len(entry["archive_aliases"]) == len(archives) for entry in entries.values()),
        "document_counts": counts,
        "image_count": len(images),
        "images_without_declared_product": sum(not image["product_names"] for image in images),
        "images_without_source_url": sum(not image["source"]["urls"] for image in images),
        "combined_index_rows": len(combined_rows),
        "combined_index_empty_model_rows": sum(not row.get("产品型号") for row in combined_rows),
        "combined_index_empty_description_rows": sum(not row.get("画面说明") for row in combined_rows),
        "price_records": len(price_records),
        "price_records_with_amount": sum(bool(record["raw_fields"].get("页面金额（元）")) for record in price_records),
        "all_original_text_hashes_match": all(digest(document["text"].encode("utf-8")) == document["source"]["entry_sha256"] for document in documents),
        "fact_exclusions": ["P4受控空模板", "待审与历史资料", "竞品", "软文和平台案例", "虚构教学案例", "索引摘要"],
    }
    index = {
        "schema_version": 1,
        "mode": "offline_local_zip",
        "knowledge_status": "offline_only",
        "ima_connected": False,
        "competition_compliance_verified": False,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "source_archives": archives,
        "documents": documents,
        "images": images,
        "price_records": price_records,
        "pricing_rules": {"status": "blocked", "reason": "本地库无获授权的真实四级价格组合规则；P4为20份空模板",
                          "missing": ["四级定义与各级数值", "适用SKU/身份/地区/渠道", "计算顺序", "互斥与叠加", "上限与舍入", "税费口径", "有效期与授权审批"]},
        "quality": quality,
    }
    index_path = runtime / "index.json"
    write_atomic(index_path, json.dumps(index, ensure_ascii=False, indent=2).encode("utf-8"))
    return {"status": "ok", "index_path": str(index_path), "mode": index["mode"], "knowledge_status": "offline_only",
            "ima_connected": False, "quality": quality, "pricing_rules": index["pricing_rules"]}


def query(workspace, product, limit=4, include_prices=False):
    workspace = Path(workspace).resolve()
    if not product.strip():
        raise ValueError("产品型号不能为空")
    if not 1 <= limit <= 20:
        raise ValueError("limit须在1至20之间")
    index_path = workspace / RUNTIME_DIRECTORY / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    product_key = normalize_model(product)
    matches = [document for document in index["documents"]
               if (include_prices or document["kind"] != "public_price_snapshot")
               and any(normalize_model(name) == product_key for name in document["product_names"])]
    matches.sort(key=lambda document: {"product_fact": 0, "product_catalog": 1, "public_price_snapshot": 2}[document["kind"]])
    images = [image for image in index["images"]
              if any(normalize_model(name) == product_key for name in image["product_names"])]
    return {"status": "ok" if matches else "not_found", "mode": "offline_local_zip", "knowledge_status": "offline_only", "ima_connected": False,
            "competition_compliance_verified": False, "product": product,
            "documents": matches[:limit], "image_candidates": images[:20],
            "verified_images": [],
            "price_records": [record for record in index["price_records"]
                              if include_prices and normalize_model(record["raw_fields"].get("规范产品名称", "")) == product_key],
            "pricing_rules": index["pricing_rules"],
            "notice": "离线原文证据；图片仅为待人工核验候选，价格为带时点快照，未完成官方ima检索"}


def main():
    parser = argparse.ArgumentParser(description="双ZIP本地证据索引，仅写入忽略的本机运行目录")
    commands = parser.add_subparsers(dest="command", required=True)
    build_parser = commands.add_parser("build")
    build_parser.add_argument("--workspace", default=str(Path(__file__).resolve().parents[1]))
    query_parser = commands.add_parser("query")
    query_parser.add_argument("--workspace", default=str(Path(__file__).resolve().parents[1]))
    query_parser.add_argument("--product", required=True)
    query_parser.add_argument("--limit", type=int, default=4)
    query_parser.add_argument("--include-prices", action="store_true")
    arguments = parser.parse_args()
    try:
        result = build(arguments.workspace) if arguments.command == "build" else query(
            arguments.workspace, arguments.product, arguments.limit, arguments.include_prices)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, ValueError, KeyError, UnicodeError, zipfile.BadZipFile) as error:
        print(json.dumps({"status": "error", "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
