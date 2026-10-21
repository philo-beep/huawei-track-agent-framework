'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PipelineError } = require('./support');
const { SKILL_VERSION, searchKnowledgeBase, getKnowledgeBase, getKnowledgeList, searchKnowledge, getMediaInfo, getNoteContent } = require('./ima');

const MEDIA_TYPES = {
    1: { name: 'pdf', extension: '.pdf', mime: 'application/pdf', readable: true },
    2: { name: 'web_page', extension: '.html', mime: 'text/html', readable: true },
    3: { name: 'word', extension: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', readable: true },
    4: { name: 'presentation', extension: '.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', readable: true },
    5: { name: 'spreadsheet', extension: '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', readable: true },
    6: { name: 'wechat_article', extension: '.html', mime: 'text/html', readable: true },
    7: { name: 'markdown', extension: '.md', mime: 'text/markdown', readable: true },
    9: { name: 'image', extension: '', mime: '', readable: false },
    11: { name: 'note', extension: '.txt', mime: 'text/plain', readable: true },
    12: { name: 'ai_session', extension: '.json', mime: 'application/json', readable: true },
    13: { name: 'text', extension: '.txt', mime: 'text/plain', readable: true },
    14: { name: 'xmind', extension: '.xmind', mime: 'application/zip', readable: false },
    15: { name: 'audio', extension: '', mime: '', readable: false },
    16: { name: 'video', extension: '', mime: '', readable: false },
    20: { name: 'html', extension: '.html', mime: 'text/html', readable: true },
    21: { name: 'epub', extension: '.epub', mime: 'application/epub+zip', readable: false },
    99: { name: 'folder', extension: '', mime: '', readable: false },
};

const MIME_EXTENSIONS = new Map([
    ['text/markdown', '.md'], ['text/x-markdown', '.md'], ['text/plain', '.txt'],
    ['text/html', '.html'], ['application/pdf', '.pdf'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
    ['application/msword', '.doc'], ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
    ['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/webp', '.webp'],
]);

function nowIso() { return new Date().toISOString(); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function shortHash(value) { return sha256(value).slice(0, 12); }
function asDate(value) { return String(value || '').slice(0, 10); }
function safeSlug(value, fallback = 'item') {
    const slug = String(value || '')
        .normalize('NFKC')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[ .-]+|[ .-]+$/g, '')
        .slice(0, 96);
    return slug || fallback;
}
function posixPath(value) { return String(value).split(path.sep).join('/'); }
function ensureInside(root, target) {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(target);
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
        throw new PipelineError('IMA_OUTPUT_OUTSIDE_ALLOWED_ROOT', '输出路径越界，拒绝写入');
    }
    return resolved;
}
function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
function mediaTypeInfo(mediaType, contentType = '') {
    const base = MEDIA_TYPES[Number(mediaType)] || { name: 'unknown', extension: '', mime: '', readable: false };
    const mime = String(contentType || base.mime || '').split(';')[0].trim().toLowerCase();
    return { ...base, mime: mime || base.mime };
}
function inferExtension(mediaType, contentType, title) {
    const info = mediaTypeInfo(mediaType, contentType);
    if (info.extension) return info.extension;
    const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
    if (MIME_EXTENSIONS.has(mime)) return MIME_EXTENSIONS.get(mime);
    const suffix = path.extname(String(title || '')).toLowerCase();
    return /^[.][a-z0-9]{1,8}$/.test(suffix) ? suffix : '.bin';
}
function normalizeResults(results) {
    const seen = new Set();
    const entries = [];
    for (const result of results.flat()) {
        if (!result?.media_id || seen.has(result.media_id)) continue;
        seen.add(result.media_id);
        entries.push(result);
    }
    return entries;
}

async function browseKnowledgeBase({ knowledgeBaseId, maxDepth = 8, maxItems = 2500, pageSize = 50, client = { getKnowledgeList } } = {}) {
    const entries = [];
    const requestIds = [];
    const visitedFolders = new Set();
    let folders = 0;
    let truncated = false;

    async function walk(folderId, parentPath, depth) {
        if (depth > maxDepth || entries.length >= maxItems) { truncated = true; return; }
        if (folderId && visitedFolders.has(folderId)) return;
        if (folderId) visitedFolders.add(folderId);
        let cursor = '';
        do {
            if (entries.length >= maxItems) { truncated = true; break; }
            const page = await client.getKnowledgeList({ knowledgeBaseId, folderId, cursor, limit: pageSize });
            requestIds.push(...page.request_ids);
            for (const item of page.knowledge_list || []) {
                if (entries.length >= maxItems) { truncated = true; break; }
                const isFolder = Number(item.media_type) === 99 || String(item.media_id || '').startsWith('folder_');
                const title = String(item.title || item.name || item.media_id || '未命名条目');
                const currentPath = [...parentPath, title];
                const record = {
                    entry_id: item.media_id || item.folder_id || null,
                    title,
                    media_type: Number(item.media_type) || (isFolder ? 99 : null),
                    media_type_name: mediaTypeInfo(item.media_type).name,
                    parent_folder_id: item.parent_folder_id || null,
                    path: currentPath,
                    is_folder: isFolder,
                };
                entries.push(record);
                if (isFolder) {
                    folders += 1;
                    await walk(item.media_id || item.folder_id, currentPath, depth + 1);
                }
            }
            if (page.is_end || !page.next_cursor || page.next_cursor === cursor) break;
            cursor = page.next_cursor;
        } while (true);
    }

    await walk('', [], 0);
    return {
        knowledge_base_id: knowledgeBaseId,
        request_ids: [...new Set(requestIds)],
        entries,
        counts: { entries: entries.length, files: entries.filter(item => !item.is_folder).length, folders, truncated },
        visited_folders: [...visitedFolders],
    };
}

async function fetchMediaBytes(mediaInfo, { maxBytes = 120_000_000 } = {}) {
    const url = mediaInfo?.url_info?.url;
    if (!url) return null;
    let parsed;
    try { parsed = new URL(url); } catch { throw new PipelineError('IMA_MEDIA_URL_INVALID', 'IMA 媒体访问链接无效'); }
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new PipelineError('IMA_MEDIA_URL_INVALID', 'IMA 媒体访问链接协议不受支持');
    const response = await fetch(parsed, {
        headers: mediaInfo.url_info.headers || {},
        redirect: 'follow',
        signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new PipelineError('IMA_MEDIA_FETCH_FAILED', `IMA 媒体原文返回 HTTP ${response.status}`, response.status === 429 || response.status >= 500);
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > maxBytes) throw new PipelineError('IMA_MEDIA_TOO_LARGE', 'IMA 媒体原文超过大小限制');
    const chunks = [];
    let total = 0;
    if (response.body) {
        const reader = response.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) throw new PipelineError('IMA_MEDIA_TOO_LARGE', 'IMA 媒体原文超过大小限制');
            chunks.push(Buffer.from(value));
        }
    } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        total = buffer.length;
        chunks.push(buffer);
    }
    return {
        bytes: Buffer.concat(chunks),
        host: parsed.host,
        url_sha256: sha256(url),
        content_type: response.headers.get('content-type') || '',
        content_length: total,
        etag: response.headers.get('etag') || null,
        last_modified: response.headers.get('last-modified') || null,
        content_disposition: response.headers.get('content-disposition') || null,
    };
}

function extractText(file, mimeType) {
    const helper = path.join(__dirname, 'ima_extract.py');
    const result = spawnSync(process.env.PYTHON || 'python', [helper, file, '--mime-type', mimeType || 'application/octet-stream'], {
        encoding: 'utf8', timeout: 120_000, windowsHide: true,
    });
    if (result.error) return { status: 'failed', error: result.error.message, text: '', char_count: 0, truncated: false };
    try {
        return JSON.parse(result.stdout || '{}');
    } catch {
        return { status: 'failed', error: String(result.stderr || '正文提取器返回无效 JSON').slice(0, 500), text: '', char_count: 0, truncated: false };
    }
}

async function readMediaSnapshot({ item, targetDir, targetModels, index = 1, maxBytes = 120_000_000 }) {
    const retrievedAt = nowIso();
    const media = await getMediaInfo(item.media_id);
    const requestIds = [media.request_id].filter(Boolean);
    const base = {
        media_id: item.media_id,
        title: item.title || item.media_id,
        parent_folder_id: item.parent_folder_id || null,
        media_type: media.media_type,
        media_type_name: mediaTypeInfo(media.media_type).name,
        retrieved_at: retrievedAt,
        request_ids: requestIds,
        applicable_models: targetModels,
        model_verified: false,
        source_url: null,
        url_host: null,
        url_sha256: null,
        content_type: null,
        content_length: 0,
        etag: null,
        last_modified: null,
        content_disposition: null,
        sha256: null,
        body_path: null,
        text_path: null,
        extraction: { status: 'not_attempted', extractor: null, char_count: 0, truncated: false },
        body_status: 'not_read',
    };

    if (media.media_type === 11 && media.notebook_ext_info?.notebook_id) {
        const note = await getNoteContent(media.notebook_ext_info.notebook_id);
        requestIds.push(note.request_id);
        const bytes = Buffer.from(note.content, 'utf8');
        const relative = path.join('sources', `${String(index).padStart(3, '0')}-${safeSlug(item.title)}.txt`);
        const file = ensureInside(targetDir, path.join(targetDir, relative));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, bytes);
        return {
            ...base,
            request_ids: [...new Set(requestIds)],
            content_type: 'text/plain; charset=utf-8',
            content_length: bytes.length,
            sha256: sha256(bytes),
            body_path: posixPath(relative),
            text_path: posixPath(relative),
            extraction: { status: 'ok', extractor: 'ima-get_doc_content', char_count: note.content.length, truncated: false },
            body_status: 'note_text',
            text: note.content,
            note_id: media.notebook_ext_info.notebook_id,
        };
    }

    if (!media.url_info?.url) {
        return { ...base, role: 'document', body_status: media.media_type === 11 ? 'note_content_unavailable' : 'inaccessible', text: '' };
    }

    const fetched = await fetchMediaBytes(media, { maxBytes });
    const extension = inferExtension(media.media_type, fetched.content_type, item.title);
    const relative = path.join('sources', `${String(index).padStart(3, '0')}-${safeSlug(item.title)}${extension}`);
    const file = ensureInside(targetDir, path.join(targetDir, relative));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, fetched.bytes);
    let extraction = { status: 'binary_only', extractor: null, text: '', char_count: 0, truncated: false };
    if (media.media_type !== 9) extraction = extractText(file, fetched.content_type);
    let textPath = null;
    if (extraction.status === 'ok') {
        const textRelative = path.join('sources', 'text', `${String(index).padStart(3, '0')}-${safeSlug(item.title)}.txt`);
        const textFile = ensureInside(targetDir, path.join(targetDir, textRelative));
        fs.mkdirSync(path.dirname(textFile), { recursive: true });
        fs.writeFileSync(textFile, extraction.text, 'utf8');
        textPath = posixPath(textRelative);
    }
    return {
        ...base,
        role: media.media_type === 9 ? 'image' : 'document',
        url_host: fetched.host,
        url_sha256: fetched.url_sha256,
        content_type: fetched.content_type,
        content_length: fetched.content_length,
        etag: fetched.etag,
        last_modified: fetched.last_modified,
        content_disposition: fetched.content_disposition,
        sha256: sha256(fetched.bytes),
        body_path: posixPath(relative),
        text_path: textPath,
        extraction: { ...extraction, text: undefined },
        body_status: extraction.status === 'ok' ? 'text_extracted' : extraction.status,
        text: extraction.text || '',
    };
}

function extractSection(markdown, headings) {
    const wanted = headings.map(value => value.toLowerCase());
    const lines = String(markdown || '').split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const match = /^(#{2,4})\s+(.+?)\s*$/.exec(lines[index]);
        if (!match || !wanted.includes(match[2].trim().toLowerCase())) continue;
        const level = match[1].length;
        const output = [];
        for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
            const next = /^(#{1,4})\s+/.exec(lines[cursor]);
            if (next && next[1].length <= level) break;
            output.push(lines[cursor]);
        }
        return output.join('\n').trim();
    }
    return '';
}

function compactText(value, max = 900) {
    const text = String(value || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

function extractStableUrl(text) {
    const matches = String(text || '').match(/https?:\/\/[^\s)\]>"']+/g) || [];
    return matches.find(url => /consumer\.huawei\.com|vmall\.com|xinhuanet\.com/i.test(url))?.replace(/[.,;，。；]+$/, '').slice(0, 480) || null;
}

function buildSource(document, product) {
    return {
        source_id: `src-ima-${document.sha256.slice(0, 12)}`,
        source_type: 'ima',
        title: document.title.slice(0, 300),
        entry: `ima-media:${document.media_id}`.slice(0, 300),
        url: extractStableUrl(document.text),
        retrieved_at: document.retrieved_at,
        sha256: document.sha256,
        excerpt: compactText(document.text, 1800),
        applicable_models: [product],
        ima: {
            skill_version: SKILL_VERSION,
            knowledge_base_id: document.knowledge_base_id,
            media_id: document.media_id,
            media_type: document.media_type,
            parent_folder_id: document.parent_folder_id || null,
            body_path: document.body_path,
            text_path: document.text_path,
            request_ids: document.request_ids,
            url_host: document.url_host || null,
            url_sha256: document.url_sha256 || null,
        },
    };
}

function makeFact(id, product, claim, source, conditions = []) {
    return {
        fact_id: `fact-${id}-${shortHash(`${claim}|${source.source_id}`)}`,
        product,
        sku: null,
        claim: compactText(claim, 1000),
        conditions,
        source,
        applicable_models: [product],
    };
}

function parsePriceRows(document, product) {
    const lines = String(document.text || '').split(/\r?\n/);
    const rows = [];
    for (const line of lines) {
        const parts = line.split('|').map(part => part.trim());
        if (parts.length < 10 || !/^20\d\d-\d\d-\d\dT/.test(parts[1] || '') || !/¥\s*[\d,]+/.test(parts[4] || '')) continue;
        const amount = Number((parts[4].match(/¥\s*([\d,]+)/) || [])[1]?.replace(/,/g, ''));
        if (!Number.isInteger(amount)) continue;
        const kindText = parts[3] || '';
        const priceKind = /起价/.test(kindText) ? 'starting_price' : /页面价|活动页价|参考价/.test(kindText) ? 'promotion_price' : 'list_price';
        const link = String(parts[8] || '').match(/\((https?:\/\/[^)]+)\)/)?.[1] || null;
        rows.push({
            price_id: `price-ima-${shortHash(`${document.media_id}|${parts[1]}|${parts[2]}|${amount}`)}`,
            product,
            sku: compactText(parts[2] || '未标注精确款式', 160),
            observed_price_cents: amount * 100,
            currency: 'CNY',
            price_kind: priceKind,
            tax_included: false,
            region: '中国大陆',
            channel: /vmall/i.test(link || '') ? '华为商城' : '华为官网',
            effective_from: asDate(parts[1]),
            effective_to: null,
            verification: 'unverified',
            limitations: [
                '来自 2026-10-17 知识库页面快照，不是 2026-10-21 当前成交价',
                '未在本次证据构建中重新核验库存、结算页和区域资格',
                '税含口径需以结算页为准',
            ],
            source: {
                ...buildSource(document, product),
                url: link,
                excerpt: compactText(line, 1800),
            },
        });
        if (rows.length >= 12) break;
    }
    return rows;
}

function factsFromDocument(document, product) {
    const facts = [];
    const source = buildSource(document, product);
    const title = document.title;
    const modelCondition = `仅适用于 ${product}；同系列其他处理器、屏幕、系统版本或 SKU 不得继承`;
    if (/02-HUAWEI MateBook 14（鸿蒙版）/i.test(title)) {
        const positioning = extractSection(document.text, ['官网公开定位摘要']);
        if (positioning) facts.push(makeFact('positioning', product, `官方公开定位摘要：${compactText(positioning, 700)}`, source, [modelCondition, '来源为知识库条目中的 2026-10-17 页面摘录']));
    }
    if (/价格卡/i.test(title)) {
        const identity = extractSection(document.text, ['产品身份与官方定位']);
        const productLine = identity.split(/\r?\n/).find(line => /规范产品名/.test(line));
        const categoryLine = identity.split(/\r?\n/).find(line => /产品分类/.test(line));
        if (productLine || categoryLine) facts.push(makeFact('identity', product, `官方价格卡记录：${[productLine, categoryLine].filter(Boolean).join('；')}`, source, [modelCondition, '价格卡内容是历史快照，不代表当前价格仍然有效']));
    }
    if (/鸿蒙版与Windows版区别/i.test(title)) {
        const conclusion = extractSection(document.text, ['简短结论']);
        if (conclusion) facts.push(makeFact('os-boundary', product, compactText(conclusion, 900), source, ['用于鸿蒙版与 Windows 版的分流判断', '不替代具体软件、插件、外设和企业管理策略的兼容性核验']));
    }
    if (/MateBook 14 鸿蒙版销售配置/i.test(title)) {
        const snapshot = document.text.match(/抓取日期[:：]\s*\*\*?(\d{4}-\d{2}-\d{2})/)?.[1] || null;
        const config = extractSection(document.text, ['商城可见配置文本', '当时页面基础信息']);
        if (config) facts.push(makeFact('sales-config', product, `销售配置快照${snapshot ? `（${snapshot}）` : ''}：${compactText(config, 850)}`, source, ['仅代表当时页面可见配置，不等于当前可售组合或库存', modelCondition]));
        const capacity = [...new Set((document.text.match(/\b(?:16|24|32)GB\s*\/\s*(?:512GB|1TB)\b/gi) || []).map(value => value.replace(/\s+/g, '')))];
        if (capacity.length) facts.push(makeFact('capacity', product, `知识库销售配置出现容量文本：${capacity.join('、')}`, source, ['容量文本必须与处理器、屏幕版本、颜色和具体 SKU 一并引用', modelCondition]));
    }
    return facts;
}

async function collectSearchResults({ queries, knowledgeBaseId }) {
    const runs = [];
    const all = [];
    for (const query of queries) {
        const result = await searchKnowledge(query, { knowledgeBaseId });
        runs.push({ query, count: result.info_list.length, request_ids: result.request_ids });
        all.push(result.info_list);
    }
    return { runs, results: normalizeResults(all) };
}

async function buildImageManifest({ images, targetDir, product, assetReuseDir, dataRoot }) {
    const records = [];
    for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        try {
            const snapshot = await readMediaSnapshot({ item: image, targetDir, targetModels: [product], index: index + 1 });
            let dataPath = null;
            let storageStatus = 'unavailable';
            if (snapshot.sha256) {
                const extension = inferExtension(image.media_type, snapshot.content_type, image.title);
                const reusable = assetReuseDir ? path.join(assetReuseDir, `${snapshot.sha256}${extension}`) : null;
                if (reusable && fs.existsSync(reusable) && !fs.lstatSync(reusable).isSymbolicLink()) {
                    dataPath = posixPath(path.relative(dataRoot, reusable));
                    storageStatus = 'reused_existing';
                } else if (snapshot.body_path) {
                    dataPath = posixPath(path.relative(dataRoot, path.join(targetDir, snapshot.body_path)));
                    storageStatus = 'downloaded';
                }
            }
            records.push({
                image_id: `image-ima-${snapshot.sha256 ? snapshot.sha256.slice(0, 16) : shortHash(image.media_id)}`,
                title: image.title,
                media_id: image.media_id,
                parent_folder_id: image.parent_folder_id || null,
                media_type: snapshot.media_type,
                content_type: snapshot.content_type,
                bytes: snapshot.content_length,
                sha256: snapshot.sha256,
                data_path: dataPath,
                storage_status: storageStatus,
                retrieved_at: snapshot.retrieved_at,
                request_ids: snapshot.request_ids,
                applicable_models: [product],
                caption: image.title,
                usage_scope: 'internal_only',
                rights_status: 'unknown',
                model_verified: false,
                usable_as_verified_product_image: false,
                source: buildSource({ ...snapshot, knowledge_base_id: image.knowledge_base_id, text: snapshot.text || image.title }, product),
            });
        } catch (error) {
            records.push({
                image_id: `image-ima-${shortHash(image.media_id)}`, title: image.title, media_id: image.media_id,
                error_code: error.code || 'IMA_IMAGE_READ_FAILED', error_message: String(error.message || error).slice(0, 300),
                model_verified: false, rights_status: 'unknown', usable_as_verified_product_image: false,
            });
        }
    }
    return {
        schema_version: '1.0',
        generated_at: nowIso(),
        product,
        counts: {
            candidates: records.length,
            verified_model: records.filter(item => item.model_verified === true).length,
            rights_cleared: records.filter(item => item.rights_status === 'cleared').length,
            readable: records.filter(item => item.sha256).length,
        },
        images: records,
        limitations: [
            'IMA 搜索命中的图片仅为候选，未完成型号、配色、SKU、画面和版权逐图核验',
            'model_verified=false，不代表可作为正式产品配图',
            '未将视频封面、合成图或非目标型号图片升级为事实证据',
        ],
    };
}

async function generateImaEvidenceBase(options) {
    const {
        product,
        aliases = [],
        modelPattern,
        queries,
        outputDir,
        knowledgeBaseId,
        knowledgeBaseName,
        asOf,
        maxTreeDepth = 8,
        maxTreeItems = 2500,
        assetReuseDir = null,
        downloadImages = true,
    } = options;
    if (!product || !modelPattern || !outputDir) throw new PipelineError('IMA_EVIDENCE_INPUT_INVALID', '构建证据包需要 product、modelPattern 和 outputDir');
    const generatedAt = nowIso();
    const kbSearch = await searchKnowledgeBase(knowledgeBaseName || product, { limit: 20 });
    const selectedKb = knowledgeBaseId
        ? (kbSearch.info_list.find(item => item.kb_id === knowledgeBaseId) || { kb_id: knowledgeBaseId, kb_name: knowledgeBaseName || '已配置知识库' })
        : (kbSearch.info_list.find(item => item.kb_name === knowledgeBaseName) || kbSearch.info_list.find(item => /任德耀|华为|MateBook/i.test(`${item.kb_name} ${item.description}`)) || kbSearch.info_list[0]);
    if (!selectedKb) throw new PipelineError('IMA_KB_NOT_FOUND', '未找到可使用的 IMA 知识库');
    const kbDetails = await getKnowledgeBase([selectedKb.kb_id]);
    const kb = kbDetails.infos[selectedKb.kb_id] || selectedKb;

    const tree = await browseKnowledgeBase({ knowledgeBaseId: kb.kb_id, maxDepth: maxTreeDepth, maxItems: maxTreeItems });
    const collected = await collectSearchResults({ queries, knowledgeBaseId: kb.kb_id });
    const matcher = new RegExp(modelPattern, 'i');
    const contextPattern = /鸿蒙版.*Windows|Windows.*鸿蒙版/i;
    const documents = collected.results.filter(item => item.media_type !== 9 && (matcher.test(item.title) || contextPattern.test(item.title)));
    const imageCandidates = collected.results.filter(item => item.media_type === 9);

    const dataRoot = options.dataRoot || outputDir;
    const targetSlug = safeSlug(product, 'target-product');
    const targetDir = ensureInside(outputDir, path.join(outputDir, 'targets', targetSlug));
    const sourcesDir = ensureInside(targetDir, path.join(targetDir, 'sources'));
    fs.mkdirSync(sourcesDir, { recursive: true });

    const documentsWithBodies = [];
    for (let index = 0; index < documents.length; index += 1) {
        const item = { ...documents[index], knowledge_base_id: kb.kb_id };
        const snapshot = await readMediaSnapshot({ item, targetDir, targetModels: [product], index: index + 1 });
        documentsWithBodies.push({ ...snapshot, knowledge_base_id: kb.kb_id, text: snapshot.text || '' });
    }

    const imageManifest = downloadImages
        ? await buildImageManifest({ images: imageCandidates, targetDir, product, assetReuseDir, dataRoot })
        : { schema_version: '1.0', generated_at: generatedAt, product, counts: { candidates: imageCandidates.length, verified_model: 0, rights_cleared: 0, readable: 0 }, images: [], limitations: ['本次运行显式跳过图片下载；候选数量来自搜索元数据'] };

    const facts = documentsWithBodies.flatMap(document => factsFromDocument(document, product));
    const pricingRefs = documentsWithBodies.filter(document => /价格卡/i.test(document.title)).flatMap(document => parsePriceRows(document, product));
    const evidenceImages = imageManifest.images.filter(image => image.sha256).map(image => ({
        image_id: image.image_id,
        product,
        caption: image.caption,
        usage_scope: image.usage_scope,
        rights_status: image.rights_status,
        source: image.source,
        applicable_models: [product],
        model_verified: false,
        content_sha256: image.sha256,
        data_path: image.data_path,
    }));
    const gaps = [
        '价格快照来自 2026-10-17，尚未在 2026-10-21 重新核验商城结算页，不能作为正式报价',
        '图片仅为 IMA 搜索候选；型号、配色、SKU、画面和版权均未完成逐图核验',
        '完整知识库目录已记录，但并非所有非目标产品文档都参与事实抽取',
    ];
    if (tree.counts.truncated) gaps.push('目录遍历达到配置上限，evidence base 中的目录清单不完整');
    if (documentsWithBodies.some(document => !['text_extracted', 'note_text'].includes(document.body_status))) gaps.push('存在无法访问正文或正文提取失败的 IMA 文档，详见 target-evidence-package.json');

    const evidenceBundle = {
        schema_version: '1.0',
        bundle_id: `ima-bundle-${shortHash(`${product}|${generatedAt}`)}`,
        generated_at: generatedAt,
        query: { product, sku: null, purpose: 'mixed', as_of: asOf },
        facts,
        images: evidenceImages,
        pricing_refs: pricingRefs,
        conflicts: [],
        coverage: {
            facts: facts.length,
            images: evidenceImages.length,
            prices: pricingRefs.length,
            gaps,
        },
        extensions: {
            ima: {
                skill_version: SKILL_VERSION,
                knowledge_base: { kb_id: kb.kb_id, kb_name: kb.kb_name, content_count: kb.content_count, base_type: kb.base_type },
                read_only: true,
                request_ids: [...new Set([...kbSearch.request_ids, ...(kbDetails.request_id ? [kbDetails.request_id] : [])])],
                directory_request_ids: tree.request_ids,
                search_runs: collected.runs,
                source_documents: documentsWithBodies.map(document => ({
                    title: document.title,
                    media_id: document.media_id,
                    media_type: document.media_type,
                    body_path: document.body_path,
                    text_path: document.text_path,
                    sha256: document.sha256,
                    retrieved_at: document.retrieved_at,
                    extraction: document.extraction,
                    body_status: document.body_status,
                })),
                limitations: [
                    'Official IMA Skill 1.1.10 is vendored read-only for provenance and request helper reuse',
                    'Temporary signed media URLs and request headers are intentionally not persisted',
                    'IMA IDs remain in the evidence files for auditability and must not be exposed in end-user UI',
                ],
            },
            product_aliases: aliases,
            model_pattern: modelPattern,
        },
    };

    const targetPackage = {
        schema_version: '1.0',
        generated_at: generatedAt,
        target: { product, aliases, model_pattern: modelPattern, as_of: asOf },
        ima_context: { skill_version: SKILL_VERSION, knowledge_base: { kb_id: kb.kb_id, kb_name: kb.kb_name } },
        evidence_bundle_path: 'evidence-bundle.json',
        image_manifest_path: 'image-manifest.json',
        searches: collected.runs,
        documents: documentsWithBodies.map(document => ({
            title: document.title,
            media_id: document.media_id,
            parent_folder_id: document.parent_folder_id,
            media_type: document.media_type,
            media_type_name: document.media_type_name,
            body_path: document.body_path,
            text_path: document.text_path,
            content_type: document.content_type,
            content_length: document.content_length,
            sha256: document.sha256,
            retrieved_at: document.retrieved_at,
            request_ids: document.request_ids,
            extraction: document.extraction,
            body_status: document.body_status,
            applicable_models: [product],
            stable_source_url: extractStableUrl(document.text),
        })),
        summary: { documents: documentsWithBodies.length, images: imageManifest.images.length, facts: facts.length, prices: pricingRefs.length },
        gaps,
    };

    const imaEvidenceBundle = {
        schema_version: '1.0',
        bundle_type: 'ima_evidence_base',
        generated_at: generatedAt,
        target: { product, aliases, model_pattern: modelPattern, as_of: asOf },
        ima_context: { skill_version: SKILL_VERSION, read_only: true, knowledge_base: { kb_id: kb.kb_id, kb_name: kb.kb_name, content_count: kb.content_count, role_type: kb.role_type, base_type: kb.base_type } },
        capabilities: {
            official_skill_loaded: true,
            knowledge_base_search: true,
            knowledge_base_detail: true,
            directory_browse: true,
            knowledge_search: true,
            media_info: true,
            body_read: true,
            image_candidate_download: true,
        },
        knowledge_bases: kbSearch.info_list,
        directory: tree,
        search_runs: collected.runs,
        target_package: { path: `targets/${targetSlug}/target-evidence-package.json`, documents: documentsWithBodies.length, images: imageManifest.images.length },
        limitations: [
            '本轮仅执行 IMA 只读操作，不执行上传、导入、编辑或写入',
            '目录快照受 maxDepth/maxItems 上限约束，达到上限时会显式标记 truncated=true',
            '正文快照与图片候选写入 data-spec 工作区；业务区仅保存可复用实现',
        ],
    };

    writeJson(path.join(outputDir, 'ima-evidence-bundle.json'), imaEvidenceBundle);
    writeJson(path.join(targetDir, 'evidence-bundle.json'), evidenceBundle);
    writeJson(path.join(targetDir, 'image-manifest.json'), imageManifest);
    writeJson(path.join(targetDir, 'target-evidence-package.json'), targetPackage);
    writeJson(path.join(targetDir, 'run-metadata.json'), {
        schema_version: '1.0', generated_at: generatedAt, skill_version: SKILL_VERSION,
        knowledge_base: { kb_id: kb.kb_id, kb_name: kb.kb_name },
        request_ids: {
            knowledge_base_discovery: kbSearch.request_ids,
            knowledge_base_detail: kbDetails.request_id ? [kbDetails.request_id] : [],
            directory: tree.request_ids,
            search: collected.runs.flatMap(run => run.request_ids),
            media: documentsWithBodies.flatMap(document => document.request_ids),
        },
    });
    return {
        output_dir: outputDir,
        ima_evidence_bundle: path.join(outputDir, 'ima-evidence-bundle.json'),
        target_package: path.join(targetDir, 'target-evidence-package.json'),
        evidence_bundle: path.join(targetDir, 'evidence-bundle.json'),
        image_manifest: path.join(targetDir, 'image-manifest.json'),
        counts: { knowledge_bases: kbSearch.info_list.length, directory_entries: tree.entries.length, documents: documentsWithBodies.length, images: imageManifest.images.length, facts: facts.length, prices: pricingRefs.length },
        gaps,
    };
}

module.exports = {
    MEDIA_TYPES,
    browseKnowledgeBase,
    fetchMediaBytes,
    mediaTypeInfo,
    inferExtension,
    extractSection,
    parsePriceRows,
    factsFromDocument,
    makeFact,
    compactText,
    extractStableUrl,
    writeJson,
    buildSource,
    generateImaEvidenceBase,
    safeSlug,
};



