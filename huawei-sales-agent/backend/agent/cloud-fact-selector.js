'use strict';

const { PipelineError } = require('./support');

const DIMENSIONS = [
    { key: 'memory', label: '内存', pattern: /内存|\bRAM\b/gi, heading: /^内存\s*\n/ },
    { key: 'screen', label: '屏幕分辨率', pattern: /分辨率|屏幕|显示屏/gi, heading: /^分辨率\s*\n/ },
    { key: 'storage', label: '存储', pattern: /存储|硬盘|固态|\bSSD\b/gi, heading: /^存储\s*\n/ },
    { key: 'processor', label: '处理器', pattern: /处理器|\bCPU\b/gi, heading: /^处理器\s*\n/ },
    { key: 'os', label: '操作系统', pattern: /操作系统|系统版本|\bWindows\b|\bHarmonyOS\b|鸿蒙系统/gi },
    { key: 'compatibility', label: '软件兼容性', pattern: /兼容|软件适配/gi },
    { key: 'battery', label: '续航或电池', pattern: /续航|电池/gi },
    { key: 'weight', label: '重量或便携性', pattern: /重量|轻薄|便携|轻便/gi },
    { key: 'touch', label: '触控', pattern: /触控|触摸/gi },
    { key: 'eye', label: '护眼', pattern: /护眼/gi },
];

function mentions(input) {
    const found = [];
    for (const name of ['raw_request', 'scenario']) {
        const text = input[name] || '';
        for (const clause of text.matchAll(/[^，,。；;！？!?\n]+/g)) {
            for (const dimension of DIMENSIONS) {
                for (const match of clause[0].matchAll(new RegExp(dimension.pattern.source, dimension.pattern.flags))) {
                    const prefix = clause[0].slice(0, match.index);
                    const suffix = clause[0].slice(match.index + match[0].length);
                    const before = prefix.split(/但是|而是|不过|但/).at(-1);
                    const negative = /(?:不关心|不关注|不需要|不考虑|不在意|不想看|不是来问|别介绍|不要|不用|无需|无须|不是问|不是看|别问|不问|不看)[^，,。；;！？!?\n]*$/.test(before) || /^\s*(?:不重要|不关心|不关注|不需要|不考虑|不在意|无所谓)/.test(suffix);
                    const ambiguous = /不是不|并非不|不能不/.test(clause[0]);
                    found.push({ key: dimension.key, label: dimension.label, input_path: `/${name}`, quote: clause[0].trim(), index: clause.index + match.index, negative, ambiguous });
                }
            }
        }
    }
    return found.sort((first, second) => (first.input_path === second.input_path ? first.index - second.index : first.input_path === '/raw_request' ? -1 : 1));
}

function selectCloudFact(input, facts) {
    if (!Array.isArray(facts) || !facts.length || facts.some(fact => !fact || fact.product !== input.product) || new Set(facts.map(fact => fact.id)).size !== facts.length) throw new PipelineError('FACT_VERIFICATION_FAILED', '云端候选事实为空、ID重复或代际不一致，未选择替代事实');
    const evidence = mentions(input);
    const positive = evidence.filter(item => !item.negative);
    const excluded = evidence.filter(item => item.negative);
    const conflicts = evidence.filter(item => item.ambiguous || (!item.negative && excluded.some(other => other.key === item.key)));
    const requested = positive.filter((item, index) => positive.findIndex(other => other.key === item.key) === index);
    const matchFact = item => {
        const dimension = DIMENSIONS.find(entry => entry.key === item.key);
        return dimension.heading ? facts.find(fact => dimension.heading.test(fact.claim)) : undefined;
    };
    const uncovered = requested.filter(item => !matchFact(item));
    const priceRequested = /多少钱|报价|价格|售价|到手价|补贴|优惠|折扣|立减/.test(`${input.raw_request || ''}\n${input.scenario || ''}`);
    const first = requested.find(matchFact);
    const common = { evidence, excluded, uncovered, deferred: requested.filter(item => item !== first && matchFact(item)), price_requested: priceRequested };
    if (conflicts.length) return { ...common, status: 'needs_clarification', fact_ids: [], focus: null, notice: '规格关注点存在否定冲突或复杂否定，请明确本次要核对的一项规格；未选择替代事实。' };
    if (!first && requested.length) return { ...common, status: 'unsupported', fact_ids: [], focus: requested[0], notice: `明确需求未覆盖：${uncovered.map(item => item.label).join('、')}；没有当前可用的对应核验字段，相关内容已阻塞，未使用其他规格替答。` };
    if (!first && priceRequested) return { ...common, status: 'unsupported', fact_ids: [], focus: null, notice: '当前请求涉及价格或政策，缺少真实报价依据，金额为null；未使用其他规格替答。' };
    if (!first) {
        const excludedIds = new Set(excluded.map(matchFact).filter(Boolean).map(fact => fact.id));
        const generalFact = facts.find(fact => !excludedIds.has(fact.id));
        if (!generalFact) return { ...common, status: 'needs_clarification', fact_ids: [], focus: null, notice: '现有规格资料均已被客户明确排除，请补充希望核对的规格；未选择已排除字段。' };
        return { ...common, status: 'general_reference', fact_ids: [generalFact.id], focus: null, notice: '通用资料，非适配推荐：未识别到本轮可明确核对的正向规格偏好；已排除客户明确否定的字段，以下仅供原文参考，不代表符合客户场景。' };
    }
    const notes = ['仅核对客户最先明确的一项规格，原文系列选项不代表客户指定SKU或已满足需求。'];
    if (first.key === 'screen') notes.push('屏幕字段仅覆盖分辨率，其他屏幕特性待核实。');
    if (uncovered.length) notes.push(`未覆盖：${uncovered.map(item => item.label).join('、')}；相关内容没有当前可用的对应核验字段，不作适配承诺。`);
    if (common.deferred.length) notes.push('其余明确规格本轮未核对，请分次确认。');
    if (priceRequested) notes.push('真实价格和政策仍未知，金额为null。');
    return { ...common, status: uncovered.length ? 'partial' : 'matched', fact_ids: [matchFact(first).id], focus: first, notice: notes.join('') };
}

function selectionDiagnostics(selection) {
    const evidence = selection.evidence.map(item => ({ input_path: item.input_path, quote: item.quote, dimension: item.key, excluded: item.negative }));
    return [
        { code: `CLOUD_FACT_${selection.status.toUpperCase()}`, message: selection.notice, retryable: false },
        { code: 'CLOUD_FACT_INPUT_EVIDENCE', message: JSON.stringify({ focus: selection.focus?.key || null, evidence, uncovered: selection.uncovered.map(item => item.key), deferred: selection.deferred.map(item => item.key) }), retryable: false },
    ];
}

module.exports = { selectCloudFact, selectionDiagnostics };
