#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, PipelineError, redact } = require('./support');
const { factsFromDocument, parsePriceRows, makeFact, safeSlug, writeJson, compactText } = require('./ima-evidence');

const DATA_ROOT = path.resolve(ROOT, '..', 'huawei-sales-agent-data');
const DEFAULT_CAPTURE = path.join(DATA_ROOT, 'datasets', 'ima', 'captures', 'ima-verified-capture-2026-10-21.json');

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function nowIso() { return new Date().toISOString(); }
function posixPath(value) { return String(value).split(path.sep).join('/'); }
function ensureInside(root, target) {
    const rootPath = path.resolve(root);
    const targetPath = path.resolve(target);
    if (targetPath !== rootPath && !targetPath.startsWith(rootPath + path.sep)) throw new PipelineError('IMA_OUTPUT_OUTSIDE_ALLOWED_ROOT', '输出路径越界');
    return targetPath;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function writeText(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value, 'utf8'); }

function buildReplaySource(document, product) {
    return {
        source_id: `src-ima-${document.sha256.slice(0, 12)}`,
        source_type: 'ima',
        title: document.title.slice(0, 300),
        entry: String(document.ima_entry || `ima-search:${document.title}`).slice(0, 300),
        url: document.stable_source_url || null,
        retrieved_at: document.retrieved_at,
        sha256: document.sha256,
        excerpt: compactText(document.text || document.excerpt, 1800),
        applicable_models: [product],
        ima: {
            capture_mode: document.capture_mode,
            body_status: document.body_status,
            knowledge_base_id: document.knowledge_base_id,
            media_id: document.media_id || null,
            media_type: document.media_type,
            search_query: document.search_query || null,
            local_mirror: document.local_mirror || null,
            request_ids: document.request_ids || [],
            body_path: document.body_path || null,
            text_path: document.text_path || null,
        },
    };
}

function factFromExcerpt(document, product, factId, headings, conditions) {
    const start = document.excerpt.indexOf('## ');
    if (start < 0) return null;
    const excerpt = document.excerpt.slice(start);
    const heading = headings[0];
    const marker = `## ${heading}`;
    const index = excerpt.indexOf(marker);
    if (index < 0) return null;
    let text = excerpt.slice(index + marker.length).trim();
    const next = text.indexOf('\n## ');
    if (next >= 0) text = text.slice(0, next).trim();
    if (!text) return null;
    return makeFact(factId, product, text, buildReplaySource(document, product), conditions);
}

function verifyImage(captureImage, dataRoot) {
    const file = ensureInside(dataRoot, path.join(dataRoot, captureImage.data_path));
    if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) throw new PipelineError('IMA_REPLAY_ASSET_MISSING', `图片快照不存在：${captureImage.data_path}`);
    const bytes = fs.readFileSync(file);
    const actual = sha256(bytes);
    if (actual !== captureImage.sha256) throw new PipelineError('IMA_REPLAY_HASH_MISMATCH', `图片 SHA-256 不匹配：${captureImage.title}`);
    return { bytes, actual, file, bytes_length: bytes.length };
}

function replay(args) {
    const captureFile = path.resolve(args.captureFile || DEFAULT_CAPTURE);
    const outputDir = path.resolve(args.outputDir || path.join(DATA_ROOT, 'datasets', 'ima'));
    if (outputDir !== DATA_ROOT && !outputDir.startsWith(DATA_ROOT + path.sep)) throw new PipelineError('IMA_OUTPUT_OUTSIDE_ALLOWED_ROOT', '输出必须位于 huawei-sales-agent-data/');
    const capture = readJson(captureFile);
    const index = readJson(path.join(DATA_ROOT, 'datasets', 'cleaned', 'local_kb_index.json'));
    const documentsById = new Map((index.documents || []).map(item => [item.id, item]));
    const product = capture.target.product;
    const targetDir = ensureInside(outputDir, path.join(outputDir, 'targets', safeSlug(product)));
    const generatedAt = nowIso();
    const documents = [];

    for (let indexNumber = 0; indexNumber < capture.documents.length; indexNumber += 1) {
        const record = capture.documents[indexNumber];
        const base = {
            title: record.title,
            media_id: record.media_id || null,
            parent_folder_id: record.parent_folder_id || null,
            media_type: record.media_type,
            media_type_name: record.media_type_name || 'markdown',
            knowledge_base_id: capture.knowledge_base.kb_id,
            retrieved_at: record.retrieved_at,
            request_ids: record.request_ids || [],
            search_query: record.search_query || null,
            sha256: record.content_sha256,
            excerpt: record.excerpt || '',
            stable_source_url: record.stable_source_url || null,
            capture_mode: record.capture_mode,
            body_status: record.body_status,
            local_mirror: record.local_mirror || null,
        };
        let text = record.excerpt || '';
        let bodyPath = null;
        let textPath = null;
        if (record.body_status === 'verified_full_text_hash_matched_local_mirror') {
            const mirror = documentsById.get(record.local_mirror?.document_id);
            if (!mirror) throw new PipelineError('IMA_REPLAY_MIRROR_MISSING', `本地镜像缺少文档：${record.title}`);
            text = String(mirror.text || '');
            if (sha256(Buffer.from(text, 'utf8')) !== record.content_sha256) throw new PipelineError('IMA_REPLAY_HASH_MISMATCH', `正文 SHA-256 不匹配：${record.title}`);
            const relative = path.join('sources', `${String(indexNumber + 1).padStart(3, '0')}-${safeSlug(record.title)}.md`);
            writeText(ensureInside(targetDir, path.join(targetDir, relative)), text);
            bodyPath = posixPath(relative);
            textPath = bodyPath;
        } else {
            const relative = path.join('sources', 'verified-excerpts', `${String(indexNumber + 1).padStart(3, '0')}-${safeSlug(record.title)}.txt`);
            writeText(ensureInside(targetDir, path.join(targetDir, relative)), `${record.excerpt || ''}\n`);
            bodyPath = posixPath(relative);
            textPath = null;
        }
        documents.push({ ...base, text, body_path: bodyPath, text_path: textPath });
    }

    const facts = documents.flatMap(document => factsFromDocument(document, product));
    const priceDocument = documents.find(document => /价格卡/i.test(document.title) && document.body_status === 'verified_full_text_hash_matched_local_mirror');
    const pricingRefs = priceDocument ? parsePriceRows(priceDocument, product) : [];

    const images = capture.images.map(image => {
        const verified = verifyImage(image, DATA_ROOT);
        const source = {
            source_id: `src-ima-${image.sha256.slice(0, 12)}`,
            source_type: 'ima',
            title: image.title.slice(0, 300),
            entry: `ima-media:${image.media_id}`.slice(0, 300),
            url: null,
            retrieved_at: image.retrieved_at,
            sha256: image.sha256,
            excerpt: image.title,
            applicable_models: [product],
            ima: {
                capture_mode: 'live_ima_media_info_and_content_download',
                body_status: 'binary_image_verified',
                knowledge_base_id: capture.knowledge_base.kb_id,
                media_id: image.media_id,
                media_type: 9,
                parent_folder_id: image.parent_folder_id || null,
                request_ids: image.request_ids || [],
                data_path: image.data_path,
            },
        };
        return {
            image_id: `image-ima-${image.sha256.slice(0, 16)}`,
            product,
            caption: image.title,
            usage_scope: 'internal_only',
            rights_status: 'unknown',
            source,
            applicable_models: [product],
            model_verified: false,
            content_sha256: verified.actual,
            data_path: image.data_path,
            bytes: verified.bytes_length,
            storage_status: 'reused_existing',
            sha256_verified: true,
            usable_as_verified_product_image: false,
        };
    });

    const quotaGap = `官方 IMA 接口在 ${capture.quota.observed_at} 返回 ${capture.quota.code}：${capture.quota.message}；未伪造缺失的正文、媒体 ID 或请求 ID`;
    const gaps = [
        quotaGap,
        '知识库目录仅完成根层与一个子文件夹首页探测，1519 条内容未在本会话全部枚举',
        '目标产品仅 2 份全文完成 IMA 实取哈希与本地镜像逐字节匹配；其余仅保留已验证哈希/摘录',
        '价格快照来自 2026-10-17，未核验为 2026-10-21 当前报价',
        '5 张图片仅为 IMA 搜索候选，型号、配色、SKU、画面和版权均未核验',
    ];
    const evidenceBundle = {
        schema_version: '1.0',
        bundle_id: `ima-bundle-${sha256(`${product}|${capture.capture_id}|${generatedAt}`).slice(0, 12)}`,
        generated_at: generatedAt,
        query: { product, sku: null, purpose: 'mixed', as_of: capture.target.as_of },
        facts,
        images,
        pricing_refs: pricingRefs,
        conflicts: [],
        coverage: { facts: facts.length, images: images.length, prices: pricingRefs.length, gaps },
        extensions: {
            ima: {
                capture_id: capture.capture_id,
                capture_status: capture.capture_status,
                skill_version: capture.skill_version,
                knowledge_base: capture.knowledge_base,
                capture_mode: 'live_verified_hash_matched_and_replayed',
                request_ids: capture.request_ids || {},
                quota: capture.quota,
                search_observations: capture.search_observations || [],
                directory_observations: capture.directory_observations || null,
                limitations: capture.limitations || [],
            },
        },
    };

    const imageManifest = {
        schema_version: '1.0', generated_at: generatedAt, product,
        counts: { candidates: images.length, verified_model: 0, rights_cleared: 0, readable: images.length, sha256_verified: images.length },
        images, limitations: [
            '5 张图片均为 MateBook 系列分类横幅候选，未证明对应 HUAWEI MateBook 14（鸿蒙版）具体型号',
            'model_verified=false、rights_status=unknown、usable_as_verified_product_image=false',
            '复用 data-spec 中已存在且 SHA-256 完全匹配的原始资产，没有复制第二份二进制',
        ],
    };

    const targetPackage = {
        schema_version: '1.0', generated_at: generatedAt,
        target: capture.target,
        capture: { capture_id: capture.capture_id, status: capture.capture_status, skill_version: capture.skill_version, quota: capture.quota },
        evidence_bundle_path: 'evidence-bundle.json',
        image_manifest_path: 'image-manifest.json',
        knowledge_base: capture.knowledge_base,
        search_observations: capture.search_observations || [],
        directory_observations: capture.directory_observations || null,
        documents: documents.map(document => ({
            title: document.title, media_id: document.media_id, media_type: document.media_type,
            sha256: document.sha256, retrieved_at: document.retrieved_at, capture_mode: document.capture_mode,
            body_status: document.body_status, body_path: document.body_path, local_mirror: document.local_mirror,
            applicable_models: [product], request_ids: document.request_ids,
        })),
        summary: { documents: documents.length, full_text: documents.filter(item => item.body_status === 'verified_full_text_hash_matched_local_mirror').length, excerpts_only: documents.filter(item => item.body_status !== 'verified_full_text_hash_matched_local_mirror').length, facts: facts.length, prices: pricingRefs.length, images: images.length },
        gaps,
    };

    const imaEvidenceBundle = {
        schema_version: '1.0', bundle_type: 'ima_evidence_base', generated_at: generatedAt,
        capture_id: capture.capture_id, capture_status: capture.capture_status,
        target: capture.target,
        ima_context: { skill_version: capture.skill_version, read_only: true, knowledge_base: capture.knowledge_base },
        capabilities: {
            official_skill_loaded: true,
            knowledge_base_search_live_verified: true,
            knowledge_base_detail_live_verified: true,
            directory_browse_live_verified: true,
            knowledge_search_live_verified: true,
            media_info_live_verified: true,
            body_read_live_verified: true,
            image_content_download_live_verified: true,
            complete_directory_snapshot: false,
            complete_target_corpus: false,
        },
        knowledge_bases: capture.knowledge_bases || [],
        directory_observations: capture.directory_observations || null,
        search_observations: capture.search_observations || [],
        verified_documents: documents.map(document => ({ title: document.title, sha256: document.sha256, retrieved_at: document.retrieved_at, body_status: document.body_status, body_path: document.body_path })),
        verified_images: images.map(image => ({ title: image.caption, media_id: image.source.ima.media_id, sha256: image.content_sha256, data_path: image.data_path })),
        target_package: { path: posixPath(path.relative(outputDir, path.join(targetDir, 'target-evidence-package.json'))) },
        quota: capture.quota,
        request_ids: capture.request_ids || {},
        limitations: gaps,
    };

    writeJson(path.join(outputDir, 'ima-evidence-bundle.json'), imaEvidenceBundle);
    writeJson(path.join(targetDir, 'evidence-bundle.json'), evidenceBundle);
    writeJson(path.join(targetDir, 'image-manifest.json'), imageManifest);
    writeJson(path.join(targetDir, 'target-evidence-package.json'), targetPackage);
    writeJson(path.join(targetDir, 'run-metadata.json'), { schema_version: '1.0', generated_at: generatedAt, capture_file: posixPath(path.relative(DATA_ROOT, captureFile)), request_ids: capture.request_ids || {}, quota: capture.quota });
    return { output_dir: outputDir, ima_evidence_bundle: path.join(outputDir, 'ima-evidence-bundle.json'), target_package: path.join(targetDir, 'target-evidence-package.json'), evidence_bundle: path.join(targetDir, 'evidence-bundle.json'), image_manifest: path.join(targetDir, 'image-manifest.json'), counts: { documents: documents.length, facts: facts.length, prices: pricingRefs.length, images: images.length }, gaps };
}

function parseArgs(argv) {
    const args = { captureFile: DEFAULT_CAPTURE, outputDir: path.join(DATA_ROOT, 'datasets', 'ima') };
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--capture') { args.captureFile = path.resolve(argv[index + 1]); index += 1; }
        else if (argv[index] === '--output') { args.outputDir = path.resolve(argv[index + 1]); index += 1; }
        else throw new Error(`未知参数：${argv[index]}`);
    }
    return args;
}

if (require.main === module) {
    try {
        const result = replay(parseArgs(process.argv.slice(2)));
        process.stdout.write(JSON.stringify({ status: 'ok', ...result }, null, 2) + '\n');
    } catch (error) {
        process.stderr.write(JSON.stringify({ status: 'failed', code: error.code || 'IMA_REPLAY_FAILED', message: redact(error.message || String(error)) }, null, 2) + '\n');
        process.exitCode = 1;
    }
}

module.exports = { replay, verifyImage };

