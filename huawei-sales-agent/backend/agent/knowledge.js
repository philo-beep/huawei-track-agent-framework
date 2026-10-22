'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ROOT, PipelineError } = require('./support');

const DATA_ROOT = path.resolve(ROOT, '..', 'huawei-sales-agent-data');
const INDEX_PATH = path.join(DATA_ROOT, 'datasets', 'cleaned', 'local_kb_index.json');
const PRODUCT_ALIASES = Object.freeze({
    'matebook14鸿蒙版': ['matebook14鸿蒙版'],
    'matebook142024': ['matebook14酷睿ultra'],
});

function normalizeProduct(value) {
    return String(value).toLowerCase().replace(/^huawei\s*/i, '').replace(/[\s\-()（）]/g, '');
}

function productMatches(document, product) {
    const names = [
        ...(document.product_names || []),
        document.raw_fields?.['规范产品名称'],
        document.raw_fields?.['原始产品名称'],
    ].filter(Boolean);
    if (names.some(name => normalizeProduct(name) === normalizeProduct(product))) return true;
    const hint = PRODUCT_ALIASES[normalizeProduct(product)] || [];
    const haystack = normalizeProduct(`${document.title || ''} ${names.join(' ')}`);
    return hint.some(alias => haystack.includes(normalizeProduct(alias)));
}

// 模块1：本地离线资料适配，不产生任何 ima ID。
async function localKnowledge(product) {
    try {
        if (!fs.existsSync(INDEX_PATH) || fs.lstatSync(INDEX_PATH).isSymbolicLink()) throw new PipelineError('KNOWLEDGE_NOT_FOUND', '本地知识库索引不存在或为符号链接');
        const data = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8').replace(/^\uFEFF/, ''));
        const documents = (data.documents || []).filter(document => productMatches(document, product));
        const imageCandidates = (data.images || []).filter(image => productMatches(image, product));
        const priceRecords = (data.price_records || []).filter(record => productMatches(record, product));
        if (!documents.length) throw new PipelineError('KNOWLEDGE_NOT_FOUND', '本地知识库未找到该代际型号资料，不以近似型号替代');
        return {
            status: 'ok',
            product,
            knowledge_status: data.knowledge_status,
            built_at: data.built_at,
            source_archives: data.source_archives || [],
            documents,
            image_candidates: imageCandidates,
            price_records: priceRecords,
            pricing_rules: data.pricing_rules || [],
            source_mode: 'local_zip',
        };
    } catch (error) {
        if (error instanceof PipelineError) throw error;
        throw new PipelineError('KNOWLEDGE_NOT_FOUND', '本地知识库索引不可读或结构异常；未生成事实');
    }
}

function assertNoSourceConflict(documents, product) {
    const relevant = documents.filter(document => (document.kind === 'product_fact' || document.kind === 'product_catalog') && (!document.product_names?.length || document.product_names.some(name => normalizeProduct(name) === normalizeProduct(product))));
    const statements = new Map();
    for (const document of relevant) {
        for (const section of String(document.text || '').split(/(?=^## )/m)) {
            const match = section.match(/^##\s+([^\n]+)[\s\S]*?\n(?:[^\n]*\n){0,3}([^\n]{2,160})/m);
            if (!match) continue;
            const key = match[1].trim();
            const value = section.replace(/\s+/g, ' ').trim();
            const prior = statements.get(key);
            if (prior && prior.value !== value) throw new PipelineError('SOURCE_CONFLICT', `同一型号资料的“${key}”字段在多份原文中不一致，已停止生成并待人工确认`);
            statements.set(key, { value, title: document.title });
        }
    }
}

function sourceReference(document, excerpt) {
    const source = document.source || {};
    const aliases = [...(source.archive_aliases || [])].sort((first, second) => Number(second.includes('任德耀')) - Number(first.includes('任德耀')));
    return { title: document.title || source.entry, archive_aliases: aliases, entry: source.entry || document.title, entry_sha256: source.entry_sha256 || null, urls: source.urls || [], excerpt };
}

// 模块4：保留完整章节和全文限制，避免把脚注拆掉后形成更强承诺。
function extractFacts(knowledge, product, options = {}) {
    if (knowledge.source_mode === 'official_snapshot') {
        const facts = [];
        for (const document of knowledge.documents) for (const field of document.official_fields || []) {
            if (!document.text.includes(field.excerpt)) throw new PipelineError('FACT_VERIFICATION_FAILED', '官网字段摘录无法定位已核验原文');
            const claim = field.excerpt;
            const conditions = field.excerpt.split('\n').filter(line => /^(?:>|\*)/.test(line) && line.trim().length > 2);
            if (!facts.some(fact => fact.claim === claim)) facts.push({ id: `official-${facts.length + 1}-${crypto.createHash('sha256').update(claim).digest('hex').slice(0, 8)}`, product, claim, conditions, source_refs: [sourceReference(document, document.text)] });
        }
        if (!facts.length) throw new PipelineError('KNOWLEDGE_NOT_FOUND', '官网没有经过逐字段原文定位的参数');
        return facts.slice(0, options.maxFacts || 4);
    }
    const documents = knowledge.documents.filter(document => document.kind === 'product_fact' || knowledge.source_mode === 'ima');
    assertNoSourceConflict(knowledge.documents, product);
    const primary = documents[0];
    if (!primary || typeof primary.text !== 'string' || !primary.text.trim()) throw new PipelineError('KNOWLEDGE_NOT_FOUND', '没有可回溯的产品原文，不能使用检索高亮作为事实');
    if (primary.product_names?.length && !productMatches(primary, product)) throw new PipelineError('SOURCE_CONFLICT', '原文关联型号与目标型号不同');
    const sections = primary.text.split(/(?=^## )/m).filter(section => /^## (?:操作系统|尺寸|屏幕|处理器|存储|内存|连接|电池)/.test(section));
    const globalLimits = primary.text.split(/^## /m)[0].split('\n').filter(line => /^>/.test(line) && line.trim().length > 2);
    const selected = sections.filter(section => section.length < 2200).slice(0, options.maxFacts || 4);
    if (!selected.length) selected.push(primary.text);
    return selected.map((section, index) => {
        const claim = section.trim();
        const conditions = [...new Set([...globalLimits, ...section.split('\n').filter(line => /^(?:>|\*)/.test(line) && line.trim().length > 2)])];
        if (!primary.text.includes(claim)) throw new PipelineError('FACT_VERIFICATION_FAILED', '事实片段无法定位原文');
        return { id: `fact-${index + 1}-${crypto.createHash('sha256').update(claim).digest('hex').slice(0, 8)}`, product, claim, conditions, source_refs: [sourceReference(primary, primary.text)] };
    });
}

function imageCandidates(knowledge, product) {
    return (knowledge.image_candidates || []).filter(image => image.product_names?.some(name => normalizeProduct(name) === normalizeProduct(product))).slice(0, 6).map(image => ({
        name: image.file_name, product, source_refs: [sourceReference({ title: image.file_name, source: image.source }, image.descriptions?.join('；') || '产品目录关联候选，待视觉、SKU与版权核验')],
        position: '候选：人工核验后确定插入位置', caption: image.descriptions?.join('；') || '待核验候选图片', model_verified: false, local_path: image.local_path || null,
    }));
}

module.exports = { localKnowledge, extractFacts, imageCandidates, sourceReference, normalizeProduct, productMatches };
