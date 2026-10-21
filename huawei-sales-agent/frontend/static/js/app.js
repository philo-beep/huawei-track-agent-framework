'use strict';

const byId = identifier => document.getElementById(identifier);
const state = { examples: [], matchExamples: [], csrf: null, running: false, polling: false, jobId: null, markdown: '', matchJobId: null, matchPolling: false, matchMarkdown: '', contentJobId: null, contentPolling: false, contentMarkdown: '', matchInput: null, startedAt: 0, sourceStatus: null, sourceLoading: false, sourceError: '', sourceTimer: null, capabilities: null };
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
    const modeNames = {
        cloud_model: '云端大模型受约束推理',
        cloud_model_with_rules_fallback: '云端模型调用 + 规则纠错回退',
        hybrid_rules: '规则引擎 + IMA 检索',
        hybrid_capable: '云端模型 / IMA / 联网能力可用',
        rules: '规则准备稿模式（未调用大模型）',
        qwen_cpu: '本地千问辅助模式'
    };
    const mode = modeNames[engine.mode] || `未确认模式：${engine.mode}`;
    return `${mode}\n模型：${engine.model || '未启用'}；状态：${engine.model_status || '未确认'}\nIMA：${engine.ima_enabled ? '可用' : '未启用'}；联网检索：${engine.web_research_enabled ? '可用' : '未启用'}\n${engine.notice || '最终内容需要人工审核。'}`;
}

function renderCapabilities(capabilities) {
    state.capabilities = capabilities || null;
    const mapping = [
        ['use-cloud-model', Boolean(capabilities?.cloud_model_configured), capabilities?.cloud_model_name ? `云端模型 ${capabilities.cloud_model_name}` : '云端模型'],
        ['use-ima', Boolean(capabilities?.ima_configured), capabilities?.ima_knowledge_base_name ? `IMA：${capabilities.ima_knowledge_base_name}` : 'IMA 知识库'],
        ['use-web-research', Boolean(capabilities?.web_research_configured), '联网检索'],
    ];
    const labels = [];
    for (const [identifier, enabled, label] of mapping) {
        const control = byId(identifier);
        control.disabled = !enabled;
        control.checked = enabled;
        labels.push(`${label}：${enabled ? '已配置，将在本次勾选时调用' : '未配置'}`);
    }
    byId('capability-status').textContent = labels.join('；');
    const matchCloud = byId('match-use-cloud-model');
    const matchIma = byId('match-use-ima');
    matchCloud.disabled = !capabilities?.cloud_model_configured;
    matchCloud.checked = Boolean(capabilities?.cloud_model_configured);
    matchIma.disabled = !capabilities?.ima_configured;
    matchIma.checked = Boolean(capabilities?.ima_configured);
    byId('match-capability-status').textContent = `云端模型：${capabilities?.cloud_model_configured ? '已配置' : '未配置'}；IMA：${capabilities?.ima_configured ? '已配置' : '未配置'}。未配置时不会伪造调用成功。`;
}

function setRunning(running) {
    state.running = running;
    byId('input-fields').disabled = running;
    byId('match-fields').disabled = running;
    byId('run-button').disabled = running || !state.csrf || state.sourceLoading || !selectedSourceReady();
    byId('match-button').disabled = running || !state.csrf;
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
    const request = { marketing_input: input, demo_pricing: byId('demo-pricing').checked, use_cloud_model: byId('use-cloud-model').checked, use_ima: byId('use-ima').checked, use_web_research: byId('use-web-research').checked };
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

function matchStatus(message, isError = false) {
    byId('match-status').textContent = message;
    byId('match-status').classList.toggle('error', isError);
}

function splitList(value) {
    return [...new Set(String(value || '').split(/[,，、\n]+/).map(item => item.trim()).filter(Boolean))].slice(0, 20);
}

function clearMatchResult() {
    byId('match-results').hidden = true;
    byId('match-candidates').replaceChildren();
    byId('match-diagnostics').replaceChildren();
    state.matchMarkdown = '';
    clearContentResult();
}

function fillMatchExample(index) {
    const example = state.matchExamples[index];
    if (!example || state.running) return;
    const input = example.input;
    const values = {
        'match-raw-request': input.profile.raw_request,
        'match-audience': input.profile.audience,
        'match-scenario': input.profile.scenario,
        'match-industry': input.profile.industry,
        'match-company-size': input.profile.company_size,
        'match-product-type': input.profile.product_type,
        'match-needs': (input.profile.needs || []).join('，'),
        'match-preferences': (input.profile.preferences || []).join('，'),
        'match-pain-points': (input.profile.pain_points || []).join('，'),
        'match-excluded': (input.profile.excluded_requirements || []).join('，'),
        'match-budget-min': input.profile.budget?.min,
        'match-budget-max': input.profile.budget?.max,
        'match-budget-scope': input.profile.budget?.scope || '',
        'match-quantity': input.profile.budget?.quantity,
    };
    for (const [identifier, value] of Object.entries(values)) byId(identifier).value = value === null || value === undefined ? '' : String(value);
    byId('match-use-cloud-model').checked = Boolean(input.use_cloud_model && state.capabilities?.cloud_model_configured);
    byId('match-use-ima').checked = Boolean((input.mode === 'ima' || input.mode === 'hybrid') && state.capabilities?.ima_configured);
    clearMatchResult();
    matchStatus(`已填充合成匹配示例：${example.label}。尚未提交。`);
}

function clearMatchCustomer() {
    if (state.running) return;
    byId('match-form').reset();
    renderCapabilities(state.capabilities || {});
    clearMatchResult();
    matchStatus('匹配条件已清空，请只输入脱敏或虚构客户信息。');
}

function collectMatchInput() {
    const raw = byId('match-raw-request').value.trim();
    if (!raw) throw new Error('请先填写客户原话或需求描述。');
    if (raw.length > 1600) throw new Error('客户原话最多1600字。');
    const optional = value => value.trim() || null;
    const integer = value => value === '' ? null : Number(value);
    const companySize = integer(byId('match-company-size').value);
    if (companySize !== null && (!Number.isInteger(companySize) || companySize < 1)) throw new Error('组织人数必须为正整数。');
    const min = byId('match-budget-min').value === '' ? null : Number(byId('match-budget-min').value);
    const max = byId('match-budget-max').value === '' ? null : Number(byId('match-budget-max').value);
    const quantity = integer(byId('match-quantity').value);
    const hasBudget = [min, max, quantity].some(value => value !== null);
    if ([min, max].some(value => value !== null && (!Number.isFinite(value) || value < 0))) throw new Error('预算金额必须为非负数。');
    if (min !== null && max !== null && min > max) throw new Error('最低预算不能高于最高预算。');
    if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1)) throw new Error('采购数量必须为正整数。');
    const useIma = byId('match-use-ima').checked;
    const request = {
        schema_version: '1.0',
        mode: useIma ? 'hybrid' : 'local',
        use_cloud_model: byId('match-use-cloud-model').checked,
        profile: {
            raw_request: raw,
            audience: optional(byId('match-audience').value),
            scenario: optional(byId('match-scenario').value),
            industry: optional(byId('match-industry').value),
            company_size: companySize,
            product_type: optional(byId('match-product-type').value),
            needs: splitList(byId('match-needs').value),
            preferences: splitList(byId('match-preferences').value),
            pain_points: splitList(byId('match-pain-points').value),
            excluded_requirements: splitList(byId('match-excluded').value),
            budget: hasBudget ? { min, max, currency: 'CNY', scope: byId('match-budget-scope').value || null, quantity } : null,
        },
    };
    if (new TextEncoder().encode(JSON.stringify(request)).length > 16384) throw new Error('产品匹配输入最多16384字节，请缩短描述。');
    return request;
}

async function startProductMatch(event) {
    if (event) event.preventDefault();
    if (state.running || !state.csrf) return;
    let request;
    try { request = collectMatchInput(); } catch (error) { matchStatus(error.message, true); return; }
    state.matchInput = request;
    clearMatchResult();
    setRunning(true);
    state.startedAt = Date.now();
    matchStatus('正在召回候选并核验证据；云端模型不可用时会如实回退规则理由。');
    try {
        const job = await api('/api/product-matches', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf }, body: JSON.stringify(request) });
        state.matchJobId = job.id;
        state.matchPolling = true;
        await pollProductMatch();
    } catch (error) { setRunning(false); matchStatus(`产品匹配未完成：${error.message}。`, true); }
}

async function pollProductMatch() {
    if (!state.matchPolling || !state.matchJobId) return;
    try {
        const job = await api(`/api/runs/${encodeURIComponent(state.matchJobId)}`);
        if (job.status === 'running') {
            matchStatus(`产品匹配正在执行，已等待${Math.round((Date.now() - state.startedAt) / 1000)}秒。`);
            setTimeout(pollProductMatch, 1000);
            return;
        }
        state.matchPolling = false;
        setRunning(false);
        if (job.status === 'failed') { matchStatus(`产品匹配失败：${job.error?.message || '未知错误'}。`, true); return; }
        if (job.status !== 'completed' || !job.result) throw new Error('服务结果不完整');
        renderProductMatchResult(job.result, job.markdown || '');
    } catch (error) {
        state.matchPolling = false;
        setRunning(false);
        matchStatus(`产品匹配查询暂停：${error.message}。请勿重复提交，可刷新后重试。`, true);
    }
}

function contentStatus(message, isError = false) {
    byId('content-status').textContent = message;
    byId('content-status').classList.toggle('error', isError);
}

function clearContentResult() {
    byId('content-draft-results').hidden = true;
    byId('content-verification-summary').replaceChildren();
    byId('content-verification-items').replaceChildren();
    byId('content-risk-items').replaceChildren();
    byId('content-safe-version').replaceChildren();
    byId('content-draft').replaceChildren();
    byId('content-image-sources').replaceChildren();
    byId('content-insertion-plan').replaceChildren();
    byId('content-markdown').textContent = '';
    state.contentJobId = null;
    state.contentPolling = false;
    state.contentMarkdown = '';
    contentStatus('选择候选后可生成公众号图文草稿；不会自动发布。');
}

async function startContentDraft(candidateId) {
    if (state.running || !state.csrf) return;
    if (!state.matchInput) { contentStatus('请先完成一次产品匹配，再生成图文。', true); return; }
    clearContentResult();
    setRunning(true);
    state.startedAt = Date.now();
    contentStatus('正在重新核验候选、事实原文与精确型号图片，不会使用近似型号替代。');
    try {
        const payload = { schema_version: '1.0', match_input: state.matchInput, candidate_id: candidateId, platform: '公众号', image_limit: 4 };
        const job = await api('/api/content-drafts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf }, body: JSON.stringify(payload) });
        state.contentJobId = job.id;
        state.contentPolling = true;
        await pollContentDraft();
    } catch (error) {
        setRunning(false);
        contentStatus(`图文生成未完成：${error.message}。`, true);
    }
}

async function pollContentDraft() {
    if (!state.contentPolling || !state.contentJobId) return;
    try {
        const job = await api(`/api/runs/${encodeURIComponent(state.contentJobId)}`);
        if (job.status === 'running') {
            contentStatus(`正在生成图文，已等待${Math.round((Date.now() - state.startedAt) / 1000)}秒。`);
            setTimeout(pollContentDraft, 1000);
            return;
        }
        state.contentPolling = false;
        setRunning(false);
        if (job.status === 'failed') { contentStatus(`图文生成失败：${job.error?.message || '未知错误'}。`, true); return; }
        if (job.status !== 'completed' || !job.result) throw new Error('服务结果不完整');
        renderContentDraftResult(job.result, job.markdown || '');
    } catch (error) {
        state.contentPolling = false;
        setRunning(false);
        contentStatus(`图文查询暂停：${error.message}。请勿重复提交，可刷新后重试。`, true);
    }
}

function safeSourceLink(value, label) {
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        const link = element('a', label); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
    } catch { return null; }
}

function verificationBadge(status, label) {
    const badge = element('span', label);
    badge.className = `verification-badge ${status}`;
    return badge;
}

function renderVerificationResult(verification) {
    const overallClass = verification.overall_status === 'blocked' ? 'fail' : verification.overall_status === 'downgraded' ? 'downgrade' : 'pass';
    const summary = element('div'); summary.className = 'verification-summary';
    const heading = element('div'); heading.className = 'verification-heading';
    heading.append(element('strong', '发布门禁结论'), verificationBadge(overallClass, verification.status_label));
    summary.append(heading);
    summary.append(element('p', `六项核验：通过 ${verification.summary.pass_count}｜降级 ${verification.summary.downgrade_count}｜不通过 ${verification.summary.fail_count}`));
    summary.append(element('p', `原稿公开发布就绪：${verification.publication_ready ? '是' : '否'}；可发布安全版本：${verification.safe_content_ready ? '可用' : '不可用'}。`));
    summary.append(element('p', `策略版本：${verification.policy_version}；核验时间：${verification.checked_at}`));
    byId('content-verification-summary').append(summary);

    const itemList = element('div'); itemList.className = 'verification-item-list';
    for (const item of verification.items) {
        const card = element('article'); card.className = 'verification-item';
        const head = element('div'); head.className = 'verification-heading';
        head.append(element('strong', item.label), verificationBadge(item.status, item.status_label));
        card.append(head, element('p', item.summary));
        const itemDetails = item.details || [];
        if (itemDetails.length) {
            const details = element('ul');
            for (const detail of itemDetails) details.append(element('li', detail));
            card.append(details);
        }
        itemList.append(card);
    }
    byId('content-verification-items').append(itemList);

    if (!verification.risk_items.length) {
        byId('content-risk-items').append(element('p', '未发现需要阻塞或降级的风险项。', ''));
    } else {
        const riskList = element('div'); riskList.className = 'verification-risk-list';
        for (const risk of verification.risk_items) {
            const card = element('article'); card.className = `verification-risk ${risk.risk_level}`;
            const head = element('div'); head.className = 'verification-heading';
            head.append(element('strong', risk.title), verificationBadge(risk.risk_level === 'blocking' ? 'fail' : 'downgrade', risk.risk_level_label));
            card.append(head, element('p', `问题：${risk.issue}`), element('p', `处理建议：${risk.recommendation}`));
            const affected = risk.affected || [];
            if (affected.length) card.append(element('p', `影响项：${affected.join('、')}`));
            riskList.append(card);
        }
        byId('content-risk-items').append(riskList);
    }

    const safe = verification.safe_content;
    if (safe.ready && safe.content) {
        const article = element('article'); article.className = 'content-safe-copy';
        article.append(element('h4', safe.content.title), element('p', safe.content.lead));
        const body = element('pre', safe.content.body_markdown); body.className = 'content-body';
        article.append(body, element('strong', '行动引导'), element('p', safe.content.cta));
        const imageIds = safe.content.image_ids || [];
        article.append(element('p', `本版本纳入图片：${imageIds.length ? imageIds.join('、') : '无（图片已作为降级项移除）'}`));
        if (safe.disclosures.length) {
            const disclosure = element('div'); disclosure.className = 'verification-disclosures';
            disclosure.append(element('strong', '降级说明'));
            const list = element('ul');
            for (const item of safe.disclosures) list.append(element('li', item));
            disclosure.append(list); article.append(disclosure);
        }
        byId('content-safe-version').append(article);
    } else {
        const blocked = element('p', '当前没有可发布版本。请按风险项清单完成修复并重新核验。', '');
        blocked.className = 'error';
        byId('content-safe-version').append(blocked);
    }
}

function renderContentDraftResult(result, markdown) {
    renderVerificationResult(result.verification);
    byId('content-draft').replaceChildren();
    byId('content-image-sources').replaceChildren();
    byId('content-insertion-plan').replaceChildren();
    byId('content-summary').textContent = `强制核验：${result.verification.status_label}；可发布安全版本：${result.verification.safe_content_ready ? '可用' : '不可用'}；产品：${result.product.resolved_name}；原稿图片：${result.image_sources.length}张；事实引用：${result.citations.length}条。原稿、图片和完整 Markdown 仅用于审稿。`;
    const article = element('article'); article.className = 'content-draft-copy';
    article.append(element('h3', result.draft.title), element('p', result.draft.lead));
    const body = element('pre', result.draft.body_markdown); body.className = 'content-body';
    article.append(body, element('strong', '行动引导'), element('p', result.draft.cta));
    article.append(element('p', `标签：${result.draft.tags.join('、')}`));
    byId('content-draft').append(article);

    if (!result.image_sources.length) byId('content-image-sources').append(element('p', '原稿未纳入图片；未使用其他型号或未核验候选图替代。'));
    const imageGrid = element('div'); imageGrid.className = 'content-image-grid';
    for (const image of result.image_sources) {
        const figure = element('figure'); figure.className = 'content-image-card';
        const picture = element('img'); picture.src = image.asset_url; picture.alt = image.caption; picture.loading = 'lazy';
        const caption = element('figcaption');
        caption.append(element('strong', image.caption), element('span', `型号匹配：${image.model_match_status}；发布状态：${image.rights_status}`));
        const original = safeSourceLink(image.original_url, '打开原图来源'); if (original) caption.append(original);
        figure.append(picture, caption); imageGrid.append(figure);
    }
    byId('content-image-sources').append(imageGrid);
    const sourceList = element('div'); sourceList.className = 'content-source-list';
    for (const image of result.image_sources) {
        const item = element('details'); item.className = 'content-source-item';
        item.append(element('summary', `${image.image_id}｜${image.file_name}`));
        item.append(element('p', `说明：${image.caption}`), element('p', `IMA 条目：${image.ima_entry}`), element('p', `IMA 知识库：${image.ima_kb_name}｜KB ID：${image.ima_kb_id}｜检索请求：${image.ima_search_request_ids.join('、')}`), element('p', `来源：${image.source_name}`));
        const original = safeSourceLink(image.original_url, '原始图片 URL'); if (original) item.append(original);
        const page = image.page_url ? safeSourceLink(image.page_url, '产品页面') : null; if (page) item.append(page);
        item.append(element('p', `SHA-256：${image.sha256}`), element('p', `核验状态：${image.model_match_status}｜${image.visual_review_status}｜${image.rights_status}`));
        sourceList.append(item);
    }
    byId('content-image-sources').append(sourceList);

    if (!result.insertion_plan.length) {
        byId('content-insertion-plan').append(element('p', '无可建议的图片插入位置。'));
    } else {
        const plan = element('ol');
        for (const item of result.insertion_plan) plan.append(element('li', `${item.position}｜${item.instruction}｜${item.caption}（${item.image_id}）`));
        byId('content-insertion-plan').append(plan);
    }
    byId('content-markdown').textContent = markdown;
    state.contentMarkdown = markdown;
    byId('content-download-json').href = `/api/runs/${encodeURIComponent(state.contentJobId)}/export?format=json`;
    byId('content-download-markdown').href = `/api/runs/${encodeURIComponent(state.contentJobId)}/export?format=markdown`;
    byId('content-draft-results').hidden = false;
    contentStatus(`强制核验完成：${result.verification.status_label}。${result.verification.safe_content_ready ? '可发布安全版本已生成，请仍由发布责任人做最终确认。' : '当前版本被阻塞，请先处理风险项。'}`);
}
function appendMatchText(container, label, values) {
    const title = element('strong', label);
    container.append(title);
    const list = element('ul');
    for (const value of values.length ? values : ['无']) list.append(element('li', typeof value === 'string' ? value : JSON.stringify(value)));
    container.append(list);
}

function renderProductMatchResult(result, markdown) {
    byId('match-candidates').replaceChildren();
    byId('match-diagnostics').replaceChildren();
    const modelStatus = result.provenance?.model?.status || '未确认';
    byId('match-summary').textContent = `匹配状态：${result.status}；候选${result.verification.candidate_count}项；推荐${result.verification.recommended_count}项；【待确认】${result.verification.pending_count}项。\n请求模式：${result.provenance.requested_mode}；实际模式：${result.provenance.effective_mode}；模型：${modelStatus}${result.provenance.model?.name ? `（${result.provenance.model.name}）` : ''}。\n注册表：${result.provenance.registry_version || '未加载'}；结构化事实：${result.provenance.product_fact_count}条；当前成交报价：${result.provenance.current_quote_count}条。\n匹配分数只用于排序，不是匹配概率或成交概率。`;
    const criteria = element('div', `匹配条件：${result.criteria.map(item => `${item.kind}=${typeof item.value === 'object' ? JSON.stringify(item.value) : item.value}`).join('；') || '待确认'}`);
    criteria.className = 'notice';
    byId('match-candidates').append(criteria);
    for (const candidate of result.candidates) {
        const article = element('article');
        article.className = `result-card match-card ${candidate.status}`;
        const heading = element('div'); heading.className = 'match-heading';
        const evidenceLabel = candidate.evidence_status === 'verified_fact_partial' ? '部分E1事实' : candidate.evidence_status === 'discovery_only' ? '仅目录发现' : candidate.evidence_status || '证据待确认';
        heading.append(element('strong', `${candidate.status_label}｜${candidate.product_name}`), element('span', `${candidate.category}${candidate.operating_system ? ` · ${candidate.operating_system}` : ''} · ${evidenceLabel} · 排序分 ${candidate.match_score}`));
        const badge = element('span', candidate.status_label); badge.className = 'status-badge'; heading.append(badge);
        article.append(heading);
        appendMatchText(article, '匹配理由', candidate.matching_reasons.map(reason => `${reason.text}（引文：${reason.cited_span || '未提供'}；证据：${reason.evidence_ids.join('、')}；来源：${reason.origin}）`));
        appendMatchText(article, '逐条件覆盖', (candidate.criteria_coverage || []).map(item => `${item.kind}：${item.status}｜${item.note}`));
        appendMatchText(article, '限制', candidate.limitations);
        appendMatchText(article, '缺失信息', candidate.missing_information);
        const evidenceTitle = element('strong', '核心证据');
        const evidenceList = element('ul'); evidenceList.className = 'match-evidence';
        const renderEvidenceItems = (target, items) => {
            for (const evidence of items) {
                const item = element('li', `${evidence.evidence_id}｜${evidence.source_level}｜${evidence.title}｜${evidence.locator}`);
                const excerpt = element('div', evidence.excerpt.slice(0, 500)); excerpt.className = 'notice';
                item.append(excerpt);
                if (evidence.url) {
                    try {
                        const url = new URL(evidence.url);
                        if (['http:', 'https:'].includes(url.protocol)) {
                            const link = element('a', '打开来源页面'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; item.append(link);
                        }
                    } catch { }
                }
                target.append(item);
            }
        };
        const evidence = candidate.evidence || [];
        renderEvidenceItems(evidenceList, evidence.slice(0, 5));
        article.append(evidenceTitle, evidenceList);
        if (evidence.length > 5) {
            const details = element('details');
            details.append(element('summary', `查看其余 ${evidence.length - 5} 条证据`));
            const restList = element('ul'); restList.className = 'match-evidence';
            renderEvidenceItems(restList, evidence.slice(5));
            details.append(restList);
            article.append(details);
        }
        const actions = element('div'); actions.className = 'match-actions';
        if (sourceProducts.includes(candidate.product_name)) {
            const use = element('button', '用此候选进入四步流程'); use.type = 'button'; use.className = 'match-use-candidate';
            use.addEventListener('click', () => { byId('product').value = candidate.product_name; renderSourceStatus(); status('已将候选带入四步流程；仍需重新核验资料并手动运行。'); byId('input-fields').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
            actions.append(use);
        }
        const content = element('button', '生成公众号图文'); content.type = 'button'; content.className = 'content-generate-candidate';
        content.title = '重新核验候选、事实原文和精确型号 IMA 图片后生成可审稿图文';
        content.addEventListener('click', () => startContentDraft(candidate.candidate_id));
        actions.append(content);
        article.append(actions);
        byId('match-candidates').append(article);
    }
    if (!result.candidates.length) byId('match-candidates').append(element('p', '未取得候选，未使用模型常识补造产品。'));
    for (const diagnostic of result.diagnostics || []) card('match-diagnostics', diagnostic.code || '诊断', diagnostic.message || diagnostic);
    if (!result.diagnostics?.length) card('match-diagnostics', '诊断', '无额外诊断；仍须人工复核 SKU、价格和兼容性。');
    state.matchMarkdown = markdown;
    byId('match-download-json').href = `/api/runs/${encodeURIComponent(state.matchJobId)}/export?format=json`;
    byId('match-download-markdown').href = `/api/runs/${encodeURIComponent(state.matchJobId)}/export?format=markdown`;
    byId('match-results').hidden = false;
    matchStatus('产品匹配结果已生成；请检查【待确认】项、限制和证据，不要仅依据排序分决策。', result.verification.recommended_count === 0);
}

byId('growth-form').addEventListener('submit', startRun);
byId('match-form').addEventListener('submit', startProductMatch);
byId('match-clear').addEventListener('click', clearMatchCustomer);
for (let index = 0; index < 2; index += 1) byId(`match-example-${index + 1}`).addEventListener('click', () => fillMatchExample(index));
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
        state.matchExamples = Array.isArray(response.match_examples) ? response.match_examples.slice(0, 2) : [];
        byId('engine-status').textContent = engineStatus(response.engine);
        renderCapabilities(response.capabilities || {});
        state.examples.forEach((example, index) => { byId(`example-${index + 1}`).textContent = `${example.label} · Alt+${index + 1}`; });
        state.matchExamples.forEach((example, index) => { byId(`match-example-${index + 1}`).textContent = example.label; });
        setRunning(false);
        if (state.examples.length) fillExample(0);
        if (state.matchExamples.length) fillMatchExample(0);
        await refreshSourceStatus();
    } catch (error) { status(`服务初始化失败：${error.message}。请稍后刷新页面。`, true); }
}

initialize();
