'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ROOT, PipelineError, validateSchema } = require('./support');
const { runProductMatch } = require('./product-match');
const { localKnowledge, extractFacts } = require('./knowledge');

const DATA_ROOT = path.resolve(ROOT, '..', 'huawei-sales-agent-data');
const DEFAULT_REGISTRY_PATH = path.join(DATA_ROOT, 'datasets', 'cleaned', 'image_review_registry.json');
const INPUT_SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'contracts', 'content-generation-input.schema.json'), 'utf8'));
const OUTPUT_SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'contracts', 'content-generation-output.schema.json'), 'utf8'));
const FORBIDDEN = /最强|最好|第一|顶级|唯一|必买|保证成交|保证转化|全网最低|百分之百|零风险|永久|补贴|优惠|折扣|立减|到手价|售价|成交率|亲测|实测|吊打|碾压/;
const MARKER_ORDER = ['after_title', 'after_requirements', 'after_facts', 'before_cta'];
const POSITION_LABELS = { cover: '封面主视觉', scene: '使用场景', detail: '机身细节', before_cta: '行动引导前配图' };

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/huawei/g, '').replace(/鸿蒙版|harmonyos/g, '').replace(/[\s\-_/（）()·]/g, '');
}

function strictName(value) {
  return String(value || '').toLowerCase().replace(/[\s\-_/（）()·]/g, '');
}

function readRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  try {
    if (!fs.existsSync(registryPath) || fs.lstatSync(registryPath).isSymbolicLink()) throw new Error('missing');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8').replace(/^\uFEFF/, ''));
    if (!registry || !Array.isArray(registry.products) || !registry.knowledge_base?.kb_name) throw new Error('invalid');
    return registry;
  } catch {
    throw new PipelineError('IMAGE_REVIEW_REGISTRY_UNAVAILABLE', 'IMA 图片核验清单不可用；未使用未核验候选图');
  }
}

function resolveReviewedProduct(registry, candidate) {
  const candidates = (registry.products || []).filter(product => {
    const names = [product.product_name, ...(product.aliases || [])].filter(Boolean);
    if (names.some(name => normalizeName(name) === normalizeName(candidate.product_name))) return true;
    const targetBase = normalizeName(candidate.product_name);
    return names.some(name => normalizeName(name) === targetBase)
      && (!candidate.operating_system || !product.operating_system || String(candidate.operating_system).toLowerCase() === String(product.operating_system).toLowerCase());
  });
  const evidence = candidate.evidence || [];
  const withExactEvidence = candidates.filter(product => evidence.some(item => item.source_level === 'E1' && strictName(`${item.title} ${item.locator}`).includes(strictName(product.product_name))));
  if (!withExactEvidence.length) throw new PipelineError('IMAGE_MODEL_UNRESOLVED', '当前候选缺少能定位到同一具体型号的 E1 证据，未匹配任何图片');
  return withExactEvidence[0];
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function verifiedImages(registry, product, limit) {
  const available = (product.images || []).filter(image => image.model_verified === true && image.formal_publication_verified !== true && String(image.source_status || '').startsWith('http_200'));
  const selected = available.sort((first, second) => MARKER_ORDER.indexOf(first.marker) - MARKER_ORDER.indexOf(second.marker)).slice(0, limit);
  if (!selected.length) throw new PipelineError('IMAGE_SET_UNAVAILABLE', '该具体型号没有通过型号匹配与来源核验的 IMA 图片；未使用其他型号替代');
  return selected.map(image => {
    const assetPath = path.resolve(DATA_ROOT, image.local_path);
    if (!assetPath.startsWith(DATA_ROOT + path.sep) || !fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile() || fs.lstatSync(assetPath).isSymbolicLink()) throw new PipelineError('IMAGE_ASSET_UNAVAILABLE', `图片文件不可用：${image.image_id}`);
    if (!/^[a-f0-9]{64}$/.test(image.sha256 || '') || fileSha256(assetPath) !== image.sha256) throw new PipelineError('IMAGE_HASH_MISMATCH', `图片指纹不匹配：${image.image_id}`);
    if (!image.original_url || !image.ima_entry || !image.caption) throw new PipelineError('IMAGE_SOURCE_INCOMPLETE', `图片来源信息不完整：${image.image_id}`);
    return { ...image, assetPath };
  });
}

function factScore(fact, profile) {
  const text = fact.claim || '';
  const needs = [...(profile.needs || []), ...(profile.preferences || []), ...(profile.pain_points || []), profile.scenario || ''].join(' ');
  let score = 0;
  if (/尺寸|重量|厚度/.test(text) && /移动|便携|轮用|外出|通勤/.test(needs)) score += 8;
  if (/电池|Wh/.test(text) && /续航|移动|外出|轮用/.test(needs)) score += 8;
  if (/操作系统|HarmonyOS|Windows/.test(text) && /软件|兼容|系统/.test(needs)) score += 7;
  if (/屏幕|OLED|分辨率/.test(text) && /屏幕|设计|影像|大屏/.test(needs)) score += 5;
  if (/处理器|CPU/.test(text) && /性能|设计|开发/.test(needs)) score += 4;
  if (/接口|USB|HDMI/.test(text) && /接口|外设|扩展|演示/.test(needs)) score += 4;
  if (/键盘|触控板/.test(text) && /输入|文档|办公/.test(needs)) score += 2;
  return score;
}

function selectFacts(knowledge, productName, profile) {
  const all = extractFacts(knowledge, productName, { maxFacts: 12 });
  const valid = all.filter(fact => fact.source_refs?.length && fact.source_refs.every(source => String(source.excerpt || '').includes(fact.claim)));
  const ranked = valid.map((fact, index) => ({ fact, index, score: factScore(fact, profile) })).sort((first, second) => second.score - first.score || first.index - second.index);
  const selected = ranked.slice(0, 3).map(item => item.fact);
  if (!selected.length) throw new PipelineError('EVIDENCE_FACTS_UNAVAILABLE', '没有可逐字定位的产品原文，未生成事实段');
  return selected;
}

function sourceForFact(fact) {
  const source = fact.source_refs[0];
  return {
    source_title: source.title,
    source_url: source.urls?.[0] || null,
    source_entry: source.entry,
    source_sha256: source.entry_sha256 || null,
  };
}

function imageCallout(image, index, instruction) {
  return [
    `<!-- IMAGE:${image.marker} -->`,
    `> **配图 ${index + 1}｜${POSITION_LABELS[image.position] || '配图'}**`,
    `> 插入位置：${instruction}`,
    `> 图片：${image.file_name}`,
    `> 说明：${image.caption}`,
    `> 来源：IMA 知识库“${image.ima_kb_name}”｜${image.ima_entry}`,
    '> 状态：具体型号匹配已核验；公开发布授权与人工终审仍待确认。',
  ].join('\n');
}

function inlineText(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]<>#|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function listText(values, fallback = '未提供') {
  return Array.isArray(values) && values.length ? values.map(inlineText).filter(Boolean).join('、') : fallback;
}

function composeDraft(profile, product, facts, images) {
  const audience = inlineText(profile.audience) || '客户';
  const scenario = inlineText(profile.scenario) || '本次办公任务';
  const shortScenario = String(scenario).split(/[，,。；;]/)[0].replace(/需要移动办公$/, '').slice(0, 32) || '本次办公任务';
  const needs = listText(profile.needs);
  const preferences = listText(profile.preferences);
  const painPoints = listText(profile.pain_points);
  const title = `${shortScenario}的笔记本，先核对 ${facts.length} 项公开资料`;
  const lead = `这次需求来自${audience}：${scenario}。不先比谁的宣传语更响，而是把实际任务、软件与文件条件、可追溯资料放在同一张清单里。`;
  const cover = images.find(image => image.marker === 'after_title');
  const scene = images.find(image => image.marker === 'after_requirements');
  const detail = images.find(image => image.marker === 'after_facts');
  const beforeCta = images.find(image => image.marker === 'before_cta');
  const blocks = [];
  if (cover) blocks.push(imageCallout(cover, images.indexOf(cover), '主标题与导语之后，作为封面或正文首图'));
  blocks.push('## 先把实际任务说清楚');
  blocks.push(`这篇准备稿面向${audience}，场景是“${scenario}”。先确认每天究竟要打开、编辑、保存和导出哪些文件，再讨论型号。`);
  const organization = [profile.industry, Number.isInteger(profile.company_size) ? `${profile.company_size}人组织` : null].filter(Boolean).join('、');
  blocks.push(`- 客户背景：${organization || '行业与组织规模待确认'}（仅来自客户输入，不代表采购权限）`);
  blocks.push(`- 明确需求：${needs}`);
  blocks.push(`- 当前偏好：${preferences}`);
  blocks.push(`- 待确认问题：${painPoints}`);
  blocks.push('- 预算：客户未提供时保持未知；客户提供的预算也不能直接当成产品报价。');
  if (scene) blocks.push(imageCallout(scene, images.indexOf(scene), '“先把实际任务说清楚”一节之后'));
  blocks.push(`## 候选机型：${product.product_name}`);
  blocks.push('以下只放可逐字回溯到 IMA 产品事实原文的公开资料。它们用于核对，不等同于实际体验、软件兼容结论或完整销售 SKU。');
  for (const fact of facts) {
    const heading = String(fact.claim).split('\n').find(line => line.startsWith('## '))?.replace(/^##\s+/, '') || '公开资料';
    const citation = sourceForFact(fact);
    blocks.push(`### 官网原文｜${heading}`);
    blocks.push(fact.claim);
    blocks.push(`来源定位：${citation.source_title}｜${citation.source_entry}｜${fact.id}`);
  }
  if (detail) blocks.push(imageCallout(detail, images.indexOf(detail), '官网原文核对段之后'));
  blocks.push('## 这些事项还不能直接下结论');
  blocks.push('- 软件兼容性：必须按客户实际软件名称、版本、文件格式和外设逐项验证；资料存在不等于兼容已通过。');
  blocks.push('- 完整 SKU 与配色：当前资料是系列或具体型号级线索，颜色、键盘版本和销售配置仍需确认。');
  blocks.push('- 价格与库存：没有完整 SKU、地区、数量、有效期和有效报价依据时，不输出成交金额。');
  blocks.push('- 图片授权：以下图片已做型号与画面辅助核验，但正式公开发布前仍需人工终审和授权确认。');
  if (beforeCta) blocks.push(imageCallout(beforeCta, images.indexOf(beforeCta), '行动引导（CTA）之前'));
  const body = blocks.join('\n\n');
  const cta = '把常用软件及版本、主要文件格式、外设和移动频次发来；我们会先核对是否具备演示条件，再由人工确认下一步，不先承诺兼容或报价。';
  const narrative = [title, lead, body, cta].join('\n');
  const unsupported = narrative.match(FORBIDDEN);
  if (unsupported) throw new PipelineError('CONTENT_COMPLIANCE_FAILED', `准备稿出现无依据宣传或价格词“${unsupported[0]}”，已阻塞`);
  return { title, lead, body_markdown: body, cta, tags: ['华为笔记本', '移动办公', '选型核对', '软件兼容性'] };
}

function renderArticleMarkdown(result) {
  const imageRows = result.image_sources.map((image, index) => `| ${index + 1} | ${image.file_name} | ${image.caption} | ${image.original_url} | ${image.model_match_status}；${image.rights_status} |`);
  const citationRows = result.citations.map(item => `- ${item.fact_id}｜${item.source_title}｜${item.source_entry}${item.source_url ? `｜${item.source_url}` : ''}`);
  return [
    `# ${result.draft.title}`, '',
    result.draft.lead, '',
    result.draft.body_markdown, '',
    '## 下一步沟通', '',
    result.draft.cta, '',
    '---', '',
    '## 图片来源清单', '',
    '> 型号匹配与原始来源已核对；公开发布授权和人工终审仍待确认，因此本稿状态为“可审稿”，不是已获准发布版本。', '',
    `> IMA 知识库：${result.image_sources[0].ima_kb_name}｜知识库 ID：${result.image_sources[0].ima_kb_id}｜检索请求 ID：${result.image_sources[0].ima_search_request_ids.join('、')}`, '',

    '| # | 文件 | 说明 | 原图来源 | 状态 |',
    '| --- | --- | --- | --- | --- |',
    ...imageRows, '',
    '## 事实来源索引', '',
    ...citationRows, '',
    '## 审稿边界', '',
    '- 产品事实仅来自上列可定位原文，未把检索摘要或模型常识补成产品参数。',
    '- 客户画像只用于匹配任务与沟通角度，不推断预算、身份或采购权限。',
    '- 未生成正式报价，未承诺软件兼容、咨询量或成交转化。',
    `- 核验时间：${result.generated_at}；发布前须完成人工审稿与图片授权。`, '',
  ].join('\n');
}

function safeProfile(profile) {
  const integerOrNull = value => Number.isInteger(value) ? value : null;
  const array = value => Array.isArray(value) ? value.map(inlineText).filter(Boolean) : [];
  return {
    audience: profile.audience ? inlineText(profile.audience) : null,
    scenario: profile.scenario ? inlineText(profile.scenario) : null,
    industry: profile.industry ? inlineText(profile.industry) : null,
    company_size: integerOrNull(profile.company_size),
    needs: array(profile.needs),
    preferences: array(profile.preferences),
    pain_points: array(profile.pain_points),
    budget_status: profile.budget ? '客户已提供预算条件，但预算不是产品报价，仍需完整SKU与有效报价依据' : '客户未提供预算；不推断价格或采购资格',
  };
}

async function runContentDraft(input, options = {}) {
  validateSchema(input, INPUT_SCHEMA);
  if (!/^candidate-[a-f0-9]{12}$/.test(input.candidate_id)) throw new PipelineError('INVALID_INPUT', '候选ID格式无效');
  const registry = readRegistry(options.registryPath || DEFAULT_REGISTRY_PATH);
  const matchRunner = options.matchRunner || runProductMatch;
  const matchResult = await matchRunner(input.match_input);
  const candidate = (matchResult.candidates || []).find(item => item.candidate_id === input.candidate_id);
  if (!candidate) throw new PipelineError('MATCH_CANDIDATE_NOT_FOUND', '所选候选不在本次重新核验的产品匹配结果中');
  const resolved = resolveReviewedProduct(registry, candidate);
  const knowledge = await localKnowledge(candidate.product_name);
  const facts = selectFacts(knowledge, candidate.product_name, input.match_input.profile);
  const limit = input.image_limit || 4;
  const images = verifiedImages(registry, resolved, limit).map(image => ({ ...image, ima_kb_name: registry.knowledge_base.kb_name }));
  const draft = composeDraft(input.match_input.profile, resolved, facts, images);
  const profileBasis = safeProfile(input.match_input.profile);
  const citations = facts.map(fact => ({
    fact_id: fact.id,
    claim: fact.claim,
    used_in: 'body',
    ...sourceForFact(fact),
  }));
  const imageSources = images.map(image => ({
    image_id: image.image_id,
    product: resolved.product_name,
    file_name: image.file_name,
    caption: image.caption,
    position: image.position,
    marker: image.marker,
    asset_url: `/api/content-images/${image.sha256}`,
    original_url: image.original_url,
    page_url: image.page_url || null,
    source_name: `IMA 知识库“${registry.knowledge_base.kb_name}”镜像条目｜华为公开产品素材`,
    ima_entry: image.ima_entry,
    ima_kb_name: registry.knowledge_base.kb_name,
    ima_kb_id: registry.knowledge_base.kb_id,
    ima_search_request_ids: registry.knowledge_base.live_search_request_ids || [],
    sha256: image.sha256,
    mime_type: image.mime_type,
    model_match_status: 'exact_product_match_verified',
    visual_review_status: image.visual_review_status,
    rights_status: image.rights_status,
    publication_ready: false,
  }));
  const insertionPlan = images.map(image => ({
    after_marker: image.marker,
    position: image.position,
    image_id: image.image_id,
    caption: image.caption,
    instruction: image.marker === 'after_title' ? '标题和导语之后'
      : image.marker === 'after_requirements' ? '“先把实际任务说清楚”之后'
        : image.marker === 'after_facts' ? '官网原文核对段之后'
          : '行动引导之前',
  }));
  const result = {
    schema_version: '1.0',
    status: 'ready_for_review',
    synthetic: /合成样例|合成测试|虚构客户/.test(String(input.match_input.profile.raw_request || '')),
    generated_at: new Date().toISOString(),
    platform: '公众号',
    product: {
      candidate_id: candidate.candidate_id,
      requested_name: candidate.product_name,
      resolved_name: resolved.product_name,
      family: resolved.family || null,
      category: resolved.category || null,
      operating_system: resolved.operating_system || null,
      model_verified: true,
    },
    profile_basis: profileBasis,
    draft,
    image_sources: imageSources,
    insertion_plan: insertionPlan,
    citations,
    verification: {
      product_model_match: 'verified',
      evidence_traceable: true,
      image_count: imageSources.length,
      compliance: 'pass',
      publication_ready: false,
      pending: [
        '图片公开发布授权尚未确认，当前只能作为内部审稿配图建议',
        '视觉核验为 AI 辅助，正式发布前须由责任人终审',
        '软件兼容性、完整销售SKU与当前成交报价仍需客户及官方资料确认',
      ],
    },
    article_markdown: '',
    diagnostics: [
      { code: 'CONTENT_DRAFT_READY_FOR_REVIEW', message: '图文草稿、图片来源清单和插入位置已生成；未自动发布，也不代表咨询或转化效果已验证。' },
      { code: 'IMA_IMAGE_SET_SELECTED', message: JSON.stringify({ knowledge_base: registry.knowledge_base.kb_name, product: resolved.product_name, image_count: imageSources.length, markers: imageSources.map(image => image.marker) }) },
      { code: 'IMAGE_RIGHTS_PENDING', message: '图片原始URL可访问且型号匹配，但公开传播授权未确认，publication_ready=false。' },
      { code: 'HUMAN_REVIEW_REQUIRED', message: '发布前需人工核对画面、型号、配色、SKU、版权、页面归属及文中限制。' },
    ],
  };
  result.article_markdown = renderArticleMarkdown(result);
  validateSchema(result, OUTPUT_SCHEMA);
  return result;
}

function readReviewedImage(sha256, registryPath = DEFAULT_REGISTRY_PATH) {
  if (!/^[a-f0-9]{64}$/.test(String(sha256 || ''))) throw new PipelineError('IMAGE_NOT_FOUND', '图片不存在');
  const registry = readRegistry(registryPath);
  for (const product of registry.products) for (const image of product.images || []) {
    if (image.sha256 !== sha256) continue;
    const filePath = path.resolve(DATA_ROOT, image.local_path);
    if (!filePath.startsWith(DATA_ROOT + path.sep) || !fs.existsSync(filePath) || fs.lstatSync(filePath).isSymbolicLink()) break;
    return { filePath, mimeType: image.mime_type || 'application/octet-stream', image };
  }
  throw new PipelineError('IMAGE_NOT_FOUND', '图片不在已核验 IMA 清单中');
}

function renderContentDraftMarkdown(result) {
  return result.article_markdown;
}

function contentGenerationExamples() {
  return [
    {
      id: 'content-matebook14-harmonyos',
      label: '合成示例：制造企业移动办公图文',
      synthetic: true,
      candidate_id: null,
      note: '先运行产品匹配，再选择对应候选生成；不预置候选ID，避免跨请求串用。',
    },
  ];
}

module.exports = {
  runContentDraft,
  renderContentDraftMarkdown,
  readReviewedImage,
  contentGenerationExamples,
  DEFAULT_REGISTRY_PATH,
};
