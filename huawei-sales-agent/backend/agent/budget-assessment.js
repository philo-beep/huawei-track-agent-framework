'use strict';

const PENDING_STATUS = 'potential_conflict_pending_confirmation';
const WITHIN_STATUS = 'within_public_reference_pending_confirmation';

function moneyToCents(value) {
  const text = String(value ?? '').replace(/[,，\s]/g, '').replace(/^[¥￥]/, '');
  if (!text || !/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

function normalizeVariant(value) {
  return String(value || '').toLowerCase()
    .replace(/^huawei\s*/i, '')
    .replace(/[（）()\s\-_/·]/g, '')
    .replace(/harmonyos/g, '鸿蒙版')
    .replace(/鸿蒙版/g, '鸿蒙版')
    .replace(/酷睿\s*ultra/g, '酷睿ultra')
    .replace(/2024/g, '酷睿ultra');
}

function productField(record) {
  return record?.raw_fields?.['规范产品名称'] || record?.raw_fields?.['原始产品名称'] || record?.product_name || record?.product || '';
}

function numericPriceRecord(record) {
  const fields = record?.raw_fields || {};
  const amountCents = moneyToCents(fields['页面金额（元）']);
  if (amountCents === null) return null;
  return {
    amount_cents: amountCents,
    price_type: String(fields['价格类型'] || '未注明价格类型'),
    sku: String(fields['型号或SKU'] || '') || null,
    condition: String(fields['条件摘要'] || '') || null,
    source_title: String(fields['来源标题'] || record.source_entry || '本地价格快照'),
    source_entry: String(record.source_entry || ''),
    verified_at: String(fields['核验时间'] || '') || null,
    current_transaction_quote: record.is_current_transaction_quote === true,
    record_status: String(record.status || 'unknown'),
    record_id: String(fields['记录ID'] || '') || null,
  };
}

function normalizeBudget(budget) {
  if (!budget || typeof budget !== 'object' || Array.isArray(budget)) return null;
  const min = Number.isFinite(budget.min) ? budget.min : Number.isFinite(budget.max) ? budget.max : null;
  const max = Number.isFinite(budget.max) ? budget.max : Number.isFinite(budget.min) ? budget.min : null;
  if (min === null || max === null || min < 0 || max < min) return null;
  return {
    min,
    max,
    currency: typeof budget.currency === 'string' && budget.currency ? budget.currency : null,
    scope: typeof budget.scope === 'string' && budget.scope ? budget.scope : null,
    quantity: Number.isSafeInteger(budget.quantity) && budget.quantity > 0 ? budget.quantity : null,
  };
}

function assessBudget(profile, productName, knowledge = {}) {
  const budget = normalizeBudget(profile?.budget);
  if (!budget) {
    return {
      status: 'not_provided',
      budget: null,
      reference_price: null,
      current_transaction_quote: false,
      message: '客户未提供预算；不推断预算充足性，也不输出交易报价。',
    };
  }
  const complete = Boolean(budget.currency && budget.scope);
  if (!complete) {
    return {
      status: 'not_evaluated',
      budget: { ...budget, complete: false },
      reference_price: null,
      current_transaction_quote: false,
      message: '预算币种或口径不完整；不比较金额，先确认预算范围、币种和单台/总额口径。',
    };
  }
  const target = normalizeVariant(productName);
  const candidates = (knowledge.price_records || [])
    .filter(record => normalizeVariant(productField(record)) === target)
    .map(numericPriceRecord)
    .filter(Boolean)
    .filter(record => record.amount_cents > 0)
    .sort((first, second) => Number(second.current_transaction_quote) - Number(first.current_transaction_quote) || first.amount_cents - second.amount_cents);
  if (!candidates.length || !target) {
    return {
      status: 'not_evaluated',
      budget: { ...budget, complete: true },
      reference_price: null,
      current_transaction_quote: false,
      message: '未找到与目标型号一致的可用价格快照；预算与价格关系保持待确认，不写成交金额。',
    };
  }
  const reference = candidates[0];
  const unitCents = budget.scope === '总额' && budget.quantity ? Math.floor(Math.round(budget.max * 100) / budget.quantity) : null;
  const budgetMaxCents = Math.round(budget.max * 100);
  const comparableCents = unitCents ?? budgetMaxCents;
  const conflict = comparableCents < reference.amount_cents;
  return {
    status: conflict ? PENDING_STATUS : WITHIN_STATUS,
    budget: { ...budget, complete: true },
    reference_price: {
      amount_cents: reference.amount_cents,
      currency: 'CNY',
      price_type: reference.price_type,
      sku: reference.sku,
      condition: reference.condition,
      source_title: reference.source_title,
      source_entry: reference.source_entry,
      verified_at: reference.verified_at,
      record_id: reference.record_id,
      record_status: reference.record_status,
      current_transaction_quote: false,
    },
    current_transaction_quote: false,
    message: conflict
      ? '客户预算低于同型号公开价格参考；该金额不是当前成交报价，需确认完整销售配置、地区、数量与有效期后再判断。'
      : '客户预算不低于同型号公开价格参考；仍不能用参考价替代当前有效报价，需确认完整销售配置、地区、数量与有效期。',
  };
}

module.exports = { assessBudget, normalizeVariant, moneyToCents };
