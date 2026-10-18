# 本地网页 API v1.0

本轮网页是既有四步 CLI 的本地操作入口，不改变营销/价格业务契约，不把公开价格参考或合成政策当作真实成交报价。消费者 A/D/QA。Node 原生 HTTP 服务默认只绑定 `127.0.0.1:8765`，页面与 API 同服务；不公开到局域网，不加数据库或无界任务队列。本文是实现前契约，实际能力以 D 交付和 QA 复验为准。

## 共同约定

JSON 使用 UTF-8；响应错误统一 `{ "error": { "code": "机器码", "message": "安全中文摘要" } }`，不含堆栈、客户原话或凭据。请求体仅 `application/json` 且不超过65536字节。未知业务字段、任意输入/输出文件路径、外部URL或执行命令不得传给文件或进程调用；marketing_input 按既有营销输入白名单解析，pricing_input 按既有价格契约解析。pricing_input 可内嵌纯对象 policy，禁止任意policy文件路径，不自动补合成政策。

每次请求校验 Host 为 `127.0.0.1:8765` 或 `localhost:8765`（端口以实际配置为准），拒绝其他地址。POST 要求 Origin 等于当前请求 Host 的 `http` 同源地址，且 `X-CSRF-Token` 匹配本次进程生成、由 GET examples 返回的随机 token；缺失或错误返回403。禁止通配 CORS。Host 别名允许不等于跨Origin允许：localhost页面只能对localhost同源POST，127页面同理。读取接口同样不对任意外站开放跨域。token仅本机防误请求，不宣称用户身份认证。

## 路由

| 方法与路径 | 正常响应 | 失败 |
| --- | --- | --- |
| GET `/api/health` 或 `/health` | 200 `{status:"ok"}`，可附模型/数据就绪提示，不触发模型调用 | 503 可用安全提示表示未就绪 |
| GET `/api/examples` | 200 `{csrf_token,examples:[{id,label,marketing_input,pricing_input?}]}`；全部合成、标明假设政策 | 500 安全摘要 |
| POST `/api/runs` | 输入 `{marketing_input,pricing_input?}`；202 `{id,status:"running"}`，启动真实 runFourSteps | 400 输入无效，403同源/token失败，409 BUSY，413太大，415非JSON |
| GET `/api/runs/:id` | 200 `{id,status,result,markdown,error}` | 404未知/已清理ID |
| GET `/api/runs/:id/export?format=json` | 200 完成结果JSON附件 | 400未知格式，404未知ID，409未完成 |
| GET `/api/runs/:id/export?format=markdown` | 200 UTF-8 Markdown附件 | 同上 |

job.status 为 `running/completed/failed`。running 时 result/markdown/error 均为null；completed 时 result为既有四步完整结果，markdown为同一结果的Markdown字符串，error=null；failed 时 result/markdown=null，error为 `{code,message}` 安全对象（不重复error包装）。完整业务结果即使状态 blocked/needs_clarification 仍可completed，前端必须展示业务阻塞状态，不能只凭job完成显示成功。业务CLI的退出码3若已有完整解释结果，不能直接丢掉诊断。执行异常才failed，不制造空的成功结果。

只容许一个运行中任务；忙时直接409，不排队、不重启旧任务。ID为服务生成并校验的UUID安全标识，不是文件路径；状态查询、导出只在进程持有的job索引中取固定结果，禁止任意路径读取、URL代理或访问框架控制文件。任务保留数量有界，清理后404；重启不保证保留job。真实模型有界超时沿用既有流水线；前端轮询约1秒，可停止轮询但不能声称取消后端任务。

JSON导出为 result 本身（无job包装），Markdown导出等于 job.markdown，文件名由服务生成，不能接受用户路径。返回 `Cache-Control: no-store`；页面渲染用户内容及Markdown须使用文本/安全转义，不直接插入不可信HTML。空状态、运行中、澄清/阻塞、执行失败、下载完成均应有中文提示。

## 四步与数据来源边界

页面显示画像及证据、内容准备稿、报价性质与逐级算式、0–30分钟方案及下一步动作。正式 quote 仍 blocked/null，独立演示报价显著标“假设政策，非真实交易报价”；官网公开价格仅作有日期/型号/配置/适用条件的参考，不回填真实quote。营销有效mode固定local，旧ima输入不能发起IMA调用。知识库条目、官网页面、图片来源随结果/导出保留；没有正式图片应展示缺口，不能展示无来源占位图作正式图片。

合成快捷案例见 `mocks/local-web-request.json`。该样例用于请求结构演示，不表示已运行、真人客户、真实价格或转化结果。键盘快捷示例由A实现；快捷键只填入合成案例，生成须有明确操作且运行中不能重复提交。
