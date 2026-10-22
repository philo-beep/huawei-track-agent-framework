'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ROOT, PipelineError, validateSchema } = require('./support');
const { runProductMatch } = require('./product-match');
const { localKnowledge, extractFacts } = require('./knowledge');
const { runReleaseVerification } = require('./release-verification');
const { assessBudget } = require('./budget-assessment');

const DATA_ROOT = path.resolve(ROOT, '..', 'huawei-sales-agent-data');
const DEFAULT_REGISTRY_PATH = path.join(DATA_ROOT, 'datasets', 'cleaned', 'image_review_registry.json');
const INPUT_SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'contracts', 'content-generation-input.schema.json'), 'utf8'));
const OUTPUT_SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'contracts', 'content-generation-output.schema.json'), 'utf8'));
const MARKER_ORDER = ['after_title', 'after_requirements', 'after_facts', 'before_cta'];
const POSITION_LABELS = { cover: '封面主视觉', scene: '使用场景', detail: '机身细节', before_cta: '行动引导前配图' };
const SUPPORTED_MODELS = Object.freeze({
  'matebook-14-harmonyos': { label: 'HUAWEI MateBook 14 鸿蒙版', operating_system: 'HarmonyOS', family: 'MateBook 14', category: '消费笔记本' },
  'matebook-14-2024': { label: 'HUAWEI MateBook 14 2024', operating_system: 'Windows', family: 'MateBook 14', category: '消费笔记本' },
});
const PLATFORM_SPECS = Object.freeze({
  '公众号': { id: 'wechat_article', format: '分层长文：场景 → 任务清单 → 原文核对 → 限制 → CTA', max_facts: 3, default_image_limit: 4, max_image_limit: 6, image_policy: '至多保留全部已核验插入位；未获授权时安全版本转纯文字', content_goal: '用可回溯资料完成完整选型核对', source_policy: '本地 E1 产品事实 + 精确型号图片审稿清单' },
  '小红书': { id: 'xiaohongshu_note', format: '短段落清单：单一任务 → 2 条原文核对卡 → 待确认事项', max_facts: 2, default_image_limit: 3, max_image_limit: 6, image_policy: '优先封面、场景与细节；最多 3 张进入默认审稿稿', content_goal: '围绕一个具体任务提供可收藏的核对清单', source_policy: '本地 E1 产品事实 + 精确型号图片审稿清单' },
  '朋友圈': { id: 'moments_short_post', format: '短帖：一行任务 → 1 条原文核对 → 待确认与 CTA', max_facts: 1, default_image_limit: 1, max_image_limit: 3, image_policy: '默认 1 张封面或场景图；不堆叠参数', content_goal: '用简短可信表述邀请补充任务条件', source_policy: '本地 E1 产品事实 + 精确型号图片审稿清单' },
});

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/huawei|华为/g, '').replace(/harmonyos/g, '鸿蒙版').replace(/[\s\-_/（）()·]/g, '');
}

function strictName(value) {
  return String(value || '').toLowerCase().replace(/[\s\-_/（）()·]/g, '');
}

function modelKey(value) {
  const text = String(value || '').toLowerCase();
  if (/matebook\s*14/.test(text) && /2024|酷睿\s*ultra/.test(text)) return 'matebook-14-2024';
  if (/matebook\s*14/.test(text) && /鸿蒙|harmonyos/.test(text)) return 'matebook-14-harmonyos';
  return null;
}

function candidateModelKey(candidate) {
  const evidenceText = (candidate.evidence || []).map(item => `${item.title || ''} ${item.locator || ''} ${item.excerpt || ''}`).join(' ');
  return modelKey(`${candidate.product_name || ''} ${candidate.product_family || ''} ${evidenceText}`);
}

function platformSpec(platform) {
  const spec = PLATFORM_SPECS[platform];
  if (!spec) throw new PipelineError('UNSUPPORTED_PLATFORM', '仅支持公众号、小红书和朋友圈三个内容平台');
  return spec;
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
  const targetKey = candidateModelKey(candidate);
  const candidates = (registry.products || []).filter(product => {
    const names = [product.product_name, ...(product.aliases || [])].filter(Boolean);
    if (targetKey) return names.some(name => modelKey(name) === targetKey);
    return names.some(name => normalizeName(name) === normalizeName(candidate.product_name));
  });
  const evidence = candidate.evidence || [];
  return candidates.find(product => {
    const names = [product.product_name, ...(product.aliases || [])].filter(Boolean);
    return evidence.some(item => item.source_level === 'E1' && names.some(name => strictName(`${item.title} ${item.locator}`).includes(strictName(name))));
  }) || null;
}

function fallbackProductIdentity(candidate) {
  const productEvidence = (candidate.evidence || []).find(item => item.source_level === 'E1' && /^HUAWEI\s+/i.test(String(item.title || '')));
  const evidenceName = productEvidence ? String(productEvidence.title).split(/\s+-\s+/)[0].trim() : '';
  const productName = evidenceName || candidate.product_name;
  const key = candidateModelKey(candidate);
  const supported = key ? SUPPORTED_MODELS[key] : null;
  return {
    product_name: productName,
    family: candidate.product_family || supported?.family || null,
    category: candidate.category || supported?.category || null,
    operating_system: candidate.operating_system || supported?.operating_system || null,
    model_key: key,
  };
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function verifiedImages(registry, product, limit) {
  const expectedKey = modelKey(product.product_name);
  const available = (product.images || []).filter(image => image.model_verified === true && String(image.source_status || '').startsWith('http_200'));
  const selected = [...available].sort((first, second) => MARKER_ORDER.indexOf(first.marker) - MARKER_ORDER.indexOf(second.marker)).slice(0, limit);
  if (!selected.length) return [];
  return selected.map(image => {
    const imageIdentityText = `${image.file_name || ''} ${image.caption || ''} ${image.ima_entry || ''} ${image.original_url || ''}`;
    const imageKey = modelKey(imageIdentityText);
    if (expectedKey && imageKey && imageKey !== expectedKey) throw new PipelineError('IMAGE_MODEL_MISMATCH', `图片型号与目标型号不一致：${image.image_id}`);
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
  let all;
  try {
    all = extractFacts(knowledge, productName, { maxFacts: 12 });
  } catch (error) {
    if (error instanceof PipelineError && error.code === 'KNOWLEDGE_NOT_FOUND') return [];
    throw error;
  }
  const valid = all.filter(fact => fact.source_refs?.length && fact.source_refs.every(source => String(source.excerpt || '').includes(fact.claim)));
  const ranked = valid.map((fact, index) => ({ fact, index, score: factScore(fact, profile) })).sort((first, second) => second.score - first.score || first.index - second.index);
  return ranked.slice(0, 3).map(item => item.fact);
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

function draftContext(profile, product, facts) {
  const audience = inlineText(profile.audience) || '客户';
  const scenario = inlineText(profile.scenario) || '本次办公任务';
  const shortScenario = String(scenario).split(/[，,。；;]/)[0].replace(/需要移动办公$/, '').slice(0, 32) || '本次办公任务';
  const needs = listText(profile.needs);
  const preferences = listText(profile.preferences);
  const painPoints = listText(profile.pain_points);
  const organization = [profile.industry, Number.isInteger(profile.company_size) ? `${profile.company_size}人组织` : null].filter(Boolean).join('、');
  return { audience, scenario, shortScenario, needs, preferences, painPoints, organization, facts };
}

function factsAsCards(facts, compact = false) {
  return facts.flatMap(fact => {
    const heading = String(fact.claim).split('\n').find(line => line.startsWith('## '))?.replace(/^##\s+/, '') || '公开资料';
    const citation = sourceForFact(fact);
    const claim = compact ? String(fact.claim).split(/\n\s*\n/).filter(Boolean).slice(0, 3).join('\n\n') : fact.claim;
    return [
      `### ${compact ? '原文核对卡' : '官网原文'}｜${heading}`,
      claim,
      `来源定位：${citation.source_title}｜${citation.source_entry}｜${fact.id}`,
    ];
  });
}

function composePublicAccount(context, product, images) {
  const { audience, scenario, shortScenario, needs, preferences, painPoints, organization, facts } = context;
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
  blocks.push(`- 客户背景：${organization || '行业与组织规模待确认'}（仅来自客户输入，不代表采购权限）`);
  blocks.push(`- 明确需求：${needs}`);
  blocks.push(`- 当前偏好：${preferences}`);
  blocks.push(`- 待确认问题：${painPoints}`);
  blocks.push('- 预算：客户未提供时保持未知；客户提供的预算也不能直接当成产品报价；与公开快照不一致时只标记待复核。');
  if (scene) blocks.push(imageCallout(scene, images.indexOf(scene), '“先把实际任务说清楚”一节之后'));
  blocks.push(`## 候选机型：${product.product_name}`);
  blocks.push('以下只放可逐字回溯到 IMA 产品事实原文的公开资料。它们用于核对，不等同于实际体验、软件兼容结论或完整销售 SKU。');
  blocks.push(...factsAsCards(facts));
  if (detail) blocks.push(imageCallout(detail, images.indexOf(detail), '官网原文核对段之后'));
  blocks.push('## 这些事项还不能直接下结论');
  blocks.push('- 软件兼容性：必须按客户实际软件名称、版本、文件格式和外设逐项验证；资料存在不等于兼容已通过。');
  blocks.push('- 完整 SKU 与配色：当前资料是系列或具体型号级线索，颜色、键盘版本和销售配置仍需确认。');
  blocks.push('- 价格与库存：没有完整 SKU、地区、数量、有效期和有效报价依据时，不输出成交金额。');
  blocks.push('- 图片授权：如稿中出现图片，仅完成型号与画面辅助核验，正式公开发布前仍需人工终审和授权确认。');
  if (beforeCta) blocks.push(imageCallout(beforeCta, images.indexOf(beforeCta), '行动引导（CTA）之前'));
  return {
    title,
    lead,
    body_markdown: blocks.join('\n\n'),
    cta: '把常用软件及版本、主要文件格式、外设和移动频次发来；我们会先核对是否具备演示条件，再由人工确认下一步，不先承诺兼容或报价。',
    tags: ['华为笔记本', '移动办公', '选型核对', '软件兼容性'],
  };
}

function composeXiaohongshu(context, product, images) {
  const { audience, scenario, shortScenario, needs, preferences, painPoints, facts } = context;
  const title = `${shortScenario}｜先列任务，再核对 ${facts.length} 项资料`;
  const lead = `${audience}在准备“${scenario}”。这是一份合成需求下的选型核对清单，不冒充真实使用体验。`;
  const blocks = ['### ① 先列任务', `- 要完成：${scenario}`, `- 已知需求：${needs}`, `- 当前偏好：${preferences}`, `- 还要确认：${painPoints}`];
  for (const image of images) blocks.push(imageCallout(image, images.indexOf(image), `小红书 ${POSITION_LABELS[image.position] || '配图'}位置`));
  blocks.push('### ② 资料核对卡', ...factsAsCards(facts, true));
  blocks.push('### ③ 这些还不能直接下结论', '- 软件兼容性需要按名称、版本、文件格式和外设实际验证。', '- 颜色、键盘、内存和存储等完整 SKU 仍需确认。', '- 价格与库存没有当前有效依据时不写成成交价。', '- 图片如出现，仅为审稿建议，公开发布授权与人工终审待确认。');
  return {
    title,
    lead,
    body_markdown: blocks.join('\n\n'),
    cta: '把你的使用场景、常用软件版本和文件格式留言说明；先一起整理待核对清单，再确认演示条件。',
    tags: ['华为笔记本', '选购清单', '移动办公', '备课展示'],
  };
}

function composeMoments(context, product, images) {
  const { audience, scenario, shortScenario, needs, facts } = context;
  const title = `${product.product_name}｜${shortScenario}`;
  const lead = `${audience}的“${scenario}”，先核对任务和资料，不先许诺兼容与价格。`;
  const blocks = [`任务重点：${needs}。`, `一条可回溯资料：`, factsAsCards(facts, true).join('\n\n'), '仍需确认：软件版本、文件格式、完整 SKU、库存与当前有效报价。'];
  for (const image of images) blocks.push(imageCallout(image, images.indexOf(image), '朋友圈短帖配图位置'));
  return {
    title,
    lead,
    body_markdown: blocks.join('\n\n'),
    cta: '愿意继续核对的话，请说明使用任务和方便联系的渠道；不在评论区假定成交或承诺效果。',
    tags: ['华为笔记本', '办公选型'],
  };
}

function composeDraft(profile, product, facts, images, platform = '公众号') {
  const spec = platformSpec(platform);
  const context = draftContext(profile, product, facts);
  const draft = platform === '小红书'
    ? composeXiaohongshu(context, product, images)
    : platform === '朋友圈'
      ? composeMoments(context, product, images)
      : composePublicAccount(context, product, images);
  return draft;
}

function renderArticleMarkdown(result) {
  const imageRows = result.image_sources.map((image, index) => `| ${index + 1} | ${image.file_name} | ${image.caption} | ${image.original_url} | ${image.model_match_status}；${image.rights_status} |`);
  const citationRows = result.citations.map(item => `- ${item.fact_id}｜${item.source_title}｜${item.source_entry}${item.source_url ? `｜${item.source_url}` : ''}${item.source_sha256 ? `｜${item.source_sha256}` : ''}`);
  const verificationRows = result.verification.items.map(item => `| ${item.label} | ${item.status_label} | ${item.summary} |`);
  const riskLines = result.verification.risk_items.length
    ? result.verification.risk_items.map(risk => `- [${risk.risk_level_label}] ${risk.title}｜${risk.issue}｜处理：${risk.recommendation}`)
    : ['- 未发现需要阻塞或降级的风险项。'];
  const imageSection = result.image_sources.length ? [
    '## 图片来源清单', '',
    '> 型号匹配与原始来源已核对；公开发布授权和人工终审仍待确认。原稿图片只用于审稿，不等于可发布配图。', '',
    `> IMA 知识库：${result.image_sources[0].ima_kb_name}｜知识库 ID：${result.image_sources[0].ima_kb_id}｜检索请求 ID：${result.image_sources[0].ima_search_request_ids.join('、')}`, '',
    '| # | 文件 | 说明 | 原图来源 | 状态 |',
    '| --- | --- | --- | --- | --- |',
    ...imageRows, '',
  ] : ['## 图片来源清单', '', '- 本稿未使用任何图片。', ''];
  const safe = result.verification.safe_content;
  const safeSection = safe.ready && safe.content ? [
    '## 可发布安全版本', '',
    `> 强制核验结论：${result.verification.status_label}；六项核验通过${result.verification.summary.pass_count}项、降级${result.verification.summary.downgrade_count}项、不通过${result.verification.summary.fail_count}项。以下版本已移除降级项，但仍须由发布责任人完成最终确认。`, '',
    safe.rendered_markdown.trim(), '',
  ] : [
    '## 可发布安全版本', '',
    '> 当前没有可发布版本。请先处理“不通过”或阻塞风险后重新核验。', '',
  ];
  return [
    `# ${result.draft.title}`, '',
    `> 平台：${result.platform}；内容结构：${result.platform_profile.format}；事实数上限：${result.platform_profile.max_facts}；图片上限：${result.platform_profile.image_limit}。`, '',
    result.draft.lead, '',
    result.draft.body_markdown, '',
    '## 下一步沟通', '',
    result.draft.cta, '',
    '## 预算核对', '',
    `> 状态：${result.budget_assessment.status}。${result.budget_assessment.message}`, '',
    '---', '',
    '## 强制核验结果', '',
    `> 总体结论：${result.verification.status_label}；策略版本：${result.verification.policy_version}；原始稿公开发布就绪：${result.verification.publication_ready ? '是' : '否'}；安全版本可用：${result.verification.safe_content_ready ? '是' : '否'}。`, '',
    '| 核验项 | 结果 | 说明 |',
    '| --- | --- | --- |',
    ...verificationRows, '',
    '## 风险项清单', '',
    ...riskLines, '',
    ...imageSection,
    '## 事实来源索引', '',
    ...citationRows, '',
    ...safeSection,
    '## 审稿边界', '',
    '- 产品事实仅来自上列可定位原文，未把检索摘要或模型常识补成产品参数。',
    '- 客户画像只用于匹配任务与沟通角度，不推断预算、身份或采购权限。',
    '- 未生成正式报价，未承诺软件兼容、咨询量或成交转化。',
    `- 原始稿核验时间：${result.verification.checked_at}；生成时间：${result.generated_at}。`, '',
  ].join('\n');
}

function safeProfile(profile, budgetAssessment = null) {
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
    budget_status: budgetAssessment?.status || (profile.budget ? '预算条件待核对' : '客户未提供预算；不推断价格或采购资格'),
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
  const reviewedProduct = resolveReviewedProduct(registry, candidate);
  const resolved = reviewedProduct || fallbackProductIdentity(candidate);
  const resolvedModelKey = resolved.model_key || modelKey(resolved.product_name) || candidateModelKey(candidate);
  const knowledge = await localKnowledge(resolved.product_name);
  const facts = selectFacts(knowledge, resolved.product_name, input.match_input.profile);
  const spec = platformSpec(input.platform);
  const selectedFacts = facts.slice(0, spec.max_facts);
  const limit = Math.min(input.image_limit || spec.default_image_limit, spec.max_image_limit);
  const images = reviewedProduct ? verifiedImages(registry, reviewedProduct, limit).map(image => ({ ...image, ima_kb_name: registry.knowledge_base.kb_name })) : [];
  const budgetAssessment = assessBudget(input.match_input.profile, resolved.product_name, knowledge);
  const draft = composeDraft(input.match_input.profile, resolved, selectedFacts, images, input.platform);
  const profileBasis = safeProfile(input.match_input.profile, budgetAssessment);
  const citations = selectedFacts.map(fact => ({
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
    source_status: image.source_status,
    source_checked_at: image.source_checked_at || null,
    reviewed_at: image.reviewed_at || null,
    visual_review_note: image.visual_review_note || null,
    formal_publication_verified: image.formal_publication_verified === true,
    publication_ready: image.publication_ready === true && image.formal_publication_verified === true,
  }));
  const insertionPlan = images.map(image => ({
    after_marker: image.marker,
    position: image.position,
    image_id: image.image_id,
    caption: image.caption,
    instruction: image.marker === 'after_title' ? '标题和导语之后'
      : image.marker === 'after_requirements' ? '任务清单之后'
        : image.marker === 'after_facts' ? '原文核对段之后'
          : '行动引导之前',
  }));
  const verification = runReleaseVerification({
    product: { requested_name: candidate.product_name, resolved_name: resolved.product_name, model_verified: true },
    candidate,
    draft,
    facts: selectedFacts,
    image_sources: imageSources,
    citations,
    image_expected: limit,
  });
  const result = {
    schema_version: '1.2',
    status: verification.overall_status === 'blocked' ? 'blocked' : 'ready_for_review',
    synthetic: /合成样例|合成测试|虚构客户/.test(String(input.match_input.profile.raw_request || '')),
    generated_at: new Date().toISOString(),
    platform: input.platform,
    platform_profile: {
      id: spec.id,
      label: input.platform,
      content_goal: spec.content_goal,
      format: spec.format,
      max_facts: spec.max_facts,
      image_limit: limit,
      image_policy: spec.image_policy,
      source_policy: spec.source_policy,
      data_sources: ['local_kb_index', 'image_review_registry'],
    },
    product: {
      candidate_id: candidate.candidate_id,
      requested_name: candidate.product_name,
      resolved_name: resolved.product_name,
      model_key: resolvedModelKey,
      family: resolved.family || null,
      category: resolved.category || null,
      operating_system: resolved.operating_system || null,
      model_verified: verification.product_model_match === 'verified',
    },
    profile_basis: profileBasis,
    budget_assessment: budgetAssessment,
    draft,
    image_sources: imageSources,
    insertion_plan: insertionPlan,
    citations,
    verification,
    article_markdown: '',
    diagnostics: [
      {
        code: verification.overall_status === 'blocked' ? 'RELEASE_BLOCKED' : verification.overall_status === 'downgraded' ? 'RELEASE_DOWNGRADED' : 'RELEASE_VERIFIED',
        message: `强制核验结论：${verification.status_label}；通过${verification.summary.pass_count}项、降级${verification.summary.downgrade_count}项、不通过${verification.summary.fail_count}项。`,
      },
      ...verification.risk_items.map(risk => ({ code: risk.risk_level === 'blocking' ? 'VERIFICATION_BLOCKING_RISK' : 'VERIFICATION_DOWNGRADE', message: `${risk.title}：${risk.recommendation}` })),
      { code: 'PLATFORM_APPLIED', message: `已按${input.platform}结构生成，事实上限${spec.max_facts}条，图片上限${limit}张；来源仍为本地E1事实与精确型号审稿清单。` },
      { code: 'BUDGET_ASSESSMENT', message: budgetAssessment.message },
      { code: 'HUMAN_REVIEW_REQUIRED', message: '自动核验不替代发布责任人的最终确认；公开发布仍不得越过来源、价格、图片授权和人工确认边界。' },
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
  return Object.entries(PLATFORM_SPECS).map(([platform, spec]) => ({
    id: `content-${spec.id}`,
    label: `合成示例：${platform}内容审稿`,
    platform,
    synthetic: true,
    candidate_id: null,
    note: '先运行产品匹配，再选择具体候选生成；不预置候选ID，避免跨请求串用。',
    expected: { platform, max_facts: spec.max_facts, image_limit: spec.default_image_limit },
  }));
}

module.exports = {
  runContentDraft,
  renderContentDraftMarkdown,
  readReviewedImage,
  contentGenerationExamples,
  DEFAULT_REGISTRY_PATH,
  PLATFORM_SPECS,
  SUPPORTED_MODELS,
  platformSpec,
};
