# 官网快照适配与来源优先级

本轮用户已停止IMA，后端不执行IMA网络、SDK或客户端读取。C负责有限网页采集，D仅读取 `data/official/manifest.json` 的已保存原文；本组件不执行爬取、登录或模型下载。

## 数据约定

清单包含entries。每项提供id、source_type、url/final_url、fetched_at（含时区）、fetch_status、http_status、raw_path/raw_sha256、text_path/text_sha256、text、完整代际product、model_identity_verified、sku、configuration、fields、price、images、limitations。所有hash必须与实际文件字节一致。C的source_pointer.path/sha256指向文本文件，每个field的excerpt必须逐字包含于该原文，scope=model或sku；SKU范围必须与请求完整SKU一致。

`backend/marketing/official.js` 导出 `loadOfficialReference(product, sku=null, options={})` 与 `officialKnowledge(reference)`。默认读取固定清单，options.manifestPath/now仅供内部确定性测试；不允许通过Web输入任意路径。官网域名限定consumer.huawei.com及明确VMALL主机，拒绝伪后缀、用户信息、非HTTPS及非443端口；文件限工作区内、无符号链接、≤8MiB，原文及提取文本均校验SHA256。

完整型号按品牌前缀、空白和括号规范化后严格匹配，2024与鸿蒙版不互换，系列泛名不自动补代际。规格快照必须成功200、身份明确、抓取时间不在未来且距核验不超过7天。该7天为本机复核阈值，不是官网授予的有效期。不同来源同字段值冲突阻塞规格，不能静默挑选有利值。

## 规格与引用

营销优先选已核验官网原文field.excerpt，按现有fact/source_ref保留官方URL、实际文本路径/hash及全文。source_mode=official_snapshot；实际mode仍local，因为此轮消费C保存的快照，不将其冒充实时联网或IMA。抓取时间、原始HTML路径/hash、型号/SKU及限制在核验待确认项和四步sidecar留存。

官网失败或型号不明确时，可明确回退任德耀本地原文。任德耀ZIP别名排在首位，原双别名、具体条目、hash及图片来源全部保留；相同字节不作为双重证据。无法匹配已知型号时不使用近似型号生成内容。多配置系列选项只按原文展示，不拼凑为实际在售SKU。

## 价格边界

public_price_reference只可能是**获取时点的公开零售价参考**，不是实时成交价、门店四级政策或授权报价。要求请求SKU为非空字符串且精确等于entry.sku=price.sku，配置非空且完全相同，币种CNY、安全整数分、原文包含金额及所有conditions，conditions_verified=true，无起售价/国补/券后/会员等未核实条件，抓取距核验≤1小时；提供valid_from/valid_until时须构成真实有效日历与时区时间且核验时点位于该有效区间内，不接受11月31日的自动滚动日期。1小时仅为保守的本机新鲜度阈值，不保证该时段售价不变。

缺完整SKU/条件、来源不可达、哈希不符、过期或多份同SKU价格冲突，公开金额为null并说明未知。不使用网页注释、脚本中未验证数字、搜索摘要、起售价或历史卡片推算。公开价不改写合成policy基价；四级演算仍demo_only，真实marketing.quote.amount与final_transaction_amount_cents始终null。

图片只保留来源候选，model_verified/copyright_verified=false；官网页面出现图片也不代表视觉、SKU或使用许可已核验。
