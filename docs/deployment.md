# 本地启动、备份与发布边界

当前交付是本地多 Agent 协作基础框架与已通过本地 QA 的只读展示服务。真实业务需求和最终用户仍待确认；本地文件和发布检查不能表述为已上线服务或已训练 Qwen。

截至 2026-10-18，桌面写入限制已解决，主要工作区为 `C:\Users\pop\Desktop\华为项目`，初始 47 个源文件已核对迁入，原始 `agent.md` 保留。QA 已完成 24 项框架测试与 6 项 HTTP 测试。GitHub 仓库、魔搭 SDK 认证、平台账号前置条件和实际部署结果统一记录在 `docs/platform-status.md`，以避免把旧阻塞误作当前状态。

## 本地使用

在项目根目录使用可用的 Python 解释器执行：

```powershell
python -m framework init
python -m framework validate
python -m framework demo --output .collaboration/demo
```

demo 是模拟协作及修复流程，不能证明业务、训练效果或远端部署成功。真实开发先使用 `templates/user-requirement.md` 澄清需求，再由主控加载 `agents/` 中的七份提示词，创建任务、按依赖分派并通过 JSON 消息推进。

只读展示服务可使用 `python -m backend.studio.app` 启动，默认监听 `0.0.0.0:7860`，可通过 `PORT` 配置端口。`GET /` 提供固定中文介绍，`GET /healthz` 提供服务状态及模拟范围标识。它不读取真实项目看板或文件，不提供写操作、模型调用、训练或实际 Agent 进程，详见 `docs/backend/studio.md`。本地独立验收记录见 `reviews/deployment-review.md`，不将其等同于线上验收。

## 备份与可恢复性

状态统一保存在 `.collaboration/state.json`，每次写入前自动备份至 `.collaboration/backups/`。关键节点执行 `python -m framework snapshot`，保存状态、文件 SHA-256 清单和工作区 ZIP，保留其输出路径。快照跳过 `.git`、`.collaboration`、`.venv`、`__pycache__`、`node_modules` 和符号链接；快照用于本机恢复，可能包含本地数据，不能直接公开上传。状态备份不等于源码备份；核对快照已涵盖必要候选文件，凭据不要存入工作区，不删除唯一副本。

恢复前暂停写操作并保留现状副本，选择已验证的状态备份，核对 schema、revision 与交付文件是否对应，再由主控恢复及运行 validate。不能仅恢复任务表就宣称工作文件也已恢复。

## 同一候选的双门禁

1. 所有任务为 QA 验收的 done 或有原因记录的 cancelled，且至少一个 E 产品说明任务经 QA 验收为 done；当前已验收交付文件的 hash 必须与验收记录对应。取消不会使未完成依赖自动通过。
2. E 检查产品说明与当前功能、用户痛点和限制一致，然后执行 `python -m framework release-approve --by E --summary "审查范围与结论"`。框架阶段如实说明业务需求待确认，不虚构用户与痛点。
3. 主控执行 `python -m framework release-check`，校验任务状态、交付 hash、dependency_fingerprints 和 E 签字 fingerprint，输出本地门禁结果。已验收文件变化由 QA reject 原任务，原 owner fix/deliver 更新 hash，再经 QA 复验；上游验收内容变化也使下游指纹过期，QA 需要退回受影响下游原任务复验，最后 E 重新签字。只新建修订任务不能更新原任务的旧交付证据。

release-check 输出本地检查结果，并不创建远端或上传。需要留档时由主控保存结果及候选清单。公开发布的范围、可见性、目标和实际授权必须清楚；用户已授权的操作不重复询问，缺凭据、远端地址、费用或关键决策时明确指出所需条件。

## GitHub 与魔搭后续步骤

用户原始要求已授权公开 GitHub 仓库及魔搭部署；无需重复请求已授权的常规操作。主控后续完成许可与公开文件清单核对、排除凭据和私有数据，保存本地候选备份并通过双门禁，再推送到已创建的仓库，验证远端文件与提交标识。仅有仓库地址不能证明同一候选内容已上传。

ModelScope 凭据只通过官方 SDK 保存到用户凭据目录，不能写进文档、消息、源码或提交历史。当前已完成 SDK 认证，沿用用户指定的“销售助手”空间 `philosophia/promotion-agent`（当前 Docker，免费 CPU `platform/2v-cpu-8g-mem`），无需另建空间。该空间早期观察为 Gradio，后续再次核查已切换 Docker，以发布前实时配置为准。新建 Docker 空间时曾遇账号绑定限制，该历史失败不代表现有空间不可推送。

本机发布环境可用以下命令重建：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-publish.txt
.\.venv\Scripts\ms-hub.exe login
```

首次本机认证完成后，常规发布无需重复登录。QA/E 门禁通过并保存候选快照后执行：

```powershell
.\.venv\Scripts\python.exe tools/publish_modelscope.py --repo-id philosophia/promotion-agent --expected-sdk docker --expected-head <已检查的40位远端提交ID> --push
```

脚本默认仅准备本机候选，`--push` 才实际提交并普通 Git 推送。先完整克隆远端，校验人工检查过的提交 ID、账号、SDK 和免费硬件；按源码白名单覆盖对应框架文件，保留其他文件与历史，远端变化则停止，不强推。凭据辅助程序只向 Git 的目标 ModelScope 仓库请求返回官方已存凭据，令牌不出现在命令行或远端 URL。真实看板、虚拟环境、根赛题 PDF/知识库 ZIP、数据及权重不上传；候选生成 SHA-256 清单并扫描常见密钥格式。

当前空间采用 Dockerfile，仅复制 `backend/studio/app.py` 启动标准库只读服务；线上核验首页与 `/healthz` 的模拟范围字段。可选 Gradio 入口为根 `app.py`，精确依赖见 `requirements.txt`，提供固定 HTML，无业务输入和事件回调；仅切换配置后才会成为生产入口，该适配无标准库 `/healthz`。推送成功后仍需检查平台构建与运行日志和真实响应，再记录地址和版本。必要时通过官方 `deploy_repo` 使用现有配置启动，不配置付费资源。本机无 Docker；平台构建结果与本机验证分别记录。

本次尚未付费，新增费用须另获授权。不同平台入口、资源和费用随时可能变化，执行时核对官方说明；不得用占位 URL 代替线上结果。竞赛若对华为技术栈、模型、数据或发布位置有要求，必须先取得真实规则再决策。桌面权限问题已解决，历史暂存位置不再构成当前发布阻塞。
