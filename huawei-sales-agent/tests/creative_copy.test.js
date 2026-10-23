'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runProductMatch, productMatchExamples } = require('../backend/agent/product-match');
const { runContentDraft, renderContentDraftMarkdown } = require('../backend/agent/content-generation');

const baseProfile = productMatchExamples()[0].input.profile;

async function generate(profileOverrides, platform, imageLimit) {
    const input = JSON.parse(JSON.stringify(productMatchExamples()[0].input));
    input.mode = 'local';
    input.use_cloud_model = false;
    input.profile = { ...JSON.parse(JSON.stringify(baseProfile)), ...profileOverrides };
    const match = await runProductMatch(input);
    const candidate = match.candidates.find(item => item.product_name === 'HUAWEI MateBook 14') || match.candidates[0];
    const output = await runContentDraft({
        schema_version: '1.0',
        match_input: input,
        candidate_id: candidate.candidate_id,
        platform,
        image_limit: imageLimit,
    });
    return { input, match, output };
}

const personae = [
    {
        id: 'procurement',
        profile: {
            audience: '制造企业采购负责人',
            scenario: '仓库与办公室轮用，需要移动办公',
            needs: ['移动办公', '办公'],
            preferences: ['长续航', '便携'],
            pain_points: ['软件兼容性待确认'],
        },
    },
    {
        id: 'educator',
        profile: {
            audience: '民办培训机构教研老师',
            scenario: '备课文稿与课堂展示文件的选型核对',
            needs: ['备课', '课堂展示'],
            preferences: ['屏幕清晰', '便携'],
            pain_points: ['软件版本待确认'],
        },
    },
    {
        id: 'executive',
        profile: {
            audience: '初创公司创始人',
            scenario: '与现有电脑做配置和价格比较',
            needs: ['办公', '比较'],
            preferences: ['少维护', '便携'],
            pain_points: ['完整配置待确认'],
        },
    },
];

test('同一个平台会根据人群与任务改变表达策略，而不是换词套模板', async () => {
    const outputs = [];
    for (const persona of personae) {
        const { output } = await generate(persona.profile, '公众号', 4);
        assert.equal(output.expression_strategy.audience.id, persona.id);
        outputs.push(output);
    }
    assert.deepEqual(outputs.map(output => output.expression_strategy.task.id), ['mobility', 'teaching', 'comparison']);
    assert.equal(new Set(outputs.map(output => output.publish_copy.title)).size, 3);
    assert.equal(new Set(outputs.map(output => output.publish_copy.markdown)).size, 3);
    for (const output of outputs) {
        assert.match(output.publish_copy.markdown, /HUAWEI MateBook 14（鸿蒙版）/);
        assert.doesNotMatch(output.publish_copy.markdown, /读者需要|读者通常|读者关心/);
    }
});

test('同一份需求在三个平台使用不同的标题、结构和行动引导', async () => {
    const outputs = [];
    for (const platform of ['公众号', '小红书', '朋友圈']) {
        const { output } = await generate(personae[0].profile, platform, platform === '朋友圈' ? 1 : 3);
        outputs.push(output);
    }
    assert.deepEqual(outputs.map(output => output.expression_strategy.platform.id), ['wechat_article', 'xiaohongshu_note', 'moments_short_post']);
    assert.equal(new Set(outputs.map(output => output.publish_copy.title)).size, 3);
    assert.equal(new Set(outputs.map(output => output.publish_copy.markdown)).size, 3);
    assert.match(outputs[0].publish_copy.markdown, /^# /);
    assert.match(outputs[0].publish_copy.markdown, /## 把选择放回你的日常/);
    assert.match(outputs[1].publish_copy.markdown, /01｜把它放进日常/);
    assert.match(outputs[1].publish_copy.markdown, /#华为笔记本/);
    assert.doesNotMatch(outputs[2].publish_copy.markdown, /^# |## /m);
    assert.ok(outputs[2].publish_copy.character_count < outputs[0].publish_copy.character_count / 2);
});

test('发布正文里的参数逐字来自锁定原文，不含价格推断', async () => {
    const { output } = await generate(personae[0].profile, '公众号', 4);
    assert.ok(output.publish_copy.fact_excerpts.length >= 1);
    for (const excerpt of output.publish_copy.fact_excerpts) {
        assert.ok(output.citations.some(citation => citation.claim.includes(excerpt.value)));
        assert.ok(output.publish_copy.markdown.includes(excerpt.value));
    }
    assert.doesNotMatch(output.publish_copy.markdown, /(?:¥|￥|\bCNY\b|\bRMB\b|人民币|售价|到手价|成交价|优惠价|折扣价)/);
    assert.equal(output.expression_strategy.fact_policy.parameters_locked, true);
    assert.equal(output.expression_strategy.fact_policy.price_locked, true);
});

test('可直接复制的正文与内部审核材料分离，配图仍按精确型号和授权状态单独管理', async () => {
    const { output } = await generate(personae[0].profile, '公众号', 4);
    const publish = output.publish_copy.markdown;
    assert.equal(renderContentDraftMarkdown(output), publish);
    assert.doesNotMatch(publish, /<!--\s*IMAGE:/i);
    assert.doesNotMatch(publish, /发布前检查|资料核对卡|客户背景|明确需求|当前偏好|待确认问题|internal|fact-|official-|JSON|Markdown|SHA-?256/i);
    assert.equal(output.publish_copy.image_order.length, 4);
    assert.ok(output.publish_copy.image_order.every(image => image.publication_ready === false));
    assert.ok(output.publish_copy.image_order.every(image => image.asset_url.startsWith('/api/content-images/')));
    assert.match(publish, /软件兼容/);
    assert.doesNotMatch(publish, /保证成交|保证转化|全网最低|官方已确认|绝对兼容|完全兼容/);
});


test('消费者从生活故事认识产品，只讲画像相关的功能并尊重排除项', async () => {
    const profile = {
        audience: '个人自由职业创作者',
        scenario: '通勤与咖啡馆改稿，回家继续写稿',
        needs: ['文稿编辑'], preferences: ['便携', '屏幕清晰'],
        pain_points: ['软件版本待确认'], excluded_requirements: ['处理器'],
    };
    const { output } = await generate(profile, '公众号', 4);
    assert.match(output.draft.lead, /^想象一下：.*咖啡馆/);
    assert.doesNotMatch(output.publication_readiness.cover_copy.copy_text, /任务清单|先把任务列|先核对|采购审批/);
    assert.match(output.publish_copy.body, /光标|灵感/);
    assert.match(output.publish_copy.body, /分辨率说的是画面像素/);
    assert.ok(output.citations.some(item => item.claim.startsWith('## 屏幕')));
    assert.ok(output.citations.some(item => item.claim.startsWith('## 尺寸')));
    assert.ok(output.citations.every(item => !/^## (处理器|操作系统|电池)/.test(item.claim)));
    assert.doesNotMatch(output.publish_copy.markdown, /客户背景|采购审批|已知条件|任务清单|原文核对|参数按原文|资料里能|亲测|我买了/);
    const { output: excluded } = await generate({ ...profile, excluded_requirements: ['重量', '处理器'] }, '公众号', 4);
    assert.ok(excluded.citations.every(item => !/^## (尺寸|处理器)/.test(item.claim)));
});

test('创作温度作用于故事开场，参数不随创作改写；异常开场退回本地故事', async () => {
    const { input, match, output: original } = await generate(personae[0].profile, '公众号', 4);
    input.use_cloud_model = true;
    const request = { schema_version: '1.0', match_input: input, candidate_id: original.product.candidate_id, platform: '公众号' };
    const opening = '想象一下：你在窗边坐下，把一路想到的句子写在纸上。杯子挪到手边，翻开熟悉的文稿，刚才还有些杂乱的思路慢慢清楚起来。你删去一句多余的话，又添上一个更贴近日常的例子，故事也跟着往前走了一点。';
    let calls = 0;
    const generated = await runContentDraft(request, { matchRunner: async () => match, generateJson: async (system, prompt, limit, options) => {
        calls++;
        assert.equal(options.temperature, 0.8);
        return { value: { opening } };
    } });
    assert.equal(calls, 1);
    assert.equal(generated.draft.lead, opening);
    assert.ok(generated.publish_copy.markdown.includes(opening));
    assert.deepEqual(generated.publish_copy.fact_excerpts, original.publish_copy.fact_excerpts);
    assert.equal(generated.verification.items.find(item => item.id === 'parameters').status, 'pass');
    assert.ok(generated.diagnostics.some(item => item.code === 'STORY_MODEL_GENERATED'));
    const rejected = await runContentDraft(request, { matchRunner: async () => match, generateJson: async () => ({ value: { opening: opening + '这台电脑续航99小时。' } }) });
    assert.equal(rejected.draft.lead, original.draft.lead);
    assert.ok(rejected.diagnostics.some(item => item.code === 'STORY_LOCAL_FALLBACK'));
});

test('模型适配器在两种协议上传递创作温度，事实抽取保留低温和本地固定种子', async () => {
    const { generateJson } = require('../backend/agent/model');
    const names = ['CLOUD_MODEL_PROVIDER', 'CLOUD_MODEL_API_KEY', 'CLOUD_MODEL_BASE_URL'];
    const saved = names.map(name => process.env[name]);
    const previousFetch = global.fetch;
    const payloads = [];
    try {
        process.env.CLOUD_MODEL_API_KEY = 'synthetic-test-key';
        process.env.CLOUD_MODEL_BASE_URL = 'https://synthetic.invalid';
        global.fetch = async (url, options) => {
            payloads.push(JSON.parse(options.body));
            return { ok: true, json: async () => ({ response: '{}', choices: [{ message: { content: '{}' } }] }) };
        };
        for (const provider of ['openai-compatible', 'ollama']) {
            process.env.CLOUD_MODEL_PROVIDER = provider;
            await generateJson('test', 'test', 100);
            await generateJson('test', 'test', 100, { temperature: 0.8 });
        }
        assert.deepEqual(payloads.map(item => item.temperature ?? item.options.temperature), [0.1, 0.8, 0.1, 0.8]);
        assert.equal(payloads[2].options.seed, 42);
        assert.equal(payloads[3].options.seed, undefined);
    } finally {
        global.fetch = previousFetch;
        names.forEach((name, index) => { if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index]; });
    }
});
