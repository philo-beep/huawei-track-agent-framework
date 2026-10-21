'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dataRoot = process.env.HUAWEI_DATA_ROOT
    ? path.resolve(process.env.HUAWEI_DATA_ROOT)
    : path.resolve(__dirname, '..', '..', 'huawei-sales-agent-data');
const file = name => path.join(dataRoot, 'datasets', 'cleaned', name);
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8').replace(/^\uFEFF/, ''));
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const registry = read('product_registry.json');
const facts = read('product_facts.json');
const offers = read('product_offers.json');
const compatibility = read('compatibility_records.json');
const quality = read('product_data_quality.json');

check(Array.isArray(registry.products) && registry.products.length > 0, 'registry products missing');
check(registry.summary.product_count === registry.products.length, 'registry product count mismatch');
const productIds = new Set(registry.products.map(item => item.product_id));
check(productIds.size === registry.products.length, 'duplicate product_id');
const aliases = new Map();
for (const product of registry.products) {
    check(typeof product.canonical_name === 'string' && product.canonical_name.trim(), `invalid canonical name: ${product.product_id}`);
    check(productIds.has(product.product_id), `invalid product id: ${product.product_id}`);
    for (const alias of [product.canonical_name, ...(product.aliases || [])]) {
        const key = String(alias).toLowerCase().replace(/\s+/g, '');
        if (aliases.has(key) && aliases.get(key) !== product.product_id) failures.push(`alias collision: ${alias}`);
        aliases.set(key, product.product_id);
    }
}
for (const fact of facts.facts || []) {
    check(productIds.has(fact.product_id), `fact references unknown product: ${fact.fact_id}`);
    check(fact.evidence_level === 'E1', `fact is not E1: ${fact.fact_id}`);
    check(fact.source && fact.source.entry && fact.source.sha256, `fact source incomplete: ${fact.fact_id}`);
    check(typeof fact.claim === 'string' && fact.claim.length > 0, `fact claim missing: ${fact.fact_id}`);
}
for (const offer of offers.offers || []) {
    check(productIds.has(offer.product_id), `offer references unknown product: ${offer.offer_id}`);
    check(typeof offer.current_transaction_quote === 'boolean', `offer quote flag missing: ${offer.offer_id}`);
    if (offer.current_transaction_quote) check(Number.isFinite(offer.amount), `current quote amount missing: ${offer.offer_id}`);
}
check((compatibility.records || []).every(record => record.source && record.verified_at), 'compatibility source missing');
check(quality.source_index_sha256 === registry.source_index_sha256, 'quality registry hash mismatch');
check(quality.product_facts.fact_count === (facts.facts || []).length, 'quality fact count mismatch');
check(quality.product_offers.offer_count === (offers.offers || []).length, 'quality offer count mismatch');
check(quality.product_offers.current_quote_count === (offers.offers || []).filter(item => item.current_transaction_quote).length, 'quality current quote count mismatch');

const report = {
    status: failures.length ? 'failed' : 'ok',
    data_root: dataRoot,
    registry_version: registry.registry_version,
    products: registry.products.length,
    facts: (facts.facts || []).length,
    offers: (offers.offers || []).length,
    current_quotes: (offers.offers || []).filter(item => item.current_transaction_quote).length,
    compatibility_records: (compatibility.records || []).length,
    failures,
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (failures.length) process.exitCode = 1;
