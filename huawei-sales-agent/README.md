# 华销智策 —— 针对华为的销售智能体

本项目面向华为销售顾问，先根据脱敏客户画像完成 IMA/本地产品匹配，再把选定候选带入四步闭环：

0. **产品匹配**：根据客户画像召回候选，逐项输出匹配理由、限制、证据和状态；无法确证的推荐明确标为【待确认】。

1. **读懂客户**：区分明确输入、规则推断和待确认项，生成可用于后续动作的客户画像。
2. **写出内容**：按公众号、小红书、朋友圈的差异生成内容准备稿，产品事实逐条带来源。
3. **给出方案**：用四步规则演算四级价格，并给出 0–30 分钟可执行的演示计划。
4. **推成交**：输出带负责人、触发条件、依赖项和人工确认边界的下一步动作。

当前版本支持**按请求显式启用**云端模型、IMA OpenAPI 知识库检索和联网公开网页抓取。云端模型默认配置为 `deepseek-v4.1-flash`；凭据仅从本地 `.env` 或部署环境变量读取。结果仍用于演示和人工复核，不冒充真实成交建议。

## 公开演示

- 魔搭空间：<https://modelscope.cn/studios/philosophia/promotion-agent>
- 公网入口：<https://philosophia-promotion-agent.ms.show>

公开云端由魔搭免费 Docker CPU 托管网页和同源 HTTP 接口。配置凭据后，页面可分别启用云端模型推理、IMA 检索和联网抓取；未配置时会明确标记不可用。页面可访问不等于正式报价、真实图片、客户咨询或销售转化已经验证。

## 运行

环境要求：Python 3.11+、Node.js 20+。本项目只使用 Python 标准库，不需要 `pip install`。

```bash
python backend/main.py
```

浏览器打开 <http://localhost:7860>。也可以运行：


```bash
bash start.sh
```

页面内按 `Alt+1`、`Alt+2`、`Alt+3` 可填入合成示例。服务只监听本机，客户输入仅用于当前内存会话，20 分钟后过期。

## 外部能力配置

复制 `.env.example` 为 `.env`，或由部署平台注入同名环境变量：

- `CLOUD_MODEL_*`：OpenAI-compatible 云端模型，默认 `deepseek-v4.1-flash`。
- `IMA_OPENAPI_*`：IMA OpenAPI Client ID、API Key、服务地址和默认知识库 ID。
- `WEB_RESEARCH_*`：联网检索开关、搜索入口、超时与正文大小限制。

真实凭据只保存在本地或部署平台的秘密配置中；`.env` 已被 Git 和 Docker 忽略。页面可在每次请求中分别勾选云端模型、IMA 和联网检索，未勾选时不会调用对应服务。

## 验证

```bash
node --test tests/product_match.test.js
python -m unittest discover -s tests -v
```

真实 HTTP 冒烟（会启动本地端口）：

```bash
HUAWEI_HTTP_SMOKE=1 python -m unittest discover -s tests -v
```

PowerShell 写法：

```powershell
$env:HUAWEI_HTTP_SMOKE='1'; python -m unittest discover -s tests -v
```

## 目录与分工

进入目录开始工作前，先阅读该目录的 `README.md`；文件级负责人和修改边界以项目根目录《文件归属与责任矩阵》为准。

| 目录 | 责任 | 说明 |
| --- | --- | --- |
| `frontend/` | C 前端 | 原生页面、交互、结果与来源展示；见 `frontend/README.md` |
| `backend/` | A Agent 核心 + B 后端接口 | HTTP 网关、会话、Agent 调度和四步业务；见 `backend/README.md` |
| `backend/api/` | B 后端接口 | 同源 API、异常、限流和上传拒绝；见 `backend/api/README.md` |
| `backend/agent/` | A Agent 核心 | 主/子 Agent 调度、提示词、工具和模型调用；见 `backend/agent/README.md` |
| `backend/agent/contracts/` | B 后端接口 | 前后端、Agent 和价格接口契约；见 `backend/agent/contracts/README.md` |
| `backend/agent/prompts/` | A Agent 核心 | 主/子 Agent 提示词参考；当前云端适配器使用内嵌受约束提示词 |
| `backend/rag/` | A + D | A 维护检索代码，D 提供清洗数据、切片和索引；见 `backend/rag/README.md` |
| `backend/session/` | B 后端接口 | 会话、聊天历史、过期和持久化；见 `backend/session/README.md` |
| `tests/` | A + E | A 维护自动化脚本和联调，E 协助全流程验收；见 `tests/README.md` |
| `assets/` | C 前端 | 前端可见的答辩截图和演示资产；E 复核公开描述，不收未授权素材 |

数据、测试原始样例和 Agent 规范在并行目录 `../huawei-sales-agent-data/`，运行区不复制原始 ZIP、客户数据、日志或模型权重。

## 数据与真实性边界

- 数据源：`任德耀新建华为 PC 知识库`为主，原库保留去重别名；产品参数与价格参考优先华为官网/商城快照。
- 每条产品事实保留来源条目、SHA-256、适用型号和抓取时间；官网快照有效窗口为 7 天，过期即阻塞。
- 当前公开价格、完整 SKU 和正式图片仍待核实：`public_price_reference=null`、`actual_transaction_quote=false`、正式图片数为 0。
- 四级价格是**基于行业惯例与赛题推断的可配置假设模型**，基价、折扣、资格、地区均为人为设定，待官方确认；演示金额不是华为真实政策或交易报价。
- 咨询与转化效果没有真实数据，不报告提升；30 分钟演示是待执行计划，`onsite_within_30_minutes_verified=false`。
- IMA OpenAPI 已接入并完成只读知识库搜索验证；产品匹配保留请求 ID、知识库 ID、媒体 ID 和元数据指纹。仅有标题或摘要时只能作为 E3 线索并标记【待确认】；写入、导入和全量正文提取未在本轮验证。
- 真实成交价、完整 SKU、库存和软件兼容性清单仍可能缺失；产品匹配不会用模型常识补齐这些信息。

## 已知缺口

- 产品匹配的 `backend/agent/prompts/product-match.md` 已进入受控云端理由选择链路；四步营销策略和事实选择提示词仍内嵌在 `backend/agent/model.js`，并经过输出核验。
- 客户端图片候选未完成画面、SKU 与版权核验，不能作为正式配图。
- 公开演示只接受合成或脱敏文本，拒绝文件上传，避免客户隐私落盘。
