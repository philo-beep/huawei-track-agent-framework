# 华销智策 —— 针对华为的销售智能体

> 销售顾问请先阅读 [销售顾问使用说明](销售顾问使用说明.md)。本文其余内容同时包含研发、数据与验收说明。

本项目面向华为销售顾问，先根据脱敏客户画像完成 IMA/本地产品匹配，再把选定候选带入四步闭环：

0. **产品匹配**：根据客户画像从 IMA 与规范产品注册表召回候选，逐项输出匹配理由、逐字证据片段、限制、逐条件覆盖和状态；无法确证的推荐明确标为【待确认】。

1. **读懂客户**：区分明确输入、规则推断和待确认项，生成可用于后续动作的客户画像。
2. **写出内容**：按公众号、小红书、朋友圈的差异生成内容准备稿，产品事实逐条带来源。
3. **给出方案**：用四步规则演算四级价格，并给出 0–30 分钟可执行的演示计划。
4. **推成交**：输出带负责人、触发条件、依赖项和人工确认边界的下一步动作。

## 逐步客户画像

页面先通过逐题访谈补齐客户画像：每轮只展示一个问题，客户回答后交给已配置的 `deepseek-v4.1-flash` 分析，再决定下一问。程序独立执行以下终止规则：

- 核心维度覆盖达到阈值（至少 6 个维度、其中至少 5 个核心维度）；
- 剩余待确认缺口不超过 2 项；
- 最多 8 轮追问，达到上限即基于现有信息生成画像。

每个画像字段保留客户原话证据；模型提取缺少可定位原话时自动降级为【待确认】。预算、采购权限和决策链不由模型补造。画像完成后可一键带入产品匹配。

接口：`POST /api/profile-steps`，复用 `GET /api/runs/<job>` 查询；契约为 `backend/agent/contracts/guided-profile-*.schema.json`。

当前版本支持**按请求显式启用**云端模型、IMA OpenAPI 知识库检索和联网公开网页抓取。云端模型默认配置为 `deepseek-v4.1-flash`；凭据仅从本地 `.env` 或部署环境变量读取。结果仍用于演示和人工复核，不冒充真实成交建议。

## 多平台内容生成

当前固定回归两款具体型号：`HUAWEI MateBook 14 鸿蒙版` 与 `HUAWEI MateBook 14 2024（酷睿 Ultra）`；同一候选可按三个平台生成不同结构的审稿稿：

- **公众号**：分层长文，最多 3 条可回溯事实，默认 4 张精确型号审稿图。
- **小红书**：短段落任务清单，最多 2 条事实，默认 3 张审稿图。
- **朋友圈**：短帖，最多 1 条事实，默认 1 张审稿图。

产品匹配结果中的每个候选都可进入“生成内容草稿”：

- 服务端重新执行产品匹配，按 `candidate_id` 校验候选、客户画像和 E1 证据，不信任前端传来的现成正文。
- 产品事实逐字取自可定位原文，并在 JSON 与 Markdown 中保留事实 ID、来源条目、URL 和 SHA-256。
- 图片只从 `datasets/cleaned/image_review_registry.json` 中选取**具体型号一致**的 IMA 条目；每张图给出画面说明、原图 URL、产品页面、IMA 条目和指纹。目标型号无精确图片时降级为纯文字，不借用另一型号。
- 草稿正文用 `<!-- IMAGE:... -->` 标注插入位置，并另附图片来源清单和插入建议。
- 客户预算只与同型号公开价格快照做“待确认”比较，`current_transaction_quote=false`；不把快照写成成交报价。
- 当前图片核验是 AI 辅助视觉核对，授权和人工终审尚未完成，因此输出固定为 `ready_for_review`、`publication_ready=false`；不得当作已获准发布的正式图文。
- 生成结果同时返回公众号、小红书、朋友圈三套纯文本分块；标题、正文、标签可分别复制，任一平台也可整套复制。内容区提供“快速查看全文”和逐块“查看全文”，在可滚动的完整视图中阅读、复制单段或复制全部文案。
- 服务端读取图片实际像素和比例，按平台检查标题/正文字数、标签数量、图片数量与尺寸、排版结构；规则为本项目本地建议，不声称是平台官方 API。
- 封面文案区分 2.35:1、3:4、1:1 三种版式；封面只使用已核对型号与任务词，不写绝对化效果承诺。
- 当前 4 张精确型号图片仍是授权待补的审稿素材。`/api/runs/<job>/images.zip` 提供含图片、像素、比例、来源与授权状态的**内部审稿包**，不会把待授权素材标成“已授权图片包”。
- 页面保留最近 5 次生成结果供本次登录内复用；“导出门店任务包”会一次导出三平台文案、封面文案、发布检查和图片清单。

接口：`POST /api/content-drafts`、`GET /api/content-images/<sha256>`、`GET /api/runs/<job>/images.zip`、`GET /api/runs/<job>/export?format=json|markdown`。输入输出契约为 `backend/agent/contracts/content-generation-*.schema.json`；输出 v1.4 新增 `publication_readiness` 的三平台复制分块、封面文案、图片审稿包和发布检查。

## 发布前强制核验

所有平台内容结果在返回前必须经过同一门禁，不允许由前端或调用方跳过：

1. 型号：候选、发布型号与 E1 证据中的具体型号一致。
2. 参数：每条参数事实逐字存在于来源原文，限制脚注同步保留。
3. 价格：不发布未经当前口径确认的金额、成交价、优惠或折扣。
4. 图片身份：图片必须与具体型号匹配，文件指纹、原图 URL、IMA 条目和发布授权完整。
5. 超范围承诺：拦截绝对化、效果、成交和未经证实的兼容承诺。
6. 来源完整性：事实与图片保留来源名称、具体条目、公开 URL 和 SHA-256。

冲突处理只有两级：

- **阻塞**：型号错配、事实无法回溯、核心文案含未核验价格或超范围承诺、来源链缺失。不得生成可发布版本。
- **降级**：问题可在不改变事实的前提下剥离，例如图片授权未完成、正文出现可删除的价格段落、正文出现可删除的夸大句。安全版本会移除对应内容并保留风险说明。

接口结果中的 `verification.items` 返回六项“通过/不通过/降级”，`verification.risk_items` 返回问题、等级与处理建议，`verification.safe_content` 返回移除降级项后的最终安全文本。原始稿仍只用于审稿；发布责任人必须完成最终确认，不得把自动核验写成已自动发布。
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
node --test tests/guided_profile.test.js
node --test tests/product_match.test.js
node --test tests/content_generation.test.js
node --test tests/extension_regression.test.js
node --test tests/release_verification.test.js
node --test tests/content_api.test.js
$env:HUAWEI_DATA_ROOT="../huawei-sales-agent-data"; node tests/verify_product_data.js
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
- 当前公开价格、完整 SKU 和正式图片仍待核实：`public_price_reference=null`、`actual_transaction_quote=false`、正式图片数为 0。新增的 4 张 MateBook 14 鸿蒙版图片仅为“精确型号匹配、辅助视觉核验、待人工与授权确认”的审稿配图建议。
- 四级价格是**基于行业惯例与赛题推断的可配置假设模型**，基价、折扣、资格、地区均为人为设定，待官方确认；演示金额不是华为真实政策或交易报价。
- 咨询与转化效果没有真实数据，不报告提升；30 分钟演示是待执行计划，`onsite_within_30_minutes_verified=false`。
- IMA OpenAPI 已接入并完成只读知识库搜索验证；产品匹配保留请求 ID、知识库 ID、媒体 ID 和元数据指纹。仅有标题或摘要时只能作为 E3 线索并标记【待确认】；写入、导入和全量正文提取未在本轮验证。
- 产品匹配已加载规范产品注册表、结构化事实、报价与兼容性数据质量文件；当前 73 个产品中 10 个有完整事实、63 个仅目录发现，当前成交报价和兼容记录仍为 0。
- 真实成交价、完整 SKU、库存和软件兼容性清单仍可能缺失；产品匹配不会用模型常识补齐这些信息。

## 已知缺口

- 产品匹配的 `backend/agent/prompts/product-match.md` 已进入受控云端理由选择链路，模型必须返回逐字 `cited_span`，由程序验证其存在于所引产品证据。四步营销策略和事实选择提示词仍内嵌在 `backend/agent/model.js`。
- 客户端原始图片候选仍全部保持 `model_verified=false`；单独的图片审稿清单只允许精确型号图片进入草稿，且 `publication_ready=false`。
- 公开演示只接受合成或脱敏文本，拒绝文件上传，避免客户隐私落盘。
## 访问控制与首次使用

启动后打开首页，先进入品牌化预登录页；点击“进入销售工作台”后登录或注册。系统不提供默认账号密码，首个注册账号自动成为管理员，后续账号默认为成员。

- 管理员：运行分析、进入“用户与权限”调整角色或停用账号。
- 成员：运行分析。
- 只读：可登录查看界面，运行按钮禁用，服务端拒绝分析请求。

账号和会话保存在项目根目录 `.runtime/auth.json`（已忽略、不提交）；密码仅保存加盐派生值，会话使用 HttpOnly Cookie 和会话级 CSRF。如需指定持久化位置，可设置 `HUAWEI_AUTH_FILE`。服务重启不会丢失账号与有效会话；临时运行结果仍按原规则存于内存并过期。