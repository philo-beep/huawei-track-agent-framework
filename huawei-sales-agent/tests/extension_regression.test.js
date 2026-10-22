'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runProductMatch } = require('../backend/agent/product-match');
const { runContentDraft, DEFAULT_REGISTRY_PATH, PLATFORM_SPECS } = require('../backend/agent/content-generation');
const { assessBudget } = require('../backend/agent/budget-assessment');

const MODELS = [
  { key: 'matebook-14-harmonyos', label: 'HUAWEI MateBook 14 鸿蒙版' },
  { key: 'matebook-14-2024', label: 'HUAWEI MateBook 14 2024（酷睿 Ultra）' },
];
const PLATFORMS = ['公众号', '小红书', '朋友圈'];

function normalInput(overrides = {}) {
  return {
    schema_version: '1.0',
    mode: 'local',
    use_cloud_model: false,
    profile: {
      raw_request: '合成样例：30人制造企业采购负责人需要办公室与仓库轮用的办公笔记本。',
      audience: '制造企业采购负责人',
      scenario: '仓库与办公室轮用',
      industry: '制造业',
      company_size: 30,
      product_type: '电脑',
      needs: ['移动办公', '办公'],
      preferences: ['长续航', '便携'],
      pain_points: ['软件兼容性待确认'],
      excluded_requirements: [],
      budget: null,
      ...overrides,
    },
  };
}

function targetCandidate(match, modelKey) {
  if (modelKey === 'matebook-14-harmonyos') {
    return match.candidates.find(candidate => candidate.evidence.some(item => /鸿蒙版|harmonyos/i.test(`${item.title || ''} ${item.excerpt || ''}`)));
  }
  return match.candidates.find(candidate => /酷睿\s*Ultra|2024/i.test(`${candidate.product_name} ${candidate.evidence?.map(item => item.title).join(' ') || ''}`));
}

async function targets(input) {
  const match = await runProductMatch(input);
  const harmony = targetCandidate(match, 'matebook-14-harmonyos');
  const ultra = targetCandidate(match, 'matebook-14-2024');
  assert.ok(harmony, '真实匹配结果应包含鸿蒙版候选');
  assert.ok(ultra, '真实匹配结果应包含 2024 酷睿 Ultra 候选');
  return { match, harmony, ultra };
}

test('normal input covers the complete 2 models x 3 platforms matrix', async (t) => {
  const input = normalInput();
  const { harmony, ultra } = await targets(input);
  const candidates = { 'matebook-14-harmonyos': harmony, 'matebook-14-2024': ultra };
  for (const model of MODELS) {
    for (const platform of PLATFORMS) {
      await t.test(`${model.label} / ${platform}`, async () => {
        const output = await runContentDraft({ schema_version: '1.0', match_input: input, candidate_id: candidates[model.key].candidate_id, platform });
        assert.equal(output.schema_version, '1.3');
        assert.equal(output.status, 'ready_for_review');
        assert.equal(output.platform, platform);
        assert.equal(output.platform_profile.label, platform);
        assert.equal(output.product.model_key, model.key);
        assert.ok(output.citations.length >= 1);
        assert.equal(output.citations.length, PLATFORM_SPECS[platform].max_facts);
        assert.ok(output.citations.every(citation => model.key === 'matebook-14-harmonyos' ? /鸿蒙版|harmony/i.test(citation.source_title) : /酷睿\s*Ultra|2024/i.test(citation.source_title)));
        assert.equal(output.verification.items.length, 6);
        assert.ok(output.verification.items.every(item => item.status !== 'fail'));
        assert.equal(output.verification.safe_content_ready, true);
        assert.equal(output.verification.publication_ready, false);
        assert.equal(output.budget_assessment.status, 'not_provided');
        assert.match(output.article_markdown, new RegExp(`平台：${platform}`));
        assert.ok(output.draft.body_markdown.length > 40);
        if (model.key === 'matebook-14-harmonyos') {
          assert.ok(output.image_sources.length >= 1);
          assert.ok(output.image_sources.length <= PLATFORM_SPECS[platform].max_image_limit);
          assert.ok(output.image_sources.every(image => image.product === 'HUAWEI MateBook 14（鸿蒙版）'));
        } else {
          assert.equal(output.image_sources.length, 0);
          assert.equal(output.verification.items.find(item => item.id === 'image_identity').status, 'downgrade');
          assert.doesNotMatch(output.draft.body_markdown, /hwpc_matebook-14-harmonyos/);
        }
      });
    }
  }
});

test('missing critical profile fields asks for clarification without inventing a candidate', async () => {
  const input = normalInput({ raw_request: '合成样例：想看看产品。', scenario: null, product_type: null, needs: [], preferences: [], pain_points: [] });
  const result = await runProductMatch(input);
  assert.equal(result.status, 'needs_clarification');
  assert.equal(result.candidates.length, 0);
  assert.ok(result.questions.some(question => /场景|使用|任务/.test(question)));
});

test('budget below the real same-model public snapshot is marked pending, never quoted', async () => {
  const input = normalInput({ budget: { min: 1000, max: 1000, currency: 'CNY', scope: '单台', quantity: 1 } });
  const { harmony, ultra } = await targets(input);
  for (const candidate of [harmony, ultra]) {
    const output = await runContentDraft({ schema_version: '1.0', match_input: input, candidate_id: candidate.candidate_id, platform: '公众号' });
    assert.equal(output.budget_assessment.status, 'potential_conflict_pending_confirmation');
    assert.equal(output.budget_assessment.current_transaction_quote, false);
    assert.ok(output.budget_assessment.reference_price.amount_cents > 100000);
    assert.equal(output.budget_assessment.reference_price.current_transaction_quote, false);
    assert.equal(output.verification.items.find(item => item.id === 'price').status, 'pass');
    assert.doesNotMatch(output.draft.body_markdown, /(?:¥|￥)\s*\d|售价\s*\d|成交价\s*\d/);
  }
});

test('incomplete budget scope is not compared or converted into a price conclusion', () => {
  const assessment = assessBudget(
    { budget: { min: 5000, max: 5000, currency: null, scope: null, quantity: 1 } },
    'HUAWEI MateBook 14 2024',
    { price_records: [] },
  );
  assert.equal(assessment.status, 'not_evaluated');
  assert.equal(assessment.reference_price, null);
  assert.equal(assessment.budget.complete, false);
});

test('budget assessment is testable against an explicit fixture without claiming a transaction quote', () => {
  const assessment = assessBudget(
    { budget: { min: 6000, max: 6000, currency: 'CNY', scope: '单台', quantity: 1 } },
    'HUAWEI MateBook 14 2024',
    { price_records: [{ raw_fields: { '规范产品名称': 'HUAWEI MateBook 14 酷睿 Ultra', '页面金额（元）': '6,799', '价格类型': '官网参考起价', '核验时间': '2026-10-17' }, source_entry: 'real-snapshot-row', status: 'historical_snapshot_requires_reverification', is_current_transaction_quote: false }] },
  );
  assert.equal(assessment.status, 'potential_conflict_pending_confirmation');
  assert.equal(assessment.reference_price.amount_cents, 679900);
  assert.equal(assessment.current_transaction_quote, false);
});

test('missing exact-model images downgrade to text and never substitute the other model', async () => {
  const input = normalInput();
  const { harmony, ultra } = await targets(input);
  const harmonyDraft = await runContentDraft({ schema_version: '1.0', match_input: input, candidate_id: harmony.candidate_id, platform: '小红书' });
  const ultraDraft = await runContentDraft({ schema_version: '1.0', match_input: input, candidate_id: ultra.candidate_id, platform: '小红书' });
  assert.ok(harmonyDraft.image_sources.length > 0);
  assert.ok(harmonyDraft.image_sources.every(image => /鸿蒙版|harmony/i.test(`${image.file_name} ${image.ima_entry}`)));
  assert.equal(ultraDraft.image_sources.length, 0);
  assert.equal(ultraDraft.verification.items.find(item => item.id === 'image_identity').status, 'downgrade');
  assert.ok(ultraDraft.verification.safe_content.content.image_ids.length === 0);
});

test('a deliberately misassigned harmony image is rejected for the 2024 model', async () => {
  const registry = JSON.parse(fs.readFileSync(DEFAULT_REGISTRY_PATH, 'utf8').replace(/^\uFEFF/, ''));
  const harmony = registry.products.find(product => /鸿蒙版/.test(product.product_name));
  assert.ok(harmony && harmony.images.length);
  registry.products.push({
    product_name: 'HUAWEI MateBook 14 酷睿 Ultra',
    aliases: ['MateBook 14 酷睿 Ultra'],
    family: 'MateBook 14',
    category: '消费笔记本',
    operating_system: 'Windows',
    images: [harmony.images[0]],
  });
  const tempPath = path.join(os.tmpdir(), `huawei-image-mismatch-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tempPath, JSON.stringify(registry), 'utf8');
  try {
    const input = normalInput();
    const { ultra } = await targets(input);
    await assert.rejects(
      runContentDraft({ schema_version: '1.0', match_input: input, candidate_id: ultra.candidate_id, platform: '公众号' }, { registryPath: tempPath }),
      error => error.code === 'IMAGE_MODEL_MISMATCH',
    );
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
});

test('platform image limits and unsupported platform boundary are enforced', async () => {
  const input = normalInput();
  const { harmony } = await targets(input);
  const moments = await runContentDraft({ schema_version: '1.0', match_input: input, candidate_id: harmony.candidate_id, platform: '朋友圈', image_limit: 6 });
  assert.equal(moments.platform_profile.image_limit, 3);
  assert.ok(moments.image_sources.length <= 3);
  await assert.rejects(
    runContentDraft({ schema_version: '1.0', match_input: input, candidate_id: harmony.candidate_id, platform: '视频号' }),
    error => error.code === 'INVALID_INPUT',
  );
});

test('coverage matrix covers every model-platform pair and required scenario', () => {
  const matrix = JSON.parse(fs.readFileSync(path.join(__dirname, 'extension_coverage_matrix.json'), 'utf8'));
  assert.equal(matrix.models.length, 2);
  assert.deepEqual(matrix.platforms, PLATFORMS);
  assert.equal(matrix.rows.length, 6);
  const pairs = new Set(matrix.rows.map(row => `${row.model_key}|${row.platform}`));
  assert.equal(pairs.size, 6);
  for (const model of MODELS) for (const platform of PLATFORMS) assert.ok(pairs.has(`${model.key}|${platform}`));
  for (const required of ['正常输入', '信息缺失', '预算冲突', '图片错配', '边界场景']) assert.ok(matrix.scenarios.some(item => item.scenario === required));
});
