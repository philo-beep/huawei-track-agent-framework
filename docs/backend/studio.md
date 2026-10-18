# 只读框架展示服务

此服务使用 Python 标准库，适合魔搭 Docker 免费 CPU 环境。它只展示内嵌中文介绍，不接入模型、不训练、不启动实际 Agent 进程，也不执行页面中的模拟任务。实际赛题业务尚未实现。

## 启动

在项目根目录使用 Python 3.11 或更高版本运行：

```console
python -m backend.studio.app
```

服务监听 `0.0.0.0`，端口读取 `PORT` 环境变量，未设置时为 `7860`。端口须为 `1` 至 `65535` 的整数，无效值会使进程启动失败。Windows PowerShell 自定义端口示例：

```powershell
$env:PORT = '7860'
python -m backend.studio.app
```

魔搭 Docker 可仅复制 `backend/studio/app.py`，入口为 `python app.py`；由项目根部署配置负责镜像、暴露端口与平台发布。本服务不联网发布，也无第三方依赖或安装步骤。

## HTTP 行为

| 方法与路径 | 结果 |
| --- | --- |
| `GET /` | `200`，UTF-8 中文 HTML，含角色职责、结构化消息及模拟验收流程 |
| `GET /healthz` | `200`，JSON 健康状态与模拟范围标识 |
| `HEAD /`、`HEAD /healthz` | 对应成功状态及响应头，无正文 |
| 其他 GET/HEAD 路径（含查询字符串） | `404`，固定文本，无目录或文件内容 |
| `POST/PUT/PATCH/DELETE/OPTIONS/TRACE/CONNECT` | `405`，`Allow: GET, HEAD`，无状态修改 |

健康检查固定载荷如下；它只表明展示 HTTP 服务可响应，不代表模型或真实任务正常运行。

```json
{"status":"ok","service":"framework-studio","simulation":true,"model_connected":false,"training":false,"actual_agents_running":false}
```

## 数据边界与验证入口

页面及健康响应均为代码内固定内容。服务不读取本地项目文件、真实看板、凭据或环境秘密；仅启动入口读取端口配置 `PORT`。它不使用 `SimpleHTTPRequestHandler`，无静态文件服务、写接口、模型调用或外部资源请求。访问日志已关闭，响应声明不缓存，并限制页面外部内容及表单提交。CSP 的 `frame-ancestors` 仅允许 `https://modelscope.cn` 与 `https://*.modelscope.cn`，以兼容魔搭页面 iframe 嵌入；未放开其他站点。

`backend.studio.app.StudioHandler` 可用于独立请求验证。`create_server(host="127.0.0.1", port=0)` 可由测试创建本机随机端口服务，测试结束须执行 `shutdown()` 和 `server_close()`；导入模块不会启动服务器。生产入口受 `if __name__ == "__main__"` 保护。

建议验收覆盖首页中文及模拟声明、健康检查 JSON、HEAD 无正文、未知路径与目录穿越路径 404、POST 405，以及导入无监听副作用。服务仅展示协作框架，不能据此声称模型接入、训练、Agent 运行或业务能力已交付。
