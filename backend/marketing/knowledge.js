'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { ROOT, PipelineError } = require('./support');
const execute = promisify(execFile);

function normalizeProduct(value) {
    return String(value).toLowerCase().replace(/^huawei\s*/i, '').replace(/[\s\-()（）]/g, '');
}

// 模块1：本地离线资料适配，不产生任何 ima ID。
async function localKnowledge(product) {
    try {
        const result = await execute('python', [path.join(ROOT, 'data/build_local_index.py'), 'query', '--product', product], { cwd: ROOT, timeout: 20000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } });
        const data = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
        if (data.status === 'not_found' || !data.documents?.length) throw new PipelineError('KNOWLEDGE_NOT_FOUND', '本地知识库未找到该精确型号资料，不以近似型号替代');
        return { ...data, source_mode: 'local_zip' };
    } catch (error) {
        if (error instanceof PipelineError) throw error;
        throw new PipelineError('KNOWLEDGE_NOT_FOUND', '本地知识库索引不可用；请由数据维护者检查索引与原ZIP，未生成事实');
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
function extractFacts(knowledge, product) {
    if (knowledge.source_mode === 'official_snapshot') {
        const facts = [];
        for (const document of knowledge.documents) for (const field of document.official_fields || []) {
            if (!document.text.includes(field.excerpt)) throw new PipelineError('FACT_VERIFICATION_FAILED', '官网字段摘录无法定位已核验原文');
            const claim = field.excerpt;
            const conditions = field.excerpt.split('\n').filter(line => /^(?:>|\*)/.test(line) && line.trim().length > 2);
            if (!facts.some(fact => fact.claim === claim)) facts.push({ id: `official-${facts.length + 1}-${crypto.createHash('sha256').update(claim).digest('hex').slice(0, 8)}`, product, claim, conditions, source_refs: [sourceReference(document, document.text)] });
        }
        if (!facts.length) throw new PipelineError('KNOWLEDGE_NOT_FOUND', '官网没有经过逐字段原文定位的参数');
        return facts.slice(0, 4);
    }
    const documents = knowledge.documents.filter(document => document.kind === 'product_fact' || knowledge.source_mode === 'ima');
    assertNoSourceConflict(knowledge.documents, product);
    const primary = documents[0];
    if (!primary || typeof primary.text !== 'string' || !primary.text.trim()) throw new PipelineError('KNOWLEDGE_NOT_FOUND', '没有可回溯的产品原文，不能使用检索高亮作为事实');
    if (primary.product_names?.length && !primary.product_names.some(name => normalizeProduct(name) === normalizeProduct(product))) throw new PipelineError('SOURCE_CONFLICT', '原文关联型号与目标型号不同');
    const sections = primary.text.split(/(?=^## )/m).filter(section => /^## (?:操作系统|尺寸|屏幕|处理器|存储|内存|连接|电池)/.test(section));
    const globalLimits = primary.text.split(/^## /m)[0].split('\n').filter(line => /^>/.test(line) && line.trim().length > 2);
    const selected = sections.filter(section => section.length < 2200).slice(0, 4);
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

module.exports = { localKnowledge, extractFacts, imageCandidates, sourceReference, normalizeProduct };
