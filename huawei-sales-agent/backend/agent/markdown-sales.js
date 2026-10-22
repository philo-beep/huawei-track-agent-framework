'use strict';

const { plainText, cleanProse, humanStatus, profileLabel, humanMoney, humanDate, cleanSourceTitle, readableValue } = require('./sales-copy');

const SPEC_LABELS = Object.freeze({ display_resolution: '屏幕分辨率', memory_options: '内存选项', storage_options: '存储选项', processor: '处理器', operating_system: '操作系统', battery: '电池', weight: '重量' });

function renderSalesMarkdown(result) {
    const pricing = result.pricing_result || {};
    const plan = result.solution?.demonstration_plan || {};
    const content = result.content?.marketing_content;
    const official = result.official_reference;
    const baseSolution = result.solution?.base_solution || {};
    const quoteStatus = result.quote_status || {};
    const budgetAssessment = result.budget_assessment || {};
    const cell = value => String(readableValue(value)).replace(/\|/g, '／').replace(/\r?\n/g, ' ');
    const lines = [
        '# 销售准备说明', '',
        `**结果：${humanStatus(result.status)}。** 本文件用于客户沟通前的内部准备，不是正式报价或成交承诺。`, '',
        `> ${plainText(result.notice)}`, '',
        '## 第一步：客户画像', '',
        '| 客户信息 | 当前内容 | 依据情况 |',
        '| --- | --- | --- |'
    ];
    for (const [name, field] of Object.entries(result.customer_analysis?.profile || {})) {
        const basis = field.evidence?.length ? field.evidence.map(item => `“${item.quote}”`).join('；') : field.reason;
        lines.push(`| ${cell(profileLabel(name))} | ${cell(field.value)} | ${cell(basis)} |`);
    }
    const clarifications = (result.customer_analysis?.clarification_questions || []).map(item => plainText(item?.question || item)).filter(Boolean);
    if (clarifications.length) lines.push('', '### 建议先确认', ...clarifications.map(item => `- ${item}`));
    if (!Object.values(result.customer_analysis?.profile || {}).some(field => field?.value !== null && field?.value !== undefined)) lines.push('', '- 暂无明确客户画像，先完成需求澄清。');

    lines.push('', '## 第二步：内容准备', '');
    if (content) {
        lines.push(`### ${plainText(content.title)}`, '', plainText(content.lead), '', cleanProse(content.body), '', `**下一步沟通：** ${plainText(content.cta)}`);
    } else {
        lines.push('本次未生成内容，请先补齐客户信息。');
    }

    lines.push('', '## 第三步：客户方案', '', '## 基础方案（基于客户画像与资料来源）', `当前状态：${humanStatus(baseSolution.status)}。`, `方案目标：${plainText(baseSolution.goal)}`);
    const context = (baseSolution.customer_context || []).filter(item => item.value !== null && item.value !== undefined);
    if (context.length) lines.push('', '### 客户情况', ...context.map(item => `- ${profileLabel(item.field)}：${cell(item.value)}（${humanStatus(item.status)}）`));
    if ((baseSolution.approach || []).length) {
        lines.push('', '### 建议推进步骤');
        for (const step of baseSolution.approach) lines.push(`#### 第 ${step.priority} 步`, `负责人：${plainText(step.owner_role)}；建议时间：${plainText(step.timing)}。`, `动作：${plainText(step.action)}`, `交付：${plainText(step.output)}`, `完成标准：${plainText(step.completion_criteria)}`);
    }
    if ((baseSolution.deliverables || []).length) lines.push('', '### 需要准备的资料', ...baseSolution.deliverables.map(item => `- ${plainText(item.label)}：${humanStatus(item.status)}`));
    if ((baseSolution.exclusions || []).length) lines.push('', '### 需要说明的边界', ...baseSolution.exclusions.map(item => `- ${plainText(item)}`));

    renderQuoteAndBudget(lines, quoteStatus, budgetAssessment);
    renderOfficial(lines, official);
    renderPricing(lines, pricing);

    lines.push('', '## 0–30 分钟客户演示准备', '', `目标：${plainText(plan.goal)}`, '', '### 演示前准备', ...(plan.materials || []).map(item => `- ${plainText(item)}`), '', '### 参与人员', ...(plan.roles || []).map(item => `- ${plainText(item)}`), '', '### 建议时间安排');
    for (const step of plan.schedule || []) {
        lines.push(`#### ${step.minutes} 分钟 · ${plainText(step.owner)}`, `做什么：${plainText(step.operation)}`, `完成标准：${plainText(step.acceptance)}`, `遇到困难：${plainText(step.fallback)}`);
    }
    lines.push('', '现场实际耗时尚未验证。完成演示后再记录开始/结束时间、客户验收结果和遗留问题。');
    lines.push('', '## 第四步：下一步销售动作', '');
    for (const [index, action] of (result.next_actions || []).entries()) {
        lines.push(`### 第 ${index + 1} 项 · ${plainText(action.owner || '待指定负责人')}`, `要做：${plainText(action.action)}`, `何时推进：${plainText(action.time_node || action.trigger)}`, `完成标准：${plainText(action.completion_criteria)}`);
        if (action.pending_dependencies?.length) lines.push(`先确认：${action.pending_dependencies.map(item => plainText(item)).join('、')}`);
        lines.push('');
    }
    const boundaries = [...(result.limitations || []), ...(result.diagnostics || []).map(item => item.message || item)].map(plainText).filter(Boolean);
    if (boundaries.length) lines.push('## 使用边界', '', ...[...new Set(boundaries)].map(item => `- ${item}`));
    lines.push('', `> 生成时间：${humanDate(result.timing?.completed_at)}；本次处理用时 ${result.timing?.generation_elapsed_seconds ?? '未提供'} 秒。该用时不代表现场 30 分钟演示已经完成。`);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

module.exports = { renderSalesMarkdown };

function renderQuoteAndBudget(lines, quoteStatus, budgetAssessment) {
    lines.push('', '## 报价状态', `当前状态：${humanStatus(quoteStatus.status)}。`, `正式成交报价：${quoteStatus.price === null || quoteStatus.price === undefined ? '待确认' : humanMoney(quoteStatus.price)}。`);
    if (quoteStatus.synthetic_reference) lines.push(`演示金额参考：${humanMoney(quoteStatus.synthetic_reference.amount_cents)}。这不是客户报价，也不是华为官方政策。`);
    if ((quoteStatus.missing_information || []).length) lines.push(...quoteStatus.missing_information.map(item => `- 还需确认：${plainText(item)}`));
    const budgetRange = budgetAssessment.range ? `${budgetAssessment.range.min} 至 ${budgetAssessment.range.max} ${budgetAssessment.range.currency || '币种待确认'}，${budgetAssessment.range.scope || '预算口径待确认'}` : '客户预算待确认';
    lines.push('', '## 预算判断', `预算范围：${budgetRange}。`, `可行度：${plainText(budgetAssessment.feasibility?.label || '待确认')}。`, `判断依据：${plainText(budgetAssessment.feasibility?.reason || '暂无足够信息')}`);
    if (budgetAssessment.demo_comparison) lines.push(`演示金额比较：${plainText(budgetAssessment.demo_comparison.budget_check)}；${plainText(budgetAssessment.demo_comparison.notice)}`);
    if ((budgetAssessment.missing_information || []).length) lines.push(...budgetAssessment.missing_information.map(item => `- 还需确认：${plainText(item)}`));
}

function renderOfficial(lines, official) {
    lines.push('', '## 华为公开资料', '');
    if (!official) {
        lines.push('本次未取得可使用的华为公开资料。');
        return;
    }
    lines.push(`产品：${plainText(official.product || '待确认')}；资料状态：${humanStatus(official.status)}；最近核对：${humanDate(official.checked_at)}。`);
    const specs = (official.specifications || []).map(spec => `- ${SPEC_LABELS[spec.name] || plainText(spec.name)}：${readableValue(spec.value)}${spec.unit ? ' ' + spec.unit : ''}`);
    if (specs.length) lines.push('', '### 可核对的产品信息', ...specs);
    for (const source of official.sources || []) {
        lines.push('', `### ${cleanSourceTitle(source.product || '华为公开页面')}`, `更新时间：${humanDate(source.fetched_at)}`, `来源：${source.url}`, ...(source.limitations || []).map(item => `- 使用限制：${plainText(item)}`));
    }
    lines.push('', official.public_price_reference ? `**获取时点公开价格参考：${humanMoney(official.public_price_reference.amount_cents)}。该金额不是成交报价。**` : '**正式成交报价：待确认。** 未取得完整配置、有效期和适用条件时，不输出成交金额。');
    if ((official.diagnostics || []).length) lines.push(...official.diagnostics.map(item => `- ${plainText(item.message || item)}`));
}

function renderPricing(lines, pricing) {
    lines.push('', '## 四级演示价格计算', '', '> 以下金额只用于演示计算方式，不是华为官方政策，也不代表客户最终成交价。', '');
    lines.push(`产品：${plainText(pricing.product || '待确认')}；演示数量：${pricing.quantity ?? '待确认'} 台。`, `演示地区：${plainText(pricing.effective?.region || '待确认')}；演示有效期：${plainText(pricing.effective?.valid_from || '待确认')} 至 ${plainText(pricing.effective?.valid_to || '待确认')}。`);
    for (const trace of pricing.trace || []) {
        lines.push('', `### 第 ${trace.level} 级：${cleanSourceTitle(trace.source?.title || '演示价格假设')}`, `本步前单台：${humanMoney(trace.before_cents)}`, `本步优惠：${humanMoney(trace.discount_cents)}`, `本步后单台：${humanMoney(trace.after_cents)}`);
        if (Number.isSafeInteger(trace.cap_discount_cents)) lines.push(`本步优惠上限：${humanMoney(trace.cap_discount_cents)}`);
        lines.push(`说明：${plainText(trace.source?.description || '这是一项演示假设，需人工确认。')}`);
    }
    lines.push('', `**演示单价：${humanMoney(pricing.unit_amount_cents)}；演示合计：${humanMoney(pricing.amount_cents)}。**`, '**正式成交报价：待确认。**');
    if ((pricing.diagnostics || []).length) lines.push(...pricing.diagnostics.map(item => `- ${plainText(item.message || item)}`));
}
