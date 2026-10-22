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
    assert.match(outputs[0].publish_copy.markdown, /## 下一步沟通/);
    assert.match(outputs[1].publish_copy.markdown, /01｜先把任务列出来/);
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
