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
    notice: '智能分析、产品资料查询和公开资料查询均按本次操作开启；引用内容仍会标明出处并经过检查，不把未经核对的信息当作产品资料。',
});

function pricingInput(product) {
    const source = (title, entry) => ({ kind: 'synthetic_fixture', title, entry: `backend/agent/cloud-runner.js#${entry}`, description: '此为基于行业惯例与赛题推断的合理假设，待官方确认。所有金额、资格、地区和销售配置均为演示假设，未取得行业或华为政策确认，不代表真实交易报价。' });
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
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(name => !allowed.includes(name))) throw new PipelineError('INVALID_INPUT', '提交内容中包含不可用的项目，请刷新页面后重试');
    for (const name of ['demo_pricing', 'use_cloud_model', 'use_ima', 'use_web_research']) {
        if (body[name] !== undefined && typeof body[name] !== 'boolean') throw new PipelineError('INVALID_INPUT', `提交内容格式不正确，请刷新页面后重试`);
    }
    const input = body.marketing_input;
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(name => !['schema_version', 'mode', 'product', 'audience', 'scenario', 'raw_request', 'platform', 'live_research'].includes(name))) {
        const keys = input && typeof input === 'object' && !Array.isArray(input) ? Object.keys(input).join(',') : typeof input;
        throw new PipelineError('INVALID_INPUT', `只接受系统内可选的型号、示例客户描述、场景和平台，不接受私有文件位置或价格政策；请刷新页面后重试`);
    }
    if (!PRODUCTS.includes(input.product) || !['公众号', '小红书', '朋友圈'].includes(input.platform)) throw new PipelineError('INVALID_INPUT', '请选择系统内已开放的两款型号和平台');
    if ((input.mode !== undefined && !['local', 'ima', 'hybrid'].includes(input.mode)) || (input.schema_version !== undefined && input.schema_version !== '1.0')) throw new PipelineError('INVALID_INPUT', '提交内容格式不受支持，请刷新页面后重试');
    for (const name of ['audience', 'scenario', 'raw_request']) if (input[name] !== undefined && (typeof input[name] !== 'string' || !input[name].trim() || input[name].length > 800 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input[name]))) throw new PipelineError('INVALID_INPUT', '每项客户描述须为非空文本且不超过800字');
    const useCloudModel = body.use_cloud_model === true;
    const useIma = body.use_ima === true;
    const useWebResearch = body.use_web_research === true;
    const capabilities = runtimeCapabilities();
    if (useCloudModel && !capabilities.cloud_model_configured) throw new PipelineError('MODEL_NOT_CONFIGURED', '智能分析暂不可用，无法启用智能生成建议');
    if (useIma && !capabilities.ima_configured) throw new PipelineError('IMA_NOT_CONFIGURED', '产品资料库暂不可用，无法查询产品资料');
    if (useWebResearch && !capabilities.web_research_configured) throw new PipelineError('WEB_RESEARCH_DISABLED', '公开资料查询暂不可用');
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
        { id: 'official-harmony', label: '演示示例一：鸿蒙版移动办公', product: PRODUCTS[0], scenario: '核对移动办公文稿打开、编辑、保存与导出的任务条件' },
        { id: 'official-2024', label: '演示示例二：2024版备课', product: PRODUCTS[1], scenario: '备课文稿与课堂展示文件的选型核对，软件版本待确认' },
        { id: 'needs-clarification', label: '演示示例三：场景待补充', product: PRODUCTS[0] },
    ].map(example => ({ id: example.id, label: example.label, synthetic: true, marketing_input: { product: example.product, audience: '示例客户：办公电脑选型用户', ...(example.scenario ? { scenario: example.scenario } : {}), platform: '公众号', mode: 'local' }, demo_pricing: true, pricing_input: pricingInput(example.product) }));
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
    if (!officialKnowledge(loadOfficialReference(input.marketing_input.product))) throw new PipelineError('OFFICIAL_SNAPSHOT_UNAVAILABLE', '华为公开资料暂时不可用或已过期，本次没有改用未授权资料；请联系资料负责人更新后重试');
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
        notice: input.use_cloud_model ? (modelFallback ? `本次智能分析给出的部分建议未达到使用要求，已改用按已核对资料整理的内容。` : `本次已使用智能分析整理建议；产品资料仍按已核对原文写入并复核。`) : '本次按既定销售规则准备内容，未使用智能分析生成建议。',
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
    result.marketing_result.diagnostics.push({ code: input.use_cloud_model ? 'CLOUD_MODEL_USED' : 'RULE_PREPARATION_USED', message: input.use_cloud_model ? '本次已使用智能分析整理建议，产品资料仍按已核对内容写入' : '本次按既定销售规则准备内容，未使用智能分析生成建议', retryable: false });
    result.limitations = [
        ENGINE.notice,
        '填写内容只用于本次销售准备，请勿输入真实客户隐私、系统密码或未经授权的客户资料',
        '演示价格只在明确开启时使用；固定 5 台不代表客户真实采购数量，到期后需要资料维护人员更新',
        '华为公开资料有更新时间限制；过期后会暂停使用，不拿历史资料冒充当前信息',
        '产品资料与公开资料会分别记录来源；缺少可核对原文时保持待确认',
        '正式成交价和正式图片仍待确认，现场 30 分钟与咨询转化效果尚未验证',
    ];
    return result;
}

function cloudMarkdown(result) {
    return renderMarkdown(result);
}

module.exports = { PRODUCTS, ENGINE, pricingInput, examples, validateCloudInput, runCloud, cloudMarkdown, CAPABILITIES };