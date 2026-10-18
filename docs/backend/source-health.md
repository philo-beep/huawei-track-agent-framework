# 公开来源有效期状态

`backend/marketing/source-health.js` 提供 `getSourceStatus({now?,manifestPath?})` 与 `sourceReadiness(status)`。默认只读现有官网清单；不联网、不刷新、不修改文件，不依赖本地私有知识库。`now` 为内部测试用毫秒时间戳，`manifestPath` 仅供程序内部指定隔离测试清单，HTTP不接受这两个参数。

每次状态调用都通过现有 `loadOfficialReference(product,null,{now,...})` 重新核验两代完整型号、官方域名、原始与提取文本实际SHA256、原文与字段、7天有效期及规格冲突；不复写该模块的判断、不扩大时效。只有其返回 `verified_model_snapshot`、可用文档与有效来源时该产品才 `ready`，否则 `needs_update`。两个型号都ready时顶层才ready。商城获取失败等局部诊断可以与有效规格ready同时存在，不把价格未知当作规格无效。

公开字段为 `status/checked_at/source_mode/freshness_window_seconds/products`。每产品含完整产品名、状态、检查时刻、`oldest_fetched_at/expires_at/valid_source_count/sources`，来源仅包含官方URL、抓取时刻及到期时刻。所有时间规范为UTC ISO，`expires_at` 为当前核验来源中最早抓取时间加7天，采用保守复核时点，不表示所有来源都已在该时点过期。到期边界由原核验器决定（超过7天才拒绝）；展示时应提示到期需复核。

已过期或核验失败的来源不列入有效sources，没有有效来源时抓取/到期均null；不利用未通过核验的元数据制造可信时间。诊断只从固定安全代码映射生成，不透传异常消息、清单内部路径、原文或私库信息。公开价格状态始终 `unknown`，`public_price_reference=null`：此端点未指定完整SKU，不证明当前售价或交易报价。`formal_image_count=0`，规格可用不代表图片已核验。

云服务接入后：GET `/api/source-status` 返回完整安全摘要；health接口保持HTTP200与 `status=ok` 表示进程存活，额外 `source_readiness` 显示业务资料是否ready。进程健康不代表来源新鲜。接口沿用固定公网Origin、平台显式Host兼容、无CORS和原有请求边界，不接收文件路径、URL、时钟或更新指令。

更新资料仍由维护者使用独立安全维护流程处理：先保存候选、核验和QA验收，再同步GitHub/魔搭；本状态接口不允许匿名触发抓取或改写已验快照。

本轮D验证：`outputs/D/source-health-check-1792317114556.json` 专项24/24，包含真实核验、7天精确边界及超时、隔离清单的坏哈希/型号/时间/域名/字段指针、一个型号失效、缺清单、去敏、HTTP端点与过期资料liveness200；测试前后official.js及现有清单/原文/提取文本SHA256一致。现有云HTTP16/16和代理15/15通过，分别为 `outputs/D/cloud-check-1792317114592.json`、`outputs/D/cloud-proxy-check-1792317114834.json`。均无模型/外网调用；独立QA原53/代理22及新专项另行保存，不以D报告代替QA。
