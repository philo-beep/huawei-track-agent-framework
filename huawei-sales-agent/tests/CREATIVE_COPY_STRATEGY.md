# 受控创意文案策略

更新日期：2026-10-22
负责范围：内容生成 Agent 与文案回归测试（A）；不修改数据源、价格规则和前端展示。

## 一、分层约束

| 层级 | 处理方式 | 代码落点 |
| --- | --- | --- |
| 事实层 | 只从已核验原文摘取值；参数值不改写；价格不生成 | backend/agent/creative-copy.js、citations |
| 表达层 | 按人群、任务、平台选择标题、开场、结构、CTA | buildExpressionStrategy |
| 发布层 | 输出平台惯例正文、标签、配图顺序和独立审核包 | publish_copy、article_markdown |
| 验收层 | 原文锁定测试、平台差异测试、A/B 盲测包 | tests/creative_copy.test.js、tests/blind_review.js |

## 二、人群语气

| 人群识别 | 语气 | 先回答的问题 | 避免 |
| --- | --- | --- | --- |
| 采购 / 行政 / 信息化 | 审慎、条件优先 | 风险、配置、软件、交付条件是否可核对 | 先讲促销、承诺成交 |
| 教师 / 教研 | 具体、实用 | 备课、课件、课堂展示何时会卡住 | 用跑分替代使用流程 |
| 业务负责人 / 创始人 | 直接、判断清楚 | 会影响什么、哪些要先确认 | 长参数表、空泛愿景 |
| 门店 / 运营 | 结果导向、口语 | 能否接现有流程、每天是否添麻烦 | 技术术语堆叠 |
| 个人 / 家庭 | 轻松、朋友提醒 | 真实场景和最少的决策信息 | 权威腔、绝对化 |
| 通用办公 | 自然、克制 | 每天要做什么、哪些资料能回答 | 一律套同一标题 |

## 三、任务结构

| 任务 | 公众号 | 小红书 | 朋友圈 |
| --- | --- | --- | --- |
| 移动办公 | 场景 → 任务 → 1—3 条原文 → 待确认 → 对话 CTA | 钩子 → 任务卡 → 可收藏资料卡 → 避坑 → 评论 | 近况 → 一条原文 → 一条边界 → 私聊 CTA |
| 软件 / 文件条件 | 先拆软件、文件、外设三层 | 用 3 个核对问题开场 | 只保留最关键的一条风险 |
| 备课 / 展示 | 讨论文件流转与边界 | 轻口语清单，强调课堂现场 | 熟人式提醒，不堆参数 |
| 比较 / 选型 | 先统一任务再比参数 | 用“别只看…”切入，给顺序 | 一句判断，邀请补充条件 |
| 批量 / 续购 | 数量之外的配置与交付条件 | 适合团队自查卡 | 只提数量和配置待确认 |
| 通用办公 | 顾问式长文 | 短段落收藏清单 | 一到三段短帖 |

## 四、平台惯例

- **公众号**：Markdown 小标题、短段落、完整边界、对话式行动引导；不使用小红书式标签墙。
- **小红书**：标题独立、短句、编号/项目符号、少量视觉符号、3—4 个话题标签；参数只留与任务最相关的一条或两条。
- **朋友圈**：第一人称、熟人口吻、1—3 段、最多 1—2 个标签；不出现长标题和审核表。

## 五、事实与配图

1. fact_excerpts 只保存从锁定原文抽取的标签和值，测试逐项确认值仍能在原文中找到。
2. publish_copy.markdown 不包含内部编号、图片标记、核验表或原始 JSON。
3. publish_copy.image_order 只列出精确型号图片、插入顺序、授权状态和图片来源；授权未完成时正文保持文字可发版。
4. article_markdown 保留完整审核材料，二者不再混为一份发布稿。

## 六、开源项目借鉴

检索日期：2026-10-22。只借鉴方法，不复制代码或文案。

| 项目 | 借鉴点 | 本项目采用方式 |
| --- | --- | --- |
| [product-language-framework](https://github.com/quinnkeast/product-language-framework) | 把品牌语言拆成可执行规则和示例 | 人群语气与平台表达规则表 |
| [ai-copywriter](https://github.com/mikiarlo3/ai-copywriter) | 先写读者所处时刻；改写不放宽事实 | 读者时刻进入策略，参数只做原文摘录 |
| [viral-content-generator](https://github.com/LYmmt369/viral-content-generator) | 风格、目标、平台分开配置 | 人群 / 任务 / 平台三层策略 |
| [ai-marketing-panel](https://github.com/rodaddy/ai-marketing-panel) | 发布前独立面板测试，并明确合成结果边界 | A/B 盲测包与“机器代理 ≠ 真人销售”声明 |
| [viral-copywriting-skill](https://github.com/kangarooking/viral-copywriting-skill) | 标题、欲望、信任、行动的分段检查 | 标题、场景、原文、边界、CTA 分段结构 |

## 七、运行与验收

~~~powershell
node --test tests/creative_copy.test.js tests/content_generation.test.js tests/sales_copy.test.js
node tests/blind_review.js
~~~

盲测包、评分表和报告生成在 tests/blind_review/。真人评分前，不得把代理预检结果写成真实销售结论。
