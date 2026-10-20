# 华销智策 —— 针对华为的销售智能体

本项目面向华为销售顾问，把一次客户推进拆成四步闭环：

1. **读懂客户**：区分明确输入、规则推断和待确认项，生成可用于后续动作的客户画像。
2. **写出内容**：按公众号、小红书、朋友圈的差异生成内容准备稿，产品事实逐条带来源。
3. **给出方案**：用四步规则演算四级价格，并给出 0–30 分钟可执行的演示计划。
4. **推成交**：输出带负责人、触发条件、依赖项和人工确认边界的下一步动作。

当前版本是**规则准备稿模式**：不调用千问、不调用 IMA、不访问外网，结果用于演示和人工复核，不冒充模型生成或真实成交建议。

## 运行

环境要求：Python 3.11+、Node.js 20+。本项目只使用 Python 标准库，不需要 `pip install`。

```bash
python backend/main.py
```

浏览器打开 <http://localhost:7860>。也可以运行：

```bash
bash start.sh
```

页面内按 `Alt+1`、`Alt+2`、`Alt+3` 可填入合成示例。服务只监听本机，客户输入仅用于当前内存会话，20 分钟后过期。

## 验证

```bash
python -m unittest discover -s tests -v
```

真实 HTTP 冒烟（会启动本地端口）：

```bash
HUAWEI_HTTP_SMOKE=1 python -m unittest discover -s tests -v
```

PowerShell 写法：

```powershell
$env:HUAWEI_HTTP_SMOKE='1'; python -m unittest discover -s tests -v
```

## 目录与分工

进入目录开始工作前，先阅读该目录的 `README.md`；文件级负责人和修改边界以项目根目录《文件归属与责任矩阵》为准。

| 目录 | 责任 | 说明 |
| --- | --- | --- |
| `frontend/` | C 前端 | 原生页面、交互、结果与来源展示；见 `frontend/README.md` |
| `backend/` | A Agent 核心 + B 后端接口 | HTTP 网关、会话、Agent 调度和四步业务；见 `backend/README.md` |
| `backend/api/` | B 后端接口 | 同源 API、异常、限流和上传拒绝；见 `backend/api/README.md` |
| `backend/agent/` | A Agent 核心 | 主/子 Agent 调度、提示词、工具和模型调用；见 `backend/agent/README.md` |
| `backend/agent/contracts/` | B 后端接口 | 前后端、Agent 和价格接口契约；见 `backend/agent/contracts/README.md` |
| `backend/agent/prompts/` | A Agent 核心 | 主/子 Agent 提示词；当前规则模式不表示模型已调用 |
| `backend/rag/` | A + D | A 维护检索代码，D 提供清洗数据、切片和索引；见 `backend/rag/README.md` |
| `backend/session/` | B 后端接口 | 会话、聊天历史、过期和持久化；见 `backend/session/README.md` |
| `tests/` | A + E | A 维护自动化脚本和联调，E 协助全流程验收；见 `tests/README.md` |
| `assets/` | C 前端 | 前端可见的答辩截图和演示资产；E 复核公开描述，不收未授权素材 |

数据、测试原始样例和 Agent 规范在并行目录 `../huawei-sales-agent-data/`，运行区不复制原始 ZIP、客户数据、日志或模型权重。

## 数据与真实性边界

- 数据源：`任德耀新建华为 PC 知识库`为主，原库保留去重别名；产品参数与价格参考优先华为官网/商城快照。
- 每条产品事实保留来源条目、SHA-256、适用型号和抓取时间；官网快照有效窗口为 7 天，过期即阻塞。
- 当前公开价格、完整 SKU 和正式图片仍待核实：`public_price_reference=null`、`actual_transaction_quote=false`、正式图片数为 0。
- 四级价格是**基于行业惯例与赛题推断的可配置假设模型**，基价、折扣、资格、地区均为人为设定，待官方确认；演示金额不是华为真实政策或交易报价。
- 咨询与转化效果没有真实数据，不报告提升；30 分钟演示是待执行计划，`onsite_within_30_minutes_verified=false`。
- IMA 未接入；本地知识库与华为官网替代，资料和图片来源标注保留。真实 IMA 接入需要赛事认可的凭证与许可。

## 已知缺口

- 当前规则引擎不读取 `backend/agent/prompts/`，该目录是接入模型时的角色提示词，不代表已调用模型。
- 客户端图片候选未完成画面、SKU 与版权核验，不能作为正式配图。
- 公开演示只接受合成或脱敏文本，拒绝文件上传，避免客户隐私落盘。
