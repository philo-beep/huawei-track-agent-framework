'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { runProductMatch, productMatchExamples } = require('../backend/agent/product-match');
const { runContentDraft, composeLegacyDraft, readReviewedImage } = require('../backend/agent/content-generation');
const { cleanProse } = require('../backend/agent/sales-copy');

const OUTPUT_DIR = path.join(__dirname, 'blind_review');
const SAMPLE_DIR = path.join(OUTPUT_DIR, 'samples');
const baseProfile = productMatchExamples()[0].input.profile;

const personae = [
    {
        id: 'procurement', label: '制造企业采购负责人',
        profile: { audience: '制造企业采购负责人', scenario: '仓库与办公室轮用，需要移动办公', industry: '制造业', company_size: 30, needs: ['移动办公', '办公'], preferences: ['长续航', '便携'], pain_points: ['软件兼容性待确认'] },
    },
    {
        id: 'educator', label: '民办培训机构教研老师',
        profile: { audience: '民办培训机构教研老师', scenario: '备课文稿与课堂展示文件的选型核对', industry: '教育培训', company_size: 20, needs: ['备课', '课堂展示'], preferences: ['屏幕清晰', '便携'], pain_points: ['软件版本待确认'] },
    },
    {
        id: 'executive', label: '初创公司创始人',
        profile: { audience: '初创公司创始人', scenario: '与现有电脑做配置和价格比较', industry: '企业服务', company_size: 12, needs: ['办公', '比较'], preferences: ['少维护', '便携'], pain_points: ['完整配置待确认'] },
    },
];
const platforms = ['公众号', '小红书', '朋友圈'];
const platformLimits = { '公众号': 4, '小红书': 3, '朋友圈': 1 };
const INTERNAL_TERMS = /<!--\s*IMAGE:|发布前检查|资料核对卡|客户背景|明确需求|当前偏好|待确认问题|fact-|official-|\bJSON\b|\bMarkdown\b|SHA-?256/i;
const RAW_DUMP_TERMS = /客户背景|明确需求|当前偏好|待确认问题|官网原文｜|原文核对卡/g;

function stable(seed, length) {
    return crypto.createHash('sha256').update(seed).digest().readUInt32BE(0) % length;
}

async function generateCase(persona, platform) {
    const input = JSON.parse(JSON.stringify(productMatchExamples()[0].input));
    input.mode = 'local';
    input.use_cloud_model = false;
    input.profile = { ...JSON.parse(JSON.stringify(baseProfile)), ...persona.profile };
    const match = await runProductMatch(input);
    const candidate = match.candidates.find(item => item.product_name === 'HUAWEI MateBook 14') || match.candidates[0];
    const output = await runContentDraft({ schema_version: '1.0', match_input: input, candidate_id: candidate.candidate_id, platform, image_limit: platformLimits[platform] });
    const legacyFacts = output.citations.map(citation => ({
        id: citation.fact_id,
        claim: citation.claim,
        source_refs: [{ title: citation.source_title, urls: [citation.source_url], entry: citation.source_entry, entry_sha256: citation.source_sha256, excerpt: citation.claim }],
    }));
    const legacyDraft = composeLegacyDraft(persona.profile, { product_name: output.product.resolved_name }, legacyFacts, output.image_sources, platform);
    const legacyMarkdown = ['# ' + legacyDraft.title, '', legacyDraft.lead, '', cleanProse(legacyDraft.body_markdown), '', '## 下一步沟通', '', legacyDraft.cta, '', legacyDraft.tags.map(tag => '#' + tag).join(' ')]
        .filter((line, index, rows) => !(line === '' && rows[index - 1] === '')).join('\n').trim() + '\n';
    return {
        id: persona.id + '-' + (platform === '公众号' ? 'wechat' : platform === '小红书' ? 'xiaohongshu' : 'moments'),
        persona, platform, output, legacy: legacyMarkdown, current: output.publish_copy.markdown,
    };
}

function scoreCopy(copy, platform) {
    const value = String(copy || '');
    let naturalness = 4.35;
    const dumpMatches = value.match(RAW_DUMP_TERMS) || [];
    if (dumpMatches.length) naturalness -= Math.min(2.6, dumpMatches.length * 0.5);
    if (/仓库|备课|课堂|比较|软件|文件/.test(value.slice(0, 320))) naturalness += 0.25;
    if (/\d+(?:\.\d+)?\s*(?:kg|Wh|英寸|PPI)/.test(value)) naturalness += 0.15;
    const repeatedFormula = (value.match(/这次(?:要处理|围绕|把|在核对)/g) || []).length;
    if (repeatedFormula > 1) naturalness -= Math.min(0.35, (repeatedFormula - 1) * 0.12);
    if (/客户背景|明确需求|当前偏好|待确认问题/.test(value)) naturalness -= 1;
    if ((value.match(/\n\s*## /g) || []).length > 6) naturalness -= 0.5;
    if (/读者需要|读者通常|读者关心/.test(value)) naturalness -= 0.8;
    if (platform === '朋友圈' && value.length > 500) naturalness -= 0.8;
    if (platform === '小红书' && value.length > 1400) naturalness -= 0.6;
    if (platform === '公众号' && value.length > 3600) naturalness -= 0.6;
    if (!/先把|先看|先别|这次|如果你|也在/.test(value.slice(0, 260))) naturalness -= 0.4;
    naturalness = Math.max(1, Math.min(4.8, naturalness));
    let editability = 5;
    if (INTERNAL_TERMS.test(value)) editability -= 3;
    if (dumpMatches.length > 3) editability -= 2;
    else if (dumpMatches.length) editability -= 1;
    if (platform === '朋友圈' && value.length > 500) editability -= 1;
    if (platform === '小红书' && value.length > 1400) editability -= 1;
    if (platform === '公众号' && value.length > 3600) editability -= 1;
    if (!/下一步|评论区|发我|清单|核对/.test(value)) editability -= 1;
    editability = Math.max(1, Math.min(5, editability));
    let willingness = Math.min(naturalness, editability);
    if (!/(发我|评论区|留言|发来|核对项|核对清单)/.test(value)) willingness -= 1;
    if (/保证成交|保证转化|全网最低|官方已确认|绝对兼容|完全兼容/.test(value)) willingness -= 3;
    willingness = Math.max(1, Math.min(5, willingness));
    return { naturalness, editability, willingness };
}

function summarize(rows) {
    const average = key => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
    return {
        naturalness: average('naturalness'),
        editable_rate: rows.filter(row => row.editability >= 4).length / rows.length,
        publish_intent_rate: rows.filter(row => row.willingness >= 4).length / rows.length,
    };
}

function labelsFor(id) {
    return stable(id + '|blind-order', 2) === 0 ? { A: 'legacy', B: 'current' } : { A: 'current', B: 'legacy' };
}

function buildPack(cases, labels) {
    const lines = ['# 销售文案盲测包', '', '用途：比较“旧模板稿”与“受控创意稿”的自然度、可编辑率和愿意发布率。', '', '评分：每份稿按 1—5 分评分；自然度取平均分，可编辑率统计“只需小幅修改”≥4 分的样本占比，愿意发布率统计“愿意发布”≥4 分的样本占比。', '', '注意：本包已打乱 A/B 顺序，评分时不要查看盲测密钥。', ''];
    cases.forEach((item, index) => {
        const mapping = labels[item.id];
        lines.push('## 样本 ' + String(index + 1).padStart(2, '0') + '｜' + item.platform + '｜' + item.persona.label, '');
        lines.push('场景：' + item.persona.profile.scenario, '');
        lines.push('请分别评分：自然度 __/5；只需小幅修改即可发布 __/5；愿意发布 __/5；备注：________', '');
        lines.push('### A', '', '~~~markdown', item[mapping.A], '~~~', '');
        lines.push('### B', '', '~~~markdown', item[mapping.B], '~~~', '');
    });
    return lines.join('\n');
}

function buildReport(cases, labels, scores) {
    const baseline = summarize(scores.map(item => item.legacy));
    const current = summarize(scores.map(item => item.current));
    const lines = ['# 销售文案盲测预检报告', '', '状态：机器代理预检已完成；真人销售盲测尚未执行。以下数字只用于发现明显退化和排序问题，不能写成真人销售结论。', '', '## 一、方法', '', '- 3 类人群 × 3 个平台，共 9 组 A/B 盲测样本。', '- A/B 顺序按固定种子打乱，评分包不展示新旧来源。', '- 机器代理按模板痕迹、内部术语、原文倾倒、平台篇幅和行动引导计算 1—5 分，只做发布前预检。', '- 真人盲测需至少 5 名销售独立评分；可编辑率 = 可编辑分≥4 的样本占比，愿意发布率 = 愿意发布分≥4 的样本占比。', '', '## 二、代理预检汇总', '', '| 版本 | 自然度均值（5分制） | 可编辑率 | 愿意发布率 |', '| --- | ---: | ---: | ---: |', '| 旧模板稿 | ' + baseline.naturalness.toFixed(2) + ' | ' + (baseline.editable_rate * 100).toFixed(1) + '% | ' + (baseline.publish_intent_rate * 100).toFixed(1) + '% |', '| 受控创意稿 | ' + current.naturalness.toFixed(2) + ' | ' + (current.editable_rate * 100).toFixed(1) + '% | ' + (current.publish_intent_rate * 100).toFixed(1) + '% |', '', '## 三、逐组结果', '', '| 样本 | 人群 | 平台 | 旧稿自然度 | 新稿自然度 | 旧稿可编辑 | 新稿可编辑 | 旧稿愿意发布 | 新稿愿意发布 |', '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
    scores.forEach((item, index) => lines.push('| ' + String(index + 1).padStart(2, '0') + ' | ' + item.case.persona.label + ' | ' + item.case.platform + ' | ' + item.legacy.naturalness.toFixed(1) + ' | ' + item.current.naturalness.toFixed(1) + ' | ' + item.legacy.editability.toFixed(1) + ' | ' + item.current.editability.toFixed(1) + ' | ' + item.legacy.willingness.toFixed(1) + ' | ' + item.current.willingness.toFixed(1) + ' |'));
    lines.push('', '## 四、真人盲测记录', '', '| 评审人 | 岗位/行业 | 完成样本数 | 自然度均值 | 可编辑率 | 愿意发布率 | 备注 |', '| --- | --- | ---: | ---: | ---: | ---: | --- |', '| 待填写 | 待填写 | 0 | — | — | — | 尚未执行，不把代理结果冒充真人结论 |', '');
    lines.push('## 五、结论边界', '', '- 受控创意稿已通过结构和规则预检，但自然度最终仍以真人销售盲测为准。', '- 参数和价格保持锁定；图片授权未完成时，正文只输出文字可发版本，图片单独进入配图单。', '');
    return lines.join('\n');
}

async function main() {
    fs.mkdirSync(SAMPLE_DIR, { recursive: true });
    const cases = [];
    for (const persona of personae) for (const platform of platforms) cases.push(await generateCase(persona, platform));
    const labels = Object.fromEntries(cases.map(item => [item.id, labelsFor(item.id)]));
    const scores = cases.map(item => ({ case: item, legacy: scoreCopy(item.legacy, item.platform), current: scoreCopy(item.current, item.platform) }));
    const key = { schema_version: '1.0', method: 'deterministic-blind-order', note: 'key 只能由组织盲测的人保存，不发给评分销售。', cases: cases.map((item, index) => ({ sample: index + 1, id: item.id, a: labels[item.id].A, b: labels[item.id].B })), proxy_scores: scores.map(item => ({ id: item.case.id, legacy: item.legacy, current: item.current })) };
    fs.writeFileSync(path.join(OUTPUT_DIR, 'blind_review_pack.md'), buildPack(cases, labels), 'utf8');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'blind_review_key.json'), JSON.stringify(key, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'blind_review_report.md'), buildReport(cases, labels, scores), 'utf8');
    const csv = ['sample_id,persona,platform,naturalness_1_5,editability_1_5,would_publish_1_5,notes'];
    cases.forEach((item, index) => csv.push([index + 1, item.persona.label, item.platform, '', '', '', ''].join(',')));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'blind_review_form.csv'), csv.join('\n') + '\n', 'utf8');
    const samples = [{ file: '01-procurement-wechat.md', match: 'procurement-wechat' }, { file: '02-educator-xiaohongshu.md', match: 'educator-xiaohongshu' }, { file: '03-executive-moments.md', match: 'executive-moments' }];
    const mediaPlan = [];
    for (const sample of samples) {
        const item = cases.find(entry => entry.id === sample.match);
        const heading = '# ' + item.persona.label + '｜' + item.platform + '｜文字可发版\n\n';
        const note = '> 状态：文字可直发；图片授权与人工终审未完成，未插入正文。图片顺序见媒体单。\n\n';
        fs.writeFileSync(path.join(SAMPLE_DIR, sample.file), heading + note + item.current, 'utf8');
        for (const image of item.output.publish_copy.image_order) {
            const source = item.output.image_sources.find(entry => entry.asset_url === image.asset_url);
            mediaPlan.push({ sample: sample.file, persona: item.persona.label, platform: item.platform, order: image.order, instruction: image.instruction, caption: image.caption, asset_url: image.asset_url, source_url: source ? source.original_url : null, rights_status: image.rights_status, publication_ready: image.publication_ready, local_path: source ? path.relative(path.resolve(__dirname, '..', '..'), readReviewedImage(source.sha256).filePath).split(path.sep).join('/') : null });
        }
    }
    fs.writeFileSync(path.join(SAMPLE_DIR, 'media-plan.json'), JSON.stringify({ schema_version: '1.0', note: '仅使用与目标型号精确匹配的数据源图片；公开发布授权完成前不插入正文。', assets: mediaPlan }, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({ cases: cases.length, baseline: summarize(scores.map(item => item.legacy)), current: summarize(scores.map(item => item.current)), output: OUTPUT_DIR }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
