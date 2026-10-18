# 华为赛道协作规则

本目录为项目主工作区，原始要求见 `agent.md`，保留原文。当前仅搭建协作基础设施，尚未取得赛题、目标用户、数据源与评测指标，不得编造业务功能或成绩。

## 调度与角色

主 Agent 读取 `agents/orchestrator.md`；A/B/C/D/E/QA 读取对应独立提示词。允许按这些职责委派子 Agent。7 个角色不要求 7 个进程同时运行，服从宿主并发上限分批调度。提示词文件不代表实际模型实例已启动，不锁定未经验证的模型名称。

| 角色 | 允许修改 |
| --- | --- |
| A 前端 | `frontend/`、`docs/ui/`、`outputs/A/` |
| B 接口 | `contracts/`、`mocks/`、`docs/api/`、`outputs/B/` |
| C 数据 | `data/`、`docs/data/`、`outputs/C/` |
| D 后端 Qwen | `backend/`、`models/`、`docs/backend/`、`outputs/D/` |
| E 产品说明 | `docs/product/`、`outputs/E/` |
| QA 独立验收 | `reviews/`、`tests/` |
| Orchestrator | 根目录、`agents/`、`framework/`、`schemas/`、`templates/`、`.collaboration/`、协作文档 |

QA 和主控可读取全部交付物。每次委派明确任务 ID、允许目录、输入、交付与验收标准。不同角色不得同时编辑同一文件。B 的 `contracts/` 为接口唯一事实来源。C 向 D 交付须附数据来源与质量报告。不合格产出退回责任角色修复，主控不得代改业务文件。

## 状态与验收

使用 `python -m framework` 管理 `.collaboration/state.json`，禁止手改绕过验收。结构化消息包含 `task_id/from_agent/to_agent/type/payload/status/timestamp`，status 为目标任务状态。消息与事件同事务存储，写入前自动备份。

发布前 QA 验收任务，E 确认产品说明与实际功能一致，检查交付文件指纹。E 的确认必须来自 E 实际审阅，主控不能冒名签字。命令行角色字段为本地流程校验，不是身份认证或操作系统隔离。

## 备份与验证

关键节点运行 `python -m framework snapshot` 生成本机归档；异地备份须核实后另行记录。验证命令：`python -m unittest discover -s tests -v`、`python -m framework validate`。使用 `apply_patch` 编辑代码，不覆盖用户改动，不自动提交 Git 提交或创建分支。

原始要求已授权新建公开 GitHub 仓库与魔搭部署。发布前仅整理已审查框架和脱敏交付，不能上传账号令牌、私有数据、模型权重或运行日志。缺少登录、账号选择、平台权限或付费资源时记录实际缺口并提示用户，禁止虚报已部署。另行发送消息、付费训练等仍需对应授权。
