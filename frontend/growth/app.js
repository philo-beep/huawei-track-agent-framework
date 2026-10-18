'use strict';

const byId = identifier => document.getElementById(identifier);
const state = { examples: [], csrfToken: null, activeExample: null, jobId: null, running: false, polling: false, pollTimer: null, markdown: '', startedAt: 0 };
const labels = { identity: '身份与角色', relationship: '新老客户关系', industry: '行业', company_size: '组织规模', needs: '核心需求', budget: '预算与数量', decision_chain: '决策链', preferences: '偏好', pain_points: '痛点', purchase_stage: '购买阶段', channels: '可触达渠道' };
const statuses = { explicit: '明确输入', inferred: '推断，待核对', pending: '待确认', ready: '准备稿已生成', blocked: '已阻塞', needs_clarification: '需要澄清', calculated_demo: '合成演算完成', invalid_input: '输入无效', demo_ready: '演示准备就绪', needs_attention: '需要处理' };
const readable = value => value === null || value === undefined ? '待确认 / 无' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);

function element(tagName, text, className) {
    const created = document.createElement(tagName);
    if (text !== undefined) created.textContent = String(text);
    if (className) created.className = className;
    return created;
}

function status(text, isError = false) {
    byId('run-status').textContent = text;
    byId('run-status').classList.toggle('error', isError);
}

function clearResults() {
    byId('results').hidden = true;
    state.markdown = '';
    byId('export-status').textContent = '';
}

function parseObject(text, name) {
    let value;
    try { value = JSON.parse(text || '{}'); } catch { throw new Error(`${name}不是有效JSON，请修正或重新填充示例。`); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name}必须是JSON对象。`);
    return value;
}

function policySummary() {
    try {
        const pricing = parseObject(byId('pricing-json').value, '报价输入');
        const policy = pricing.policy;
        byId('policy-summary').textContent = policy ? [
            `性质：合成政策，待官方确认；产品：${pricing.product}；演示SKU：${pricing.sku}`,
            `合成基价：${money(policy.base_unit_cents)}；合成数量：${pricing.quantity}台；日期：${pricing.as_of}`,
            `有效期：${policy.valid_from}—${policy.valid_to}；地区：${policy.region}`,
            ...(policy.rules || []).map(rule => `第${rule.level}级：${rule.source?.title || rule.operation}；value=${rule.value}；资格=${(rule.required_eligibility || []).join('、') || '无'}`),
            `当前合成资格键：${(pricing.confirmed_eligibility || []).join('、') || '无，金额可能阻塞'}`,
            `政策来源：${policy.source?.entry || '待核实'}\n${policy.source?.description || ''}`,
        ].join('\n') : '未附带四级假设政策，金额将待核实。';
    } catch (error) { byId('policy-summary').textContent = error.message; }
}

function fillExample(index) {
    if (state.running || !state.examples[index]) return;
    const example = state.examples[index];
    const marketing = example.marketing_input;
    state.activeExample = example;
    byId('product').value = marketing.product || '';
    byId('audience').value = marketing.audience || '';
    byId('scenario').value = marketing.scenario || '';
    byId('platform').value = marketing.platform || '公众号';
    byId('raw-request').value = marketing.raw_request || '';
    const customer = structuredClone(marketing.customer || {});
    byId('quantity').value = customer.budget?.quantity ?? '';
    byId('budget').value = customer.budget?.scope === '总额' ? customer.budget.max ?? '' : '';
    byId('customer-json').value = JSON.stringify(customer, null, 2);
    byId('pricing-json').value = example.pricing_input ? JSON.stringify(example.pricing_input, null, 2) : '';
    byId('enable-pricing').checked = Boolean(example.pricing_input);
    byId('example-note').textContent = `已填入合成示例：${example.label}。所有客户输入与演算资格均为合成；点击运行才会调用本机模型。`;
    policySummary();
    clearResults();
    status('示例已填充，尚未运行。可修改输入后运行四步。');
}

function clearCustomer() {
    if (state.running) return;
    for (const identifier of ['raw-request', 'audience', 'scenario', 'quantity', 'budget']) byId(identifier).value = '';
    byId('customer-json').value = '{}';
    byId('enable-pricing').checked = false;
    state.activeExample = null;
    byId('example-note').textContent = '新客户模式：样例身份、行业、数量、预算已清空；产品保留供核对，合成报价已关闭。只填已知信息。';
    clearResults();
    status('请填写客户信息；未知项留空，系统会给出澄清提示。');
}

function customerChanged() {
    byId('customer-json').value = '{}';
    byId('quantity').value = '';
    byId('budget').value = '';
    byId('enable-pricing').checked = false;
    byId('example-note').textContent = '客户原话 / 受众已更改：已清空旧客户结构化信息、数量、预算，并关闭合成报价，避免继承示例事实。请重新确认需要的字段。';
}

function collectInput() {
    const marketing = { schema_version: '1.0', mode: 'local', platform: byId('platform').value };
    for (const [field, identifier] of [['product', 'product'], ['audience', 'audience'], ['scenario', 'scenario'], ['raw_request', 'raw-request']]) {
        const value = byId(identifier).value.trim();
        if (value) marketing[field] = value;
    }
    const customer = parseObject(byId('customer-json').value, '客户结构化信息');
    delete customer.budget;
    const quantityText = byId('quantity').value;
    const budgetText = byId('budget').value;
    const budget = {};
    if (quantityText !== '') {
        const quantity = Number(quantityText);
        if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('采购数量必须是大于0的安全整数。');
        budget.quantity = quantity;
    }
    if (budgetText !== '') {
        if (!/^\d+(\.\d{1,2})?$/.test(budgetText)) throw new Error('总预算请填写非负金额，最多两位小数。');
        budget.max = Number(budgetText);
        budget.currency = 'CNY';
        budget.scope = '总额';
        budget.source_text = `网页明确输入总预算上限${budgetText}元`;
    }
    if (Object.keys(budget).length) customer.budget = budget;
    if (Object.keys(customer).length) marketing.customer = customer;
    const request = { marketing_input: marketing };
    if (byId('enable-pricing').checked) {
        const pricing = parseObject(byId('pricing-json').value, '合成报价输入');
        if (pricing.mode !== 'demo_only') throw new Error('网页仅允许明确的demo_only合成政策，不能启用真实交易报价。');
        if (marketing.product) pricing.product = marketing.product;
        if (quantityText !== '' && Number(quantityText) !== pricing.quantity) {
            pricing.quantity = Number(quantityText);
            pricing.confirmed_eligibility = [];
        }
        delete pricing.budget_total_cents;
        if (budgetText !== '') {
            const [yuan, cents = ''] = budgetText.split('.');
            const amount = BigInt(yuan) * 100n + BigInt(cents.padEnd(2, '0'));
            if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('预算超过安全金额范围。');
            pricing.budget_total_cents = Number(amount);
        }
        request.pricing_input = pricing;
    }
    return request;
}

async function api(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    let data;
    try { data = await response.json(); } catch { throw new Error('本地服务未返回有效JSON，请检查服务是否仍在运行。'); }
    if (!response.ok) throw new Error(`${data.error?.message || '本地请求失败'}（${data.error?.code || response.status}）`);
    return data;
}

function setRunning(running) {
    state.running = running;
    byId('input-fields').disabled = running;
    byId('run-button').disabled = running || !state.csrfToken;
    byId('new-customer').disabled = running;
    state.examples.slice(0, 3).forEach((example, index) => { byId(`example-${index + 1}`).disabled = running; });
    byId('stop-polling').disabled = !running || !state.polling;
    if (!running) byId('resume-polling').hidden = true;
}

async function startRun(event) {
    if (event) event.preventDefault();
    if (state.running || !state.csrfToken) return;
    let request;
    try { request = collectInput(); } catch (error) { status(error.message, true); return; }
    clearResults();
    state.polling = true;
    state.startedAt = Date.now();
    setRunning(true);
    status('正在提交至本机服务，将真实运行四步流程……');
    try {
        const job = await api('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrfToken }, body: JSON.stringify(request) });
        state.jobId = job.id;
        await pollRun();
    } catch (error) {
        state.polling = false;
        setRunning(false);
        status(`未完成运行：${error.message}。可检查输入或重新载入页面刷新服务令牌。`, true);
    }
}

async function pollRun() {
    if (!state.polling || !state.jobId) return;
    try {
        const job = await api(`/api/runs/${encodeURIComponent(state.jobId)}`);
        if (job.status === 'running') {
            status(`本机模型执行中，已等待${Math.round((Date.now() - state.startedAt) / 1000)}秒。请勿重复运行；暂停查询不会取消后台任务。`);
            if (state.polling) state.pollTimer = setTimeout(pollRun, 1000);
            return;
        }
        state.polling = false;
        setRunning(false);
        if (job.status === 'failed') {
            status(`执行失败：${job.error?.message || '请检查本地服务和模型'}（${job.error?.code || 'FAILED'}）。未生成成功结果。`, true);
            return;
        }
        if (job.status !== 'completed' || !job.result) throw new Error('服务返回了不完整结果');
        renderResult(job.result, job.markdown || '');
    } catch (error) {
        state.polling = false;
        byId('stop-polling').disabled = true;
        byId('resume-polling').hidden = false;
        status(`结果查询暂停：${error.message}。后台可能仍在运行，请点击“继续结果查询”，避免重复提交。`, true);
    }
}

function list(container, values, formatter = value => readable(value)) {
    const items = element('ul');
    for (const value of values || []) items.append(element('li', formatter(value)));
    container.append(items);
}

function card(container, title, text) {
    const item = element('div', undefined, 'result-card');
    if (title) item.append(element('strong', title));
    if (text !== undefined) item.append(element('p', text, 'plain-text'));
    container.append(item);
    return item;
}

function money(cents) {
    if (!Number.isSafeInteger(cents)) return '待核实（金额null）';
    const amount = BigInt(cents);
    return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}元`;
}

function safeLink(container, value) {
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) return;
        const link = element('a', value);
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        const paragraph = element('p');
        paragraph.append(link);
        container.append(paragraph);
    } catch { }
}

function renderSource(container, source, title) {
    const item = card(container, title || source.title || '来源', [
        `知识库：${(source.archive_aliases || []).join('、') || '官网来源 / 见原文'}`,
        `条目：${source.entry || '见页面链接'}；内容指纹：${source.entry_sha256 || source.content_sha256 || source.sha256 || '未提供'}`,
        `抓取 / 核验时间：${source.fetched_at || source.checked_at || source.captured_at || '见来源原文，未提供独立时间字段'}`,
        `适用型号 / SKU：${source.product || source.model || '见事实关联型号'} / ${source.sku || '未确认'}`,
    ].join('\n'));
    const urls = [...(Array.isArray(source.urls) ? source.urls : []), ...(source.url ? [source.url] : [])];
    for (const url of new Set(urls)) safeLink(item, url);
    if (source.excerpt || source.description) {
        const details = element('details');
        details.append(element('summary', '来源原文与限制'));
        details.append(element('pre', source.excerpt || source.description));
        item.append(details);
    }
}

function renderResult(result, markdown) {
    for (const identifier of ['profile', 'clarifications', 'content', 'pricing', 'plan', 'actions', 'official-reference', 'sources', 'diagnostics']) byId(identifier).replaceChildren();
    const marketing = result.marketing_result || {};
    const isDemoReady = result.status === 'demo_ready';
    status(isDemoReady ? '四步演示准备完成。真实报价、正式图片和转化仍须核验，请查看下方限制。' : '流程已返回，需要澄清或处理阻塞；请查看问题与诊断。', !isDemoReady);
    byId('result-summary').textContent = `业务状态：${statuses[result.status] || result.status}；营销：${statuses[marketing.status] || marketing.status || '待确认'}。仅演示，真实交易报价未启用。生成用时${result.timing?.generation_elapsed_seconds ?? '未知'}秒，不代表现场30分钟交付已验证。`;
    const tableWrap = element('div', undefined, 'table-wrap');
    const table = element('table');
    const head = element('tr');
    for (const name of ['维度', '当前值', '状态', '证据 / 待确认原因']) head.append(element('th', name));
    table.append(head);
    for (const [name, field] of Object.entries(result.customer_analysis?.profile || {})) {
        const row = element('tr');
        const evidence = (field.evidence || []).map(item => `${item.input_path}：“${item.quote}”`).join('\n') || field.reason;
        for (const value of [labels[name] || name, readable(field.value), statuses[field.status] || field.status, evidence]) row.append(element('td', value));
        table.append(row);
    }
    tableWrap.append(table);
    byId('profile').append(tableWrap);
    const questions = result.customer_analysis?.clarification_questions || [];
    if (questions.length) { card(byId('clarifications'), '请优先补充', '缺失信息不会默认为客户事实。'); list(byId('clarifications'), questions, item => `${item.question}（影响：${item.blocks}）`); }
    const content = result.content?.marketing_content;
    if (content) {
        card(byId('content'), content.title, `${content.lead || ''}\n\n${content.body || ''}\n\n行动引导：${content.cta || ''}`);
    } else card(byId('content'), '尚未生成内容', '请按澄清问题补充输入；未将空稿标为成功。');
    byId('image-status').textContent = `正式配图：${content?.images?.length || 0}张。候选图片未完成型号 / SKU / 版权核验时，不作为正式配图展示；图片来源保留在完整结果和诊断。`;
    for (const image of content?.images || []) for (const source of image.source_refs || []) renderSource(byId('sources'), source, `图片来源：${image.name}`);
    const pricing = result.pricing_result || {};
    card(byId('pricing'), `合成演算：${statuses[pricing.status] || pricing.status || '待核实'}`, `产品：${pricing.product || '待确认'}\n演示SKU：${pricing.sku || '待确认'}\n合成数量：${pricing.quantity ?? '待确认'}台；合成单价：${money(pricing.unit_amount_cents)}；合成总额：${money(pricing.amount_cents)}\n真实交易报价：null（需获授权真实政策）`);
    for (const trace of pricing.trace || []) card(byId('pricing'), `第${trace.level}级：${trace.source?.title || trace.operation}`, `整数分公式：${trace.formula}\n本级后：${money(trace.after_cents)}；优惠：${money(trace.discount_cents)}\n来源：${trace.source?.entry || '待核实'}\n${trace.source?.description || ''}`);
    const snapshot = result.pricing_configuration?.policy_snapshot;
    if (snapshot) card(byId('pricing'), '本次运行的完整四级假设政策', JSON.stringify(snapshot, null, 2));
    list(byId('pricing'), pricing.diagnostics || [], item => `${item.code}：${item.message}`);
    const plan = result.solution?.demonstration_plan;
    if (plan) {
        card(byId('plan'), '0–30分钟演示准备方案', `${plan.goal}\n现场耗时未验证，请记录实际开始与结束时间。`);
        card(byId('plan'), '物料', (plan.materials || []).join('\n'));
        card(byId('plan'), '角色', (plan.roles || []).join('\n'));
        for (const step of plan.schedule || []) card(byId('plan'), `${step.minutes}分钟 · ${step.owner}`, `输入：${step.input}\n操作：${step.operation}\n输出：${step.output}\n验收：${step.acceptance}\n失败替代：${step.fallback}`);
    }
    for (const action of result.next_actions || []) card(byId('actions'), action.owner, `动作：${action.action}\n触发：${action.trigger}\n依赖：${(action.pending_dependencies || []).join('、') || '无另列'}`);
    const official = result.official_reference;
    if (official) {
        card(byId('official-reference'), '华为官网 / 商城核验', JSON.stringify(official, null, 2));
        for (const source of official.sources || []) renderSource(byId('official-reference'), source);
    } else card(byId('official-reference'), '官网价格参考', '本次结果未附独立官网价格核验，当前价格待核实。历史资料和合成金额不当作当前可成交价。');
    for (const fact of marketing.knowledge_basis?.facts || []) {
        const item = card(byId('sources'), `事实 ${fact.id} · ${fact.product}`, `${fact.claim}\n适用条件：${(fact.conditions || []).join('\n')}`);
        for (const source of fact.source_refs || []) renderSource(item, source);
    }
    list(byId('diagnostics'), [...(result.limitations || []), ...(result.diagnostics || []).map(item => `${item.code}：${item.message}`), ...(marketing.diagnostics || []).map(item => `${item.code}：${item.message}`), ...(marketing.verification?.pending_information || [])]);
    state.markdown = markdown;
    byId('full-markdown').textContent = markdown;
    for (const [identifier, format] of [['download-json', 'json'], ['download-markdown', 'markdown']]) byId(identifier).href = `/api/runs/${encodeURIComponent(state.jobId)}/export?format=${format}`;
    byId('results').hidden = false;
}

byId('growth-form').addEventListener('submit', startRun);
byId('new-customer').addEventListener('click', clearCustomer);
for (let index = 0; index < 3; index += 1) byId(`example-${index + 1}`).addEventListener('click', () => fillExample(index));
byId('raw-request').addEventListener('input', customerChanged);
byId('audience').addEventListener('input', customerChanged);
byId('pricing-json').addEventListener('input', policySummary);
byId('stop-polling').addEventListener('click', () => {
    state.polling = false;
    clearTimeout(state.pollTimer);
    byId('stop-polling').disabled = true;
    byId('resume-polling').hidden = false;
    status('仅暂停结果查询；后台任务仍可能运行，未取消。点击继续查询恢复。');
});
byId('resume-polling').addEventListener('click', () => {
    state.polling = true;
    byId('resume-polling').hidden = true;
    byId('stop-polling').disabled = false;
    pollRun();
});
byId('copy-markdown').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(state.markdown); byId('export-status').textContent = '完整Markdown已复制，含来源及假设说明。'; }
    catch { byId('export-status').textContent = '浏览器未允许复制，请下载Markdown或在下方纯文本中手动选择复制。'; }
});
for (const identifier of ['download-json', 'download-markdown']) byId(identifier).addEventListener('click', () => { byId('export-status').textContent = '已请求本机下载；请在浏览器下载列表确认结果。'; });
document.addEventListener('keydown', event => {
    if (event.repeat || event.isComposing || event.keyCode === 229) return;
    if (event.altKey && !event.ctrlKey && !event.metaKey && ['1', '2', '3'].includes(event.key)) { event.preventDefault(); fillExample(Number(event.key) - 1); }
    if (event.ctrlKey && !event.altKey && event.key === 'Enter') { event.preventDefault(); startRun(); }
});

async function initialize() {
    try {
        const response = await api('/api/examples');
        if (!response.csrf_token || !Array.isArray(response.examples)) throw new Error('示例响应不完整');
        state.csrfToken = response.csrf_token;
        state.examples = response.examples.slice(0, 3);
        state.examples.forEach((example, index) => { const button = byId(`example-${index + 1}`); button.textContent = `${example.label} · Alt+${index + 1}`; button.disabled = false; });
        setRunning(false);
        byId('example-note').textContent = '本地服务已连接。请选择合成示例，或填写自己的脱敏客户输入。';
        if (state.examples.length) fillExample(0);
    } catch (error) { byId('example-note').textContent = `无法加载本地示例：${error.message}`; status('请从本机服务地址打开页面，确认服务运行后刷新页面。', true); }
}

initialize();
