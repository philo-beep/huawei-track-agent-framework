import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from modelscope_hub import HubApi, HubConfig
from modelscope_hub.errors import HubError


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from framework.runtime import FrameworkError, Workspace
from tools.public_release import public_files


def credential_helper(operation):
    fields = dict(line.rstrip("\n").split("=", 1) for line in sys.stdin if "=" in line)
    expected = os.environ.get("FRAMEWORK_STUDIO_GIT_PATH")
    if (operation == "get" and expected and fields.get("protocol") == "https"
            and fields.get("host") == "modelscope.cn" and fields.get("path") == expected):
        token = HubConfig().load_git_token()
        if token:
            sys.stdout.write(f"username=oauth2\npassword={token}\n\n")


def git(folder, *arguments, authenticated=False, repo_id=None):
    command = ["git", "-c", "core.autocrlf=false", "-c", "core.hooksPath=/dev/null"]
    environment = os.environ.copy()
    environment["GIT_TERMINAL_PROMPT"] = "0"
    if authenticated:
        helper = "!" + shlex.quote(Path(sys.executable).as_posix()) + " " + shlex.quote(
            Path(__file__).resolve().as_posix()) + " --credential-helper"
        command += ["-c", "credential.helper=", "-c", "credential.helper=" + helper,
                    "-c", "credential.useHttpPath=true"]
        environment["FRAMEWORK_STUDIO_GIT_PATH"] = f"studios/{repo_id}.git"
    result = subprocess.run(command + list(arguments), cwd=folder, env=environment,
                            text=True, encoding="utf-8", errors="replace", capture_output=True)
    if result.returncode:
        raise ValueError("Git 操作失败: " + result.stderr.strip())
    return result.stdout.strip()


def publish(repo_id, expected_head, push=False, expected_sdk="docker"):
    if not re.fullmatch(r"[A-Za-z0-9_-]+/[A-Za-z0-9_-]+", repo_id):
        raise ValueError("空间 ID 必须为 owner/name")
    if not re.fullmatch(r"[0-9a-f]{40}", expected_head):
        raise ValueError("必须提供已检查远端的完整提交 ID")
    workspace = Workspace(ROOT)
    workspace.release_check()
    api = HubApi()
    if api.whoami().username != repo_id.split("/")[0]:
        raise ValueError("当前认证账号不是目标空间所有者")
    existing = api.get_repo(repo_id, repo_type="studio")
    if existing.sdk_type != expected_sdk or existing.hardware != "platform/2v-cpu-8g-mem":
        raise ValueError("目标不是已审查的 SDK / 免费 CPU 配置，未修改空间")
    staging = ROOT / ".collaboration" / "publish" / uuid4().hex
    staging.parent.mkdir(parents=True, exist_ok=True)
    url = f"https://modelscope.cn/studios/{repo_id}.git"
    git(ROOT, "clone", "--", url, str(staging), authenticated=True, repo_id=repo_id)
    if git(staging, "rev-parse", "HEAD") != expected_head:
        raise ValueError("远端提交已变化；保留克隆供检查，未覆盖或推送")
    branch = git(staging, "symbolic-ref", "--short", "HEAD")
    manifest = {}
    forbidden = re.compile(
        rb"ms-[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}|"
        rb"gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|"
        rb"sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|"
        rb"(?:AKIA|ASIA)[A-Z0-9]{16}|"
        rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")
    candidates = list(public_files(ROOT))
    for path, relative in candidates:
        content = path.read_bytes()
        if forbidden.search(content):
            raise ValueError("候选文件疑似包含凭据: " + relative.as_posix())
        destination = staging / relative
        if destination.is_symlink() or any(parent.is_symlink() for parent in destination.parents):
            raise ValueError("拒绝覆盖远端符号链接路径: " + relative.as_posix())
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
        manifest[relative.as_posix()] = hashlib.sha256(content).hexdigest()
    git(staging, "add", "--", *manifest)
    record = {"repo_id": repo_id, "url": url.removesuffix(".git"), "base": expected_head,
              "branch": branch, "files": len(manifest), "manifest": manifest,
              "staging": str(staging), "pushed": False}
    if push:
        workspace.release_check()
        for path, relative in candidates:
            if hashlib.sha256(path.read_bytes()).hexdigest() != manifest[relative.as_posix()]:
                raise ValueError("候选文件在准备期间变化，未推送")
        if git(staging, "diff", "--cached", "--name-only"):
            git(staging, "-c", "user.name=Framework Publisher", "-c",
                "user.email=framework-publisher@users.noreply.github.com", "commit", "-m",
                "Publish reviewed interactive store growth assistant")
        git(staging, "push", "origin", f"HEAD:{branch}", authenticated=True, repo_id=repo_id)
        record["commit"] = git(staging, "rev-parse", "HEAD")
        remote = git(staging, "ls-remote", "origin", f"refs/heads/{branch}",
                     authenticated=True, repo_id=repo_id).split()[0]
        if remote != record["commit"]:
            raise ValueError("推送后远端提交核对失败")
        record["pushed"] = True
    (staging.parent / "latest-deployment.json").write_text(
        json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    return {key: value for key, value in record.items() if key != "manifest"}


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--credential-helper":
        credential_helper(sys.argv[2])
        return 0
    parser = argparse.ArgumentParser(description="保留现有历史，通过 Git 更新已审查的销售助手空间")
    parser.add_argument("--repo-id", default="philosophia/promotion-agent")
    parser.add_argument("--expected-head", required=True)
    parser.add_argument("--expected-sdk", choices=["docker", "gradio"], default="docker")
    parser.add_argument("--push", action="store_true", help="实际提交并普通推送；默认只准备本机候选")
    arguments = parser.parse_args()
    try:
        print(json.dumps(publish(arguments.repo_id, arguments.expected_head, arguments.push, arguments.expected_sdk), ensure_ascii=False, indent=2))
        return 0
    except (HubError, FrameworkError, OSError, ValueError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
