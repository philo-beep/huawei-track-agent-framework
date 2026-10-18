# 公开云端交互页

任务 CLOUD-A-002；独立目录 `frontend/cloud/`，不修改已验本机 `frontend/growth/`。

本页消费 D 确认的公开云 API：GET `/api/examples` 返回 `csrf_token`、最多三个合成 `examples` 及 `engine`；POST `/api/runs` 只提交 `{marketing_input:{product,platform,audience?,scenario?,raw_request?},demo_pricing:boolean}`。完整产品枚举为 `HUAWEI MateBook 14 2024` 与 `HUAWEI MateBook 14 鸿蒙版`；三个自由字段各最多800字符，整体JSON最多4096字节。浏览器携带同源cookie与独立CSRF。GET `/api/runs/:id`、JSON/Markdown导出与本机异步job形状一致，业务结果新增 `runtime_engine`。实际服务、会话隔离及资源限制由 D 实现，QA独立验收。

四步结果均以文本安全渲染，Markdown不插入HTML；来源链接限HTTP(S)，拒绝带用户名密码的URL。客户资料不得输入真实隐私。公开云端仅加载公开官网材料，未上传受控本地知识库。页面明确区分规则准备稿、CPU千问辅助与本机7B，不将程序化最终稿说成千问自由生成。

Alt+1/2/3只填示例，Ctrl+Enter运行；输入法组合、长按键和运行中不会重复提交。新客户清除原话、受众、场景并关闭合成报价，客户描述或型号变化也关闭旧合成报价。5台固定合成数量只用于演算，不当作客户事实。不能编辑任意policy/customer路径。查询网络错误后保留运行锁，通过“继续结果查询”恢复，避免重复生成。

页面提供业务阻塞/澄清、异常、加载、运行、导出提示。当前正式图片0张；真实价格未核实为null；报价政策假设、现场30分钟耗时未验证、无真实转化证据均直接展示。复制失败可下载或手动复制。UI美化是后续项。

验证范围：JS语法与页面ID/脚本绑定检查；实际接口联调和浏览器按键由QA验证，不把静态检查声称实际浏览器验收。
