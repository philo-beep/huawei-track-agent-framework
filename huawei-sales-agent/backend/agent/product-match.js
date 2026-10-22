'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { plainText, humanStatus, coverageStatus, criterionLabel, cleanSourceTitle, readableValue } = require('./sales-copy');
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
    for (const term of KNOWN_NEEDS) {
        const covered = needs.some(existing => existing.includes(term) || term.includes(existing));
        if (text.includes(term) && !covered) needs.push(term);
    }
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

function buildImaQueries(profile, criteria) {
    const anchor = matchQuery(profile, criteria);
    const values = criteria
        .filter(item => ['scenario', 'need', 'preference'].includes(item.kind) && typeof item.value === 'string')
        .map(item => item.value.trim())
        .filter(value => value.length >= 2 && value.length <= 24);
    const queries = [anchor];
    if (/MateBook 14/.test(anchor)) queries.push('MateBook Pro', 'MateBook D 14');
    else if (/打印机/.test(anchor)) queries.push('毕昇 打印机', 'PixLab');
    else if (/显示器/.test(anchor)) queries.push('MateView 显示器', '擎云 显示器');
    else if (values[0]) queries.push(`${anchor} ${values[0]}`.slice(0, 60));
    return [...new Set(queries)].slice(0, 3);
}

function usableImaResult(result) {
    const title = String(result?.title || '');
    if (!title.trim()) return false;
    if (/\.(?:jpe?g|png|webp|gif|bmp|svg)(?:$|[?#])/i.test(title)) return false;
    if (/^(?:image|图片|附件)/i.test(title)) return false;
    return true;
}

function mergeImaSearchResults(searches) {
    const results = [];
    const seen = new Set();
    const requestIds = [];
    const knowledgeBase = searches.map(item => item?.knowledge_base).find(Boolean) || null;
    for (const search of searches) {
        for (const requestId of search?.request_ids || []) if (!requestIds.includes(requestId)) requestIds.push(requestId);
        for (const result of (search?.results || []).filter(usableImaResult)) {
            const key = result.media_id || result.source_ref?.entry || result.title;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            results.push(result);
        }
    }
    return {
        status: searches.some(item => item?.status === 'connected') ? 'connected' : searches[0]?.status || 'no_result',
        results: results.slice(0, 24),
        request_ids: requestIds,
        knowledge_base: knowledgeBase,
    };
}

async function imaRecall(queries, runner) {
    const searches = [];
    for (const query of queries) {
        try {
            const result = await runner(query, { limit: 12 });
            searches.push(result);
            if (searches.length === 1 && (result?.results || []).filter(usableImaResult).length >= 8) break;
            if (searches.length >= 2) break;
        } catch (error) {
            searches.push({ status: 'failed', results: [], request_ids: [], error });
            if (!searches.length) throw error;
            break;
        }
    }
    const merged = mergeImaSearchResults(searches);
    if (!merged.results.length && searches.some(item => item?.error)) throw searches.find(item => item?.error).error;
    return merged;
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
    base.criteria_coverage = criteriaCoverage(base, criteria);
    base.missing_information = [...new Set([
        ...candidateMissingInformation(base, criteria),
        ...base.criteria_coverage.filter(item => ['pending', 'partial'].includes(item.status)).map(item => item.note),
    ])].slice(0, 12);
    return base;
}

function criterionEvidence(candidate, criterion) {
    if (typeof criterion.value !== 'string') return null;
    return (candidate.evidence || []).find(item => ['E1', 'E2'].includes(item.source_level) && termTerms(criterion.value).some(term => item.excerpt.toLowerCase().includes(term))) || null;
}

function criteriaCoverage(candidate, criteria) {
    return criteria.map(criterion => {
        const profileEvidenceId = (candidate.evidence || []).find(item => item.source_type === 'customer_input' && item.locator === `input.profile.${criterion.kind}`)?.evidence_id;
        const base = { criterion_id: criterion.criterion_id, kind: criterion.kind, status: 'pending', evidence_ids: profileEvidenceId ? [profileEvidenceId] : [], note: '尚无对应资料' };
        if (criterion.kind === 'product_type') {
            const matched = productTypeMatches(candidate, criterion.value);
            return { ...base, status: matched ? 'supported' : 'mismatch', note: matched ? '候选类别与明确产品类型一致' : '候选类别与明确产品类型不一致' };
        }
        if (criterion.kind === 'budget') {
            const current = (candidate.offers || []).filter(offer => offer.current_transaction_quote === true && Number.isFinite(offer.amount));
            if (!current.length) return { ...base, note: '当前成交价未核实，不能判断预算是否满足' };
            const budget = criterion.value || {};
            const scoped = current.map(offer => {
                if (budget.scope === '总额' && budget.quantity) return offer.amount * budget.quantity;
                return offer.amount;
            });
            const within = scoped.some(amount => (budget.min === null || amount >= budget.min) && (budget.max === null || amount <= budget.max));
            return { ...base, status: within ? 'supported' : 'mismatch', note: within ? '当前有效价格落在预算范围内' : '当前有效价格超出预算范围' };
        }
        if (/兼容|软件|插件|系统版本/.test(String(criterion.value || ''))) {
            return { ...base, note: '缺少已核验的软件版本与系统兼容矩阵' };
        }
        const usable = (candidate.evidence || []).filter(item => ['E1', 'E2', 'E2F'].includes(item.source_level) && termTerms(criterion.value).some(term => item.excerpt.toLowerCase().includes(term)));
        if (criterion.kind === 'excluded') return usable.length ? { ...base, status: 'mismatch', evidence_ids: [...base.evidence_ids, ...usable.map(item => item.evidence_id)].slice(0, 8), note: '现有产品资料中出现客户明确排除的条件，需要人工复核' } : { ...base, note: '现有产品资料中没有发现客户排除条件；但仍不能视为已完全排除' };
        if (!usable.length) return base;
        return {
            ...base,
            status: usable.some(item => item.source_level === 'E1') ? 'supported' : 'partial',
            evidence_ids: [...base.evidence_ids, ...usable.map(item => item.evidence_id)].slice(0, 8),
            note: usable.some(item => item.source_level === 'E1') ? '存在可定位的完整产品资料' : '目前只有产品目录、资料摘要或不完整线索',
        };
    });
}

function coverageSatisfied(coverage) {
    const hardKinds = new Set(['product_type', 'need', 'budget']);
    const hard = coverage.filter(item => hardKinds.has(item.kind) || (item.kind === 'pain_point' && /兼容|软件|插件|系统版本/.test(String(item.note))));
    return !hard.some(item => ['pending', 'partial', 'mismatch'].includes(item.status));
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
    const coverage = criteriaCoverage(candidate, criteria);
    const hasE1Reason = (candidate.matching_reasons || []).some(reason => reason.evidence_ids.some(id => (candidate.evidence || []).some(item => item.evidence_id === id && item.source_level === 'E1')));
    if (coverage.some(item => item.status === 'mismatch')) return 'not_recommended';
    if (!coverageSatisfied(coverage)) return 'pending_confirmation';
    if (!hasE1Reason) return 'pending_confirmation';
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
        evidence: (candidate.evidence || []).slice(0, 6).map(item => ({
            evidence_id: item.evidence_id,
            source_type: item.source_type,
            source_level: item.source_level,
            excerpt: item.excerpt.slice(0, 400),
        })),
    };
}

async function requestModelReasons(criteria, candidates, runner) {
    const system = fs.readFileSync(PROMPT_PATH, 'utf8');
    const prompt = JSON.stringify({
        task: '仅依据证据ID为前3个候选各组织最多2条短理由，每条不超过120字。必须提供逐字cited_span。没有足够证据时返回空数组。',
        criteria,
        candidates: candidates.slice(0, 3).map(modelEvidenceCard),
    });
    const generated = await runner(system, prompt, 900);
    const decisions = Array.isArray(generated?.value?.decisions) ? generated.value.decisions : null;
    if (!decisions) throw new PipelineError('MODEL_OUTPUT_INVALID', '智能分析结果暂时无法读取，请稍后重试');
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
        schema_version: '1.1', status: 'needs_clarification', request_id: requestId,
        criteria: [], candidates: [], excluded_candidates: [],
        questions: ['请补充至少一项产品类型、使用场景或明确需求，再开始产品匹配。'],
        provenance: {
            requested_mode: requestedMode, effective_mode: 'none', index_built_at: null, index_sha256: null,
            registry_version: null, product_fact_count: 0, current_quote_count: 0,
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
    if (!matchable.some(item => item.kind !== 'budget')) return blankResult(input, requestId, requestedMode, [{ code: 'MATCH_CRITERIA_MISSING', message: '客户信息中还缺少产品类型、使用场景或明确需求，系统没有猜测推荐', retryable: false }]);

    const diagnostics = [];
    const loaded = options.indexData ? { data: options.indexData, raw: JSON.stringify(options.indexData), registry: options.registryData || { products: [] }, facts: options.factsData || { facts: [] }, offers: options.offersData || { offers: [] }, compatibility: options.compatibilityData || { records: [] } } : readIndex();
    const localCatalog = buildLocalCatalog(loaded.data, loaded.registry, loaded.offers);
    const localRecalled = requestedMode === 'ima' ? [] : recallLocalCandidates(localCatalog, criteria, 10);

    let ima = null;
    let effectiveMode = requestedMode === 'ima' ? 'none' : 'local';
    if (requestedMode === 'ima' || requestedMode === 'hybrid') {
        try {
            const imaRunner = options.imaRunner || imaKnowledge;
            const imaQueries = buildImaQueries(input.profile, criteria);
            ima = await imaRecall(imaQueries, imaRunner);
            ima.queries = imaQueries;
            if (ima?.status === 'connected' || ima?.status === 'no_knowledge_base') {
                effectiveMode = requestedMode === 'ima' ? 'ima' : 'hybrid';
                diagnostics.push({ code: ima.results?.length ? 'MATCH_IMA_SEARCH_COMPLETED' : 'MATCH_IMA_SEARCH_NO_MATCH', message: `产品资料库查询完成，本次返回 ${ima.results?.length || 0} 条线索`, retryable: false });
            }
        } catch (error) {
            diagnostics.push({ code: error?.code || 'MATCH_IMA_FAILED', message: '产品资料库暂时不可用，已按现有产品目录继续查找', retryable: Boolean(error?.retryable) });
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
            diagnostics.push({ code: 'MATCH_MODEL_REASONS_VERIFIED', message: '推荐理由已逐条核对产品资料，缺少依据的内容已剔除', retryable: false });
        } catch (error) {
            model.status = 'failed_fallback';
            model.fallback_reason = error?.message || '智能分析暂时未能给出可用建议';
            diagnostics.push({ code: error?.code || 'MATCH_MODEL_FAILED', message: '智能分析暂未返回可用理由，已按已核对资料整理推荐说明', retryable: Boolean(error?.retryable) });
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
            operating_system: candidate.operating_system || null,
            generation: candidate.generation || null,
            evidence_status: candidate.evidence_status || null,
            matching_reasons: candidate.matching_reasons.slice(0, 4),
            limitations: candidate.limitations,
            missing_information: candidate.missing_information,
            criteria_coverage: candidate.criteria_coverage || [],
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
    if (!prepared.length) diagnostics.push({ code: 'MATCH_NO_CANDIDATE', message: '当前资料中没有找到符合条件的候选，没有用未核对常识补造产品', retryable: false });
    if (prepared.length && !recommendedCount) diagnostics.push({ code: 'MATCH_PENDING_REVIEW', message: '已找到可能适合的型号，但价格、软件兼容或具体配置仍需确认，暂不标记为可直接推荐', retryable: false });

    const result = {
        schema_version: '1.1',
        status: recommendedCount ? 'ready' : 'partial',
        request_id: requestId,
        criteria,
        candidates: prepared,
        excluded_candidates: excludedCandidates,
        questions: prepared.length ? [] : ['请补充产品类型、使用场景或明确需求；若已有产品名称，请一并提供。'],
        provenance: {
            requested_mode: requestedMode,
            effective_mode: effectiveMode,
            index_built_at: loaded.data.built_at || null,
            index_sha256: sha256(loaded.raw),
            registry_version: loaded.registry?.registry_version || null,
            product_fact_count: Array.isArray(loaded.facts?.facts) ? loaded.facts.facts.length : 0,
            current_quote_count: Array.isArray(loaded.offers?.offers) ? loaded.offers.offers.filter(offer => offer.current_transaction_quote === true).length : 0,
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
    const cell = value => String(readableValue(value)).replace(/\|/g, '／').replace(/\r?\n/g, ' ');
    const levelLabel = { E1: '产品资料原文', E2: '产品目录', E3: '资料摘要', E4: '客户填写信息' };
    const lines = [
        '# 客户选品建议', '',
        '> 本结果是销售准备用的选品建议，不是成交承诺。推荐顺序只表示当前资料下的优先查看顺序，不代表匹配概率或成交概率。', '',
        '## 本次选品条件', '',
        '| 客户关注点 | 内容 |',
        '| --- | --- |',
        ...(result.criteria || []).map(item => `| ${cell(criterionLabel(item.kind))} | ${cell(item.value)} |`),
        '', '## 推荐候选', ''
    ];
    for (const [index, candidate] of (result.candidates || []).entries()) {
        lines.push(`### ${index + 1}. ${plainText(candidate.status_label)}｜${plainText(candidate.product_name)}`, `分类：${plainText(candidate.category)}${candidate.operating_system ? `；系统：${plainText(candidate.operating_system)}` : ''}。`, '', '**匹配理由**');
        if (!candidate.matching_reasons?.length) lines.push('- 当前没有通过资料核对的推荐理由，状态保持【待确认】。');
        else lines.push(...candidate.matching_reasons.map(reason => `- ${plainText(reason.text)}`));
        lines.push('', '**客户需求是否被资料支持**');
        if (!(candidate.criteria_coverage || []).length) lines.push('- 暂时没有可对照的需求条件。');
        else lines.push(...candidate.criteria_coverage.map(item => `- ${criterionLabel(item.kind)}：${coverageStatus(item.status)}；${plainText(item.note)}`));
        lines.push('', '**限制**', ...((candidate.limitations || []).length ? candidate.limitations.map(item => `- ${plainText(item)}`) : ['- 暂无额外限制。']));
        lines.push('', '**还需要向客户确认**', ...((candidate.missing_information || []).length ? candidate.missing_information.map(item => `- ${plainText(item)}`) : ['- 暂无已识别的缺失信息，但仍需人工确认配置与价格。']));
        lines.push('', '**资料依据**');
        const evidence = candidate.evidence || [];
        if (!evidence.length) lines.push('- 暂无可展示的资料依据。');
        for (const item of evidence.slice(0, 5)) {
            lines.push(`- ${cleanSourceTitle(item.title)}（${levelLabel[item.source_level] || '资料'}）`, `  > ${plainText(String(item.excerpt || '').replace(/\s+/g, ' ').slice(0, 320))}`);
            if (item.url) lines.push(`  来源：${item.url}`);
        }
        if (evidence.length > 5) lines.push(`- 另有 ${evidence.length - 5} 条资料依据，可在系统内继续查看。`);
        lines.push('');
    }
    if (!(result.candidates || []).length) lines.push('这次没有找到可展示的候选型号，也没有用未核对的常识补造产品。');
    lines.push('', '## 需要确认的问题');
    const questions = (result.questions || []).map(item => plainText(item?.question || item)).filter(Boolean);
    const diagnostics = (result.diagnostics || []).map(item => plainText(item?.message || item)).filter(Boolean);
    const notes = [...new Set([...questions, ...diagnostics])];
    lines.push(...(notes.length ? notes.map(item => `- ${item}`) : ['- 暂无额外问题；仍须人工确认具体配置、价格和软件兼容性。']));
    return `${lines.join('\n')}\n`;
}

function productMatchExamples() {
    return [
        {
            id: 'match-office-mobility', label: '演示示例：企业移动办公选品', synthetic: true,
            input: {
                schema_version: '1.0', mode: 'hybrid', use_cloud_model: true,
                profile: {
                    raw_request: '示例客户：30人制造企业，采购负责人计划为仓库和办公室选办公笔记本，预算暂不确定。',
                    audience: '制造企业采购负责人', scenario: '仓库与办公室轮用，需要移动办公', industry: '制造业', company_size: 30,
                    product_type: '电脑', needs: ['移动办公', '办公'], preferences: ['长续航', '便携'], pain_points: ['软件兼容性待确认'], excluded_requirements: [], budget: null,
                },
            },
        },
        {
            id: 'match-printers', label: '演示示例：门店打印设备选品', synthetic: true,
            input: {
                schema_version: '1.0', mode: 'local', use_cloud_model: false,
                profile: {
                    raw_request: '示例客户：门店需要打印订单和扫描资料，希望先比较打印机候选，耗材成本待确认。',
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
