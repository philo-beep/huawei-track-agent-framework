'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseInput, buildProfile, DIMENSIONS } = require('./profile');
const { ROOT, PipelineError, schema, validateSchema, outputPath, redact } = require('./support');
const DATA_ROOT = path.resolve(ROOT, '..', 'huawei-sales-agent-data');
const { localKnowledge, extractFacts, imageCandidates, sourceReference } = require('./knowledge');
const { loadOfficialReference, officialKnowledge } = require('./official');
const { reasonStrategy, generateCopy, PLATFORM } = require('./model');
const { selectCloudFact } = require('./cloud-fact-selector');
const { composeContent } = require('./verification');
const { prepareSales } = require('./sales');
const { imaKnowledge } = require('./ima');
const { researchHuawei } = require('./research');

function baseResult(input = {}) {
    const requested = ['ima', 'hybrid'].includes(input?.mode) ? input.mode : 'local';
    const parsed = parseInput(input);
    return {
        schema_version: '1.0', requested_mode: requested, mode: 'local', ima_connection: requested === 'local' ? 'not_requested' : 'not_connected', status: 'blocked', competition_readiness: 'offline_only',
        profile: parsed.profile, clarification_questions: parsed.questions,
        scenario_judgment: { audience: parsed.normalized.audience || null, scenario: parsed.normalized.scenario || null, user_problem: parsed.normalized.scenario || null, content_goal: '依据可追溯产品事实准备内容与下一步澄清，不保证咨询转化', platform: ['小红书', '公众号', '朋友圈'].includes(parsed.normalized.platform) ? parsed.normalized.platform : null, strategy: null },
        knowledge_basis: { product: parsed.normalized.product || null, source_mode: 'none', facts: [] }, marketing_content: null,
        verification: { product_facts: 'not_run', image_model: 'pending', compliance: 'not_run', pending_information: ['真实四级价格规则未提供，报价金额阻塞', '未视觉核验图片型号、SKU与版权', 'not_verified_30min：没有验证半小时人工方案交付'], issues: [] },
        sales_preparation: {
            quote: { status: 'blocked', amount: null, reason: '缺少获授权真实四级价格规则，预算完整也不能计算真实报价', required_information: ['四级定义及各级真实数值', 'SKU、身份、地区、渠道资格', '计算顺序与叠加互斥', '税费、舍入、上限', '有效期及授权依据'] },
            demo_plan: { status: 'preparation_only', checklist: ['确认具体软件版本、设备与演示任务', '核对知识库限制与兼容范围', '逐图核对型号/SKU和版权', '准备演示环境、真实计时与客户验收标准'], elapsed_seconds: null, within_30_minutes_verified: false },
            next_actions: [{ action: '确认缺失条件后准备演示和选型资料，不自动联系任何人', owner: '销售负责人（待指定）', trigger: '客户确认需求与可触达渠道后', pending_dependencies: ['明确型号、场景、采购和审批条件', '真实四级价格规则与授权'] }], conversion_effect: 'not_measured',
        }, diagnostics: [{ code: 'PRICE_RULES_MISSING', message: '真实报价阻塞，金额为null；这不自动阻塞无价格内容', retryable: false }, { code: 'IMA_REPLACED_BY_LOCAL_OFFICIAL', message: '用户已停用IMA，所有模式均不调用IMA；任德耀本地知识库用于通用内容，已核验官网快照优先供参数及公开价格参考，未核实价格保持未知', retryable: false }],
    };
}

function addError(result, error) {
    result.status = 'blocked';
    result.marketing_content = null;
    result.diagnostics.push({ code: error instanceof PipelineError ? error.code : 'INTERNAL_ERROR', message: error instanceof PipelineError ? redact(error.message) : '运行失败，未输出异常参数或敏感信息', retryable: Boolean(error.retryable) });
    result.verification.issues.push(error instanceof PipelineError ? redact(error.message) : '内部错误，需维护者检查');
    if (error.code === 'COMPLIANCE_FAILED') result.verification.compliance = 'fail';
    if (['FACT_VERIFICATION_FAILED', 'SOURCE_CONFLICT'].includes(error.code)) result.verification.product_facts = 'fail';
    return result;
}

function validateEvidence(input, profile) {
    for (const name of DIMENSIONS) {
        const field = profile[name];
        if (field.value === null) continue;
        if (!field.evidence.length) throw new PipelineError('INVALID_INPUT', '画像缺少输入证据');
        for (const evidence of field.evidence) {
            const located = evidence.input_path.split('/').slice(1).reduce((value, key) => value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], input);
            const text = typeof located === 'string' ? located : JSON.stringify(located);
            if (!text || !text.includes(evidence.quote)) throw new PipelineError('INVALID_INPUT', '画像证据无法在指定输入JSON路径精确定位');
        }
    }
}

function revisionCheck(input) {
    if (!input.revision) return;
    const previous = JSON.parse(fs.readFileSync(outputPath(input.revision.previous_result_path, true), 'utf8').replace(/^\uFEFF/, ''));
    validateSchema(previous, schema('output'));
    if (/忽略|跳过核验|编造|虚构|改.*(?:参数|价格)|补贴|无须来源/.test(input.revision.instructions)) throw new PipelineError('REVISION_INVALID', '修改要求涉及篡改事实或绕过核验，未执行');
    if (!input.product && !input.raw_request) throw new PipelineError('REVISION_INVALID', '重生成须重新提供原始客户输入；历史模型输出不作为客户事实证据');
}

// 模块2→7：业务状态均返回契约JSON，不把可解释失败抛给CLI。
async function runPipeline(input, options = {}) {
    let result = baseResult();
    const started = Date.now();
    try {
        validateSchema(input, schema('input'));
        result = baseResult(input);
        revisionCheck(input);
        const parsed = parseInput(input);
        result.profile = parsed.profile;
        result.clarification_questions = parsed.questions;
        validateEvidence(input, result.profile);
        if (parsed.diagnostics.length) throw new PipelineError(parsed.diagnostics[0].code, parsed.diagnostics[0].message);
        if (parsed.questions.some(question => question.blocks === 'content') || parsed.conflicts.some(name => name !== 'budget')) {
            result.status = 'needs_clarification';
            result.diagnostics.push({ code: 'NEEDS_CLARIFICATION', message: '最少语义信息缺失或冲突，请按关键问题补充；未知画像不会补造', retryable: false });
            return result;
        }
        const request = parsed.normalized;
        let liveResearchEvidence = [];
        if (request.mode === 'ima' || request.mode === 'hybrid') {
            try {
                const ima = await imaKnowledge(`${request.product} ${request.scenario}`.trim(), { limit: 20 });
                result.mode = 'hybrid';
                result.ima_connection = ima.status === 'connected' ? 'connected' : 'not_connected';
                result.competition_readiness = ima.status === 'connected' ? 'ima_evidence_present' : 'offline_only';
                result.diagnostics.push({
                    code: ima.results.length ? 'IMA_SEARCH_COMPLETED' : 'IMA_SEARCH_NO_MATCH',
                    message: JSON.stringify({
                        provider: 'IMA OpenAPI',
                        knowledge_base: ima.knowledge_base ? { kb_id: ima.knowledge_base.kb_id, kb_name: ima.knowledge_base.kb_name } : null,
                        request_ids: ima.request_ids,
                        matches: ima.results.slice(0, 6).map(item => ({ title: item.title, media_id: item.media_id, source: item.source_ref })),
                    }),
                    retryable: false,
                });
            } catch (error) {
                result.ima_connection = 'not_connected';
                result.diagnostics.push({ code: error instanceof PipelineError ? error.code : 'IMA_SEARCH_FAILED', message: error instanceof PipelineError ? error.message : 'IMA 检索失败，已回退本地与官网来源', retryable: Boolean(error.retryable) });
            }
        }
        if (request.live_research === true) {
            try {
                liveResearchEvidence = await researchHuawei(request.product, request.scenario);
                result.diagnostics.push({
                    code: liveResearchEvidence.length ? 'WEB_RESEARCH_COMPLETED' : 'WEB_RESEARCH_NO_RESULT',
                    message: JSON.stringify({ provider: 'Bing RSS + 公开网页抓取', query_scope: 'Huawei official sources', sources: liveResearchEvidence.map(item => ({ title: item.title, url: item.url, fetched_at: item.fetched_at, content_sha256: item.content_sha256, error: item.error || null })) }),
                    retryable: false,
                });
            } catch (error) {
                result.diagnostics.push({ code: error instanceof PipelineError ? error.code : 'WEB_RESEARCH_FAILED', message: error instanceof PipelineError ? error.message : '联网检索失败，未使用未核验网页内容', retryable: true });
            }
        }
        const official = loadOfficialReference(request.product);        result.diagnostics.push(...official.diagnostics.map(item => ({ ...item, retryable: false })));
        let knowledge = officialKnowledge(official);
        if (knowledge) {
            result.diagnostics.push({ code: 'OFFICIAL_SPEC_PRIORITIZED', message: '本次产品参数优先引用已核验华为官网本地快照；系列选项不能拼成销售SKU，完整配置和公开价格仍需独立确认', retryable: false });
            result.verification.pending_information.push(...official.sources.map(source => `官网原文：${source.url}｜抓取=${source.fetched_at}｜原文=${source.raw_path}｜原文SHA256=${source.raw_sha256}｜型号=${source.product}｜SKU=${source.sku || '未知'}｜${source.limitations.join('；')}`));
        } else {
            knowledge = await localKnowledge(request.product);
            result.diagnostics.push({ code: 'RENDEYAO_LOCAL_FALLBACK', message: '官网参数未完成完整代际匹配或证据核验；明确回退任德耀本地原文，不将本地历史价格作为当前价格', retryable: false });
        }
        result.knowledge_basis = { product: request.product, source_mode: knowledge.source_mode, facts: knowledge.documents.map((document, index) => ({ id: `unverified-source-${index + 1}`, product: request.product, claim: document.text, conditions: ['检索原文待核验，不代表可用于成稿'], source_refs: [sourceReference(document, document.text)] })) };
        const facts = extractFacts(knowledge, request.product);
        result.knowledge_basis = { product: request.product, source_mode: knowledge.source_mode, facts };
        const preparation = prepareSales(request, result.profile, facts);
        result.sales_preparation.demo_plan.checklist = preparation.checklist;
        result.sales_preparation.next_actions = preparation.next_actions;
        const candidates = imageCandidates(knowledge, request.product);
        if (schema('output').properties.knowledge_basis.properties.image_candidates) result.knowledge_basis.image_candidates = candidates;
        else if (candidates.length) result.verification.pending_information.push(...candidates.map(image => `候选图片（model_verified=false）：${image.name}｜local_path=${image.local_path}｜source=${image.source_refs[0].entry}｜${image.source_refs[0].archive_aliases.join('、')}｜urls=${image.source_refs[0].urls.join('、')}`));
        result.diagnostics.push({ code: 'IMAGE_EVIDENCE_INCOMPLETE', message: '全部图片仍为候选，已核验正式配图为0；未满足平台图数，不构成完整图文', retryable: false });
        if (request.intent === 'quote') throw new PipelineError('PRICE_RULES_MISSING', '当前请求为真实报价，但四级规则缺失，金额保持null');
        const strategy = options.reasonStrategy || reasonStrategy;
        const copy = options.generateCopy || generateCopy;
        try {
            result.scenario_judgment.strategy = await strategy(request, result.profile, liveResearchEvidence);
        } catch (error) {
            if (error.code !== 'MODEL_OUTPUT_INVALID') throw error;
            result.diagnostics.push({ code: 'MODEL_STRATEGY_RETRY', message: '首次策略JSON结构不符合约束；仅重试一次，未放行初稿', retryable: false });
            try {
                result.scenario_judgment.strategy = await strategy(request, result.profile, liveResearchEvidence, error.message);
            } catch (retryError) {
                if (retryError.code !== 'MODEL_OUTPUT_INVALID') throw retryError;
                result.diagnostics.push({ code: 'MODEL_STRATEGY_RULES_FALLBACK', message: '策略模型连续返回无效JSON，已回退到受约束规则策略；后续事实选择仍按本次所选模式执行', retryable: false });
                result.scenario_judgment.strategy = { platform_rules: PLATFORM[request.platform], model_analysis: { focus: request.scenario, rationale: '模型策略输出未通过结构校验，使用受约束规则策略继续；未知客户事实保持待确认', outline: ['确认实际任务与软件版本', '核对来源与限制', '安排人工确认的下一步'] }, analysis_status: 'rules_fallback_after_model_error', model: 'rules_fallback', elapsed_ms: 0, research_source_count: liveResearchEvidence.length };
            }
        }
        let generated = await copy(request, result.scenario_judgment.strategy, facts);
        try {
            result.marketing_content = composeContent(generated.value, facts, request);
        } catch (error) {
            if (!['MODEL_OUTPUT_INVALID', 'FACT_VERIFICATION_FAILED', 'COMPLIANCE_FAILED'].includes(error.code)) throw error;
            result.diagnostics.push({ code: 'MODEL_REPAIR_ATTEMPT', message: `首次事实选择或实际叙述核验被拦截：${error.message}；仅一次带反馈重生成，未放行初稿`, retryable: false });
            try {
                generated = await copy(request, result.scenario_judgment.strategy, facts, error.message);
                result.marketing_content = composeContent(generated.value, facts, request);
            } catch (retryError) {
                if (!['MODEL_OUTPUT_INVALID', 'FACT_VERIFICATION_FAILED', 'COMPLIANCE_FAILED'].includes(retryError.code)) throw retryError;
                const selection = selectCloudFact(request, facts);
                if (!selection.fact_ids.length) throw retryError;
                result.diagnostics.push({ code: 'MODEL_COPY_RULES_FALLBACK', message: '事实选择模型连续未通过结构或核验，已回退到确定性事实选择；未放行无效模型正文', retryable: false });
                generated = { model: 'rules_fallback', value: { fact_ids: selection.fact_ids } };
                result.marketing_content = composeContent(generated.value, facts, request);
            }
        }
        result.status = 'ready';
        result.diagnostics.push({ code: 'MODEL_NARRATIVE_CONSTRAINED', message: '生成阶段只要求模型选择事实ID；最终标题/导语/过渡/CTA由程序按输入场景生成并独立核验。真实模型用于策略与事实选择，这不是模型自由文案合规通过证明', retryable: false });
        result.verification.product_facts = 'pass';
        result.verification.compliance = 'pass';
        result.verification.image_model = 'pending';
        result.diagnostics.push({ code: 'LOCAL_MODEL_USED', message: `真实生成阶段使用 ${generated.model || '测试注入模型（非真实证据）'}；内容与报价准备度独立`, retryable: false });
        result.sales_preparation.demo_plan.elapsed_seconds = (Date.now() - started) / 1000;
        validateSchema(result, schema('output'));
        return result;
    } catch (error) {
        return addError(result, error);
    }
}

function renderMarkdown(result) {
    const content = result.marketing_content;
    const cell = value => String(value === null || value === undefined ? '待确认' : typeof value === 'object' ? JSON.stringify(value) : value).replace(/\|/g, '／').replace(/\r?\n/g, ' ');
    const statusNames = { explicit: '明确输入', inferred: '有据推断', pending: '待确认', pass: '通过', fail: '未通过', not_run: '未执行' };
    const labels = { identity: '身份角色', relationship: '客户关系', industry: '行业', company_size: '企业规模', needs: '需求', budget: '预算', decision_chain: '决策链', preferences: '偏好', pain_points: '痛点', purchase_stage: '购买阶段', channels: '可触达渠道' };
    const lines = ['# 一、场景判断', `**本次状态：${result.status}**；这是本地准备稿，不代表已完成真实报价、图片审核或咨询转化。`, `目标人群：${cell(result.scenario_judgment.audience)}  \n场景：${cell(result.scenario_judgment.scenario)}  \n平台：${cell(result.scenario_judgment.platform)}  \n目标：${cell(result.scenario_judgment.content_goal)}`, '## 客户画像', '| 维度 | 当前值 | 判定 | 输入依据 |', '| --- | --- | --- | --- |'];
    for (const [name, field] of Object.entries(result.profile)) lines.push(`| ${labels[name] || name} | ${cell(field.value)} | ${statusNames[field.status]} | ${cell(field.evidence.map(item => `${item.input_path}：“${item.quote}”`).join('；') || field.reason)} |`);
    const tableStart = lines.findIndex(line => line.startsWith('| 维度 |'));
    const tableBlock = lines.splice(tableStart).join('\n');
    lines.push(tableBlock);
    if (result.clarification_questions.length) lines.push('## 需要确认', ...result.clarification_questions.map(question => `- ${question.question}（影响：${question.blocks}）`));
    const strategy = result.scenario_judgment.strategy;
    if (strategy) {
        lines.push('## 内容策略', `主题：${strategy.topic || cell(strategy.model_analysis?.focus)}。模型策略状态：${strategy.analysis_status || '待人工审阅'}。`, `表达：${cell(strategy.platform_rules?.length)}；语气：${cell(strategy.platform_rules?.tone)}。`, `推理说明：${cell(strategy.model_analysis?.rationale)}`, ...((strategy.model_analysis?.outline || []).map(item => `- ${item}`)));
        if (strategy.analysis_status === 'needs_editorial_review') lines.push('> 模型策略含模板复述，已标记待编辑审阅；不能称为充分场景推理证据。');
    }
    lines.push('# 二、知识库依据', `产品：${cell(result.knowledge_basis.product)}；请求模式：${result.requested_mode}；实际模式：${result.mode}；知识来源类型：${result.knowledge_basis.source_mode}；IMA已按用户要求停用，即使提供凭证也不会调用。历史契约准备度字段：${result.competition_readiness}，不能据此宣称官方参赛证据充分。`);
    for (const fact of result.knowledge_basis.facts) {
        lines.push(`## ${fact.id}`, fact.claim, '**适用条件与脚注**', ...(fact.conditions.length ? fact.conditions.map(condition => `- ${condition}`) : ['- 本段未单列条件，仍需核对原文上下文。']));
        for (const source of fact.source_refs) lines.push(`来源：${source.title}  \n来源库：${source.archive_aliases.join('、') || '华为官网本地证据快照（以URL、原文与哈希为准）'}  \n条目：${source.entry}  \n内容哈希：${source.entry_sha256 || '未取得'}  \n原始URL：${source.urls.join('；') || '无可公开原始URL'}`);
    }
    if (!result.knowledge_basis.facts.length) lines.push('未取得可用产品事实，不使用近似型号或无来源说法。');
    const fullSources = new Map();
    for (const fact of result.knowledge_basis.facts) for (const source of fact.source_refs) fullSources.set(`${source.entry_sha256 || ''}:${source.entry}`, source);
    if (fullSources.size) lines.push('## 完整原文备查（本机证据）');
    for (const source of fullSources.values()) lines.push(`<details>\n<summary>${cell(source.title)}：完整来源原文，含全部脚注</summary>\n\n${source.excerpt}\n\n</details>`);
    lines.push('# 三、图文软文', content ? `## ${content.title}\n\n${content.lead}\n\n${content.body}\n\n**行动引导**：${content.cta}` : '未生成：输入需澄清或流程被安全阻塞，未通过的模型草稿不予交付。');
    lines.push('# 四、核验结果', `产品事实：${statusNames[result.verification.product_facts] || result.verification.product_facts}；图片型号：${statusNames[result.verification.image_model] || result.verification.image_model}；营销合规：${statusNames[result.verification.compliance] || result.verification.compliance}。`, '## 待确认事项');
    const candidates = [];
    for (const item of result.verification.pending_information) {
        if (item.startsWith('候选图片（model_verified=false）：')) candidates.push(item);
        else lines.push(`- ${item}`);
    }
    if (candidates.length) {
        lines.push('## 待核验候选图片，非正式配图', '> 以下原图仅供本机人工核对。未验证画面、SKU与版权，不计入正式图数，也不证明完整图文已完成。');
        for (const candidate of candidates) {
            const parts = candidate.replace('候选图片（model_verified=false）：', '').split('｜');
            const name = parts[0];
            const local = parts.find(part => part.startsWith('local_path='))?.slice(11);
            lines.push(`### ${cell(name)}`, ...parts.slice(1).map(part => `- ${part}`), '- 核验状态：model_verified=false；需人工核对实际画面、销售SKU和版权。');
            if (local && local !== 'null' && local.startsWith('datasets/raw/assets/')) lines.push(`![待核验候选：${name.replace(/[\[\]]/g, '')}](<${path.join(DATA_ROOT, local).replace(/\\/g, '/') }>)`);
        }
    }
    lines.push('## 报价准备', `**报价阻塞，金额：null。** ${result.sales_preparation.quote.reason}`, ...result.sales_preparation.quote.required_information.map(item => `- 待提供：${item}`), '## 演示方案准备', '**未验证半小时交付。** 以下是待执行计划，非已完成结果。', ...result.sales_preparation.demo_plan.checklist.map((item, index) => `${index + 1}. ${item}`), '## 下一步行动');
    for (const action of result.sales_preparation.next_actions) lines.push(`- **${action.owner}**：${action.action}  \n  触发条件：${action.trigger}；依赖：${action.pending_dependencies.join('、') || '无新增依赖'}。`);
    lines.push('咨询/转化效果：not_measured，当前没有真实效果数据。', '## 诊断与审核记录', ...result.diagnostics.map(item => `- ${item.code}：${item.message}`), ...result.verification.issues.map(item => `- 未通过原因：${item}`));
    return lines.join('\n\n') + '\n';
}

// 模块7：标准输出始终只有一个JSON；日志不输出客户原话或凭证。
async function cli(argumentsList = []) {
    let result;
    let programError = false;
    try {
        const args = {};
        for (let index = 0; index < argumentsList.length; index += 2) {
            const name = argumentsList[index];
            if (!['--input', '--output'].includes(name) || !argumentsList[index + 1] || args[name]) throw new PipelineError('INVALID_INPUT', '用法：node main.js --input 输入.json [--output tests/outputs/新结果.json]');
            args[name] = argumentsList[index + 1];
        }
        if (!args['--input']) throw new PipelineError('INVALID_INPUT', '必须提供--input UTF-8 JSON文件');
        let input;
        try { input = JSON.parse(fs.readFileSync(path.resolve(ROOT, args['--input']), 'utf8').replace(/^\uFEFF/, '')); } catch { throw new PipelineError('INVALID_INPUT', '输入文件不可读或JSON语法错误，未打印原始内容'); }
        const destination = args['--output'] ? outputPath(args['--output']) : null;
        const markdownDestination = args['--output'] ? outputPath(args['--output'].replace(/\.json$/, '.md'), false, '.md') : null;
        result = await runPipeline(input);
        validateSchema(result, schema('output'));
        if (destination) {
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.writeFileSync(destination, JSON.stringify(result, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
            fs.writeFileSync(markdownDestination, renderMarkdown(result), { encoding: 'utf8', flag: 'wx' });
        }
    } catch (error) {
        result = addError(baseResult(), error);
        programError = !(error instanceof PipelineError);
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = programError ? 1 : result.status === 'ready' ? 0 : result.status === 'needs_clarification' ? 2 : 3;
    return result;
}

if (require.main === module) cli(process.argv.slice(2));

module.exports = { cli, runPipeline, parseInput, parseRequest: parseInput, buildProfile, renderMarkdown, baseResult };
