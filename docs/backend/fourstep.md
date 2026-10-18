# 四步离线演示与精确合成报价

本模块使用marketing契约与独立报价扩展。依赖 Node.js、本地 Ollama qwen2.5vl:7b、C 的本地知识索引与官网快照；无新增 npm 包、付费服务或魔搭调用。IMA已按用户要求彻底停用，旧输入即使选择ima且凭证齐全也不调用。

```powershell
node fourstep.js --input outputs/D/synthetic-stage2/official-account-input.json --pricing-input outputs/D/synthetic-stage2/pricing-demo-input.json --policy outputs/D/synthetic-stage2/pricing-demo-policy.json --output outputs/D/四步新结果.json
```

运行后真实写入新 JSON 和同名 Markdown，标准输出为同一 JSON。输出仅允许 outputs/D/ 内新文件，不覆盖历史、拒绝符号链接。退出码0表示 demo_ready，3表示需处理输入、环境或安全阻塞。运行计时仅证明生成准备文件耗时，不证明现场30分钟完成。

## 四步行为

1. 客户分析：保留原画像明确/推断/待确认及输入指针证据，不从演示报价假设反推客户身份、数量或预算。
2. 写出内容：正文直接展示受控营销准备稿的标题/导语/正文/CTA及程序化受控声明，完整来源与待核验图片留在附录。
3. 给出方案：四级客户类型、采购数量、产品配置、区域来自可编辑纯 policy JSON。`--policy` 仅可覆盖 demo_only 输入。保存政策快照、合成资格键、基价及每级来源；BigInt整数分计算、逐级半入到分、优惠封顶、互斥和资格缺失阻塞。保留比例9000为九折，四级后乘数量并检查安全整数，预算未知不等于0。演示计划给目标/物料/角色/0–30分钟输入操作输出验收失败替代；人员及现场计时待填写。
4. 销售推进：按客户阶段输出触发条件、责任人和依赖；不会自动联系客户，也不报告转化提升。

产品名称在营销/报价中必须完全一致，否则组合金额阻塞；客户明确 `customer.budget.quantity` 与演示数量不一致也阻塞，不静默覆盖。演示SKU是人为配置，并不证明真实配置存在；真实销售仍需完整SKU与资料核对。报价假设属于独立输入，不补入原画像。marketing_result 中真实 quote.amount 继续null。

## 假设与预期演算

**此为基于行业惯例与赛题推断的合理假设，待官方确认。** 未取得行业实证、真实门店四级价格或华为授权，synthetic_fixture不能成为实际政策证据。

示例 policy 的基价6000元、5台、16G/512G演示配置、日期、地区、税制及以下四级数值全部人为定义：600000分 → 客户类型9.8折（保留98%，9800bps）为588000分 → 数量每台减10000分为578000分 → 配置100%保持578000分 → 地区9.9折（保留99%，9900bps）理论优惠5780分，受本级5000分封顶后573000分。单台5730元，5台合计28650元。样例总预算30000元也是合成值，不是客户预算证据。

每条规则的 required_eligibility 为合成确认键，缺少任意键则阻塞；这些键不认证真实资格。配置文件定义具体固定场景，数量变化时应同步选择对应假设政策，不能当作完整企业价格决策树。

独立81元算术夹具在 `outputs/D/synthetic-stage2/pricing-arithmetic-81.json`，与营销产品不同，不可用于整合演示；仅用于10000→9000→8100→8100→8100分计算验证。

## API 与边界

`backend/marketing/pricing.js` 导出同步 `calculatePricing(input)`，严格按 B pricing v1.0 输入/输出；真实 mode=real 没有授权注册表，永远 blocked且两金额null。`validateExtended` 补足原校验器的真实日期、maxItems、uniqueItems、anyOf与安全整数检查。非法输入返回 invalid_input，合法输入业务前提不符返回 blocked。

`backend/marketing/fourstep.js` 导出异步 `runFourSteps(marketingInput, pricingInput, options?)`、`cli(args)`、`renderMarkdown(result)`。`options.marketingRunner`仅供确定性整合测试注入，不能作为真实模型证据。默认运行真实本地模型。四步 JSON 为独立 `fourstep-demo-1.0` wrapper，内含原契约的 marketing_result、pricing_result，不冒称 B 已定义四步正式契约。

本轮新增 `official_reference` 侧栏，保留官网完整代际规格、抓取时间、原文路径/hash、公开价格参考或未知原因。公开参考不补写合成policy基价，合成报价与真实交易价null分别展示。第三步先展示官网证据，再展示明确提供的假设四级或缺规则提示。`runFourSteps`省略pricingInput时仍生成客户、内容与方案准备，pricing为blocked/null、PRICING_INPUT_REQUIRED，不自动补合成规则，不制造CROSS_PRODUCT_MISMATCH；Web按可选输入使用此行为。CLI原显式两输入用法不变。

所有自由模型叙述仍受 D001 降级边界：真实模型用于策略与事实选择，最终叙述为程序化核对式准备稿。图片未视觉/SKU/版权核验，正式图片数量为0。IMA、真实报价、现场30分钟与转化效果须分开报告缺口。

最终修复后模型生成接口仅请求 `fact_ids`，不再生成随后丢弃的自由标题或CTA。事实选择、完整来源/条件、实际程序化叙述分别独立核验，错误或重复ID与型号不一致均阻塞。四步包装不修改这些核验结果，也不因合成演算完成而将被阻塞正文标为成功。
