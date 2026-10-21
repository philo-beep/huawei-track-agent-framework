'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PipelineError, validateSchema } = require('./support');
const { generateJson } = require('./model');
const { imaKnowledge } = require('./ima');
const {
    sha256, termTerms, productTypeMatches, readIndex, buildLocalCatalog,
    recallLocalCandidates, localEvidence, profileEvidence,
    imaCandidateFromResult, mergeCandidates,
} = require('./product-catalog');
const {
    verifyModelReasons, deterministicReasons, candidateLimitations, candidateMissingInformation,
} = require('./product-match-verification');

const CONTRACT_DIR = path.join(__dirname, 'contracts');
const INPUT_SCHEMA = JSON.parse(fs.readFileSync(path.join(CONTRACT_DIR, 'product-match-input.schema.json'), 'utf8'));
const OUTPUT_SCHEMA = JSON.parse(fs.readFileSync(path.join(CONTRACT_DIR, 'product-match-output.schema.json'), 'utf8'));
const PROMPT_PATH = path.join(__dirname, 'prompts', 'product-match.md');

const KNOWN_NEEDS = ['移动办公', '长续航', '软件兼容性', '专业设计', '大屏', '触控', '便携', '安静', '低噪', '办公', '打印', '扫描', '显示器', '鼠标', '键盘'];

function uniqStrings(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))].slice(0, 20);
}

function criterionId(kind, value) {
    return `criterion-${sha256(`${kind}|${typeof value === 'string' ? value : JSON.stringify(value)}`).slice(0, 12)}`;
}

function inferProductType(profile) {
    if (profile.product_type) return profile.product_type;
    const text = `${profile.raw_request || ''} ${profile.scenario || ''} ${(profile.needs || []).join(' ')}`;
    if (/打印机|粉盒|硒鼓|喷墨|激光打印/.test(text)) return '打印机';
    if (/显示器|MateView/i.test(text)) return '显示器';
    if (/鼠标|键盘|扩展坞|充电器/.test(text)) return '配件';
    if (/台式机|擎云\s*W|主机/.test(text)) return '台式机';
    if (/电脑|笔记本|MateBook|擎云|移动办公|备课|办公设备/.test(text)) return '电脑';
    return null;
}

function inferNeeds(profile) {
    const needs = uniqStrings(profile.needs);
    const text = `${profile.raw_request || ''} ${profile.scenario || ''}`;
    for (const term of KNOWN_NEEDS) if (text.includes(term) && !needs.includes(term)) needs.push(term);
    return needs.slice(0, 20);
}

function parseBudgetHint(profile) {
    if (profile.budget && typeof profile.budget === 'object') return profile.budget;
    const raw = String(profile.raw_request || '');
    const match = raw.match(/(?:总预算|单台预算|预算|不超过|控制在)\s*(?:为|是|约|[:：])?\s*(\d+(?:\.\d+)?)\s*(万|千)?\s*(元|人民币|CNY)?/i);
    if (!match) return null;
    const amount = Number(match[1]) * (match[2] === '万' ? 10000 : match[2] === '千' ? 1000 : 1);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e12) return null;
    const quantityMatch = raw.match(/(?:采购|购买|购|买)\s*(\d+)\s*(?:台|套|个|件)/);
    return {
        min: amount, max: amount, currency: /美元|USD/i.test(match[0]) ? null : 'CNY',
        scope: /总预算/.test(match[0]) ? '总额' : /单台/.test(match[0]) ? '单台' : null,
        quantity: quantityMatch ? Number(quantityMatch[1]) : null,
    };
}

function buildCriteria(profile) {
    const productType = inferProductType(profile);
    const needs = inferNeeds(profile);
    const preferences = uniqStrings(profile.preferences);
    const painPoints = uniqStrings(profile.pain_points);
    const excluded = uniqStrings(profile.excluded_requirements);
    const scenario = typeof profile.scenario === 'string' ? profile.scenario.trim() : '';
    const budget = parseBudgetHint(profile);
    const criteria = [];
    if (productType) criteria.push({ criterion_id: criterionId('product_type', productType), kind: 'product_type', value: productType, status: 'explicit' });
    if (scenario) criteria.push({ criterion_id: criterionId('scenario', scenario), kind: 'scenario', value: scenario, status: 'explicit' });
    for (const value of needs) criteria.push({ criterion_id: criterionId('need', value), kind: 'need', value, status: 'explicit' });
    for (const value of preferences) criteria.push({ criterion_id: criterionId('preference', value), kind: 'preference', value, status: 'explicit' });
    for (const value of painPoints) criteria.push({ criterion_id: criterionId('pain_point', value), kind: 'pain_point', value, status: 'explicit' });
    for (const value of excluded) criteria.push({ criterion_id: criterionId('excluded', value), kind: 'excluded', value, status: 'explicit' });
    if (budget) {
        const complete = [budget.min, budget.max].every(value => typeof value === 'number' && Number.isFinite(value)) && Boolean(budget.currency) && Boolean(budget.scope);
        criteria.push({ criterion_id: criterionId('budget', budget), kind: 'budget', value: budget, status: complete ? 'explicit' : 'pending' });
    }
    return criteria;
}

function validateProductMatchInput(input) {
    validateSchema(input, INPUT_SCHEMA);
    for (const name of ['needs', 'preferences', 'pain_points', 'excluded_requirements']) {
        input.profile[name] = uniqStrings(input.profile[name]);
    }
    const budget = input.profile.budget;
    if (budget && typeof budget === 'object') {
        if (budget.min !== null && budget.max !== null && budget.min > budget.max) throw new PipelineError('INVALID_INPUT', '预算区间倒置，请先确认');
        if (budget.scope === '总额' && budget.quantity && budget.max !== null && budget.max / budget.quantity < 1) throw new PipelineError('INVALID_INPUT', '总额预算与数量组合异常，请先确认');
    }
    return input;
}

function matchQuery(profile, criteria) {
    const productType = criteria.find(item => item.kind === 'product_type')?.value || profile.product_type || '';
    if (/电脑|笔记本/.test(productType)) return 'MateBook 14';
    if (/打印机/.test(productType)) return '华为 打印机';
    if (/显示器/.test(productType)) return '华为 显示器';
    if (/配件/.test(productType)) return '华为 鼠标 键盘';
    const primary = criteria.find(item => ['scenario', 'need', 'preference'].includes(item.kind) && typeof item.value === 'string')?.value;
    return String(primary || profile.raw_request || '华为 产品').slice(0, 80);
}

function dedupeEvidence(values) {
    return [...new Map((values || []).filter(Boolean).map(item => [item.evidence_id, item])).values()].slice(0, 30);
}

function prepareCandidate(candidate, criteria, profilesEvidence, indexBuiltAt) {
    const evidence = dedupeEvidence([
        ...localEvidence(candidate, criteria, indexBuiltAt),
        ...(candidate.ima_evidence || []),
        ...profilesEvidence,
    ]);
    const base = { ...candidate, evidence };
    base.matching_reasons = deterministicReasons(base, criteria, profilesEvidence);
    base.limitations = candidateLimitations(base);
    base.missing_information = candidateMissingInformation(base, criteria);
    return base;
}

function criterionEvidence(candidate, criterion) {
    if (typeof criterion.value !== 'string') return null;
    return (candidate.evidence || []).find(item => ['E1', 'E2'].includes(item.source_level) && termTerms(criterion.value).some(term => item.excerpt.toLowerCase().includes(term))) || null;
}

function scoreCandidate(candidate, criteria) {
    let score = Math.min(40, Number(candidate.recall_score || 0) * 4);
    score += Math.min(30, (candidate.matching_reasons || []).length * 10);
    score += Math.min(20, (candidate.evidence || []).filter(item => item.source_level === 'E1').length * 5);
    const productType = criteria.find(item => item.kind === 'product_type');
    if (productType && productTypeMatches(candidate, productType.value)) score += 10;
    return Math.max(0, Math.min(100, Math.round(score)));
}

function finalStatus(candidate, criteria) {
    const budget = criteria.find(item => item.kind === 'budget');
    const compatibility = criteria.find(item => typeof item.value === 'string' && /兼容|软件|插件|系统版本/.test(item.value));
    const hasE1Reason = (candidate.matching_reasons || []).some(reason => reason.evidence_ids.some(id => (candidate.evidence || []).some(item => item.evidence_id === id && item.source_level === 'E1')));
    const categoryConflict = criteria.some(item => item.kind === 'product_type' && !productTypeMatches(candidate, item.value));
    if (categoryConflict) return 'not_recommended';
    if (!hasE1Reason) return 'pending_confirmation';
    if (budget) return 'pending_confirmation';
    if (compatibility) return 'pending_confirmation';
    const unresolvedConflict = criteria.some(item => typeof item.value === 'string' && /冲突|无法统一|两个型号/.test(item.value));
    if (unresolvedConflict) return 'pending_confirmation';
    return 'recommended';
}

function statusLabel(status) {
    return status === 'recommended' ? '推荐候选' : status === 'not_recommended' ? '不推荐' : '【待确认】';
}

function modelEvidenceCard(candidate) {
    return {
        candidate_id: candidate.candidate_id,
        product_name: candidate.product_name,
        category: candidate.category,
        evidence: (candidate.evidence || []).slice(0, 10).map(item => ({
            evidence_id: item.evidence_id,
            source_type: item.source_type,
            source_level: item.source_level,
            excerpt: item.excerpt.slice(0, 600),
        })),
    };
}

async function requestModelReasons(criteria, candidates, runner) {
    const system = fs.readFileSync(PROMPT_PATH, 'utf8');
    const prompt = JSON.stringify({
        task: '仅依据证据ID为每个候选选择或组织最多3条克制、可核验的匹配理由。没有足够证据时返回空数组。',
        criteria,
        candidates: candidates.slice(0, 5).map(modelEvidenceCard),
    });
    const generated = await runner(system, prompt, 1800);
    const decisions = Array.isArray(generated?.value?.decisions) ? generated.value.decisions : null;
    if (!decisions) throw new PipelineError('MODEL_OUTPUT_INVALID', '产品匹配模型未返回decisions数组');
    return { decisions, model: generated.model || null, provider: generated.provider || null };
}

function applyModelReasons(candidates, decisions) {
    const byId = new Map(candidates.map(candidate => [candidate.candidate_id, candidate]));
    let dropped = 0;
    for (const decision of decisions) {
        const candidate = byId.get(decision?.candidate_id);
        if (!candidate || !Array.isArray(decision.reasons)) continue;
        const verified = verifyModelReasons(candidate, decision.reasons);
        dropped += verified.dropped;
        if (verified.reasons.length) candidate.matching_reasons = verified.reasons;
    }
    return dropped;
}

function blankResult(input, requestId, requestedMode, diagnostics = []) {
    return {
        schema_version: '1.0', status: 'needs_clarification', request_id: requestId,
        criteria: [], candidates: [], excluded_candidates: [],
        questions: ['请补充至少一项产品类型、使用场景或明确需求，再开始产品匹配。'],
        provenance: {
            requested_mode: requestedMode, effective_mode: 'none', index_built_at: null, index_sha256: null,
            ima_request_ids: [], knowledge_base: null,
            model: { requested: Boolean(input?.use_cloud_model), status: 'not_requested', name: null, fallback_reason: null },
        },
        verification: { candidate_count: 0, recommended_count: 0, pending_count: 0, excluded_count: 0, evidence_count: 0, unsupported_claims_dropped: 0 },
        diagnostics,
    };
}

async function runProductMatch(rawInput, options = {}) {
    const input = validateProductMatchInput(rawInput);
    const requestId = crypto.randomUUID();
    const requestedMode = input.mode;
    const criteria = buildCriteria(input.profile);
    const matchable = criteria.filter(item => ['need', 'preference', 'pain_point', 'scenario', 'product_type', 'budget'].includes(item.kind));
    if (!matchable.some(item => item.kind !== 'budget')) return blankResult(input, requestId, requestedMode, [{ code: 'MATCH_CRITERIA_MISSING', message: '客户画像缺少可用于选品的产品类型、场景或需求；未猜测推荐', retryable: false }]);

    const diagnostics = [];
    const loaded = options.indexData ? { data: options.indexData, raw: JSON.stringify(options.indexData) } : readIndex();
    const localCatalog = buildLocalCatalog(loaded.data);
    const localRecalled = requestedMode === 'ima' ? [] : recallLocalCandidates(localCatalog, criteria, 10);

    let ima = null;
    let effectiveMode = requestedMode === 'ima' ? 'none' : 'local';
    if (requestedMode === 'ima' || requestedMode === 'hybrid') {
        try {
            const imaRunner = options.imaRunner || imaKnowledge;
            ima = await imaRunner(matchQuery(input.profile, criteria), { limit: 12 });
            if (ima?.status === 'connected' || ima?.status === 'no_knowledge_base') {
                effectiveMode = requestedMode === 'ima' ? 'ima' : 'hybrid';
                diagnostics.push({ code: ima.results?.length ? 'MATCH_IMA_SEARCH_COMPLETED' : 'MATCH_IMA_SEARCH_NO_MATCH', message: JSON.stringify({ knowledge_base: ima.knowledge_base || null, request_ids: ima.request_ids || [], result_count: ima.results?.length || 0 }), retryable: false });
            }
        } catch (error) {
            diagnostics.push({ code: error?.code || 'MATCH_IMA_FAILED', message: error?.message || 'IMA 检索失败，已按请求模式降级', retryable: Boolean(error?.retryable) });
            effectiveMode = requestedMode === 'hybrid' ? 'local' : 'none';
        }
    }

    const imaCandidates = (ima?.results || []).map(item => imaCandidateFromResult(item, localCatalog, requestedMode !== 'ima')).filter(Boolean);
    let candidates = requestedMode === 'ima' ? imaCandidates : requestedMode === 'hybrid' ? mergeCandidates(localRecalled, imaCandidates) : mergeCandidates(localRecalled, []);
    candidates = candidates.slice(0, 8);
    const profilesEvidence = profileEvidence(criteria);
    let prepared = candidates.map(candidate => prepareCandidate(candidate, criteria, profilesEvidence, loaded.data.built_at));

    const model = { requested: Boolean(input.use_cloud_model), status: input.use_cloud_model ? 'configured_not_called' : 'not_requested', name: null, fallback_reason: null };
    let unsupportedClaimsDropped = 0;
    if (input.use_cloud_model && prepared.length) {
        try {
            const response = await requestModelReasons(criteria, prepared, options.modelRunner || generateJson);
            unsupportedClaimsDropped = applyModelReasons(prepared, response.decisions);
            model.status = 'called';
            model.name = response.model;
            diagnostics.push({ code: 'MATCH_MODEL_REASONS_VERIFIED', message: `模型候选理由经证据ID和数值一致性核验；丢弃无依据理由 ${unsupportedClaimsDropped} 条`, retryable: false });
        } catch (error) {
            model.status = 'failed_fallback';
            model.fallback_reason = error?.message || '云端模型调用或输出校验失败';
            diagnostics.push({ code: error?.code || 'MATCH_MODEL_FAILED', message: '云端匹配理由未通过调用或结构校验，已回退规则理由；未伪造模型调用成功', retryable: Boolean(error?.retryable) });
        }
    }

    prepared = prepared.map(candidate => {
        const status = finalStatus(candidate, criteria);
        const output = {
            candidate_id: candidate.candidate_id,
            product_name: candidate.product_name,
            product_family: candidate.product_family,
            category: candidate.category,
            status,
            status_label: statusLabel(status),
            match_score: scoreCandidate(candidate, criteria),
            matching_reasons: candidate.matching_reasons.slice(0, 4),
            limitations: candidate.limitations,
            missing_information: candidate.missing_information,
            evidence: candidate.evidence,
            source_mode: candidate.source_mode || (candidate.ima_evidence?.length ? 'ima' : 'local'),
        };
        return output;
    }).sort((first, second) => {
        const rank = { recommended: 0, pending_confirmation: 1, not_recommended: 2 };
        return rank[first.status] - rank[second.status] || second.match_score - first.match_score || first.product_name.localeCompare(second.product_name, 'zh-CN');
    });

    const recommendedCount = prepared.filter(item => item.status === 'recommended').length;
    const pendingCount = prepared.filter(item => item.status === 'pending_confirmation').length;
    const excludedCandidates = [];
    if (!prepared.length) diagnostics.push({ code: 'MATCH_NO_CANDIDATE', message: '当前来源中没有满足召回条件的候选；未使用模型常识补造产品', retryable: false });
    if (prepared.length && !recommendedCount) diagnostics.push({ code: 'MATCH_PENDING_REVIEW', message: '候选已返回，但证据、价格或兼容性尚未闭环，因此全部标记【待确认】', retryable: false });

    const result = {
        schema_version: '1.0',
        status: recommendedCount ? 'ready' : 'partial',
        request_id: requestId,
        criteria,
        candidates: prepared,
        excluded_candidates: excludedCandidates,
        questions: prepared.length ? [] : ['请补充产品类型、使用场景或明确需求；若已有 IMA 产品名称，请一并提供。'],
        provenance: {
            requested_mode: requestedMode,
            effective_mode: effectiveMode,
            index_built_at: loaded.data.built_at || null,
            index_sha256: sha256(loaded.raw),
            ima_request_ids: ima?.request_ids || [],
            knowledge_base: ima?.knowledge_base ? { knowledge_base_id: ima.knowledge_base.kb_id || null, knowledge_base_name: ima.knowledge_base.kb_name || null } : null,
            model,
        },
        verification: {
            candidate_count: prepared.length,
            recommended_count: recommendedCount,
            pending_count: pendingCount,
            excluded_count: excludedCandidates.length,
            evidence_count: prepared.reduce((total, candidate) => total + candidate.evidence.length, 0),
            unsupported_claims_dropped: unsupportedClaimsDropped,
        },
        diagnostics,
    };
    validateSchema(result, OUTPUT_SCHEMA);
    return result;
}

function renderProductMatchMarkdown(result) {
    const cell = value => String(value === null || value === undefined ? '待确认' : typeof value === 'object' ? JSON.stringify(value) : value).replace(/\|/g, '／').replace(/\r?\n/g, ' ');
    const lines = [
        '# 客户画像产品匹配结果',
        `状态：${cell(result.status)}；请求模式：${cell(result.provenance.requested_mode)}；实际模式：${cell(result.provenance.effective_mode)}。`,
        '> 本结果是选品准备稿。推荐分数只用于排序，不是匹配概率、成交概率或销售效果证明。',
        '',
        '## 匹配条件',
        '| 条件 | 内容 | 状态 |',
        '| --- | --- | --- |',
        ...result.criteria.map(item => `| ${cell(item.kind)} | ${cell(item.value)} | ${cell(item.status)} |`),
        '',
        '## 推荐候选',
    ];
    for (const candidate of result.candidates) {
        lines.push(`### ${candidate.status_label}｜${candidate.product_name}`, `系列：${candidate.product_family}；类别：${candidate.category}；排序分：${candidate.match_score}；来源：${candidate.source_mode}`, '', '**匹配理由**');
        if (!candidate.matching_reasons.length) lines.push('- 当前没有通过证据核验的匹配理由，状态保持【待确认】。');
        for (const reason of candidate.matching_reasons) lines.push(`- ${reason.text}（证据：${reason.evidence_ids.join('、')}；来源：${reason.origin}）`);
        lines.push('', '**限制**', ...candidate.limitations.map(item => `- ${item}`), '', '**缺失信息**');
        if (!candidate.missing_information.length) lines.push('- 暂无已识别的阻塞缺失项；仍不等于完成真实报价或兼容性确认。');
        else lines.push(...candidate.missing_information.map(item => `- ${item}`));
        lines.push('', '**证据**');
        for (const evidence of candidate.evidence) {
            lines.push(`- ${evidence.evidence_id}｜${evidence.source_level}｜${evidence.title}｜${evidence.locator}${evidence.url ? `｜${evidence.url}` : ''}`, `  - ${evidence.excerpt.replace(/\s+/g, ' ').slice(0, 500)}`);
        }
        lines.push('');
    }
    if (!result.candidates.length) lines.push('未取得候选，未使用模型常识补造。');
    lines.push('## 待确认与诊断', ...result.questions.map(item => `- ${item}`), ...result.diagnostics.map(item => `- ${item.code}：${item.message}`));
    return `${lines.join('\n')}\n`;
}

function productMatchExamples() {
    return [
        {
            id: 'match-office-mobility', label: '合成示例：企业移动办公选品', synthetic: true,
            input: {
                schema_version: '1.0', mode: 'hybrid', use_cloud_model: true,
                profile: {
                    raw_request: '合成样例：30人制造企业，采购负责人计划为仓库和办公室选办公笔记本，预算暂不确定。',
                    audience: '制造企业采购负责人', scenario: '仓库与办公室轮用，需要移动办公', industry: '制造业', company_size: 30,
                    product_type: '电脑', needs: ['移动办公', '办公'], preferences: ['长续航', '便携'], pain_points: ['软件兼容性待确认'], excluded_requirements: [], budget: null,
                },
            },
        },
        {
            id: 'match-printers', label: '合成示例：门店打印设备选品', synthetic: true,
            input: {
                schema_version: '1.0', mode: 'local', use_cloud_model: false,
                profile: {
                    raw_request: '合成样例：门店需要打印订单和扫描资料，希望先比较打印机候选，耗材成本待确认。',
                    audience: '门店负责人', scenario: '打印订单与扫描资料', industry: '零售', company_size: 8,
                    product_type: '打印机', needs: ['打印', '扫描'], preferences: [], pain_points: ['耗材成本待确认'], excluded_requirements: [], budget: null,
                },
            },
        },
    ];
}

module.exports = {
    runProductMatch,
    validateProductMatchInput,
    renderProductMatchMarkdown,
    productMatchExamples,
    buildCriteria,
};
