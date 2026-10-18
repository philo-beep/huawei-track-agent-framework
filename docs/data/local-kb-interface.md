# 双 ZIP 本地证据接口

本接口只用于获授权的本地开发。它不连接 ima，不产生 ima 知识库或资料 ID，不代表已满足正式比赛的真实检索要求。B 的 `contracts/` 为业务接口唯一事实来源；本说明只描述 C 提供给 D 的本地数据读取接口。

## 运行

Python 3.11 或以上，仅标准库，在项目根目录运行：

```powershell
python data/build_local_index.py build
python data/build_local_index.py query --product "HUAWEI MateBook Pro S"
python data/build_local_index.py query --product "HUAWEI MateBook Pro S" --include-prices
```

`--workspace` 可指定项目根目录。来源必须是根目录的 `华为PC知识库(1).zip` 和 `任德耀新建华为PC知识库.zip`。脚本只在 `.collaboration/runtime/local-kb/` 写入索引和哈希命名图片；此目录受根 `.gitignore` 的 `.collaboration/` 规则排除，不应复制到公开目录。脚本不会改原 ZIP、Git 或部署平台。

构建命令 stdout 是单个 JSON 摘要。查询命令 stdout 是单个 JSON，错误写 stderr 且退出码为 1。也可用 `importlib.util` 导入模块，调用 `build(workspace)` 或 `query(workspace, product, limit=4, include_prices=False)`。程序不发起网络请求，不依赖密钥和模型。

## 索引结构

`index.json` 根字段：`schema_version=1`、`mode=offline_local_zip`、`knowledge_status=offline_only`、`ima_connected=false`、`competition_compliance_verified=false`、`built_at`、`source_archives`、`documents`、`images`、`price_records`、`pricing_rules`、`quality`。

| 字段 | 内容与边界 |
| --- | --- |
| `source_archives` | 每个 ZIP 的文件名别名、SHA256、文件数；同内容双来源不能算独立佐证 |
| `documents[].kind` | `product_fact` 为重点型号原始事实；`product_catalog` 为扩展产品目录原文；`public_price_snapshot` 只作有时点的价格证据 |
| `documents[].text` | 完整 UTF-8 原文，含脚注、限制与 URL；不把索引摘要当事实，不自动拆句删除限定语 |
| `documents[].source` | `provider=local_zip`、ZIP 内 `entry`、原始字节 `entry_sha256`、`archive_aliases`、`urls`、全文行范围 `text_location` |
| `images[].local_path` | 相对项目根目录的真实文件路径，哈希文件名，导出后可复算原始条目哈希；只允许受控本地展示 |
| `images[].source` | `provider=local_zip`、原图 `entry` 与哈希、双别名、原图 `urls`、来源 `page_urls`、`index_entries` |
| `images[].product_names` | 相邻图片索引明确声明的型号；缺失时仅以 P1 产品事实所在目录建立候选关联；无法关联的保持空列表 |
| `images[].model_association` | 区分明确索引关联与待目视核验的目录关联，不能凭文件名断言型号 |
| `images[].model_verified` | 全部为 `false`；本步骤没有进行图片画面、配色/SKU 或版权审核 |
| `images[].usable_as_verified_product_image` | 全部为 `false`，不能当成已核验正式商业配图 |
| `price_records[].raw_fields` | CSV 原字段，保留金额口径、条件、来源、库存状态与核验时点；空金额不是零 |
| `price_records[].is_current_transaction_quote` | 全部为 `false`，当前成交报价不得用快照直接承诺 |
| `pricing_rules` | `status=blocked`，列出真实四级规则缺口；不得以模板生成金额 |

## 查询行为

查询按完整型号规范化精确匹配：忽略英文大小写、空格、连字符、括号与可选 HUAWEI 前缀，不做模糊子串或跨型号继承。无法匹配返回 `status=not_found`，不会换成近似型号。可返回原始事实和扩展目录两个关联原文，消费者应检查其限定条件是否一致。

返回 `documents`、`image_candidates`、空的 `verified_images`、`price_records` 和 `pricing_rules`。`documents` 默认最多 4 份，`--limit` 支持 1 至 20。`image_candidates` 最多 20 张，全部是待审核候选。未知型号图片不随产品查询返回。默认过滤 `public_price_snapshot` 且 `price_records=[]`；只有显式 `--include-prices` 才带价格快照。

`source_refs` 可由 D 从文档 `source` 构造：保留 `provider/archive_aliases/entry/entry_sha256/urls`，再以原文实际子串填写 `excerpt` 和原文位置。禁止凭空产生 ima ID；禁止只引摘录而删除影响结论的配置、版本、适用范围或日期。图片引用保留 `source`、`local_path` 与待审核状态。

数据源更新后重新构建。同一路径不同字节会直接报冲突，禁止静默择一。运行目录或图片目录越界与符号链接会停止处理。脚本不主动上传、发布或复制知识库到公开交付。
