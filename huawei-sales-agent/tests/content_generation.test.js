'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { runProductMatch, productMatchExamples } = require('../backend/agent/product-match');
const { runContentDraft, readReviewedImage } = require('../backend/agent/content-generation');

async function matchExample(index) {
    const input = productMatchExamples()[index].input;
    input.mode = 'local';
    input.use_cloud_model = false;
    const result = await runProductMatch(input);
    return { input, result };
}

test('generates a reviewable public-account draft with exact-model IMA images', async () => {
    const { input, result } = await matchExample(0);
    const candidate = result.candidates[0];
    const output = await runContentDraft({ schema_version: '1.0', match_input: input, candidate_id: candidate.candidate_id, platform: '公众号', image_limit: 4 });
    assert.equal(output.schema_version, '1.2');
    assert.equal(output.status, 'ready_for_review');
    assert.equal(output.product.resolved_name, 'HUAWEI MateBook 14（鸿蒙版）');
    assert.match(output.draft.title, /仓库与办公室轮用/);
    assert.equal(output.image_sources.length, 4);
    assert.deepEqual(output.image_sources.map(image => image.marker), ['after_title', 'after_requirements', 'after_facts', 'before_cta']);
    assert.ok(output.image_sources.every(image => image.product === 'HUAWEI MateBook 14（鸿蒙版）'));
    assert.ok(output.image_sources.every(image => image.ima_kb_id && image.ima_search_request_ids.length >= 2));
    assert.ok(output.image_sources.every(image => image.model_match_status === 'exact_product_match_verified'));
    assert.ok(output.image_sources.every(image => image.publication_ready === false));
    assert.ok(output.image_sources.every(image => output.draft.body_markdown.includes(`<!-- IMAGE:${image.marker} -->`)));
    assert.ok(output.citations.length >= 1);
    assert.ok(output.citations.every(citation => citation.source_entry && citation.source_sha256));
    assert.equal(output.verification.overall_status, 'downgraded');
    assert.equal(output.verification.publication_ready, false);
    assert.equal(output.verification.safe_content_ready, true);
    assert.deepEqual(output.verification.items.map(item => item.id), ['product_model', 'parameters', 'price', 'image_identity', 'overreach', 'source_completeness']);
    assert.deepEqual(output.verification.items.map(item => item.status), ['pass', 'pass', 'pass', 'downgrade', 'pass', 'pass']);
    assert.equal(output.verification.risk_items[0].risk_level, 'downgrade');
    assert.match(output.verification.risk_items[0].recommendation, /移除/);
    assert.deepEqual(output.verification.safe_content.content.image_ids, []);
    assert.doesNotMatch(output.verification.safe_content.content.body_markdown, /<!-- IMAGE:/);
    assert.doesNotMatch(output.verification.safe_content.rendered_markdown, /<!-- IMAGE:/);
    assert.match(output.article_markdown, /强制核验结果/);
    assert.match(output.article_markdown, /风险项清单/);
    assert.match(output.article_markdown, /可发布安全版本/);
    assert.match(output.article_markdown, /图片来源清单/);
    assert.match(output.article_markdown, /事实来源索引/);
});

test('does not substitute generic or another-model images and blocks missing exact evidence', async () => {
    const { input, result } = await matchExample(1);
    const output = await runContentDraft({ schema_version: '1.0', match_input: input, candidate_id: result.candidates[0].candidate_id, platform: '公众号' });
    assert.equal(output.status, 'blocked');
    assert.equal(output.image_sources.length, 0);
    assert.equal(output.verification.overall_status, 'blocked');
    assert.equal(output.verification.items.find(item => item.id === 'image_identity').status, 'downgrade');
    assert.equal(output.verification.items.find(item => item.id === 'product_model').status, 'fail');
    assert.equal(output.verification.safe_content.ready, false);
});

test('rejects a candidate id that is not regenerated from the same match input', async () => {
    const { input } = await matchExample(0);
    await assert.rejects(
        runContentDraft({ schema_version: '1.0', match_input: input, candidate_id: 'candidate-000000000000', platform: '公众号' }),
        error => error.code === 'MATCH_CANDIDATE_NOT_FOUND',
    );
});

test('serves only images whose bytes match the reviewed registry hash', async () => {
    const sha = '9f9470747d7e3c406b87c31ecd5d51f1f3542626001ed8b00b04c5db8973de82';
    const asset = readReviewedImage(sha);
    assert.equal(asset.mimeType, 'image/png');
    const actual = crypto.createHash('sha256').update(fs.readFileSync(asset.filePath)).digest('hex');
    assert.equal(actual, sha);
    assert.throws(() => readReviewedImage('0'.repeat(64)), error => error.code === 'IMAGE_NOT_FOUND');
});

test('generated narrative avoids unsupported sales or conversion promises', async () => {
    const { input, result } = await matchExample(0);
    const output = await runContentDraft({ schema_version: '1.0', match_input: input, candidate_id: result.candidates[0].candidate_id, platform: '公众号' });
    assert.doesNotMatch(`${output.draft.title}\n${output.draft.lead}\n${output.draft.cta}`, /保证成交|保证转化|全网最低|官方已确认|华为正式政策/);
    assert.equal(output.verification.items.find(item => item.id === 'overreach').status, 'pass');
    assert.equal(output.verification.compliance, 'downgraded');
});
