'use strict';

const { loadOfficialReference, officialUrl } = require('./official');

const PRODUCTS = Object.freeze(['HUAWEI MateBook 14 鸿蒙版', 'HUAWEI MateBook 14 2024']);
const FRESHNESS_WINDOW_MS = 7 * 86400000;
const DIAGNOSTICS = Object.freeze({
    OFFICIAL_FETCH_UNVERIFIED: '部分华为公开页面暂时无法打开或无法确认。',
    OFFICIAL_MODEL_MISMATCH: '资料未能与所选产品型号匹配。',
    OFFICIAL_SNAPSHOT_EXPIRED: '产品资料需要更新后重新检查。',
    OFFICIAL_EVIDENCE_INVALID: '产品资料内容暂时无法核对。',
    OFFICIAL_SPEC_CONFLICT: '同一型号的资料存在冲突，需要资料维护人员复核。',
    OFFICIAL_SPEC_UNAVAILABLE: '没有可用的同型号产品资料，需要更新资料来源。',
    OFFICIAL_MANIFEST_UNAVAILABLE: '公开资料暂时不可用，需要资料维护人员检查。',
    OFFICIAL_PRICE_UNKNOWN: '尚未确认完整销售配置和适用条件，正式成交价待确认。',
    OFFICIAL_PRICE_CONFLICT: '同一销售配置的公开价格存在冲突，正式成交价保持待确认。',
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
            diagnostics: codes.map(code => Object.hasOwn(DIAGNOSTICS, code) ? { code, message: DIAGNOSTICS[code] } : { code: 'OFFICIAL_STATUS_UNAVAILABLE', message: '部分公开资料暂时无法确认，需要资料维护人员检查。' }),
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
