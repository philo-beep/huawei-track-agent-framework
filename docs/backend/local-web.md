# 本机网页服务

```powershell
node backend/marketing/web-server.js --port 8765
```

默认端口8765，仅绑定127.0.0.1；访问 `http://127.0.0.1:8765/`。localhost同端口也可访问，但提交Origin必须与实际Host完全同源。该服务调用当前真实 `runFourSteps`，不返回固定营销样例结果，不自动下载模型或调用IMA。

页面静态白名单为frontend/growth/index.html、app.js、styles.css。API遵循 `docs/api/local-web-v1.md`：GET /health或/api/health、GET /api/examples、POST /api/runs、GET /api/runs/:id及固定JSON/Markdown导出。默认runner执行真实本地四步，测试可用 `startServer({port:0,runner})` 注入；注入结果只能算HTTP边界测试。

每次进程生成CSRF令牌，GET examples返回；POST必须带同源Origin及X-CSRF-Token。Host限定localhost或127.0.0.1当前端口，禁止任意Origin/CORS。JSON请求最多65536字节，严格UTF8；输入只接受marketing_input、可选pricing_input业务对象并校验现有契约。省略pricing_input仍生成营销与方案准备，但报价金额null、needs_attention并单列缺规则诊断，绝不自动补合成政策。Web禁用revision历史文件路径，重新编辑输入可再次生成；引用说明中的source.entry纯文本不触发文件读取或网络访问。

仅一个任务运行，忙时409 BUSY，不排队；页面约每秒查询状态。通常生成需数十秒，沿用模型单次120秒有界超时，出现一次纠正生成时可能更久；关闭页面只停止轮询，不宣称取消任务。执行异常failed；完整业务结果即使needs_attention/blocked仍job completed，需按result业务状态展示缺口。健康检查不触发模型，model_ready=not_probed不能当作模型已就绪。

最多保留20个进程内任务；重启丢失历史job，已下载文件不受影响。导出仅从内存UUID映射取result，不接受用户路径或URL。服务不发送客户消息，不记录客户全文、密钥或模型参数日志。网页显示的公开价格参考、合成四级和真实报价null保持独立；正式图片及现场30分钟/转化效果不冒称完成。

服务保持运行由主控本机启动脚本管理，监听日志只含状态和本机地址。停止可终止该Node进程；本模块不会安装系统服务、开放防火墙或绑定局域网。
