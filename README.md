---
title: 华销智策 —— 针对华为的销售智能体
sdk: docker
app_port: 7860
---

# 华销智策项目协作入口

本项目工作区采用两个标准目录：

- `huawei-sales-agent/`：可运行业务代码、前端、后端、Agent、RAG、测试和启动脚本。
- `huawei-sales-agent-data/`：数据集、Agent 规范、验收清单和赛事文档。

## 远端与公开演示

- GitHub 业务代码：[main 分支](https://github.com/philo-beep/huawei-track-agent-framework/tree/main)
- GitHub 数据与规范：[data-spec 分支](https://github.com/philo-beep/huawei-track-agent-framework/tree/data-spec)
- 魔搭空间：[philosophia/promotion-agent](https://modelscope.cn/studios/philosophia/promotion-agent)
- 公网演示：[https://philosophia-promotion-agent.ms.show](https://philosophia-promotion-agent.ms.show)

当前系统支持按请求显式启用云端大模型（DeepSeek v4.1-flash）、IMA OpenAPI 知识库检索和联网公开网页抓取；三项能力均需通过本地受控环境变量注入凭据，不写入源码或镜像。公网是否可用取决于部署平台是否完成同样的密钥注入与网络放行。公网可访问、模型/检索调用和业务效果是不同验收层级，不得互相替代。

## 当前角色

| 角色 | 职责 |
| --- | --- |
| A：Agent 核心工程师、项目负责人 | 主/子 Agent 调度、系统提示词、模型 API、RAG 代码、验收脚本、Agent 规范、代码审核和最终联调 |
| B：后端接口工程师 | HTTP 接口、数据入库、缓存、限流、上传边界、会话记忆、持久化、标准化 JSON 接口和异常处理 |
| C：前端开发工程师 | 聊天界面、产品卡片、加载样例、流式消息、接口对接、移动端和演示页面 |
| D：数据与知识库工程师 | 数据清洗、商城页面解析、文本切片、向量化入库、去重、RAG 检索库和测试样例数据 |
| E：产品与答辩工程师 | 需求与规则核对、README、PPT、答辩稿、演示脚本、问题记录、风险和提交包；协助验收 |

## 开始工作前

1. 阅读本文件。
2. 阅读 [团队协作与分工说明](团队协作与分工说明.md)。
3. 阅读 [文件归属与责任矩阵](文件归属与责任矩阵.md)。
4. 进入工作区后阅读对应 README：

   - A：`huawei-sales-agent/backend/README.md`、`backend/agent/README.md`、`backend/agent/prompts/README.md`、`backend/rag/README.md`、`tests/README.md`、`huawei-sales-agent-data/agent_spec/README.md`
   - B：`huawei-sales-agent/backend/README.md`、`backend/api/README.md`、`backend/agent/contracts/README.md`、`backend/session/README.md`
   - C：`huawei-sales-agent/frontend/README.md`、`assets/README.md`、`backend/api/README.md`
   - D：`huawei-sales-agent-data/datasets/README.md`、`backend/rag/README.md`、`huawei-sales-agent-data/agent_spec/task_rule.md`
   - E：`huawei-sales-agent/README.md`、`tests/README.md`、`huawei-sales-agent-data/agent_spec/acceptance.md`、`huawei-sales-agent-data/docs/README.md`

阅读优先级为：任务单 → 根协作文档 → 工作区 README → 子目录 README → 当前验收材料。

## 运行入口

```powershell
Set-Location '.\huawei-sales-agent'
python backend/main.py
```

默认访问地址：`http://localhost:7860`。

当前实现使用 Python 标准库 HTTP 网关、Node.js Agent/规则引擎和原生 HTML/CSS/JavaScript。FastAPI、Flask、Vue 或 Tailwind 如后续引入，必须单独说明，不得描述为已经使用。

## Git 与验收

- `main`：可运行业务代码；所有合并走 PR，由 A 代码审核。
- `data-spec`：数据集、Agent 规范、测试样例、验收清单和文档；不与 main 混放，也不合并进 main。
- 每个成员使用 `feat/xxx` 功能分支；提交 PR 前先同步 main 并解决冲突。
- A 负责整体联调和验收脚本；E 协助需求对齐、全流程验收和材料一致性核对。
- 只有自测、PR 审核、A/E 验收和最终联调全部通过，成果才可进入可交付版本。

