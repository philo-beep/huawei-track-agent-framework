# 营销 CLI 契约 v1.0

适用阶段：本地知识库与华为官网快照的营销开发、画像专项验证。2026-10-18 本轮用户指令已停用 IMA；旧 ima 字段仅为历史结果可读和输入兼容保留。契约不是功能完成证明，不表示已实现真实四级报价或已验证咨询转化。版本：1.0 兼容扩展。唯一机器字段定义见 `contracts/marketing-input.schema.json` 与 `contracts/marketing-output.schema.json`。修改破坏性字段须升级契约并通知 D、C、QA、E。

## 调用与状态

由根入口转交 D 的实现：`node main.js --input <input.json> --output <result.json>`。UTF-8 JSON 输入，标准输出为唯一 JSON 结果，日志仅标准错误且不含凭证、客户原话全文或知识库全文。若省略 output，不落业务结果文件。输出文件及修改来源必须在工作区授权输出目录，不覆盖源码、凭证、原始知识库或任意外部路径。CLI 不开放 HTTP 接口，不引入前端或新的登录系统。

退出码：0 为 `ready`，2 为 `needs_clarification`，3 为业务阻塞 `blocked`，1 为程序错误。所有可解释业务失败仍输出契约 JSON。输入 JSON 语法错误也应安全返回错误，不打印原始输入。`ready` 仅指当前营销内容可用，不表示报价、完整四步或正式参赛合规完成。

`mode` 缺失默认 `local`；其余业务字段没有隐含默认值。`schema_version` 缺失按 1.0 规范化。JSON Schema 的 default 仅描述归一化约定，校验器不会自动填值。开发阶段不调用、不依赖、不配置魔搭，模型由本地已授权服务提供。

| 模式 | 来源与行为 | competition_readiness |
| --- | --- | --- |
| local | 通用知识优先任德耀本地库；价格参考、参数、配置优先华为商城/官网的可追溯快照。旧库仅去重别名，不算独立佐证 | 固定 offline_only（历史字段名，不表示禁止读取官网快照） |
| ima（旧输入兼容） | 不发起 IMA 请求，不读取鉴权配置或尝试连接；即使环境已有凭证也有效降级为 local，并记录替代诊断 | 固定 offline_only |

输出 `requested_mode` 保存原始请求模式；当前运行 `mode` 固定 local。旧请求 ima 必须 requested_mode=ima、mode=local、ima_connection=not_connected，附 IMA_REPLACED_BY_LOCAL_OFFICIAL 诊断，文本说明“IMA 已由本地知识库 + 华为官网替代，来源标注已保留”；本地/官网资料可用时继续流程。普通本地请求为 requested_mode=local、mode=local、ima_connection=not_requested。任何凭据存在都不能触发 IMA 请求或重试。Schema 保留历史 mode=ima 分支仅为旧结果校验兼容，不构成当前运行授权；替代方案不能冒称真实 IMA 接入或自动增加官方评分。

不生成或伪造 IMA 库 ID。官网快照不伪装 ZIP 条目；来源模式为 official_snapshot，可同时保留本地背景事实各自的真实 source_refs。该枚举仅表示使用官方快照，不证明资料新鲜、配置准确或具有成交资格。

官网 source_refs 继续使用已有结构：title 为页面标题，archive_aliases=[]，entry 为真实快照相对路径或页面逻辑位置，entry_sha256 为保留原文的 SHA256，urls 为实际原始页面 URL，excerpt 为对应原文。抓取时间、具体型号/SKU、价格适用条件、有效期/新鲜度判定和冲突记录保存在受控内部 sidecar 并随证据索引交付，不新增营销 API 必填字段。不能只有商城首页、搜索摘要或无原文的价格。官网不可达、配置不明或资料过期时应标待核实，不以历史库价格、起售价或补贴估算冒充可成交价。图片同样保留原页面/图片 URL、原文或定位与来源哈希；来源齐全仍不等于型号及使用权已审核。

## 最少输入与推荐输入

机器输入允许空对象，让程序返回追问而非伪造缺失字段。能进入生成的最少语义信息为：明确产品型号、目标人群或一句话客户描述、具体使用/业务场景、三个支持平台之一。既可分别用 product/audience/scenario/platform 输入，也可由 raw_request 的明确文字抽取；无法唯一确定就追问，不从产品名猜行业、不从平台猜年龄/收入、不从语气猜规模。复杂客户原话与结构化字段冲突时追问，不能默认结构化字段或较后出现者胜出。

推荐增加 customer：身份/角色、新老客、行业/规模、需求目标、预算和数量、决策链、偏好、痛点、购买阶段、可触达渠道。字段缺失为 pending。预算、采购数量、地区或价格资格缺失阻塞报价，不阻塞已有充分信息的无价格内容。负预算、数量非正整数属于 INVALID_INPUT；区间下界高于上界、币种不明、单价/总额不清、极端或冲突预算必须澄清，不自动纠正、不视为零、不推算支付能力。

```json
{
  "schema_version": "1.0",
  "mode": "local",
  "product": "HUAWEI MateBook Pro",
  "audience": "首次咨询的设计公司采购负责人",
  "scenario": "为移动办公选型，先了解跨设备协作限制",
  "platform": "公众号",
  "customer": {
    "identity": "采购负责人",
    "relationship": "新客",
    "industry": "设计服务",
    "needs": ["移动办公", "核对现有软件兼容性"],
    "decision_chain": ["采购负责人收集方案，最终审批人待确认"]
  }
}
```

该片段为虚构测试输入，不是真实客户、实际检索或运行输出。客户输入不成为产品事实来源。

## 画像维度与证据

画像每维固定 `{value,status,evidence,reason,confidence}`。status 为 explicit（输入明确陈述）、inferred（有根据的暂定判断）、pending（缺失/矛盾/无法确认）。evidence 为 `{input_path,quote}` 列表；input_path 使用 JSON Pointer，quote 为该字段或原话的真实子串，对数组原文可用 `/customer/needs/0`。已知值不能无证据，不能引用模型自述当输入证据。pending 的 value 必须 null、confidence 必须 0，缺失可以空 evidence，冲突应保留双方原话。confidence 是证据完整性的自述指标，不是经校准的概率，不得用高值抵消缺证据。

| 维度 | value 与后续用途 | 不允许的推断 |
| --- | --- | --- |
| identity | 客户身份/岗位/本次角色；决定沟通角度 | 从姓名、平台、语气推断真实身份 |
| relationship | 新客/老客；决定复述和已有关系核对 | 老客直接等于续约阶段 |
| industry | 行业；对应工作流与兼容性问题 | 从预算或产品猜行业 |
| company_size | 员工/门店/设备等明确规模口径 | 预算高就写大企业 |
| needs | 任务、目标、优先级；指导卖点筛选 | 将推测当已确认需求 |
| budget | 对象包含已知 min/max/currency/scope/quantity；支持报价准备度 | 未知写 0、补币种/数量、从规模估预算 |
| decision_chain | 使用者、建议者、审批者、采购者及已知权限 | 联系人就是最终决策者 |
| preferences | 有证据偏好；影响表达/选型问题 | 写成未经证实的人格或消费标签 |
| pain_points | 当前障碍；驱动内容切入和问诊 | 将教学案例套成真实客户痛点 |
| purchase_stage | 咨询/比较/审批/续购等；驱动 CTA | 新客必然首次购买，老客必然复购 |
| channels | 客户真实可触达渠道；指导跟进 | 文案发布平台自动等于客户联系方式 |

身份、行业、规模、预算、决策链、实际可触达渠道必须 explicit 或 pending，不能凭模型推断。needs/preferences/pain_points/purchase_stage 可以有证据地 inferred，但正文不能将其陈述为确认事实，应以假设或追问表达。relation 的新/老客同样需明确陈述。平台修改仅改变内容策略，不改变已有客户事实。所有未确认字段均应有对应问题或解释其为何暂不影响内容。

产出判定：十一维齐全；每个非空值可回查输入；冲突先追问；不用虚构身份/预算填完整度；明确内容可生成与报价可生成两个不同门槛；至少一项下一步动作含责任人、触发条件和待确认依赖。多轮画像调优由 QA/E 用独立样例验证，不把契约定义或单个样例称为已通过多轮调优。

## 四部分统一输出与证据

1. `scenario_judgment`：目标人群、使用场景、用户问题、内容目标、平台和可解释策略。策略应给出切入点、卖点顺序、结构、语气、配图数量与 CTA；不得宣称掌握推荐算法或保证咨询。
2. `knowledge_basis`：产品、来源模式、逐事实 claim/conditions/source_refs。本地事实保留原文摘录、资料标题、来源库别名、ZIP 内条目、内容哈希及可用原始 URL；官网事实按上面的真实快照映射保留原文、URL、哈希和内部元数据。不同库同字节版本保留双别名，不计两份独立佐证。不得将官网替代源写成 ima 证据。
3. `marketing_content`：标题/导语/正文/CTA、使用的 fact_ids 与图片名称/来源/插入位置/说明。未知型号图不能入成稿；只有经资料核对型号匹配才 model_verified=true。未选图片可以 images=[]，但必须在核验中 pending，不可默认为正式完整图文。平台要求公众号 2–4、小红书 3–6、朋友圈 1–3 张；缺图应明确未满足，不能拿错图填数。
4. `verification`：产品事实、图片型号、营销合规、待确认信息及问题。核验不是 LLM 自称通过，须校对所有型号/参数/限制/价格、事实引用、图片和违规内容。任何资料冲突、未证实事实、违规宣传或引用不存在必须阻塞成稿；不得只列红旗同时交付未经处理正文。

渲染 Markdown 使用“一、场景判断／二、知识库依据／三、图文软文／四、核验结果”四个标题；画像、追问与销售准备分别归入第一和第四部分，不能用销售扩展替代任何必需部分。阻塞时仍保留四部分位置，第三部分说明未生成且 JSON marketing_content=null。

`sales_preparation` 是准备信息：当前版本 quote.status 固定 blocked、amount 固定 null；即便客户预算完备或有公开价格快照也不能绕过缺失的真实四级政策。required_information 至少列四级定义/数值、资格地区、叠加互斥/顺序、税费/舍入/上限、有效期及授权依据。demo_plan 只有准备清单；elapsed_seconds 可计本次运行耗时，不能等于人工方案交付耗时，within_30_minutes_verified 固定 false。next_actions 是建议，不自动发消息、预约或联系他人。conversion_effect 固定 not_measured；代理质量测试只能检验 CTA 等，不能证明带来咨询。

## 错误和修改重生成

| code | 处理 |
| --- | --- |
| INVALID_INPUT | JSON/类型/不允许平台/负预算等不合法，安全报错；重填后执行 |
| NEEDS_CLARIFICATION | 产品、人群、场景、平台缺失/冲突；只问关键缺口，成稿为 null |
| IMA_REPLACED_BY_LOCAL_OFFICIAL | 旧 ima 请求保留 requested_mode，实际 local/not_connected，IMA 请求数为零；采用本地库与官网快照，不读取凭据、不索要授权 |
| KNOWLEDGE_NOT_FOUND | 明确无对应型号/事实；不以相似型号替代 |
| SOURCE_CONFLICT | 保留冲突双方来源；停止生成，待人工确认 |
| MODEL_UNAVAILABLE / MODEL_TIMEOUT / MODEL_OUTPUT_INVALID | 有界失败，不改用付费/魔搭；无成稿 |
| FACT_VERIFICATION_FAILED / COMPLIANCE_FAILED | 拦截不支持的事实或营销违规，未通过正文不作为成果输出 |
| IMAGE_EVIDENCE_INCOMPLETE | 图片数量不足/型号不明；标记待确认，不报图文已完整 |
| PRICE_RULES_MISSING | 报价阻塞但无价格营销内容可继续；金额 null |
| REVISION_INVALID | 历史结果不存在、版本不符、越权路径或要求篡改事实；拒绝执行 |

`revision.previous_result_path` 仅引用本项目允许输出目录中的上一份同版 JSON；`instructions` 允许改场景/平台/文风。重新运行事实检索、画像证据校验、图文核验与合规，不能仅改旧正文或沿用旧核验 pass。临时改平台可保持已有画像事实；显式更改客户事实须记录新的输入来源，冲突时追问。不能把历史模型输出当原始客户证据。stdout 不输出检索全文、调试令牌或异常调用参数。
