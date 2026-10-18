# 部署候选独立技术验收

日期：2026-10-18。验收角色：QA。主要工作区：`C:\Users\pop\Desktop\华为项目`。

## DEPLOY-D-001：本地服务通过

审阅交付：`backend/studio/__init__.py`、`backend/studio/app.py`、`docs/backend/studio.md`。实现只使用 Python 标准库，模块导入不启动服务器，生产入口读取 PORT、默认监听 0.0.0.0:7860。响应为内嵌固定内容，不使用文件服务器，不读取看板、项目文件或凭据。

QA 新增 `tests/test_studio.py`，在 127.0.0.1 随机端口运行真实 HTTP 服务线程，使用 http.client 请求，完成后 shutdown、server_close 并等待线程结束，无常驻进程。

| 检查 | 实际结果 |
| --- | --- |
| GET / | 200，UTF-8 中文说明，明确静态介绍、模拟流程、未接模型、无实际 Agent 进程 |
| GET /healthz | 200，simulation=true，model_connected=false，training=false，actual_agents_running=false |
| HEAD /、/healthz、/missing | 与 GET 状态及 Content-Length 一致，正文为空 |
| 未知、查询及穿越路径 | 404 固定正文，包括 agent.md、状态表、源码、编码穿越路径，无文件泄露 |
| POST、PUT、PATCH、DELETE、OPTIONS、TRACE、CONNECT | 405，Allow: GET, HEAD；请求携带写入正文后临时目录仅保留原哨兵文件，内容不变 |
| CSP 与响应边界 | GET /、GET /healthz、HEAD / 仅允许 https://modelscope.cn 与 https://*.modelscope.cn 嵌入；default-src、base-uri、form-action 仍为 none；no-store、nosniff 生效 |

问题 `DEPLOY-D-IFRAME-001` 已关闭：初次交付的 frame-ancestors 'none' 会阻止魔搭 wrapper iframe，QA 通过 Workspace.send 退回 D；D 按 fix → deliver 修复；QA 的原失败回归现已通过。没有放开任意来源。

最终执行 `python -m unittest discover -s tests -v`：30 项通过，其中 24 项框架协议测试、6 项新增 HTTP 测试。`python -m framework validate`：valid=true。复验过程中一次 CONNECT 请求出现本机 WinError 10053 连接中止；随后的独立 HTTP 六项复跑和完整三十项复跑全部通过，未隐藏这次环境层中止。

结论只覆盖本地标准库服务，不代表 Docker 镜像构建、魔搭 wrapper 实际嵌入或线上服务已经验收。

## BOOT-E-001：范围说明修订通过

`SCOPE-002` 的桌面权限与 GitHub 仓库创建陈述已经修正。QA 独立核对当前桌面文件可用、框架测试通过，本机虚拟环境含 modelscope-hub 0.4.6。

2026-10-18 主控补充新的认证及平台证据后，QA 通过 Workspace.send 记录 `SCOPE-003`：要求去除 SDK 当前缺令牌断言，说明已登录 philosophia，但创建 studio 遇到“未绑定阿里云账号”的平台前置条件，尚未部署；动态进度引用 `docs/platform-status.md`。E 按 fix → deliver 修复后，QA 独立复读 scope 与平台状态，确认已移除缺令牌现状断言、准确区分认证与创建/部署、不虚报线上完成，并引用本报告及看板记录本地服务验收。`SCOPE-003` 已关闭，范围说明通过；E 发布签字仍须另行实际执行。

## 主控发布配置：只读补充审查

QA 静态检查 `Dockerfile`、`.dockerignore`、`.gitignore`、`install_workspace.py`、`tools/publish_modelscope.py`、`requirements-publish.txt` 和 README。Docker 仅 COPY 服务单文件，使用 Python 3.12 slim、非 root 运行、7860 端口与本地健康检查，没有模型安装、任务表复制或凭据输入。

按实际 `source_files()` 导出的 56 个候选逐一核对路径并扫描常见访问令牌与私钥格式，未命中已知令牌格式或凭据文件，未包含 `.git`、`.venv`、`.env`、`.collaboration`、模型权重或原始数据。用户新增根目录赛题 PDF 和知识库 ZIP 均不在白名单，根目录 PDF/ZIP 也被 gitignore 排除。此检查只覆盖扫描时现存候选，不为未来新增文件担保。

发布脚本在账号/网络操作前先执行 release_check，上传前再次执行门禁；硬件须同时匹配 resource_type=free 和 platform/2v-cpu-8g-mem，没有付费回退。已有空间须为 Docker 且硬件一致，才允许继续上传。隔离环境执行 `tools/publish_modelscope.py --help` 成功，只证明导入及参数入口可用，没有执行发布或线上验证。官方本机 SDK 定义可查 RepoInfo.sdk_type/hardware、get_repo 和 list_studio_hardware，与脚本静态调用一致。

QA 已向主控路由 `docs/deployment.md` 的过时状态断言，要求与当前平台状态及本地验收一致；该文件由主控负责修改。附加检查不是线上部署验收。

## 发布限制

## 现有 Gradio 空间适配复验

后续按用户要求沿用既有 `philosophia/promotion-agent` 空间，显示名“销售助手”，Gradio 6.29.1、免费 CPU。此前新建空间的账号绑定错误属于历史尝试，不能用于断言当前没有现有空间。本节更新后续事实，不改写前述历史验收经过。

`SCOPE-004` 已经 QA 正式 reject 后由 E fix/deliver：范围说明将绑定错误改为历史记录，说明既有空间与仅介绍框架的适配边界，不将文件上传表述为运行成功，引用动态状态文档。QA 已独立复读并确认修复。

`DEPLOY-D-002` 交付 `backend/studio/gradio_app.py` 与 `docs/backend/gradio.md`。QA 在项目隔离环境使用精确 Gradio 6.29.1 导入、构建并运行本机服务，结果如下：

- 应用仅有一个 HTML 组件，事件 dependencies 为空，analytics_enabled=false。
- 固定正文包含模拟声明、未接模型、无实际 Agent 进程和角色说明，移除了标准库 /healthz 页脚与 HTML 文档包装。
- 实际首页和 /config 均返回 200；在线配置正文与固定介绍一致，无交互输入或事件依赖。
- /healthz、/agent.md、/.collaboration/state.json 返回 404；Gradio 文件路由访问 agent.md 和状态表返回 403。
- 端口 0、-1、65536、非数字均在构建前拒绝；有效端口启动参数为 0.0.0.0、指定端口、share=False。
- 验证后调用 app.close，测试服务已关闭，无常驻 QA 进程。

结论为本地 Gradio 适配通过；Gradio 路由与原标准库 HTTP 服务不同，不能套用原服务所有方法 405 或 /healthz 约定。根 app.py、requirements.txt 与远端构建入口由主控管理，不包含在 D 的此轮交付验收；线上运行仍须发布后核验。

GitHub 创建仓库、认证成功与本地测试均不构成远端发布验证。魔搭尚无已验收线上地址。本报告不代替 E 对同一候选的实际产品一致性签字、主控 release-check、公开内容核对及发布后首页与健康检查验证。凭据不写入报告、测试或协作消息。

## 最终根候选与 Git 发布脚本复验

2026-10-18 后续最终候选审查覆盖根 `app.py`、`requirements.txt`、README 元数据、`tools/publish_modelscope.py`、白名单与当前部署/平台文档。根入口已用 runpy 配合 mock 验证实际调用 Gradio main；精确依赖为 gradio==6.29.1；README 为 Gradio、对应版本和 app_file=app.py。文档准确区分标准库健康检查与 Gradio 入口，记录既有空间及基线 2d53f05e705f785cc61bca3bb1b829f98fd4eadb，没有将候选准备称作线上运行。

发布脚本已替换为 Git 保留远端历史与非候选文件的方式，不再创建、配置或自动 deploy 空间。QA 在 reviews 下临时目录执行行为模拟，HubApi、Git 子进程和本地门禁均 mock，真实 API 调用和真实 push 次数为零：

- credential helper 仅在 get 操作、HTTPS、modelscope.cn、精确目标仓库路径同时匹配时返回测试用惰性哨兵值；协议、host、路径不符或 store 操作不读取凭据。
- Git 命令清空其他 credential.helper、启用 useHttpPath、禁用终端提示，命令行和 URL 不含测试凭据；模拟普通 push 未出现 force。
- 默认 prepare 保留远端额外文件，不 commit、不 push、不 deploy；显式 push 执行普通分支推送并核对远端提交。
- 非预期远端 HEAD、所有者、SDK 或硬件均阻止 push。
- release_check 失败时在任何 HubApi/Git 操作之前停止；准备后候选发生变化也阻止推送。
- 候选私钥格式会阻止推送，不输出匹配内容。

QA 指出初版 Git 发布脚本凭据正则覆盖过窄后，主控扩展 GitHub PAT、OpenAI sk 前缀、AWS access key、ModelScope 和私钥格式。QA 用七类合成样本复验全部命中；按更新后的同一规则扫描当前 60 个候选均无命中。候选含根入口和依赖，不含根赛题 PDF/知识库 ZIP、真实看板、凭据目录或虚拟环境。扫描不保证识别所有未知秘密格式，公开范围只针对当前审查候选。

最终完整 `python -m unittest discover -s tests -v`：30 项通过；`python -m framework validate`：valid=true、三项任务均已验收。主控此前过时的部署/平台描述已复读确认修正。根候选无未关闭的 QA 阻塞，可以交 E 对同一候选实际审阅签字；QA 不代签。本轮仍未验证任何线上部署、镜像构建或远端推送成功。

## 配置实时变更：暂停 Gradio 候选放行

主控随后通过 SDK 发现目标空间 SDK 已由 Gradio 变为 Docker，runtime 为 Running、active_config 为 Docker/免费 CPU，非主控脚本修改。远端基线 Docker 构建日志已由主控检查，但直接访问运行域名返回 403，QA 尚未独立核验线上内容。

此前根候选无阻塞结论只适用于审查时的 Gradio 候选，不能沿用于 SDK 变化后的生产配置。QA 已明确通知 E 暂停签字和放行；等待主控更新 README、显式 expected-sdk、部署文档后重新审查。D 的标准库 HTTP 服务和可选 Gradio 适配的本地技术验收仍各自有效，不等于当前线上验证通过。

QA 随后正式退回 `BOOT-E-001`，issue 为 `SCOPE-005`，从而使竞态前的旧候选 E 签字失效。E fix/deliver 后 QA 复读确认范围说明已将旧 Gradio 观察标为历史、明确最新报告为 Docker/免费 CPU/Running、Gradio 仅作可选，并将构建/运行状态与线上内容验收区分。`SCOPE-005` 已关闭、范围任务重新 done；根 Docker 候选与新的 E 发布签字仍须各自完成，不能使用旧签字发布。

## 更新后 Docker 候选：重新通过

QA 已复读更新后 README sdk=docker、Docker 单文件 COPY、平台状态和部署说明；Gradio 根入口及依赖仅作可选适配，Docker 镜像仍只复制标准库 app.py，不受 Gradio 文件影响。平台状态末段遗留“线上 Gradio”措辞已由主控修正并经 QA 复读。

新版发布脚本显式 expected_sdk，CLI 默认 docker，仅 docker/gradio 两种选择。QA 使用完全 mock API/Git 重验五组组合：Docker 期望/实际一致允许准备、Gradio 期望/实际一致允许准备、两种交叉不一致均拒绝、付费硬件拒绝。CLI 默认值确实传入 docker，默认仍不 push，不创建、改配置或 deploy 空间，保留远端额外文件。60 个公开候选的范围不变。

QA 另行无凭据只读请求 `https://philosophia-promotion-agent.ms.show/` 与 `/healthz`，请求头为 User-Agent Mozilla/5.0、Referer https://modelscope.cn/：两者均返回 200。首页实际含中文模拟说明、未接模型与无实际 Agent 声明；健康 JSON 实际为 simulation=true、model_connected=false、training=false、actual_agents_running=false。该观察验证的是当时已运行的远端基线服务；主控将其对应至 2d53f05e 基线，QA 未据此声称本机新候选已推送或部署。

重新结论：更新后的 Docker 根候选无未关闭 QA 阻塞，可以由 E 对这一候选重新实际审阅签字。旧 Gradio 候选签字仍不可使用；后续推送和重新构建须核对实际提交与线上结果。

## 两平台首次实际发布后独立核验

2026-10-18，QA 独立执行只读 Git ls-remote：GitHub master 为 `534dfbda9302dd8159e59bd37e6619de666a1a27`，ModelScope master 为 `9abe1203d26af3680410017cd2da95edcd4f55ff`，均与主控首次发布记录一致。ModelScope 构建日志 payload 独立读取，包含新提交 `9abe1203` 与 SUCCESS；该证据结合远端提交核对，不将相同静态页面单独作为版本切换证明。

切换中 QA 曾实测 runtime Building、首页 404，如实记录为部署窗口；随后留出间隔再查。2026-10-18T06:07:24Z，官方 SDK 实测 runtime Running、active_config 为 Docker 与免费 CPU platform/2v-cpu-8g-mem，运行创建时间为 2026-10-18T06:06:31Z。

在该 Running 状态下，QA 无凭据、使用浏览器 User-Agent 与 ModelScope Referer 请求 `https://philosophia-promotion-agent.ms.show/`：200，含中文模拟说明；`/healthz`：200，status=ok、simulation=true、model_connected=false、training=false、actual_agents_running=false。此前部署窗口 404 已不再复现。

首次实际发布核验通过：两平台远端提交已核对，魔搭新提交构建日志成功，运行状态及首页/健康响应正常。此结论只涉及只读框架展示，不证明销售业务、模型或训练已实现。主控随后更新平台状态和本报告时，最终文档候选仍须 E 实际重签并再次同步；两平台提交 ID 不要求相同，但公开候选文件内容须核对一致。QA 不把尚未同步的最终文档更新表述为已经发布。
