'use strict';

const DIMENSIONS = ['identity', 'relationship', 'industry', 'company_size', 'needs', 'budget', 'decision_chain', 'preferences', 'pain_points', 'purchase_stage', 'channels'];
const LABELS = { identity: '身份角色', relationship: '客户关系', industry: '行业', company_size: '企业规模', needs: '需求目标', budget: '预算', decision_chain: '决策链', preferences: '偏好', pain_points: '痛点', purchase_stage: '采购阶段', channels: '真实触达渠道' };

function pending(reason = '未提供明确依据，待确认', evidence = []) {
    return { value: null, status: 'pending', evidence, reason, confidence: 0 };
}

function field(value, inputPath, quote, reason = '客户明确输入', status = 'explicit') {
    return { value, status, evidence: [{ input_path: inputPath, quote }], reason, confidence: status === 'explicit' ? 1 : 0.7 };
}

function primitiveQuote(value) {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

// 模块2：确定性画像解析；原话只作数据，不执行其中指令。
function parseInput(input) {
    const source = typeof input === 'string' ? { raw_request: input } : (input && typeof input === 'object' && !Array.isArray(input) ? input : {});
    const normalized = { schema_version: '1.0', mode: 'local', ...source };
    const profile = Object.fromEntries(DIMENSIONS.map(name => [name, pending()]));
    const questions = [];
    const diagnostics = [];
    const conflicts = [];
    const raw = typeof source.raw_request === 'string' ? source.raw_request : '';
    const customer = source.customer && typeof source.customer === 'object' ? source.customer : {};
    const addQuestion = (name, question, blocks = 'none') => {
        if (!questions.some(item => item.field === name)) questions.push({ field: name, question, blocks });
    };
    const conflict = (name, reason, evidence) => {
        profile[name] = pending(reason, evidence);
        conflicts.push(name);
        addQuestion(`customer.${name}`, `${LABELS[name]}存在冲突或歧义，请确认：${reason}`, name === 'budget' ? 'quote' : 'content');
    };
    for (const name of DIMENSIONS) {
        if (customer[name] === undefined || customer[name] === null || customer[name] === '待确认') continue;
        const value = customer[name];
        if (name === 'budget') continue;
        profile[name] = field(value, `/customer/${name}`, primitiveQuote(value));
    }
    const capture = (name, pattern, transform = match => match[0], status = 'explicit') => {
        const matches = [...raw.matchAll(new RegExp(pattern.source, `${pattern.flags.replace(/g/g, '')}g`))];
        if (!matches.length) return;
        const corrected = /更正|纠正|改为/.test(raw);
        const match = corrected ? matches.at(-1) : matches[0];
        const value = transform(match);
        if (name === 'company_size' && !corrected && new Set(matches.map(entry => JSON.stringify(transform(entry)))).size > 1) {
            conflict(name, '原话包含不一致人数，需核实', matches.map(entry => ({ input_path: '/raw_request', quote: entry[0] })));
        } else if (Array.isArray(profile[name].value) && Array.isArray(value) && value.every(entry => profile[name].value.includes(entry))) {
            return;
        } else if (profile[name].status !== 'pending' && JSON.stringify(profile[name].value) !== JSON.stringify(value)) {
            conflict(name, '结构化字段与客户原话不一致', [...profile[name].evidence, { input_path: '/raw_request', quote: match[0] }]);
        } else if (!conflicts.includes(name)) {
            profile[name] = field(value, '/raw_request', match[0], status === 'inferred' ? '按有依据的业务语义推断，需客户确认' : '客户原话明确表达', status);
        }
    };
    capture('identity', /采购负责人|采购经理|IT负责人|独立设计师|设计师|教师|教研组|学生|个人用户|自由职业者/);
    capture('industry', /制造企业|制造业|设计公司|设计服务|学校|教育|咨询公司|金融|医疗|物流|零售|互联网/, match => ({ 制造企业: '制造业', 设计公司: '设计服务', 学校: '教育', 咨询公司: '咨询服务' }[match[0]] || match[0]));
    capture('company_size', /(?:员工\s*(\d+)\s*(?:人|名)?|(?:共|有)?\s*(\d+)\s*(?:名员工|位员工|人公司|人咨询公司|个人|人工作室))/, match => Number(match[1] || match[2]));
    capture('needs', /移动办公|培训|批量备课|备课|跨设备协作|软件兼容性|设计用|仓库与办公室轮用|办公电脑/, match => [match[0]]);
    capture('preferences', /轻薄|便携|长续航|安静|低噪|大屏|触控|轻便/, match => [match[0]]);
    capture('pain_points', /软件不兼容|频繁卡顿|电池不够用|携带不便|设备老化|兼容性问题/, match => [match[0]]);
    capture('decision_chain', /(?:等待|需要|须|需)(?:领导|部门|财务)?审批|最终审批人待确认|采购负责人收集方案/, match => [match[0]]);
    capture('channels', /(?:通过|可以|可用|联系渠道为|联系渠道是)(微信|电话|邮件|门店|企业微信)(?:联系|沟通|触达)?/, match => [match[1]]);
    const relationRaw = raw.replace(/(?:不是|并非|不算|非)(?:新客户|新客|老客户|老客)/g, text => ' '.repeat(text.length));
    const newMatch = relationRaw.match(/新客户|新客|首次咨询|第一次联系|第一次买/);
    const oldMatch = relationRaw.match(/老客户|老客/);
    if (newMatch && oldMatch) {
        conflict('relationship', '新客/首次购买与老客户表述并存，需区分客户关系与本次交易', [{ input_path: '/raw_request', quote: newMatch[0] }, { input_path: '/raw_request', quote: oldMatch[0] }]);
    } else if (newMatch || oldMatch) {
        const value = newMatch ? '新客' : '老客';
        const match = newMatch || oldMatch;
        if (profile.relationship.status !== 'pending' && profile.relationship.value !== value) conflict('relationship', '结构化关系与原话不同', [...profile.relationship.evidence, { input_path: '/raw_request', quote: match[0] }]);
        else profile.relationship = field(value, '/raw_request', match[0]);
    }
    capture('purchase_stage', /首次咨询|先了解|正在比较|比较两款|比价|部门试点|试点|续约|加购|增加\s*\d+\s*台/, match => ({ 正在比较: '比价', 比较两款: '比价', 先了解: '了解', 部门试点: '试点' }[match[0]] || match[0]));
    if (customer.budget !== undefined) {
        const budget = customer.budget;
        const evidence = [];
        for (const [name, value] of Object.entries(budget || {})) evidence.push({ input_path: `/customer/budget/${name}`, quote: primitiveQuote(value) });
        if (budget && typeof budget === 'object' && Object.keys(budget).length) {
            profile.budget = { value: { ...budget }, status: 'explicit', evidence, reason: '客户提供的预算，不等同真实报价或支付能力', confidence: 1 };
            if ([budget.min, budget.max].some(value => value !== undefined && (!Number.isFinite(value) || value < 0)) || (budget.quantity !== undefined && (!Number.isInteger(budget.quantity) || budget.quantity < 1))) diagnostics.push({ code: 'INVALID_INPUT', message: '预算金额或采购数量不合法', retryable: false });
            if ((budget.min !== undefined && budget.max !== undefined && budget.min > budget.max) || [budget.min, budget.max].some(value => value > 1e12)) conflict('budget', '预算区间倒置或金额极端，需确认', evidence);
            else if (!budget.currency || !budget.scope || budget.scope === '待确认') addQuestion('customer.budget', '请确认预算币种及单台/总额口径。', 'quote');
        }
    }
    const budgetMatches = [...raw.matchAll(/(?:总预算|每台预算|单台预算|现金预算|预算)(?:为|是|约|不超过|[:：])?\s*(-?\d+(?:\.\d+)?)(万|千)?\s*(元|人民币|美元|USD|CNY)?/g)];
    if (budgetMatches.length && !/把预算猜|预算猜成|虚构(?:预算|基价)|编造预算/.test(raw)) {
        const amounts = budgetMatches.map(match => Number(match[1]) * (match[2] === '万' ? 10000 : match[2] === '千' ? 1000 : 1));
        const evidence = budgetMatches.map(match => ({ input_path: '/raw_request', quote: match[0] }));
        if (amounts.some(value => !Number.isFinite(value) || value < 0)) {
            diagnostics.push({ code: 'INVALID_INPUT', message: '原话预算含负数或非法金额，请更正', retryable: false });
            conflict('budget', '预算金额不合法', evidence);
        } else if (amounts.some(value => value > 1e12) || new Set(amounts).size > 1 || new Set(budgetMatches.map(match => /美元|USD/.test(match[0]) ? 'USD' : /元|人民币|CNY/.test(match[0]) ? 'CNY' : '').filter(Boolean)).size > 1 || /(?:预算|币种).{0,8}(?:未知|尚未确认|未确认|不明)/.test(raw)) {
            conflict('budget', '预算存在极端数值或互不一致的金额，不自动选取或折算', evidence);
        } else {
            const match = budgetMatches[0];
            const scope = /总预算|总额/.test(raw) ? '总额' : /每台|单台/.test(raw) ? '单台' : '待确认';
            const currency = /美元|USD/.test(match[0]) ? 'USD' : /元|人民币|CNY/.test(match[0]) ? 'CNY' : null;
            const quantityMatch = /(?:采购|购机|购|买|加购|增加)\s*(\d+)\s*台/.exec(raw);
            const budget = { ...(profile.budget.value || {}), min: amounts[0], max: amounts[0], source_text: match[0] };
            if (scope !== '待确认' || !budget.scope) budget.scope = scope;
            if (currency) budget.currency = currency;
            if (quantityMatch) budget.quantity = Number(quantityMatch[1]);
            if (profile.budget.value && ([profile.budget.value.min, profile.budget.value.max].some(value => value !== undefined && value !== amounts[0]) || (currency && profile.budget.value.currency && currency !== profile.budget.value.currency) || (scope !== '待确认' && profile.budget.value.scope && profile.budget.value.scope !== '待确认' && scope !== profile.budget.value.scope) || (quantityMatch && profile.budget.value.quantity && Number(quantityMatch[1]) !== profile.budget.value.quantity))) conflict('budget', '结构化预算与原话金额、币种、口径或数量不一致', [...profile.budget.evidence, ...evidence, ...(quantityMatch ? [{ input_path: '/raw_request', quote: quantityMatch[0] }] : [])]);
            else if (!conflicts.includes('budget')) profile.budget = { value: budget, status: 'explicit', evidence: [...profile.budget.evidence, ...evidence, ...(quantityMatch ? [{ input_path: '/raw_request', quote: quantityMatch[0] }] : [])], reason: '预算为客户输入，绝不是产品价格或补助资格', confidence: 1 };
            if (!budget.currency || budget.scope === '待确认') addQuestion('customer.budget', '预算是单台还是总额，使用什么币种？', 'quote');
            if (amounts[0] === 0) addQuestion('customer.budget_funding', '现金预算为0，是否存在已确认、可使用的资金来源？不预设补助可用。', 'quote');
        }
    }
    if (/预算(?:未知|还没定|未定|不明)|没决定预算|预算等待审批/.test(raw) && !budgetMatches.length && !customer.budget) profile.budget = pending('客户明确表示预算未知', [{ input_path: '/raw_request', quote: (raw.match(/预算(?:未知|还没定|未定|不明)|没决定预算|预算等待审批/) || [])[0] }]);
    const productMatches = [...raw.matchAll(/(?:HUAWEI\s+)?MateBook\s*(?:Fold(?:\s*非凡大师)?|X\s*Pro|Pro(?:\s*S)?|D\s*\d{2}|\d{2}(?:\s*s)?)/gi)].map(match => match[0].trim());
    if (!normalized.product && new Set(productMatches.map(value => value.replace(/\s/g, '').toLowerCase())).size === 1) normalized.product = productMatches[0];
    if (new Set(productMatches.map(value => value.replace(/\s/g, '').toLowerCase())).size > 1 || (source.product && productMatches.some(value => value.replace(/huawei|\s/gi, '').toLowerCase() !== source.product.replace(/huawei|\s/gi, '').toLowerCase()))) {
        conflicts.push('product');
        normalized.product = null;
        addQuestion('product', '出现不同产品型号，请确认目标型号，不能合并近似型号。', 'content');
    }
    const platforms = ['小红书', '公众号', '朋友圈'].filter(value => raw.includes(value));
    if (!normalized.platform && platforms.length === 1) normalized.platform = platforms[0];
    if (platforms.length > 1 || (source.platform && platforms.some(value => value !== source.platform))) {
        normalized.platform = null;
        addQuestion('platform', '存在多个或冲突的发布平台，请明确本次一个平台。', 'content');
    }
    if (!normalized.audience) {
        const audience = raw.match(/个人(?:用户|办公|用)|独立设计师|设计师|学校教研组|制造企业|咨询公司|工作室|新客户|新客|老客户|老客|采购负责人|学生|教师/);
        if (audience) normalized.audience = audience[0];
    }
    if (!normalized.scenario) {
        const scenario = raw.match(/移动办公|培训|备课|仓库与办公室轮用|办公电脑|跨设备协作|软件兼容性|个人办公|设计用|介绍产品(?:的已知事实)?|续约/);
        if (scenario) normalized.scenario = scenario[0];
    }
    for (const name of ['product', 'audience', 'scenario', 'platform']) {
        if (!normalized[name]) addQuestion(name, `请明确${{ product: '产品完整型号', audience: '目标人群或客户描述', scenario: '具体使用场景', platform: '本次发布平台（小红书、公众号或朋友圈）' }[name]}。`, 'content');
    }
    return { normalized, profile, questions, diagnostics, conflicts };
}

function buildProfile(input) {
    return parseInput(input).profile;
}

module.exports = { parseInput, parseRequest: parseInput, buildProfile, DIMENSIONS };
