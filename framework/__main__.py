import argparse
import json
import sys
from pathlib import Path

from .runtime import FrameworkError, Workspace, now


def demo(output):
    root = Path(output).resolve()
    if root.exists() and any(root.iterdir()):
        raise FrameworkError("demo 输出目录必须为空，避免覆盖已有工作")
    root.mkdir(parents=True, exist_ok=True)
    workspace = Workspace(root)
    workspace.initialize()
    workspace.add_task("DEMO-A", "A", "模拟输入页", "空输入有明确提示")
    artifact = root / "outputs/A/example.txt"
    artifact.parent.mkdir(parents=True)
    artifact.write_text("演示初稿：尚未处理空输入。", encoding="utf-8")

    def emit(message_type, source, target, status, payload):
        workspace.send({"task_id": "DEMO-A", "from_agent": source, "to_agent": target,
                        "type": message_type, "payload": payload, "status": status, "timestamp": now()})

    emit("assign", "Orchestrator", "A", "assigned", {"summary": "模拟分配"})
    emit("fix", "A", "QA", "in_progress", {"summary": "开始模拟任务"})
    emit("deliver", "A", "QA", "in_review", {"artifacts": ["outputs/A/example.txt"]})
    emit("reject", "QA", "A", "changes_requested", {"issues": [{
        "issue_id": "DEMO-ISSUE-1", "owner": "A", "severity": "major",
        "description": "模拟空输入缺少提示", "retest": "确认空输入提示已记录",
    }]})
    emit("fix", "A", "QA", "in_progress", {"summary": "修复模拟问题", "issue_ids": ["DEMO-ISSUE-1"]})
    artifact.write_text("模拟修复版：空输入显示请先填写需求。", encoding="utf-8")
    emit("deliver", "A", "QA", "in_review", {"artifacts": ["outputs/A/example.txt"]})
    emit("review", "QA", "Orchestrator", "done", {"summary": "模拟复验通过，文件含空输入提示"})
    return {"simulation": True, "output": str(root), "validation": workspace.validate(),
            "notice": "消息与产出均为示例；没有调用模型、训练、发布或真实产品验收"}


def main():
    parser = argparse.ArgumentParser(description="华为项目本地 Agent 协作框架")
    parser.add_argument("--root", default=".", help="工作区，默认当前目录")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("init", "validate", "show", "snapshot", "release-check"):
        commands.add_parser(name)
    task = commands.add_parser("task")
    for name in ("id", "owner", "title", "acceptance"):
        task.add_argument("--" + name, required=True)
    task.add_argument("--depends-on", nargs="*", default=[])
    send = commands.add_parser("send")
    send.add_argument("--file", required=True)
    approval = commands.add_parser("release-approve")
    approval.add_argument("--by", choices=["E"], required=True)
    approval.add_argument("--summary", required=True)
    for name in ("block", "cancel", "resume"):
        action = commands.add_parser(name)
        action.add_argument("--id", required=True)
        action.add_argument("--reason", required=True)
    example = commands.add_parser("demo")
    example.add_argument("--output", required=True)
    arguments = parser.parse_args()
    workspace = Workspace(arguments.root)
    try:
        if arguments.command == "task":
            result = workspace.add_task(arguments.id, arguments.owner, arguments.title, arguments.acceptance, arguments.depends_on)
        elif arguments.command == "send":
            result = workspace.send(json.loads(Path(arguments.file).read_text(encoding="utf-8-sig")))
        elif arguments.command == "release-approve":
            result = workspace.approve_release(arguments.by, arguments.summary)
        elif arguments.command == "demo":
            result = demo(arguments.output)
        elif arguments.command in {"block", "cancel"}:
            result = workspace.hold(arguments.id, arguments.reason, cancel=arguments.command == "cancel")
        elif arguments.command == "resume":
            result = workspace.resume(arguments.id, arguments.reason)
        else:
            method = {"init": "initialize", "show": "read", "release-check": "release_check"}.get(arguments.command, arguments.command)
            result = getattr(workspace, method)()
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (FrameworkError, OSError, json.JSONDecodeError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
