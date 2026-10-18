---
title: 销售助手 · 协作框架预览
sdk: docker
app_port: 7860
---

# 华为赛道项目 · Agent 协作框架

按原始 `agent.md` 搭建：主 Agent 调度，A 前端、B 接口契约、C 数据、D 后端与 Qwen、E 产品说明，QA 独立验收。当前提供协作框架与可部署的只读介绍站，不含具体赛题产品、模型接入或训练。

## 开始使用

Python 3.11+，仅标准库，无需安装依赖或提供 API Key。在本项目目录执行：

```powershell
python -m framework init
python -m framework show
python -m framework validate
python -m unittest discover -s tests -v
python -m framework demo --output demo-workspace
python -m framework snapshot
```

demo 在独立空目录中模拟指派、交付、打回、修复和复验，不调用模型，不污染正式看板。重复演示需指定新的空目录。正式任务先按 `templates/user-requirement.md` 明确需求，再创建任务并通过 JSON 消息流转：

```powershell
python -m framework task --id SAMPLE-A --owner A --title "输入页" --acceptance "按已明确需求验证输入与异常提示"
python -m framework send --file templates/message.assign.example.json
```

`--root 路径` 放在子命令前，可操作其他项目工作区。`block/cancel/resume --id ID --reason 原因` 记录主控管理操作；业务状态通过 assign/fix/deliver/reject/review 消息推进。

## 文件导航

| 位置 | 用途 |
| --- | --- |
| `AGENTS.md`、`agents/` | 后续会话入口、7 个角色的提示词和边界 |
| `docs/architecture.md` | 文字和 Mermaid 消息流、依赖与职责 |
| `docs/protocol.md`、`schemas/` | JSON 消息、看板结构和状态机 |
| `framework/`、`tests/` | 可运行本地调度状态工具与关键回归测试 |
| `templates/` | 需求模板、消息样例、完整端到端示例和发布核对 |
| `frontend/`、`contracts/`、`data/`、`backend/`、`models/` | A/B/C/D 的未来业务产出 |
| `docs/product/`、`reviews/` | E 产品说明与 QA 审查记录 |
| `.collaboration/` | 真实任务表、消息与事件、自动备份、本机快照；不公开上传 |

路径边界由交付检查和角色工作指令约束，不是操作系统沙箱。角色字段不能证明实际执行者身份。运行器负责状态和记录，不会自行向 LLM 发请求，也不会自动创建远程仓库。

## 发布与恢复

`release-approve --by E --summary 结论` 记录 E 实际审阅，`release-check` 检查 QA 任务与交付指纹，并要求至少一个 E 产品说明任务通过 QA；新增任务、状态变化或文件变化会阻止旧候选发布。已完成产出需变更时，QA 用 reject 将原任务退回，责任人修复、重交、复验；相关下游也须按依赖指纹重新复验，历史消息保留。取消任务保留记录，仍不能跳过已有依赖。

每次状态修改前在 `.collaboration/backups/` 保存前一版本；`snapshot` 保存状态、文件 SHA-256 清单与工作区 ZIP。快照为本机恢复用途，可能包含本地数据，不直接公开。恢复前先保存当前版本，确保无活跃写入，再从备份或快照恢复并运行 validate；文件内容应与对应状态版本匹配。异常留下 write.lock 时，确认没有写入进程后才能清理。

公开 GitHub 与魔搭部署方法见 `docs/deployment.md`，实际进展与已验证链接见 `docs/platform-status.md`。沿用用户现有“销售助手”空间 `philosophia/promotion-agent`，当前 Docker 入口展示协作框架，销售业务功能尚未实现。本机运行 `python -m backend.studio.app`，默认端口 7860；Docker 仅复制该标准库服务单文件。可选 Gradio 适配安装 `requirements.txt` 后运行 `python app.py`，不代表线上当前使用 Gradio。

## 主工作区与迁入

2026-10-18 已将框架迁入 `C:\Users\pop\Desktop\华为项目`，此目录为后续唯一主工作区；原 `agent.md` 已保留并校验。之前临时目录是历史备份。下列工具用于将初始框架安全安装到其他空目标，拒绝覆盖不同内容的现存文件：

```powershell
python install_workspace.py --target "C:\Users\pop\Desktop\华为项目"
```

当前桌面看板及历史已经迁入，直接运行 `python -m framework validate` 检查。复制工具排除测试临时产物、本地看板与备份、原始数据和模型权重；它不是完整发布工具，正式发布按文件候选清单进行。
