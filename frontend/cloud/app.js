'use strict';

const byId = identifier => document.getElementById(identifier);
const state = { examples: [], csrf: null, running: false, polling: false, jobId: null, markdown: '', startedAt: 0 };
const statuses = { explicit: '明确输入', inferred: '推断，待核对', pending: '待确认', ready: '准备稿已生成', blocked: '已阻塞', needs_clarification: '需要澄清', calculated_demo: '合成演算完成', invalid_input: '输入无效', demo_ready: '演示准备就绪', needs_attention: '需要处理' };
const labels = { identity: '身份与角色', relationship: '新老客户关系', industry: '行业', company_size: '组织规模', needs: '核心需求', budget: '预算与数量', decision_chain: '决策链', preferences: '偏好', pain_points: '痛点', purchase_stage: '购买阶段', channels: '可触达渠道' };
const readable = value => value === null || value === undefined ? '待确认 / 无' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);

function element(tagName, text) {
    const created = document.createElement(tagName);
    if (text !== undefined) created.textContent = String(text);
    return created;
}

function status(message, isError = false) {
    byId('run-status').textContent = message;
    byId('run-status').classList.toggle('error', isError);
}

function card(identifier, title, value) {
    const item = element('div');
    item.className = 'result-card';
    item.append(element('strong', title), element('p', readable(value)));
    byId(identifier).append(item);
    return item;
}

function engineStatus(engine) {
    if (!engine) return '引擎未确认，请查看本次结果；不能据页面名称判定为模型生成。';
    const mode = engine.mode === 'qwen_cpu' ? 'CPU 千问辅助模式' : engine.mode === 'rules' ? '规则准备稿模式（未调用大模型）' : `未确认模式：${engine.mode}`;
    return `${mode}\n模型：${engine.model || '未启用'}；状态：${engine.model_status || '未确认'}\n${engine.notice || '最终内容为程序化准备稿，需要人工审核。'}`;
}

function setRunning(running) {
    state.running = running;
    byId('input-fields').disabled = running;
    byId('run-button').disabled = running || !state.csrf;
    byId('new-customer').disabled = running;
    state.examples.forEach((example, index) => { byId(`example-${index + 1}`).disabled = running; });
    if (!running) byId('resume-polling').hidden = true;
}

function clearResult() {
    byId('results').hidden = true;
    state.markdown = '';
    byId('export-status').textContent = '';
}

function fillExample(index) {
    const example = state.examples[index];
    if (!example || state.running) return;
    const input = example.marketing_input;
    for (const [field, identifier] of [['product', 'product'], ['platform', 'platform'], ['audience', 'audience'], ['scenario', 'scenario'], ['raw_request', 'raw-request']]) byId(identifier).value = input[field] || '';
    byId('demo-pricing').checked = example.demo_pricing === true;
    byId('policy-summary').textContent = example.pricing_input ? JSON.stringify(example.pricing_input, null, 2) : '固定合成规则由服务端提供；本次结果将保留完整政策与计算过程。';
    byId('example-note').textContent = `已填合成示例：${example.label}。尚未提交；5台演算仅为假设，不代表客户真实需求。`;
    clearResult();
    status('示例已填充，可修改后运行。');
}

function clearCustomer() {
    if (state.running) return;
    for (const identifier of ['raw-request', 'audience', 'scenario']) byId(identifier).value = '';
    byId('demo-pricing').checked = false;
    byId('policy-summary').textContent = '新客户模式未启用合成报价；预算、采购数量不补造。';
    byId('example-note').textContent = '请输入虚构或脱敏客户信息；未知项保留空白。';
    clearResult();
    status('新客户已清空，请补充已知信息。');
}

function collectInput() {
    const input = { product: byId('product').value, platform: byId('platform').value };
    for (const [field, identifier] of [['audience', 'audience'], ['scenario', 'scenario'], ['raw_request', 'raw-request']]) {
        const value = byId(identifier).value.trim();
        if (value.length > 800) throw new Error('每个自由输入字段最多800字。');
        if (value) input[field] = value;
    }
    const request = { marketing_input: input, demo_pricing: byId('demo-pricing').checked };
    if (new TextEncoder().encode(JSON.stringify(request)).length > 4096) throw new Error('输入合计最多4096字节，请缩短描述。');
    return request;
}

async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    let data;
    try { data = await response.json(); } catch { throw new Error('服务未返回有效JSON，请稍后刷新。'); }
    if (!response.ok) throw new Error(`${data.error?.message || '请求失败'}（${data.error?.code || response.status}）`);
    return data;
}

async function startRun(event) {
    if (event) event.preventDefault();
    if (state.running || !state.csrf) return;
    let request;
    try { request = collectInput(); } catch (error) { status(error.message, true); return; }
    clearResult();
    state.startedAt = Date.now();
    setRunning(true);
    status('正在执行四步流程，请等待；不会自动联系客户。');
    try {
        const job = await api('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf }, body: JSON.stringify(request) });
        state.jobId = job.id;
        state.polling = true;
        await pollRun();
    } catch (error) { setRunning(false); status(`未完成提交：${error.message}。若会话失效，请刷新页面。`, true); }
}

async function pollRun() {
    if (!state.polling || !state.jobId) return;
    try {
        const job = await api(`/api/runs/${encodeURIComponent(state.jobId)}`);
        if (job.status === 'running') {
            status(`正在执行，已等待${Math.round((Date.now() - state.startedAt) / 1000)}秒。请勿重复提交。`);
            setTimeout(pollRun, 1000);
            return;
        }
        state.polling = false;
        setRunning(false);
        if (job.status === 'failed') { status(`执行失败：${job.error?.message || '未知错误'}。没有生成成功结果。`, true); return; }
        if (job.status !== 'completed' || !job.result) throw new Error('服务结果不完整');
        renderResult(job.result, job.markdown || '');
    } catch (error) {
        state.polling = false;
        byId('resume-polling').hidden = false;
        status(`查询暂停：${error.message}。后台可能仍在运行，请继续查询，避免重复提交。`, true);
    }
}

function money(cents) {
    if (!Number.isSafeInteger(cents)) return '待核实（null）';
    const amount = BigInt(cents);
    return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}元`;
}

function renderSources(result) {
    const seen = new Set();
    const walk = value => {
        if (!value || typeof value !== 'object') return;
        if (typeof value.url === 'string' || Array.isArray(value.urls)) {
            const key = JSON.stringify(value);
            if (!seen.has(key)) {
                seen.add(key);
                const item = card('sources', value.title || value.entry || '来源记录', value);
                for (const address of [...(value.url ? [value.url] : []), ...(Array.isArray(value.urls) ? value.urls : [])]) {
                    try {
                        const url = new URL(address);
                        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
                        const link = element('a', '打开来源页面');
                        link.href = url.href;
                        link.target = '_blank';
                        link.rel = 'noopener noreferrer';
                        item.append(link);
                    } catch { }
                }
            }
        }
        for (const child of Object.values(value)) walk(child);
    };
    walk(result.marketing_result?.knowledge_basis);
    walk(result.official_reference);
    if (!seen.size) card('sources', '没有可展示的官网来源记录', '请查看完整JSON；未把无来源文本当作核实资料。');
    card('sources', '正式图片来源', '当前正式图片0张；未核实的候选图不展示为产品图片。');
}

function renderResult(result, markdown) {
    for (const identifier of ['profile', 'clarifications', 'content', 'pricing', 'plan', 'actions', 'sources', 'diagnostics']) byId(identifier).replaceChildren();
    byId('engine-status').textContent = engineStatus(result.runtime_engine);
    const ready = result.status === 'demo_ready';
    status(ready ? '演示准备稿已生成，请核对来源、合成金额及待确认项。' : '流程返回了待确认或阻塞项，请先处理下方提示。', !ready);
    byId('result-summary').textContent = `业务状态：${statuses[result.status] || result.status}；用时${result.timing?.generation_elapsed_seconds ?? '未提供'}秒。\n${engineStatus(result.runtime_engine)}\n生成时间不代表现场30分钟演示已实测。`;
    for (const [name, field] of Object.entries(result.customer_analysis?.profile || {})) card('profile', labels[name] || name, `值：${readable(field.value)}\n状态：${statuses[field.status] || field.status}\n证据 / 原因：${readable(field.evidence?.length ? field.evidence : field.reason)}`);
    for (const question of result.customer_analysis?.clarification_questions || []) card('clarifications', '待确认', question);
    const content = result.content?.marketing_content;
    if (content) card('content', content.title || '内容准备稿', `${content.lead || ''}\n\n${content.body || ''}\n\n咨询引导：${content.cta || ''}`);
    else card('content', '未生成内容', '请补充必要输入；没有把空稿标为成功。');
    const pricing = result.pricing_result || {};
    card('pricing', `合成演算：${statuses[pricing.status] || pricing.status || '待核实'}`, `合成数量：${pricing.quantity ?? '待确认'}台\n合成单价：${money(pricing.unit_amount_cents)}\n合成总额：${money(pricing.amount_cents)}\n真实交易报价：null，非华为官方政策。`);
    for (const trace of pricing.trace || []) card('pricing', `第${trace.level}级合成规则`, trace);
    if (result.pricing_configuration) card('pricing', '配置与假设来源', result.pricing_configuration);
    for (const diagnostic of pricing.diagnostics || []) card('pricing', '报价诊断', diagnostic);
    if (result.solution?.demonstration_plan) card('plan', '0–30分钟演示准备方案（现场耗时待验证）', result.solution.demonstration_plan);
    for (const action of result.next_actions || []) card('actions', action.owner || '人工下一步', action);
    renderSources(result);
    if (result.official_reference) card('diagnostics', '官网参数与价格核验', result.official_reference);
    for (const value of [...(result.limitations || []), ...(result.diagnostics || []), ...(result.marketing_result?.diagnostics || [])]) card('diagnostics', '限制 / 诊断', value);
    state.markdown = markdown;
    byId('full-markdown').textContent = markdown;
    byId('download-json').href = `/api/runs/${encodeURIComponent(state.jobId)}/export?format=json`;
    byId('download-markdown').href = `/api/runs/${encodeURIComponent(state.jobId)}/export?format=markdown`;
    byId('results').hidden = false;
}

byId('growth-form').addEventListener('submit', startRun);
byId('new-customer').addEventListener('click', clearCustomer);
for (let index = 0; index < 3; index += 1) byId(`example-${index + 1}`).addEventListener('click', () => fillExample(index));
for (const identifier of ['raw-request', 'audience', 'product']) byId(identifier).addEventListener('input', () => {
    byId('demo-pricing').checked = false;
    byId('example-note').textContent = '客户描述或产品已变更，合成演算已关闭，避免继承示例假设。';
    byId('policy-summary').textContent = '旧示例配置预览已清除。如重新勾选，后端将按当前完整型号生成固定5台合成政策，以本次结果为准。';
    clearResult();
});
byId('resume-polling').addEventListener('click', () => { byId('resume-polling').hidden = true; state.polling = true; pollRun(); });
byId('copy-markdown').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(state.markdown); byId('export-status').textContent = '已复制含来源的完整Markdown。'; }
    catch { byId('export-status').textContent = '浏览器未允许复制，请下载Markdown，或从下方纯文本手动复制。'; }
});
for (const identifier of ['download-json', 'download-markdown']) byId(identifier).addEventListener('click', () => { byId('export-status').textContent = '已请求下载，请在浏览器下载列表确认；若会话过期请重新运行。'; });
document.addEventListener('keydown', event => {
    if (event.repeat || event.isComposing || event.keyCode === 229) return;
    if (event.altKey && !event.ctrlKey && !event.metaKey && ['1', '2', '3'].includes(event.key)) { event.preventDefault(); fillExample(Number(event.key) - 1); }
    if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === 'Enter') { event.preventDefault(); startRun(); }
});

async function initialize() {
    try {
        const response = await api('/api/examples');
        if (!response.csrf_token || !Array.isArray(response.examples)) throw new Error('初始化响应不完整');
        state.csrf = response.csrf_token;
        state.examples = response.examples.slice(0, 3);
        byId('engine-status').textContent = engineStatus(response.engine);
        state.examples.forEach((example, index) => { byId(`example-${index + 1}`).textContent = `${example.label} · Alt+${index + 1}`; });
        setRunning(false);
        if (state.examples.length) fillExample(0);
    } catch (error) { status(`服务初始化失败：${error.message}。请稍后刷新页面。`, true); }
}

initialize();
