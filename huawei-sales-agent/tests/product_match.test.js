'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runProductMatch, validateProductMatchInput, renderProductMatchMarkdown, productMatchExamples } = require('../backend/agent/product-match');

function fixtureIndex() {
    return {
        built_at: '2026-10-21T00:00:00+08:00', ima_connected: false,
        documents: [
            {
                id: 'doc-fact-1', kind: 'product_fact', product_names: ['HUAWEI MateBook 14'],
                title: 'HUAWEI MateBook 14 - 产品事实',
                source: { entry: 'local/MateBook14.md', entry_sha256: 'a'.repeat(64), urls: ['https://consumer.huawei.com/cn/laptops/matebook-14/'] },
                text: '# HUAWEI MateBook 14\n\n> 抓取日期：2026-10-21\n\n## 尺寸与重量\n\n重量约 1.33 kg，适合移动携带。\n\n## 电池\n\n电池容量 70 Wh，官网标注长续航。\n\n## 屏幕\n\n14.2 英寸 OLED 屏幕。\n\n## 接口\n\n支持 USB-C。',
            },
            {
                id: 'doc-catalog-1', kind: 'product_catalog', product_names: ['HUAWEI MateBook 14'],
                title: 'HUAWEI MateBook 14', source: { entry: 'local/catalog/MateBook14.md', entry_sha256: 'b'.repeat(64), urls: ['https://consumer.huawei.com/cn/laptops/matebook-14/'] },
                text: '# HUAWEI MateBook 14\n\n- 产品类别：消费级笔记本\n\n## 官网公开定位摘要\n\n适合移动办公与日常文档处理',
            },
            {
                id: 'doc-catalog-2', kind: 'product_catalog', product_names: ['HUAWEI PixLab X1'],
                title: 'HUAWEI PixLab X1', source: { entry: 'local/catalog/PixLabX1.md', entry_sha256: 'c'.repeat(64), urls: ['https://consumer.huawei.com/cn/printers/pixlab-x1/'] },
                text: '# HUAWEI PixLab X1\n\n- 产品类别：打印机\n\n## 官网公开定位摘要\n\n黑白激光打印与扫描',
            },
        ],
        price_records: [
            { raw_fields: { '记录ID': 'PRICE-1', '规范产品名称': 'HUAWEI MateBook 14', '价格类型': '官网参考起价', '页面金额（元）': '5999', '核验状态': '历史快照待复核', '核验时间': '2026-10-21', '来源标题': '官网价格快照', '官方URL': 'https://consumer.huawei.com/cn/laptops/matebook-14/' }, source_entry_sha256: 'd'.repeat(64) },
        ],
    };
}

function baseInput() {
    return {
        schema_version: '1.0', mode: 'local', use_cloud_model: false,
        profile: {
            raw_request: '合成样例：企业采购负责人需要移动办公电脑。', audience: '采购负责人', scenario: '移动办公', industry: '制造业', company_size: 20,
            product_type: '电脑', needs: ['移动办公'], preferences: ['长续航'], pain_points: [], excluded_requirements: [], budget: null,
        },
    };
}

test('local matching binds customer and product evidence', async () => {
    const result = await runProductMatch(baseInput(), { indexData: fixtureIndex() });
    assert.equal(result.status, 'ready');
    assert.ok(result.candidates.length >= 1);
    const candidate = result.candidates[0];
    assert.equal(candidate.product_name, 'HUAWEI MateBook 14');
    assert.equal(candidate.status, 'recommended');
    assert.ok(candidate.matching_reasons.length >= 1);
    assert.ok(candidate.matching_reasons.every(reason => reason.evidence_ids.length >= 2));
    assert.ok(candidate.evidence.some(item => item.source_level === 'E1'));
    assert.ok(candidate.evidence.some(item => item.source_type === 'customer_input'));
});

test('explicit budget keeps candidate pending without current quote', async () => {
    const input = baseInput();
    input.profile.budget = { min: 6000, max: 6000, currency: 'CNY', scope: '单台', quantity: 1 };
    const result = await runProductMatch(input, { indexData: fixtureIndex() });
    assert.ok(result.candidates.length >= 1);
    assert.equal(result.candidates[0].status, 'pending_confirmation');
    assert.equal(result.candidates[0].status_label, '【待确认】');
    assert.ok(result.candidates[0].missing_information.some(item => item.includes('价格')));
});

test('insufficient profile asks for clarification without inventing candidates', async () => {
    const input = baseInput();
    input.profile.raw_request = '想看看产品。'; input.profile.scenario = null; input.profile.product_type = null; input.profile.needs = []; input.profile.preferences = [];
    const result = await runProductMatch(input, { indexData: fixtureIndex() });
    assert.equal(result.status, 'needs_clarification');
    assert.equal(result.candidates.length, 0);
    assert.ok(result.questions.length >= 1);
});

test('IMA metadata alone is pending and remains traceable', async () => {
    const input = baseInput();
    input.mode = 'ima';
    const imaRunner = async () => ({
        status: 'connected', knowledge_base: { kb_id: 'kb-1', kb_name: '合成知识库' }, request_ids: ['req-1'],
        results: [{ media_id: 'media-1', title: 'HUAWEI MateBook 14', highlight_content: '移动办公与长续航相关记录', source_ref: { entry: 'ima-metadata:kb-1:media-1', entry_sha256: 'e'.repeat(64) } }],
    });
    const result = await runProductMatch(input, { indexData: fixtureIndex(), imaRunner });
    assert.equal(result.provenance.effective_mode, 'ima');
    assert.equal(result.candidates[0].status, 'pending_confirmation');
    assert.equal(result.candidates[0].evidence.find(item => item.source_type === 'ima_metadata').source_level, 'E3');
    assert.deepEqual(result.provenance.ima_request_ids, ['req-1']);
});

test('model reason with unsupported number is dropped', async () => {
    const input = baseInput();
    input.use_cloud_model = true;
    const modelRunner = async (system, prompt) => {
        const payload = JSON.parse(prompt);
        const candidate = payload.candidates[0];
        const profileEvidence = candidate.evidence.find(item => item.source_type === 'customer_input');
        const factEvidence = candidate.evidence.find(item => item.source_level === 'E1' && item.excerpt.includes('容量'));
        return {
            model: 'test-model', value: { decisions: [{ candidate_id: candidate.candidate_id, reasons: [
                { text: '候选资料列出电池容量 70 Wh，是否满足长续航仍需任务核验。', cited_span: '电池容量 70 Wh', evidence_ids: [profileEvidence.evidence_id, factEvidence.evidence_id] },
                { text: '续航可达到99小时。', cited_span: '电池容量 70 Wh', evidence_ids: [factEvidence.evidence_id] },
            ] }] },
        };
    };
    const result = await runProductMatch(input, { indexData: fixtureIndex(), modelRunner });
    assert.equal(result.provenance.model.status, 'called');
    assert.equal(result.verification.unsupported_claims_dropped, 1);
    assert.ok(result.candidates[0].matching_reasons.every(reason => !reason.text.includes('99小时')));
});

test('software compatibility without a verified matrix stays pending', async () => {
    const input = baseInput();
    input.profile.needs.push('软件兼容性');
    input.profile.pain_points.push('指定插件兼容性未知');
    const result = await runProductMatch(input, { indexData: fixtureIndex() });
    assert.ok(result.candidates.length >= 1);
    assert.equal(result.candidates[0].status, 'pending_confirmation');
    assert.ok(result.candidates[0].matching_reasons.every(reason => !/完全兼容|已确认兼容/.test(reason.text)));
});

test('registry canonicalizes aliases and preserves system metadata', async () => {
    const index = fixtureIndex();
    index.documents[0].product_names = ['MateBook 14 别名'];
    index.documents[1].product_names = ['MateBook 14 别名'];
    index.documents[2].product_names = ['PixLab X1'];
    const registryData = { registry_version: 'test-registry', products: [{
        product_id: 'product-abc123', canonical_name: 'HUAWEI MateBook 14（鸿蒙版）', aliases: ['MateBook 14 别名'],
        category: '消费笔记本', family: 'MateBook 14', operating_system: 'HarmonyOS', generation: '2026', evidence_status: 'verified_fact_partial', priority: true,
    }] };
    const result = await runProductMatch(baseInput(), { indexData: index, registryData });
    assert.equal(result.provenance.registry_version, 'test-registry');
    assert.equal(result.candidates[0].product_name, 'HUAWEI MateBook 14（鸿蒙版）');
    assert.equal(result.candidates[0].operating_system, 'HarmonyOS');
});

test('model reason must cite an exact span from product evidence', async () => {
    const input = baseInput(); input.use_cloud_model = true;
    const modelRunner = async (system, prompt) => {
        const payload = JSON.parse(prompt); const candidate = payload.candidates[0];
        const profileEvidence = candidate.evidence.find(item => item.source_type === 'customer_input');
        const factEvidence = candidate.evidence.find(item => item.source_level === 'E1' && item.excerpt.includes('重量'));
        return { model: 'test-model', value: { decisions: [{ candidate_id: candidate.candidate_id, reasons: [
            { text: '客户需要移动办公，候选有重量线索。', cited_span: '不存在的引文', evidence_ids: [profileEvidence.evidence_id, factEvidence.evidence_id] },
        ] }] } };
    };
    const result = await runProductMatch(input, { indexData: fixtureIndex(), modelRunner });
    assert.equal(result.verification.unsupported_claims_dropped, 1);
    assert.ok(result.candidates[0].matching_reasons.every(reason => reason.origin === 'rules'));
});

test('unknown input fields are rejected', () => {
    const input = baseInput();
    input.private_path = '/secret';
    assert.throws(() => validateProductMatchInput(input), error => error.code === 'INVALID_INPUT');
});

test('markdown includes reason limitation evidence and status', async () => {
    const result = await runProductMatch(baseInput(), { indexData: fixtureIndex() });
    const markdown = renderProductMatchMarkdown(result);
    assert.match(markdown, /匹配理由/);
    assert.match(markdown, /限制/);
    assert.match(markdown, /证据/);
    assert.match(markdown, /推荐候选|【待确认】/);
});

test('published examples are valid product-match inputs', () => {
    for (const example of productMatchExamples()) assert.doesNotThrow(() => validateProductMatchInput(example.input));
});
