'use strict';

// C workspace: capture reviewed, synthetic presentation assets without changing Agent rules.
// This is a preparation command only; the browser never runs these generators.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
global.fetch = async () => { throw new Error('Preset preparation must not access the network'); };
const { runGuidedProfile } = require('../backend/agent/guided-profile');
const { runProductMatch, renderProductMatchMarkdown } = require('../backend/agent/product-match');
const { runContentDraft, renderContentDraftMarkdown, readReviewedImage } = require('../backend/agent/content-generation');
const { runCloud, cloudMarkdown } = require('../backend/agent/cloud-runner');

const definitions = [
  {
    id: 'procurement', label: '企业采购 · 移动办公',
    description: '30 人制造企业采购负责人：风险清单、批量配置与采购审批。',
    audience: '制造企业采购负责人', industry: '制造业', company_size: 30,
    scenario: '仓库与办公室轮用，需要移动办公',
    needs: ['移动办公', '办公'], preferences: ['长续航', '便携'],
    pain_points: ['软件兼容性待确认'], defaultPlatform: '公众号',
    rounds: [
      ['identity', '这位客户负责什么业务，所在企业是什么行业？', '我是制造企业的采购负责人，公司有 30 人。', { identity: '采购负责人', industry: '制造业' }],
      ['usage_scenario', '采购负责人提到要换设备，员工会在哪些地方使用？', '办公笔记本会在仓库与办公室轮用，需要移动办公。', { usage_scenario: '仓库与办公室轮用，需要移动办公' }],
      ['needs', '在仓库和办公室来回使用，客户最看重哪些需求？', '主要做办公文稿，希望便携、长续航；不需要台式机。', { needs: ['办公文稿', '便携'], preferences: ['便携', '长续航'] }],
      ['budget', '这些设备的预算和采购数量确定了吗？', '预算未定，先做 5 台的演示测算，实际数量和审批金额还要确认。', { budget: '预算未定' }],
      ['conversation_habit', '为了方便客户内部沟通，资料用什么方式呈现？', '请用文字给一份风险清单。', { conversation_habit: '文字给一份风险清单' }],
      ['pain_points', '客户现在最担心什么，下一步准备怎么推进？', '担心原有软件兼容性，正在比较，试用通过后再提交采购审批。', { pain_points: ['原有软件兼容性'], purchase_stage: '正在比较' }],
    ],
  },
  {
    id: 'creator', label: '自由职业 · 内容创作',
    description: '个人自由职业创作者：通勤改稿、文件导出与轻松沟通。',
    audience: '个人自由职业创作者', industry: '内容服务', company_size: null,
    scenario: '通勤与咖啡馆改稿，整理文稿并导出文件',
    needs: ['文稿编辑', '文件导出'], preferences: ['屏幕清晰', '便携'],
    pain_points: ['文件格式与软件版本待确认'], defaultPlatform: '小红书',
    rounds: [
      ['identity', '这位客户是什么角色，平时做哪类工作？', '我是个人自由职业创作者，做内容服务，主要写稿。', { identity: '个人自由职业创作者', industry: '内容服务' }],
      ['usage_scenario', '写稿通常在什么地方，电脑会跟着客户外出吗？', '通勤会带电脑，常在咖啡馆改稿，也会回家继续编辑。', { usage_scenario: '通勤、咖啡馆改稿、回家继续编辑' }],
      ['needs', '从外出改稿到交稿，客户最想把哪个任务做好？', '需要文稿编辑、文件导出，偏好屏幕清晰和便携。', { needs: ['文稿编辑', '文件导出'], preferences: ['屏幕清晰', '便携'] }],
      ['budget', '个人购机预算和数量是否已经确定？', '计划自用一台，预算还没定，想先确认任务能不能完成。', { budget: '预算还没定' }],
      ['conversation_habit', '客户希望怎样了解候选设备？', '希望用短段落和清单沟通。', { conversation_habit: '短段落和清单沟通' }],
      ['pain_points', '交稿环节最担心什么，客户目前准备走到哪一步？', '担心文件格式和软件版本，正在比较，先带样稿到店试用，再决定购买。', { pain_points: ['文件格式和软件版本'], purchase_stage: '正在比较' }],
    ],
  },
];

async function build() {
  const scenarios = [];
  const productImages = {};
  for (const definition of definitions) {
    const messages = [];
    const dimensions = [];
    const rounds = [];
    for (const [index, [dimension, question, answer, values]] of definition.rounds.entries()) {
      messages.push({ role: 'assistant', content: question }, { role: 'user', content: answer });
      for (const [key, value] of Object.entries(values)) dimensions.push({ dimension: key, value, status: 'explicit', evidence: answer, reason: '预置合成回答，原话逐字可定位' });
      const next = definition.rounds[index + 1];
      const result = await runGuidedProfile({ schema_version: '1.0', messages }, {
        runner: async () => ({ value: { dimensions, next_question: next ? { dimension: next[0], text: next[1], options: [] } : null }, provider: 'curated-demo', model: null }),
      });
      result.runtime = { called: false, provider: 'preset', model: null, notice: '预置样例回放；未调用云端模型。' };
      delete result.markdown;
      if (index < definition.rounds.length - 1 && result.status === 'complete') throw new Error('Premature profile completion');
      rounds.push({ question: { dimension, text: question, options: [] }, answer, result });
    }
    if (rounds.at(-1).result.status !== 'complete') throw new Error('Incomplete demo profile');
    const input = { schema_version: '1.0', mode: 'local', use_cloud_model: false, profile: {
      raw_request: definition.rounds.map(round => round[2]).join(' '), audience: definition.audience,
      scenario: definition.scenario, industry: definition.industry, company_size: definition.company_size,
      product_type: '电脑', needs: definition.needs, preferences: definition.preferences,
      pain_points: definition.pain_points, excluded_requirements: [], budget: null,
    } };
    const match = await runProductMatch(input);
    const candidate = match.candidates.find(item => item.product_name === 'HUAWEI MateBook 14');
    if (!candidate) throw new Error('Expected an exact-model candidate');
    const contents = {};
    for (const [platform, count] of [['公众号', 4], ['小红书', 3], ['朋友圈', 1]]) {
      const result = await runContentDraft({ schema_version: '1.0', match_input: input, candidate_id: candidate.candidate_id, platform, image_limit: count });
      if (result.status === 'blocked') throw new Error('Preset content is blocked');
      result.demo_only = true;
      for (const image of result.image_sources) {
        const asset = readReviewedImage(image.sha256);
        const bytes = fs.readFileSync(asset.filePath);
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== image.sha256) throw new Error('Original product image hash mismatch');
        productImages[image.sha256] = { mime_type: image.mime_type, data_url: `data:${image.mime_type};base64,${bytes.toString('base64')}` };
      }
      // Store each original once; keep its source, model and pending publication rights.
      const localize = value => typeof value === 'string' ? value.replace(/\/api\/content-images\/([a-f0-9]{64})/g, 'demo-product:$1') : Array.isArray(value) ? value.map(localize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localize(item)])) : value;
      const captured = localize(result);
      const markdown = `> 离线预置演示；资料与检查为录制时快照。配图为对应型号产品原图，公开发布授权待确认。\n\n${renderContentDraftMarkdown(captured)}`;
      contents[platform] = { result: captured, markdown };
    }
    const marketingInput = { product: 'HUAWEI MateBook 14 鸿蒙版', platform: definition.defaultPlatform, audience: definition.audience, scenario: definition.scenario, raw_request: input.profile.raw_request };
    const sales = await runCloud({ marketing_input: marketingInput, demo_pricing: definition.id === 'procurement', use_cloud_model: false, use_ima: false, use_web_research: false });
    const savedCopy = contents[definition.defaultPlatform].result.verification.safe_content.content;
    sales.content.marketing_content = { title: savedCopy.title, lead: savedCopy.lead, body: savedCopy.body_markdown, cta: savedCopy.cta };
    sales.content.narrative_status = 'preset_from_content_step';
    sales.demo_snapshot_sources = { profile: 'six_round_curated_interview', content: `contents.${definition.defaultPlatform}.verification.safe_content`, sales: 'local_rules_capture' };
    for (const key of ['identity', 'industry', 'needs', 'budget', 'preferences', 'pain_points', 'purchase_stage']) sales.customer_analysis.profile[key] = rounds.at(-1).result.fields[key];
    sales.runtime_engine = { mode: 'preset', model_status: 'disabled', ima_enabled: false, web_research_enabled: false };
    const salesMarkdown = '> 离线预置演示；非当前报价，未执行现场演示。\n\n' + cloudMarkdown(sales);
    scenarios.push({ id: definition.id, label: definition.label, description: definition.description, defaultPlatform: definition.defaultPlatform, rounds,
      match: { input, result: match, markdown: '> 离线预置演示；资料为录制时快照。\n\n' + renderProductMatchMarkdown(match) },
      candidateId: candidate.candidate_id, contents, sales: { input: marketingInput, result: sales, markdown: salesMarkdown } });
  }
  const payload = { version: '1', recorded_at: new Date().toISOString(), synthetic: true, model_called: false,
    notice: '随页面打包的预置结果。客户均为合成样例，故事为设想场景；产品资料和发布检查为录制时快照，配图为对应型号产品原图，公开发布授权待确认。', product_images: productImages, scenarios };
  payload.fingerprint = crypto.createHash('sha256').update(JSON.stringify({ scenarios, productImages })).digest('hex');
  const htmlPath = path.join(__dirname, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const block = `<script type="application/json" id="demo-presets">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>`;
  fs.writeFileSync(htmlPath, html.includes('id="demo-presets"') ? html.replace(/<script type="application\/json" id="demo-presets">[\s\S]*?<\/script>/, () => block) : html.replace('</body>', `  ${block}\n</body>`));
  process.stdout.write(`Captured ${scenarios.length} scenarios, ${scenarios.reduce((sum, scenario) => sum + scenario.rounds.length, 0)} rounds, six platform drafts; ${Buffer.byteLength(block)} bytes. Network calls: 0.\n`);
}
if (require.main === module) build().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
module.exports = { definitions };
