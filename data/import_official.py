import argparse
import copy
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath

sys.dont_write_bytecode = True

from fetch_official import TextParser, verified_identity, TARGETS


MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_PACKAGE_BYTES = 64 * 1024 * 1024
SPEC_TARGETS = {item[0]: item for item in TARGETS if item[0].endswith("-specs")}
MANIFEST_PATH = "data/official/manifest.json"
HASH_PATTERN = re.compile(r"[a-f0-9]{64}")
FIELD_LABELS = {
    "display_resolution": "分辨率", "memory_options": "内存", "storage": "存储",
    "storage_options": "存储", "processor_options": "处理器", "processor": "处理器",
    "operating_system_options": "操作系统", "operating_system": "操作系统",
}
NEXT_LABELS = {
    "display_resolution": ("亮度", "刷新率"), "memory_options": ("无线连接",),
    "storage": ("显卡", "内存"), "storage_options": ("内存",),
    "processor_options": ("存储",), "processor": ("存储",),
    "operating_system_options": ("尺寸与重量",), "operating_system": ("尺寸与重量",),
}


def sha256(contents):
    return hashlib.sha256(contents).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def reject_links(path):
    path = Path(os.path.abspath(path))
    for component in [*reversed(path.parents), path]:
        if component.exists() or component.is_symlink():
            metadata = component.lstat()
            require(not stat.S_ISLNK(metadata.st_mode)
                    and not getattr(metadata, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400),
                    "路径包含符号链接或重解析点")
    return path


def safe_path(root, relative):
    require(isinstance(relative, str) and relative and "\\" not in relative and ":" not in relative
            and not any(ord(character) < 32 for character in relative), "证据路径格式不安全")
    components = PurePosixPath(relative)
    require(not components.is_absolute() and all(part not in ("", ".", "..") for part in relative.split("/")), "证据路径越界")
    path = reject_links(root / relative)
    require(path.is_relative_to(root), "证据路径越界")
    return path


def read_limited(path):
    reject_links(path)
    require(path.is_file() and path.stat().st_size <= MAX_FILE_BYTES, "文件缺失、非普通文件或超过8MiB")
    with path.open("rb") as source:
        contents = source.read(MAX_FILE_BYTES + 1)
    require(len(contents) <= MAX_FILE_BYTES, "文件超过8MiB")
    return contents


def parse_json(contents):
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "JSON含重复字段")
            result[key] = value
        return result
    return json.loads(contents.decode("utf-8-sig"), object_pairs_hook=unique_pairs,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError("JSON含非有限数值")))


def parse_timestamp(value):
    require(isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", value), "抓取时间必须为带时区ISO时间")
    if not value.endswith("Z"):
        offset_hour, offset_minute = map(int, value[-5:].split(":"))
        require(offset_hour <= 14 and offset_minute <= 59 and (offset_hour != 14 or offset_minute == 0), "时区偏移无效")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(parsed.utcoffset() is not None and abs(parsed.utcoffset()) <= timedelta(hours=14), "时区无效")
    return parsed.astimezone(timezone.utc)


def field_value(name, excerpt):
    lines = excerpt.splitlines()
    require(lines and lines[0] == FIELD_LABELS.get(name) and len(lines) >= 2, "字段摘录缺少对应原文标签")
    body = [line for line in lines[1:] if line and not line.startswith("*")]
    require(bool(body), "字段没有有效值")
    if name == "display_resolution":
        match = re.match(r"(\d+ × \d+)(?:，|,|$)", body[0])
        require(match is not None, "分辨率原文格式未受支持")
        return match.group(1), None
    if name == "memory_options":
        require(len(body) == 1 and re.fullmatch(r"\d+ GB(?: / \d+ GB)*", body[0]), "内存原文格式未受支持")
        return [int(value) for value in re.findall(r"\d+", body[0])], "GB"
    if name == "storage_options":
        require(len(body) == 1 and re.fullmatch(r"\d+ (?:GB|TB)(?: / \d+ (?:GB|TB))*", body[0]), "存储选项原文格式未受支持")
        return body[0].split(" / "), None
    if name == "processor_options":
        require(all(re.fullmatch(r"英特尔® 酷睿™ (Ultra \d+ [A-Za-z0-9]+) 处理器", line) for line in body), "处理器原文格式未受支持")
        return ["Intel Core " + re.fullmatch(r"英特尔® 酷睿™ (Ultra \d+ [A-Za-z0-9]+) 处理器", line).group(1) for line in body], None
    if name == "processor":
        require(len(body) == 2 and body[0] == "CPU" and re.fullmatch(r"麒麟 [A-Za-z0-9]+", body[1]), "处理器原文格式未受支持")
        return body[1], None
    if name == "storage":
        require(len(body) == 1 and re.fullmatch(r"\d+ (?:GB|TB) NVMe PCIe SSD", body[0]), "存储原文格式未受支持")
        return body[0], None
    if name == "operating_system_options":
        require(all(re.fullmatch(r"(?:Windows \d+ 家庭版|Linux V\d+ 版)", line) for line in body), "系统选项原文格式未受支持")
        return body, None
    require(name == "operating_system" and len(body) == 1 and re.fullmatch(r"HarmonyOS \d+(?:\.\d+)*", body[0]), "系统原文格式未受支持")
    return body[0], None


def validate_entry(entry, package, now):
    require(isinstance(entry, dict) and entry.get("id") in SPEC_TARGETS, "来源不在两条规格页精确白名单")
    target = SPEC_TARGETS[entry["id"]]
    require(entry.get("url") == target[1] and entry.get("final_url") == target[1]
            and entry.get("product") == target[2] and entry.get("source_type") == "huawei_official", "官网URL或完整代际型号不匹配")
    require(entry.get("fetch_status") == "ok" and type(entry.get("http_status")) is int
            and entry["http_status"] == 200 and entry.get("model_identity_verified") is True, "候选不是已获取且已核验规格证据")
    require(entry.get("sku") is None and entry.get("configuration") == {} and entry.get("price") is None
            and entry.get("starting_price") is None and entry.get("images") == []
            and entry.get("is_current_transaction_quote") is False, "首版仅导入型号规格，拒绝SKU、金额、配置报价和图片")
    fetched = parse_timestamp(entry.get("fetched_at"))
    require(fetched <= now and now - fetched <= timedelta(days=7), "抓取时间在未来或超过7天")
    assets = {}
    for kind in ("raw", "text"):
        expected = entry.get(kind + "_sha256")
        require(isinstance(expected, str) and HASH_PATTERN.fullmatch(expected), "证据SHA256格式无效")
        contents = read_limited(safe_path(package, entry.get(kind + "_path")))
        require(sha256(contents) == expected, "证据内容哈希不符")
        assets[kind] = contents
    raw_html = assets["raw"].decode("utf-8-sig")
    parser = TextParser()
    parser.feed(raw_html)
    text = assets["text"].decode("utf-8-sig")
    require(text.strip() and text == entry.get("text") and text == "\n".join(parser.parts), "原HTML、提取文本与候选text不一致")
    title_match = re.search(r"<title[^>]*>(.*?)</title>", raw_html, re.S | re.I)
    title = title_match.group(1).strip() if title_match else ""
    require(title == entry.get("title") and verified_identity(target, entry["final_url"], title, text), "原始页面代际身份不匹配")
    fields = entry.get("fields")
    require(isinstance(fields, list) and 1 <= len(fields) <= 8, "至少需要一条可核验字段，最多8条")
    names = set()
    allowed_names = ({"display_resolution", "memory_options", "storage", "processor_options", "operating_system_options"}
                     if entry["id"] == "matebook-14-2024-specs" else
                     {"display_resolution", "memory_options", "storage_options", "processor", "operating_system"})
    for field in fields:
        require(isinstance(field, dict) and field.get("name") in allowed_names
                and field["name"] not in names, "字段未知或重复")
        names.add(field["name"])
        excerpt = field.get("excerpt")
        require(isinstance(excerpt, str) and excerpt.strip() and excerpt in text, "字段原文摘录为空或不存在")
        offset = text.find(excerpt)
        require(offset == 0 or text[offset - 1] == "\n", "摘录不是完整字段起点")
        end = offset + len(excerpt)
        require(end == len(text) or text[end] == "\n", "摘录截断字段原文")
        require(not text[end:].startswith("\n*"), "摘录遗漏紧邻脚注")
        require(any(text[end:].startswith("\n" + label + "\n") for label in NEXT_LABELS[field["name"]]), "摘录未到达受审字段边界，可能遗漏值或限定条件")
        value, unit = field_value(field["name"], excerpt)
        require(json.dumps(field.get("value"), ensure_ascii=False) == json.dumps(value, ensure_ascii=False)
                and field.get("unit") == unit, "字段值不是从本次原文解析所得")
        require(field.get("scope") == "model" and field.get("sku") is None and field.get("configuration") == {}, "字段不得冒充SKU规格")
        pointer = field.get("source_pointer")
        require(isinstance(pointer, dict) and pointer.get("path") == entry["text_path"]
                and pointer.get("sha256") == entry["text_sha256"] and type(pointer.get("start")) is int
                and type(pointer.get("end")) is int and pointer["start"] == offset and pointer["end"] == end, "字段定位不一致")
    result = copy.deepcopy(entry)
    for kind, extension in (("raw", "html"), ("text", "txt")):
        result[kind + "_path"] = "data/official/imported/" + entry[kind + "_sha256"] + "." + extension
    for field in result["fields"]:
        field["source_pointer"]["path"] = result["text_path"]
    return result, {result[kind + "_path"]: assets[kind] for kind in assets}


def check_conflicts(previous, candidates):
    seen = {}
    for entry in previous + candidates:
        if entry.get("fetch_status") != "ok" or entry.get("model_identity_verified") is not True:
            continue
        for field in entry.get("fields", []):
            key = (entry.get("product"), field.get("name"), field.get("scope"), field.get("sku"))
            value = json.dumps([field.get("value"), field.get("unit")], ensure_ascii=False, sort_keys=True)
            require(key not in seen or seen[key] == value, "同型号旧字段与候选冲突，需独立审核，不自动选择新值")
            seen[key] = value


def node_validate(workspace, stage, manifest_relative, products, required_products):
    module = workspace / "backend/marketing/official.js"
    support = workspace / "backend/marketing/support.js"
    require(module.is_file() and support.is_file(), "缺少现有Node官方资料业务校验模块")
    script = """const support=require(process.argv[1]);support.ROOT=process.argv[3];const api=require(process.argv[2]);const products=JSON.parse(process.argv[5]);const required=JSON.parse(process.argv[6]);const report=products.map(product=>api.loadOfficialReference(product,null,{manifestPath:process.argv[4]}));const bad=report.some(item=>item.diagnostics.some(error=>['OFFICIAL_SPEC_CONFLICT','OFFICIAL_PRICE_CONFLICT','OFFICIAL_EVIDENCE_INVALID','OFFICIAL_MANIFEST_UNAVAILABLE'].includes(error.code))||(required.includes(item.product)&&item.status!=='verified_model_snapshot'));process.stdout.write(JSON.stringify({ok:!bad,report:report.map(item=>({product:item.product,status:item.status,diagnostics:item.diagnostics,specifications:item.specifications.length}))}));process.exitCode=bad?1:0;"""
    result = subprocess.run(["node", "-e", script, str(support), str(module), str(stage), manifest_relative,
                             json.dumps(products, ensure_ascii=False), json.dumps(required_products, ensure_ascii=False)], capture_output=True, text=True, encoding="utf-8", timeout=30)
    require(result.returncode == 0, "现有Node业务校验拒绝合并候选")
    return json.loads(result.stdout)


def immutable_write(path, contents):
    reject_links(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    reject_links(path.parent)
    if path.exists():
        require(read_limited(path) == contents, "不可变内容地址已存在不同字节，拒绝覆盖")
        return
    with path.open("xb") as target:
        target.write(contents)
        target.flush()
        os.fsync(target.fileno())


def import_package(package, workspace, apply=False):
    workspace = reject_links(workspace)
    package = reject_links(package)
    require(package.is_dir(), "证据包目录不存在")
    candidate_bytes = read_limited(safe_path(package, "manifest.json"))
    candidate = parse_json(candidate_bytes)
    require(isinstance(candidate, dict), "候选manifest须为JSON对象")
    authorization = candidate.get("authorization")
    require(isinstance(authorization, dict) and authorization.get("declared_authorized") is True
            and authorization.get("scope") == "local_reference"
            and all(isinstance(authorization.get(key), str) and 1 <= len(authorization[key].strip()) <= 500
                    for key in ("provided_by", "reference")), "须提供本地使用授权声明与责任人/依据；声明不等于独立核验授权")
    incoming = candidate.get("entries")
    require(isinstance(incoming, list) and 1 <= len(incoming) <= 2, "候选须含1至2条受审规格页")
    live_path = safe_path(workspace, MANIFEST_PATH)
    old_bytes = read_limited(live_path)
    previous = parse_json(old_bytes)
    require(isinstance(previous, dict) and isinstance(previous.get("entries"), list)
            and all(isinstance(entry, dict) for entry in previous["entries"]), "原manifest结构无效，保留原文件")
    old_hash = sha256(old_bytes)
    now = datetime.now(timezone.utc)
    entries = []
    assets = {}
    for entry in incoming:
        verified, evidence = validate_entry(entry, package, now)
        require(verified["id"] not in {item["id"] for item in entries}, "候选来源ID重复")
        entries.append(verified)
        assets.update(evidence)
    require(sum(len(content) for content in assets.values()) <= MAX_PACKAGE_BYTES, "候选证据超过64MiB")
    check_conflicts(previous["entries"], entries)
    replaced_ids = {entry["id"] for entry in entries}
    merged = copy.deepcopy(previous)
    merged["entries"] = [entry for entry in previous["entries"] if entry.get("id") not in replaced_ids] + entries
    merged["safe_import"] = {"at": now.isoformat(), "input_manifest_sha256": sha256(candidate_bytes),
                             "authorization_declaration": authorization, "network_requests": 0,
                             "notice": "操作者授权声明不是独立权利核验；仅更新规格，未导入价格、SKU或图片"}
    merged_bytes = (json.dumps(merged, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    require(len(merged_bytes) <= MAX_FILE_BYTES, "合并清单超过8MiB")
    with tempfile.TemporaryDirectory(prefix="huawei-official-validation-") as temporary:
        stage = Path(temporary)
        staged_assets = dict(assets)
        for entry in merged["entries"]:
            if entry.get("fetch_status") != "ok":
                continue
            for kind in ("raw", "text"):
                relative = entry.get(kind + "_path")
                if relative not in staged_assets:
                    content = read_limited(safe_path(workspace, relative))
                    require(sha256(content) == entry.get(kind + "_sha256"), "既有成功证据哈希不符，保留原清单")
                    staged_assets[relative] = content
        require(sum(len(content) for content in staged_assets.values()) <= MAX_PACKAGE_BYTES, "合并证据超过64MiB")
        for relative, content in staged_assets.items():
            staged_path = safe_path(stage, relative)
            staged_path.parent.mkdir(parents=True, exist_ok=True)
            staged_path.write_bytes(content)
        staged_manifest = safe_path(stage, MANIFEST_PATH)
        staged_manifest.parent.mkdir(parents=True, exist_ok=True)
        staged_manifest.write_bytes(merged_bytes)
        products = sorted({entry["product"] for entry in merged["entries"] if entry.get("product")})
        node_result = node_validate(workspace, stage, MANIFEST_PATH, products, [entry["product"] for entry in entries])
    result = {"status": "validated", "applied": False, "mode": "dry_run", "network_requests": 0,
              "previous_manifest_sha256": old_hash, "candidate_manifest_sha256": sha256(merged_bytes),
              "candidate_entries": len(entries), "node_validation": node_result,
              "notice": "仅规格更新；真实报价、图片权利与官方四级政策未解决"}
    if not apply:
        return result
    lock_path = safe_path(workspace, "data/official/.import.lock")
    lock_descriptor = os.open(lock_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    temporary_manifest = None
    try:
        os.close(lock_descriptor)
        require(read_limited(live_path) == old_bytes, "活动manifest已被其他进程改变，停止切换")
        for relative, contents in assets.items():
            immutable_write(safe_path(workspace, relative), contents)
        backup = safe_path(workspace, ".collaboration/runtime/official-import-backups/" + old_hash + ".json")
        immutable_write(backup, old_bytes)
        descriptor, temporary_name = tempfile.mkstemp(prefix=".manifest-", suffix=".tmp", dir=live_path.parent)
        temporary_manifest = Path(temporary_name)
        with os.fdopen(descriptor, "wb") as output:
            output.write(merged_bytes)
            output.flush()
            os.fsync(output.fileno())
        require(read_limited(live_path) == old_bytes, "切换前活动manifest变化，停止切换")
        reject_links(live_path)
        os.replace(temporary_manifest, live_path)
        temporary_manifest = None
        result.update(status="applied", applied=True, mode="apply", backup_path=backup.relative_to(workspace).as_posix())
        return result
    finally:
        if temporary_manifest is not None:
            temporary_manifest.unlink(missing_ok=True)
        lock_path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description="授权离线官网规格证据包：默认只验证；不联网、不导入价格/SKU/图片")
    parser.add_argument("--package", required=True, type=Path)
    parser.add_argument("--workspace", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--apply", action="store_true")
    arguments = parser.parse_args()
    try:
        result = import_package(arguments.package, arguments.workspace, arguments.apply)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError) as error:
        print(json.dumps({"status": "rejected", "applied": False, "error": str(error), "network_requests": 0}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
