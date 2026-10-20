'use strict';

const byId = identifier => document.getElementById(identifier);
const state = { examples: [], csrf: null, running: false, polling: false, jobId: null, markdown: '', startedAt: 0, sourceStatus: null, sourceLoading: false, sourceError: '', sourceTimer: null };
const statuses = { explicit: '明确输入', inferred: '推断，待核对', pending: '待确认', ready: '准备稿已生成', blocked: '已阻塞', needs_clarification: '需要澄清', calculated_demo: '合成演算完成', invalid_input: '输入无效', demo_ready: '演示准备就绪', needs_attention: '需要处理' };
const labels = { identity: '身份与角色', relationship: '新老客户关系', industry: '行业', company_size: '组织规模', needs: '核心需求', budget: '预算与数量', decision_chain: '决策链', preferences: '偏好', pain_points: '痛点', purchase_stage: '购买阶段', channels: '可触达渠道' };
const readable = value => value === null || value === undefined ? '待确认 / 无' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
const sourceProducts = ['HUAWEI MateBook 14 鸿蒙版', 'HUAWEI MateBook 14 2024'];
const sourceHosts = new Set(['consumer.huawei.com', 'www.vmall.com', 'vmall.com', 'm.vmall.com', 'item.vmall.com']);
const sourceWindow = 7 * 86400000;
const statusWindow = 5 * 60000;

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
    byId('run-button').disabled = running || !state.csrf || state.sourceLoading || !selectedSourceReady();
    byId('refresh-source-status').disabled = running || state.sourceLoading;
    byId('new-customer').disabled = running;
    state.examples.forEach((example, index) => { byId(`example-${index + 1}`).disabled = running; });
    if (!running) byId('resume-polling').hidden = true;
}

function selectedSource() {
    return state.sourceStatus?.products?.find(product => product.product === byId('product').value);
}

function sourceTime(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return NaN;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : NaN;
}

function sourceUrl(value) {
    if (typeof value !== 'string' || !/^https:\/\//i.test(value) || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && sourceHosts.has(url.hostname);
    } catch { return false; }
}

function checkedRecently(value) {
    const checked = sourceTime(value);
    return Number.isFinite(checked) && checked <= Date.now() + 60000 && Date.now() - checked <= statusWindow;
}

function validSourceProduct(product, checkedAt) {
    if (!product || Array.isArray(product) || !sourceProducts.includes(product.product) || !['ready', 'needs_update'].includes(product.status) || product.checked_at !== checkedAt || !checkedRecently(product.checked_at) || product.source_mode !== 'official_public_snapshot' || product.price_status !== 'unknown' || product.public_price_reference !== null || product.actual_transaction_quote !== false || product.formal_image_count !== 0 || !Array.isArray(product.sources) || !Number.isInteger(product.valid_source_count) || product.valid_source_count !== product.sources.length || !Array.isArray(product.diagnostics) || !product.diagnostics.every(item => item && typeof item.code === 'string' && typeof item.message === 'string')) return false;
    if (!product.sources.length) return product.status === 'needs_update' && product.oldest_fetched_at === null && product.expires_at === null;
    const checked = sourceTime(checkedAt);
    for (const source of product.sources) {
        if (!source || Array.isArray(source) || !sourceUrl(source.url)) return false;
        const fetched = sourceTime(source.fetched_at);
        const expires = sourceTime(source.expires_at);
        if (!Number.isFinite(fetched) || !Number.isFinite(expires) || fetched > checked || expires - fetched !== sourceWindow || expires < checked) return false;
    }
    const oldest = Math.min(...product.sources.map(source => sourceTime(source.fetched_at)));
    return sourceTime(product.oldest_fetched_at) === oldest && sourceTime(product.expires_at) === oldest + sourceWindow;
}

function sourceReady(product) {
    return validSourceProduct(product, state.sourceStatus?.checked_at) && product.status === 'ready' && product.sources.length > 0 && sourceTime(product.expires_at) > Date.now();
}

function selectedSourceReady() {
    return sourceReady(selectedSource());
}

function renderSourceStatus() {
    if (state.sourceTimer !== null) clearTimeout(state.sourceTimer);
    state.sourceTimer = null;
    byId('source-status-products').replaceChildren();
    const checked = state.sourceStatus?.checked_at || '尚未成功核验';
    const product = selectedSource();
    const ready = selectedSourceReady();
    byId('source-status-summary').textContent = state.sourceLoading ? '正在重新核验已有官网资料，请稍候……' : state.sourceError ? `资料状态未确认：${state.sourceError}。暂不能运行，请点击重新核验；若持续失败，请维护者检查服务和资料。` : `当前型号：${byId('product').value}；${ready ? '资料可用（ready）' : '需要更新或复核（needs_update），暂不能运行'}。\n最近核验：${checked}。真实价格：待核实（unknown / null）。`;
    for (const item of state.sourceStatus?.products || []) {
        const lines = [
            `规格状态：${sourceReady(item) ? '资料可用（ready）' : '需要更新或复核（needs_update）'}`,
            `核验时间：${item.checked_at || checked}`,
            `最早有效抓取时间：${item.oldest_fetched_at || '无有效来源，待更新'}`,
            `到期需复核时间：${item.expires_at || '无有效来源，待更新'}`,
            `有效来源：${item.valid_source_count ?? 0}条；真实价格：待核实（unknown / null）；真实交易报价未启用；正式图片0张。`,
            ...(item.sources || []).map(source => `来源：${source.url}\n抓取：${source.fetched_at}\n到期需复核：${source.expires_at}`),
            ...(item.diagnostics || []).map(diagnostic => `提示：${diagnostic.message}（${diagnostic.code}）`),
        ];
        card('source-status-products', item.product, lines.join('\n'));
    }
    if (ready) state.sourceTimer = setTimeout(() => { renderSourceStatus(); setRunning(state.running); }, Math.min(sourceTime(product.expires_at), sourceTime(product.checked_at) + statusWindow) - Date.now() + 1);
    setRunning(state.running);
}

async function refreshSourceStatus() {
    if (state.sourceLoading) return false;
    state.sourceLoading = true;
    state.sourceError = '';
    renderSourceStatus();
    try {
        const response = await api('/api/source-status');
        if (!response || !['ready', 'needs_update'].includes(response.status) || !checkedRecently(response.checked_at) || response.source_mode !== 'official_public_snapshot' || response.freshness_window_seconds !== sourceWindow / 1000 || response.price_status !== 'unknown' || response.public_price_reference !== null || response.formal_image_count !== 0 || !Array.isArray(response.products) || response.products.length !== sourceProducts.length || !sourceProducts.every(name => response.products.filter(product => product?.product === name).length === 1)) throw new Error('服务返回的资料状态不完整或核验时间已失效');
        const products = response.products.map(product => validSourceProduct(product, response.checked_at) ? product : {
            product: product.product, status: 'needs_update', checked_at: response.checked_at, source_mode: 'official_public_snapshot',
            oldest_fetched_at: null, expires_at: null, valid_source_count: 0, sources: [],
            price_status: 'unknown', public_price_reference: null, actual_transaction_quote: false, formal_image_count: 0,
            diagnostics: [{ code: 'SOURCE_STATUS_INVALID_RESPONSE', message: '该型号来源状态不完整或日期关系无效，未采用返回的来源与时间；请维护者检查后重新核验。' }],
        });
        state.sourceStatus = { ...response, products };
    } catch (error) {
        state.sourceStatus = null;
        state.sourceError = error.message;
    } finally {
        state.sourceLoading = false;
        renderSourceStatus();
    }
    return selectedSourceReady();
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
    renderSourceStatus();
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
    setRunning(true);
    status('正在重新核验当前型号的资料有效期……');
    try {
        if (!await refreshSourceStatus()) {
            setRunning(false);
            status('当前型号资料未就绪、已到期或暂时无法核验，未提交生成。请重新核验，或选择资料可用的型号；到期资料需维护者更新并验收。', true);
            return;
        }
        state.startedAt = Date.now();
        status('资料核验通过，正在执行四步流程；不会自动联系客户。');
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
    renderSourceStatus();
});
byId('refresh-source-status').addEventListener('click', async () => {
    if (state.running || state.sourceLoading) return;
    await refreshSourceStatus();
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
        await refreshSourceStatus();
    } catch (error) { status(`服务初始化失败：${error.message}。请稍后刷新页面。`, true); }
}

initialize();
