'use strict';

const { loadOfficialReference, officialUrl } = require('./official');

const PRODUCTS = Object.freeze(['HUAWEI MateBook 14 鸿蒙版', 'HUAWEI MateBook 14 2024']);
const FRESHNESS_WINDOW_MS = 7 * 86400000;
const DIAGNOSTICS = Object.freeze({
    OFFICIAL_FETCH_UNVERIFIED: '部分官方页面未成功获取或未通过网址核验。',
    OFFICIAL_MODEL_MISMATCH: '资料未与完整代际型号匹配。',
    OFFICIAL_SNAPSHOT_EXPIRED: '规格资料已超过7天复核窗口或抓取时间无效，需要更新。',
    OFFICIAL_EVIDENCE_INVALID: '资料文件或内容指纹未通过核验。',
    OFFICIAL_SPEC_CONFLICT: '同型号规格资料冲突，需要维护者复核。',
    OFFICIAL_SPEC_UNAVAILABLE: '没有通过核验的完整代际规格资料，公开演示需要更新来源。',
    OFFICIAL_MANIFEST_UNAVAILABLE: '公开资料清单不可用，需要维护者检查。',
    OFFICIAL_PRICE_UNKNOWN: '尚未核实完整SKU、配置和适用条件，公开价格未知。',
    OFFICIAL_PRICE_CONFLICT: '同一SKU公开价格存在冲突，价格保持未知。',
});

function getSourceStatus(options = {}) {
    const now = options.now === undefined ? Date.now() : options.now;
    if (typeof now !== 'number' || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new TypeError('now must be a valid timestamp');
    const checkedAt = new Date(now).toISOString();
    const products = PRODUCTS.map(product => {
        const reference = loadOfficialReference(product, null, { now, ...(options.manifestPath === undefined ? {} : { manifestPath: options.manifestPath }) });
        const sources = reference.sources.filter(source => officialUrl(source.url) && Number.isFinite(Date.parse(source.fetched_at))).map(source => ({
            url: source.url,
            fetched_at: new Date(Date.parse(source.fetched_at)).toISOString(),
            expires_at: new Date(Date.parse(source.fetched_at) + FRESHNESS_WINDOW_MS).toISOString(),
        }));
        const oldest = sources.length ? Math.min(...sources.map(source => Date.parse(source.fetched_at))) : null;
        const ready = reference.status === 'verified_model_snapshot' && reference.documents.length > 0 && sources.length > 0;
        const codes = [...new Set(reference.diagnostics.map(item => item.code))];
        return {
            product, status: ready ? 'ready' : 'needs_update', checked_at: checkedAt,
            source_mode: 'official_public_snapshot',
            oldest_fetched_at: oldest === null ? null : new Date(oldest).toISOString(),
            expires_at: oldest === null ? null : new Date(oldest + FRESHNESS_WINDOW_MS).toISOString(),
            valid_source_count: sources.length, sources,
            price_status: 'unknown', public_price_reference: null, actual_transaction_quote: false,
            formal_image_count: 0,
            diagnostics: codes.map(code => Object.hasOwn(DIAGNOSTICS, code) ? { code, message: DIAGNOSTICS[code] } : { code: 'OFFICIAL_STATUS_UNAVAILABLE', message: '部分公开资料未通过核验，需要维护者检查。' }),
        };
    });
    return {
        status: products.every(product => product.status === 'ready') ? 'ready' : 'needs_update',
        checked_at: checkedAt, source_mode: 'official_public_snapshot', freshness_window_seconds: FRESHNESS_WINDOW_MS / 1000,
        price_status: 'unknown', public_price_reference: null, formal_image_count: 0, products,
    };
}

function sourceReadiness(status) {
    return { status: status.status, checked_at: status.checked_at, source_mode: status.source_mode, products: status.products.map(product => ({ product: product.product, status: product.status, expires_at: product.expires_at })) };
}

module.exports = { getSourceStatus, sourceReadiness, PRODUCTS, FRESHNESS_WINDOW_MS };
