# 运行时契约工作区说明

## 负责人

B 接口负责人。

## 职责

- 维护 marketing、pricing、guided-profile、product-match、content-generation、module input/envelope 和各业务输出 Schema。
- 逐题画像输入只接收脱敏 messages 与 restart 标记；输出固定包含 status、turn/max_turns、coverage、fields、next_question、summary、product_match_profile、runtime 和 diagnostics。
- 图文生成输入只接收重新核验所需的 `match_input` 与 `candidate_id`；输出固定保留图片来源、插入位置、事实引用和披露边界。
- 内容输入支持公众号、小红书、朋友圈；输出 v1.2 增加 `platform_profile`（结构、事实上限、图片上限和来源策略）、`product.model_key` 与 `budget_assessment`。
- v1.2 继续保留发布前六项强制核验：`verification.items` 逐项返回通过/不通过/降级，`risk_items` 返回问题、等级和处理建议，`safe_content` 返回移除降级项后的安全版本；任何不通过项设置 `overall_status=blocked` 且不提供安全版本。
- 保证生产方、消费方和测试使用同一契约版本。
- 对客户画像、产品匹配 v1.1、证据包、内容任务书、文章、交付评审和价格结果执行兼容性检查。
- 产品匹配理由必须包含逐字 `cited_span`，候选必须包含 `criteria_coverage`；字段变更需同步 A/C 和测试。

## 开始工作前

1. 阅读根目录 `文件归属与责任矩阵.md`。
2. 阅读 `../../README.md` 和 `../README.md`。
3. 确认字段生产方和消费方：A 提供 Agent 输出，B 维护接口契约，C 消费前端 JSON，D 提供数据字段规范。

## 变更规则

- 先提交字段变更申请，说明含义、必填性、默认值、兼容策略和受影响文件。
- 生产方和消费方确认后再更新 Schema；涉及前端时由 C 复核，涉及数据时由 D 复核。
- 不建立第二份事实源，不在各业务文件复制契约。
- 不允许无版本说明的字段删除、类型改变或语义漂移。
- `module-registry.json` 中的历史工作区路径必须与当前标准目录一致；不一致时由 B 修正或标记为不可运行的历史登记。

## 验收

- JSON 可解析。
- 必需字段和禁止字段符合对应业务。
- 示例输入输出通过契约校验。
- 相关单元测试和全链路测试通过。

交付需附变更字段、兼容性判断、受影响角色、测试结果和回滚方案。
