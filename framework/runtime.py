import copy
import hashlib
import json
import os
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


OWNERS = {
    "A": ("frontend", "docs/ui", "outputs/A"),
    "B": ("contracts", "mocks", "docs/api", "outputs/B"),
    "C": ("data", "docs/data", "outputs/C"),
    "D": ("backend", "models", "docs/backend", "outputs/D"),
    "E": ("docs/product", "outputs/E"),
}
STATUSES = {"pending", "assigned", "in_progress", "in_review", "changes_requested", "blocked", "done", "cancelled"}
TRANSITIONS = {
    "assign": ({"pending"}, "assigned"),
    "fix": ({"assigned", "changes_requested"}, "in_progress"),
    "deliver": ({"in_progress"}, "in_review"),
    "reject": ({"in_review", "done"}, "changes_requested"),
    "review": ({"in_review"}, "done"),
}
MESSAGE_FIELDS = {"task_id", "from_agent", "to_agent", "type", "payload", "status", "timestamp"}


class FrameworkError(ValueError):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def require(condition, message):
    if not condition:
        raise FrameworkError(message)


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def digest_file(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


class Workspace:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.control = self.root / ".collaboration"
        self.state_path = self.control / "state.json"

    @contextmanager
    def _locked(self):
        self.control.mkdir(parents=True, exist_ok=True)
        lock = self.control / "write.lock"
        try:
            descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError as error:
            raise FrameworkError("看板正被写入；若进程异常退出，请确认无活跃写入后移除 write.lock") from error
        try:
            os.close(descriptor)
            yield
        finally:
            lock.unlink()

    def _write(self, state):
        if self.state_path.exists():
            backups = self.control / "backups"
            backups.mkdir(exist_ok=True)
            backup = backups / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".json")
            backup.write_bytes(self.state_path.read_bytes())
        descriptor, temporary = tempfile.mkstemp(prefix="state-", suffix=".tmp", dir=self.control)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
                json.dump(state, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.state_path)
        finally:
            Path(temporary).unlink(missing_ok=True)

    def initialize(self):
        with self._locked():
            if self.state_path.exists():
                return self.read()
            state = {"schema_version": 1, "revision": 0, "tasks": {}, "messages": [], "events": [], "release_approval": None}
            self._write(state)
        return state

    def read(self):
        require(self.state_path.exists(), "请先运行 init")
        try:
            return json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise FrameworkError("看板无法读取；请检查 .collaboration/backups 中的备份") from error

    def _record(self, state, event_type, payload):
        state["revision"] += 1
        state["events"].append({"revision": state["revision"], "type": event_type, "timestamp": now(), "payload": payload})
        state["release_approval"] = None
        self._write(state)

    def add_task(self, task_id, owner, title, acceptance, dependencies=None):
        require(nonempty(task_id), "task_id 必须是非空字符串")
        require(isinstance(owner, str) and owner in OWNERS, "owner 必须是 A/B/C/D/E")
        require(nonempty(title) and nonempty(acceptance), "标题和验收标准不得为空")
        dependencies = [] if dependencies is None else dependencies
        require(isinstance(dependencies, list), "dependencies 必须是数组")
        require(all(nonempty(item) for item in dependencies), "依赖 ID 必须是字符串")
        require(len(dependencies) == len(set(dependencies)), "依赖不得重复")
        with self._locked():
            state = self.read()
            require(task_id not in state["tasks"], "任务 ID 已存在")
            require(all(item in state["tasks"] for item in dependencies), "依赖必须先创建")
            state["tasks"][task_id] = {
                "task_id": task_id, "owner": owner, "title": title, "acceptance": acceptance,
                "dependencies": dependencies, "status": "pending", "artifacts": [],
                "artifact_hashes": {}, "dependency_fingerprints": {}, "issues": [], "created_at": now(), "updated_at": now(),
            }
            self._record(state, "task_created", {"task_id": task_id, "owner": owner})
        return copy.deepcopy(state["tasks"][task_id])

    def _artifact(self, owner, value):
        require(nonempty(value), "产出路径必须是非空字符串")
        require("\\" not in value and ":" not in value, "产出路径使用 / 分隔的相对路径")
        relative = Path(value)
        require(not relative.is_absolute() and ".." not in relative.parts, "产出不得越出工作区")
        path = (self.root / relative).resolve()
        require(path.is_relative_to(self.root), "产出越出工作区")
        require(any(path.is_relative_to(self.root / allowed) for allowed in OWNERS[owner]), "产出不属于责任 Agent 目录")
        require(path.is_file(), "产出必须是存在的普通文件")
        require(not any((self.root / Path(*relative.parts[:index])).is_symlink()
                        for index in range(1, len(relative.parts) + 1)), "产出不得通过符号链接引用")
        return path

    def _check_hashes(self, task):
        require(bool(task["artifact_hashes"]), "缺少交付文件指纹")
        for name, expected in task["artifact_hashes"].items():
            require(digest_file(self._artifact(task["owner"], name)) == expected, "交付文件已变化，需重新交付: " + name)

    def _ready_dependencies(self, state, task):
        for dependency in task["dependencies"]:
            parent = state["tasks"][dependency]
            require(parent["status"] == "done", "依赖尚未验收: " + dependency)
            self._check_hashes(parent)

    def _dependency_fingerprints(self, state, task):
        return {
            dependency: hashlib.sha256(json.dumps(state["tasks"][dependency]["artifact_hashes"], sort_keys=True).encode("utf-8")).hexdigest()
            for dependency in task["dependencies"]
        }

    def _check_dependencies(self, state, task):
        self._ready_dependencies(state, task)
        require(task["dependency_fingerprints"] == self._dependency_fingerprints(state, task), "依赖产出发生变化，须由 QA 退回本任务重新交付")

    def send(self, message):
        require(isinstance(message, dict) and set(message) == MESSAGE_FIELDS, "消息字段必须符合 message.schema.json")
        require(isinstance(message["type"], str) and message["type"] in TRANSITIONS, "消息 type 无效")
        require(nonempty(message["task_id"]), "task_id 必须是非空字符串")
        require(isinstance(message["payload"], dict), "payload 必须是对象")
        try:
            timestamp = datetime.fromisoformat(message["timestamp"].replace("Z", "+00:00"))
            require(timestamp.utcoffset() is not None, "timestamp 必须包含时区")
        except (TypeError, ValueError, AttributeError) as error:
            raise FrameworkError("timestamp 必须是带时区的 ISO 8601 时间") from error
        with self._locked():
            state = self.read()
            require(message["task_id"] in state["tasks"], "任务不存在")
            require(message not in state["messages"], "重复消息被拒绝")
            task = state["tasks"][message["task_id"]]
            allowed, target = TRANSITIONS[message["type"]]
            require(task["status"] in allowed, "非法任务状态迁移")
            require(message["status"] == target, "消息 status 必须等于目标任务状态")
            owner = task["owner"]
            routes = {
                "assign": ("Orchestrator", owner), "fix": (owner, "QA"), "deliver": (owner, "QA"),
                "reject": ("QA", owner), "review": ("QA", "Orchestrator"),
            }
            require((message["from_agent"], message["to_agent"]) == routes[message["type"]], "消息责任路由错误")
            payload = message["payload"]
            if message["type"] in {"assign", "fix", "deliver", "review"}:
                self._ready_dependencies(state, task)
            if message["type"] == "deliver":
                artifacts = payload.get("artifacts")
                require(isinstance(artifacts, list) and bool(artifacts), "交付须附非空 artifacts 数组")
                require(all(nonempty(name) for name in artifacts), "artifacts 必须是路径字符串列表")
                require(len(artifacts) == len(set(artifacts)), "交付文件不得重复")
                task["artifact_hashes"] = {name: digest_file(self._artifact(owner, name)) for name in artifacts}
                task["artifacts"] = list(artifacts)
                task["dependency_fingerprints"] = self._dependency_fingerprints(state, task)
            elif message["type"] == "reject":
                issues = payload.get("issues")
                require(isinstance(issues, list) and bool(issues), "打回必须附问题清单")
                for issue in issues:
                    require(isinstance(issue, dict), "问题必须是对象")
                    require(issue.get("owner") == owner, "问题必须路由到责任 Agent")
                    require(issue.get("severity") in {"blocker", "major", "minor"}, "问题严重程度无效")
                    require(all(nonempty(issue.get(field)) for field in ("issue_id", "description", "retest")), "问题须有编号、描述与复验标准")
                task["issues"] = copy.deepcopy(issues)
            elif message["type"] == "review":
                require(nonempty(payload.get("summary")), "验收须记录结论")
                self._check_hashes(task)
                self._check_dependencies(state, task)
                task["issues"] = []
            task["status"] = target
            task["updated_at"] = now()
            state["messages"].append(copy.deepcopy(message))
            self._record(state, "message_processed", {"task_id": task["task_id"], "message_index": len(state["messages"]) - 1})
        return copy.deepcopy(task)

    def hold(self, task_id, reason, cancel=False):
        require(nonempty(reason), "阻塞或取消须记录原因")
        with self._locked():
            state = self.read()
            require(task_id in state["tasks"], "任务不存在")
            task = state["tasks"][task_id]
            require(task["status"] not in {"blocked", "done", "cancelled"}, "任务当前不能阻塞或取消")
            task["resume_status"] = task["status"]
            task["status"] = "cancelled" if cancel else "blocked"
            task["updated_at"] = now()
            self._record(state, "task_cancelled" if cancel else "task_blocked", {"task_id": task_id, "reason": reason, "by": "Orchestrator"})
        return task

    def resume(self, task_id, reason):
        require(nonempty(reason), "恢复任务须记录原因")
        with self._locked():
            state = self.read()
            require(task_id in state["tasks"], "任务不存在")
            task = state["tasks"][task_id]
            require(task["status"] == "blocked", "只有阻塞任务可恢复")
            task["status"] = task.pop("resume_status")
            task["updated_at"] = now()
            self._record(state, "task_resumed", {"task_id": task_id, "reason": reason, "by": "Orchestrator"})
        return task

    def validate(self):
        state = self.read()
        require(set(state) == {"schema_version", "revision", "tasks", "messages", "events", "release_approval"}, "看板字段错误")
        require(state["schema_version"] == 1, "看板版本错误")
        require(state["revision"] == len(state["events"]), "看板事件序列不一致")
        for index, event in enumerate(state["events"], 1):
            require(event["revision"] == index, "事件版本必须连续")
        for task_id, task in state["tasks"].items():
            require(task["task_id"] == task_id and task["owner"] in OWNERS, "任务定义无效")
            require(task["status"] in STATUSES, "任务状态无效")
            require(all(parent in state["tasks"] for parent in task["dependencies"]), "缺少依赖任务")
            require(task["artifacts"] == list(task["artifact_hashes"]), "文件清单与指纹不一致")
            if task["status"] in {"in_review", "done"}:
                self._check_hashes(task)
                self._check_dependencies(state, task)
        return {"valid": True, "revision": state["revision"], "tasks": len(state["tasks"]), "messages": len(state["messages"])}

    def _release_fingerprint(self, state):
        content = json.dumps({"tasks": state["tasks"], "messages": state["messages"]}, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(content.encode("utf-8")).hexdigest()

    def _release_ready(self, state):
        require(bool(state["tasks"]), "空看板不能发布")
        require(all(task["status"] in {"done", "cancelled"} for task in state["tasks"].values()), "仍有未经 QA 验收的任务")
        require(any(task["status"] == "done" for task in state["tasks"].values()), "没有已验收产出")
        require(any(task["owner"] == "E" and task["status"] == "done" for task in state["tasks"].values()), "缺少经过 QA 验收的 E 产品说明任务")
        for task in state["tasks"].values():
            if task["status"] == "done":
                self._check_hashes(task)
                self._check_dependencies(state, task)

    def approve_release(self, by, summary):
        require(by == "E" and nonempty(summary), "发布须由 E 确认产品一致性并填写摘要")
        with self._locked():
            state = self.read()
            self._release_ready(state)
            approval = {"by": by, "summary": summary, "timestamp": now(), "fingerprint": self._release_fingerprint(state)}
            state["revision"] += 1
            state["events"].append({"revision": state["revision"], "type": "release_approved", "timestamp": now(), "payload": approval})
            state["release_approval"] = approval
            self._write(state)
        return approval

    def release_check(self):
        self.validate()
        state = self.read()
        self._release_ready(state)
        approval = state["release_approval"]
        require(isinstance(approval, dict) and approval.get("by") == "E", "缺少 E 的产品一致性确认")
        require(approval["fingerprint"] == self._release_fingerprint(state), "发布确认已过期")
        return {"ready": True, "approval": approval, "notice": "通过本地发布门禁，不代表已推送或上线"}

    def snapshot(self):
        with self._locked():
            self.validate()
            state = self.read()
            folder = self.control / "snapshots" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            folder.mkdir(parents=True)
            (folder / "state.json").write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
            files = {}
            for path in self.root.rglob("*"):
                relative = path.relative_to(self.root)
                if any(part in {".git", ".collaboration", ".venv", "__pycache__", "node_modules"} for part in relative.parts):
                    continue
                if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(self.root):
                    continue
                files[relative.as_posix()] = digest_file(path)
            (folder / "manifest.json").write_text(json.dumps(files, ensure_ascii=False, indent=2), encoding="utf-8")
            with ZipFile(folder / "workspace.zip", "w", ZIP_DEFLATED) as archive:
                for relative in files:
                    archive.write(self.root / relative, relative)
            return {"snapshot": str(folder), "files": len(files), "local_only": True}
