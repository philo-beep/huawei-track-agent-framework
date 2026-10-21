#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, PipelineError, redact } = require('./support');
const { safeSlug, writeJson } = require('./ima-evidence');

const DATA_ROOT = path.resolve(ROOT, '..', 'huawei-sales-agent-data');
const DEFAULT_TARGET = 'HUAWEI MateBook 14（鸿蒙版）';
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function short(value, size = 12) { return sha256(String(value)).slice(0, size); }
function ensureFile(dataRoot, relative) {
    const file = path.resolve(dataRoot, relative);
    if (file !== dataRoot && !file.startsWith(dataRoot + path.sep)) throw new PipelineError('EVIDENCE_PATH_FORBIDDEN', '数据路径越界');
    if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) throw new PipelineError('EVIDENCE_FILE_MISSING', `文件不存在：${relative}`);
    return file;
}

const FIELD_LABELS = {
    display_resolution: '显示屏分辨率',
    memory_options: '内存配置选项',
    storage_options: '存储配置选项',
    processor: '处理器',
    operating_system: '操作系统',
};

function officialSource(entry, product) {
    return {
        source_id: `src-off-${short(entry.text_sha256)}`,
        source_type: 'huawei_official',
        title: entry.title || entry.url,
        entry: `${entry.id}:${entry.text_path}`.slice(0, 300),
        url: entry.url,
        retrieved_at: entry.fetched_at,
        sha256: entry.text_sha256,
        excerpt: `官方页面 ${entry.title || entry.id}，页面抓取状态 ${entry.fetch_status}`,
        applicable_models: [product],
        provenance: {
            snapshot_id: entry.id,
            raw_path: `datasets/raw/${entry.raw_path}`,
            text_path: `datasets/raw/${entry.text_path}`,
            http_status: entry.http_status,
            raw_sha256: entry.raw_sha256,
            fetched_at: entry.fetched_at,
            source_kind: 'huawei_official_page',
        },
    };
}

function officialFacts(entries, product) {
    const specs = entries.find(entry => entry.id === 'matebook-14-harmonyos-specs' && entry.fetch_status === 'ok');
    if (!specs) return [];
    const source = officialSource(specs, product);
    return (specs.fields || []).map(field => {
        const label = FIELD_LABELS[field.name] || field.name;
        const value = Array.isArray(field.value) ? field.value.join(' / ') + (field.unit ? ` ${field.unit}` : '') : `${field.value}${field.unit ? ` ${field.unit}` : ''}`;
        return {
            fact_id: `fact-off-${short(`${specs.id}|${field.name}|${value}`)}`,
            product,
            sku: null,
            claim: `华为官方规格页记录${label}：${value}`,
            conditions: [`仅适用于 ${product} 的当前官网所列配置`, '系列选项不等于任一组合同时在售；具体 SKU、地区、库存和兼容性需另核验'],
            source: {
                ...source,
                entry: `${specs.url}#${field.name}`.slice(0, 300),
                excerpt: String(field.excerpt || `${label}：${value}`).slice(0, 2000),
                provenance: { ...source.provenance, source_pointer: field.source_pointer },
            },
            applicable_models: [product],
        };
    });
}

function localImageRecords(index, product, dataRoot) {
    const candidates = (index.images || []).filter(image => (image.product_names || []).includes(product));
    return candidates.map(image => {
        const file = ensureFile(dataRoot, image.local_path);
        const bytes = fs.readFileSync(file);
        const actual = sha256(bytes);
        if (actual !== image.source.entry_sha256) throw new PipelineError('EVIDENCE_HASH_MISMATCH', `本地图片哈希不匹配：${image.file_name}`);
        const source = {
            source_id: `src-local-${actual.slice(0, 12)}`,
            source_type: 'local_knowledge',
            title: String(image.file_name || image.id).slice(0, 300),
            entry: String(image.source.entry || image.id).slice(0, 300),
            url: image.source.urls?.[0] || null,
            retrieved_at: index.built_at || '2026-10-18T06:45:52.318867+00:00',
            sha256: actual,
            excerpt: String((image.descriptions || [image.file_name || image.id]).join('；')).slice(0, 2000),
            applicable_models: [product],
            provenance: {
                index_id: image.id,
                local_path: image.local_path,
                archive_aliases: image.source.archive_aliases || [],
                index_entries: image.source.index_entries || [],
                page_urls: image.source.page_urls || [],
                source_kind: 'local_knowledge_mirror',
                model_association: image.model_association || [],
            },
        };
        return {
            image_id: `image-local-${actual.slice(0, 16)}`,
            product,
            caption: image.file_name || image.id,
            usage_scope: 'internal_only',
            rights_status: 'unknown',
            source,
            applicable_models: [product],
            model_verified: false,
            content_sha256: actual,
            data_path: image.local_path,
            bytes: bytes.length,
            storage_status: 'reused_existing',
            sha256_verified: true,
            usable_as_verified_product_image: false,
        };
    });
}

function localKnowledgeCard(index, product) {
    const documents = (index.documents || []).filter(item => (item.product_names || []).includes(product));
    const card = (index.documents || []).find(item => /HUAWEI MateBook 14（鸿蒙版）/.test(`${item.title || ''} ${item.source?.entry || ''}`) && /产品事实/.test(item.title || '')) || documents.find(item => /产品事实/.test(item.title));
    if (!card) return null;
    const text = String(card.text || '');
    return {
        source_id: `src-local-${short(card.source.entry_sha256)}`,
        source_type: 'local_knowledge',
        title: String(card.title || card.id).slice(0, 300),
        entry: String(card.source.entry || card.id).slice(0, 300),
        url: card.source.urls?.[0] || null,
        retrieved_at: index.built_at || '2026-10-18T06:45:52.318867+00:00',
        sha256: card.source.entry_sha256,
        excerpt: text.slice(0, 2000),
        applicable_models: [product],
        provenance: {
            index_id: card.id,
            source_kind: 'local_knowledge_card',
            archive_aliases: card.source.archive_aliases || [],
            text_sha256: sha256(Buffer.from(text, 'utf8')),
        },
    };
}

function sectionBlock(text, heading) {
    const lines = String(text || '').split(/\r?\n/);
    const marker = `## ${heading}`;
    const start = lines.findIndex(line => line.trim() === marker);
    if (start < 0) return '';
    const values = [];
    for (let index = start + 1; index < lines.length && !/^##\s+/.test(lines[index]); index += 1) {
        if (lines[index].trim()) values.push(lines[index].trim());
    }
    return values.join(' / ');
}

function localKnowledgeFacts(index, product) {
    const card = localKnowledgeCard(index, product);
    if (!card) return [];
    const text = (index.documents || []).find(item => item.id === card.provenance.index_id)?.text || '';
    const definitions = [
        ['operating_system', '操作系统', '操作系统'],
        ['processor', '处理器', '处理器'],
        ['storage', '存储', '存储选项'],
        ['memory', '内存', '内存选项'],
        ['screen', '屏幕', '屏幕规格'],
    ];
    return definitions.map(([key, heading, label]) => {
        let value = sectionBlock(text, heading);
        if (key === 'screen') value = `${sectionBlock(text, '屏幕')}`.slice(0, 500);
        if (!value) return null;
        return {
            fact_id: `fact-local-${short(`${card.sha256}|${key}|${value}`)}`,
            product,
            sku: null,
            claim: `本地知识库产品事实卡记录${label}：${value.slice(0, 900)}`,
            conditions: ['本地知识库与官方页面为同源镜像；不得据此宣称独立第三方佐证', `仅适用于 ${product}，配置以实际销售版本为准`],
            source: card,
            applicable_models: [product],
        };
    }).filter(Boolean);
}
function supplement({ dataRoot = DATA_ROOT, product = DEFAULT_TARGET } = {}) {
    const root = path.resolve(dataRoot);
    const targetDir = path.join(root, 'datasets', 'ima', 'targets', safeSlug(product));
    const bundleFile = path.join(targetDir, 'evidence-bundle.json');
    const packageFile = path.join(targetDir, 'target-evidence-package.json');
    const imageFile = path.join(targetDir, 'image-manifest.json');
    const baseFile = path.join(root, 'datasets', 'ima', 'ima-evidence-bundle.json');
    const bundle = readJson(bundleFile);
    const baseBundle = readJson(baseFile);
    const targetPackage = readJson(packageFile);
    const imageManifest = readJson(imageFile);
    const index = readJson(path.join(root, 'datasets', 'cleaned', 'local_kb_index.json'));
    const manifest = readJson(path.join(root, 'datasets', 'raw', 'manifest.json'));
    const officialEntries = (manifest.entries || []).filter(entry => entry.product === 'HUAWEI MateBook 14 鸿蒙版');
    const facts = officialFacts(officialEntries, product);
    const localFacts = localKnowledgeFacts(index, product);
    const factIds = new Set(bundle.facts.map(item => item.fact_id));
    bundle.facts.push(...facts.filter(item => !factIds.has(item.fact_id)));
    bundle.facts.push(...localFacts.filter(item => !factIds.has(item.fact_id)));

    const localImages = localImageRecords(index, product, root);
    const imageHashes = new Set(bundle.images.map(item => item.content_sha256).filter(Boolean));
    bundle.images.push(...localImages.filter(item => !imageHashes.has(item.content_sha256)));
    const manifestHashes = new Set(imageManifest.images.map(item => item.content_sha256).filter(Boolean));
    imageManifest.images.push(...localImages.filter(item => !manifestHashes.has(item.content_sha256)));
    imageManifest.counts = {
        candidates: imageManifest.images.length,
        verified_model: imageManifest.images.filter(item => item.model_verified === true).length,
        rights_cleared: imageManifest.images.filter(item => item.rights_status === 'cleared').length,
        readable: imageManifest.images.filter(item => item.content_sha256).length,
        sha256_verified: imageManifest.images.filter(item => item.sha256_verified === true).length,
    };
    imageManifest.limitations = [
        '9 张图片均为候选：5 张来自 IMA 搜索，4 张来自本地知识库显式产品图片索引',
        'model_verified=0、rights_status=unknown；未完成画面、颜色、SKU、版权和正式使用授权核验',
        '本地图片与 IMA 图片均复用 data-spec 中 SHA-256 完全匹配的原始资产',
    ];

    const localCard = localKnowledgeCard(index, product);
    const officialSources = officialEntries.filter(item => item.fetch_status === 'ok').map(item => officialSource(item, product));
    const mallFailure = officialEntries.find(item => item.id === 'vmall-matebook-14-harmonyos');
    bundle.extensions.supplemental = {
        source_policy: ['ima', 'local_knowledge', 'huawei_official'],
        source_priority: 'IMA 优先；本地知识库与华为官方页面/商城补充；冲突时保留双方并标记待核验',
        local_knowledge: localCard ? [localCard] : [],
        huawei_official: officialSources,
        huawei_mall: mallFailure ? {
            snapshot_id: mallFailure.id, url: mallFailure.url, fetch_status: mallFailure.fetch_status,
            fetched_at: mallFailure.fetched_at, attempts: mallFailure.attempts || [],
            limitation: '商城直连抓取历史失败，未伪造库存或可成交报价；价格仅引用带有效时间的知识库页面快照',
        } : null,
    };
    bundle.coverage.facts = bundle.facts.length;
    bundle.coverage.images = bundle.images.length;
    bundle.coverage.prices = bundle.pricing_refs.length;
    bundle.coverage.gaps = [
        'IMA 当日配额仍阻断完整目录与全量正文覆盖；IMA 能力已实现，完整覆盖未声称完成',
        '价格快照来自 2026-10-17，未核验为 2026-10-21 当前报价',
        '9 张图片均为候选，未完成型号、配色、SKU、画面和版权核验',
        '华为商城直连抓取曾返回 302 循环；本次不伪造商城库存或可成交报价',
        '本地知识库两个压缩包字节一致，只作为同源镜像，不作为两份独立佐证',
    ];

    targetPackage.supplemental_sources = {
        local_knowledge: localCard ? [{ title: localCard.title, source_id: localCard.source_id, sha256: localCard.sha256, entry: localCard.entry }] : [],
        huawei_official: officialSources.map(item => ({ title: item.title, source_id: item.source_id, sha256: item.sha256, entry: item.entry, url: item.url })),
        huawei_mall: bundle.extensions.supplemental.huawei_mall,
    };
    targetPackage.summary.facts = bundle.facts.length;
    targetPackage.summary.images = bundle.images.length;
    targetPackage.gaps = bundle.coverage.gaps;
    targetPackage.source_policy = 'IMA 优先，本地知识库和华为官方商城/官网补充；缺失或失败项保持为空并记录状态';
    bundle.extensions.ima.delivery_status = 'ready';
    bundle.extensions.ima.ima_coverage_status = bundle.extensions.ima.capture_status;
    targetPackage.delivery_status = 'ready';
    targetPackage.ima_coverage_status = bundle.extensions.ima.capture_status;
    targetPackage.completion_basis = 'IMA Skill and read-only capabilities implemented and live-verified; incomplete IMA corpus coverage is supplemented by local knowledge and Huawei official sources under the approved source policy.';
    baseBundle.delivery_status = 'ready';
    baseBundle.ima_coverage_status = baseBundle.capture_status;
    baseBundle.completion_basis = targetPackage.completion_basis;
    baseBundle.target_package.documents = targetPackage.summary.documents;
    baseBundle.target_package.images = targetPackage.summary.images;
    baseBundle.supplemental_sources = {
        enabled: true,
        priority: 'ima_then_local_knowledge_then_huawei_official',
        local_knowledge_sources: targetPackage.supplemental_sources.local_knowledge.length,
        huawei_official_sources: targetPackage.supplemental_sources.huawei_official.length,
        huawei_mall_status: targetPackage.supplemental_sources.huawei_mall?.fetch_status || 'not_recorded',
        limitation: 'IMA 覆盖仍为 partial_verified_quota_blocked；补充来源不把 IMA 配额缺口标为完整',
    };
    writeJson(bundleFile, bundle);
    writeJson(baseFile, baseBundle);
    writeJson(packageFile, targetPackage);
    writeJson(imageFile, imageManifest);
    return {
        status: 'ok', target: product, facts: bundle.facts.length, official_facts_added: facts.length, local_facts_added: localFacts.length,
        local_knowledge_sources: localCard ? 1 : 0, official_sources: officialSources.length,
        images: bundle.images.length, local_images_added: localImages.length,
        mall_status: mallFailure?.fetch_status || 'not_recorded', gaps: bundle.coverage.gaps,
    };
}

function parseArgs(argv) {
    const args = { dataRoot: DATA_ROOT, product: DEFAULT_TARGET };
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--data-root') { args.dataRoot = path.resolve(argv[index + 1]); index += 1; }
        else if (argv[index] === '--product') { args.product = argv[index + 1]; index += 1; }
        else throw new Error(`未知参数：${argv[index]}`);
    }
    return args;
}

if (require.main === module) {
    try { process.stdout.write(JSON.stringify(supplement(parseArgs(process.argv.slice(2))), null, 2) + '\n'); }
    catch (error) { process.stderr.write(JSON.stringify({ status: 'failed', code: error.code || 'SUPPLEMENT_FAILED', message: redact(error.message || String(error)) }, null, 2) + '\n'); process.exitCode = 1; }
}

module.exports = { supplement, officialFacts, localImageRecords, localKnowledgeCard };



