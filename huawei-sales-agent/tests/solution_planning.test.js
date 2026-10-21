'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDealPlan, buildQuoteStatus } = require('../backend/agent/solution-planning');
const { runCloud, cloudMarkdown } = require('../backend/agent/cloud-runner');

function profile(overrides = {}) {
    const pending = () => ({ value: null, status: 'pending', evidence: [], reason: '未提供明确依据，待确认', confidence: 0 });
    return {
        identity: { value: '采购负责人', status: 'explicit', evidence: [{ input_path: '/raw_request', quote: '采购负责人' }], reason: '客户原话', confidence: 1 },
        relationship: pending(),
        industry: pending(),
        company_size: pending(),
        needs: { value: ['移动办公'], status: 'explicit', evidence: [{ input_path: '/raw_request', quote: '移动办公' }], reason: '客户原话', confidence: 1 },
        budget: pending(),
        decision_chain: pending(),
        preferences: pending(),
        pain_points: pending(),
        purchase_stage: pending(),
        channels: pending(),
        ...overrides,
    };
}

const facts = [{
    id: 'official-1',
    claim: '来源原文事实',
    conditions: ['仅适用于原文所列条件'],
    source_refs: [{ title: '华为官网', entry: 'fixture', archive_aliases: ['官方快照'], urls: ['https://example.invalid'] }],
}];

const actions = [
    { action: '核对 official-1 对应原文与限制', owner: '方案工程师（待指定）', trigger: '需求确认后', pending_dependencies: ['软件版本'] },
    { action: '收集真实报价规则后出具报价单', owner: '报价审核负责人（待指定）', trigger: '报价依据齐备后', pending_dependencies: ['有效政策'] },
];

test('missing price basis keeps transaction price null and does not infer budget feasibility', () => {
    const pricing = {
        status: 'blocked', actual_transaction_quote: false, amount_cents: null, currency: null,
        input_provenance: { synthetic: false, policy_id: null, policy_source: null },
    };
    const plan = buildDealPlan({ profile: profile(), facts, request: { product: 'P', audience: 'A', scenario: '移动办公' }, marketingStatus: 'ready', pricing, nextActions: actions });
    assert.equal(plan.quote_status.status, 'missing_basis');
    assert.equal(plan.quote_status.price, null);
    assert.equal(plan.quote_status.amount_cents, null);
    assert.equal(plan.budget_assessment.status, 'missing');
    assert.equal(plan.budget_assessment.range, null);
    assert.equal(plan.budget_assessment.feasibility.status, 'cannot_determine');
    assert.equal(plan.base_solution.status, 'actionable');
    assert.ok(plan.base_solution.evidence_basis.profile_evidence_refs.length >= 2);
    assert.deepEqual(plan.base_solution.evidence_basis.fact_ids, ['official-1']);
});

test('synthetic pricing remains a separate reference and never becomes the customer quote', () => {
    const pricing = {
        status: 'calculated_demo', actual_transaction_quote: false, amount_cents: 573000, unit_amount_cents: 573000, quantity: 1, currency: 'CNY',
        input_provenance: { synthetic: true, policy_id: 'SYNTHETIC', policy_source: { title: '合成政策' } }, budget_check: 'within_budget',
    };
    const quote = buildQuoteStatus(pricing);
    assert.equal(quote.status, 'pending_confirmation');
    assert.equal(quote.price, null);
    assert.equal(quote.synthetic_reference.amount_cents, 573000);
    assert.equal(quote.synthetic_reference.actual_transaction_quote, false);
});

test('explicit budget is preserved while feasibility waits for reliable quote evidence', () => {
    const explicitBudget = {
        value: { min: 6000, max: 6000, currency: 'CNY', scope: '单台', quantity: 12, source_text: '单台预算6000元，采购12台' },
        status: 'explicit', evidence: [{ input_path: '/raw_request', quote: '单台预算6000元' }], reason: '客户输入', confidence: 1,
    };
    const plan = buildDealPlan({
        profile: profile({ budget: explicitBudget }), facts, request: { product: 'P', audience: 'A', scenario: '移动办公' }, marketingStatus: 'ready',
        pricing: { status: 'blocked', actual_transaction_quote: false, input_provenance: { synthetic: false } }, nextActions: actions,
    });
    assert.deepEqual(plan.budget_assessment.range, {
        min: 6000, max: 6000, currency: 'CNY', scope: '单台', quantity: 12, complete: true, source_text: '单台预算6000元，采购12台',
    });
    assert.equal(plan.budget_assessment.feasibility.status, 'cannot_determine');
    assert.equal(plan.quote_status.price, null);
});

test('every action has owner, trigger, time node and unique id', () => {
    const plan = buildDealPlan({ profile: profile(), facts, request: { product: 'P', audience: 'A', scenario: '移动办公' }, marketingStatus: 'ready', pricing: {}, nextActions: [...actions, ...actions] });
    assert.equal(new Set(plan.next_actions.map(action => action.id)).size, plan.next_actions.length);
    for (const action of plan.next_actions) {
        assert.ok(action.owner);
        assert.ok(action.trigger);
        assert.ok(action.time_node);
        assert.ok(action.timing.proposed);
        assert.equal(action.timing.confirmed, false);
        assert.equal(action.status, 'pending');
    }
});

test('four-step output exposes solution, budget, quote and enriched actions', async () => {
    const testCase = require('./test_cases.json').cases.find(item => item.id === 'vague-budget');
    const result = await runCloud(testCase.payload);
    assert.ok(result.solution.base_solution);
    assert.equal(result.quote_status.price, null);
    assert.equal(result.budget_assessment.feasibility.status, 'cannot_determine');
    assert.equal(result.action_plan.status, 'ready_for_owner_assignment');
    assert.ok(result.next_actions.length >= 3);
    const markdown = cloudMarkdown(result);
    assert.match(markdown, /## 基础方案（基于画像与来源证据）/);
    assert.match(markdown, /## 报价状态/);
    assert.match(markdown, /正式价格：null/);
    assert.match(markdown, /## 预算判断/);
});

test('explicit customer quantity cannot be silently replaced by the synthetic five-unit demo', async () => {
    const testCase = require('./test_cases.json').cases.find(item => item.id === 'extreme-low-budget');
    const result = await runCloud(testCase.payload);
    assert.equal(result.customer_analysis.profile.budget.status, 'explicit');
    assert.equal(result.customer_analysis.profile.budget.value.min, 1000);
    assert.equal(result.budget_assessment.status, 'declared_incomplete');
    assert.ok(result.diagnostics.some(item => item.code === 'CUSTOMER_QUANTITY_MISMATCH'));
    assert.equal(result.pricing_result.status, 'blocked');
    assert.equal(result.quote_status.price, null);
    assert.equal(result.quote_status.synthetic_reference, null);
});