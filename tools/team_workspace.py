import argparse
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "framework" / "team-layout.json"


class TeamError(ValueError):
    pass


def git(root, *arguments):
    result = subprocess.run(
        ["git", "-c", "core.hooksPath=/dev/null", *arguments], cwd=root,
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if result.returncode:
        raise TeamError(result.stderr.strip() or "Git 操作失败")
    return result.stdout


def commit_id(root, reference):
    if not reference or reference.startswith("-") or any(character in reference for character in "\r\n\0"):
        raise TeamError("提交引用无效")
    return git(root, "rev-parse", "--verify", "--end-of-options", reference + "^{commit}").strip()


def load_layout():
    return json.loads(CONFIG.read_text(encoding="utf-8"))


def changed_paths(output):
    fields = output.split("\0")
    paths = []
    index = 0
    while index < len(fields) and fields[index]:
        status = fields[index]
        count = 2 if status.startswith(("R", "C")) else 1
        index += 1
        if index + count > len(fields) or any(not field for field in fields[index:index + count]):
            raise TeamError("Git 变更记录不完整")
        paths.extend(fields[index:index + count])
        index += count
    return paths


def permitted_path(value, allowed_paths):
    path = Path(value)
    if path.is_absolute() or ".." in path.parts or "\\" in value or ":" in value:
        return False
    if not any(value == prefix or value.startswith(prefix + "/") for prefix in allowed_paths):
        return False
    lowered = path.name.lower()
    if lowered == ".env" or lowered.startswith(".env.") or path.suffix.lower() in {".key", ".pem", ".token", ".zip", ".gguf", ".safetensors"}:
        return False
    return True


def check_changes(root, layout, member, base, head, include_worktree=False):
    if member not in layout["members"]:
        raise TeamError("未知模块负责人")
    base_commit = commit_id(root, base)
    head_commit = commit_id(root, head)
    paths = changed_paths(git(root, "diff", "--name-status", "-z", "--find-renames", base_commit + "..." + head_commit, "--"))
    if include_worktree:
        if head_commit != commit_id(root, "HEAD"):
            raise TeamError("包含未提交改动时，head 必须指向当前 HEAD")
        paths.extend(changed_paths(git(root, "diff", "--name-status", "-z", "--find-renames", "HEAD", "--")))
        paths.extend(path for path in git(root, "ls-files", "--others", "--exclude-standard", "-z").split("\0") if path)
    paths = sorted(set(paths))
    allowed = layout["members"][member]["allowed_paths"]
    forbidden = [path for path in paths if not permitted_path(path, allowed)]
    return {"member": member, "base_commit": base_commit, "head_commit": head_commit,
            "include_worktree": include_worktree, "changed_paths": paths,
            "forbidden_paths": forbidden, "passed": not forbidden,
            "notice": "只检查路径归属，不证明业务正确、无凭据或已获QA验收"}


def workspace_plan(root, layout):
    parent = root.parent / layout["workspace_sibling"]
    return {"integration_branch": layout["integration_branch"], "workspaces": [
        {"member": member, "branch": spec["branch"], "path": str(parent / spec["workspace"]),
         "module_directory": spec["directory"]}
        for member, spec in layout["members"].items()
    ]}


def create_workspaces(root, layout):
    baseline = commit_id(root, layout["integration_branch"])
    if git(root, "diff", "--name-only", "HEAD", "--").strip():
        raise TeamError("主工作区仍有未提交的受跟踪改动，请先审查并提交框架基线")
    required = ["framework/team-layout.json", "tools/team_workspace.py", "协作工作区/协作开发与合并说明.md"]
    required.extend(spec["directory"] + "/README.md" for spec in layout["members"].values())
    for path in required:
        git(root, "cat-file", "-e", baseline + ":" + path)
    plan = workspace_plan(root, layout)
    for workspace in plan["workspaces"]:
        if Path(workspace["path"]).exists():
            raise TeamError("工作区路径已存在，不覆盖：" + workspace["path"])
        references = git(root, "for-each-ref", "--format=%(refname)", "refs/heads/" + workspace["branch"]).splitlines()
        if "refs/heads/" + workspace["branch"] in references:
            raise TeamError("功能分支已存在，不重置：" + workspace["branch"])
    created = []
    try:
        for workspace in plan["workspaces"]:
            git(root, "worktree", "add", "-b", workspace["branch"], workspace["path"], baseline)
            created.append(workspace)
    except TeamError as error:
        raise TeamError("创建中断，已创建工作区保留；未自动删除。已创建：" + json.dumps(created, ensure_ascii=False) + "；原因：" + str(error)) from error
    return {"baseline": baseline, "created": created, "notice": "未复制本机知识库、模型或凭据；未改变远端默认分支或部署"}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="五模块独立 Git 工作区与路径检查")
    parser.add_argument("--root", default=str(ROOT))
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("plan")
    create = subcommands.add_parser("create")
    create.add_argument("--apply", action="store_true")
    check = subcommands.add_parser("check")
    check.add_argument("--member", required=True)
    check.add_argument("--base", default="main")
    check.add_argument("--head", default="HEAD")
    check.add_argument("--include-worktree", action="store_true")
    arguments = parser.parse_args()
    try:
        layout = load_layout()
        root = Path(arguments.root).resolve()
        if arguments.command == "check":
            result = check_changes(root, layout, arguments.member, arguments.base, arguments.head, arguments.include_worktree)
        elif arguments.command == "create" and arguments.apply:
            result = create_workspaces(root, layout)
        else:
            result = workspace_plan(root, layout)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1 if result.get("passed") is False else 0
    except (TeamError, OSError, json.JSONDecodeError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
