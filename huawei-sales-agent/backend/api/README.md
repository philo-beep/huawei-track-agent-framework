# API 工作区说明

## 负责人

B 后端接口工程师。

## 职责

- `chat.py`：同源 API 请求转发、请求头过滤和错误边界。
- `upload.py`：维护文件上传接口边界；当前策略是明确拒绝上传，避免客户资料落盘。
- 负责数据入库接口、缓存、请求限流、异常捕获、会话记忆和聊天历史持久化的接口边界。
- 公开 `POST /api/profile-steps` 逐题客户画像任务；每轮只接受脱敏对话，由 Agent 调用云端模型分析并返回下一问或完成画像，复用 `/api/runs/{id}` 查询与导出。
- 公开 `POST /api/product-matches` 产品匹配任务；复用会话、CSRF、限流和 `/api/runs/{id}` 查询/导出边界。
- 公开 `POST /api/content-drafts` 多平台内容任务，`platform` 仅接受公众号、小红书、朋友圈；服务端按 `match_input + candidate_id` 重新核验，不信任前端现成正文。
- `GET /api/content-images/<sha256>` 只提供图片审稿清单中登记的附件；未知指纹返回 404。`GET /api/runs/<job>/images.zip` 只允许任务所有者下载当前内容使用的审稿图片包，包内含来源、像素和授权状态。
- 为 C 提供标准化 JSON、错误码和接口文档，为 A 的 Agent 模块提供稳定调用入口。
- 与 `backend/main.py`、`backend/agent/cloud-server.js` 和 `backend/agent/contracts/` 保持一致。

## 开始工作前

1. 阅读 `../../README.md`。
2. 阅读根目录 `团队协作与分工说明.md` 和 `文件归属与责任矩阵.md`。
3. 阅读 `../README.md`、本文件及 `../agent/contracts/README.md`。

## 禁止事项

- 不把业务规则复制到 API 层。
- 不将内部 Node 端口直接暴露给浏览器。
- 不记录客户正文、Cookie、CSRF 令牌或内部异常堆栈。
- 不增加任意文件上传、跨域开放代理或未声明路由。
- 缓存、历史持久化和上传能力未实现前，不得写成已经可用。

## 验收

- 同源请求成功，跨源请求被拒绝；/api/profile-steps、/api/product-matches 与 /api/content-drafts 的输入、并发、限流、查询和导出可复现；画像接口固定最多 8 次追问并拒绝 CSRF/跨源请求。
- 图文图片路由只能返回 image_review_registry.json 的已登记 SHA-256，不能借路径参数读取任意文件。
- 请求体大小、请求方法和错误结构符合契约。
- `/api/upload` 明确返回未实现，不落盘。
- HTTP 冒烟测试通过。

交付需附接口变化、受影响消费方、测试结果和 B 的契约确认记录；涉及 Agent 时由 A 复核，涉及前端时由 C 复核。
## 认证与权限接口

| Method | Path | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | 公开、限流 | 创建账号；首个账号为管理员，其余为成员 |
| POST | `/api/auth/login` | 公开、限流 | 设置 HttpOnly 会话 Cookie，返回用户与 CSRF 令牌 |
| GET | `/api/auth/me` | 已登录 | 返回当前用户、权限、CSRF 与过期时间 |
| POST | `/api/auth/logout` | 已登录 + CSRF | 撤销当前会话并清除 Cookie |
| GET | `/api/admin/users` | `admin:users` | 查看账号与角色 |
| PATCH | `/api/admin/users/<id>` | `admin:users` + CSRF | 修改角色或启停账号 |

业务接口 `/api/examples`、`/api/source-status`、`/api/content-images/<sha256>`、`/api/runs/<id>` 等必须先通过会话校验。`/api/runs`、`/api/profile-steps`、`/api/product-matches`、`/api/content-drafts` 还要求 `analysis:run`；`viewer` 角色只能登录查看，不能运行分析。未登录返回 401，权限不足返回 403。