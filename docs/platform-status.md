# 工作区与外部发布状态

> 2026-10-18本轮正式提交状态见根目录`SUBMISSION.md`。下文为历史框架发布记录，不能作为本轮交互业务部署证据。新公开版与本机7B增强版分开说明，云端为明确披露的规则准备稿。

## 历史框架发布记录（以下不是当前业务版状态）

核查日期：2026-10-18。以下内容仅记录早期框架进展；当前业务版状态见根目录SUBMISSION.md。

## 主工作区：已恢复

`C:\Users\pop\Desktop\华为项目` 现已可读写，框架从临时目录成功迁入：47 个源文件 SHA-256 核对一致，其中 46 个新增，原始 `agent.md` 保留。真实看板与历史备份也已迁入，validate 通过；原有 24 项框架测试在桌面重新运行通过。后续均在桌面目录工作，临时目录仅作历史备份。

## GitHub：框架内容已同步

- 已通过原有凭据确认账号 `philo-beep`；无需用户重新登录。
- 已创建公开仓库：`https://github.com/philo-beep/huawei-track-agent-framework`。
- 60 个公开框架文件已完成首次推送，提交 `534dfbda9302dd8159e59bd37e6619de666a1a27`，远端 HEAD 已核对。后续状态说明更新也以普通提交同步。
- GitHub CLI 使用官方发布文件安装，下载包 SHA-256 已与官方校验清单核对。
- 首次 Git 直连 GitHub 超时，查明原因是 Git 未使用 Windows 已有本机代理；按系统代理设置本仓库的 GitHub 代理后成功，未更改系统网络设置或凭据。

## 魔搭：沿用用户已有“销售助手”空间

- 官方 `modelscope-hub==0.4.6` 已安装到项目隔离虚拟环境 `.venv`，账号 `philosophia` 已通过 SDK 成功认证。
- 凭据仅由官方 SDK 保存到用户凭据目录；不写入源码、消息、任务看板、交付包或远程仓库。
- 已核实 Docker 免费 CPU 硬件档位 `platform/2v-cpu-8g-mem` 可用。
- 早期显式指定 Docker 硬件新建空间返回“未绑定阿里云账号”，属于新建尝试的历史记录。后续发现用户已经创建 `philosophia/promotion-agent`，显示名“销售助手”，用户明确指定其为最终产品交付空间。
- 2026-10-18 通过官方 SDK 与 Git 核实该空间为 Gradio 6.29.1、免费 CPU `platform/2v-cpu-8g-mem`，状态 Initialized。远端已有框架文件，基线提交 `2d53f05e705f785cc61bca3bb1b829f98fd4eadb`，已完整克隆留存。
- 随后再次核查，平台 SDK 已变化为 Docker，runtime Running；不是主控调用设置修改造成。构建日志显示基线 `2d53f05e` 的现有 Dockerfile 已成功构建标准库只读服务。候选保持 README `sdk: docker` 与当前实际配置一致；新增的 Gradio 适配作为可选方案保留，不作当前生产入口。
- 60 个公开框架文件已通过普通 Git 推送到现有空间，提交 `9abe1203d26af3680410017cd2da95edcd4f55ff`，远端 HEAD 已核对，原历史和额外 `.gitattributes` 保留。无 PDF/ZIP/凭据/本地看板公开上传。
- 通过官方 API 使用现有免费 Docker 配置启动新提交构建，日志确认 `9abe1203` 构建成功。服务仅展示协作框架，不读真实看板、不调用模型、不训练；销售业务尚未开发。初次裸请求 403 后，用浏览器 User-Agent 与 ModelScope Referer 访问首页和 `/healthz` 均为 200，健康字段明确模拟、无模型、无训练、无实际 Agent。运行版本切换需结合 runtime 状态与构建日志，不能仅从相同页面推定。
- QA 于 2026-10-18 06:07:24 UTC 独立复核：新部署 runtime `Running`（部署创建时间 06:06:31 UTC），Docker 免费 CPU 配置一致；首页和 `/healthz` 均 200，simulation=true，model_connected/training/actual_agents_running 均 false。切换时短暂 404 已恢复。实际入口为 `https://philosophia-promotion-agent.ms.show`，空间页为 `https://modelscope.cn/studios/philosophia/promotion-agent`。
- 之前另建的 `philosophia/huawei-track-agent-framework` 静态占位空间未用于本次发布，保留现状。后续只更新用户指定的“销售助手”，不改硬件或选择付费资源。

## 发布后核验

已完成可选 Gradio 适配、范围说明、Docker 发布脚本与候选的 QA 复验及 E 实际签字，本地完整 30 项测试通过；真实上线证据见 `reviews/deployment-review.md`。关键候选快照和公开 SHA-256 清单保留在本机 `.collaboration/`。状态说明与验收记录作为后续普通提交同步，服务代码保持已验证版本；文档提交不再重复触发服务部署。后续产品开发继续沿用销售助手空间，功能变化重新执行责任人交付、QA、E 签字及发布核验流程。
