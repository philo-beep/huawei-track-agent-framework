'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runReleaseVerification } = require('../backend/agent/release-verification');

function fixture(overrides = {}) {
    const productName = 'HUAWEI MateBook 14（鸿蒙版）';
    const claim = '## 尺寸与重量\n\n厚度\n\n14.5 mm';
    const sourceUrl = 'https://consumer.huawei.com/cn/harmonyos-computer/matebook-14-harmonyos-version/';
    const fact = {
        id: 'fact-1-demo',
        product: productName,
        claim,
        conditions: [],
        source_refs: [{
            title: `${productName} - 产品事实`,
            entry: '华为PC全板块深度知识库_v7/产品事实.md',
            entry_sha256: 'a'.repeat(64),
            urls: [sourceUrl],
            excerpt: claim,
        }],
    };
    const candidate = {
        candidate_id: 'candidate-123456789abc',
        product_name: productName,
        evidence: [{
            evidence_id: 'ev-1',
            source_level: 'E1',
            title: `${productName} - 产品事实`,
            locator: '华为PC全板块深度知识库_v7/产品事实.md',
            excerpt: claim,
            url: sourceUrl,
        }],
    };
    const image = {
        image_id: 'image-demo',
        product: productName,
        file_name: 'demo.png',
        caption: '目标型号外观示意',
        sha256: 'b'.repeat(64),
        original_url: 'https://consumer.huawei.com/demo.png',
        ima_entry: '知识库/demo.png',
        ima_kb_id: 'kb-demo',
        ima_search_request_ids: ['request-1'],
        source_status: 'http_200',
        publication_ready: true,
        formal_publication_verified: true,
    };
    const draft = {
        title: '移动办公前先核对参数',
        lead: '先确认任务与来源，再准备演示。',
        body_markdown: '<!-- IMAGE:after_title -->\n\n## 原文核对\n\n14.5 mm',
        cta: '请补充软件版本和文件格式，再由人工确认。',
        tags: ['移动办公'],
    };
    const citation = {
        fact_id: fact.id,
        claim,
        used_in: 'body',
        source_title: fact.source_refs[0].title,
        source_url: sourceUrl,
        source_entry: fact.source_refs[0].entry,
        source_sha256: fact.source_refs[0].entry_sha256,
    };
    return {
        product: { requested_name: productName, resolved_name: productName, model_verified: true },
        candidate,
        draft,
        facts: [fact],
        image_sources: [image],
        citations: [citation],
        ...overrides,
    };
}

test('passes all six gates only when model, facts, price, image rights and sources close', () => {
    const verification = runReleaseVerification(fixture());
    assert.equal(verification.overall_status, 'passed');
    assert.equal(verification.publication_ready, true);
    assert.equal(verification.safe_content_ready, true);
    assert.deepEqual(verification.items.map(item => item.status), ['pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
    assert.equal(verification.risk_items.length, 0);
    assert.deepEqual(verification.safe_content.content.image_ids, ['image-demo']);
    assert.match(verification.safe_content.content.body_markdown, /<!-- IMAGE:after_title -->/);
});

test('blocks release when the core copy contains an unsupported absolute promise', () => {
    const input = fixture();
    input.draft.title = '最强笔记本，保证成交';
    const verification = runReleaseVerification(input);
    assert.equal(verification.overall_status, 'blocked');
    assert.equal(verification.publication_ready, false);
    assert.equal(verification.safe_content.ready, false);
    assert.equal(verification.safe_content.content, null);
    assert.equal(verification.items.find(item => item.id === 'overreach').status, 'fail');
    assert.ok(verification.risk_items.some(item => item.risk_level === 'blocking' && item.check_id === 'overreach'));
});

test('downgrades removable price and image issues into a text-only safe version', () => {
    const input = fixture();
    input.draft.body_markdown += '\n\n售价 5999 元，限时优惠。';
    input.image_sources[0].publication_ready = false;
    input.image_sources[0].formal_publication_verified = false;
    const verification = runReleaseVerification(input);
    assert.equal(verification.overall_status, 'downgraded');
    assert.equal(verification.publication_ready, false);
    assert.equal(verification.safe_content.ready, true);
    assert.deepEqual(verification.items.filter(item => item.status === 'downgrade').map(item => item.id).sort(), ['image_identity', 'price']);
    assert.doesNotMatch(verification.safe_content.content.body_markdown, /5999|售价/);
    assert.deepEqual(verification.safe_content.content.image_ids, []);
    assert.doesNotMatch(verification.safe_content.content.body_markdown, /<!-- IMAGE:/);
    assert.ok(verification.risk_items.every(item => item.risk_level === 'downgrade' && item.status === 'mitigated_in_safe_version'));
});
