# 现有魔搭 Gradio 空间适配

目标空间为 `philosophia/promotion-agent`，平台显示名“销售助手”，保持其现有 Gradio `6.29.1` SDK 与免费硬件 `platform/2v-cpu-8g-mem`。适配器只展示当前协作框架，显示名不代表已经交付销售业务。

本次新增 `backend/studio/gradio_app.py`，不修改原标准库 HTTP 服务、Docker 文件或远端保留副本。根入口 `app.py` 和平台依赖文件由主控管理。原始远端内容保留在 `.collaboration/promotion-inspect/`，该目录不参与页面内容读取。

## 行为与边界

适配器复用 `backend.studio.app.PAGE` 中的固定 HTML 正文，移除完整文档包装及原服务的健康检查页脚，将其交给 `gr.Blocks` 内的单一 `gr.HTML` 组件展示。页面包含七角色职责、结构化消息示例与模拟任务流转；没有交互输入、事件处理函数、模型接入、训练、实际 Agent 进程或真实看板读取。

此入口运行 Gradio Web 服务，Gradio 自身会提供页面与框架路由；原标准库服务的 `/healthz`、任意其他路径 404、POST 405 约定仅适用于 `backend.studio.app`，不能套用到 Gradio 入口。适配器不挂载原服务、不提供业务写入接口或上传组件，也不调用外部模型。Gradio 分析功能关闭，启动明确设置 `share=False`，不创建公开分享隧道。

## 本地启动与平台入口

在项目隔离环境安装平台指定依赖：

```console
python -m pip install gradio==6.29.1
python -m backend.studio.gradio_app
```

默认监听 `0.0.0.0:7860`；只读取 `PORT` 作为端口配置，允许 `1` 至 `65535`，非法值使启动失败。导入模块不会构建或启动服务。主控根入口可使用：

```python
from backend.studio.gradio_app import main

if __name__ == "__main__":
    main()
```

`build_app()` 提供可测试的 Gradio Blocks 对象，`introduction_html()` 返回固定正文。验收应使用精确 `6.29.1` 实例化应用，确认仅含 HTML 展示、无事件依赖，启动后检查页面及 Gradio 配置确含模拟声明与角色内容，再关闭本机服务。页面可正常响应不代表模型、训练或真实业务任务已实现。
