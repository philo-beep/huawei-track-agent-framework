'use strict';

const { PipelineError } = require('./support');
const { cleanSourceTitle } = require('./sales-copy');

const CHECK_LABELS = Object.freeze({
    product_model: '型号',
    parameters: '参数',
    price: '价格',
    image_identity: '图片身份',
    overreach: '超范围承诺',
    source_completeness: '来源完整性',
});
const STATUS_LABELS = Object.freeze({ pass: '通过', fail: '不通过', downgrade: '降级' });
const OVERALL_LABELS = Object.freeze({ passed: '通过', downgraded: '降级', blocked: '阻塞' });
const RISK_LABELS = Object.freeze({ blocking: '阻塞', downgrade: '降级' });
const OVERREACH = /(?:保证(?:成交|转化|效果|收益|兼容|成功)|确保(?:成交|兼容|成功)|必然(?:成交|成功|兼容)|百分之百|100%\s*(?:兼容|安全|有效|成功|满意)|零风险|永久有效|全网最低|最强|最好|第一|顶级|唯一|必买|绝对兼容|完全兼容|官方已确认|华为正式政策|吊打|碾压)/;
const PRICE_AMOUNT = /(?:¥|￥|\bCNY\b|\bRMB\b|(?:人民币|价格?)?\s*\d[\d,]*(?:\.\d+)?\s*(?:元|万元))/i;
const PRICE_CLAIM = /(?:售价|到手价|成交价|优惠价|折扣价|促销价|价格为|报价为|立减|补贴后)/;

function statusLabel(status) {
    return STATUS_LABELS[status] || status;
}

function normalizeModel(value) {
    return String(value || '').toLowerCase()
        .replace(/huawei|华为/g, '')
        .replace(/harmonyos|鸿蒙版/g, '')
        .replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

function exactModelMatch(value, expected) {
    const current = normalizeModel(value);
    const target = normalizeModel(expected);
    return Boolean(current && target && current === target);
}

function modelAppearsInEvidence(value, expected) {
    const current = normalizeModel(value);
    const target = normalizeModel(expected);
    if (!current || !target) return false;
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${escaped}(?!\\d)`).test(current);
}

function validHttpUrl(value) {
    try {
        const parsed = new URL(String(value || ''));
        return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
    } catch {
        return false;
    }
}

function textSegments(value) {
    return String(value || '').split(/[。！？!?；;\n]+/).map(item => item.trim()).filter(Boolean);
}

function sensitiveSegments(value, pattern) {
    return textSegments(value).filter(segment => pattern.test(segment));
}

function hasSensitiveText(value, pattern) {
    return sensitiveSegments(value, pattern).length > 0;
}

function stripImageCallouts(markdown) {
    return String(markdown || '').split(/\n{2,}/)
        .filter(chunk => !/^\s*<!--\s*IMAGE:[^>]+-->/i.test(chunk))
        .join('\n\n')
        .trim();
}

function stripUnsafeChunks(markdown, shouldRemove) {
    return String(markdown || '').split(/\n{2,}/)
        .filter(chunk => !shouldRemove(chunk))
        .join('\n\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function factSourceProblems(fact) {
    const sources = Array.isArray(fact?.source_refs) ? fact.source_refs : [];
    if (!sources.length) return ['资料依据缺少来源'];
    const problems = [];
    for (const source of sources) {
        if (!String(source?.excerpt || '').includes(String(fact?.claim || ''))) problems.push('产品信息无法在资料原文中定位');
        if ((fact?.conditions || []).some(condition => !String(source?.excerpt || '').includes(condition))) problems.push('使用限制无法在资料原文中定位');
    }
    return [...new Set(problems)];
}

function citationSourceProblems(citation) {
    const problems = [];
    if (!String(citation?.source_title || '').trim()) problems.push('缺少资料来源名称');
    if (!String(citation?.source_entry || '').trim()) problems.push('缺少资料页面位置');
    if (!/^[a-f0-9]{64}$/i.test(String(citation?.source_sha256 || ''))) problems.push('资料内容无法核对');
    if (!validHttpUrl(citation?.source_url)) problems.push('缺少可访问的公开页面');
    return problems;
}

function imageSourceProblems(image) {
    const problems = [];
    if (!String(image?.image_id || '').trim()) problems.push('缺少图片来源信息');
    if (!/^[a-f0-9]{64}$/i.test(String(image?.sha256 || ''))) problems.push('图片文件无法核对');
    if (!validHttpUrl(image?.original_url)) problems.push('缺少可访问的图片来源页面');
    if (!String(image?.ima_entry || '').trim()) problems.push('缺少产品资料库中的图片来源');
    if (!String(image?.ima_kb_id || '').trim()) problems.push('资料来源信息不完整');
    if (!Array.isArray(image?.ima_search_request_ids) || !image.ima_search_request_ids.length) problems.push('资料查询记录不完整');
    if (!/^http_200/.test(String(image?.source_status || ''))) problems.push('图片来源页面未能正常打开');
    return problems;
}

function makeCheck(id, status, summary, details = []) {
    return { id, label: CHECK_LABELS[id], status, status_label: statusLabel(status), summary, details: [...new Set(details)].slice(0, 12) };
}

function safeMarkdown(content, disclosures) {
    const lines = [`# ${content.title}`, '', content.lead, '', content.body_markdown, '', '## 下一步沟通', '', content.cta];
    if (disclosures.length) lines.push('', '## 发布说明', '', ...disclosures.map(item => `- ${item}`));
    return `${lines.join('\n').trim()}\n`;
}

// 模块7：发布前强制核验。所有内容都必须经过六项门禁；失败即阻塞，可安全剥离的问题降级处理。
function runReleaseVerification(input) {
    if (!input || typeof input !== 'object' || !input.draft || !Array.isArray(input.facts) || !Array.isArray(input.image_sources) || !Array.isArray(input.citations)) {
        throw new PipelineError('VERIFICATION_INPUT_INVALID', '发布前检查所需信息不完整，请重新生成后再试');
    }
    const checkedAt = new Date().toISOString();
    const productName = String(input.product?.resolved_name || input.product?.requested_name || '').trim();
    const draft = input.draft;
    const facts = input.facts;
    const images = input.image_sources;
    const citations = input.citations;
    const candidate = input.candidate || {};
    const risks = [];
    let riskIndex = 0;
    const addRisk = (checkId, title, riskLevel, issue, recommendation, affected = []) => {
        const risk = {
            id: `risk-${String(++riskIndex).padStart(2, '0')}`,
            check_id: checkId, title, risk_level: riskLevel, risk_level_label: RISK_LABELS[riskLevel],
            issue, recommendation, affected, status: riskLevel === 'downgrade' ? 'mitigated_in_safe_version' : 'open',
        };
        risks.push(risk);
        return risk;
    };

    const productEvidence = (candidate.evidence || []).filter(item => item.source_level === 'E1');
    const exactEvidence = productEvidence.filter(item => [item.title, item.locator, item.excerpt].some(value => modelAppearsInEvidence(value, productName)));
    const modelPassed = Boolean(productName && input.product?.model_verified === true && exactEvidence.length);
    const modelCheck = makeCheck(
        'product_model', modelPassed ? 'pass' : 'fail',
        modelPassed ? `发布型号“${productName}”与 ${exactEvidence.length} 条产品资料中的具体型号一致。` : '发布型号缺少与具体型号一致的产品资料依据。',
        modelPassed ? exactEvidence.map(item => cleanSourceTitle(item.title)) : ['候选型号或资料依据无法确认'],
    );
    if (!modelPassed) addRisk('product_model', '产品型号仍需确认', 'blocking', `“${productName || '未提供型号'}”没有匹配到可定位的同型号产品资料。`, '补充同型号官网或产品资料库原文后，重新进行选品和发布前检查。');

    const parameterProblems = [];
    if (!facts.length) parameterProblems.push('缺少可核对原文的产品参数');
    for (const fact of facts) for (const problem of factSourceProblems(fact)) parameterProblems.push(problem);
    for (const fact of facts) if (normalizeModel(fact.product) !== normalizeModel(productName) && !modelAppearsInEvidence(fact.product, productName)) parameterProblems.push('产品信息与所选型号不一致');
    const parameterPassed = facts.length > 0 && parameterProblems.length === 0;
    const parameterCheck = makeCheck(
        'parameters', parameterPassed ? 'pass' : 'fail',
        parameterPassed ? `${facts.length} 项产品参数与型号、原文和使用限制一致。` : '部分产品参数缺失、与型号不一致或无法找到原文。',
        parameterProblems,
    );
    if (!parameterPassed) addRisk('parameters', '产品参数需要调整', 'blocking', parameterProblems.join('；') || '参数资料不完整。', '撤回当前版本，补充可核对的参数和使用限制后重试。');

    const titlePrice = hasSensitiveText(`${draft.title}\n${draft.lead}\n${draft.cta}`, PRICE_AMOUNT) || hasSensitiveText(`${draft.title}\n${draft.lead}\n${draft.cta}`, PRICE_CLAIM);
    const bodyPriceIssues = [...sensitiveSegments(draft.body_markdown, PRICE_AMOUNT), ...sensitiveSegments(draft.body_markdown, PRICE_CLAIM)];
    const priceStatus = titlePrice ? 'fail' : bodyPriceIssues.length ? 'downgrade' : 'pass';
    const priceCheck = makeCheck(
        'price', priceStatus,
        priceStatus === 'pass' ? '未发现金额、成交价或折扣承诺；当前没有可宣称的最新交易报价。'
            : priceStatus === 'downgrade' ? '正文含未经最新口径确认的价格表述，已从安全版本移除。'
                : '标题、导语或行动引导含价格承诺，无法安全自动改写。',
        titlePrice ? ['核心文案含价格或金额表述'] : bodyPriceIssues,
    );
    if (priceStatus === 'fail') addRisk('price', '核心文案含未核验价格', 'blocking', '标题、导语或行动引导出现价格/金额表达。', '删除价格承诺，补充准确销售配置、地区、数量、有效期和有效报价依据后重新检查。');
    if (priceStatus === 'downgrade') addRisk('price', '正文价格口径未确认', 'downgrade', bodyPriceIssues.join('；'), '从可发布版本移除相关价格段落，只保留“待确认/非正式报价”的说明。');

    const imageIdentityProblems = [];
    const rightsPending = [];
    const safeImages = [];
    for (const image of images) {
        if (!exactModelMatch(image.product, productName)) imageIdentityProblems.push(`有图片与目标型号不一致`);
        for (const problem of imageSourceProblems(image)) imageIdentityProblems.push(`图片：${problem}`);
        const rightsVerified = image.publication_ready === true && image.formal_publication_verified === true;
        if (!rightsVerified) rightsPending.push(image.image_id);
        if (rightsVerified && exactModelMatch(image.product, productName) && !imageSourceProblems(image).length) safeImages.push(image.image_id);
    }
    const imageExpected = Number.isInteger(input.image_expected) && input.image_expected > 0;
    const imagesUnavailable = imageExpected && images.length === 0;
    const imageStatus = imageIdentityProblems.length ? 'fail' : rightsPending.length || imagesUnavailable ? 'downgrade' : 'pass';
    const imageCheck = makeCheck(
        'image_identity', imageStatus,
        imageStatus === 'pass' ? (images.length ? `${images.length} 张图片的型号、来源和发布授权均已确认。` : '未请求图片，未使用图片，无图片冲突。')
            : imageStatus === 'downgrade' && imagesUnavailable ? '目标型号没有可用审稿图片；安全版本按纯文字发布。'
                : imageStatus === 'downgrade' ? `${images.length}张图片型号与来源通过，但${rightsPending.length}张缺少公开发布授权；安全版本已移除图片。`
                    : '存在型号不一致或来源不完整的图片。',
        imageIdentityProblems.length ? imageIdentityProblems : imagesUnavailable ? ['未找到与目标型号匹配且来源完整的审稿图片'] : rightsPending.map(id => '公开发布授权或人工终审尚未完成'),
    );
    if (imageStatus === 'fail') addRisk('image_identity', '图片来源需要调整', 'blocking', imageIdentityProblems.join('；'), '停止使用相关图片，按目标型号重新核对画面、销售配置、版权和来源页面。', imageIdentityProblems);
    if (imagesUnavailable) addRisk('image_identity', '目标型号无可用图片', 'downgrade', '未找到与目标型号匹配且来源完整的审稿图片。', '降级为纯文字版本，不使用其他型号或未核验候选图替代。');
    else if (imageStatus === 'downgrade') addRisk('image_identity', '图片公开发布授权未完成', 'downgrade', `${rightsPending.length}张图片仅通过型号/来源辅助核验，尚未完成正式发布授权。`, '从可发布版本移除全部图片和图片标记；授权完成后再单独复核。', rightsPending);

    const coreOverreach = sensitiveSegments(`${draft.title}\n${draft.lead}\n${draft.cta}`, OVERREACH);
    const bodyOverreach = sensitiveSegments(draft.body_markdown, OVERREACH);
    const overreachStatus = coreOverreach.length ? 'fail' : bodyOverreach.length ? 'downgrade' : 'pass';
    const overreachCheck = makeCheck(
        'overreach', overreachStatus,
        overreachStatus === 'pass' ? '未发现绝对化、成交、兼容性或效果承诺。'
            : overreachStatus === 'downgrade' ? '正文含超范围承诺，已从安全版本移除。'
                : '标题、导语或行动引导含超范围承诺，无法自动放行。',
        coreOverreach.length ? coreOverreach : bodyOverreach,
    );
    if (overreachStatus === 'fail') addRisk('overreach', '核心文案含超范围承诺', 'blocking', coreOverreach.join('；'), '删除绝对化或效果保证，改写为带适用条件的可验证表述。');
    if (overreachStatus === 'downgrade') addRisk('overreach', '正文含超范围承诺', 'downgrade', bodyOverreach.join('；'), '从可发布版本移除相关段落，不保留没有资料依据的承诺。');

    const sourceProblems = [];
    if (!citations.length) sourceProblems.push('没有资料来源引用');
    for (const citation of citations) for (const problem of citationSourceProblems(citation)) sourceProblems.push(`产品资料：${problem}`);
    for (const image of images) for (const problem of imageSourceProblems(image)) sourceProblems.push(`图片：${problem}`);
    const sourceCheck = makeCheck(
        'source_completeness', sourceProblems.length ? 'fail' : 'pass',
        sourceProblems.length ? '部分资料来源的名称、页面位置或链接存在缺项。' : `${citations.length} 项产品资料与 ${images.length} 张图片均保留了可核对的资料来源。`,
        sourceProblems,
    );
    if (sourceProblems.length) addRisk('source_completeness', '来源链不完整', 'blocking', sourceProblems.join('；'), '补齐资料页面位置和公开链接后重新检查；不得用推测替代。');

    const items = [modelCheck, parameterCheck, priceCheck, imageCheck, overreachCheck, sourceCheck];
    const failCount = items.filter(item => item.status === 'fail').length;
    const downgradeCount = items.filter(item => item.status === 'downgrade').length;
    const overallStatus = failCount ? 'blocked' : downgradeCount ? 'downgraded' : 'passed';
    const blocked = overallStatus === 'blocked';

    let body = stripImageCallouts(draft.body_markdown);
    if (imageStatus === 'pass' && safeImages.length === images.length) body = draft.body_markdown;
    if (priceStatus === 'downgrade') body = stripUnsafeChunks(body, chunk => hasSensitiveText(chunk, PRICE_AMOUNT) || hasSensitiveText(chunk, PRICE_CLAIM));
    if (overreachStatus === 'downgrade') body = stripUnsafeChunks(body, chunk => hasSensitiveText(chunk, OVERREACH));
    if (imageStatus !== 'pass') {
        body = body.split(/\r?\n/).filter(line => !/图片授权|以下图片/.test(line)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
        body = stripImageCallouts(body);
    }

    const disclosures = risks.filter(risk => risk.risk_level === 'downgrade').map(risk => risk.recommendation);
    const safeContent = blocked ? null : {
        title: draft.title, lead: draft.lead, body_markdown: body, cta: draft.cta,
        tags: Array.isArray(draft.tags) ? draft.tags : [], image_ids: safeImages,
    };
    const renderedMarkdown = safeContent ? safeMarkdown(safeContent, disclosures) : '';
    const safeContentReady = Boolean(!blocked && safeContent && safeContent.body_markdown.trim());

    const legacyPending = risks.map(risk => risk.issue);
    legacyPending.push('软件兼容性、完整销售配置与当前成交报价仍需客户及官方资料确认');
    const verification = {
        schema_version: '1.0',
        policy_version: 'mandatory-release-verification-v1',
        checked_at: checkedAt,
        overall_status: overallStatus,
        status_label: OVERALL_LABELS[overallStatus],
        publication_ready: overallStatus === 'passed',
        safe_content_ready: safeContentReady,
        items,
        risk_items: risks,
        summary: {
            pass_count: items.filter(item => item.status === 'pass').length,
            downgrade_count: downgradeCount,
            fail_count: failCount,
            blocking_risk_count: risks.filter(risk => risk.risk_level === 'blocking').length,
            downgrade_risk_count: risks.filter(risk => risk.risk_level === 'downgrade').length,
        },
        safe_content: {
            ready: safeContentReady,
            disclosures: [...new Set(disclosures)],
            content: safeContent,
            rendered_markdown: renderedMarkdown,
        },
        product_model_match: modelPassed ? 'verified' : 'failed',
        evidence_traceable: sourceProblems.length === 0,
        image_count: images.length,
        compliance: overallStatus === 'blocked' ? 'fail' : overallStatus === 'downgraded' ? 'downgraded' : 'pass',
        pending: [...new Set(legacyPending)],
    };
    return verification;
}

module.exports = {
    CHECK_LABELS,
    STATUS_LABELS,
    RISK_LABELS,
    runReleaseVerification,
    stripImageCallouts,
    stripUnsafeChunks,
    hasSensitiveText,
};
