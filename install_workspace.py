import argparse
import hashlib
import json
import shutil
from pathlib import Path


ROOT_FILES = {"agent.md", "AGENTS.md", "README.md", ".gitignore", "install_workspace.py", "Dockerfile", ".dockerignore", "requirements-publish.txt", "app.py", "requirements.txt"}
ROOT_FOLDERS = {"agents", "docs", "templates", "schemas", "framework", "tests", "frontend", "contracts", "mocks", "data", "backend", "models", "reviews", "outputs", "tools"}


def source_files(source):
    for path in source.rglob("*"):
        relative = path.relative_to(source)
        if not path.is_file() or path.is_symlink():
            continue
        if any(part in {"__pycache__", "demo-verification", "cli-verification", "example-verification"} for part in relative.parts):
            continue
        if relative.parts[0] == "tests" and (len(relative.parts) != 2 or path.suffix != ".py"):
            continue
        if relative.as_posix() in ROOT_FILES or relative.parts[0] in ROOT_FOLDERS:
            if relative.parts[:2] in {("data", "raw"), ("data", "processed"), ("models", "weights")}:
                continue
            yield path, relative


def fingerprint(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def install(source, target):
    source = source.resolve()
    target = target.resolve()
    if target == source or target.is_relative_to(source) or source.is_relative_to(target):
        raise ValueError("源目录与目标必须分离，不能相互包含")
    candidates = list(source_files(source))
    conflicts = []
    for path, relative in candidates:
        destination = target / relative
        if destination.is_symlink() or (hasattr(destination, "is_junction") and destination.is_junction()):
            raise ValueError("目标文件不能使用符号链接或联接点: " + str(destination))
        for parent in [target, *destination.parents]:
            if parent == target or parent.is_relative_to(target):
                if parent.is_symlink() or (hasattr(parent, "is_junction") and parent.is_junction()):
                    raise ValueError("目标路径不能使用符号链接或联接点: " + str(parent))
                if parent.exists() and not parent.is_dir():
                    conflicts.append(str(parent))
        if destination.exists() and (not destination.is_file() or fingerprint(destination) != fingerprint(path)):
            conflicts.append(str(destination))
    if conflicts:
        raise ValueError("为保留现有内容，未执行复制；请先处理冲突: " + ", ".join(sorted(set(conflicts))))
    copied = 0
    for path, relative in candidates:
        destination = target / relative
        if not destination.exists():
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)
            copied += 1
        if fingerprint(destination) != fingerprint(path):
            raise ValueError("复制后校验失败: " + str(destination))
    return {"target": str(target), "copied": copied, "verified": len(candidates), "overwrites": 0}


def main():
    parser = argparse.ArgumentParser(description="把已验证框架复制到主工作区，拒绝覆盖不同内容的文件")
    parser.add_argument("--target", required=True)
    arguments = parser.parse_args()
    try:
        result = install(Path(__file__).parent, Path(arguments.target))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
