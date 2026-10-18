# 云端明确规格关联（IMP-D-RELEVANCE-001）

规则引擎只选择最先明确且有证据的一个规格事实，不调用模型，不证明选型适配或客户效果。`cloud-fact-selector.js` 仅供云端 `cloud-runner.js` 使用，本地D001共享知识提取与核验文件保持不变。

## 选择范围与顺序

先按 `raw_request` 原句顺序，再按 `scenario` 补充；人群描述不当作规格需求。有限词表识别内存、屏幕/分辨率、存储/硬盘/SSD、处理器；必须存在对应标题的当前已核验事实才可选。屏幕资料只覆盖分辨率。只选一个事实ID，继续调用既有 `composeContent` 和严格原文、脚注、型号及营销合规核验，不重排结果或改写事实。

操作系统、软件兼容性、续航、电池、重量、便携性、触控与护眼等词命中时，若没有本轮可用字段，显式记为未覆盖。只问操作系统时，正文为null、营销状态 `needs_clarification`。操作系统和内存混合时，无论先后都仅回答已有证据的内存，正文开头显著写操作系统未覆盖，不把内存当作系统问题的替答。其他明确且有证据的规格本轮暂不核对，列入deferred。完整资料附录仍含全部已核验候选事实，附录不代表逐项需求已回答。

按分句识别“不关心/不需要/不是问/不想看/不是来问/别介绍”等前置否定及“内存不重要/不关心”等后置否定；“不是问硬盘，是问分辨率”只选分辨率。同规格正反表达并存、复杂双重否定保守澄清。此为有限规则，不是完整自然语言理解，不判定容量选项已满足要求，不由出差/课堂等场景推导硬件需求。无明确正向规格偏好时可给一条未被明确排除的通用原文，正文显著写“通用资料，非适配推荐”；若现有字段全部被排除，正文阻塞并请求澄清。原有最少语义缺失仍澄清。未知预算不会触发价格需求；纯价格/政策请求缺真实依据则阻塞正文，真实报价始终null。

## 既有字段

- `marketing_result.scenario_judgment.strategy.fact_selection`：status、focus、evidence、uncovered、deferred、notice；沿用允许任意对象的strategy，不扩契约。
- focus/evidence保留输入字段路径、可精确定位的原句、规格名称和否定标记；客户原句只作数据，不执行其中指令。
- `marketing_result.diagnostics`：`CLOUD_FACT_MATCHED/PARTIAL/GENERAL_REFERENCE/UNSUPPORTED/NEEDS_CLARIFICATION` 给固定行为说明，`CLOUD_FACT_INPUT_EVIDENCE` 的message记录JSON原句依据及覆盖范围。
- 正文阻塞时增加既有澄清问题；部分答复时在正文和诊断列出未覆盖项。正文为null的状态符合原营销契约。三个marketing_content引用继续一致，Markdown附录保留诊断，JSON/Markdown导出来自同一结果。

`outputs/D/cloud-relevance-check.cjs` 为合成输入的真实规则流水线回归，覆盖两型号三平台、最先明确顺序、否定/转折/冲突、系统单独及混合、未知预算、纯价格、通用参考、原文/脚注及引用一致性。它不调用模型或IMA，不代表公网已发布、真实场景通过或比赛评分增加。原云HTTP与代理安全检查另行回归。
