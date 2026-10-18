# 工作区与外部发布状态

核查日期：2026-10-18。此文档记录当前进展；早期验收报告中的权限问题保留为历史证据。

## 主工作区：已恢复

`C:\Users\pop\Desktop\华为项目` 现已可读写，框架从临时目录成功迁入：47 个源文件 SHA-256 核对一致，其中 46 个新增，原始 `agent.md` 保留。真实看板与历史备份也已迁入，validate 通过；原有 24 项框架测试在桌面重新运行通过。后续均在桌面目录工作，临时目录仅作历史备份。

## GitHub：仓库已创建

- 已通过原有凭据确认账号 `philo-beep`；无需用户重新登录。
- 已创建公开仓库：`https://github.com/philo-beep/huawei-track-agent-framework`。
- 当前代码候选正在完成独立 QA 和 E 产品一致性复验，尚未完成首次推送；仓库创建不代表内容已同步。
- GitHub CLI 使用官方发布文件安装，下载包 SHA-256 已与官方校验清单核对。

## 魔搭：沿用用户已有“销售助手”空间

- 官方 `modelscope-hub==0.4.6` 已安装到项目隔离虚拟环境 `.venv`，账号 `philosophia` 已通过 SDK 成功认证。
- 凭据仅由官方 SDK 保存到用户凭据目录；不写入源码、消息、任务看板、交付包或远程仓库。
- 已核实 Docker 免费 CPU 硬件档位 `platform/2v-cpu-8g-mem` 可用。
- 早期显式指定 Docker 硬件新建空间返回“未绑定阿里云账号”，属于新建尝试的历史记录。后续发现用户已经创建 `philosophia/promotion-agent`，显示名“销售助手”，用户明确指定其为最终产品交付空间。
- 2026-10-18 通过官方 SDK 与 Git 核实该空间为 Gradio 6.29.1、免费 CPU `platform/2v-cpu-8g-mem`，状态 Initialized。远端已有框架文件，基线提交 `2d53f05e705f785cc61bca3bb1b829f98fd4eadb`，已完整克隆留存。
- 随后再次核查，平台 SDK 已变化为 Docker，runtime Running；不是主控调用设置修改造成。构建日志显示基线 `2d53f05e` 的现有 Dockerfile 已成功构建标准库只读服务。候选保持 README `sdk: docker` 与当前实际配置一致；新增的 Gradio 适配作为可选方案保留，不作当前生产入口。
- 只读框架介绍不读真实任务看板、不调用模型、不训练；销售业务尚未开发。初次直连返回 HTTP 403，后续使用浏览器 User-Agent 与 ModelScope Referer 实际请求首页与 `/healthz` 均为 200，健康字段为模拟、无模型、无训练、无实际 Agent。该核验对应远端基线 `2d53f05e`；本机新候选仍需完成推送并核对。
- 之前另建的 `philosophia/huawei-track-agent-framework` 静态占位空间未用于本次发布，保留现状。后续只更新用户指定的“销售助手”，不改硬件或选择付费资源。

## 发布后核验

QA 复验可选 Gradio 适配、范围说明和 Docker 发布候选后，由 E 签字；主控保存快照及公开文件清单，完成 GitHub 同步及现有空间普通 Git 推送。保留已有历史和非候选文件，不强推。平台构建、运行日志及线上 Docker 服务首页与 `/healthz` 核验后记录真实结果。远端有文件不代表服务已运行。
