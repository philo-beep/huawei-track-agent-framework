'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runPipeline, renderMarkdown: marketingMarkdown } = require('./main');
const { calculatePricing, NOTICE } = require('./pricing');
const { buildDealPlan } = require('./solution-planning');
const { loadOfficialReference } = require('./official');
const { ROOT, outputPath, PipelineError, redact } = require('./support');

function demonstrationPlan(marketing, pricing) {
    const scenario = marketing.scenario_judgment.scenario || '待确认的客户任务';
    return {
        status: 'preparation_only', goal: `围绕“${scenario}”验证客户确认的打开、编辑、保存和导出任务；不将规格等同实际体验`,
        product: marketing.knowledge_basis.product, sku: pricing.sku,
        materials: ['销售实际完整SKU设备及电源（待确认）', '经授权的脱敏客户样例与软件名称/版本', '产品来源原文及全部限制脚注', pricing.input_provenance.synthetic ? '显式提供的演示政策JSON与资格键（仅假设）' : '真实价格规则待提供，当前金额null；官网公开价仅获取时点参考', '计时器、验收记录表、可用网络与外接设备清单'],
        roles: ['销售负责人：核对需求、取得演示同意并记录后续动作', '方案工程师：核对SKU/软件环境并演示', '客户验收人：逐项确认输出及失败现象（人员均待指定）'],
        schedule: [
            { minutes: '0–5', owner: '销售负责人和客户验收人', input: '客户任务、软件版本、样例与权限', operation: '确认一个具体任务及成功条件，启动实际计时；记录设备SKU和网络', output: '客户确认的任务/环境/验收表', acceptance: '输入可合法使用，客户认可成功条件；未知项保持待确认', fallback: '缺权限改用明确合成样例；缺设备或软件延期验证' },
            { minutes: '5–15', owner: '方案工程师', input: '实际SKU、已核实软件和授权样例', operation: '依次打开、编辑、保存、导出，记录每步用时和错误；未经适配核验不承诺兼容', output: '保存文件、导出文件及操作记录', acceptance: '文件可重新打开、内容与客户任务一致；失败项逐条记录', fallback: '保留错误，不宣称通过；采用已验证格式或约定补测' },
            { minutes: '15–25', owner: '客户验收人和方案工程师', input: pricing.input_provenance.synthetic ? '操作产物、产品原文、四级合成算式' : '操作产物、产品原文与报价缺口', operation: pricing.input_provenance.synthetic ? '客户逐项核验输出，复核事实脚注；演示各级价格和总额，并再次声明非交易报价' : '客户逐项核验输出及事实脚注，记录完整SKU、真实政策与资格缺口；不推算未知金额', output: pricing.input_provenance.synthetic ? '客户确认/待确认事项、价格演算记录' : '客户确认/待确认事项与报价缺口记录', acceptance: pricing.input_provenance.synthetic ? '无无来源承诺；四级可重算，地区/SKU/资格均标假设' : '无无来源承诺；未知价格保留null，不将系列参数当指定SKU', fallback: '政策不符、资格缺失或金额异常则阻塞报价，保留需求记录' },
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
        pricing.diagnostics.push({ code: 'PRICING_INPUT_REQUIRED', message: '未提供价格规则或完整报价输入；当前只生成客户、内容与方案准备，金额null，不自动补合成政策' });
        diagnostics.push({ code: 'PRICING_INPUT_REQUIRED', message: '报价规则缺失，尚未启用合成政策；价格和预算不能从案例推断' });
    }
    if (pricing.product !== null && marketing.knowledge_basis.product !== pricing.product) {
        pricing.status = 'blocked'; pricing.unit_amount_cents = null; pricing.amount_cents = null; pricing.budget_check = 'not_evaluated';
        pricing.diagnostics.push({ code: 'CROSS_PRODUCT_MISMATCH', message: '营销产品与报价产品不完全一致，组合报价已阻塞，禁止混配' });
        diagnostics.push({ code: 'CROSS_PRODUCT_MISMATCH', message: '请在两个输入中使用同一产品及明确的演示SKU' });
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
        limitations: ['demo_ready仅表示本地准备稿与已显式提供的合成算术可演示，不是正式参赛全部硬要求达成', '营销自由文案采用程序化核对式叙述，模型用于策略和事实选择；原模型自由文案质量未证明通过', '用户已彻底停用IMA，旧mode=ima亦不发起调用；以任德耀本地原文及核验官网快照替代，与旧赛事IMA要求的差异如实保留', '官网规格为精确代际的系列选项，不代表指定SKU；公开价格参考、合成四级与真实交易报价分别记录，后者金额始终null', '正式图片未通过视觉/SKU/版权核验；真实报价、现场半小时完成和咨询转化均无实证', '仅在显式输入时启用演示SKU及假设政策，不证明配置实际存在或库存可售；实际完整SKU须由销售确认'],
        diagnostics,
    };
    return result;
}

function money(value) {
    if (value === null) return 'null（阻塞）';
    const amount = BigInt(value);
    return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}元（${amount}分）`;
}

function renderMarkdown(result) {
    const pricing = result.pricing_result;
    const plan = result.solution.demonstration_plan;
    const cell = value => String(value === null || value === undefined ? '待确认' : typeof value === 'object' ? JSON.stringify(value) : value).replace(/\|/g, '／').replace(/\r?\n/g, ' ');
    const lines = ['# 四步销售准备演示', `**状态：${result.status}。准备文件，非交易报价。**`, `> ${result.notice}`, '# 第一步：客户分析', '| 维度 | 当前值 | 状态 | 输入证据 |', '| --- | --- | --- | --- |'];
    for (const [name, field] of Object.entries(result.customer_analysis.profile)) lines.push(`| ${name} | ${cell(field.value)} | ${field.status} | ${cell(field.evidence.map(evidence => `${evidence.input_path}：“${evidence.quote}”`).join('；') || field.reason)} |`);
    const tableStart = lines.findIndex(line => line.startsWith('| 维度 |'));
    lines.push(lines.splice(tableStart).join('\n'));
    const policy = result.pricing_configuration.policy_snapshot;
    const content = result.content.marketing_content;
    const official = result.official_reference;
    lines.push(...result.customer_analysis.clarification_questions.map(question => `- 待确认：${question.question}`), '# 第二步：写出内容', '> 这是程序化核对式准备稿；真实模型用于策略和事实选择，模型自由标题/导语/过渡/CTA未直接采用，原模型自由文案质量未证明通过。正式配图仍为0，候选图在附录供人工核对。', content ? `## ${content.title}\n\n${content.lead}\n\n${content.body}\n\n**行动引导**：${content.cta}` : '内容未生成：营销流程需澄清或已阻塞，请查看附录诊断。', '# 第三步：给出方案');
    const baseSolution = result.solution.base_solution;
    const quoteStatus = result.quote_status;
    const budgetAssessment = result.budget_assessment;
    lines.push('## 基础方案（基于画像与来源证据）', `状态：${baseSolution.status}（${baseSolution.label}）；目标：${cell(baseSolution.goal)}。`, '### 客户上下文', ...baseSolution.customer_context.filter(item => item.value !== null).map(item => `- ${cell(item.field)}：${cell(item.value)}（${item.status}；证据${item.evidence_refs.length}条）`), ...(baseSolution.customer_context.every(item => item.value === null) ? ['- 尚无明确客户画像，先完成需求澄清。'] : []), '### 执行方法');
    for (const step of baseSolution.approach) lines.push(`#### ${step.priority}. ${step.id}`, `负责人：${step.owner_role}；建议时间：${step.timing}。`, `动作：${step.action}`, `交付：${step.output}`, `完成标准：${step.completion_criteria}`);
    lines.push('### 交付物', ...baseSolution.deliverables.map(item => `- ${item.label}：${item.status}`), '### 证据依据', `画像证据引用：${baseSolution.evidence_basis.profile_evidence_refs.length}条；产品事实：${baseSolution.evidence_basis.fact_ids.join('、') || '无可用事实ID'}。`, '### 方案边界', ...baseSolution.exclusions.map(item => `- ${item}`), '## 报价状态', `状态：${quoteStatus.status}（${quoteStatus.label}）；正式价格：${quoteStatus.price === null ? 'null（缺失/待确认）' : money(quoteStatus.price)}。`, ...(quoteStatus.synthetic_reference ? [`合成演算参考：${money(quoteStatus.synthetic_reference.amount_cents)}；policy=${cell(quoteStatus.synthetic_reference.policy_id)}；不是客户报价。`] : []), ...quoteStatus.missing_information.map(item => `- 缺少：${item}`), '## 预算判断', `状态：${budgetAssessment.status}；预算范围：${budgetAssessment.range ? `${budgetAssessment.range.min}–${budgetAssessment.range.max} ${budgetAssessment.range.currency || '币种待确认'}（${budgetAssessment.range.scope || '口径待确认'}）` : 'null（缺失）'}；可行度：${budgetAssessment.feasibility.label}。`, `判断依据：${budgetAssessment.feasibility.reason}`, ...(budgetAssessment.demo_comparison ? [`合成比较：${budgetAssessment.demo_comparison.budget_check}；${budgetAssessment.demo_comparison.notice}`] : []), ...budgetAssessment.missing_information.map(item => `- 待确认：${item}`), '## 官网规格与公开零售价参考');
    if (official) {
        lines.push(`核验状态：${official.status}；完整代际产品：${cell(official.product)}；请求SKU：${cell(official.requested_sku)}；核验时间：${official.checked_at}。规格仅为原文系列选项，不拼凑SKU。`);
        for (const source of official.sources) lines.push(`- 官网：${source.url}；抓取：${source.fetched_at}；型号：${source.product}；SKU：${source.sku || '未知'}；原文：${source.raw_path}；SHA256：${source.raw_sha256}；限制：${source.limitations.join('；')}`);
        if (official.public_price_reference) {
            const reference = official.public_price_reference;
            lines.push(`**获取时点公开零售价参考：${money(reference.amount_cents)}，非交易报价。** SKU：${reference.sku}；配置：${cell(reference.configuration)}；抓取：${reference.fetched_at}；有效区间：${reference.valid_from || '原文未列起始'} 至 ${reference.valid_until || '原文未列截止，不保证价格不变'}；条件：${reference.conditions.join('；') || '原文未另列'}；原文：${reference.excerpt}；来源：${reference.url}。`);
        } else lines.push('**官网公开零售价：未知/null。** 未核实完整SKU、配置、时点或适用条件，不用旧价、起售价、券后或补贴估算替代。');
        lines.push(...official.diagnostics.map(item => `- ${item.code}：${item.message}`));
    } else lines.push('此历史文件没有官网参考sidecar；不能当作本轮官网优先证据。');
    lines.push('## 四级假设报价或缺规则提示', `> ${policy ? NOTICE : '未启用合成政策；报价金额未知，不自动从示例补价。'}`, `产品：${cell(pricing.product)}；SKU：${cell(pricing.sku)}${policy ? '（人为定义的演示配置，待确认）' : '（尚无可用报价依据）'}；数量：${cell(pricing.quantity)}；状态：${pricing.status}。`, `有效日期：${cell(pricing.effective.valid_from)} 至 ${cell(pricing.effective.valid_to)}；演示日期：${cell(pricing.effective.as_of)}；地区：${cell(pricing.effective.region)}（不是客户真实地区证明）。`, `人为设定的演示基价：${policy ? money(policy.base_unit_cents) : '未取得，不能计算'}；基价来源：${cell(pricing.input_provenance.policy_source)}。${policy ? '本演示假设基价已含税，无另加税；按单台四级逐次半入到分后乘数量。' : '税费与真实政策待核实。'}`, `合成已确认资格键：${result.pricing_configuration.confirmed_eligibility.join('、') || '无'}。这些键仅驱动演算，不是客户身份或数量认证。`);
    for (const rule of policy?.rules || []) lines.push(`- 第${rule.level}级配置：${rule.operation}，value=${rule.value}；必需资格：${(rule.required_eligibility || []).join('、') || '未另设'}；互斥组：${rule.exclusion_group || '未另设'}；${rule.source.description}`);
    for (const trace of pricing.trace) lines.push(`## 第${trace.level}级：${cell(trace.source.title)}`, `公式（整数分）：${trace.formula}`, `本级后：${money(trace.after_cents)}；优惠：${money(trace.discount_cents)}；上限：${trace.cap_discount_cents === null ? '未另设' : money(trace.cap_discount_cents)}。`, `来源节点：${trace.source.entry}；说明：${trace.source.description}。`);
    lines.push(`**合成演示单价：${money(pricing.unit_amount_cents)}；合成合计：${money(pricing.amount_cents)}；预算判断：${pricing.budget_check}。**`, '**真实交易报价始终为null。** 资格键仅为合成输入，不是实际资格认证；修改policy后必须重新运行。', ...pricing.diagnostics.map(item => `- ${item.code}：${item.message}`), '## 可执行演示方案', `目标：${plan.goal}`, '## 物料', ...plan.materials.map(item => `- ${item}`), '## 人员', ...plan.roles.map(item => `- ${item}`), '## 0–30分钟建议时间表');
    for (const step of plan.schedule) lines.push(`### ${step.minutes}分钟：${step.owner}`, `输入：${step.input}。\n\n操作：${step.operation}。\n\n输出：${step.output}。\n\n验收：${step.acceptance}。\n\n失败替代：${step.fallback}。`);
    lines.push(`文件生成开始：${result.timing.started_at}；完成：${result.timing.completed_at}；生成方案耗时：${result.timing.generation_elapsed_seconds}秒；生成耗时小于30分钟：${result.timing.generation_under_30_minutes}。`, '**现场演示实际耗时：null；现场30分钟完成验证：false。** 计时记录待现场填写：开始/结束、打开/编辑/保存/导出、客户验收结果。生成文件用时不能证明现场任务完成。', '# 第四步：人工销售推进');
    for (const action of result.next_actions) lines.push(`- ${action.owner}：${action.action}\n  触发：${action.trigger}；依赖：${action.pending_dependencies.join('、')}。`);
    lines.push('## 交付限制', ...result.limitations.map(item => `- ${item}`), ...result.diagnostics.map(item => `- ${item.code}：${item.message}`), '# 附录：完整营销来源与受控文稿', marketingMarkdown(result.marketing_result));
    return lines.join('\n\n') + '\n';
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
