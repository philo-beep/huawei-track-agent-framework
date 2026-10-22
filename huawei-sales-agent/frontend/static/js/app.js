'use strict';

const byId = identifier => document.getElementById(identifier);
const state = { examples: [], matchExamples: [], csrf: null, access: { canRun: false, user: null }, running: false, polling: false, jobId: null, markdown: '', matchJobId: null, matchPolling: false, matchMarkdown: '', contentJobId: null, contentPolling: false, contentMarkdown: '', contentResult: null, contentHistory: [], contentPlatform: '公众号', matchInput: null, startedAt: 0, sourceStatus: null, sourceLoading: false, sourceError: '', sourceTimer: null, capabilities: null, wizardStep: 1, profileMessages: [], profileTurn: 0, profileMax: 8, profileJobId: null, profilePolling: false, profileResult: null, profileStarted: false, profileQuestion: null, copyFeedbackTimer: null };
const statuses = { explicit: '客户明确说明', inferred: '推断，待核对', pending: '待确认', ready: '准备稿已生成', blocked: '需先处理', needs_clarification: '需要补充信息', calculated_demo: '演示测算完成', demo_ready: '销售准备稿已生成', needs_attention: '需要确认', partial: '部分完成', failed: '未完成', missing_basis: '缺少价格依据', basis_sufficient: '依据齐全', cannot_determine: '暂时无法判断', not_provided: '客户未提供', not_evaluated: '尚未判断', not_executed: '尚未执行', pending_assignment: '待指定负责人', pending_confirmation: '待确认', preparation_only: '仅作准备', programmatic_constrained_preparation: '按已核对资料准备', invalid_input: '填写内容需调整' };
const labels = { identity: '客户角色', relationship: '新老客户关系', industry: '客户行业', company_size: '组织规模', needs: '核心需求', budget: '预算与数量', decision_chain: '决策参与人', preferences: '客户偏好', pain_points: '当前痛点', purchase_stage: '采购阶段', channels: '可联系渠道' };
const profileDimensionLabels = { identity: '客户角色', industry: '客户行业', usage_scenario: '使用场景', needs: '客户需求', pain_points: '客户痛点', purchase_stage: '采购阶段', budget: '客户预算', conversation_habit: '沟通偏好', platform_knowledge: '方案了解程度', preferences: '客户偏好' };
const criterionLabels = { product_type: '产品类型', scenario: '使用场景', need: '明确需求', preference: '客户偏好', pain_point: '待确认问题', budget: '预算', quantity: '采购数量', industry: '客户行业', company_size: '组织规模' };
const coverageLabels = { supported: '资料支持', pending: '仍需确认', unsupported: '资料不支持', conflict: '信息有冲突', missing: '暂无资料', not_applicable: '不适用' };
const evidenceLevelLabels = { E1: '产品资料原文', E2: '产品目录', E3: '资料摘要', E4: '客户填写信息' };
const specLabels = { display_resolution: '屏幕分辨率', memory_options: '内存选项', storage_options: '存储选项', processor: '处理器', operating_system: '操作系统', battery: '电池', weight: '重量', size_and_weight: '尺寸与重量' };
const wizardMeta = {
    1: { title: '客户画像', count: '第 1 步 / 共 4 步', description: '每次只问一个问题，逐步了解客户角色、场景、需求与采购阶段。', short: '画像' },
    2: { title: '产品匹配', count: '第 2 步 / 共 4 步', description: '按客户需求查找候选型号，并说明推荐理由、使用限制和资料依据。', short: '选品' },
    3: { title: '内容准备', count: '第 3 步 / 共 4 步', description: '把候选型号变成公众号、小红书或朋友圈的内容准备稿。', short: '内容' },
    4: { title: '报价与成交', count: '第 4 步 / 共 4 步', description: '整理演示价格、客户演示方案和下一步销售动作。', short: '成交' },
};

const formatDate = value => {
    if (!value) return '待确认';
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return plainText(value);
    return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(parsed);
};
const listText = (values, fallback = '待确认') => {
    const items = Array.isArray(values) ? values.filter(value => value !== null && value !== undefined && value !== '') : [];
    return items.length ? items.map(value => readable(value)).join('、') : fallback;
};
const money = cents => {
    if (!Number.isSafeInteger(cents)) return '待确认';
    const amount = BigInt(cents);
    return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}元`;
};
const statusLabel = status => statuses[status] || plainText(status || '待确认');
const criterionLabel = kind => criterionLabels[kind] || plainText(String(kind || '其他条件').replaceAll('_', ' '));
const coverageLabel = status => coverageLabels[status] || plainText(status || '待确认');
const evidenceLevelLabel = level => evidenceLevelLabels[level] || '资料';
function plainText(value) {
    return String(value ?? '')
        .replace(/deepseek[^\s；,，。]*/gi, '智能分析服务')
        .replace(/云端(?:大)?模型/g, '智能分析')
        .replace(/联网(?:实时)?检索/g, '公开资料查询')
        .replace(/规则画像/g, '客户画像')
        .replace(/密钥/g, '系统密码')
        .replace(/合成政策/g, '演示价格规则')
        .replace(/销售销售配置/g, '销售配置')
        .replace(/产品资料库\s*知识库/g, '产品资料库')
        .replace(/销售\s+销售配置/g, '销售配置')
        .replace(/模型常识/g, '未经核对的信息')
        .replace(/规则引擎/g, '既定销售规则')
        .replace(/模型/g, '智能分析')
        .replace(/产品事实/g, '产品资料')
        .replace(/事实来源/g, '资料来源')
        .replace(/事实/g, '资料')
        .replace(/合成/g, '演示')
        .replace(/\bIMA(?:\s+OpenAPI)?\b/gi, '产品资料库')
        .replace(/\bOpenAPI\b/gi, '资料服务')
        .replace(/\bJSON\b/gi, '数据文件')
        .replace(/\bMarkdown\b/gi, '说明文档')
        .replace(/\bHTTP\b/gi, '网络服务')
        .replace(/\bAPI\b/gi, '服务')
        .replace(/\bSKU\b/gi, '销售配置')
        .replace(/字段/g, '信息')
        .replace(/\bCTA\b/gi, '下一步沟通')
        .replace(/资格键/g, '适用条件')
        .replace(/公开价格快照/g, '公开价格参考')
        .replace(/检索线索/g, '资料线索')
        .replace(/命中/g, '找到')
        .replace(/\bofficial-\d+-[a-f0-9]+\b/gi, '相关产品资料')
        .replace(/\b(?:profile|ev|fact)-[a-f0-9]+\b/gi, '资料依据')
        .replace(/\bSHA-?256\b/gi, '资料核对信息')
        .replace(/\bID\b/g, '编号')
        .replace(/\bnull\b/gi, '待确认')
        .replace(/\bready\b/gi, '可参考')
        .replace(/\bneeds_update\b/gi, '需更新')
        .replace(/\bunknown\b/gi, '待确认')
        .replace(/\bcalled(?:_with_fallback)?\b/gi, '已使用')
        .replace(/\bconfigured\b/gi, '已就绪')
        .replace(/\bE[1-4]事实\b/g, '产品资料')
        .replace(/\bE[1-4]\b/g, '资料')
        .replace(/降级/g, '需要调整')
        .replace(/阻塞/g, '需先处理')
        .replace(/产品资料库\s*知识库/g, '产品资料库')
        .replace(/销售\s*销售配置/g, '销售配置')
        .replace(/事实\s*编号/g, '资料依据')
        .replace(/四级报价规则/g, '四级价格规则')
        .replace(/\bURL\b/gi, '公开链接')
        .replace(/内容指纹/g, '资料核对信息')
        .replace(/参数事实/g, '参数资料')
        .replace(/资料证据/g, '资料依据')
        .replace(/证据/g, '依据')
        .replace(/产品资料库\s*产品资料/g, '产品资料库')
        .replace(/产品资料库[^｜\n]*镜像条目/g, '产品资料库')
        .replace(/完整\s+销售配置/g, '完整销售配置')
        .replace(/销售配置\s+缺口/g, '销售配置缺口')
        .replace(/\s+与公开资料查询/g, '与公开资料查询')
        .replace(/客户画像(?:字段|信息)\s+[a-z][a-z0-9_]*：/gi, '客户填写：')
        .replace(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/gi, '相关信息')
        .replace(/\s*[(（][A-Z][A-Z0-9_]{2,}[)）]\s*/g, '')
        .trim();
}
function cleanProse(value) {
    return String(value || '').split(/\n{2,}/)
        .filter(chunk => !/^\s*<!--\s*IMAGE:/i.test(chunk) && !/^\s*>\s*\*\*配图/i.test(chunk))
        .map(chunk => plainText(chunk).replace(/^来源定位：.*$/gmi, '').trim())
        .filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n');
}
function readable(value) {
    if (value === null || value === undefined || value === '') return '待确认';
    if (Array.isArray(value)) return value.length ? value.map(item => readable(item)).join('、') : '无';
    if (typeof value === 'object') {
        if (Number.isFinite(value.min) || Number.isFinite(value.max)) {
            const range = Number.isFinite(value.min) && Number.isFinite(value.max) ? `${value.min} 至 ${value.max}` : Number.isFinite(value.max) ? `不超过 ${value.max}` : `不低于 ${value.min}`;
            return `${range}${value.currency ? ` ${value.currency}` : ''}${value.scope ? `，按${value.scope}` : ''}${Number.isFinite(value.quantity) ? `，${value.quantity} 台` : ''}`;
        }
        if (value.label) return plainText(value.label);
        const entries = Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== '');
        return entries.length ? entries.map(([key, item]) => `${labels[key] || criterionLabels[key] || plainText(key.replaceAll('_', ' '))}：${readable(item)}`).join('；') : '待确认';
    }
    return plainText(value);
}
const diagnosticText = value => {
    const code = typeof value === 'string' ? value : value?.code;
    const messages = {
        IMA_REQUEST_FAILED: '产品资料库暂时没有返回有效内容，本次没有把缺失资料当作结论，请联系维护人员检查后重试。',
        MATCH_MODEL_REASONS_VERIFIED: '推荐理由已逐条对照产品资料，缺少依据的内容已剔除。',
        MATCH_PENDING_REVIEW: '已找到可能适合的型号，但价格、软件兼容或具体配置仍需确认，暂不标记为可直接推荐。',
        OFFICIAL_PRICE_UNKNOWN: '尚未取得可核对的正式报价，金额保持待确认。',
        OFFICIAL_FETCH_UNVERIFIED: '本次未能确认华为公开页面，暂不使用未核实的公开信息作为结论。',
        PRICE_RULES_MISSING: '缺少正式价格规则，因此不输出成交金额。',
        IMAGE_EVIDENCE_INCOMPLETE: '当前没有完成发布授权的正式图片，内容只按文字版本准备。',
        CLOUD_MODEL_USED: '本次已使用智能分析整理建议，产品资料仍按已核对内容写入。',
        RULE_PREPARATION_USED: '本次按既定销售规则准备内容，未使用智能分析生成建议。',
        HUMAN_REVIEW_REQUIRED: '系统结果不能代替销售或发布负责人的最终确认。',
        RELEASE_DOWNGRADED: '发布前检查发现可处理的问题，已生成更稳妥的版本。',
        VERIFICATION_DOWNGRADE: '部分图片或表述未满足发布要求，已从可发布版本中移除。'
    };
    if (messages[code]) return messages[code];
    return plainText(typeof value === 'string' ? value : value?.message || '需要进一步确认。');
};
const profileDimensionIds = Object.keys(profileDimensionLabels);
const demoBundle = JSON.parse(byId('demo-presets').textContent);
const demoReplay = { active: false, scenario: null, round: 0, phase: 'idle', paused: false, timer: null, urls: [], confirmed: [], saveNote: '' };
const demoStorageKey = 'huawei.demo.confirmed.v1';

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

async function copyPlainText(value) {
    const text = String(value || '');
    if (!text) throw new Error('没有可复制的内容');
    if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const helper = element('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    helper.style.pointerEvents = 'none';
    document.body.append(helper);
    helper.select();
    helper.setSelectionRange(0, helper.value.length);
    const copied = document.execCommand('copy');
    helper.remove();
    if (!copied) throw new Error('浏览器未允许自动复制');
}

function showCopyFeedback(message, isError = false) {
    const feedback = byId('content-copy-feedback');
    if (!feedback) return;
    clearTimeout(state.copyFeedbackTimer);
    feedback.textContent = message;
    feedback.classList.toggle('error', isError);
    state.copyFeedbackTimer = setTimeout(() => { feedback.textContent = ''; feedback.classList.remove('error'); }, 4200);
}

function bindCopyButton(button, value, label) {
    button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        const previous = button.textContent;
        try {
            await copyPlainText(value);
            button.textContent = '已复制';
            showCopyFeedback(`已复制${label}，可以直接粘贴。`);
        } catch (error) {
            button.textContent = '请手动复制';
            showCopyFeedback(`${label}未能自动复制：${plainText(error.message)}。请选中预览文字手动复制。`, true);
        } finally {
            setTimeout(() => { button.disabled = false; button.textContent = previous; }, 1600);
        }
    });
    return button;
}

function card(identifier, title, value) {
    const item = element('div');
    item.className = 'result-card';
    item.append(element('strong', title), element('p', readable(value)));
    byId(identifier).append(item);
    return item;
}

function engineStatus(engine) {
    if (engine?.mode === 'preset') return '预置样例回放 · 未调用模型、资料库或联网查询。产品资料为录制时快照，最终结论仍需人工确认。';
    const features = [];
    if (engine && (engine.mode?.includes('cloud') || engine.model_status !== 'disabled')) features.push('智能分析');
    if (engine?.ima_enabled) features.push('产品资料查询');
    if (engine?.web_research_enabled) features.push('公开资料查询');
    const summary = features.length ? features.join('、') : '既定销售规则';
    return `本次可用：${summary}。\n客户信息、产品资料和演示金额会分别标注，最终结论仍需人工确认。`;
}

function applyAccessControl(session) {
    state.access.user = session?.user || null;
    state.access.canRun = Boolean(session?.user?.permissions?.includes('analysis:run'));
    document.body.classList.toggle('role-viewer', !state.access.canRun);
    setRunning(state.running);
}

function renderCapabilities(capabilities) {
    state.capabilities = capabilities || null;
    if (demoReplay.active) { lockDemoControls(); return; }
    const mapping = [
        ['use-cloud-model', Boolean(capabilities?.cloud_model_configured), '智能生成建议'],
        ['use-ima', Boolean(capabilities?.ima_configured), '产品资料库查询'],
        ['use-web-research', Boolean(capabilities?.web_research_configured), '华为公开资料查询'],
    ];
    const labels = [];
    for (const [identifier, enabled, label] of mapping) {
        const control = byId(identifier);
        control.disabled = !enabled;
        control.checked = enabled;
        labels.push(`${label}：${enabled ? '本次可用' : '暂不可用'}`);
    }
    byId('capability-status').textContent = labels.join('；');
    const matchCloud = byId('match-use-cloud-model');
    const matchIma = byId('match-use-ima');
    matchCloud.disabled = !capabilities?.cloud_model_configured;
    matchCloud.checked = Boolean(capabilities?.cloud_model_configured);
    matchIma.disabled = !capabilities?.ima_configured;
    matchIma.checked = Boolean(capabilities?.ima_configured);
    byId('match-capability-status').textContent = `智能生成建议：${capabilities?.cloud_model_configured ? '可用' : '暂不可用'}；产品资料库查询：${capabilities?.ima_configured ? '可用' : '暂不可用'}。暂不可用时不会显示为已完成。`;
    const profileStart = byId('profile-start');
    profileStart.disabled = !capabilities?.cloud_model_configured || state.running;
    byId('profile-model-status').textContent = capabilities?.cloud_model_configured
        ? '智能分析已准备 · 逐步了解客户'
        : '智能分析暂不可用，暂时不能开始访谈';
    if (!capabilities?.cloud_model_configured) profileStatus('智能分析暂不可用，逐步画像暂时无法开始。', true);
}

function setRunning(running) {
    state.running = running;
    const blocked = running || !state.access.canRun;
    byId('input-fields').disabled = running;
    byId('match-fields').disabled = running;
    byId('run-button').disabled = blocked || !state.csrf || state.sourceLoading || !selectedSourceReady();
    byId('match-button').disabled = blocked || !state.csrf;
    byId('refresh-source-status').disabled = running || state.sourceLoading;
    byId('new-customer').disabled = running;
    byId('profile-opening').disabled = running;
    byId('profile-answer').disabled = running;
    byId('profile-start').disabled = blocked || !state.capabilities?.cloud_model_configured;
    byId('profile-answer-button').disabled = blocked;
    byId('profile-reset').disabled = blocked;
    byId('profile-to-match').disabled = running;
    byId('profile-restart-complete').disabled = running;
    state.examples.forEach((example, index) => { byId(`example-${index + 1}`).disabled = running; });
    if (!running) byId('resume-polling').hidden = true;
    for (const id of ['demo-procurement', 'demo-creator']) byId(id).disabled = blocked;
    if (demoReplay.active) lockDemoControls();
    updateWizardChrome();
}

function wizardStepComplete(step) {
    if (step === 1) return state.profileResult?.status === 'complete';
    if (step === 2) return !byId('match-results').hidden && Boolean(state.matchMarkdown);
    if (step === 3) return !byId('content-draft-results').hidden && Boolean(state.contentMarkdown);
    if (step === 4) return byId('results').dataset.ready === 'true';
    return false;
}

function updateWizardChrome() {
    const step = state.wizardStep;
    const meta = wizardMeta[step];
    byId('wizard-stage-count').textContent = meta.count;
    byId('wizard-stage-title').textContent = meta.title;
    byId('wizard-stage-description').textContent = meta.description;
    for (const button of document.querySelectorAll('.wizard-step')) {
        const target = Number(button.dataset.stepTarget);
        const active = target === step;
        const complete = wizardStepComplete(target);
        button.classList.toggle('is-active', active);
        button.classList.toggle('is-complete', complete && !active);
        button.disabled = state.running;
        if (active) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
        const stateLabel = button.querySelector('[data-step-state]');
        if (stateLabel) stateLabel.textContent = active ? '当前' : complete ? '已完成' : '待进行';
    }
    byId('wizard-prev').disabled = state.running || step === 1;
    const nextLabels = {
        1: wizardStepComplete(1) ? '下一步：产品匹配' : '跳过画像，进入选品',
        2: wizardStepComplete(2) ? '下一步：内容生成' : '直接进入内容生成',
        3: wizardStepComplete(3) ? '下一步：报价与成交' : '直接进入报价与成交',
        4: '返回客户画像',
    };
    byId('wizard-next').textContent = nextLabels[step];
    byId('wizard-next').disabled = state.running;
    byId('wizard-controls-note').textContent = `第 ${step} 步，共 4 步 · ${meta.title}`;
    const companionTip = byId('rail-companion-tip');
    if (companionTip) {
        companionTip.textContent = {
            1: '先记下客户已经明确说过的内容。',
            2: '把需求和产品资料放在同一张桌面上。',
            3: '先准备好能审核的内容，再考虑发布。',
            4: '下一步越具体，成交推进越轻松。',
        }[step] || '一步一步来，关键信息不会漏。';
    }
}

function showWizardStep(step, options = {}) {
    const target = Number(step);
    if (!wizardMeta[target]) return;
    state.wizardStep = target;
    document.querySelectorAll('[data-wizard-panel]').forEach(panel => {
        const active = Number(panel.dataset.wizardPanel) === target;
        const resultGate = panel.id === 'results' && panel.dataset.ready !== 'true';
        panel.hidden = !active || resultGate;
    });
    updateWizardChrome();
    if (options.scroll !== false) byId('wizard-top').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function goToNextWizardStep() {
    if (state.running) return;
    if (demoReplay.active) { demoNavigateStep(state.wizardStep === 4 ? 1 : state.wizardStep + 1); return; }
    if (state.wizardStep === 4) showWizardStep(1);
    else showWizardStep(state.wizardStep + 1);
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
    if (demoReplay.active) { lockDemoControls(); return; }
    if (state.sourceTimer !== null) clearTimeout(state.sourceTimer);
    state.sourceTimer = null;
    byId('source-status-products').replaceChildren();
    const checked = state.sourceStatus?.checked_at;
    const product = selectedSource();
    const ready = selectedSourceReady();
    byId('source-status-summary').textContent = state.sourceLoading
        ? '正在重新检查华为公开资料，请稍候……'
        : state.sourceError
            ? `产品资料暂时无法确认：${plainText(state.sourceError)}。请重新检查；如仍失败，请联系资料维护人员。`
            : `当前型号：${byId('product').value}。${ready ? '产品资料可以用于本次准备。' : '产品资料需要更新或复核，暂时不能生成结果。'}\n最近检查：${formatDate(checked)}。正式成交价：待确认。`;
    for (const item of state.sourceStatus?.products || []) {
        const lines = [
            `资料情况：${sourceReady(item) ? '可以用于本次准备' : '需要更新或复核'}`,
            `最近检查：${formatDate(item.checked_at || checked)}`,
            `资料来源更新：${formatDate(item.oldest_fetched_at)}`,
            `下次复核时间：${formatDate(item.expires_at)}`,
            `可参考公开页面：${item.valid_source_count ?? 0} 个；正式成交价：待确认；已授权正式图片：0 张。`,
            ...(item.sources || []).map(source => `公开资料页：${source.url}\n更新时间：${formatDate(source.fetched_at)}`),
            ...(item.diagnostics || []).map(diagnostic => `提示：${diagnosticText(diagnostic)}`),
        ];
        card('source-status-products', item.product, lines.join('\n'));
    }
    if (ready) state.sourceTimer = setTimeout(() => { renderSourceStatus(); setRunning(state.running); }, Math.min(sourceTime(product.expires_at), sourceTime(product.checked_at) + statusWindow) - Date.now() + 1);
    setRunning(state.running);
}

async function refreshSourceStatus() {
    if (demoReplay.active) return false;
    if (state.sourceLoading) return false;
    state.sourceLoading = true;
    state.sourceError = '';
    renderSourceStatus();
    try {
        const response = await api('/api/source-status');
        if (!response || !['ready', 'needs_update'].includes(response.status) || !checkedRecently(response.checked_at) || response.source_mode !== 'official_public_snapshot' || response.freshness_window_seconds !== sourceWindow / 1000 || response.price_status !== 'unknown' || response.public_price_reference !== null || response.formal_image_count !== 0 || !Array.isArray(response.products) || response.products.length !== sourceProducts.length || !sourceProducts.every(name => response.products.filter(product => product?.product === name).length === 1)) throw new Error('产品资料状态暂时无法确认，请重新检查');
        const products = response.products.map(product => validSourceProduct(product, response.checked_at) ? product : {
            product: product.product, status: 'needs_update', checked_at: response.checked_at, source_mode: 'official_public_snapshot',
            oldest_fetched_at: null, expires_at: null, valid_source_count: 0, sources: [],
            price_status: 'unknown', public_price_reference: null, actual_transaction_quote: false, formal_image_count: 0,
            diagnostics: [{ code: 'SOURCE_STATUS_INVALID_RESPONSE', message: '该型号的产品资料暂时无法确认，本次没有采用返回的内容和时间；请稍后重新检查。' }],
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
    delete byId('results').dataset.ready;
    state.markdown = '';
    byId('export-status').textContent = '';
    updateWizardChrome();
}

function fillExample(index) {
    if (demoReplay.active) { demoNotice('请先退出预置演示，再加载普通示例。'); return; }
    const example = state.examples[index];
    if (!example || state.running) return;
    const input = example.marketing_input;
    for (const [field, identifier] of [['product', 'product'], ['platform', 'platform'], ['audience', 'audience'], ['scenario', 'scenario'], ['raw_request', 'raw-request']]) byId(identifier).value = input[field] || '';
    byId('demo-pricing').checked = example.demo_pricing === true;
    byId('policy-summary').textContent = '演示价格设置已就绪；本次结果会用销售能看懂的方式说明每一项假设。';
    byId('example-note').textContent = `已填入演示示例：${plainText(example.label)}。尚未提交；5 台只是演示数量，不代表客户真实需求。`;
    clearResult();
    renderSourceStatus();
    status('示例已填充，可修改后运行。');
}

function clearCustomer() {
    if (demoReplay.active) { demoNotice('请先退出预置演示，再创建客户。'); return; }
    if (state.running) return;
    for (const identifier of ['raw-request', 'audience', 'scenario']) byId(identifier).value = '';
    byId('demo-pricing').checked = false;
    byId('policy-summary').textContent = '新客户模式未启用演示报价；预算与采购数量不会自动补造。';
    byId('example-note').textContent = '请输入虚构或脱敏客户信息；未知项保留空白。';
    clearResult();
    status('新客户已清空，请补充已知信息。');
}

function collectInput() {
    const input = { product: byId('product').value, platform: byId('platform').value };
    for (const [field, identifier] of [['audience', 'audience'], ['scenario', 'scenario'], ['raw_request', 'raw-request']]) {
        const value = byId(identifier).value.trim();
        if (value.length > 800) throw new Error('每项客户描述最多800字。');
        if (value) input[field] = value;
    }
    const request = { marketing_input: input, demo_pricing: byId('demo-pricing').checked, use_cloud_model: byId('use-cloud-model').checked, use_ima: byId('use-ima').checked, use_web_research: byId('use-web-research').checked };
    if (new TextEncoder().encode(JSON.stringify(request)).length > 4096) throw new Error('输入内容较长，请精简后再试。');
    return request;
}

async function api(url, options = {}) {
    if (demoReplay.active) throw new Error('预置演示期间不发送业务请求；请先退出演示');
    let response;
    try {
        response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    } catch {
        throw new Error('暂时无法连接销售工作台，请稍后重试。');
    }
    let data;
    try { data = await response.json(); } catch { throw new Error('工作台返回内容暂时无法读取，请稍后刷新重试。'); }
    if (!response.ok) {
        const code = data.error?.code;
        const messages = {
            AUTH_REQUIRED: '登录状态已失效，请重新登录。',
            PERMISSION_DENIED: '当前账号没有执行此操作的权限，请联系管理员。',
            CSRF_REJECTED: '安全校验已过期，请刷新页面后重试。',
            RATE_LIMIT: '操作次数较多，请稍后再试。',
            ORIGIN_REQUIRED: '当前访问地址未获允许，请从正式工作台地址进入。',
            ORIGIN_FORBIDDEN: '当前访问地址未获允许，请从正式工作台地址进入。'
        };
        throw new Error(messages[code] || plainText(data.error?.message || '操作未完成，请稍后重试。'));
    }
    return data;
}

async function startRun(event) {
    if (event) event.preventDefault();
    if (demoReplay.active) { if (state.access.canRun) demoShowSales(); return; }
    if (state.running || !state.csrf || !state.access.canRun) return;
    showWizardStep(4, { scroll: false });
    let request;
    try { request = collectInput(); } catch (error) { status(error.message, true); return; }
    clearResult();
    setRunning(true);
    status('正在重新检查当前型号的产品资料……');
    try {
        if (!await refreshSourceStatus()) {
            setRunning(false);
            status('当前型号资料尚未准备好、需要更新或暂时无法检查，本次没有提交。请重新检查，或选择资料可用的型号；资料更新请联系资料维护人员。', true);
            return;
        }
        state.startedAt = Date.now();
        status('产品资料检查完成，正在整理销售准备结果；不会自动联系客户。');
        const job = await api('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf }, body: JSON.stringify(request) });
        state.jobId = job.id;
        state.polling = true;
        await pollRun();
    } catch (error) { setRunning(false); status(`本次未完成：${plainText(error.message)}。若登录已过期，请刷新页面后重试。`, true); }
}

async function pollRun() {
    if (!state.polling || !state.jobId) return;
    try {
        const job = await api(`/api/runs/${encodeURIComponent(state.jobId)}`);
        if (job.status === 'running') {
            status(`正在处理，已等待${Math.round((Date.now() - state.startedAt) / 1000)}秒。请勿重复提交。`);
            setTimeout(pollRun, 1000);
            return;
        }
        state.polling = false;
        setRunning(false);
        if (job.status === 'failed') { status(`本次未完成：${plainText(job.error?.message || '请稍后重试')}。没有生成可用的销售准备结果。`, true); return; }
        if (job.status !== 'completed' || !job.result) throw new Error('结果暂时不完整，请稍后重试');
        renderResult(job.result, job.markdown || '');
    } catch (error) {
        state.polling = false;
        byId('resume-polling').hidden = false;
        status(`查询暂停：${plainText(error.message)}。处理可能仍在继续，请点击继续查询，避免重复提交。`, true);
    }
}

function appendList(container, title, values, empty = '暂无需要补充的内容。') {
    const wrap = element('div'); wrap.className = 'result-card';
    wrap.append(element('strong', title));
    const items = (values || []).filter(value => value !== null && value !== undefined && value !== '');
    const list = element('ul');
    if (!items.length) list.append(element('li', empty));
    else for (const value of items) list.append(element('li', plainText(value)));
    wrap.append(list);
    container.append(wrap);
}

function cleanSourceTitle(value) {
    return plainText(String(value || '产品资料').split('｜')[0]
        .replace(/\s*-\s*产品事实\s*$/i, ' 产品资料')
        .replace(/^input\.profile\./i, '客户填写：')
        .replace(/\.[a-f0-9]{12,}(?:\.(?:html?|txt))?$/i, '')
        .replace(/\.(?:html?|txt)$/i, ''));
}

function limitationText(value) {
    const message = plainText(typeof value === 'string' ? value : value?.message || '');
    if (message.includes('固定5台') || message.includes('固定 5 台')) return '演示价格使用固定的 5 台假设，不代表客户真实采购数量。';
    if (message.includes('官网快照') || message.includes('公开快照')) return '公开资料有更新时间限制，过期后会要求重新核对。';
    if (message.includes('产品资料库') || message.includes('公开资料')) return '产品资料和公开资料会分别记录来源；缺少可核对原文时保持待确认。';
    if (message.includes('正式交易报价') || message.includes('正式图片')) return '正式成交价、正式图片、现场耗时和转化效果仍需人工确认。';
    if (message.includes('隐私')) return '请只使用虚构或脱敏客户信息，不要输入真实隐私或系统密码。';
    if (message.includes('人工') || message.includes('最终确认')) return '系统结果只用于准备，不能代替销售或发布负责人的最终确认。';
    return message;
}

function renderPricing(pricing = {}) {
    const wrap = element('div'); wrap.className = 'result-card';
    wrap.append(element('strong', '演示金额测算'));
    wrap.append(element('p', `演示数量：${pricing.quantity ?? '待确认'} 台\n单台测算：${money(pricing.unit_amount_cents)}\n合计测算：${money(pricing.amount_cents)}\n正式成交报价：待确认。`));
    wrap.append(element('p', '以上金额只用于演示四级价格的计算方式，不是华为官方政策，也不是客户成交价。'));
    byId('pricing').append(wrap);
    for (const trace of pricing.trace || []) {
        const item = element('div'); item.className = 'result-card';
        item.append(element('strong', `第 ${trace.level} 级：${plainText(trace.source?.title || '价格假设')}`));
        const discount = Number.isSafeInteger(trace.discount_cents) ? money(trace.discount_cents) : '待确认';
        item.append(element('p', `本步前单台：${money(trace.before_cents)}\n本步优惠：${discount}\n本步后单台：${money(trace.after_cents)}`));
        if (Number.isSafeInteger(trace.cap_discount_cents)) item.append(element('p', `本步优惠上限：${money(trace.cap_discount_cents)}`));
        item.append(element('small', plainText(trace.source?.description || '这是一项演示假设，需人工确认。')));
        byId('pricing').append(item);
    }
    const notes = (pricing.diagnostics || []).map(diagnostic => diagnosticText(diagnostic));
    appendList(byId('pricing'), '价格需要确认的事项', [...new Set(notes)], '正式价格政策仍需确认。');
}

function renderPlan(plan) {
    if (!plan) return;
    const wrap = element('div'); wrap.className = 'result-card';
    wrap.append(element('strong', '0–30 分钟客户演示准备'), element('p', plainText(plan.goal)));
    wrap.append(element('p', '这是准备方案，现场实际耗时尚未验证；完成演示后再记录真实结果。'));
    appendList(byId('plan'), '演示前准备', plan.materials || []);
    const schedule = element('div'); schedule.className = 'result-card';
    schedule.append(element('strong', '建议时间安排'));
    for (const step of plan.schedule || []) {
        const item = element('div'); item.className = 'business-step';
        item.append(element('b', `${step.minutes} 分钟 · ${plainText(step.owner)}`));
        item.append(element('p', `做什么：${plainText(step.operation)}\n完成标准：${plainText(step.acceptance)}\n遇到困难：${plainText(step.fallback)}`));
        schedule.append(item);
    }
    byId('plan').append(schedule);
}

function renderActions(actions) {
    (actions || []).forEach((action, index) => {
        const wrap = element('div'); wrap.className = 'result-card';
        wrap.append(element('strong', `第 ${index + 1} 项 · ${plainText(action.owner || '待指定负责人')}`));
        wrap.append(element('p', `要做什么：${plainText(action.action)}\n何时推进：${plainText(action.time_node || action.trigger)}\n完成标准：${plainText(action.completion_criteria)}`));
        if (action.pending_dependencies?.length) wrap.append(element('p', `先确认：${listText(action.pending_dependencies)}`));
        byId('actions').append(wrap);
    });
}

function renderOfficialReference(official) {
    if (!official) return;
    const wrap = element('div'); wrap.className = 'result-card';
    wrap.append(element('strong', '华为公开产品资料'));
    wrap.append(element('p', `产品：${plainText(official.product || '待确认')}\n最近核对：${formatDate(official.checked_at)}\n正式成交价：${official.public_price_reference ? money(official.public_price_reference.amount_cents) : '待确认'}`));
    const specs = (official.specifications || []).map(spec => `${specLabels[spec.name] || plainText(spec.name)}：${readable(spec.value)}${spec.unit ? ` ${spec.unit}` : ''}`);
    if (specs.length) wrap.append(element('p', specs.join('\n')));
    for (const source of official.sources || []) {
        const item = element('div');
        item.append(element('small', `资料来源：${plainText(source.product || '华为公开页面')}｜更新于 ${formatDate(source.fetched_at)}`));
        const link = safeSourceLink(source.url, '查看华为公开页面');
        if (link) item.append(link);
        wrap.append(item);
    }
    const notes = (official.diagnostics || []).map(diagnostic => diagnosticText(diagnostic));
    if (notes.length) wrap.append(element('p', [...new Set(notes)].join('\n')));
    byId('diagnostics').append(wrap);
}

function renderSources(result) {
    const seen = new Set();
    const walk = value => {
        if (!value || typeof value !== 'object') return;
        const addresses = [...(typeof value.url === 'string' ? [value.url] : []), ...(Array.isArray(value.urls) ? value.urls : [])];
        if (addresses.length) {
            const key = addresses.join('|') + '|' + String(value.title || value.name || '');
            if (!seen.has(key)) {
                seen.add(key);
                const wrap = element('div'); wrap.className = 'result-card';
                wrap.append(element('strong', cleanSourceTitle(value.title || value.name || value.entry)));
                wrap.append(element('p', `资料更新时间：${formatDate(value.fetched_at || value.checked_at)}`));
                for (const address of addresses) {
                    const link = safeSourceLink(address, '查看原始资料');
                    if (link) wrap.append(link);
                }
                if (value.excerpt) {
                    const details = element('details');
                    details.append(element('summary', '查看资料摘录'), element('p', plainText(String(value.excerpt).replace(/\s+/g, ' ').slice(0, 320))));
                    wrap.append(details);
                }
                byId('sources').append(wrap);
            }
        }
        for (const child of Object.values(value)) walk(child);
    };
    walk(result.marketing_result?.knowledge_basis);
    walk(result.official_reference);
    if (!seen.size) card('sources', '暂无可展示的华为公开资料来源', '本次没有把无来源内容当作已核实资料。');
    card('sources', '正式产品图片', '当前没有完成发布授权的正式图片；未确认图片不会作为产品配图展示。');
}

function renderResult(result, markdown) {
    for (const identifier of ['profile', 'clarifications', 'content', 'pricing', 'plan', 'actions', 'sources', 'diagnostics']) byId(identifier).replaceChildren();
    byId('engine-status').textContent = engineStatus(result.runtime_engine);
    const ready = result.status === 'demo_ready';
    status(ready ? '销售准备结果已生成，请核对待确认项和金额说明。' : '还有信息需要确认，请先处理下方提示。', !ready);
    byId('result-summary').textContent = `结果状态：${statusLabel(result.status)}；本次处理用时 ${result.timing?.generation_elapsed_seconds ?? '未提供'} 秒。\n${engineStatus(result.runtime_engine)}\n生成用时不代表现场 30 分钟演示已经完成。`;
    for (const [name, field] of Object.entries(result.customer_analysis?.profile || {})) {
        const evidence = field.evidence?.length ? field.evidence.map(item => `“${item.quote}”`).join('；') : field.reason;
        card('profile', labels[name] || '客户信息', `客户信息：${readable(field.value)}\n可信程度：${statusLabel(field.status)}\n依据：${readable(evidence)}`);
    }
    for (const question of result.customer_analysis?.clarification_questions || []) card('clarifications', '建议先确认', typeof question === 'string' ? plainText(question) : plainText(question.question || question));
    const content = result.content?.marketing_content;
    if (content) card('content', content.title || '内容准备稿', `${plainText(content.lead || '')}\n\n${plainText(content.body || '')}\n\n下一步沟通：${plainText(content.cta || '')}`);
    else card('content', '暂未生成内容', '请先补齐必要信息；系统不会把空白内容标为已完成。');
    renderPricing(result.pricing_result || {});
    renderPlan(result.solution?.demonstration_plan);
    renderActions(result.next_actions || []);
    renderSources(result);
    renderOfficialReference(result.official_reference);
    const notes = [
        ...(result.limitations || []).map(limitationText),
        ...(result.diagnostics || []).map(diagnosticText),
        ...(result.marketing_result?.diagnostics || []).map(diagnosticText)
    ].filter(Boolean);
    appendList(byId('diagnostics'), '使用边界与待确认事项', [...new Set(notes)], '仍需人工确认最终内容与销售动作。');
    state.markdown = markdown;
    byId('full-markdown').textContent = markdown;
    byId('download-json').href = `/api/runs/${encodeURIComponent(state.jobId)}/export?format=json`;
    byId('download-markdown').href = `/api/runs/${encodeURIComponent(state.jobId)}/export?format=markdown`;
    byId('results').dataset.ready = 'true';
    showWizardStep(4, { scroll: false });
    byId('results').hidden = false;
    updateWizardChrome();
}

function profileStatus(message, isError = false) {
    byId('profile-status').textContent = message;
    byId('profile-status').classList.toggle('error', isError);
}

function profileStopText(reason) {
    if (reason === 'coverage_threshold') return '关键客户信息已基本齐全，系统生成了客户画像。';
    if (reason === 'gap_threshold') return '剩余待确认项已经较少，系统生成了客户画像。';
    if (reason === 'max_turns') return '已经问完本轮建议的问题，系统基于现有信息生成了客户画像。';
    return '画像生成完成。';
}

function profileEmptyState() {
    const wrap = element('div');
    wrap.className = 'conversation-empty';
    const mark = element('span', '✦');
    mark.className = 'empty-mark';
    const copy = element('p');
    copy.append(element('strong', '小麦已准备好听你说'), element('small', '写下已知背景，或直接开始第一问。'));
    wrap.append(mark, copy);
    return wrap;
}

function renderProfileProgress(result = state.profileResult) {
    const coverage = result?.coverage;
    const covered = new Set(coverage?.covered_dimensions || []);
    const missing = new Set(coverage?.missing_dimensions || profileDimensionIds);
    const coveredCount = coverage?.covered_count ?? 0;
    const coreCount = coverage?.core_covered_count ?? 0;
    const turn = result?.turn ?? state.profileTurn ?? 0;
    const max = result?.max_turns ?? state.profileMax ?? 8;
    byId('profile-turn-value').textContent = String(turn);
    byId('profile-max-value').textContent = String(max);
    byId('profile-covered-value').textContent = String(coveredCount);
    byId('profile-core-value').textContent = String(coreCount);
    const percent = Math.round(coveredCount / profileDimensionIds.length * 100);
    byId('profile-progress-label').textContent = `${percent}%`;
    byId('profile-progress-bar').style.width = `${percent}%`;
    byId('profile-progress-note').textContent = result?.status === 'complete'
        ? profileStopText(result.stop_reason)
        : '关键客户信息基本齐全时，系统会自动生成画像。';
    const container = byId('profile-dimensions');
    container.replaceChildren();
    for (const identifier of profileDimensionIds) {
        const chip = element('span', profileDimensionLabels[identifier]);
        const isCovered = covered.has(identifier);
        chip.className = `dimension-chip ${isCovered ? 'covered' : 'pending'}`;
        if (!isCovered && !missing.has(identifier)) chip.classList.remove('pending');
        container.append(chip);
    }
}

function appendProfileMessage(role, content) {
    const log = byId('profile-conversation');
    log.querySelector('.conversation-empty')?.remove();
    const message = element('div');
    message.className = `chat-message ${role === 'user' ? 'user' : 'agent'}`;
    message.append(element('small', role === 'user' ? '销售顾问记录' : '画像助手'), element('span', content));
    log.append(message);
    log.scrollTop = log.scrollHeight;
}

function resetProfileInterview(options = {}) {
    if (demoReplay.active) { startDemo(demoReplay.scenario.id); return; }
    if (state.running) return;
    state.profileMessages = [];
    state.profileTurn = 0;
    state.profileMax = Number(state.capabilities?.guided_profile_max_turns) || 8;
    state.profileJobId = null;
    state.profilePolling = false;
    state.profileResult = null;
    state.profileStarted = false;
    state.profileQuestion = null;
    byId('profile-start-form').reset();
    byId('profile-answer-form').reset();
    byId('profile-start-form').hidden = false;
    byId('profile-question-panel').hidden = true;
    byId('profile-result').hidden = true;
    byId('profile-conversation').replaceChildren(profileEmptyState());
    byId('profile-option-list').replaceChildren();
    renderProfileProgress(null);
    updateWizardChrome();
    profileStatus(state.capabilities?.cloud_model_configured
        ? '尚未开始。系统会先给出一个问题；销售顾问提交客户信息后会继续智能分析。'
        : '智能分析暂不可用，逐步画像暂时无法开始。', !state.capabilities?.cloud_model_configured);
    if (!options.silent) byId('profile-studio').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setProfileQuestion(question) {
    state.profileQuestion = question;
    if (!question) {
        byId('profile-question-panel').hidden = true;
        return;
    }
    byId('profile-start-form').hidden = true;
    byId('profile-result').hidden = true;
    byId('profile-question-panel').hidden = false;
    byId('profile-question-dimension').textContent = profileDimensionLabels[question.dimension] || '进一步信息';
    byId('profile-question-text').textContent = question.text;
    const options = byId('profile-option-list');
    options.replaceChildren();
    for (const option of question.options || []) {
        const button = element('button', option);
        button.type = 'button';
        button.className = 'option-chip';
        button.addEventListener('click', () => {
            byId('profile-answer').value = option;
            byId('profile-answer').focus();
            profileStatus('已填入快捷选项。可继续补充细节，再提交分析。');
        });
        options.append(button);
    }
    byId('profile-answer').focus();
}

function renderProfileResult(result) {
    state.profileResult = result;
    state.profileTurn = result.turn;
    updateWizardChrome();
    state.profileMax = result.max_turns;
    renderProfileProgress(result);
    byId('profile-model-status').textContent = result.runtime?.called
        ? '智能分析 · 本轮已完成'
        : '等待销售顾问录入首轮信息';
    if (result.status !== 'complete') {
        state.profileQuestion = result.next_question || null;
        setProfileQuestion(state.profileQuestion);
        profileStatus(`第 ${result.turn} 轮分析完成。当前已了解 ${result.coverage.covered_count}/${result.coverage.total_count} 项客户信息；请只回答当前这一问。`);
        return;
    }
    state.profileQuestion = null;
    byId('profile-question-panel').hidden = true;
    byId('profile-result').hidden = false;
    byId('profile-summary').textContent = result.summary;
    byId('profile-stop-reason').textContent = profileStopText(result.stop_reason);
    const fields = byId('profile-fields');
    fields.replaceChildren();
    for (const identifier of profileDimensionIds) {
        const field = result.fields[identifier] || { value: null, status: 'pending', evidence: [], reason: '待确认' };
        const item = element('article');
        item.className = `profile-field ${field.status === 'pending' ? 'pending' : ''}`;
        const heading = element('strong');
        heading.append(element('span', profileDimensionLabels[identifier]), element('span', field.status === 'pending' ? '待确认' : statuses[field.status] || field.status));
        item.append(heading, element('p', field.status === 'pending' ? '尚未取得可定位的客户原话' : readable(field.value)));
        const evidence = field.evidence?.map(entry => `“${entry.quote}”`).join('；');
        item.append(element('small', evidence || field.reason || '待确认'));
        fields.append(item);
    }
    appendProfileMessage('agent', '画像已完成。你可以带到产品匹配，或继续创建另一位客户。');
    profileStatus(`客户画像已生成：已了解 ${result.coverage.covered_count}/${result.coverage.total_count} 项信息。请核对待确认项后再进入选品。`);
}

async function sendProfileMessages(messages, restart = false) {
    if (state.running) return;
    if (!state.capabilities?.cloud_model_configured) throw new Error('智能分析暂不可用，暂时不能进行逐步画像');
    setRunning(true);
    state.profilePolling = true;
    profileStatus(restart ? '正在准备客户画像访谈，请稍候……' : '正在根据本轮回答继续分析，请稍候……');
    try {
        const job = await api('/api/profile-steps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf },
            body: JSON.stringify({ schema_version: '1.0', messages, restart }),
        });
        state.profileJobId = job.id;
        while (state.profilePolling) {
            const current = await api(`/api/runs/${encodeURIComponent(state.profileJobId)}`);
            if (current.status === 'running') {
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }
            if (current.status === 'failed') throw new Error(current.error?.message || '画像访谈未完成');
            if (current.status !== 'completed' || !current.result) throw new Error('画像访谈结果不完整');
            state.profilePolling = false;
            setRunning(false);
            if (current.result.status === 'question' && current.result.next_question) {
                state.profileMessages.push({ role: 'assistant', content: current.result.next_question.text });
                appendProfileMessage('agent', current.result.next_question.text);
            }
            renderProfileResult(current.result);
            return;
        }
    } catch (error) {
        state.profilePolling = false;
        setRunning(false);
        throw error;
    }
}

async function startGuidedProfile(event) {
    if (event) event.preventDefault();
    if (demoReplay.active) return;
    if (state.running || !state.access.canRun) return;
    const opening = byId('profile-opening').value.trim();
    if (opening.length > 800) { profileStatus('已知背景最多 800 字。', true); return; }
    state.profileMessages = opening ? [{ role: 'user', content: opening }] : [];
    state.profileTurn = 0;
    state.profileResult = null;
    state.profileStarted = true;
    state.profileQuestion = null;
    byId('profile-start-form').hidden = true;
    byId('profile-result').hidden = true;
    byId('profile-question-panel').hidden = true;
    byId('profile-conversation').replaceChildren(profileEmptyState());
    if (opening) appendProfileMessage('user', opening);
    renderProfileProgress(null);
    try {
        await sendProfileMessages(state.profileMessages, true);
    } catch (error) {
        state.profileStarted = false;
        byId('profile-start-form').hidden = false;
        profileStatus(`暂时无法开始画像：${plainText(error.message)}。请稍后重试或联系管理员。`, true);
    }
}

async function submitProfileAnswer(event) {
    if (event) event.preventDefault();
    if (demoReplay.active) { if (state.access.canRun) demoConfirmRound(true); return; }
    if (state.running || !state.profileQuestion) return;
    const answer = byId('profile-answer').value.trim();
    if (!answer) { profileStatus('请先填写当前这一问的回答。', true); return; }
    const previousMessages = [...state.profileMessages];
    state.profileMessages.push({ role: 'user', content: answer });
    appendProfileMessage('user', answer);
    byId('profile-answer').value = '';
    try {
        await sendProfileMessages(state.profileMessages, false);
    } catch (error) {
        state.profileMessages = previousMessages;
        byId('profile-answer').value = answer;
        byId('profile-conversation').querySelectorAll('.chat-message.user').item(-1)?.remove();
        setProfileQuestion(state.profileQuestion);
        profileStatus(`本轮分析未完成：${plainText(error.message)}。回答已保留，可重试。`, true);
    }
}

function fillMatchFromProfile() {
    if (demoReplay.active) { demoShowMatch(); return; }
    const profile = state.profileResult?.product_match_profile;
    if (!profile) return;
    const setValue = (identifier, value) => {
        if (value === null || value === undefined || value === '') return;
        byId(identifier).value = Array.isArray(value) ? value.join('，') : typeof value === 'object' ? JSON.stringify(value) : String(value);
    };
    setValue('match-raw-request', profile.raw_request);
    setValue('match-audience', profile.audience);
    setValue('match-scenario', profile.scenario);
    setValue('match-industry', profile.industry);
    setValue('match-needs', profile.needs);
    setValue('match-preferences', profile.preferences);
    setValue('match-pain-points', profile.pain_points);
    setValue('match-excluded', profile.excluded_requirements);
    const context = [profile.scenario, ...(profile.needs || []), ...(profile.pain_points || [])].filter(Boolean).join(' ');
    if (/电脑|笔记本|MateBook|办公设备/.test(context)) setValue('match-product-type', '电脑');
    if (profile.budget && typeof profile.budget === 'object') {
        if (Number.isFinite(profile.budget.min)) byId('match-budget-min').value = profile.budget.min;
        if (Number.isFinite(profile.budget.max)) byId('match-budget-max').value = profile.budget.max;
        if (profile.budget.scope) byId('match-budget-scope').value = profile.budget.scope;
        if (Number.isInteger(profile.budget.quantity)) byId('match-quantity').value = profile.budget.quantity;
    }
    clearMatchResult();
    renderCapabilities(state.capabilities || {});
    matchStatus('已带入逐步画像生成的脱敏信息。请核对未知项，再开始产品匹配。');
    showWizardStep(2);
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
    updateWizardChrome();
}

function fillMatchExample(index) {
    if (demoReplay.active) { demoNotice('请使用上方两个预置演示按键切换客户。'); return; }
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
    matchStatus(`已填入演示选品示例：${plainText(example.label)}。尚未提交。`);
}

function clearMatchCustomer() {
    if (demoReplay.active) return;
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
    if (new TextEncoder().encode(JSON.stringify(request)).length > 16384) throw new Error('输入内容较长，请精简后再试。');
    return request;
}

async function startProductMatch(event) {
    if (event) event.preventDefault();
    if (demoReplay.active) { if (state.access.canRun) demoShowMatch(); return; }
    if (state.running || !state.csrf || !state.access.canRun) return;
    let request;
    try { request = collectMatchInput(); } catch (error) { matchStatus(error.message, true); return; }
    state.matchInput = request;
    clearMatchResult();
    setRunning(true);
    state.startedAt = Date.now();
    matchStatus('正在查找候选型号并核对产品资料；如智能分析暂不可用，会按已核对资料整理推荐理由。');
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
        if (job.status === 'failed') { matchStatus(`选品未完成：${plainText(job.error?.message || '请稍后重试')}。`, true); return; }
        if (job.status !== 'completed' || !job.result) throw new Error('结果暂时不完整，请稍后重试');
        renderProductMatchResult(job.result, job.markdown || '');
    } catch (error) {
        state.matchPolling = false;
        setRunning(false);
        matchStatus(`选品查询暂停：${plainText(error.message)}。请勿重复提交，可刷新后重试。`, true);
    }
}

function contentStatus(message, isError = false) {
    byId('content-status').textContent = message;
    byId('content-status').classList.toggle('error', isError);
}

function clearContentResult() {
    byId('content-draft-results').hidden = true;
    byId('content-copy-blocks').replaceChildren();
    byId('content-cover-copy').replaceChildren();
    byId('content-platform-checks').replaceChildren();
    byId('content-verification-summary').replaceChildren();
    byId('content-verification-items').replaceChildren();
    byId('content-risk-items').replaceChildren();
    byId('content-safe-version').replaceChildren();
    byId('content-draft').replaceChildren();
    byId('content-image-sources').replaceChildren();
    byId('content-insertion-plan').replaceChildren();
    byId('content-markdown').textContent = '';
    byId('content-copy-feedback').textContent = '';
    state.contentJobId = null;
    state.contentPolling = false;
    state.contentMarkdown = '';
    state.contentResult = null;
    updateWizardChrome();
    contentStatus(`选择候选后可生成${byId('content-platform').value}内容草稿；不会自动发布。`);
}

async function startContentDraft(candidateId) {
    if (demoReplay.active) {
        if (!state.access.canRun) return;
        if (candidateId !== demoReplay.scenario.candidateId) { contentStatus('该候选未录制内容，请选择演示样例的 MateBook 14 候选。'); return; }
        demoShowContent(byId('content-platform').value);
        return;
    }
    if (state.running || !state.csrf) return;
    if (!state.matchInput) { contentStatus('请先完成一次产品匹配，再生成图文。', true); return; }
    showWizardStep(3, { scroll: false });
    clearContentResult();
    setRunning(true);
    state.startedAt = Date.now();
    const platform = byId('content-platform').value;
    const imageLimit = platform === '朋友圈' ? 1 : platform === '小红书' ? 3 : 4;
    state.contentPlatform = platform;
    contentStatus(`正在按${platform}的内容结构核对候选型号、产品原文和可用图片，不会使用近似型号替代。`);
    try {
        const payload = { schema_version: '1.0', match_input: state.matchInput, candidate_id: candidateId, platform, image_limit: imageLimit };
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
            contentStatus(`正在生成${state.contentPlatform}内容，已等待${Math.round((Date.now() - state.startedAt) / 1000)}秒。`);
            setTimeout(pollContentDraft, 1000);
            return;
        }
        state.contentPolling = false;
        setRunning(false);
        if (job.status === 'failed') { contentStatus(`内容准备未完成：${plainText(job.error?.message || '请稍后重试')}。`, true); return; }
        if (job.status !== 'completed' || !job.result) throw new Error('结果暂时不完整，请稍后重试');
        renderContentDraftResult(job.result, job.markdown || '');
    } catch (error) {
        state.contentPolling = false;
        setRunning(false);
        contentStatus(`内容查询暂停：${plainText(error.message)}。请勿重复提交，可刷新后重试。`, true);
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
    const checkLabels = { product_model: '产品型号', parameters: '产品参数', price: '价格与报价', image_identity: '图片来源', overreach: '表达边界', source_completeness: '资料来源' };
    const summary = element('div'); summary.className = 'verification-summary';
    const heading = element('div'); heading.className = 'verification-heading';
    heading.append(element('strong', '发布前检查结论'), verificationBadge(overallClass, plainText(verification.status_label)));
    summary.append(heading);
    summary.append(element('p', `六项检查：通过 ${verification.summary.pass_count} 项｜需要调整 ${verification.summary.downgrade_count} 项｜不通过 ${verification.summary.fail_count} 项`));
    summary.append(element('p', `原稿可直接发布：${verification.publication_ready ? '是' : '否'}；稳妥版本：${verification.safe_content_ready ? '可用' : '暂不可用'}。`));
    summary.append(element('p', `检查时间：${formatDate(verification.checked_at)}`));
    byId('content-verification-summary').append(summary);

    const itemList = element('div'); itemList.className = 'verification-item-list';
    for (const item of verification.items) {
        const card = element('article'); card.className = 'verification-item';
        const head = element('div'); head.className = 'verification-heading';
        head.append(element('strong', checkLabels[item.id] || plainText(item.label)), verificationBadge(item.status, item.status === 'downgrade' ? '需要调整' : plainText(item.status_label)));
        card.append(head, element('p', plainText(item.summary)));
        const itemDetails = item.details || [];
        if (itemDetails.length) {
            const details = element('ul');
            for (const detail of itemDetails) details.append(element('li', plainText(detail)));
            card.append(details);
        }
        itemList.append(card);
    }
    byId('content-verification-items').append(itemList);

    if (!verification.risk_items.length) {
        byId('content-risk-items').append(element('p', '未发现需要处理的问题。'));
    } else {
        const riskList = element('div'); riskList.className = 'verification-risk-list';
        for (const risk of verification.risk_items) {
            const card = element('article'); card.className = `verification-risk ${risk.risk_level}`;
            const head = element('div'); head.className = 'verification-heading';
            head.append(element('strong', plainText(risk.title)), verificationBadge(risk.risk_level === 'blocking' ? 'fail' : 'downgrade', risk.risk_level === 'blocking' ? '需先处理' : '已调整'));
            card.append(head, element('p', `问题：${plainText(risk.issue)}`), element('p', `怎么处理：${plainText(risk.recommendation)}`));
            const affected = risk.affected || [];
            if (affected.length) card.append(element('p', `影响内容：${affected.map(item => plainText(item)).join('、')}`));
            riskList.append(card);
        }
        byId('content-risk-items').append(riskList);
    }

    const safe = verification.safe_content;
    if (safe.ready && safe.content) {
        const article = element('article'); article.className = 'content-safe-copy';
        article.append(element('h4', plainText(safe.content.title)), element('p', plainText(safe.content.lead)));
        const body = element('pre', cleanProse(safe.content.body_markdown)); body.className = 'content-body';
        article.append(body, element('strong', '下一步沟通'), element('p', plainText(safe.content.cta)));
        const imageCount = (safe.content.image_ids || []).length;
        article.append(element('p', `本版本纳入图片：${imageCount ? imageCount + ' 张' : '无（待授权图片不放入稳妥发布版；可在下方原稿中预览）'}`));
        if (safe.disclosures.length) {
            const disclosure = element('div'); disclosure.className = 'verification-disclosures';
            disclosure.append(element('strong', '已做的稳妥处理'));
            const list = element('ul');
            for (const item of safe.disclosures) list.append(element('li', plainText(item)));
            disclosure.append(list); article.append(disclosure);
        }
        byId('content-safe-version').append(article);
    } else {
        const blocked = element('p', '当前没有可直接使用的版本。请先按“需要处理的问题”调整后重新检查。');
        blocked.className = 'error';
        byId('content-safe-version').append(blocked);
    }
}

function createContentImagePreview(image, options = {}) {
    const figure = element('figure'); figure.className = 'content-image-card draft-inline-image';
    if (image.image_id) figure.dataset.imageId = image.image_id;
    const picture = element('img'); picture.src = image.asset_url; picture.alt = plainText(image.caption);
    picture.loading = options.lazy === false ? 'eager' : 'lazy'; picture.decoding = 'async';
    const caption = element('figcaption');
    const rights = String(image.rights_status || '').includes('pending') ? '发布授权待确认' : plainText(image.rights_status);
    caption.append(element('strong', plainText(image.caption)), element('span', image.demo_illustration ? '项目原创场景插图 · 非产品实拍' : `型号核对：一致；图片状态：${rights}`));
    const original = safeSourceLink(image.original_url, '查看图片来源'); if (original) caption.append(original);
    picture.addEventListener('error', () => {
        figure.classList.add('image-load-error');
        if (!figure.querySelector('.image-load-message')) {
            const message = element('p', '图片未能加载。请确认已登录、刷新页面后重试。');
            message.className = 'image-load-message error';
            caption.prepend(message);
        }
    }, { once: true });
    figure.append(picture, caption);
    return figure;
}

function appendDraftBodyWithImages(container, bodyMarkdown, imageSources) {
    const imagesByMarker = new Map((imageSources || []).map(image => [image.marker, image]));
    const used = new Set();
    for (const chunk of String(bodyMarkdown || '').split(/\n{2,}/)) {
        const marker = chunk.match(/^\s*<!--\s*IMAGE:([a-z_]+)\s*-->/i);
        if (marker) {
            const image = imagesByMarker.get(marker[1]);
            if (image && !used.has(image.image_id)) {
                container.append(createContentImagePreview(image, { lazy: false }));
                used.add(image.image_id);
            }
            continue;
        }
        const text = plainText(chunk).replace(/^来源定位：.*$/gmi, '').trim();
        if (!text) continue;
        const block = element('div', text); block.className = 'content-body-fragment'; container.append(block);
    }
    const remaining = (imageSources || []).filter(image => !used.has(image.image_id));
    if (remaining.length) {
        const heading = element('strong', '其余待审图片'); heading.className = 'content-image-fallback-heading';
        const grid = element('div'); grid.className = 'content-image-grid';
        for (const image of remaining) grid.append(createContentImagePreview(image));
        container.append(heading, grid);
    }
}
function checkLabel(status) {
    return { pass: '通过', warning: '需调整', fail: '不通过', info: '提示' }[status] || plainText(status || '待确认');
}

function checkClass(status) {
    return `check-${['pass', 'warning', 'fail', 'info'].includes(status) ? status : 'none'}`;
}

function fallbackCopyBlocks(result) {
    const copy = result.publish_copy || {};
    return [
        { id: 'title', label: '标题', text: copy.title || result.draft?.title || '', character_count: Array.from(copy.title || result.draft?.title || '').length, status: 'pass', counter: `${Array.from(copy.title || result.draft?.title || '').length} 字`, note: '直接复制到平台标题栏。' },
        { id: 'body', label: '正文', text: copy.body || plainText(copy.markdown || ''), character_count: Array.from(copy.body || copy.markdown || '').length, status: 'pass', counter: `${Array.from(copy.body || copy.markdown || '').length} 字`, note: '复制前请快速通读一次。' },
        { id: 'tags', label: '标签', text: (copy.tags || []).map(tag => `#${tag}`).join(' '), character_count: (copy.tags || []).length, status: 'pass', counter: `${(copy.tags || []).length} 个`, note: '放到正文末尾或标签栏。' },
    ];
}

function renderPublicationReadiness(result) {
    const containers = ['content-copy-blocks', 'content-platform-matrix', 'content-cover-copy', 'content-platform-checks'];
    for (const identifier of containers) byId(identifier)?.replaceChildren();
    const readiness = result.publication_readiness || {};
    const blocks = Array.isArray(readiness.copy_blocks) && readiness.copy_blocks.length === 3 ? readiness.copy_blocks : fallbackCopyBlocks(result);
    for (const block of blocks) {
        const card = element('article'); card.className = `copy-block ${block.status || 'pass'}`;
        const head = element('div'); head.className = 'copy-block-head';
        const heading = element('div'); heading.append(element('strong', block.label), element('span', checkLabel(block.status)));
        heading.lastElementChild.className = checkClass(block.status);
        head.append(heading, element('span', block.counter || `${block.character_count || 0} 字`));
        head.lastElementChild.className = 'copy-block-counter';
        const preview = element('pre', block.text || '当前没有可复制内容');
        const note = element('p', block.note || '复制前请快速通读一次。'); note.className = 'copy-block-note';
        const actions = element('div'); actions.className = 'copy-block-actions';
        const copy = element('button', block.text ? `复制${block.label}` : '暂无可复制内容'); copy.type = 'button'; copy.disabled = !block.text;
        bindCopyButton(copy, block.text, block.label);
        actions.append(copy);
        card.append(head, preview, note, actions);
        byId('content-copy-blocks').append(card);
    }

    const matrix = Array.isArray(readiness.platform_matrix) ? readiness.platform_matrix : [];
    byId('content-platform-matrix').closest('.platform-matrix-panel').hidden = !matrix.length;
    for (const variant of matrix) {
        const card = element('article'); card.className = `matrix-card${variant.selected ? ' is-selected' : ''}`;
        const head = element('div'); head.className = 'matrix-card-head';
        const badge = element('em', checkLabel(variant.status)); badge.className = checkClass(variant.status);
        head.append(element('strong', `${variant.platform}${variant.selected ? ' · 当前' : ''}`), badge);
        const summary = variant.summary || { pass_count: 0, warning_count: 0, fail_count: 0 };
        const stats = element('div'); stats.className = 'matrix-card-stats';
        for (const block of variant.copy_blocks || []) stats.append(element('span', `${block.label} ${block.counter}`));
        const note = element('p', `通过 ${summary.pass_count} 项；需调整 ${summary.warning_count} 项；不通过 ${summary.fail_count} 项。${(variant.checks?.layout?.tips || []).slice(0, 1).join('')}`);
        const contentText = (variant.copy_blocks || []).map(block => block.text).filter(Boolean).join('\n\n');
        const copy = element('button', variant.selected ? '复制当前整套' : `复制${variant.platform}整套`); copy.type = 'button';
        bindCopyButton(copy, contentText, `${variant.platform}整套内容`);
        card.append(head, stats, note, copy);
        byId('content-platform-matrix').append(card);
    }

    const cover = readiness.cover_copy;
    if (cover) {
        const preview = element('div'); preview.className = 'cover-copy-preview';
        preview.append(element('small', cover.eyebrow), element('strong', cover.headline), element('span', cover.support), element('em', cover.badge));
        const meta = element('div'); meta.className = 'cover-copy-meta';
        meta.append(element('span', `版式：${cover.suggested_layout}`), element('span', `参考图：${cover.image_caption}`), element('span', cover.footer));
        const actions = element('div'); actions.className = 'cover-copy-actions';
        const copyAll = element('button', '复制整段封面文案'); copyAll.type = 'button'; bindCopyButton(copyAll, cover.copy_text, '封面文案');
        const copyHeadline = element('button', '只复制主标题'); copyHeadline.type = 'button'; copyHeadline.className = 'secondary'; bindCopyButton(copyHeadline, cover.headline, '封面主标题');
        actions.append(copyAll, copyHeadline);
        byId('content-cover-copy').append(preview, meta, actions, element('p', cover.safety_note));
        byId('content-cover-copy').lastElementChild.className = 'copy-block-note';
    } else {
        byId('content-cover-copy').append(element('p', '封面文案暂未生成；可直接复制正文首段作为纯文字封面。'));
    }

    const checks = readiness.checks;
    if (!checks) {
        byId('content-platform-checks').append(element('p', '当前结果未包含平台尺寸检查，请重新生成内容。'));
    } else {
        const head = element('div'); head.className = 'platform-check-head';
        const heading = element('strong', `${result.platform}｜长度、图片与排版`);
        const badge = element('span', checkLabel(checks.overall_status)); badge.className = checkClass(checks.overall_status);
        head.append(heading, badge);
        const summary = element('p', `通过 ${checks.summary.pass_count} 项；需调整 ${checks.summary.warning_count} 项；不通过 ${checks.summary.fail_count} 项。`); summary.className = 'platform-check-summary';
        const list = element('ul'); list.className = 'platform-check-list';
        for (const item of checks.items || []) {
            const row = element('li'); row.className = 'platform-check-item';
            const status = element('em', checkLabel(item.status)); status.className = checkClass(item.status);
            row.append(element('strong', item.label), element('span', item.summary || item.value || ''), status);
            list.append(row);
            if (item.id === 'image_checks' && item.items?.length) {
                const dimensions = element('ul'); dimensions.className = 'image-dimension-list';
                for (const image of item.items) {
                    const entry = element('li');
                    entry.append(element('span', `${image.order || ''}${image.order ? '. ' : ''}${plainText(image.file_name)}`), element('strong', `${image.dimension_label || '尺寸待读取'}${image.aspect_ratio ? ` · ${image.aspect_ratio}` : ''}`));
                    dimensions.append(entry);
                }
                list.append(dimensions);
            }
        }
        const layout = element('p', `建议结构：${(checks.layout?.structure || []).join(' → ')}。${(checks.layout?.tips || []).join(' ')}`); layout.className = 'layout-tip';
        const note = element('p', checks.note || '平台规则可能调整，发布时以编辑器提示为准。'); note.className = 'rules-note';
        byId('content-platform-checks').append(head, summary, list, layout, note);
    }

    const pack = readiness.image_pack;
    const packLink = byId('content-download-images');
    packLink.href = `/api/runs/${encodeURIComponent(state.contentJobId)}/images.zip`;
    packLink.textContent = pack?.total_count ? '下载审稿图片包' : '下载图片包说明';
    packLink.title = pack?.note || '下载图片、尺寸和授权状态清单';
}

function renderContentHistory() {
    const panel = byId('content-history-panel');
    const container = byId('content-history');
    container.replaceChildren();
    panel.hidden = !state.contentHistory.length;
    for (const entry of state.contentHistory) {
        const button = element('button', `${entry.platform}｜${entry.product}｜${entry.time}`);
        button.type = 'button';
        button.title = `复用 ${entry.platform} 内容`;
        button.addEventListener('click', () => {
            state.contentJobId = entry.jobId;
            renderContentDraftResult(entry.result, entry.markdown, { fromHistory: true });
            showWizardStep(3, { scroll: false });
            contentStatus(`已恢复 ${entry.time} 生成的${entry.platform}内容，可继续复制或下载。`);
            byId('content-draft-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        container.append(button);
    }
}

function rememberContentResult(result, markdown) {
    const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    const same = state.contentHistory.findIndex(entry => entry.jobId === state.contentJobId);
    if (same >= 0) state.contentHistory.splice(same, 1);
    state.contentHistory.unshift({ jobId: state.contentJobId, result, markdown, platform: result.platform, product: result.product?.resolved_name || result.product?.product_name || '候选产品', time });
    state.contentHistory = state.contentHistory.slice(0, 5);
    renderContentHistory();
}

function downloadJson(value, fileName) {
    const blob = new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = element('a'); link.href = url; link.download = fileName; link.hidden = true;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadStoreTaskPack() {
    if (!state.contentResult) return;
    const result = state.contentResult;
    const readiness = result.publication_readiness || {};
    const payload = {
        schema_version: '1.0',
        kind: 'store-content-task-pack',
        generated_at: new Date().toISOString(),
        product: result.product,
        selected_platform: result.platform,
        platforms: (readiness.platform_matrix || []).map(item => ({
            platform: item.platform,
            selected: item.selected,
            status: item.status,
            copy_blocks: item.copy_blocks,
            cover_copy: item.cover_copy,
            checks: item.checks,
        })),
        image_pack: readiness.image_pack,
        note: '三平台内容可直接复制；图片包的授权状态以清单为准，公开发布前仍需人工确认。',
    };
    const safeProduct = String(result.product?.resolved_name || 'candidate').replace(/[<>:"/\\|?*/]/g, '-').slice(0, 40);
    downloadJson(payload, `huawei-store-task-pack-${safeProduct}-${new Date().toISOString().slice(0, 10)}.json`);
    showCopyFeedback('门店任务包已导出，包含三平台文案、封面文案和发布检查。');
}

function renderContentDraftResult(result, markdown, options = {}) {
    state.contentResult = result;
    renderPublicationReadiness(result);
    renderVerificationResult(result.verification);
    byId('content-draft').replaceChildren();
    byId('content-image-sources').replaceChildren();
    byId('content-insertion-plan').replaceChildren();
    const readiness = result.publication_readiness;
    const platformCheck = readiness?.checks;
    byId('content-summary').textContent = `平台：${result.platform}；内容：标题、正文、标签已分块；平台检查：${platformCheck ? checkLabel(platformCheck.overall_status) : '未包含'}；资料检查：${plainText(result.verification.status_label)}；产品：${result.product.resolved_name}；可核对资料：${result.citations.length} 项；图片：${result.image_sources.length} 张（发布授权状态单独标注）。`;
    const article = element('article'); article.className = 'content-draft-copy';
    article.append(element('h3', plainText(result.draft.title)), element('p', plainText(result.draft.lead)));
    const body = element('div'); body.className = 'content-body-with-images';
    appendDraftBodyWithImages(body, result.draft.body_markdown, result.demo_illustrations || result.image_sources);
    article.append(body, element('strong', '下一步沟通'), element('p', plainText(result.draft.cta)));
    article.append(element('p', `内容标签：${result.draft.tags.map(tag => plainText(tag)).join('、')}`));
    byId('content-draft').append(article);

    if (!result.image_sources.length) byId('content-image-sources').append(element('p', '本次未使用图片；没有用其他型号或未确认图片替代。'));
    const sourceList = element('div'); sourceList.className = 'content-source-list';
    for (const image of result.image_sources) {
        const item = element('details'); item.className = 'content-source-item';
        item.append(element('summary', plainText(image.caption)));
        item.append(element('p', `资料来源：${plainText(image.source_name)}`));
        item.append(element('p', '使用状态：型号已核对；公开发布授权和人工终审仍需确认。'));
        const original = safeSourceLink(image.original_url, '查看图片来源'); if (original) item.append(original);
        const page = image.page_url ? safeSourceLink(image.page_url, '查看产品页面') : null; if (page) item.append(page);
        sourceList.append(item);
    }
    byId('content-image-sources').append(sourceList);

    if (!result.insertion_plan.length) {
        byId('content-insertion-plan').append(element('p', '没有建议的图片插入位置。'));
    } else {
        const plan = element('ol');
        for (const item of result.insertion_plan) plan.append(element('li', `${plainText(item.position)}｜${plainText(item.instruction)}｜${plainText(item.caption)}`));
        byId('content-insertion-plan').append(plan);
    }
    byId('content-markdown').textContent = markdown;
    state.contentMarkdown = markdown;
    byId('content-download-json').href = `/api/runs/${encodeURIComponent(state.contentJobId)}/export?format=json`;
    byId('content-download-markdown').href = `/api/runs/${encodeURIComponent(state.contentJobId)}/export?format=markdown`;
    byId('content-draft-results').hidden = false;
    byId('content-draft-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    updateWizardChrome();
    contentStatus(`发布前检查完成：${plainText(result.verification.status_label)}。${result.verification.safe_content_ready ? '已生成更稳妥的版本，仍请发布负责人做最终确认。' : '当前版本暂不可用，请先处理问题。'}`);
    if (!options.fromHistory) rememberContentResult(result, markdown);
}

function appendInlineList(container, label, values, empty = '暂无') {
    const title = element('strong', label);
    const list = element('ul');
    const items = (values || []).filter(value => value !== null && value !== undefined && value !== '');
    if (!items.length) list.append(element('li', empty));
    else for (const value of items) list.append(element('li', plainText(value)));
    container.append(title, list);
}

function renderMatchSummary(result) {
    const verification = result.verification || {};
    const scope = result.provenance?.requested_mode === 'hybrid' ? '产品资料库与产品目录' : '产品目录与已有资料';
    const analysis = result.provenance?.model?.status === 'called' ? '已结合智能分析整理推荐理由' : '按已核对资料整理推荐理由';
    return `找到 ${verification.candidate_count ?? result.candidates.length} 个候选型号；可直接推荐 ${verification.recommended_count ?? 0} 个；仍需确认 ${verification.pending_count ?? 0} 个。\n本次查询范围：${scope}；${analysis}。\n推荐顺序只表示当前资料下的优先查看顺序，不代表匹配概率或成交概率。`;
}

function renderMatchCandidate(candidate, index) {
    const article = element('article');
    article.className = `result-card match-card ${candidate.status}`;
    const heading = element('div'); heading.className = 'match-heading';
    const evidenceLabel = candidate.evidence_status === 'verified_fact_partial' ? '已有部分产品资料' : candidate.evidence_status === 'discovery_only' ? '目前只找到产品目录' : '资料仍需确认';
    heading.append(element('strong', `${index + 1}. ${plainText(candidate.status_label)}｜${plainText(candidate.product_name)}`), element('span', `${plainText(candidate.category)}${candidate.operating_system ? ' · ' + plainText(candidate.operating_system) : ''} · ${evidenceLabel}`));
    article.append(heading);

    appendInlineList(article, '为什么优先查看', (candidate.matching_reasons || []).map(reason => reason.text), '当前没有通过资料核对的推荐理由。');
    appendInlineList(article, '客户需求是否被资料支持', (candidate.criteria_coverage || []).map(item => `${criterionLabel(item.kind)}：${coverageLabel(item.status)}｜${plainText(item.note)}`), '暂时没有可对照的需求条件。');
    appendInlineList(article, '需要提前说明的限制', candidate.limitations, '暂无额外限制。');
    appendInlineList(article, '还需要向客户确认', candidate.missing_information, '暂无已识别的缺失信息，但仍需人工确认配置与价格。');

    const evidence = candidate.evidence || [];
    if (evidence.length) {
        const details = element('details');
        details.append(element('summary', `查看 ${Math.min(evidence.length, 5)} 条产品资料依据`));
        const list = element('ul'); list.className = 'match-evidence';
        for (const item of evidence.slice(0, 5)) {
            const row = element('li');
            row.append(element('strong', cleanSourceTitle(item.title)));
            row.append(element('p', plainText(String(item.excerpt || '').replace(/\s+/g, ' ').slice(0, 280))));
            if (item.url) {
                const link = safeSourceLink(item.url, '查看华为公开页面');
                if (link) row.append(link);
            }
            list.append(row);
        }
        details.append(list);
        article.append(details);
    }

    const actions = element('div'); actions.className = 'match-actions';
    if (sourceProducts.includes(candidate.product_name)) {
        const use = element('button', '带入报价与成交'); use.type = 'button'; use.className = 'match-use-candidate';
        use.addEventListener('click', () => { byId('product').value = candidate.product_name; renderSourceStatus(); status('已带入所选型号，请重新检查资料后生成结果。'); showWizardStep(4); });
        actions.append(use);
    }
    const content = element('button', `准备${byId('content-platform').value}内容`); content.type = 'button'; content.className = 'content-generate-candidate';
    content.title = '重新核对所选型号、产品资料和可使用的图片后再生成内容';
    content.addEventListener('click', () => startContentDraft(candidate.candidate_id));
    actions.append(content);
    article.append(actions);
    return article;
}

function renderProductMatchResult(result, markdown) {
    byId('match-candidates').replaceChildren();
    byId('match-diagnostics').replaceChildren();
    byId('match-summary').textContent = renderMatchSummary(result);
    const criteria = element('div', `本次选品条件：${result.criteria.map(item => `${criterionLabel(item.kind)}：${readable(item.value)}`).join('；') || '待确认'}`);
    criteria.className = 'notice';
    byId('match-candidates').append(criteria);
    const candidates = result.candidates || [];
    for (const [index, candidate] of candidates.slice(0, 3).entries()) byId('match-candidates').append(renderMatchCandidate(candidate, index));
    if (candidates.length > 3) {
        const details = element('details');
        details.append(element('summary', `查看其余 ${candidates.length - 3} 个候选型号`));
        for (const [offset, candidate] of candidates.slice(3).entries()) details.append(renderMatchCandidate(candidate, offset + 3));
        byId('match-candidates').append(details);
    }
    if (!candidates.length) byId('match-candidates').append(element('p', '这次没有找到可展示的候选型号，也没有用未核对的常识补造产品。'));
    const notes = [...new Set((result.diagnostics || []).map(diagnosticText))];
    appendList(byId('match-diagnostics'), '需要确认的问题', notes, '暂无额外问题；仍须人工确认具体配置、价格和软件兼容性。');
    state.matchMarkdown = markdown;
    byId('match-download-json').href = `/api/runs/${encodeURIComponent(state.matchJobId)}/export?format=json`;
    byId('match-download-markdown').href = `/api/runs/${encodeURIComponent(state.matchJobId)}/export?format=markdown`;
    byId('match-results').hidden = false;
    matchStatus(`选品结果已生成：可直接推荐 ${result.verification.recommended_count} 个，仍需确认 ${result.verification.pending_count} 个。请先核对限制和待确认项。`, result.verification.recommended_count === 0);
    updateWizardChrome();
}

function demoNotice(message) {
    byId('demo-status').textContent = message;
}

function lockDemoControls() {
    byId('input-fields').disabled = true;
    byId('match-fields').disabled = true;
    byId('profile-opening').disabled = true;
    byId('profile-answer').readOnly = true;
    byId('profile-start').disabled = true;
    byId('profile-answer-button').disabled = !state.access.canRun || demoReplay.phase !== 'answer';
    byId('profile-answer-button').textContent = '确认本轮并保存';
    for (const id of ['use-cloud-model', 'use-ima', 'use-web-research', 'match-use-cloud-model', 'match-use-ima']) {
        byId(id).checked = false;
        byId(id).disabled = true;
    }
    for (const id of ['refresh-source-status', 'new-customer', 'match-clear', 'profile-reset', 'profile-restart-complete']) byId(id).disabled = true;
    for (const button of document.querySelectorAll('[id^="example-"], [id^="match-example-"]')) if (button.tagName === 'BUTTON') button.disabled = true;
    byId('run-button').disabled = !state.access.canRun || demoReplay.scenario?.rounds.at(-1).result !== state.profileResult;
    byId('match-button').disabled = !state.access.canRun || state.profileResult?.status !== 'complete';
    byId('profile-to-match').disabled = state.profileResult?.status !== 'complete';
    byId('engine-status').textContent = engineStatus({ mode: 'preset' });
    byId('capability-status').textContent = '预置演示：全部外部能力已关闭。';
    byId('match-capability-status').textContent = '预置演示：直接读取已保存结果。';
    byId('profile-model-status').textContent = '预置六轮访谈 · 无模型调用';
    byId('source-status-summary').textContent = `使用预置资料快照，录制于 ${formatDate(demoBundle.recorded_at)}；本次未查询当前资料。`;
}

function clearDemoTimer() {
    clearTimeout(demoReplay.timer);
    demoReplay.timer = null;
}

function scheduleDemo(delay = 3800) {
    clearDemoTimer();
    if (!demoReplay.active || demoReplay.paused || !byId('demo-auto').checked || demoReplay.phase === 'complete') return;
    demoReplay.timer = setTimeout(() => {
        demoReplay.timer = null;
        if (demoReplay.active && !demoReplay.paused && state.access.canRun) advanceDemo(false);
    }, delay);
}

function updateDemoControls() {
    byId('demo-title').closest('.demo-panel').classList.add('is-playing');
    for (const id of ['demo-pause', 'demo-next', 'demo-exit']) byId(id).hidden = !demoReplay.active;
    byId('demo-pause').textContent = demoReplay.paused ? '继续播放' : '暂停讲解';
    byId('demo-pause').setAttribute('aria-pressed', String(demoReplay.paused));
    byId('demo-next').disabled = !state.access.canRun || demoReplay.phase === 'complete';
    byId('demo-next').textContent = ({ question: '填入本轮回答', answer: '确认本轮并保存', profile: '查看预置产品匹配', match: '查看三平台图文', content: '查看下一平台 / 成交准备', complete: '完整演示已结束' })[demoReplay.phase] || '下一步';
    for (const id of ['procurement', 'creator']) {
        byId(`demo-${id}`).classList.toggle('is-selected', demoReplay.active && demoReplay.scenario?.id === id);
        byId(`demo-${id}`).setAttribute('aria-pressed', String(demoReplay.active && demoReplay.scenario?.id === id));
    }
    lockDemoControls();
}

function readDemoConfirmation(scenarioId = null) {
    try {
        const saved = JSON.parse(localStorage.getItem(scenarioId ? `${demoStorageKey}.${scenarioId}` : demoStorageKey) || 'null');
        const scenario = demoBundle.scenarios.find(item => item.id === saved?.scenario_id);
        if (!scenario || saved.version !== demoBundle.version || saved.fingerprint !== demoBundle.fingerprint || !Array.isArray(saved.rounds) || saved.rounds.length > scenario.rounds.length) return null;
        // Stored data cannot replace the bundled results or introduce customer text.
        if (!saved.rounds.every((round, index) => round.index === index && round.answer === scenario.rounds[index].answer && round.question === scenario.rounds[index].question.text)) return null;
        return saved;
    } catch { return null; }
}

function persistDemoConfirmation(index) {
    const round = demoReplay.scenario.rounds[index];
    demoReplay.confirmed[index] = { index, question: round.question.text, answer: round.answer, result: round.result, confirmed_at: new Date().toISOString() };
    // Only a contiguous, explicitly confirmed prefix is offered for restoration.
    const rounds = [];
    for (const item of demoReplay.confirmed) { if (!item) break; rounds.push(item); }
    try {
        const record = JSON.stringify({ version: demoBundle.version, fingerprint: demoBundle.fingerprint, scenario_id: demoReplay.scenario.id, rounds });
        localStorage.setItem(`${demoStorageKey}.${demoReplay.scenario.id}`, record);
        localStorage.setItem(demoStorageKey, record);
        byId('demo-save-status').textContent = `本轮回答与预置结果已确认并保存到本机；连续确认 ${rounds.length}/6 轮。随页面保存的完整预置不受影响。`;
    } catch {
        byId('demo-save-status').textContent = '本轮已确认，浏览器未允许本机保存；请导出演示包保留确认记录。完整预置仍可回放。';
    }
}

function setDemoDownload(identifier, payload, fileName, mime = 'application/json;charset=utf-8') {
    const blob = new Blob([typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)], { type: mime });
    const url = URL.createObjectURL(blob);
    demoReplay.urls.push(url);
    byId(identifier).href = url;
    byId(identifier).download = fileName;
}

function demoDownloads(prefix, snapshot) {
    setDemoDownload(`${prefix}json`, snapshot.result, `${demoReplay.scenario.id}-${prefix}preset.json`);
    setDemoDownload(`${prefix}markdown`, snapshot.markdown, `${demoReplay.scenario.id}-${prefix}preset.md`, 'text/markdown;charset=utf-8');
}

function startDemo(id) {
    if (state.running || !state.access.canRun) return;
    const scenario = demoBundle.scenarios.find(item => item.id === id);
    if (!scenario) return;
    clearDemoTimer();
    demoReplay.active = false;
    resetProfileInterview({ silent: true });
    clearMatchResult();
    clearResult();
    for (const url of demoReplay.urls) URL.revokeObjectURL(url);
    Object.assign(demoReplay, { active: true, scenario, round: 0, phase: 'question', paused: false, urls: [], confirmed: readDemoConfirmation(id)?.rounds || [] });
    clearTimeout(state.sourceTimer);
    state.sourceTimer = null;
    state.polling = state.matchPolling = state.contentPolling = state.profilePolling = false;
    state.contentHistory = [];
    renderContentHistory();
    byId('growth-form').reset();
    byId('match-form').reset();
    byId('profile-start-form').hidden = true;
    state.profileStarted = true;
    state.profileMessages = [];
    byId('demo-save-status').textContent = '预置答案和各步结果已随页面保存。自动播放读取预置；点击“确认本轮并保存”可另存本机确认记录。';
    byId('demo-resume').hidden = !readDemoConfirmation(id)?.rounds.length;
    showWizardStep(1);
    demoAskRound();
}

function demoAskRound() {
    const round = demoReplay.scenario.rounds[demoReplay.round];
    demoReplay.phase = 'question';
    state.profileMessages.push({ role: 'assistant', content: round.question.text });
    appendProfileMessage('assistant', round.question.text);
    setProfileQuestion(round.question);
    byId('profile-answer').value = '';
    demoNotice(`${demoReplay.scenario.label} · 第 ${demoReplay.round + 1}/6 轮追问：先展示问题，再填入本轮预置回答。`);
    profileStatus('正在回放预置追问；本轮回答尚未填入，不调用智能分析。');
    updateDemoControls();
    scheduleDemo(1600);
}

function demoFillAnswer() {
    demoReplay.phase = 'answer';
    byId('profile-answer').value = demoReplay.scenario.rounds[demoReplay.round].answer;
    profileStatus('本轮预置回答已填入。点击确认可保存本机记录；自动播放只读取随页面保存的样例。');
    demoNotice(`第 ${demoReplay.round + 1}/6 轮回答已逐步填入。可暂停讲解，点击“确认本轮并保存”留下本机确认记录。`);
    updateDemoControls();
    scheduleDemo(4600);
}

function demoConfirmRound(explicit) {
    if (!demoReplay.active || demoReplay.phase !== 'answer' || !state.access.canRun) return;
    clearDemoTimer();
    const round = demoReplay.scenario.rounds[demoReplay.round];
    if (explicit) persistDemoConfirmation(demoReplay.round);
    state.profileMessages.push({ role: 'user', content: round.answer });
    appendProfileMessage('user', round.answer);
    byId('profile-answer').value = '';
    renderProfileResult(round.result);
    state.profileResult = round.result;
    demoReplay.round += 1;
    if (demoReplay.round < demoReplay.scenario.rounds.length) { demoAskRound(); return; }
    demoReplay.phase = 'profile';
    demoNotice('六轮追问已回放，画像保留各轮原话依据。接下来演示产品匹配；预算仍为待确认。');
    updateDemoControls();
    scheduleDemo(4200);
}

function demoShowMatch() {
    if (!demoReplay.active || state.profileResult?.status !== 'complete') { demoNotice('请先完成六轮画像，再查看产品匹配。'); return; }
    clearDemoTimer();
    const snapshot = demoReplay.scenario.match;
    state.matchInput = snapshot.input;
    const profile = snapshot.input.profile;
    const values = { 'match-raw-request': profile.raw_request, 'match-audience': profile.audience, 'match-scenario': profile.scenario,
        'match-industry': profile.industry, 'match-company-size': profile.company_size, 'match-product-type': profile.product_type,
        'match-needs': profile.needs.join('，'), 'match-preferences': profile.preferences.join('，'), 'match-pain-points': profile.pain_points.join('，') };
    byId('match-form').reset();
    for (const [id, value] of Object.entries(values)) byId(id).value = value ?? '';
    clearMatchResult();
    renderProductMatchResult(snapshot.result, snapshot.markdown);
    demoDownloads('match-download-', snapshot);
    showWizardStep(2);
    demoReplay.phase = 'match';
    demoNotice('已读取预置产品匹配：按客户条件展示候选、依据与待确认项；没有实时查询资料。');
    updateDemoControls();
    scheduleDemo(5200);
}

function demoShowContent(platform) {
    if (!demoReplay.active || state.profileResult?.status !== 'complete') { demoNotice('请先完成六轮画像，再查看图文。'); return; }
    clearDemoTimer();
    const snapshot = demoReplay.scenario.contents[platform];
    if (!snapshot) return;
    state.matchInput = demoReplay.scenario.match.input;
    state.contentPlatform = platform;
    byId('content-platform').value = platform;
    clearContentResult();
    renderContentDraftResult(snapshot.result, snapshot.markdown, { fromHistory: true });
    demoDownloads('content-download-', snapshot);
    setDemoDownload('content-download-images', { note: '原创场景示意图，非产品实拍。svg 字段可另存为同名 .svg 文件。', images: snapshot.result.demo_illustrations }, `${demoReplay.scenario.id}-${platform}-illustrations.json`);
    byId('content-download-images').textContent = '下载原创插图与清单';
    byId('content-summary').textContent = `预置${platform}图文 · ${snapshot.result.demo_illustrations.length} 张原创场景插图（非产品实拍） · 标题/正文/标签可复制。下方发布核验为原稿录制时快照，不能视为当前核验。`;
    byId('content-verification-summary').prepend(element('p', `原稿审稿记录 · 录制于 ${formatDate(demoBundle.recorded_at)}。原审稿产品图未打包；当前展示项目原创场景插图。`));
    byId('content-image-sources').replaceChildren(element('p', '当前插图由项目原创，随页面内嵌保存；未使用第三方产品照片。非产品外观、配置或兼容性证据。'));
    contentStatus(`预置${platform}图文已读取；未调用生成服务。`);
    showWizardStep(3);
    demoReplay.phase = 'content';
    demoNotice(`正在展示${platform}：三平台使用不同标题、结构和语气；每张图均可断网显示。`);
    updateDemoControls();
    scheduleDemo(6200);
}

function demoShowSales() {
    if (!demoReplay.active || state.profileResult?.status !== 'complete') { demoNotice('请先完成六轮画像，再查看成交准备。'); return; }
    clearDemoTimer();
    const snapshot = demoReplay.scenario.sales;
    for (const [key, id] of [['product', 'product'], ['platform', 'platform'], ['audience', 'audience'], ['scenario', 'scenario'], ['raw_request', 'raw-request']]) byId(id).value = snapshot.input[key];
    byId('demo-pricing').checked = demoReplay.scenario.id === 'procurement';
    renderResult(snapshot.result, snapshot.markdown);
    byId('example-note').textContent = `预置客户：${demoReplay.scenario.label}。输入已锁定；内容沿用第 3 步已保存稿件，报价和成交动作读取预置结果。`;
    byId('policy-summary').textContent = demoReplay.scenario.id === 'procurement'
        ? '仅作五台演示：6000 → 5880 → 5780 → 5780 → 5730 元 / 台；合计 28650 元。非官方政策、非成交报价。'
        : '个人客户：预算未定，不启用五台演示测算，正式报价保持待确认。';
    demoDownloads('download-', snapshot);
    demoReplay.phase = 'complete';
    demoNotice('完整演示已结束：六轮画像 → 产品匹配 → 公众号 / 小红书 / 朋友圈图文 → 成交准备。可切换步骤复看或选择另一位客户。');
    byId('result-summary').prepend(element('strong', '离线预置销售结果 · 录制时快照；企业样例为 5 台假设测算，个人样例无正式报价。\n'));
    updateDemoControls();
}

function advanceDemo(explicit = true) {
    if (!demoReplay.active || !state.access.canRun) return;
    clearDemoTimer();
    if (demoReplay.phase === 'question') demoFillAnswer();
    else if (demoReplay.phase === 'answer') demoConfirmRound(explicit);
    else if (demoReplay.phase === 'profile') demoShowMatch();
    else if (demoReplay.phase === 'match') demoShowContent('公众号');
    else if (demoReplay.phase === 'content') {
        const platforms = ['公众号', '小红书', '朋友圈'];
        const next = platforms.indexOf(state.contentPlatform) + 1;
        if (next < platforms.length) demoShowContent(platforms[next]);
        else demoShowSales();
    }
}

function demoNavigateStep(step) {
    demoReplay.paused = true;
    clearDemoTimer();
    if (step === 1) showWizardStep(1);
    else if (state.profileResult?.status !== 'complete') demoNotice('请先用上方按键完成六轮追问，再查看后续预置结果。');
    else if (step === 2) demoShowMatch();
    else if (step === 3) demoShowContent(state.contentResult?.platform || demoReplay.scenario.defaultPlatform);
    else if (step === 4) demoShowSales();
    updateDemoControls();
}

function exitDemo(options = {}) {
    if (!demoReplay.active) return;
    clearDemoTimer();
    demoReplay.active = false;
    state.matchInput = null;
    resetProfileInterview({ silent: true });
    clearMatchResult();
    clearResult();
    state.contentHistory = [];
    renderContentHistory();
    byId('growth-form').reset();
    byId('match-form').reset();
    byId('profile-answer').readOnly = false;
    byId('profile-answer').disabled = false;
    byId('profile-answer-button').textContent = '提交并分析';
    renderCapabilities(state.capabilities || {});
    for (const id of ['match-clear', 'profile-reset', 'profile-restart-complete']) byId(id).disabled = false;
    for (const id of ['demo-pause', 'demo-next', 'demo-exit']) byId(id).hidden = true;
    byId('demo-title').closest('.demo-panel').classList.remove('is-playing');
    for (const id of ['procurement', 'creator']) { byId(`demo-${id}`).classList.remove('is-selected'); byId(`demo-${id}`).setAttribute('aria-pressed', 'false'); }
    for (const url of demoReplay.urls) URL.revokeObjectURL(url);
    demoReplay.urls = [];
    for (const id of ['download-json', 'download-markdown', 'match-download-json', 'match-download-markdown', 'content-download-json', 'content-download-markdown', 'content-download-images']) byId(id).removeAttribute('href');
    setRunning(false);
    showWizardStep(1, { scroll: false });
    byId('engine-status').textContent = '已退出预置演示；正常功能按当前系统配置运行。';
    demoNotice('已退出演示并清除页面中的演示结果。本机确认记录仍可继续，普通客户输入不会写入演示存储。');
    byId('demo-resume').hidden = !readDemoConfirmation()?.rounds.length;
    if (options.refresh !== false) refreshSourceStatus();
}

byId('demo-procurement').addEventListener('click', () => startDemo('procurement'));
byId('demo-creator').addEventListener('click', () => startDemo('creator'));
byId('demo-next').addEventListener('click', () => advanceDemo(true));
byId('demo-pause').addEventListener('click', () => {
    demoReplay.paused = !demoReplay.paused;
    updateDemoControls();
    if (demoReplay.paused) { clearDemoTimer(); demoNotice('已暂停，可讲解当前内容或手动继续；本次不会发起业务请求。'); }
    else scheduleDemo(1200);
});
byId('demo-auto').addEventListener('change', () => { if (byId('demo-auto').checked) scheduleDemo(1600); else clearDemoTimer(); });
byId('demo-exit').addEventListener('click', () => exitDemo());
byId('demo-export').addEventListener('click', () => downloadJson({ ...demoBundle, local_confirmation: { saved: demoBundle.scenarios.map(scenario => readDemoConfirmation(scenario.id)).filter(Boolean), current_rounds: demoReplay.confirmed } }, 'huawei-offline-demo-presets.json'));
byId('demo-resume').addEventListener('click', () => {
    const saved = readDemoConfirmation(demoReplay.active ? demoReplay.scenario.id : null);
    if (!saved?.rounds.length || !state.access.canRun) return;
    startDemo(saved.scenario_id);
    demoReplay.paused = true;
    clearDemoTimer();
    for (let index = 0; index < saved.rounds.length; index += 1) {
        demoReplay.confirmed[index] = saved.rounds[index];
        demoFillAnswer();
        demoConfirmRound(false);
    }
    updateDemoControls();
    byId('demo-save-status').textContent = `已恢复本机确认的前 ${saved.rounds.length} 轮，处于暂停状态。`;
});
byId('demo-resume').hidden = !readDemoConfirmation()?.rounds.length;

for (const button of document.querySelectorAll('.wizard-step')) button.addEventListener('click', () => {
    if (demoReplay.active) { demoNavigateStep(Number(button.dataset.stepTarget)); return; }
    showWizardStep(Number(button.dataset.stepTarget));
});
byId('wizard-prev').addEventListener('click', () => { if (state.wizardStep > 1) { if (demoReplay.active) demoNavigateStep(state.wizardStep - 1); else showWizardStep(state.wizardStep - 1); } });
byId('wizard-next').addEventListener('click', goToNextWizardStep);

byId('profile-start-form').addEventListener('submit', startGuidedProfile);
byId('profile-answer-form').addEventListener('submit', submitProfileAnswer);
byId('profile-reset').addEventListener('click', () => resetProfileInterview());
byId('profile-restart-complete').addEventListener('click', () => resetProfileInterview());
byId('profile-to-match').addEventListener('click', fillMatchFromProfile);

byId('growth-form').addEventListener('submit', startRun);
byId('content-platform').addEventListener('change', () => {
    if (demoReplay.active) { demoShowContent(byId('content-platform').value); return; }
    clearContentResult();
    document.querySelectorAll('.content-generate-candidate').forEach(button => { button.textContent = `准备${byId('content-platform').value}内容`; });
});
byId('match-form').addEventListener('submit', startProductMatch);
byId('match-clear').addEventListener('click', clearMatchCustomer);
for (let index = 0; index < 2; index += 1) byId(`match-example-${index + 1}`).addEventListener('click', () => fillMatchExample(index));
byId('new-customer').addEventListener('click', clearCustomer);
for (let index = 0; index < 3; index += 1) byId(`example-${index + 1}`).addEventListener('click', () => fillExample(index));
for (const identifier of ['raw-request', 'audience', 'product']) byId(identifier).addEventListener('input', () => {
    byId('demo-pricing').checked = false;
    byId('example-note').textContent = '客户描述或产品已变更，演示价格计算已关闭，避免沿用示例假设。';
    byId('policy-summary').textContent = '旧示例设置已清除。如重新勾选，系统会按当前型号和固定 5 台演示数量重新计算。';
    clearResult();
    renderSourceStatus();
});
byId('refresh-source-status').addEventListener('click', async () => {
    if (state.running || state.sourceLoading) return;
    await refreshSourceStatus();
});
byId('resume-polling').addEventListener('click', () => { byId('resume-polling').hidden = true; state.polling = true; pollRun(); });
byId('content-copy-all').addEventListener('click', async () => {
    if (!state.contentResult) return;
    const readiness = state.contentResult.publication_readiness;
    const blocks = readiness?.copy_blocks || fallbackCopyBlocks(state.contentResult);
    const text = blocks.map(block => block.text).filter(Boolean).join('\n\n');
    try {
        await copyPlainText(text);
        showCopyFeedback('已复制整套内容；现在按平台编辑器顺序粘贴即可。');
    } catch (error) {
        showCopyFeedback(`未能自动复制：${plainText(error.message)}。请在复制块中手动选择文字。`, true);
    }
});
byId('content-download-images').addEventListener('click', () => {
    showCopyFeedback('已请求下载审稿图片包；公开发布前仍请核对图片授权。');
});
byId('content-download-task-pack').addEventListener('click', downloadStoreTaskPack);
byId('copy-markdown').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(state.markdown); byId('export-status').textContent = '已复制完整销售说明。'; }
    catch { byId('export-status').textContent = '浏览器未允许复制，请下载销售说明，或从下方内容手动复制。'; }
});
for (const identifier of ['download-json', 'download-markdown']) byId(identifier).addEventListener('click', () => { byId('export-status').textContent = '已请求下载，请在浏览器下载列表确认；若登录已过期，请重新生成后再下载。'; });
document.addEventListener('keydown', event => {
    if (event.repeat || event.isComposing || event.keyCode === 229) return;
    if (event.altKey && !event.ctrlKey && !event.metaKey && ['1', '2', '3'].includes(event.key)) { event.preventDefault(); fillExample(Number(event.key) - 1); }
    if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === 'Enter') { event.preventDefault(); startRun(); }
});

async function initialize(sessionOverride = null) {
    const session = sessionOverride || await window.HuaweiAuth?.ready;
    if (!session) return;
    if (state.access.user?.id === session.user.id && state.csrf) return;
    applyAccessControl(session);
    try {
        const response = await api('/api/examples');
        if (!response.csrf_token || !Array.isArray(response.examples)) throw new Error('工作台数据暂时不完整，请刷新重试');
        state.csrf = response.csrf_token;
        state.examples = response.examples.slice(0, 3);
        state.matchExamples = Array.isArray(response.match_examples) ? response.match_examples.slice(0, 2) : [];
        byId('engine-status').textContent = engineStatus(response.engine);
        renderCapabilities(response.capabilities || {});
        state.profileMax = Number(response.capabilities?.guided_profile_max_turns) || 8;
        renderProfileProgress(null);
        state.examples.forEach((example, index) => { byId(`example-${index + 1}`).textContent = `${plainText(example.label)} · Alt+${index + 1}`; });
        state.matchExamples.forEach((example, index) => { byId(`match-example-${index + 1}`).textContent = plainText(example.label); });
        setRunning(false);
        if (state.examples.length) fillExample(0);
        if (state.matchExamples.length) fillMatchExample(0);
        showWizardStep(1, { scroll: false });
        await refreshSourceStatus();
    } catch (error) { status(`工作台暂时未能准备好：${plainText(error.message)}。请稍后刷新重试。`, true); }
}

window.addEventListener('huawei:authenticated', event => { initialize(event.detail); });
window.addEventListener('huawei:session-ended', () => {
    exitDemo({ refresh: false });
    state.csrf = null;
    state.running = false;
    state.access.canRun = false;
    state.access.user = null;
});
initialize();
