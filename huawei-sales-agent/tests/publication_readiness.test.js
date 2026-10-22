'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runProductMatch, productMatchExamples } = require('../backend/agent/product-match');
const { runContentDraft } = require('../backend/agent/content-generation');
const { markdownToPlainText, imageDimensions, buildPublicationReadiness } = require('../backend/agent/publication-readiness');
const { storedZip } = require('../backend/agent/image-pack');

async function outputFor(platform) {
  const input = productMatchExamples()[0].input;
  input.mode = 'local';
  input.use_cloud_model = false;
  const match = await runProductMatch(input);
  return runContentDraft({
    schema_version: '1.0',
    match_input: input,
    candidate_id: match.candidates[0].candidate_id,
    platform,
    image_limit: platform === '朋友圈' ? 1 : 3,
  });
}

test('纯文本分块去掉 Markdown 和图片标记，可直接粘贴', () => {
  const text = markdownToPlainText('# 标题\n\n**正文**\n\n- 第一项\n\n<!-- IMAGE:after_title -->\n\n![图](/api/content-images/abc)');
  assert.equal(text, '标题\n\n正文\n\n• 第一项');
});

test('读取 PNG 实际像素，供平台尺寸检查使用', () => {
  const file = path.resolve(__dirname, '../../huawei-sales-agent-data/datasets/raw/assets/9f9470747d7e3c406b87c31ecd5d51f1f3542626001ed8b00b04c5db8973de82.png');
  assert.deepEqual(imageDimensions(fs.readFileSync(file)), { width: 817, height: 892 });
});

test('三平台同时返回标题、正文、标签和各自发布检查', async () => {
  const output = await outputFor('小红书');
  assert.equal(output.publication_readiness.platform_matrix.length, 3);
  for (const item of output.publication_readiness.platform_matrix) {
    assert.deepEqual(item.copy_blocks.map(block => block.id), ['title', 'body', 'tags']);
    assert.ok(item.copy_blocks.every(block => !/#{1,6}\s|<!--|\*\*|!\[/.test(block.text)));
    assert.equal(item.checks.items.length, 5);
    assert.ok(Number.isInteger(item.summary.pass_count));
  }
  assert.equal(output.publication_readiness.platform_matrix.find(item => item.platform === '小红书').selected, true);
  assert.equal(output.publication_readiness.image_pack.status, 'review_only_rights_pending');
});

test('标签按个数检查而不是按字符长度检查', () => {
  const readiness = buildPublicationReadiness({
    platform: '朋友圈',
    title: '内部短标题',
    body: '先把每天的任务、常用软件和文件格式说清楚，再核对公开资料。'.repeat(4),
    tags: ['华为笔记本', '移动办公'],
    images: [],
    strategy: { task: { id: 'mobility', label: '移动办公与轮换使用' }, audience: { label: '门店运营' } },
    product: { product_name: 'HUAWEI MateBook 14（鸿蒙版）' },
  });
  assert.equal(readiness.copy_blocks.find(block => block.id === 'tags').status, 'pass');
  assert.equal(readiness.copy_blocks.find(block => block.id === 'tags').counter, '2/3 个');
});

test('生成的审稿图片包是有效 ZIP 结构', () => {
  const zip = storedZip([
    { name: 'README.txt', data: '仅供内部审稿' },
    { name: 'images/01-cover.png', data: Buffer.from([1, 2, 3, 4]) },
  ]);
  assert.equal(zip.subarray(0, 2).toString('ascii'), 'PK');
  assert.ok(zip.includes(Buffer.from('README.txt')));
  assert.ok(zip.includes(Buffer.from('images/01-cover.png')));
});