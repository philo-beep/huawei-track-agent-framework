# Agent 核心工作区说明

## 负责人

- 角色 A：Agent 核心工程师、项目负责人。负责主/子 Agent 调度、系统提示词、模型 API、工具、知识库检索调用、验收脚本和最终联调。
- 角色 B：维护本目录中 `cloud-server.js` 的 HTTP/会话边界和 `contracts/` 的标准 JSON 契约。
- 角色 D：为检索模块提供清洗数据、切片、向量索引和质量报告，不直接改写 Agent 业务代码。
- 角色 E：核对功能说明、能力边界、风险和提交材料。

## 开始工作前

1. 项目根目录 `README.md`、`团队协作与分工说明.md` 和 `文件归属与责任矩阵.md`。
2. 后端总说明 `../README.md` 和本文件。
3. 涉及接口时阅读 `contracts/README.md`；涉及提示词时阅读 `prompts/README.md`。
4. 涉及检索时阅读 `../rag/README.md` 和 `../../../huawei-sales-agent-data/datasets/README.md`。

## 文件责任

| 文件 | 主负责人 | 职责 |
| --- | --- | --- |
| `agent_core.py` | A | 主/子 Agent 调度、四步运行核心和工具编排 |
| `config.js` | A | 本地 `.env` 加载与云端模型、IMA、联网能力配置 |
| `research.js` | A | 公开搜索、官网抓取、SSRF 防护和来源指纹 |
| `cloud-runner.js` | A | Agent 和规则运行编排 |
| `fourstep.js` | A | 四步业务流和 Agent 工具链 |
| `main.js` | A | Agent 命令行入口 |
| `support.js` | A | 路径、校验、脱敏和公共设施 |
| `model.js` | A | DeepSeek OpenAI-compatible 调用、JSON 输出、上下文控制和模式声明 |
| `profile.js` | A | 客户画像、明确输入、推断和待确认项 |
| `knowledge.js` | A | 本地知识检索调用和结果适配 |
| `official.js` | A | 官网事实、型号、价格和图片证据消费 |
| `source-health.js` | A | 来源健康和时效检查 |
| `ima.js` | A | 官方 IMA Skill 适配、知识库检索、目录浏览、媒体信息和笔记正文 |
| `ima-evidence.js` | A | IMA 只读证据抓取、正文抽取、EvidenceBundle 与图片清单构建 |
| `ima-evidence-cli.js` | A | 在线证据构建 CLI；输出强制限定到 data-spec 工作区 |
| `ima-evidence-replay.js` | A | 已验证抓取记录的离线回放与哈希复核；配额受阻时使用 |
| `evidence-supplement.js` | A | 将本地知识库和华为官网/商城证据补充到目标产品包，保留来源与失败状态 |
| `ima_extract.py` | A | Markdown/HTML/PDF/Office 正文提取，标准库优先 |
| `skills/ima-skill/` | A | 腾讯 IMA 官方 Skill 1.1.10 原包文件与来源说明 |
| `tools.py` | A | 检索、模型工具和验收辅助 |
| `cloud-fact-selector.js` | A | 内容聚焦、事实选择和策略理由 |
| `verification.js` | A | 事实、图片、合规和适配核验 |
| `pricing.js` | A | 四级价格假设模型和限制 |
| `sales.js` | A | 下一步动作、负责人和人工确认边界 |
| `prompts/system.md` | A | 主 Agent 系统提示词 |
| `prompts/sub_agent.md` | A | 子 Agent 提示词 |
| `cloud-server.js` | B | Web API、会话、任务、导出和限流 |
| `contracts/` | B | 标准 JSON 接口、字段和价格契约 |

## 模型与密钥边界

- A 对接模型 API 和模型参数，但密钥只通过本地环境变量或受控运行环境注入。
- 不把密钥、令牌、模型权重、客户原文或运行日志提交到仓库。
- 当前运行模式为规则准备稿时，不得因为存在模型适配代码或提示词就宣称模型已经调用。
- 模型输入输出必须继续执行来源、价格、图片、客户隐私和人工确认限制。

## 修改规则

- A 统一修改 Agent 业务代码；B 修改 HTTP/会话边界和契约前需评估对 A、C 的影响。
- 同一文件由主负责人统一接收跨角色需求，不允许多人并发写入。
- D 提供数据和检索质量证据，不直接改 Agent 代码；A 负责代码实现和消费验证。
- C 通过 B 的接口消费 Agent 结果，不直接调用模型或内部 Agent 文件。
- E 核对说明与实际能力，不通过修改 Agent 业务代码修补产品描述。

## 验证与交接

从 `huawei-sales-agent/` 运行离线测试和 HTTP 冒烟。A 负责最终联调，E 协助全流程验收。交付需说明文件责任、改动范围、模型状态、接口和来源契约版本、测试结果、已知限制及需要其他角色确认的事项。


## IMA 证据底座

- 官方 Skill 固定在 `skills/ima-skill/`，版本由 `meta.json` 记录；协议请求统一调用其 `ima_api.cjs`。
- 业务适配只执行只读操作：知识库列表/详情、目录浏览、知识检索、媒体信息和正文读取；不上传、不导入、不写入 IMA。
- 凭据只从运行区 `.env` 或部署环境注入，不写入 Skill、数据快照、日志或 Git。
- IMA 返回的临时签名 URL、访问 headers 不落盘；保留知识库 ID、媒体 ID、请求 ID、检索时间、内容 SHA-256、正文快照路径和适用型号。
- 在线构建必须把输出放在 `../huawei-sales-agent-data/` 下：

```powershell
node backend/agent/ima-evidence-cli.js
```

- 已验证抓取记录可离线回放；回放会重新校验本地镜像与原始内容 SHA-256，不伪造缺失 ID：

```powershell
node backend/agent/ima-evidence-replay.js
```

- 官方接口频控或每日配额失败时停止请求并记录真实错误码；不得把 `partial_verified` 写成完整目录或完整产品证据。

