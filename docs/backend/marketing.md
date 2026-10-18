# 阶段二营销后端运行说明

这是 Node.js 24 的本地命令行后端。2026-10-18新授权已停止IMA调用：即使旧输入指定mode=ima且提供凭证也不会调用IMA。任德耀本地知识库用于通用内容；华为官网/商城经型号、时间、原文与哈希核验的本地快照优先供参数及公开价格参考。调用本机 Ollama 的 `qwen2.5vl:7b`，不使用付费云 API、魔搭、训练或微调。合成案例和画像专项不是实际咨询转化或正式比赛达标证明。

## 启动与输入

在项目根目录，使用 C 已构建的 `.collaboration/runtime/local-kb/index.json`。没有索引时由数据维护者执行 `python data/build_local_index.py build`。模型必须已在本机 Ollama 可用；程序不会下载模型。支持 Node.js 24、Python 3.11+，业务实现没有额外 npm 包。

```console
node main.js --input outputs/D/synthetic-stage2/official-account-input.json
node main.js --input outputs/D/synthetic-stage2/official-account-input.json --output outputs/D/new-result.json
```

输入唯一契约见 `contracts/marketing-input.schema.json`，输出见对应 `marketing-output.schema.json`。最少需要明确产品完整型号、目标人群或客户描述、具体场景和平台（小红书/公众号/朋友圈），既可结构化提供，也可从 `raw_request` 的明确原话抽取。缺失只提出关键追问，不补造客户。推荐提供 `customer` 十一维输入：身份、关系、行业、规模、需求、预算、决策链、偏好、痛点、阶段、可触达渠道。

stdout 始终为一个业务 JSON，退出码 0=当前无价格文字稿可用、2=需澄清、3=被安全阻塞、1=程序错误。ready 不代表图片、真实报价或赛事全部要求通过。指定 `--output` 时，实际同时生成同名 `.json` 与 `.md` 阅读稿；两条目标路径都先检查不存在且无符号链接，只允许 `outputs/D/` 内新文件，不覆盖历史结果、源文件或外部路径。省略输出参数则只返回JSON。输入/解析/模型/检索错误不输出原始异常参数、凭证或客户全文日志。

## 模块与验证

`backend/marketing/main.js` 导出 `cli(args)`、`runPipeline(input, options)`、`parseInput(input)`、`buildProfile(input)` 和 `renderMarkdown(result)`；根 `main.js` 只做 CLI 启动桥。`profile.js` 是确定性纯解析入口，供 QA 35 基础例及保留集多轮验证，不在每条画像测试重复调用模型。每个非空维度有输入 JSON Pointer 与真实子串证据；未知为 null/pending，冲突留双方依据，明确更正可更新员工数。采购数量不能自动作为员工规模；发布平台不能自动作为可触达渠道，老客不能自动等同续约。

完整流水线依次为：画像及最少输入校验→本地官网快照核验/任德耀知识库检索→带限定条件的原文事实提取→场景/平台策略模型→生成模型选择事实→独立事实与营销规则核验→四部分结果和销售准备。检索先于策略模型，便于无知识时提前失败。模型只连 `127.0.0.1:11434`，固定 `qwen2.5vl:7b`，`num_ctx=4096`、策略最多450 tokens、事实选择最多160 tokens、`temperature=0.1`、`keep_alive=0`，每次调用最长120秒。模型不可用、超时或资料冲突不重试；只有模型事实选择或实际叙述被独立事实/合规核验拒绝且错误属于模型时，记录 `MODEL_REPAIR_ATTEMPT` 并带具体失败标记纠正生成一次，再执行完整核验，仍失败则阻塞，不改用云端。

策略和生成是实际本地模型调用。八模块生成提示包含角色任务、场景、平台、知识、图片、生成、核验、合规。生成模型只返回 `{"fact_ids":["给定ID"]}`，产品事实由程序按选择插入原文；空白、未知或错误类型ID均拒绝，不自动替换或补选。`verifySelection` 单独核验事实选择及完整原文/脚注；`verifyGenerated` 独立核验真正采用的程序化标题/导语/过渡/CTA，直接调用旧自由文案核验函数仍严格拦截。兼容旧注入对象中的自由字段全部丢弃，不据其放行最终稿，也不再用其阻塞实际未采用的正文。最终选中原文和条件继续合规检查，正文和诊断 `MODEL_NARRATIVE_CONSTRAINED` 明示程序化来源；不能声称模型自由文案质量或合规已通过。公众号采用场景引导与资料分节，最多3个被选事实；小红书用短清单和最多2张文字事实卡；朋友圈最多1个较短核心事实。短平台卡片仅截取完整字段组合，保持该章节全部适用脚注，并明确是节选；原章节和全文放第二部分备查，不将片段当完整规格。事实条件只包含原文全局元数据/限制与本章节所有脚注，其他章节条件不误附正文，仍保留在完整来源原文。

核验检查 ID、原文子串与脚注完整性，拦截未绑定参数及明显营销违规；同型号多份原文同章节不一致会停止。该保守检测不能替代人工审核所有自然语言等价冲突和适用 SKU。最终引用事实和条件也接受营销规则检查；资料中的数值色域 `100%` 本身不当作保证用语。模型策略复述提示模板时标 `analysis_status=needs_editorial_review`，不假称充分策略推理。重放历史真实模型结果时须保存原始记录和时长，另记最终规则hash及 `real_model_rerun=false`；规则重放不算新模型调用。

`renderMarkdown` 始终输出“一、场景判断／二、知识库依据／三、图文软文／四、核验结果”，用画像表、来源与条件、正文、审核结果及销售准备供人工审阅，不要求阅读整段JSON。没有通过校验的正文为 null，不把失败草稿作为交付。双 ZIP 同字节仅保留双别名，不视为独立佐证；来源保留条目、哈希、URL、原文条件。当前图片全部未完成视觉、SKU与版权核验，正式图片列表为空；JSON候选以文件名、本地路径及逐图来源留在核验待确认项，Markdown另列“待核验候选，非正式配图”并引用本机原图，每张保留文件名、条目、双库别名及URL。图片绝对路径仅用于本机预览，不复制到公网，不凑张数、不冒充正式完整图文。平台图数要求分别为公众号2–4、小红书3–6、朋友圈1–3。

## 修改重生成

重生成重新提供原始输入，并增加 `revision`：

```json
{"product":"HUAWEI MateBook 14","audience":"移动办公用户","scenario":"移动办公选型","platform":"朋友圈","revision":{"previous_result_path":"outputs/D/synthetic-stage2/official-account-result.json","instructions":"改成简短朋友圈语气"}}
```

程序核对历史结果版本和允许路径，拒绝篡改事实/绕过核验，再重新检索、调用模型并核验。历史模型画像不回填为客户证据。此版本不从历史输出推断缺失输入，原始需求须随新请求保留；可改场景、平台和文风。输出采用新文件名，保留历史版本。

## IMA 已停用及来源替换

用户明确停止IMA。`ima.js`为硬停用兼容stub，所有已导出API直接返回IMA_DISABLED_BY_USER，不含网络或SDK子进程执行代码。main不再导入IMA适配器。旧请求mode=ima保留requested_mode=ima供审计，实际mode=local、ima_connection=not_connected，并记录IMA_REPLACED_BY_LOCAL_OFFICIAL；凭证是否齐全不影响停用，不读取注册表或客户端配置，也不再索要凭证。

本地引用将任德耀原ZIP别名优先展示，两个同字节ZIP仍保留全部原始别名、entry、hash、URL和图片来源，不当作两份独立佐证。官网仅消费C受控抓取清单 `data/official/manifest.json`，D不自行无限爬取。完整代际型号不同不能互换；泛称MateBook14不能自动当2024或鸿蒙版。官网快照失效、不可达、原文/hash不匹配或配置不明时标待核实，不能让历史价冒充当前价格。

公开零售价参考、起售价、合成四级演算和真实最终交易报价严格分离，原真实quote金额保持null。官网引用不满足赛事旧IMA硬要求的差异如实保留，不因此增加正式评分。

## 销售四步准备边界

输出提供客户分析、待确认报价准备、演示准备和下一步行动。真实四级报价规则缺失，`quote.status=blocked`、`amount=null` 固定；即便预算完整也不从快照或虚构优惠计算。演示只有清单，`within_30_minutes_verified=false`，运行秒数不是人工交付用时。下一步含责任人、触发条件和依赖，只是建议，不自动联系客户。`conversion_effect=not_measured`，不能称咨询或成交提升。

`outputs/D/synthetic-stage2/` 内输入为合成案例；真实本地模型结果及四部分 Markdown 用于本地审阅，包含本地资料证据，不应未经脱敏直接公开。画像 R0→R1→R2 专项由 QA 独立执行，报告在 `reviews/`；这不等于正式阶段三/四评分。
