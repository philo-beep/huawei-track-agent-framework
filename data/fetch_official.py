import argparse
import concurrent.futures
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path


TARGETS = [
    ("vmall-home", "https://www.vmall.com/", None),
    ("matebook-14-2024", "https://consumer.huawei.com/cn/laptops/matebook-14-2024/", "HUAWEI MateBook 14 2024"),
    ("matebook-14-2024-specs", "https://consumer.huawei.com/cn/laptops/matebook-14-2024/specs/", "HUAWEI MateBook 14 2024"),
    ("vmall-matebook-14-2024", "https://www.vmall.com/product/comdetail/index.html?prdId=10086627212823&cid=278821", "HUAWEI MateBook 14 2024"),
    ("matebook-14-harmonyos", "https://consumer.huawei.com/cn/harmonyos-computer/matebook-14-harmonyos-version/", "HUAWEI MateBook 14 鸿蒙版"),
    ("matebook-14-harmonyos-specs", "https://consumer.huawei.com/cn/harmonyos-computer/matebook-14-harmonyos-version/specs/", "HUAWEI MateBook 14 鸿蒙版"),
    ("vmall-matebook-14-harmonyos", "https://www.vmall.com/product/comdetail/index.html?prdId=10086097339191&sbomCode=2801010196907&cid=381499", "HUAWEI MateBook 14 鸿蒙版"),
]


class TextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.hidden:
            self.hidden -= 1

    def handle_data(self, data):
        if not self.hidden and data.strip():
            self.parts.append(re.sub(r"\s+", " ", data.strip()))


def allowed(url):
    try:
        parsed = urllib.parse.urlsplit(url)
        return (parsed.scheme == "https" and parsed.username is None and parsed.password is None
                and parsed.port in (None, 443)
                and parsed.hostname in ("www.vmall.com", "vmall.com", "m.vmall.com", "item.vmall.com", "consumer.huawei.com"))
    except ValueError:
        return False


def verified_identity(target, final_url, title, text):
    source_id, url, product = target
    expected = next((item for item in TARGETS if item[0] == source_id), None)
    if expected != target or not product or not allowed(final_url):
        return False
    requested = urllib.parse.urlsplit(url)
    received = urllib.parse.urlsplit(final_url)
    if requested.hostname != "consumer.huawei.com" or received.hostname != requested.hostname or received.path != requested.path:
        return False
    if "MateBook 14" not in title:
        return False
    if source_id.startswith("matebook-14-2024"):
        return "酷睿 Ultra" in title and "英特尔" in text
    if source_id.startswith("matebook-14-harmonyos"):
        if "酷睿" in title or "Ultra" in title or "HarmonyOS" not in text:
            return False
        return source_id != "matebook-14-harmonyos-specs" or ("HarmonyOS 6" in text and "麒麟 X90" in text)
    return False


class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, newurl):
        if not allowed(newurl):
            raise ValueError("重定向超出授权官网域名")
        return super().redirect_request(request, response, code, message, headers, newurl)


def fetch_one(target, workspace, output):
    source_id, url, product = target
    if not allowed(url) or not re.fullmatch(r"[a-zA-Z0-9_-]+", source_id):
        raise ValueError("来源标识或网址不合法")
    record = {
        "id": source_id, "source_type": "vmall_official" if "vmall.com" in url else "huawei_official",
        "url": url, "final_url": None, "fetched_at": None, "fetch_status": "failed", "http_status": None,
        "raw_path": None, "raw_sha256": None, "text_path": None, "text_sha256": None,
        "product": product, "product_family": "HUAWEI MateBook 14" if product else None,
        "model_identity_verified": False, "sku": None, "configuration": {}, "text": "", "fields": [], "price": None,
        "images": [], "starting_price": None, "is_current_transaction_quote": False,
        "limitations": ["仅为获取时点的公开网页快照，不代表实时库存或可成交价格；正式报价需精确SKU与配置、有效期、适用条件。"],
        "attempts": [],
    }
    opener = urllib.request.build_opener(OfficialRedirect())
    for attempt in range(2):
        record["fetched_at"] = datetime.now(timezone.utc).isoformat()
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", "Accept": "text/html,application/json"})
            with opener.open(request, timeout=25) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
                if len(raw) > 8 * 1024 * 1024:
                    raise ValueError("公开页面超过8MiB限制")
                record.update(http_status=response.status, final_url=response.url, content_type=response.headers.get("Content-Type"))
            digest = hashlib.sha256(raw).hexdigest()
            raw_path = output / "raw" / f"{source_id}-{digest[:16]}.html"
            raw_path.parent.mkdir(parents=True, exist_ok=True)
            raw_path.write_bytes(raw)
            html = raw.decode("utf-8-sig", errors="replace")
            parser = TextParser()
            parser.feed(html)
            text = "\n".join(parser.parts)
            text_path = raw_path.with_suffix(".txt")
            text_path.write_bytes(text.encode("utf-8"))
            title = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.S | re.I)
            record.update(fetch_status="ok", raw_path=raw_path.relative_to(workspace).as_posix(), raw_sha256=digest,
                          text_path=text_path.relative_to(workspace).as_posix(), text_sha256=hashlib.sha256(text.encode()).hexdigest(),
                          title=title.group(1).strip() if title else None, text=text)
            record["model_identity_verified"] = verified_identity(target, response.url, record["title"] or "", text)
            if product and not record["model_identity_verified"]:
                record["limitations"].append("未通过目标代际、最终官方路径与原文身份特征一致性核验；不输出参数字段或价格。")
            if record["model_identity_verified"] and source_id in ("matebook-14-2024-specs", "matebook-14-harmonyos-specs"):
                definitions = [
                    ("display_resolution", "2880 × 1920", None, "分辨率\n2880 × 1920，243 ppi"),
                    ("memory_options", [16, 24, 32], "GB", "内存\n16 GB / 24 GB / 32 GB"),
                    ("storage", "1 TB NVMe PCIe SSD", None, "存储\n1 TB NVMe PCIe SSD\n*硬盘格式化之后的实际容量可能较小。"),
                    ("processor_options", ["Intel Core Ultra 7 155H", "Intel Core Ultra 5 125H"], None,
                     "处理器\n英特尔® 酷睿™ Ultra 7 155H 处理器\n*仅限 Windows 版本产品搭载。\n英特尔® 酷睿™ Ultra 5 125H 处理器"),
                    ("operating_system_options", ["Windows 11 家庭版", "Linux V20 版"], None, "操作系统\nWindows 11 家庭版\nLinux V20 版"),
                ]
                if source_id == "matebook-14-harmonyos-specs":
                    definitions = [
                        ("display_resolution", "2880 × 1920", None, "分辨率\n2880 × 1920，243 PPI"),
                        ("memory_options", [24, 32], "GB", "内存\n24 GB / 32 GB"),
                        ("storage_options", ["512 GB", "1 TB"], None, "存储\n512 GB / 1 TB"),
                        ("processor", "麒麟 X90", None, "处理器\nCPU\n麒麟 X90"),
                        ("operating_system", "HarmonyOS 6", None, "操作系统\nHarmonyOS 6"),
                    ]
                for name, value, unit, excerpt in definitions:
                    offset = text.find(excerpt)
                    if offset < 0:
                        record["limitations"].append(f"未在本次正文定位字段{name}，未输出该参数")
                        continue
                    record["fields"].append({"name": name, "value": value, "unit": unit, "excerpt": excerpt,
                                             "scope": "model", "sku": None, "configuration": {},
                                             "source_pointer": {"path": record["text_path"], "sha256": record["text_sha256"],
                                                                "start": offset, "end": offset + len(excerpt)}})
                record["limitations"].append("参数仅为本页产品系列选项，不能将各选项任意排列成已在售SKU；不同操作系统与销售版本功能可能存在差异。")
            record["attempts"].append({"attempt": attempt + 1, "status": "ok", "at": record["fetched_at"]})
            break
        except Exception as error:
            record["attempts"].append({"attempt": attempt + 1, "status": "failed", "at": record["fetched_at"], "error": f"{type(error).__name__}: {error}"})
            if attempt == 0:
                time.sleep(1)
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--targets", type=Path)
    parser.add_argument("--output", default="data/official", type=Path)
    parser.add_argument("--merge", action="store_true")
    parser.add_argument("--normalize-text", action="store_true")
    args = parser.parse_args()
    workspace = Path(__file__).resolve().parents[1]
    output = (workspace / args.output).resolve()
    if not output.is_relative_to(workspace / "data"):
        raise ValueError("只能写入工作区data目录")
    if args.normalize_text:
        manifest_path = output / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for entry in manifest["entries"]:
            if entry["fetch_status"] != "ok":
                entry["model_identity_verified"] = False
                continue
            text_path = (workspace / entry["text_path"]).resolve()
            if not text_path.is_relative_to(output):
                raise ValueError("正文路径越界")
            raw = (workspace / entry["raw_path"]).read_bytes()
            if hashlib.sha256(raw).hexdigest() != entry["raw_sha256"]:
                raise ValueError("原始网页指纹不符")
            text_path.write_bytes(entry["text"].encode("utf-8"))
            entry["text_sha256"] = hashlib.sha256(text_path.read_bytes()).hexdigest()
            for field in entry["fields"]:
                field["source_pointer"]["sha256"] = entry["text_sha256"]
        manifest["text_normalization"] = "UTF-8 bytes, LF; source offsets are Unicode code points in text"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("已离线规范正文换行并核对原始指纹；未联网、未改变抓取时点")
        return
    targets = TARGETS
    if args.targets:
        targets = [(item["id"], item["url"], item.get("product")) for item in json.loads(args.targets.read_text(encoding="utf-8-sig"))]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        entries = list(executor.map(lambda target: fetch_one(target, workspace, output), targets))
    output.mkdir(parents=True, exist_ok=True)
    if args.merge and (output / "manifest.json").exists():
        previous = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
        replaced = {item["id"] for item in entries}
        entries = [item for item in previous["entries"] if item["id"] not in replaced] + entries
    manifest = {"schema_version": 1, "mode": "official_public_snapshot", "ima_required": False, "ima_requests": 0,
                "generated_at": datetime.now(timezone.utc).isoformat(), "entries": entries,
                "primary_local_archive": "任德耀新建华为PC知识库.zip", "pricing_status": "needs_exact_sku_verification"}
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"entries": len(entries), "successful": sum(item["fetch_status"] == "ok" for item in entries), "manifest": str(output / "manifest.json")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
