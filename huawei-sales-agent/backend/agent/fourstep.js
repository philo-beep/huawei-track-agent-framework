'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runPipeline } = require('./main');
const { renderSalesMarkdown } = require('./markdown-sales');
const { humanMoney } = require('./sales-copy');
const { calculatePricing, NOTICE } = require('./pricing');
const { buildDealPlan } = require('./solution-planning');
const { loadOfficialReference } = require('./official');
const { ROOT, outputPath, PipelineError, redact } = require('./support');

function demonstrationPlan(marketing, pricing) {
    const scenario = marketing.scenario_judgment.scenario || '待确认的客户任务';
    return {
        status: 'preparation_only', goal: `围绕“${scenario}”验证客户确认的打开、编辑、保存和导出任务；不将规格等同实际体验`,
        product: marketing.knowledge_basis.product, sku: pricing.sku,
        materials: ['实际销售的完整配置设备及电源（待确认）', '经授权的脱敏客户样例与软件名称/版本', '产品来源原文及全部限制脚注', pricing.input_provenance.synthetic ? '已提供的演示价格规则与适用条件（仅作演示）' : '正式价格规则待提供，当前金额待确认；华为公开价只作获取时点参考', '计时器、验收记录表、可用网络与外接设备清单'],
        roles: ['销售负责人：核对需求、取得演示同意并记录后续动作', '方案工程师：核对销售配置和软件环境并演示', '客户验收人：逐项确认输出及失败现象（人员均待指定）'],
        schedule: [
            { minutes: '0–5', owner: '销售负责人和客户验收人', input: '客户任务、软件版本、样例与权限', operation: '确认一个具体任务及成功条件，启动实际计时；记录设备配置和网络', output: '客户确认的任务/环境/验收表', acceptance: '输入可合法使用，客户认可成功条件；未知项保持待确认', fallback: '缺权限改用明确合成样例；缺设备或软件延期验证' },
            { minutes: '5–15', owner: '方案工程师', input: '实际销售配置、已确认软件和授权样例', operation: '依次打开、编辑、保存、导出，记录每步用时和错误；未经适配核验不承诺兼容', output: '保存文件、导出文件及操作记录', acceptance: '文件可重新打开、内容与客户任务一致；失败项逐条记录', fallback: '保留错误，不宣称通过；采用已验证格式或约定补测' },
            { minutes: '15–25', owner: '客户验收人和方案工程师', input: pricing.input_provenance.synthetic ? '操作产物、产品原文、四级演示价格计算' : '操作产物、产品原文与报价缺口', operation: pricing.input_provenance.synthetic ? '客户逐项核验输出，复核资料出处；演示各级价格和总额，并再次声明非交易报价' : '客户逐项核验输出及事实脚注，记录完整销售配置、正式价格规则与资格缺口；不推算未知金额', output: pricing.input_provenance.synthetic ? '客户确认/待确认事项、价格演算记录' : '客户确认/待确认事项与报价缺口记录', acceptance: pricing.input_provenance.synthetic ? '无无来源承诺；四级可重算，地区、销售配置和资格均标明为演示假设' : '无无来源承诺；未知价格保持待确认，不把系列参数当成具体销售配置', fallback: '政策不符、资格缺失或金额异常则暂停报价，保留需求记录' },
            { minutes: '25–30', owner: '销售负责人', input: '验收表、遗留问题与客户可用渠道', operation: '停止计时、记录实际耗时；由客户确认结果后约定下一次动作', output: '验收结论、实际时间和负责人/日期', acceptance: '只记已完成项；未完成明确延期，不报告已成交或转化提升', fallback: '超时或未通过改为待补测；仅在客户许可后人工联系' },
        ],
        planned_minutes: 30, onsite_elapsed_seconds: null, onsite_within_30_minutes_verified: false,
        success_record: { opened: null, edited: null, saved: null, exported: null, customer_accepted: null, actual_started_at: null, actual_finished_at: null },
    };
}

async function runFourSteps(marketingInput, pricingInput, options = {}) {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const pricing = calculatePricing(pricingInput);
    const marketing = await (options.marketingRunner || runPipeline)(marketingInput, options.marketingOptions || {});
    const diagnostics = [];
    if (pricingInput === undefined) {
        pricing.status = 'blocked';
        pricing.diagnostics.push({ code: 'PRICING_INPUT_REQUIRED', message: '未提供价格规则或完整报价输入；当前只生成客户、内容与方案准备，金额待确认，不自动补演示价格规则' });
        diagnostics.push({ code: 'PRICING_INPUT_REQUIRED', message: '报价规则缺失，尚未启用合成政策；价格和预算不能从案例推断' });
    }
    if (pricing.product !== null && marketing.knowledge_basis.product !== pricing.product) {
        pricing.status = 'blocked'; pricing.unit_amount_cents = null; pricing.amount_cents = null; pricing.budget_check = 'not_evaluated';
        pricing.diagnostics.push({ code: 'CROSS_PRODUCT_MISMATCH', message: '营销产品与报价产品不完全一致，组合报价已阻塞，禁止混配' });
        diagnostics.push({ code: 'CROSS_PRODUCT_MISMATCH', message: '请确认客户画像和报价使用的是同一产品及明确的演示销售配置' });
    }
    const explicitQuantity = marketingInput?.customer?.budget?.quantity ?? marketing.profile?.budget?.value?.quantity;
    if (pricing.quantity !== null && Number.isSafeInteger(explicitQuantity) && explicitQuantity > 0 && explicitQuantity !== pricing.quantity) {
        pricing.status = 'blocked'; pricing.unit_amount_cents = null; pricing.amount_cents = null; pricing.budget_check = 'not_evaluated';
        pricing.diagnostics.push({ code: 'CUSTOMER_QUANTITY_MISMATCH', message: '客户明确预算数量与演示报价数量不一致，组合金额已阻塞；请同步确认输入' });
        diagnostics.push({ code: 'CUSTOMER_QUANTITY_MISMATCH', message: '未用演示采购数量覆盖客户明确数量' });
    }
    const official = loadOfficialReference(marketing.knowledge_basis.product, pricing.sku);
    const { documents, ...officialReference } = official;
    const dealPlan = buildDealPlan({
        profile: marketing.profile,
        facts: marketing.knowledge_basis?.facts || [],
        request: {
            product: marketing.knowledge_basis?.product || null,
            audience: marketing.scenario_judgment?.audience || null,
            scenario: marketing.scenario_judgment?.scenario || null,
        },
        marketingStatus: marketing.status,
        pricing,
        nextActions: marketing.sales_preparation?.next_actions || [],
    });
    const completed = Date.now();
    const result = {
        schema_version: 'fourstep-demo-1.0', status: marketing.status === 'ready' && pricing.status === 'calculated_demo' ? 'demo_ready' : 'needs_attention',
        demo_only: true, actual_transaction_quote: false, notice: pricing.input_provenance.synthetic ? NOTICE : '当前为客户、内容与方案准备；未启用合成价格政策，真实报价金额未知。官网公开零售价仅供获取时点参考，非交易报价。',
        customer_analysis: { profile: marketing.profile, clarification_questions: marketing.clarification_questions, scenario: marketing.scenario_judgment },
        content: { marketing_content: marketing.marketing_content, narrative_status: 'programmatic_constrained_preparation', free_model_copy_verified: false },
        pricing_result: pricing,
        pricing_configuration: { policy_snapshot: pricing.input_provenance.synthetic ? structuredClone(pricingInput.policy) : null, confirmed_eligibility: pricing.input_provenance.synthetic ? [...(pricingInput.confirmed_eligibility || [])] : [], eligibility_is_synthetic: pricing.input_provenance.synthetic },
        official_reference: officialReference,
        solution: { marketing_content: marketing.marketing_content, base_solution: dealPlan.base_solution, budget_assessment: dealPlan.budget_assessment, quote_status: dealPlan.quote_status, demonstration_plan: demonstrationPlan(marketing, pricing) },
        budget_assessment: dealPlan.budget_assessment,
        quote_status: dealPlan.quote_status,
        action_plan: dealPlan.action_plan,
        next_actions: dealPlan.next_actions,
        marketing_result: marketing,
        timing: { started_at: startedAt, completed_at: new Date(completed).toISOString(), generation_elapsed_seconds: (completed - started) / 1000, generation_under_30_minutes: completed - started < 1800000, onsite_elapsed_seconds: null, onsite_within_30_minutes_verified: false },
        limitations: ['当前状态只表示销售准备稿和已提供的演示价格计算可以使用，不代表正式参赛要求已全部完成', '销售内容按已核对资料组织，智能分析只用于整理建议和选择资料；自由撰写内容的质量仍需人工确认', '当前只使用已核对的产品资料和华为公开资料，不使用未经确认的私有资料替代', '华为公开资料中的规格属于对应产品的系列选项，不代表具体销售配置；公开价格参考、演示价格计算和正式成交报价分别记录，正式成交报价保持待确认', '正式图片尚未完成画面、销售配置和发布授权检查；正式报价、现场半小时完成和咨询转化均没有实际数据', '只有明确开启时才使用演示销售配置和演示价格规则；这不代表配置一定有库存，实际完整销售配置须由销售确认'],
        diagnostics,
    };
    return result;
}

function money(value) {
    return humanMoney(value);
}

function renderMarkdown(result) {
    return renderSalesMarkdown(result);
}

async function cli(argumentsList = []) {
    let result;
    try {
        const args = {};
        for (let index = 0; index < argumentsList.length; index += 2) {
            const name = argumentsList[index];
            if (!['--input', '--pricing-input', '--policy', '--output'].includes(name) || !argumentsList[index + 1] || args[name]) throw new PipelineError('INVALID_INPUT', '用法：node fourstep.js --input 营销输入.json --pricing-input 报价输入.json [--policy 演示政策.json] --output tests/outputs/新结果.json');
            args[name] = argumentsList[index + 1];
        }
        if (!args['--input'] || !args['--pricing-input'] || !args['--output']) throw new PipelineError('INVALID_INPUT', '必须给出--input、--pricing-input和--output');
        const destination = outputPath(args['--output']);
        const markdownDestination = outputPath(args['--output'].replace(/\.json$/, '.md'), false, '.md');
        const read = file => JSON.parse(fs.readFileSync(path.resolve(ROOT, file), 'utf8').replace(/^\uFEFF/, ''));
        const marketingInput = read(args['--input']);
        const pricingInput = read(args['--pricing-input']);
        if (args['--policy']) {
            if (pricingInput.mode !== 'demo_only') throw new PipelineError('INVALID_INPUT', '--policy只允许覆盖demo_only，不允许覆盖真实政策');
            pricingInput.policy = read(args['--policy']);
        }
        result = await runFourSteps(marketingInput, pricingInput);
        const markdown = renderMarkdown(result);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, JSON.stringify(result, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
        fs.writeFileSync(markdownDestination, markdown, { encoding: 'utf8', flag: 'wx' });
        process.exitCode = result.status === 'demo_ready' ? 0 : 3;
    } catch (error) {
        result = { schema_version: 'fourstep-demo-1.0', status: 'needs_attention', demo_only: true, actual_transaction_quote: false, diagnostics: [{ code: error instanceof PipelineError ? error.code : 'INVALID_INPUT', message: error instanceof PipelineError ? redact(error.message) : '输入文件不可读、JSON错误或写入失败；未输出原始输入' }] };
        process.exitCode = 3;
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
}

if (require.main === module) cli(process.argv.slice(2));

module.exports = { cli, runFourSteps, renderMarkdown };
