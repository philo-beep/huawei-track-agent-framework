# 五个独立业务模块

此处是新模块的代码区域，现有线上应用仍在`backend/marketing/`，当前没有改接新流水线。

| 负责人 | 目录 | 唯一职责 | 功能分支 |
| --- | --- | --- | --- |
| M1 | `customer/` | 客户画像、原话依据、追问 | `feat/customer-understanding` |
| M2 | `evidence/` | 产品事实、图片、来源、时效 | `feat/evidence-retrieval` |
| M3 | `strategy/` | 人群场景、平台策略、写作任务书 | `feat/content-strategy` |
| M4 | `writing/` | 完整写稿、自然表达编辑、事实引用 | `feat/natural-writing` |
| M5 | `quality/` | 核验业务、问题归属、导出结构 | `feat/quality-delivery` |

每个模块拥有独立`src/prompts/tests/fixtures/docs`。主控只在集成层组合五个模块；独立QA和产品签字另行执行。完整开发与合并方式见`../协作工作区/协作开发与合并说明.md`。
