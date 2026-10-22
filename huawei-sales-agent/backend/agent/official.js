'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ROOT, PipelineError } = require('./support');

const DATA_ROOT = path.resolve(ROOT, '..', 'huawei-sales-agent-data');
const RAW_ROOT = path.join(DATA_ROOT, 'datasets', 'raw');
const MANIFEST = path.join(RAW_ROOT, 'manifest.json');
const PAGE_HOSTS = new Set(['consumer.huawei.com', 'www.vmall.com', 'vmall.com', 'm.vmall.com', 'item.vmall.com']);
const FIELD_LABELS = { display_resolution: '屏幕分辨率', memory_options: '内存系列选项', storage: '存储', processor_options: '处理器系列选项', operating_system_options: '操作系统系列选项' };

function normalize(value) {
    return String(value || '').toLowerCase().replace(/^huawei\s*/i, '').replace(/[\s\-()（）]/g, '');
}

function officialUrl(value) {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' && !parsed.username && !parsed.password && (!parsed.port || parsed.port === '443') && PAGE_HOSTS.has(parsed.hostname);
    } catch { return false; }
}

function evidenceFile(relative, expectedHash) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || !/^[a-f0-9]{64}$/i.test(expectedHash || '')) throw new PipelineError('OFFICIAL_EVIDENCE_INVALID', '华为公开资料的来源信息不完整，暂时无法使用');
    const resolved = path.resolve(RAW_ROOT, relative);
    if (!resolved.startsWith(RAW_ROOT + path.sep)) throw new PipelineError('OFFICIAL_EVIDENCE_INVALID', '华为公开资料来源不可用，暂时无法使用');
    let current = RAW_ROOT;
    for (const component of path.relative(RAW_ROOT, resolved).split(path.sep)) {
        current = path.join(current, component);
        if (!fs.existsSync(current) || fs.lstatSync(current).isSymbolicLink()) throw new PipelineError('OFFICIAL_EVIDENCE_INVALID', '华为公开资料来源不存在或无法读取，暂时无法使用');
    }
    if (!fs.statSync(resolved).isFile()) throw new PipelineError('OFFICIAL_EVIDENCE_INVALID', '华为公开资料无法读取，暂时无法使用');
    const contents = fs.readFileSync(resolved);
    if (contents.length > 8 * 1024 * 1024 || crypto.createHash('sha256').update(contents).digest('hex') !== expectedHash.toLowerCase()) throw new PipelineError('OFFICIAL_EVIDENCE_INVALID', '华为公开资料读取失败或内容不一致，暂时无法使用');
    return contents;
}

function timestamp(value) {
    if (typeof value !== 'string') return NaN;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/);
    if (!match) return NaN;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return NaN;
    if (match[7] !== 'Z' && (Number(match[8]) > 14 || Number(match[9]) > 59 || (Number(match[8]) === 14 && Number(match[9]) !== 0))) return NaN;
    return Date.parse(value);
}

function verifiedEntry(entry, product, now) {
    if (entry.fetch_status !== 'ok' || entry.http_status !== 200 || !['huawei_official', 'vmall_official'].includes(entry.source_type) || !officialUrl(entry.url) || !officialUrl(entry.final_url)) throw new PipelineError('OFFICIAL_FETCH_UNVERIFIED', '华为公开资料未能成功获取或不是官方页面，暂时无法使用');
    if (entry.model_identity_verified !== true || !entry.product || normalize(entry.product) !== normalize(product)) throw new PipelineError('OFFICIAL_MODEL_MISMATCH', '官网页面未与请求的完整代际型号匹配，不能用系列泛名代替');
    const fetchedAt = timestamp(entry.fetched_at);
    if (!Number.isFinite(fetchedAt) || fetchedAt > now + 60000 || now - fetchedAt > 7 * 86400000) throw new PipelineError('OFFICIAL_SNAPSHOT_EXPIRED', '官网规格证据时间无效或已超过7天本地复核窗口');
    evidenceFile(entry.raw_path, entry.raw_sha256);
    const text = evidenceFile(entry.text_path, entry.text_sha256).toString('utf8').replace(/^\uFEFF/, '');
    if (!text.trim() || text !== entry.text) throw new PipelineError('OFFICIAL_EVIDENCE_INVALID', '华为公开资料内容不一致或为空，暂时无法使用');
    return { entry, text, fetchedAt };
}

function fieldEvidence(field, verified, sku) {
    if (!field || typeof field.excerpt !== 'string' || !field.excerpt.trim() || !verified.text.includes(field.excerpt)) return false;
    const pointer = field.source_pointer;
    if (!pointer || pointer.path !== verified.entry.text_path || pointer.sha256 !== verified.entry.text_sha256) return false;
    if (!['model', 'sku'].includes(field.scope)) return false;
    if (field.scope === 'sku' && (!sku || field.sku !== sku || verified.entry.sku !== sku)) return false;
    return true;
}

function publicPrice(verified, sku, now) {
    const entry = verified.entry;
    const price = entry.price;
    if (!price || typeof sku !== 'string' || !sku.trim() || sku !== sku.trim() || /[\u0000-\u001f\u007f]/.test(sku) || typeof entry.sku !== 'string' || typeof price.sku !== 'string' || entry.sku !== sku || price.sku !== sku) return null;
    if (price.price_type !== 'public_retail' || price.currency !== 'CNY' || !Number.isSafeInteger(price.amount_cents) || price.amount_cents <= 0) return null;
    if (now - verified.fetchedAt > 3600000) return null;
    if (price.valid_from && (!Number.isFinite(timestamp(price.valid_from)) || timestamp(price.valid_from) > now)) return null;
    if (price.valid_until && (!Number.isFinite(timestamp(price.valid_until)) || timestamp(price.valid_until) < now)) return null;
    if (price.valid_from && price.valid_until && timestamp(price.valid_from) > timestamp(price.valid_until)) return null;
    if (!price.configuration || Array.isArray(price.configuration) || typeof price.configuration !== 'object' || !Object.keys(price.configuration).length || JSON.stringify(price.configuration) !== JSON.stringify(entry.configuration)) return null;
    if (typeof price.excerpt !== 'string' || !verified.text.includes(price.excerpt) || !Array.isArray(price.conditions) || price.conditions.some(condition => typeof condition !== 'string' || !verified.text.includes(condition))) return null;
    if (price.conditions_verified !== true || /起|补贴|国补|券后|会员|限时|以旧换新|到手/.test(price.excerpt)) return null;
    const quotedAmounts = [...price.excerpt.replace(/,/g, '').matchAll(/(?:[¥￥]\s*(\d+(?:\.\d{1,2})?)(?![\d.])|(?<![\d.])(\d+(?:\.\d{1,2})?)\s*(?:元|CNY))/g)].map(match => {
        const [whole, fraction = ''] = (match[1] || match[2]).split('.');
        return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    });
    if (!quotedAmounts.some(amount => amount === BigInt(price.amount_cents))) return null;
    return { amount_cents: price.amount_cents, currency: 'CNY', price_type: 'public_retail_snapshot_reference', sku, configuration: price.configuration, fetched_at: entry.fetched_at, valid_from: price.valid_from || null, valid_until: price.valid_until || null, freshness_window_seconds: 3600, excerpt: price.excerpt, conditions: price.conditions, url: entry.final_url, raw_path: entry.raw_path, raw_sha256: entry.raw_sha256, text_path: entry.text_path, text_sha256: entry.text_sha256, actual_transaction_quote: false };
}

function loadOfficialReference(product, sku = null, options = {}) {
    const now = options.now === undefined ? Date.now() : options.now;
    const result = { status: 'unavailable', product, requested_sku: sku, source_priority: 'huawei_official_then_rendeyao_local', checked_at: new Date(now).toISOString(), specifications: [], public_price_reference: null, final_transaction_amount_cents: null, actual_transaction_quote: false, sources: [], image_candidates: [], diagnostics: [], documents: [] };
    let priceConflict = false;
    try {
        const manifestPath = options.manifestPath ? path.resolve(DATA_ROOT, options.manifestPath) : MANIFEST;
        if (!manifestPath.startsWith(DATA_ROOT + path.sep) || !fs.existsSync(manifestPath) || fs.lstatSync(manifestPath).isSymbolicLink() || !fs.statSync(manifestPath).isFile()) throw new PipelineError('OFFICIAL_EVIDENCE_INVALID', '华为公开资料清单不可用，暂时无法使用');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
        if (!Array.isArray(manifest.entries)) throw new PipelineError('OFFICIAL_EVIDENCE_INVALID', '华为公开资料清单不完整，暂时无法使用');
        for (const entry of manifest.entries) {
            if (normalize(entry.product) !== normalize(product)) continue;
            try {
                const verified = verifiedEntry(entry, product, now);
                const fields = (entry.fields || []).filter(field => fieldEvidence(field, verified, sku));
                result.sources.push({ id: entry.id, url: entry.final_url, fetched_at: entry.fetched_at, raw_path: entry.raw_path, raw_sha256: entry.raw_sha256, text_path: entry.text_path, text_sha256: entry.text_sha256, product: entry.product, sku: entry.sku || null, limitations: entry.limitations || [] });
                for (const field of fields) result.specifications.push({ name: field.name, value: field.value, unit: field.unit || null, scope: field.scope, sku: field.sku || null, excerpt: field.excerpt, url: entry.final_url, fetched_at: entry.fetched_at, text_path: entry.text_path, text_sha256: entry.text_sha256 });
                if (fields.length) result.documents.push({ title: `华为官网｜${entry.product}｜${entry.id}｜抓取${entry.fetched_at}`, kind: 'product_fact', product_names: [product], text: verified.text, official_fields: fields, source: { entry: entry.text_path, entry_sha256: entry.text_sha256, archive_aliases: [], urls: [entry.final_url] } });
                const price = publicPrice(verified, sku, now);
                if (price && !priceConflict) {
                    if (result.public_price_reference && result.public_price_reference.amount_cents !== price.amount_cents) throw new PipelineError('OFFICIAL_PRICE_CONFLICT', '多条华为公开资料的同一销售配置价格不一致，价格参考保持待确认');
                    result.public_price_reference = price;
                }
                for (const image of entry.images || []) if (image.product === entry.product && (!image.sku || image.sku === sku) && officialUrl(image.source_url || entry.final_url)) result.image_candidates.push({ ...image, source_page: entry.final_url, fetched_at: entry.fetched_at, model_verified: false, copyright_verified: false });
            } catch (error) {
                result.diagnostics.push({ code: error.code || 'OFFICIAL_EVIDENCE_INVALID', message: error instanceof PipelineError ? error.message : '部分华为公开资料暂时无法读取，本次没有使用该内容' });
                if (error.code === 'OFFICIAL_PRICE_CONFLICT') { result.public_price_reference = null; priceConflict = true; }
            }
        }
        const groups = new Map();
        for (const field of result.specifications) {
            const key = `${field.name}:${field.scope}:${field.sku || ''}`;
            if (groups.has(key) && groups.get(key) !== JSON.stringify(field.value)) throw new PipelineError('OFFICIAL_SPEC_CONFLICT', '同一型号的华为公开资料存在冲突，相关规格保持待确认');
            groups.set(key, JSON.stringify(field.value));
        }
        result.status = result.specifications.length ? 'verified_model_snapshot' : result.sources.length ? 'no_usable_fields' : 'unavailable';
        if (!result.public_price_reference) result.diagnostics.push({ code: 'OFFICIAL_PRICE_UNKNOWN', message: '尚未取得完整销售配置和适用条件都已确认的华为公开价格；价格保持待确认，不用历史价格、起售价、券后或补贴估算替代' });
        if (!result.specifications.length) result.diagnostics.push({ code: 'OFFICIAL_SPEC_UNAVAILABLE', message: '官网未找到可安全匹配完整代际型号的参数，允许明确标识后回退任德耀本地资料；不推断为2024或鸿蒙版' });
    } catch (error) {
        result.status = 'unavailable'; result.specifications = []; result.documents = []; result.public_price_reference = null;
        result.diagnostics.push({ code: error.code || 'OFFICIAL_MANIFEST_UNAVAILABLE', message: error instanceof PipelineError ? error.message : '官网清单或原文不可读；官网价格未知，未执行联网或自动抓取' });
    }
    return result;
}

function officialKnowledge(reference) {
    if (!reference.documents.length || reference.status !== 'verified_model_snapshot') return null;
    return { source_mode: 'official_snapshot', documents: reference.documents, image_candidates: [], official_reference: reference };
}

module.exports = { loadOfficialReference, officialKnowledge, officialUrl, evidenceFile, DATA_ROOT, RAW_ROOT, MANIFEST, FIELD_LABELS };
