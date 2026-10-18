# 结构化消息与协作协议

## 必填信封

消息为 UTF-8 JSON 对象，机器约束见 `schemas/message.schema.json`。

| 字段 | 类型 | 含义 |
|---|---|---|
| `task_id` | string | 已创建的任务 ID |
| `from_agent` | string | `Orchestrator/A/B/C/D/E/QA` 之一 |
| `to_agent` | string | 同上角色 ID，必须符合下面路由 |
| `type` | string | `assign/deliver/review/reject/fix` |
| `payload` | object | 摘要、交付路径、问题与证据等业务内容 |
| `status` | string | 本条消息请求写入的目标任务状态 |
| `timestamp` | string | 带时区的 ISO 8601 时间，例如 `2026-10-18T10:00:00+08:00` |

`status` 不是消息运输或收取状态。CLI 成功/失败表示本次消息是否被接受；任务状态表示工作处于哪个阶段。不要将 `sent/received/processed/failed` 写入 `status`。已接受的消息、事件和任务表在同一次原子状态写入中归档。

## 路由与状态

| type | from → to | 原任务状态 → status | payload 关键要求 |
|---|---|---|---|
| `assign` | Orchestrator → 任务 owner | `pending → assigned` | 目标、验收标准、依赖和相关文件 |
| `fix` | 任务 owner → QA | `assigned/changes_requested → in_progress` | 开始/修复摘要；修复时关联 issue_id |
| `deliver` | 任务 owner → QA | `in_progress → in_review` | 非空 `artifacts` 文件路径字符串列表；建议附 summary 与验证证据 |
| `reject` | QA → 任务 owner | `in_review/done → changes_requested` | 非空 `issues` 对象数组；done 可因产出或依赖变更被退回 |
| `review` | QA → Orchestrator | `in_review → done` | 非空 `summary`；建议附评审路径与实际检查 |

开始工作也使用 `fix`，摘要明确写“开始执行”；这样保持原始五类消息类型，不增加 start 类型。`blocked`、`cancelled` 不在消息正常路径中，由主控使用 `block/cancel/resume --id ID --reason TEXT` 管理并记录事件；block 保存 resume_status，resume 恢复原状态。done/cancelled 不允许再次取消或阻塞，blocked 必须先恢复才能取消。不能伪造消息或手改 state.json 绕过规则。

done 不是不可重开的终态。已验收文件变化时，由 QA 对原任务发送 reject，原 owner 按 fix → deliver → QA review 完成重新交付与复验。deliver 记录当前产出 hash 及 `dependency_fingerprints`，后者绑定依赖任务的 artifact_hashes。上游验收内容变化后，下游旧交付会被判定过期，即使状态仍是 done 也不能发布；QA 还须退回受影响的下游原任务逐项复验，最后由 E 重新签字。仅另建修订任务不能更新原任务旧 hash。

任务 owner 只能是 A–E，不能通过假冒其他角色提交来绕过权限。本地运行器检查角色、路由和路径，不提供远程身份认证；会话主控仍须确保真正执行者与角色一致。

## 问题与交付格式

每个 `issues` 对象必须包含：

```json
{
  "issue_id": "ISSUE-001",
  "owner": "A",
  "severity": "minor",
  "description": "模拟：空数据时未展示可操作提示。",
  "retest": "使用空 Mock 数据打开页面，确认提示出现且可重新输入。"
}
```

严重性为 `blocker/major/minor`。同一 reject 的 owner 必须与任务 owner 对齐；跨成员问题提交主控拆分或关联任务。描述应给出文件位置、复现和预期，不能只写“效果不好”。复验须逐项对应 issue_id，不以“已改”代替验证。

交付消息示例（示意路径，实际发送前文件必须存在）：

```json
{
  "task_id": "EXAMPLE-A-001",
  "from_agent": "A",
  "to_agent": "QA",
  "type": "deliver",
  "payload": {
    "summary": "模拟页面交付，尚无真实业务功能。",
    "artifacts": ["outputs/A/example.txt"],
    "evidence": "按任务验收标准检查，结果见交付文件。"
  },
  "status": "in_review",
  "timestamp": "2026-10-18T10:00:00+08:00"
}
```

## 提交与追溯

在项目根目录运行 `python -m framework send --file 路径.json`。先创建任务，再按合法状态顺序提交消息。所有消息通过本地运行器归档至 `.collaboration/state.json`，每次写前备份至 `.collaboration/backups/`。不能将另一个 JSONL 文件当作独立事实来源，也不能覆盖历史记录来掩盖拒收。

`payload` 不放账号口令、token 或原始敏感数据；引用合适的受控文件。产出路径应为项目内相对路径，遵守角色目录边界，禁止引用工作区外文件充当交付。工具权限或用户授权阻塞时报告事实与解决条件，不假装已执行。
