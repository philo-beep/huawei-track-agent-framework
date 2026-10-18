# 四级报价扩展契约 v1.0

日期 2026-10-18。B 独立增量交付，不修改已验收的 marketing v1.0。消费者 D/QA/E；实现可由四步演示 wrapper 调用。JSON Schema：`contracts/pricing-input.schema.json`、`contracts/pricing-output.schema.json`。本契约仅定义精确算数与真实性边界，不证明业务已实现或门店政策已获得。

## 输入和可信边界

必填 schema_version=1.0、mode、product、sku、quantity、currency=CNY、as_of（Asia/Shanghai 本地日期 YYYY-MM-DD）。可选 budget_total_cents 不传表示未知，不能默认为 0；0 表示明确预算为零，负数/非整数非法。所有金额是整数分；所有数量和中间输出均须是 JS safe integer，超过 9007199254740991 拒绝，不用浮点近似。

- `mode=demo_only`：必须给 policy，不允许 policy_id。policy 及四条规则的 source.kind 固定 synthetic_fixture，完整显示“合成计算样例，不是华为真实政策或交易报价”。输入即使冒称官方也不能提升信任。每条 source 必须非空 title/entry/description，entry 指本地合成样例文件或 JSON 路径，禁止伪造知识库条目。
- `mode=real`：必须给 policy_id，不允许调用者嵌入 policy。当前没有授权四级政策注册表，必须返回 blocked、unit_amount_cents=null、amount_cents=null、actual_transaction_quote=false。不得因任意文本 source、文件名含授权或用户勾选资格就信任。未来仅通过管理者独立审核的只读策略注册表及内容哈希、授权记录、有效期、SKU/地区资格校验接入；启用真实报价需另升版本与 QA 验收，本 v1.0 不开放真实金额输出。

请求无 `region` 字段，演示按 policy.region 显示演示适用地区，不能冒充客户地区已经确认。真实地区资格未经确认时始终阻塞。confirmed_eligibility 只是合成测试布尔条件的显式键集合，不证明实际身份或优惠资格。

## 四级计算规则

policy 必须明确 product/sku/currency 与请求完全匹配，base_unit_cents>0，valid_from≤as_of≤valid_to（闭区间，日期真实有效），calculation_scope=per_unit_then_quantity，tax_treatment=base_includes_tax_no_additional_tax。仅支持基价已含税且没有额外税费的演示；未知税费不推算，其他税制拒绝。规则数组必须恰好四项，其 level 必须依次为 1、2、3、4；乱序/重复/缺级拒绝，不擅自排序或补零。

对每个单台当前金额 B 按数组顺序执行：

1. fixed_discount_cents，value=D：要求 0≤D≤B，raw_after=B-D。
2. discount_basis_points，value=R：R 为保留价格比例（9000 表示九折），0≤R≤10000。用 BigInt 等精确整数算 `raw_after=(B*R+5000)//10000`，逐级半入到分；不得用浮点乘法再随意舍入。
3. proposed_discount=B-raw_after；存在 cap_discount_cents=C 时，实际优惠 `discount=min(proposed_discount,C)`，否则等于 proposed_discount。`after=B-discount`。cap 是单台本级优惠上限，不是最终总价上限。C=0 明确本级不优惠。
4. 相同非空 exclusion_group 同时出现两次视为互斥冲突，整单阻塞；不自动选最便宜规则。required_eligibility 中任何键不在 confirmed_eligibility 时阻塞，不擅自跳过某级。

所有四级都完成后，unit_amount_cents=第四级 after，amount_cents=unit_amount_cents*quantity。乘法精确并校验安全范围；超大输入或结果拒绝，不截断。金额不得为负；固定减免超过当前价格属于规则错误，不自动钳制为零。预算只对合计金额比较，超预算可保留合成结果并 budget_check=insufficient，绝不据此修改规则或报价。未知预算为 unknown。

## 输出和错误

计算成功仅 status=calculated_demo，demo_only=true，actual_transaction_quote=false，input_provenance.synthetic=true、authorization_verified=false。trace 四项逐条给 before/raw_after/discount/after、operation/value/cap、可读公式及该级 source。effective 给日期/地区和 matched；input_provenance 给基价 policy_source、policy_id、计算范围/税费。模板渲染必须反复显著提示合成，不能将该金额填入真实门店报价字段。销售推进只能说“按演示规则的计算结果”，不得承诺优惠/库存/交期。

业务失败 status=blocked，输入错误 status=invalid_input，两金额均 null；trace 可留已完成步骤用于诊断，但不得把未完成四级的末步当最终报价。保留安全可解析的输入摘要；坏类型无需原样回显。diagnostics 建议码：INVALID_INPUT、UNSAFE_INTEGER、POLICY_EXPIRED、POLICY_DATE_INVALID、SKU_MISMATCH、CURRENCY_MISMATCH、RULE_SEQUENCE_INVALID、RULE_CONFLICT、ELIGIBILITY_UNCONFIRMED、NEGATIVE_AMOUNT、REAL_POLICY_UNAVAILABLE。本扩展返回结构化结果，不无限重试、不调用云服务或魔搭，不请求用户补凭证。

## 最小合成计算例

下面是假设数据，entry 均指同一虚构测试 fixture 的 JSON 节点，绝非两个知识库内真实价格政策。基价、四级各有独立说明。D 将其落成测试 fixture 后应使用实际项目内路径替换示意 `synthetic-pricing.json`。

```json
{
  "schema_version": "1.0", "mode": "demo_only", "product": "演示产品", "sku": "DEMO-SKU",
  "quantity": 1, "currency": "CNY", "as_of": "2026-10-18",
  "policy": {
    "id": "SYNTHETIC-001", "product": "演示产品", "sku": "DEMO-SKU", "currency": "CNY",
    "base_unit_cents": 10000, "valid_from": "2026-10-01", "valid_to": "2026-10-31",
    "region": "合成演示地区", "calculation_scope": "per_unit_then_quantity",
    "rounding": "half_up_to_cent_each_level", "tax_treatment": "base_includes_tax_no_additional_tax",
    "source": {"kind": "synthetic_fixture", "title": "合成基价", "entry": "synthetic-pricing.json#/policy/base_unit_cents", "description": "仅为测试设置10000分，不是真实产品价格"},
    "rules": [
      {"level": 1, "operation": "fixed_discount_cents", "value": 1000, "source": {"kind": "synthetic_fixture", "title": "合成一级", "entry": "synthetic-pricing.json#/policy/rules/0", "description": "测试减1000分"}},
      {"level": 2, "operation": "discount_basis_points", "value": 9000, "source": {"kind": "synthetic_fixture", "title": "合成二级", "entry": "synthetic-pricing.json#/policy/rules/1", "description": "测试九折"}},
      {"level": 3, "operation": "fixed_discount_cents", "value": 0, "source": {"kind": "synthetic_fixture", "title": "合成三级", "entry": "synthetic-pricing.json#/policy/rules/2", "description": "测试不减免"}},
      {"level": 4, "operation": "discount_basis_points", "value": 10000, "source": {"kind": "synthetic_fixture", "title": "合成四级", "entry": "synthetic-pricing.json#/policy/rules/3", "description": "测试保持金额"}}
    ]
  }
}
```

预期逐级：10000→9000→8100→8100→8100 分，数量 1，合计 8100 分（81.00 元），仅演示。四级实际政策缺失的 real 请求仍金额 null，不因该样例通过而宣称痛点 B 的真实业务规则已经解决。
