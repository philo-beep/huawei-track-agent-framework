'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateSchema, PipelineError } = require('./support');

const MAXIMUM = BigInt(Number.MAX_SAFE_INTEGER);
const NOTICE = '此为基于行业惯例与赛题推断的合理假设，待官方确认；未取得行业实证或华为授权，合成计算样例不是华为真实政策或交易报价。';

function readSchema(name) {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'contracts', `pricing-${name}.schema.json`), 'utf8'));
}

function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateExtended(value, schema, root = schema, location = '$') {
    validateSchema(value, schema, root, location);
    if (schema.$ref) return validateExtended(value, schema.$ref.split('/').slice(1).reduce((current, name) => current[name], root), root, location);
    if (schema.anyOf) {
        const matches = schema.anyOf.some(branch => {
            try { validateExtended(value, branch, root, location); return true; } catch { return false; }
        });
        if (!matches) throw new PipelineError('INVALID_INPUT', `${location} 不符合任何允许结构`);
    }
    if (schema.format === 'date' && !validDate(value)) throw new PipelineError('POLICY_DATE_INVALID', `${location} 日期不存在或格式错误`);
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new PipelineError('UNSAFE_INTEGER', `${location} 必须是安全整数`);
    if (Array.isArray(value)) {
        if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new PipelineError('INVALID_INPUT', `${location} 项目过多`);
        if (schema.uniqueItems && new Set(value.map(entry => JSON.stringify(entry))).size !== value.length) throw new PipelineError('INVALID_INPUT', `${location} 不允许重复项`);
        if (schema.items) value.forEach((entry, index) => validateExtended(entry, schema.items, root, `${location}/${index}`));
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [name, entry] of Object.entries(value)) if (schema.properties?.[name]) validateExtended(entry, schema.properties[name], root, `${location}/${name}`);
    }
    for (const clause of schema.allOf || []) {
        if (!clause.if) validateExtended(value, clause, root, location);
        else {
            let matches = true;
            try { validateExtended(value, clause.if, root, location); } catch { matches = false; }
            if (matches && clause.then) validateExtended(value, clause.then, root, location);
            if (!matches && clause.else) validateExtended(value, clause.else, root, location);
        }
    }
    return true;
}

function safeMoney(value) {
    if (value < 0n) throw new PipelineError('NEGATIVE_AMOUNT', '规则会导致负金额，未自动归零');
    if (value > MAXIMUM) throw new PipelineError('UNSAFE_INTEGER', '精确计算结果超出安全整数范围，未截断');
    return Number(value);
}

function initialResult(input) {
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    return {
        schema_version: '1.0', mode: value.mode === 'real' ? 'real' : 'demo_only', status: 'invalid_input', demo_only: value.mode !== 'real', actual_transaction_quote: false,
        product: typeof value.product === 'string' ? value.product : null, sku: typeof value.sku === 'string' ? value.sku : null,
        quantity: Number.isSafeInteger(value.quantity) && value.quantity > 0 ? value.quantity : null, currency: value.currency === 'CNY' ? 'CNY' : null,
        effective: { as_of: typeof value.as_of === 'string' ? value.as_of : null, valid_from: null, valid_to: null, region: null, matched: false },
        rounding: 'half_up_to_cent_each_level', unit_amount_cents: null, amount_cents: null, trace: [],
        input_provenance: { policy_id: null, policy_source: null, synthetic: false, authorization_verified: false, calculation_scope: 'per_unit_then_quantity', tax_treatment: 'base_includes_tax_no_additional_tax' },
        budget_check: 'not_evaluated', diagnostics: [],
    };
}

function calculatePricing(input) {
    const result = initialResult(input);
    let inputValid = false;
    try {
        validateExtended(input, readSchema('input'));
        inputValid = true;
        if (input.mode === 'real') {
            result.input_provenance.policy_id = input.policy_id;
            throw new PipelineError('REAL_POLICY_UNAVAILABLE', '没有独立获授权的真实四级政策注册表；真实报价始终阻塞，金额null');
        }
        const policy = input.policy;
        result.input_provenance.policy_id = policy.id;
        result.input_provenance.policy_source = policy.source;
        result.input_provenance.synthetic = true;
        result.effective = { as_of: input.as_of, valid_from: policy.valid_from, valid_to: policy.valid_to, region: policy.region, matched: false };
        if (policy.valid_from > policy.valid_to) throw new PipelineError('POLICY_DATE_INVALID', '政策起止日期顺序错误');
        if (policy.product !== input.product || policy.sku !== input.sku) throw new PipelineError('SKU_MISMATCH', '产品或完整SKU与演示政策不匹配');
        if (policy.currency !== input.currency) throw new PipelineError('CURRENCY_MISMATCH', '币种与政策不匹配');
        if (input.as_of < policy.valid_from || input.as_of > policy.valid_to) throw new PipelineError('POLICY_EXPIRED', '请求日期不在政策闭区间有效期内');
        if (policy.rules.some((rule, index) => rule.level !== index + 1)) throw new PipelineError('RULE_SEQUENCE_INVALID', '规则必须依次为1/2/3/4，不排序或补齐');
        const groups = new Set();
        const eligibility = new Set(input.confirmed_eligibility || []);
        for (const rule of policy.rules) {
            if (rule.exclusion_group) {
                if (groups.has(rule.exclusion_group)) throw new PipelineError('RULE_CONFLICT', '多个等级使用相同互斥组，整单阻塞');
                groups.add(rule.exclusion_group);
            }
            if ((rule.required_eligibility || []).some(key => !eligibility.has(key))) throw new PipelineError('ELIGIBILITY_UNCONFIRMED', `第${rule.level}级演示资格未显式确认，未跳级`);
        }
        result.effective.matched = true;
        let current = BigInt(policy.base_unit_cents);
        for (const rule of policy.rules) {
            const before = current;
            const operand = BigInt(rule.value);
            if (rule.operation === 'fixed_discount_cents' && operand > before) throw new PipelineError('NEGATIVE_AMOUNT', `第${rule.level}级固定减免超过当前单价`);
            const rawAfter = rule.operation === 'fixed_discount_cents' ? before - operand : (before * operand + 5000n) / 10000n;
            const proposed = before - rawAfter;
            const cap = rule.cap_discount_cents === undefined ? null : BigInt(rule.cap_discount_cents);
            const discount = cap === null || proposed <= cap ? proposed : cap;
            current = before - discount;
            const calculation = rule.operation === 'fixed_discount_cents' ? `${before} - ${operand} = ${rawAfter}` : `(${before} × ${operand} + 5000) 整除 10000 = ${rawAfter}（比例为保留价格比例）`;
            result.trace.push({ level: rule.level, operation: rule.operation, value: rule.value, before_cents: safeMoney(before), raw_after_cents: safeMoney(rawAfter), discount_cents: safeMoney(discount), after_cents: safeMoney(current), cap_discount_cents: cap === null ? null : safeMoney(cap), formula: `${calculation}；优惠=${cap === null ? proposed : `min(${proposed},${cap})`}=${discount}；本级后=${current}分`, source: rule.source });
        }
        const total = current * BigInt(input.quantity);
        const unitAmount = safeMoney(current);
        const totalAmount = safeMoney(total);
        result.unit_amount_cents = unitAmount;
        result.amount_cents = totalAmount;
        result.budget_check = input.budget_total_cents === undefined ? 'unknown' : total <= BigInt(input.budget_total_cents) ? 'within_budget' : 'insufficient';
        result.status = 'calculated_demo';
        result.diagnostics.push({ code: 'SYNTHETIC_DEMO_ONLY', message: NOTICE }, { code: 'REGION_AND_ELIGIBILITY_DEMO_ONLY', message: '地区来自演示policy，资格键由合成输入显式设置，不证明客户真实地区或实际优惠资格' });
    } catch (error) {
        result.status = inputValid ? 'blocked' : 'invalid_input';
        result.unit_amount_cents = null;
        result.amount_cents = null;
        result.budget_check = 'not_evaluated';
        result.diagnostics.push({ code: error instanceof PipelineError ? error.code : 'INVALID_INPUT', message: error instanceof PipelineError ? error.message : '报价输入或计算异常，未输出原始数据' });
    }
    validateExtended(result, readSchema('output'));
    return result;
}

module.exports = { calculatePricing, validateExtended, validDate, NOTICE };
