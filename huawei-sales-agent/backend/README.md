# 后端工作区说明

## 负责人

- Agent 调度、提示词、模型 API、RAG 代码、验收脚本和整体联调：A。
- HTTP 接口、限流、上传边界、会话和聊天历史持久化：B。
- RAG 数据清洗、切片和检索质量输入：D。
- 前后端 JSON 契约由 B 维护，A、C 作为生产方/消费方复核。

## 开始工作前

依次阅读：

1. 项目根目录 `README.md`。
2. 根目录 `团队协作与分工说明.md`。
3. 根目录 `文件归属与责任矩阵.md`。
4. 本文件。
5. 根据任务继续阅读 `api/README.md`、`agent/README.md`、`rag/README.md` 或 `session/README.md`。

## 目录职责

| 目录/文件 | 主负责人 | 职责 |
| --- | --- | --- |
| `main.py` | B | HTTP 服务入口、同源转发和启动接线 |
| `api/` | B | Chat/Upload 接口、错误、限流和上传边界 |
| `agent/` | A | 主/子 Agent 调度、提示词、工具、模型调用、核验和四步业务 |
| `rag/` | A，D 协作 | A 维护检索代码；D 提供清洗数据、切片和检索质量 |
| `session/` | B | 会话记忆、聊天历史、隐私和持久化 |
| `requirements.txt` | B | Python 后端依赖声明 |

## 修改规则

- 同一文件只能由责任矩阵中的主负责人写入。
- 修改接口字段时先由 B 确认契约，再通知 A、C 等生产方和消费方。
- 不在后端复制前端逻辑、原始数据或另一套契约。
- B 负责会话和持久化边界，A 负责 Agent 上下文；双方都不得记录客户原文、Cookie、CSRF 令牌、凭据或模型权重。
- 合成样例和规则结果不得描述为真实模型、官方报价或真实客户效果。

## 验证

从 `huawei-sales-agent/` 目录运行：

```powershell
python -B -m unittest discover -s tests -v
$env:HUAWEI_HTTP_SMOKE='1'; python -B -m unittest discover -s tests -v
```

## 交接

交付时说明任务编号、改动文件、接口版本、测试命令和结果、已知限制、未验证事项及需要 A、B、C、D 或 E 复核的内容。A 负责最终联调，E 协助验收。

