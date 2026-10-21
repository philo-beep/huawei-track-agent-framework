# 数据区验收清单

主负责人：A Agent 核心工程师。协助验收：E 产品与答辩工程师。D 负责数据项，B/C 按接口、入库和前端消费影响提供证据。

## 1. 目录与职责

- [ ] 根目录只保留 `datasets/`、`agent_spec/`、`docs/` 和 `README.md`。
- [ ] `datasets/` 不含网页实现、Node/Python 业务代码、启动脚本或模型权重。
- [ ] `agent_spec/` 只保存供 Codex / Agent 遵守的规则，不保存业务逻辑。
- [ ] `docs/` 只保存赛事需求、问题记录、变更日志等项目文档。
- [ ] 运行区 `../huawei-sales-agent/` 不包含原始知识库 ZIP、客户资料、日志、凭据或正式原始图片。

## 2. 数据集

- [ ] `datasets/raw/` 中的清单可解析为 JSON，成功条目的相对路径真实存在。
- [ ] 采集失败条目保留 `failed`，其原文路径、文本路径和价格保持为空。
- [ ] `datasets/cleaned/local_kb_index.json` 可解析，文档、候选图、价格记录数量可复算。
- [ ] 所有候选图的 `local_path` 均以 `datasets/raw/assets/` 开头且文件存在。
- [ ] 候选图不得因目录关联自动标记为正式产品图。
- [ ] 合成样例位于 `datasets/test_sample/` 或运行区 `tests/`，并显著标注为合成。

## 3. 来源与价格

- [ ] 每条关键事实保留来源库名称、具体条目、内容指纹和适用范围。
- [ ] 官网快照保留 URL、抓取时间、HTTP 状态、内容指纹和限制说明。
- [ ] 历史价、起售价、搭配价和当前成交价没有混用。
- [ ] 正式报价缺失时保持 `null`，并写明需要补充的 SKU、配置、数量、地区、有效期或询价条件。
- [ ] 四级假设价格带有「待官方确认」标记，且 `actual_transaction_quote=false`。

## 4. 文档与真实性

- [ ] 赛事需求、四步闭环、工程目标与官方晋级线的区别写清楚。
- [ ] 问题记录中的每个未完成项都有证据、影响、责任归属和复验条件。
- [ ] 变更日志记录日期、改动、验证结果和尚未提交 / 尚未部署状态。
- [ ] 不把本地测试、静态页面、历史截图或规则演算写成真实线上能力。
- [ ] 不把咨询量、转化率、图片核验或 30 分钟交付写成已验证。

## 5. 自动与人工核验

运行区离线回归：

```powershell
cd ..\huawei-sales-agent
python -m unittest discover -s tests -v
```

HTTP 冒烟：

```powershell
$env:HUAWEI_HTTP_SMOKE='1'
python -m unittest discover -s tests -v
Remove-Item Env:HUAWEI_HTTP_SMOKE
```

目录机械检查至少覆盖：

- JSON 可解析；
- 索引路径存在；
- 候选图正式计数为 0；
- 失败采集条目未伪造数据；
- 运行区无 `.zip`、`.log`、`.env`、模型权重或原始知识库附件；
- 不存在旧路径 `data/official`、`frontend/cloud`、`backend/marketing`、`build_local_index`、`raw/raw`、`outputs/D`、`.collaboration/runtime`。

## 6. 放行规则

- 任何目录、数据集、来源价格或文档真实性检查项未通过，数据批次不得标记为验收完成。
- 自动测试通过只代表工程契约通过，不代表业务效果或官方评分通过。
- 发现问题按 `docs/issue_record.md` 记录；修复后保留复验证据并更新 `docs/变更日志.md`。

