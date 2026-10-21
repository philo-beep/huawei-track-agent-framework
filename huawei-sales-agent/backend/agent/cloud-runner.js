'use strict';

const { runFourSteps, renderMarkdown } = require('./fourstep');
const { loadOfficialReference, officialKnowledge } = require('./official');
const { PipelineError } = require('./support');
const { selectCloudFact, selectionDiagnostics } = require('./cloud-fact-selector');
const { runtimeCapabilities, modelConfig } = require('./config');

const PRODUCTS = ['HUAWEI MateBook 14 鸿蒙版', 'HUAWEI MateBook 14 2024'];
const CAPABILITIES = runtimeCapabilities();
const ENGINE = Object.freeze({
    mode: CAPABILITIES.cloud_model_configured || CAPABILITIES.ima_configured || CAPABILITIES.web_research_configured ? 'hybrid_capable' : 'rules',
    model: CAPABILITIES.cloud_model_configured ? CAPABILITIES.cloud_model_name : null,
    model_status: CAPABILITIES.cloud_model_configured ? 'configured' : 'disabled',
    model_provider: CAPABILITIES.cloud_model_configured ? 'openai-compatible' : null,
    ima_enabled: CAPABILITIES.ima_configured,
    ima_knowledge_base_name: CAPABILITIES.ima_knowledge_base_name,
    web_research_enabled: CAPABILITIES.web_research_configured,
    notice: '云端模型、IMA 与联网检索均为按请求显式启用的能力；事实仍须保留来源并经过核验，不使用未标注网页内容冒充产品事实。',
});

function pricingInput(product) {
    const source = (title, entry) => ({ kind: 'synthetic_fixture', title, entry: `backend/agent/cloud-runner.js#${entry}`, description: '此为基于行业惯例与赛题推断的合理假设，待官方确认。所有金额、资格、地区和SKU均为人为定义，未取得行业或华为政策实证，非真实交易报价。' });
    const policy = {
        id: 'CLOUD-SYNTHETIC-2026', product, sku: 'DEMO-ASSUMED-16G-512G-NOT-VERIFIED', currency: 'CNY', base_unit_cents: 600000,
        valid_from: '2026-01-01', valid_to: '2026-12-31', region: '假设：中国大陆演示地区，真实地区未核实',
        calculation_scope: 'per_unit_then_quantity', rounding: 'half_up_to_cent_each_level', tax_treatment: 'base_includes_tax_no_additional_tax',
        source: source('人为设定含税基价6000元；非官方价格', 'base_unit_cents'),
        rules: [
            { level: 1, operation: 'discount_basis_points', value: 9800, required_eligibility: ['demo_customer'], source: source('客户类型：假设9.8折（保留98%）', 'level1') },
            { level: 2, operation: 'fixed_discount_cents', value: 10000, required_eligibility: ['demo_quantity5'], source: source('采购数量：假设5台，每台减100元', 'level2') },
            { level: 3, operation: 'discount_basis_points', value: 10000, required_eligibility: ['demo_configuration'], source: source('产品配置：假设配置不另折价', 'level3') },
            { level: 4, operation: 'discount_basis_points', value: 9900, cap_discount_cents: 5000, required_eligibility: ['demo_region'], source: source('区域：假设9.9折（保留99%），本级单台优惠封顶50元', 'level4') },
        ],
    };
    return { schema_version: '1.0', mode: 'demo_only', product, sku: policy.sku, quantity: 5, currency: 'CNY', as_of: new Date().toISOString().slice(0, 10), confirmed_eligibility: ['demo_customer', 'demo_quantity5', 'demo_configuration', 'demo_region'], policy };
}

function validateCloudInput(body) {
    const allowed = ['marketing_input', 'demo_pricing', 'use_cloud_model', 'use_ima', 'use_web_research'];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(name => !allowed.includes(name))) throw new PipelineError('INVALID_INPUT', '只允许公开演示输入和三项能力开关');
    for (const name of ['demo_pricing', 'use_cloud_model', 'use_ima', 'use_web_research']) {
        if (body[name] !== undefined && typeof body[name] !== 'boolean') throw new PipelineError('INVALID_INPUT', `${name}必须为布尔值`);
    }
    const input = body.marketing_input;
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(name => !['schema_version', 'mode', 'product', 'audience', 'scenario', 'raw_request', 'platform', 'live_research'].includes(name))) {
        const keys = input && typeof input === 'object' && !Array.isArray(input) ? Object.keys(input).join(',') : typeof input;
        throw new PipelineError('INVALID_INPUT', `只接受公开演示的型号、合成客户描述、场景和平台；不接受私有数据路径或价格政策（marketing_input字段：${keys || '无'}）`);
    }
    if (!PRODUCTS.includes(input.product) || !['公众号', '小红书', '朋友圈'].includes(input.platform)) throw new PipelineError('INVALID_INPUT', '请选择两个官网明确代际型号及支持的平台');
    if ((input.mode !== undefined && !['local', 'ima', 'hybrid'].includes(input.mode)) || (input.schema_version !== undefined && input.schema_version !== '1.0')) throw new PipelineError('INVALID_INPUT', '模式或版本不受支持');
    for (const name of ['audience', 'scenario', 'raw_request']) if (input[name] !== undefined && (typeof input[name] !== 'string' || !input[name].trim() || input[name].length > 800 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input[name]))) throw new PipelineError('INVALID_INPUT', '每项合成描述须为非空文本且不超过800字');
    const useCloudModel = body.use_cloud_model === true;
    const useIma = body.use_ima === true;
    const useWebResearch = body.use_web_research === true;
    const capabilities = runtimeCapabilities();
    if (useCloudModel && !capabilities.cloud_model_configured) throw new PipelineError('MODEL_NOT_CONFIGURED', '云端模型未配置，无法启用模型推理');
    if (useIma && !capabilities.ima_configured) throw new PipelineError('IMA_NOT_CONFIGURED', 'IMA 未配置，无法启用知识库检索');
    if (useWebResearch && !capabilities.web_research_configured) throw new PipelineError('WEB_RESEARCH_DISABLED', '联网检索未启用');
    return {
        marketing_input: { ...input, mode: useIma ? 'hybrid' : 'local', live_research: useWebResearch },
        demo_pricing: body.demo_pricing === true,
        use_cloud_model: useCloudModel,
        use_ima: useIma,
        use_web_research: useWebResearch,
    };
}

function examples() {
    return [
        { id: 'official-harmony', label: '合成示例一：鸿蒙版移动办公', product: PRODUCTS[0], scenario: '核对移动办公文稿打开、编辑、保存与导出的任务条件' },
        { id: 'official-2024', label: '合成示例二：2024版备课', product: PRODUCTS[1], scenario: '备课文稿与课堂展示文件的选型核对，软件版本待确认' },
        { id: 'needs-clarification', label: '合成示例三：场景待补充', product: PRODUCTS[0] },
    ].map(example => ({ id: example.id, label: example.label, synthetic: true, marketing_input: { product: example.product, audience: '合成演示：办公电脑选型用户', ...(example.scenario ? { scenario: example.scenario } : {}), platform: '公众号', mode: 'local' }, demo_pricing: true, pricing_input: pricingInput(example.product) }));
}

function rulesMarketingOptions(input, selectionState) {
    return {
        reasonStrategy: async request => ({ topic: `${request.audience}：${request.scenario}`, platform_rules: { length: '规则核对清单', tone: '克制且保留限制' }, model_analysis: { focus: '核对客户已明确任务', rationale: '规则引擎按明确输入准备核对问题，未知预算、身份和决策权保持待确认；未调用模型', outline: ['确认实际任务与软件版本', '核对官网资料与脚注', '安排人工演示和下一步'] }, analysis_status: 'rules_not_model', model: null, elapsed_ms: 0 }),
        generateCopy: async (request, strategy, facts) => {
            selectionState.value = selectCloudFact(input.marketing_input, facts);
            const selection = selectionState.value;
            strategy.fact_selection = { status: selection.status, focus: selection.focus, evidence: selection.evidence, uncovered: selection.uncovered, deferred: selection.deferred, notice: selection.notice };
            strategy.model_analysis.focus = selection.focus ? `核对${selection.focus.label}` : '通用原文参考，非适配推荐';
            strategy.model_analysis.rationale = selection.notice;
            if (!selection.fact_ids.length) throw new PipelineError('CLOUD_FACT_NEEDS_CLARIFICATION', selection.notice);
            return { model: 'rules_not_model', value: { fact_ids: selection.fact_ids } };
        },
    };
}

async function runCloud(body) {
    const input = validateCloudInput(body);
    if (!officialKnowledge(loadOfficialReference(input.marketing_input.product))) throw new PipelineError('OFFICIAL_SNAPSHOT_UNAVAILABLE', '官网公开快照缺失、过期或核验未通过，云端不回退私有知识库；请维护者刷新公开快照');
    const selectionState = { value: null };
    const options = input.use_cloud_model ? {} : { marketingOptions: rulesMarketingOptions(input, selectionState) };
    const result = await runFourSteps(input.marketing_input, input.demo_pricing ? pricingInput(input.marketing_input.product) : undefined, options);
    const model = modelConfig();
    const modelFallback = (result.diagnostics || []).some(item => ['MODEL_STRATEGY_RULES_FALLBACK', 'MODEL_COPY_RULES_FALLBACK'].includes(item.code));
    result.runtime_engine = {
        mode: input.use_cloud_model ? (modelFallback ? 'cloud_model_with_rules_fallback' : 'cloud_model') : (input.use_ima ? 'hybrid_rules' : 'rules'),
        model: input.use_cloud_model ? model.model : null,
        model_status: input.use_cloud_model ? (modelFallback ? 'called_with_fallback' : 'called') : (model.configured ? 'configured_not_requested' : 'disabled'),
        model_provider: input.use_cloud_model ? 'openai-compatible' : null,
        ima_enabled: input.use_ima,
        ima_connection: result.marketing_result?.ima_connection || 'not_requested',
        web_research_enabled: input.use_web_research,
        notice: input.use_cloud_model ? (modelFallback ? `本次调用 ${model.model}，但部分结构化输出未通过校验，已回退到受约束规则并保留诊断。` : `本次策略与事实选择调用 ${model.model}；产品事实仍由程序按来源原文插入并核验。`) : '本次未调用云端模型；使用规则准备稿。',
    };
    result.content.narrative_status = input.use_cloud_model ? 'cloud_model_constrained_preparation' : 'rules_programmatic_preparation';
    if (selectionState.value) {
        const selection = selectionState.value;
        result.marketing_result.diagnostics.push(...selectionDiagnostics(selection));
        if (!selection.fact_ids.length) {
            result.marketing_result.status = 'needs_clarification';
            result.marketing_result.clarification_questions.push({ field: 'scenario', question: selection.notice, blocks: 'content' });
        }
        if (result.content.marketing_content) result.content.marketing_content.body = `${selection.notice}\n\n${result.content.marketing_content.body}`;
    }
    if (result.content.marketing_content && !input.use_cloud_model) result.content.marketing_content.body = result.content.marketing_content.body.replace('模型只选择事实ID', '规则只选择事实ID').replace('这不代表模型自由文案质量已通过', '当前未调用模型，不构成模型文案能力证明');
    result.marketing_result.diagnostics = result.marketing_result.diagnostics.filter(item => !['LOCAL_MODEL_USED', 'MODEL_NARRATIVE_CONSTRAINED', 'IMA_REPLACED_BY_LOCAL_OFFICIAL'].includes(item.code));
    result.marketing_result.diagnostics.push({ code: input.use_cloud_model ? 'CLOUD_MODEL_USED' : 'RULE_PREPARATION_USED', message: input.use_cloud_model ? `本次调用 ${model.model}；正文事实仍由程序按来源原文插入并独立核验` : '本次未调用模型，使用规则准备稿', retryable: false });
    result.limitations = [
        ENGINE.notice,
        '用户输入仅用于当前会话的规则画像与准备稿，不能输入真实隐私、密钥或私有客户资料',
        '四级合成政策只在明确开启时使用；固定5台不是客户采购数量证明，配置有效至2026-12-31，到期需维护者更新',
        '官网快照只保留7天有效窗口；过期阻塞，不使用历史资料冒充当前证据',
        'IMA 与联网检索结果均保留来源和抓取证据；未取得可定位正文时不得将其当作产品事实',
        '真实交易报价为null，正式图片为0，现场30分钟与咨询转化未验证',
    ];
    return result;
}

function cloudMarkdown(result) {
    if (result.runtime_engine?.mode === 'cloud_model') return `> 本次使用 ${result.runtime_engine.model} 做受约束策略与事实选择；事实正文仍按来源原文插入。\n\n${renderMarkdown(result)}`;
    let text = renderMarkdown(result).replaceAll('真实模型用于策略和事实选择', '云端规则用于策略和事实选择，未调用模型').replaceAll('真实模型用于策略与事实选择', '云端规则用于策略与事实选择，未调用模型').replaceAll('本地准备稿', '云端规则准备稿').replaceAll('本地准备文件', '云端规则准备文件');
    return `> ${ENGINE.notice}\n\n${text}`;
}

module.exports = { PRODUCTS, ENGINE, pricingInput, examples, validateCloudInput, runCloud, cloudMarkdown, CAPABILITIES };