'use strict';

const PENDING = '待确认';
const PROFILE_FIELDS = ['identity', 'relationship', 'industry', 'company_size', 'needs', 'budget', 'decision_chain', 'preferences', 'pain_points', 'purchase_stage', 'channels'];

function field(profile, name) {
    return profile && profile[name] && typeof profile[name] === 'object' ? profile[name] : { value: null, status: 'pending', evidence: [], reason: PENDING, confidence: 0 };
}

function listValue(value) {
    if (Array.isArray(value)) return value.filter(item => item !== null && item !== undefined && item !== '');
    return value === null || value === undefined || value === '' ? [] : [value];
}

function unique(values) {
    const seen = new Set();
    return values.filter(value => {
        const key = JSON.stringify(value);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function evidenceRefs(profile, fields = PROFILE_FIELDS) {
    return unique(fields.flatMap(name => (field(profile, name).evidence || []).map(item => ({
        field: name,
        input_path: item.input_path,
        quote: item.quote,
    }))));
}

function factRefs(facts) {
    return (Array.isArray(facts) ? facts : []).map(fact => ({
        id: fact.id,
        claim: fact.claim,
        conditions: Array.isArray(fact.conditions) ? fact.conditions : [],
        source_refs: Array.isArray(fact.source_refs) ? fact.source_refs : [],
    }));
}

function customerContext(profile) {
    return PROFILE_FIELDS.map(name => {
        const value = field(profile, name);
        return {
            field: name,
            value: value.value,
            status: value.status,
            confidence: value.confidence,
            evidence_refs: (value.evidence || []).map(item => ({ input_path: item.input_path, quote: item.quote })),
            reason: value.reason,
        };
    });
}

function normalizeBudget(profile) {
    const budget = field(profile, 'budget');
    const value = budget.value;
    if (budget.status !== 'explicit' || !value || typeof value !== 'object' || Array.isArray(value)) return null;
    const min = Number.isFinite(value.min) ? value.min : Number.isFinite(value.max) ? value.max : null;
    const max = Number.isFinite(value.max) ? value.max : Number.isFinite(value.min) ? value.min : null;
    if (min === null || max === null || min < 0 || max < min) return null;
    return {
        min,
        max,
        currency: typeof value.currency === 'string' && value.currency ? value.currency : null,
        scope: typeof value.scope === 'string' && value.scope && value.scope !== PENDING ? value.scope : null,
        quantity: Number.isSafeInteger(value.quantity) && value.quantity > 0 ? value.quantity : null,
        source_text: typeof value.source_text === 'string' ? value.source_text : null,
        complete: Boolean(value.currency && value.scope && value.scope !== PENDING),
    };
}

function buildQuoteStatus(pricing) {
    const value = pricing && typeof pricing === 'object' ? pricing : {};
    const provenance = value.input_provenance || {};
    const synthetic = provenance.synthetic === true;
    const actualAmount = value.actual_transaction_quote === true && Number.isSafeInteger(value.amount_cents) ? value.amount_cents : null;
    const missingInformation = [
        '客户确认的完整销售配置与采购数量',
        '有效地区和适用客户/渠道资格',
        '获授权的当前政策原文、计算顺序与有效期',
        '税费、舍入、优惠上限和审批边界',
    ];
    if (actualAmount !== null) {
        return {
            status: 'basis_sufficient',
            label: '依据充足',
            price: actualAmount,
            amount_cents: actualAmount,
            currency: value.currency || null,
            transaction_quote: true,
            pricing_status: value.status || null,
            basis: value.input_provenance?.policy_source || null,
            missing_information: [],
            synthetic_reference: null,
            notice: '金额来自已提供的正式价格规则；仍需在具体客户交易中复核销售配置、适用条件和有效期。',
        };
    }
    if (synthetic && value.status === 'calculated_demo') {
        return {
            status: 'pending_confirmation',
            label: '待确认：仅有合成演算，不可作为客户报价',
            price: null,
            amount_cents: null,
            currency: null,
            transaction_quote: false,
            pricing_status: value.status || null,
            basis: value.input_provenance?.policy_source || null,
            missing_information: missingInformation,
            synthetic_reference: value.amount_cents === null || value.amount_cents === undefined ? null : {
                type: 'synthetic_demo_only',
                unit_amount_cents: value.unit_amount_cents ?? null,
                amount_cents: value.amount_cents,
                currency: value.currency || null,
                quantity: value.quantity ?? null,
                policy_id: provenance.policy_id || null,
                actual_transaction_quote: false,
            },
            notice: '合成演算仅用于验证计算结构；正式价格保持 null，待授权依据齐全后由人工确认。',
        };
    }
    return {
        status: 'missing_basis',
        label: '缺依据：正式报价金额保持 null',
        price: null,
        amount_cents: null,
        currency: null,
        transaction_quote: false,
        pricing_status: value.status || null,
        basis: null,
        missing_information: missingInformation,
        synthetic_reference: null,
        notice: '没有可核验的当前价格依据，不推算、不借用历史价或相似配置价格。',
    };
}

function buildBudgetAssessment(profile, pricing, quoteStatus) {
    const budget = field(profile, 'budget');
    const normalized = normalizeBudget(profile);
    const missing = [];
    if (budget.status !== 'explicit') missing.push('客户提供的预算金额与输入证据');
    if (!normalized) missing.push('可核验的预算区间、币种与单台/总额口径');
    else {
        if (!normalized.currency) missing.push('预算币种');
        if (!normalized.scope) missing.push('单台或总额口径');
        if (!normalized.quantity) missing.push('采购数量');
    }
    const actualAmount = quoteStatus.status === 'basis_sufficient' && Number.isSafeInteger(quoteStatus.amount_cents) ? quoteStatus.amount_cents : null;
    let feasibility;
    if (actualAmount === null) {
        feasibility = {
            status: 'cannot_determine',
            label: '无法判断',
            reason: '正式报价缺少可靠依据，不能把未知价格或合成演算写成预算可行/不可行。',
        };
    } else if (normalized && normalized.currency === quoteStatus.currency && ['单台', '总额'].includes(normalized.scope) && (normalized.scope === '总额' || normalized.quantity)) {
        const budgetCents = normalized.scope === '总额' ? normalized.max * 100 : normalized.max * 100 * (normalized.quantity || 1);
        feasibility = {
            status: actualAmount <= budgetCents ? 'within_budget' : 'insufficient',
            label: actualAmount <= budgetCents ? '预算覆盖正式报价' : '预算低于正式报价',
            reason: '依据客户明确预算口径与真实交易报价直接比较，不含税费猜测。',
        };
    } else {
        feasibility = {
            status: 'cannot_determine',
            label: '无法判断',
            reason: '预算币种、口径或数量与正式报价不一致，未自动换算。',
        };
    }
    const demoComparison = pricing?.input_provenance?.synthetic && pricing.status === 'calculated_demo' && pricing.budget_check !== 'not_evaluated' ? {
        type: 'synthetic_demo_only',
        budget_check: pricing.budget_check,
        amount_cents: pricing.amount_cents ?? null,
        notice: '此比较只在显式演示输入下成立，不证明客户真实预算可行或产品可成交。',
    } : null;
    return {
        schema_version: '1.0',
        status: normalized ? (normalized.complete ? 'declared' : 'declared_incomplete') : budget.status === 'pending' ? 'missing' : 'unknown',
        label: normalized ? (normalized.complete ? '已提供预算口径，待可靠报价核验' : '预算口径不完整，待确认') : '预算缺失，待客户确认',
        profile_status: budget.status,
        range: normalized ? {
            min: normalized.min,
            max: normalized.max,
            currency: normalized.currency,
            scope: normalized.scope,
            quantity: normalized.quantity,
            complete: normalized.complete,
            source_text: normalized.source_text,
        } : null,
        currency: normalized?.currency || null,
        quantity: normalized?.quantity || null,
        evidence_refs: (budget.evidence || []).map(item => ({ input_path: item.input_path, quote: item.quote })),
        evidence_status: (budget.evidence || []).length ? 'traceable_customer_input' : 'missing',
        quote_dependency: quoteStatus.status,
        feasibility,
        demo_comparison: demoComparison,
        missing_information: unique(missing),
        note: '预算判断只使用客户明确输入和可核验报价；未推断预算、支付能力或优惠资格。',
    };
}

function buildBaseSolution({ profile, facts = [], request = {}, status = 'draft' }) {
    const needs = field(profile, 'needs');
    const painPoints = field(profile, 'pain_points');
    const preferences = field(profile, 'preferences');
    const stage = field(profile, 'purchase_stage');
    const decision = field(profile, 'decision_chain');
    const scenario = request.scenario || PENDING;
    const audience = request.audience || PENDING;
    const product = request.product || PENDING;
    const factBasis = factRefs(facts);
    const refs = evidenceRefs(profile, ['identity', 'industry', 'needs', 'preferences', 'pain_points', 'purchase_stage', 'decision_chain']);
    const confirmedNeeds = listValue(needs.value);
    const confirmedPainPoints = listValue(painPoints.value);
    const confirmedPreferences = listValue(preferences.value);
    const solutionStatus = status === 'ready' && confirmedNeeds.length ? 'actionable' : 'needs_clarification';
    return {
        schema_version: '1.0',
        status: solutionStatus,
        label: solutionStatus === 'actionable' ? '可进入客户确认与方案验证' : '缺少关键需求，先澄清',
        title: `${product}｜${scenario}基础方案`,
        audience,
        goal: `围绕“${scenario}”完成需求对齐、证据核验、可执行验证和客户决策准备；不以规格或合成价格替代实测与正式报价。`,
        customer_context: customerContext(profile),
        scope: {
            confirmed_needs: confirmedNeeds,
            confirmed_pain_points: confirmedPainPoints,
            confirmed_preferences: confirmedPreferences,
            purchase_stage: stage.value,
            decision_chain: decision.value,
            unresolved: solutionStatus === 'actionable' ? [] : ['具体任务、可用软件版本、验收标准与环境权限'],
        },
        approach: [
            {
                id: 'scope_alignment', priority: 1, owner_role: '销售负责人', timing: '客户确认继续沟通后即时',
                action: `将“${scenario}”拆成一个客户可确认的具体任务，记录软件名称/版本、文件格式、设备、网络和权限。`,
                output: '任务与环境确认单', completion_criteria: '客户确认任务、环境和验收标准；未知项继续标待确认。',
                evidence_refs: refs,
            },
            {
                id: 'evidence_fit', priority: 2, owner_role: '方案工程师', timing: '任务确认后 1 个工作日内',
                action: '仅使用有出处的产品资料、华为公开资料和适配记录核对方案；缺少兼容资料或完整销售配置时明确留空。',
                output: '资料依据与待确认清单', completion_criteria: '每项关键结论都能找到资料出处、原文位置，或明确列出待确认信息。',
                evidence_refs: [...refs, ...factBasis.map(item => ({ fact_id: item.id }))],
            },
            {
                id: 'controlled_validation', priority: 3, owner_role: '方案工程师与客户验收人', timing: '客户同意并确认可用时段后',
                action: '使用客户授权的脱敏样例验证打开、编辑、保存、导出等实际任务，并记录失败步骤和真实耗时。',
                output: '验证记录与客户验收结果', completion_criteria: '只记录实际完成项；失败或未执行项保留原状，不宣称兼容或半小时交付。',
                evidence_refs: factBasis.map(item => ({ fact_id: item.id })),
            },
            {
                id: 'decision_and_quote', priority: 4, owner_role: '销售负责人与报价审核负责人', timing: '验证结论形成且报价依据齐全后',
                action: '汇总客户确认项、待确认项与下一步决策；没有获授权价格依据时保持正式报价 null。',
                output: '决策摘要、报价状态与人工推进计划', completion_criteria: '负责人、触发条件和时间节点明确；价格要么有完整依据，要么为 null。',
                evidence_refs: refs,
            },
        ],
        deliverables: [
            { id: 'requirements_map', label: '客户需求与证据映射', status: solutionStatus === 'actionable' ? 'ready_for_confirmation' : 'pending' },
            { id: 'evidence_gap_register', label: '产品资料、兼容性与销售配置待确认清单', status: 'pending_confirmation' },
            { id: 'validation_record', label: '按客户任务执行的验证记录', status: 'not_executed' },
            { id: 'quote_status', label: '正式报价状态（缺依据时必须为 null）', status: 'pending_confirmation' },
            { id: 'action_plan', label: '负责人、触发条件与时间节点', status: 'pending_assignment' },
        ],
        evidence_basis: {
            profile_evidence_refs: refs,
            fact_ids: factBasis.map(item => item.id),
            facts: factBasis,
        },
        assumptions: [
            '当前是方案准备结构，不代表客户已经确认需求、预算、兼容性或采购条件。',
            '报价金额不在方案中推算；任何演示金额都必须与正式交易报价分栏展示。',
        ],
        exclusions: [
            '不承诺未核验的软件兼容性、性能结果、库存或交付时限。',
            '不使用历史价、相似配置价或合成演算替代正式报价。',
            '不在客户授权前自动联系或对外发送方案。',
        ],
    };
}

function classifyAction(action, index) {
    const text = String(action || '');
    if (/报价|价格规则|价格依据/.test(text)) return { id: 'quote_review', owner_role: '报价审核负责人', timing: '销售配置、数量、地区和有效价格规则齐备后 2 个工作日内', order: 6 };
    if (/采购发起人|审批人|最终决策人|决策角色/.test(text)) return { id: 'decision_chain_confirmation', owner_role: '客户经理', timing: '客户进入方案评估或采购流程后 1 个工作日内', order: 5 };
    if (/预算尚未|预算口径|单台\/总额|预算金额/.test(text)) return { id: 'budget_confirmation', owner_role: '客户经理', timing: '客户愿意讨论采购条件后 1 个工作日内', order: 4 };
    if (/核对.*原文|适配记录|软件兼容|兼容性/.test(text)) return { id: 'evidence_verification', owner_role: '方案工程师', timing: '需求与软件版本确认后 1 个工作日内', order: 2 };
    if (/可联系渠道|联系同意|授权联系/.test(text)) return { id: 'consent_and_follow_up', owner_role: '销售负责人', timing: '客户明确授权联系后 1 个工作日内', order: 7 };
    if (/可计时|试点参与人|验收任务|确认演示条件/.test(text)) return { id: 'customer_validation', owner_role: '方案工程师', timing: '客户确认参与人和可用时段后', order: 3 };
    return { id: 'discovery', owner_role: '销售负责人', timing: '客户确认继续沟通后 1 个工作日内', order: 1 };
}

function enrichActions(actions, { profile, facts = [] } = {}) {
    const refs = evidenceRefs(profile, ['needs', 'pain_points', 'preferences', 'purchase_stage', 'decision_chain', 'budget', 'channels']);
    const enriched = (Array.isArray(actions) ? actions : []).map((action, index) => {
        const meta = classifyAction(action.action, index);
        const dependencies = Array.isArray(action.pending_dependencies) ? action.pending_dependencies : [];
        return {
            id: meta.id,
            priority: meta.order,
            status: 'pending',
            action: action.action,
            owner: action.owner || `${meta.owner_role}（待指定）`,
            owner_role: meta.owner_role,
            owner_assignment_status: /待指定/.test(action.owner || '') ? 'pending_assignment' : 'assigned',
            trigger: action.trigger || '客户确认继续推进后',
            time_node: meta.timing,
            timing: { type: 'relative', window: meta.timing, proposed: true, confirmed: false },
            completion_criteria: dependencies.length ? `完成并记录：${dependencies.join('、')}` : '完成动作并记录客户确认结果与下一触发条件。',
            evidence_refs: refs,
            pending_dependencies: dependencies,
        };
    }).sort((left, right) => left.priority - right.priority || left.action.localeCompare(right.action));
    const seen = new Map();
    for (const action of enriched) {
        const count = (seen.get(action.id) || 0) + 1;
        seen.set(action.id, count);
        if (count > 1) action.id = `${action.id}_${count}`;
    }
    return enriched;
}
function buildDealPlan({ profile, facts = [], request = {}, marketingStatus = 'blocked', pricing, nextActions = [] }) {
    const quoteStatus = buildQuoteStatus(pricing);
    const budgetAssessment = buildBudgetAssessment(profile, pricing, quoteStatus);
    const baseSolution = buildBaseSolution({ profile, facts, request, status: marketingStatus });
    const actions = enrichActions(nextActions, { profile, facts });
    return {
        base_solution: baseSolution,
        budget_assessment: budgetAssessment,
        quote_status: quoteStatus,
        next_actions: actions,
        action_plan: {
            schema_version: '1.0',
            status: actions.length ? 'ready_for_owner_assignment' : 'missing',
            owner_assignment_required: actions.some(action => action.owner_assignment_status === 'pending_assignment'),
            conversion_effect: 'not_measured',
            actions_count: actions.length,
            note: '以下为待执行动作，不是已完成结果；实际联系和对外发送须获得客户授权。',
        },
    };
}

module.exports = {
    buildDealPlan,
    buildBaseSolution,
    buildBudgetAssessment,
    buildQuoteStatus,
    enrichActions,
};