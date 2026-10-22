'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runCloud, cloudMarkdown } = require('../backend/agent/cloud-runner');
const { runProductMatch, renderProductMatchMarkdown, productMatchExamples, validateProductMatchInput } = require('../backend/agent/product-match');
const { validateGuidedInput } = require('../backend/agent/guided-profile');
const { validateCloudInput } = require('../backend/agent/cloud-runner');
const { runContentDraft, renderContentDraftMarkdown } = require('../backend/agent/content-generation');

const forbidden = /云端模型|模型|\bIMA\b|\bJSON\b|\bMarkdown\b|发布门禁|门禁|诊断|规则引擎|引擎|排序分|证据|事实|字段|数组|字节|UTF-8|令牌|会话|dimensions|decisions|CTA|\bID\b|\bSHA-?256\b|\bfact-|\bofficial-|\bSKU\b|\bnull\b|\bready\b|\bunknown\b|\bconfigured\b|\bcalled\b|\b[a-z][a-z0-9]*_[a-z0-9_]+\b/i;

test('sales-facing markdown avoids developer-only wording', async () => {
    const cloud = await runCloud(require('./test_cases.json').cases.find(item => item.id === 'vague-budget').payload);
    const matchInput = productMatchExamples()[0].input;
    const match = await runProductMatch(matchInput);
    const candidate = match.candidates.find(item => item.product_name === 'HUAWEI MateBook 14 鸿蒙版') || match.candidates[0];
    const content = await runContentDraft({ schema_version: '1.0', match_input: matchInput, candidate_id: candidate.candidate_id, platform: '公众号', image_limit: 4 });
    const documents = [cloudMarkdown(cloud), renderProductMatchMarkdown(match), renderContentDraftMarkdown(content)];
    for (const markdown of documents) {
        assert.doesNotMatch(markdown, forbidden);
        assert.doesNotMatch(markdown, /<!--\s*IMAGE:/i);
    }
    assert.match(documents[0], /## 报价状态/);
    assert.match(documents[0], /正式成交报价：待确认/);
    assert.match(documents[1], /## 推荐候选/);
    assert.match(documents[2], /## 发布前检查结果/);
});
test('sales-facing errors avoid developer-only wording', () => {
    const checks = [
        () => validateProductMatchInput({ schema_version: '1.0', mode: 'local', use_cloud_model: false, profile: { product_type: '电脑' }, extra: true }),
        () => validateGuidedInput({ messages: [{ role: 'assistant', content: '尚未回答的问题' }] }),
        () => validateCloudInput({ use_cloud_model: 'yes', marketing_input: { product: 'HUAWEI MateBook 14 鸿蒙版', platform: '公众号' } }),
    ];
    for (const check of checks) {
        assert.throws(check, error => {
            assert.match(error.message, /填写|格式|内容|请/);
            assert.doesNotMatch(error.message, forbidden);
            return true;
        });
    }
});