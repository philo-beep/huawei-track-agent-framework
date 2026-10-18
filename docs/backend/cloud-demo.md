# 公开云演示

运行要求 Node 24，无 npm/Python/模型依赖。入口 `node backend/marketing/cloud-server.js`；`PORT=7860`，绑定 `0.0.0.0`；`PUBLIC_ORIGIN` 必须为实际唯一公网 origin（例如魔搭 `.ms.show` 地址，不带路径）。`/healthz`、`/health`、`/api/health` 支持容器loopback探针；其他业务要求配置Host，POST要求同源Origin、独立会话cookie与CSRF，不信代理头推导来源。

魔搭反代会改写容器所见Host。正式部署可显式设置 `PLATFORM_PROXY_HOST=1`，仅关闭Host与公网域名等值判断，默认未配置仍严格校验。公网平台负责域名路由，应用始终使用固定 `PUBLIC_ORIGIN` 解析路径、验证Origin和POST、配置Secure cookie，不采用 `X-Forwarded-Host` 或 `Forwarded` 改写可信来源。其他CSRF、会话隔离、大小、限流与路径边界保持原样；直接访问非平台部署应保留默认严格模式。

当前引擎 `runtime_engine.mode=rules/model=null/model_status=disabled`，云端没有调用7B、Qwen小模型或外部API。采用免费规则画像、已核验官网公开快照、严格事实核验与程序化准备稿；真实本地Qwen证据与此云端版本分开。曾核官方Qwen2.5-0.5B-Instruct模型卡（0.49B、Apache-2.0），但本次时间盒为保证可交互而未下载/部署，不声称这是最新模型或完成CPU模型实测。

静态资源仅 `frontend/cloud/index.html`、`app.js`、`styles.css`。API保留本地异步形状：GET `/api/examples` 返回3组合成例、engine与会话csrf；POST `/api/runs` 只接受 `{marketing_input:{product,audience?,scenario?,raw_request?,platform},demo_pricing:boolean}`，可选schema_version1.0/mode local。产品仅 `HUAWEI MateBook 14 鸿蒙版` 与 `HUAWEI MateBook 14 2024`；自由字段各800字、请求4096字节，不接收任意customer、policy、文件路径或URL。用户只应输入合成/脱敏描述。

GET `/api/runs/:id`、GET `/api/runs/:id/export?format=json|markdown` 必须为创建任务的同一会话。20分钟会话/结果TTL，最多100会话、20结果、单运行、不排队；每会话3次、间隔2秒，全站10分钟60次。UUID之外还校验随机256位HttpOnly SameSite=Lax会话cookie；HTTPS加Secure，输入不落盘或日志；重启丢失任务。平台流量日志不由此程序控制。公网界面通过同源浏览器请求自动携带cookie，无需用户token。

`demo_pricing` 默认false，不自动补合成规则。明确开启后才演算固定5台：600000分→588000→578000→578000→573000分，合计2865000分；无真实预算。四级分别为人为客户类型、采购数量、配置与区域假设，非官方政策。配置有效2026-01-01至2026-12-31，`as_of` 用当前UTC日期，到期由价格模块阻塞，维护者需审查更新。5台/SKU/资格不是客户事实；真实quote始终null。

仅读取 `data/official`，先核验有效官网数据后才进入既有流水线，不回退私有ZIP；7天过期或hash异常明确失败，不解除有效期。只公开官网数据与合成配置，禁止打包本地知识库、缓存、模型权重、运行记录、凭据。刷新官网资料属于后续维护，本轮不修改C已验字节。

`outputs/D/cloud-check.cjs` 在临时loopback服务实跑规则四步、报价/可选报价、真实JSON/Markdown导出、Host/CSRF/跨会话/大小/限流和静态路由。该证据为本机真实规则业务HTTP，真实模型调用0，不能当作已上线或云Qwen接入；上线公网探测由主控与QA另行记录。
