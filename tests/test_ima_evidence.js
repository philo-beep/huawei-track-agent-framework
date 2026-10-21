'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const { browseKnowledgeBase, extractSection, inferExtension, mediaTypeInfo, parsePriceRows, factsFromDocument } = require('../backend/agent/ima-evidence');
const { validateSchema } = require('../backend/agent/support');

const PRODUCT = 'HUAWEI MateBook 14（鸿蒙版）';
const HASH = 'a'.repeat(64);
function document(title, text) {
    return {
        title, text, media_id: `media-${title}`, parent_folder_id: 'folder-parent', media_type: 7,
        knowledge_base_id: 'kb-test', retrieved_at: '2026-10-21T00:00:00.000Z', sha256: HASH,
        request_ids: ['req-test'], body_path: 'sources/doc.md', text_path: 'sources/text/doc.txt',
        url_host: 'example.invalid', url_sha256: HASH, body_status: 'text_extracted',
    };
}

test('maps official IMA media types and filenames', () => {
    assert.equal(mediaTypeInfo(7).name, 'markdown');
    assert.equal(inferExtension(7, 'text/markdown; charset=utf-8', 'facts.json'), '.md');
    assert.equal(inferExtension(9, 'image/jpeg', 'candidate'), '.jpg');
});

test('extracts a named markdown section without crossing the next heading', () => {
    const text = '## 官网公开定位摘要\n2.8K OLED\n\n## 建库状态\n仅作发现卡';
    assert.equal(extractSection(text, ['官网公开定位摘要']), '2.8K OLED');
});

test('browses nested folders with pagination and explicit limits', async () => {
    const calls = [];
    const client = {
        async getKnowledgeList({ folderId, cursor }) {
            calls.push({ folderId, cursor });
            if (!folderId) return { knowledge_list: [{ media_id: 'folder-root', title: 'Root', media_type: 99, parent_folder_id: null }], current_path: [], is_end: true, next_cursor: null, request_ids: ['r1'] };
            if (!cursor) return { knowledge_list: [{ media_id: 'media-1', title: 'Doc', media_type: 7, parent_folder_id: folderId }], current_path: [], is_end: false, next_cursor: 'next', request_ids: ['r2'] };
            return { knowledge_list: [{ media_id: 'media-2', title: 'Doc 2', media_type: 7, parent_folder_id: folderId }], current_path: [], is_end: true, next_cursor: null, request_ids: ['r3'] };
        },
    };
    const result = await browseKnowledgeBase({ knowledgeBaseId: 'kb', client });
    assert.equal(result.counts.entries, 3);
    assert.equal(result.counts.folders, 1);
    assert.deepEqual(result.request_ids, ['r1', 'r2', 'r3']);
    assert.deepEqual(calls.map(call => call.folderId), ['', 'folder-root', 'folder-root']);
});

test('parses price table snapshots without upgrading them to current quotes', () => {
    const text = [
        '| 核验时间 | 精确款式 | 价格类型 | 页面金额 | 参考/划线金额 | 库存或销售状态 | 条件摘要 | 来源 |',
        '|---|---|---|---:|---:|---|---|---|',
        '| 2026-10-17T14:40:00-05:00 | 16GB/512GB/圆键盘/原野绿/麒麟X90 | 官方商城页面价 | ¥5,899 | ¥5,999 | 可购买 | 直降100元 | [官方页](https://item.vmall.com/product/comdetail/index.html?prdId=1) |',
    ].join('\n');
    const rows = parsePriceRows(document('HUAWEI MateBook 14（鸿蒙版）-价格卡.md', text), PRODUCT);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].observed_price_cents, 589900);
    assert.equal(rows[0].price_kind, 'promotion_price');
    assert.equal(rows[0].verification, 'unverified');
    assert.equal(rows[0].tax_included, false);
});

test('generated evidence validates against the additive EvidenceBundle contract', () => {
    const sourceDoc = document('02-HUAWEI MateBook 14（鸿蒙版）.md', '## 官网公开定位摘要\n2.8K OLED 云晰柔光屏、鸿蒙 AI\n\n## 建库状态\n发现卡');
    const facts = factsFromDocument(sourceDoc, PRODUCT);
    const sources = facts.map(fact => fact.source);
    const bundle = {
        schema_version: '1.0',
        bundle_id: 'ima-bundle-test',
        generated_at: '2026-10-21T00:00:00.000Z',
        query: { product: PRODUCT, sku: null, purpose: 'mixed', as_of: '2026-10-21' },
        facts,
        images: [{
            image_id: 'image-ima-test', product: PRODUCT, caption: '候选图', usage_scope: 'internal_only',
            rights_status: 'unknown', source: sources[0], applicable_models: [PRODUCT], model_verified: false,
            content_sha256: HASH, data_path: 'datasets/raw/assets/test.jpg',
        }],
        pricing_refs: [],
        conflicts: [],
        coverage: { facts: facts.length, images: 1, prices: 0, gaps: ['候选图未核验'] },
        extensions: { ima: { skill_version: '1.1.10' } },
    };
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'backend', 'agent', 'contracts', 'evidence-bundle.schema.json'), 'utf8'));
    assert.equal(validateSchema(bundle, schema), true);
    assert.equal(bundle.facts[0].source.source_type, 'ima');
    assert.deepEqual(bundle.facts[0].source.applicable_models, [PRODUCT]);
});

test('extracts UTF-8 markdown through the auditable Python helper', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ima-extract-'));
    const file = path.join(dir, 'sample.md');
    fs.writeFileSync(file, '# 标题\n\n正文事实', 'utf8');
    const result = spawnSync('python', [path.join(__dirname, '..', 'backend', 'agent', 'ima_extract.py'), file, '--mime-type', 'text/markdown'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.status, 'ok');
    assert.match(parsed.extractor, /^text\/utf-8/);
    assert.match(parsed.text, /正文事实/);
});



