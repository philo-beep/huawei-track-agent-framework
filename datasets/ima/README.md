# IMA Evidence Base

更新日期：2026-10-21。负责人：D 数据与知识库；运行代码由 A 维护。

## 当前状态

- 官方 IMA Skill：`1.1.10`，真实只读调用已通过。
- 已验证能力：知识库搜索/详情、目录根层与子目录首页、知识检索、媒体信息、Markdown 正文读取、图片内容下载。
- 抓取状态：`partial_verified_quota_blocked`。
- 阻断原因：官方接口返回 `220021`“资料获取次数已达上限，请明天再尝试”。
- 请求 ID、业务错误码和响应时间见 `captures/ima-verified-capture-2026-10-21.json`。

## 产物

| 文件 | 用途 |
| --- | --- |
| `captures/ima-verified-capture-2026-10-21.json` | 本批次已验证事实的唯一回放输入 |
| `ima-evidence-bundle.json` | IMA 能力、目录观测、搜索观测、配额和覆盖缺口总账 |
| `targets/HUAWEI-MateBook-14(鸿蒙版)/target-evidence-package.json` | 目标产品证据包入口 |
| `targets/HUAWEI-MateBook-14(鸿蒙版)/evidence-bundle.json` | 事实、图片、价格引用和 coverage |
| `targets/HUAWEI-MateBook-14(鸿蒙版)/image-manifest.json` | 9 张候选图及 SHA-256 |
| `targets/HUAWEI-MateBook-14(鸿蒙版)/sources/` | 全文镜像或 verified excerpt |
| `targets/HUAWEI-MateBook-14(鸿蒙版)/run-metadata.json` | 批次时间和真实请求 ID |

## 真实性边界

- 2 份全文文档已与真实 IMA 返回内容 SHA-256 逐字节匹配；其余仅保存实取哈希和摘录。
- 已合并 IMA 的 5 张分类横幅候选和本地知识库的 4 张目标产品候选，共 9 张；全部 `model_verified=false`、`rights_status=unknown`。
- 事实区同时保留 IMA、本地知识库和华为官方页来源；当前共 13 条事实，其中 5 条来自华为官方规格页、5 条来自本地知识库同源镜像。
- 华为商城直连历史返回 302 循环；失败状态保留在目标包，不伪造库存或可成交报价。
- 价格记录来自 2026-10-17 页面快照，`verification=unverified`，不是 2026-10-21 当前报价。
- 不保存临时签名 URL、请求 headers、凭据、原始 ZIP 或客户数据。

## 复现

在运行区执行离线回放；回放会重新校验所有本地镜像和复用图片的 SHA-256：

```powershell
node backend/agent/ima-evidence-replay.js
```

本地知识库/官方页面补充证据由运行区脚本生成：

```powershell
node backend/agent/evidence-supplement.js
```

配额恢复后执行完整在线抓取：

```powershell
node backend/agent/ima-evidence-cli.js
```
