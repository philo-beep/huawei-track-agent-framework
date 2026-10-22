# 验收脚本工作区说明

## 负责人

- A Agent 核心工程师：维护自动化验收脚本、接口测试、边界测试和最终联调。
- E 产品与答辩工程师：协助按赛事需求、产品说明和用户流程执行验收，整理问题记录。
- B、C、D 负责修复各自范围内被发现的接口、前端和数据问题。

## 职责

- `test_chat.py`：Agent 四步契约、产品匹配 HTTP 接口、来源、边界、页面和导出测试。
- `guided_profile.test.js`：逐题画像首问、单问约束、原话证据校验、缺证降级、覆盖阈值、8 轮上限和 HTTP/CSRF/任务轮询。
- `product_match.test.js`：产品匹配注册表、逐条件覆盖、逐字证据引文、预算、IMA、【待确认】和模型幻觉测试。
- `content_generation.test.js`：多平台内容契约、事实回溯、精确型号图片、插入位置、六项发布前检查、授权调整和错误型号拒绝测试。
- `creative_copy.test.js`：人群 / 任务 / 平台表达策略差异、原文参数锁定、直发正文与内部审核材料分离、配图顺序和授权边界。
- `publication_readiness.test.js`：纯文本分块、PNG/JPEG 实际像素、三平台标题/正文/标签检查、标签计数和 ZIP 结构测试。
- `blind_review.js`：生成 9 组 A/B 销售盲测包、代理预检报告、评分表和公众号 / 小红书 / 朋友圈文字可发样例。
- `CREATIVE_COPY_STRATEGY.md`：受控创意文案的分层规则、人群 / 任务 / 平台矩阵和开源方法借鉴记录。
- `sales_copy.test.js`：销售可见 Markdown 去技术化回归，阻止模型名、内部编号、JSON、门禁、排序分、英文字段和开发术语重新出现。
- `extension_regression.test.js`：两款型号 × 三个平台的正常矩阵，以及信息缺失、预算冲突、图片错配和边界场景。
- `extension_coverage_matrix.json`：功能 × 场景 × 型号 / 平台覆盖清单；测试会校验 6 个型号平台组合无缺口。
- `release_verification.test.js`：型号、参数、价格、图片身份、超范围承诺和来源完整性六项门禁；覆盖全部通过、阻塞和降级到安全版本。
- `solution_planning.test.js`：基础方案、预算判断、报价状态和成交动作；覆盖正式价格 null、合成演算隔离、负责人/触发条件/时间节点及数量冲突。
- `content_api.test.js`：图文接口、CSRF、任务轮询、双格式导出、图片路由和哈希清单测试；沙箱内回环连接受限时须在沙箱外运行。
- `verify_product_data.js`：校验产品注册表、结构化事实、报价、兼容性和质量统计的一致性。
- `test_cases.json`：明确的合成测试样例。`verify_integrations.js`：按需验证云端模型、IMA 与联网抓取的独立调用；加 `--full` 运行同时启用三项能力的端到端联调。
- 维护可复现命令、通过/失败证据、回归结论和已知限制。

## 开始工作前

1. 阅读根目录 `README.md`、`团队协作与分工说明.md` 和 `文件归属与责任矩阵.md`。
2. 阅读运行区 `../README.md` 和本文件。
3. 阅读 `../huawei-sales-agent-data/agent_spec/acceptance.md` 和当前赛事需求文档。
4. 确认测试候选版本、接口版本、Agent 模式和数据来源。

## 测试原则

- 不使用真实客户隐私。
- 不修改业务实现来让测试通过。
- A 的运行结果和 E 的产品核对都要有可复现证据，不能用作者自测或截图代替。
- 失败时记录复现步骤、预期、实际、受影响角色和 issue。
- 上游接口、Agent 提示词、数据或索引变化后，必须复验受影响链路。
- 规则模式、模型接入、前端流式显示、会话持久化和公网发布必须分别声明验证状态。

## 执行

从 `huawei-sales-agent/` 运行：

```powershell
node --test tests/guided_profile.test.js
node --test tests/product_match.test.js
node --test tests/content_generation.test.js
node --test tests/publication_readiness.test.js
node --test tests/sales_copy.test.js
node --test tests/extension_regression.test.js
node --test tests/release_verification.test.js
node --test tests/solution_planning.test.js
node --test tests/content_api.test.js
node tests/blind_review.js
# 本机回环受沙箱限制时，需在沙箱外运行 content_api.test.js
$env:HUAWEI_DATA_ROOT="../huawei-sales-agent-data"; node tests/verify_product_data.js
python -B -m unittest discover -s tests -v
$env:HUAWEI_HTTP_SMOKE='1'; python -B -m unittest discover -s tests -v
```

## 扩展回归输出

- 回归集：`node --test tests/extension_regression.test.js`，输出全部型号/平台子用例和异常场景结果。
- 覆盖矩阵：`extension_coverage_matrix.json` 固定列出 2 款型号 × 3 个平台 = 6 个正常组合，并映射信息缺失、预算冲突、图片错配和平台边界用例。
- 所有结果直接调用产品匹配、本地知识库、预算快照与发布核验实现，不使用伪造通过数据。

## 交接

验收报告至少包含候选标识、环境、命令、通过项、失败项、跳过项、产品体验结论、已知限制和是否允许进入集成或发布。

集成验证（会真实访问外部服务并可能产生模型调用费用）：

```powershell
node tests/verify_integrations.js --full
```
## 访问控制回归

```powershell
node tests/access_control.test.js
```

该测试使用临时账号文件启动独立 Node 实例，验证未登录 401、首个账号管理员、成员越权 403、CSRF、角色实时生效、退出撤销与服务重启后的有效会话恢复；测试结束自动删除临时账号文件。