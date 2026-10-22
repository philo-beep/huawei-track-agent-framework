'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PipelineError, validateSchema } = require('./support');
const { generateJson } = require('./model');
const { plainText, readableValue } = require('./sales-copy');

const CONTRACT_DIR = path.join(__dirname, 'contracts');
const INPUT_SCHEMA = JSON.parse(fs.readFileSync(path.join(CONTRACT_DIR, 'guided-profile-input.schema.json'), 'utf8'));
const PROMPT_PATH = path.join(__dirname, 'prompts', 'guided-profile.md');
const MAX_GUIDED_TURNS = 8;
const COVERAGE_THRESHOLD = 6;
const GAP_THRESHOLD = 2;
const MAX_MESSAGES = MAX_GUIDED_TURNS * 2 + 1;
const MAX_MESSAGE_CHARS = 800;

const DIMENSIONS = [
    {
        id: 'identity', label: '客户角色', core: true, priority: 1,
        question: '这位客户是什么角色，或负责哪项业务？',
        options: ['采购/IT负责人', '业务部门负责人', '个人用户'],
    },
    {
        id: 'industry', label: '客户行业', core: true, priority: 2,
        question: '这位客户属于哪个行业？',
        options: ['制造业', '教育/学校', '专业服务'],
    },
    {
        id: 'usage_scenario', label: '客户使用场景', core: true, priority: 3,
        question: '客户计划在哪些场景使用这款产品？',
        options: ['固定办公', '移动/混合办公', '教学或培训'],
    },
    {
        id: 'needs', label: '客户需求', core: true, priority: 4,
        question: '客户这次最想解决的核心需求是什么？',
        options: ['提升移动办公效率', '替换老旧设备', '满足软件兼容'],
    },
    {
        id: 'pain_points', label: '客户痛点', core: true, priority: 5,
        question: '客户当前最影响工作的问题是什么？',
        options: ['设备卡顿', '续航不足', '携带不便'],
    },
    {
        id: 'purchase_stage', label: '客户采购阶段', core: true, priority: 6,
        question: '客户目前处于哪个采购阶段？',
        options: ['刚了解', '正在比较', '已进入采购/审批'],
    },
    {
        id: 'budget', label: '客户预算', core: false, priority: 7,
        question: '客户目前是否有明确预算？如已明确，请说明金额和单台/总额口径。',
        options: ['预算未定', '单台预算', '总额预算'],
    },
    {
        id: 'conversation_habit', label: '客户沟通偏好', core: false, priority: 8,
        question: '客户更偏好哪种沟通方式？',
        options: ['文字沟通', '电话沟通', '线下当面沟通'],
    },
    {
        id: 'platform_knowledge', label: '客户方案认知', core: false, priority: 9,
        question: '客户对华为产品及相关方案已经了解到什么程度？',
        options: ['刚开始了解', '已看过具体型号', '已在门店/官网比较'],
    },
    {
        id: 'preferences', label: '客户偏好', core: false, priority: 10,
        question: '客户最看重哪项产品或服务偏好？',
        options: ['轻薄便携', '长续航', '屏幕与性能'],
    },
];

const DIMENSION_MAP = new Map(DIMENSIONS.map(item => [item.id, item]));
const CORE_DIMENSIONS = DIMENSIONS.filter(item => item.core);

function cleanText(value, maximum = 600) {
    return String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, maximum);
}

function normalizeValue(value) {
    if (Array.isArray(value)) return [...new Set(value.map(item => cleanText(item, 120)).filter(Boolean))].slice(0, 12);
    if (value && typeof value === 'object') {
        const budget = {};
        for (const name of ['min', 'max', 'quantity']) {
            if (value[name] !== undefined && value[name] !== null && value[name] !== '') {
                const number = Number(value[name]);
                if (Number.isFinite(number) && number >= 0) budget[name] = number;
            }
        }
        for (const name of ['currency', 'scope', 'note']) if (value[name]) budget[name] = cleanText(value[name], 100);
        return Object.keys(budget).length ? budget : null;
    }
    const text = cleanText(value, 240);
    return text || null;
}

function validateGuidedInput(input) {
    validateSchema(input, INPUT_SCHEMA);
    const messages = input.messages.map((message, index) => ({ role: message.role, content: cleanText(message.content, MAX_MESSAGE_CHARS) }));
    if (!messages.length) return { schema_version: '1.0', messages: [] };
    if (messages.at(-1).role !== 'user') throw new PipelineError('INVALID_INPUT', '请先填写客户信息再继续，不能把尚未回答的问题作为客户回答');
    if (messages.some(message => !message.content)) throw new PipelineError('INVALID_INPUT', '客户信息不能为空，请补充后重试');
    if (messages.length > MAX_MESSAGES) throw new PipelineError('INVALID_INPUT', `本次画像访谈记录较多，请重新开始后精简填写`);
    if (Buffer.byteLength(messages.map(message => message.content).join('\n'), 'utf8') > 12000) throw new PipelineError('INVALID_INPUT', '填写内容较长，请精简后再继续');
    return { schema_version: '1.0', messages };
}

function fallbackQuestion(dimensionId) {
    const dimension = DIMENSION_MAP.get(dimensionId) || DIMENSIONS[0];
    return { dimension: dimension.id, text: dimension.question, options: dimension.options.slice(), source: 'program_fallback' };
}

function userMessages(messages) {
    return messages.map((message, index) => ({ ...message, index })).filter(message => message.role === 'user');
}

function verifiedEvidence(evidence, messages) {
    const expected = cleanText(evidence, 500);
    if (!expected) return null;
    const hit = userMessages(messages).find(message => message.content.includes(expected));
    return hit ? { input_path: `/messages/${hit.index}`, quote: expected } : null;
}

function fieldFromModel(item, messages) {
    if (!item || !DIMENSION_MAP.has(item.dimension)) return null;
    const dimension = DIMENSION_MAP.get(item.dimension);
    const value = normalizeValue(item.value);
    if (value === null) return null;
    const evidence = verifiedEvidence(item.evidence, messages);
    if (!evidence) {
        return {
            value: null,
            status: 'pending',
            evidence: [],
            reason: '智能分析没有找到可定位的客户原话，已改为待确认',
            confidence: 0,
        };
    }
    const status = item.status === 'inferred' ? 'inferred' : 'explicit';
    const confidence = Number.isFinite(Number(item.confidence)) ? Math.min(1, Math.max(0, Number(item.confidence))) : (status === 'explicit' ? 0.85 : 0.6);
    return {
        value,
        status,
        evidence: [evidence],
        reason: cleanText(item.reason, 300) || (status === 'inferred' ? '基于客户原话归纳，仍需确认' : '客户原话明确表达'),
        confidence,
        label: dimension.label,
    };
}

function fieldsFromModel(output, messages) {
    const items = Array.isArray(output?.dimensions) ? output.dimensions : [];
    const fields = {};
    for (const item of items) {
        const field = fieldFromModel(item, messages);
        if (field) fields[item.dimension] = field;
    }
    return Object.fromEntries(DIMENSIONS.map(dimension => [dimension.id, fields[dimension.id] || {
        value: null,
        status: 'pending',
        evidence: [],
        reason: '尚未获得可定位的客户原话',
        confidence: 0,
        label: dimension.label,
    }]));
}

function coverageOf(fields) {
    const covered = DIMENSIONS.filter(dimension => fields[dimension.id]?.status !== 'pending');
    const coveredCore = CORE_DIMENSIONS.filter(dimension => fields[dimension.id]?.status !== 'pending');
    return {
        covered_count: covered.length,
        total_count: DIMENSIONS.length,
        core_covered_count: coveredCore.length,
        core_total_count: CORE_DIMENSIONS.length,
        threshold: COVERAGE_THRESHOLD,
        gap_threshold: GAP_THRESHOLD,
        covered_dimensions: covered.map(item => item.id),
        missing_dimensions: DIMENSIONS.filter(item => fields[item.id]?.status === 'pending').map(item => item.id),
    };
}

function stopDecision(coverage, turn) {
    if (turn >= MAX_GUIDED_TURNS) return 'max_turns';
    if (coverage.missing_dimensions.length <= GAP_THRESHOLD) return 'gap_threshold';
    if (coverage.covered_count >= COVERAGE_THRESHOLD && coverage.core_covered_count >= 5) return 'coverage_threshold';
    return null;
}

function validQuestion(question, coverage) {
    if (!question || typeof question !== 'object' || !DIMENSION_MAP.has(question.dimension)) return false;
    if (!coverage.missing_dimensions.includes(question.dimension)) return false;
    const text = cleanText(question.text, 180);
    if (text.length < 6 || text.length > 160) return false;
    if ((text.match(/[?？]/g) || []).length > 1) return false;
    const selfAddressed = /(?:^|[，。；\s])(?:您|你)(?:的|在|是|主要|负责|所在|公司|行业|岗位|业务|需求|痛点|预算|采购|使用)/.test(text);
    if (selfAddressed) return false;
    return true;
}

function questionFromModel(question, coverage) {
    if (!validQuestion(question, coverage)) return null;
    return {
        dimension: question.dimension,
        text: cleanText(question.text, 180),
        options: [...new Set((Array.isArray(question.options) ? question.options : []).map(item => cleanText(item, 40)).filter(Boolean))].slice(0, 4),
        source: 'cloud_model',
    };
}

function modelPrompt(messages, fields, coverage) {
    return JSON.stringify({
        task: '根据已有对话抽取画像，并只决定下一步的一个问题；如果覆盖已充分则停止。',
        limits: { max_turns: MAX_GUIDED_TURNS, coverage_threshold: COVERAGE_THRESHOLD, gap_threshold: GAP_THRESHOLD },
        dimensions: DIMENSIONS.map(item => ({ id: item.id, label: item.label, core: item.core })),
        current_coverage: coverage,
        current_fields: fields,
        conversation: messages,
        requirements: {
            salesperson_voice: '使用者是华为销售顾问。所有提问都面向销售顾问，询问其掌握的客户情况；问题主语必须是“客户/这位客户”，不得把销售顾问本人当作客户来询问其岗位、行业、痛点和采购阶段。',
            evidence: '每个非pending字段必须提供在某个user消息中逐字出现的evidence；该字段是销售顾问录入的客户原话或转述',
            unknown_budget: '若客户明确说预算未定，可记作explicit，value设为“预算未定”',
            one_question_only: 'next_question.text最多一个问号，且只能询问当前missing_dimensions中的一个',
            stop: '覆盖充分时next_question必须为null',
        },
    });
}

function customerSummary(fields) {
    const parts = DIMENSIONS
        .map(item => [item.label, fields[item.id]])
        .filter(([, value]) => value?.status !== 'pending')
        .map(([label, value]) => `${label}：${typeof value.value === 'object' ? JSON.stringify(value.value, null, 0) : Array.isArray(value.value) ? value.value.join('、') : value.value}`);
    return parts.length ? parts.join('；') : '尚未获得足够信息形成客户画像。';
}

function productMatchProfile(fields) {
    const value = id => fields[id]?.status !== 'pending' ? fields[id].value : null;
    const list = id => Array.isArray(value(id)) ? value(id) : value(id) ? [value(id)] : [];
    const budget = value('budget');
    return {
        raw_request: customerSummary(fields),
        audience: value('identity'),
        industry: value('industry'),
        scenario: value('usage_scenario'),
        product_type: null,
        needs: list('needs'),
        preferences: list('preferences'),
        pain_points: list('pain_points'),
        excluded_requirements: [],
        budget: budget && typeof budget === 'object' && [budget.min, budget.max].some(Number.isFinite) ? budget : null,
        purchase_stage: value('purchase_stage'),
        conversation_habit: value('conversation_habit'),
        platform_knowledge: value('platform_knowledge'),
    };
}

function renderGuidedProfileMarkdown(result) {
    const lines = [
        '# 客户画像', '',
        `- 状态：${result.status === 'complete' ? '已完成' : '继续了解中'}`,
        `- 已进行：${result.turn}/${result.max_turns} 轮`,
        `- 已了解信息：${result.coverage.covered_count}/${result.coverage.total_count} 项`, '',
        '## 客户概况', '', plainText(result.summary), '',
        '## 客户信息', ''
    ];
    for (const dimension of DIMENSIONS) {
        const field = result.fields[dimension.id];
        lines.push(`- **${dimension.label}**：${field.status === 'pending' ? '待确认' : plainText(readableValue(field.value))}`);
        if (field.evidence?.length) lines.push(`  - 依据：${field.evidence.map(item => `“${item.quote}”`).join('；')}`);
    }
    if (result.next_question) lines.push('', '## 下一问', plainText(result.next_question.text));
    lines.push('', '> 画像只包含销售顾问录入的客户明确信息或清楚标注的推断；预算、采购权限和决策链不会因推断变成已确认信息。');
    return lines.join('\n');
}

async function runGuidedProfile(input, options = {}) {
    const normalized = validateGuidedInput(input || {});
    const messages = normalized.messages;
    const turn = userMessages(messages).length;
    const runner = options.runner || generateJson;
    const model = options.model || null;

    if (!messages.length) {
        const coverage = coverageOf(fieldsFromModel({}, []));
        const result = {
            schema_version: '1.0',
            status: 'question',
            turn: 0,
            max_turns: MAX_GUIDED_TURNS,
            stop_reason: null,
            coverage,
            fields: fieldsFromModel({}, []),
            next_question: fallbackQuestion('industry'),
            summary: '尚未获得足够信息形成客户画像。',
            product_match_profile: productMatchProfile(fieldsFromModel({}, [])),
            runtime: { called: false, provider: null, model: model || null, notice: '第一个问题由系统给出；销售顾问提交客户信息后，将由智能分析判断合适的下一问。' },
            diagnostics: [],
        };
        result.markdown = renderGuidedProfileMarkdown(result);
        return result;
    }

    const system = fs.readFileSync(PROMPT_PATH, 'utf8');
    const prelimFields = fieldsFromModel({}, messages);
    const prelimCoverage = coverageOf(prelimFields);
    let generated;
    try {
        generated = await runner(system, modelPrompt(messages, prelimFields, prelimCoverage), 1200);
    } catch (error) {
        if (error instanceof PipelineError) throw error;
        throw new PipelineError('MODEL_UNAVAILABLE', '智能分析暂不可用，本次没有继续追问，也没有生成未经确认的客户信息', true);
    }
    const output = generated?.value;
    if (!output || typeof output !== 'object' || !Array.isArray(output.dimensions)) throw new PipelineError('MODEL_OUTPUT_INVALID', '智能分析结果暂时无法读取，请稍后重试');
    const fields = fieldsFromModel(output, messages);
    const coverage = coverageOf(fields);
    const stopReason = stopDecision(coverage, turn);
    let nextQuestion = null;
    const diagnostics = [];
    if (!stopReason) {
        nextQuestion = questionFromModel(output.next_question, coverage);
        if (!nextQuestion) {
            const firstMissing = DIMENSIONS.find(item => coverage.missing_dimensions.includes(item.id));
            nextQuestion = fallbackQuestion(firstMissing?.id || 'needs');
            diagnostics.push({ code: 'GUIDED_QUESTION_FALLBACK', message: '本次问题需要重新整理，系统已根据尚未了解的信息给出下一问', retryable: false });
        }
    }
    const result = {
        schema_version: '1.0',
        status: stopReason ? 'complete' : 'question',
        turn,
        max_turns: MAX_GUIDED_TURNS,
        stop_reason: stopReason,
        coverage,
        fields,
        next_question: nextQuestion,
        summary: customerSummary(fields),
        product_match_profile: productMatchProfile(fields),
        runtime: {
            called: true,
            provider: generated?.provider || 'openai-compatible',
            model: generated?.model || model || null,
            notice: '本轮回答已交给智能分析；系统会独立检查关键信息是否齐全，并控制访谈何时结束。',
        },
        diagnostics,
    };
    result.markdown = renderGuidedProfileMarkdown(result);
    return result;
}

module.exports = {
    runGuidedProfile,
    renderGuidedProfileMarkdown,
    validateGuidedInput,
    coverageOf,
    fieldsFromModel,
    stopDecision,
    DIMENSIONS,
    MAX_GUIDED_TURNS,
    COVERAGE_THRESHOLD,
};
