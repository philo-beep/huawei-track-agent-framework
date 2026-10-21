'use strict';

const { criterionMatches } = require('./product-catalog');

const FORBIDDEN = /保证成交|保证转化|全网最低|最强第一|官方已确认|华为正式政策|绝对兼容|完全兼容|100%|必然成功/;
const PRICE_TERMS = /价格|报价|金额|售价|到手价|优惠|折扣|元|预算/;
const COMPATIBILITY_TERMS = /兼容|软件|插件|系统版本|驱动|应用/;

function evidenceMap(candidate) {
    return new Map((candidate.evidence || []).map(evidence => [evidence.evidence_id, evidence]));
}

function numericTokens(text) {
    return String(text || '').match(/\d+(?:\.\d+)?/g) || [];
}

function verifyModelReason(candidate, reason, evidenceById) {
    if (!reason || typeof reason.text !== 'string' || !Array.isArray(reason.evidence_ids) || typeof reason.cited_span !== 'string') return { ok: false, code: 'STRUCTURE' };
    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
    const text = normalize(reason.text).slice(0, 600);
    const citedSpan = normalize(reason.cited_span).slice(0, 500);
    if (!text || citedSpan.length < 4 || reason.evidence_ids.length < 1 || reason.evidence_ids.length > 8) return { ok: false, code: 'STRUCTURE' };
    if (FORBIDDEN.test(text)) return { ok: false, code: 'COMPLIANCE' };
    const referenced = [...new Set(reason.evidence_ids)].map(id => evidenceById.get(id)).filter(Boolean);
    if (referenced.length !== new Set(reason.evidence_ids).size) return { ok: false, code: 'UNKNOWN_EVIDENCE' };
    const productReferences = referenced.filter(item => item.source_type !== 'customer_input');
    if (!productReferences.length || !productReferences.some(item => normalize(item.excerpt).includes(citedSpan))) return { ok: false, code: 'UNSUPPORTED_CITATION' };
    const sourceText = referenced.map(item => item.excerpt).join('\n');
    if (numericTokens(text).some(token => !sourceText.includes(token))) return { ok: false, code: 'UNSUPPORTED_NUMBER' };
    if (PRICE_TERMS.test(text) && !referenced.some(item => item.source_type === 'local_price_snapshot')) return { ok: false, code: 'UNSUPPORTED_PRICE' };
    if (COMPATIBILITY_TERMS.test(text) && !COMPATIBILITY_TERMS.test(sourceText)) return { ok: false, code: 'UNSUPPORTED_COMPATIBILITY' };
    if (/https?:\/\//i.test(text) && !referenced.some(item => item.url && text.includes(item.url))) return { ok: false, code: 'UNSUPPORTED_URL' };
    return { ok: true, value: { text, evidence_ids: [...new Set(reason.evidence_ids)], cited_span: citedSpan, origin: 'cloud_model' } };
}

function verifyModelReasons(candidate, reasons) {
    const evidenceById = evidenceMap(candidate);
    const kept = [];
    let dropped = 0;
    for (const reason of Array.isArray(reasons) ? reasons : []) {
        const result = verifyModelReason(candidate, reason, evidenceById);
        if (result.ok) kept.push(result.value); else dropped += 1;
        if (kept.length >= 4) break;
    }
    return { reasons: kept, dropped };
}

function deterministicReasons(candidate, criteria, profileEvidence) {
    const productEvidence = (candidate.evidence || []).filter(item => ['E1', 'E2'].includes(item.source_level));
    const kept = [];
    const used = new Set();
    for (const criterion of criteria) {
        if (!['need', 'preference', 'pain_point', 'scenario', 'product_type'].includes(criterion.kind) || typeof criterion.value !== 'string') continue;
        const profile = profileEvidence.find(item => item.locator === `input.profile.${criterion.kind}` && item.excerpt.includes(criterion.value));
        const matching = productEvidence.find(item => criterionMatches(item.excerpt, criterion.value));
        if (!profile || !matching) continue;
        const key = `${profile.evidence_id}|${matching.evidence_id}`;
        if (used.has(key)) continue;
        used.add(key);
        const label = criterion.kind === 'product_type' ? '产品类型' : criterion.kind === 'scenario' ? '使用场景' : '需求线索';
        kept.push({
            text: `客户${label}明确表达“${criterion.value}”；候选资料存在对应可追溯线索，仍需按具体任务、配置和限制复核。`,
            evidence_ids: [profile.evidence_id, matching.evidence_id], cited_span: matching.excerpt.replace(/\s+/g, ' ').trim().slice(0, 240), origin: 'rules',
        });
        if (kept.length >= 3) break;
    }
    return kept;
}

function candidateLimitations(candidate) {
    const limitations = ['候选系列名或目录名不能替代完整销售SKU；颜色、配置、系统和屏幕版本需另行确认。'];
    if (!(candidate.evidence || []).some(item => item.source_level === 'E1')) limitations.push('当前没有可用于匹配理由的完整产品事实原文，仅有目录或检索线索。');
    if ((candidate.evidence || []).some(item => item.source_type === 'ima_metadata')) limitations.push('IMA 命中当前只保留标题、媒体 ID 或摘要，不能把摘要升级为产品事实。');
    if ((candidate.evidence || []).some(item => item.source_type === 'local_price_snapshot')) limitations.push('公开价格记录保留为历史快照，不能当作当前成交报价。');
    return limitations;
}

function candidateMissingInformation(candidate, criteria) {
    const missing = [];
    const budget = criteria.find(item => item.kind === 'budget');
    if (budget) missing.push('当前可成交价格、精确 SKU、配置、数量和地区未核实，不能确认预算是否满足。');
    const compatibility = criteria.filter(item => typeof item.value === 'string' && /兼容|软件|插件|系统版本/.test(item.value));
    if (compatibility.length && !(candidate.evidence || []).some(item => /兼容|软件|插件|系统版本|驱动/.test(item.excerpt))) missing.push('客户关注软件或系统兼容性，但当前证据未覆盖具体软件版本与兼容清单。');
    if (!(candidate.evidence || []).some(item => item.source_level === 'E1')) missing.push('待补抓完整规格页、支持页或可定位正文。');
    if (!(candidate.evidence || []).some(item => item.source_type === 'local_price_snapshot' || item.source_type === 'ima_metadata')) missing.push('待补充公开价格或官方询价条件。');
    return [...new Set(missing)].slice(0, 8);
}

module.exports = {
    FORBIDDEN,
    evidenceMap,
    verifyModelReason,
    verifyModelReasons,
    deterministicReasons,
    candidateLimitations,
    candidateMissingInformation,
};
