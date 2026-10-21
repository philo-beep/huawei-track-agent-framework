#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, validateSchema } = require('../backend/agent/support');

const DATA_ROOT = path.resolve(ROOT, '..', 'huawei-sales-agent-data');
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function assert(condition, message) { if (!condition) throw new Error(message); }

function validate({ dataRoot = DATA_ROOT } = {}) {
    const imaRoot = path.join(dataRoot, 'datasets', 'ima');
    const base = readJson(path.join(imaRoot, 'ima-evidence-bundle.json'));
    assert(base.capture_status === 'partial_verified_quota_blocked', 'unexpected IMA coverage status');
    assert(base.delivery_status === 'ready', 'step-one delivery status must be ready');
    assert(base.capabilities.official_skill_loaded === true, 'official skill not loaded');
    assert(base.capabilities.complete_directory_snapshot === false, 'partial capture must not claim complete directory');
    assert(base.quota?.code === 220021, 'quota evidence missing');
    const targetPath = path.join(imaRoot, base.target_package.path);
    const target = readJson(targetPath);
    assert(target.delivery_status === 'ready', 'target package delivery status must be ready');
    const targetDir = path.dirname(targetPath);
    const bundle = readJson(path.join(targetDir, target.evidence_bundle_path));
    const schema = readJson(path.join(ROOT, 'backend', 'agent', 'contracts', 'evidence-bundle.schema.json'));
    assert(validateSchema(bundle, schema) === true, 'EvidenceBundle schema validation failed');
    assert(bundle.coverage.facts === bundle.facts.length, 'fact count mismatch');
    assert(bundle.coverage.images === bundle.images.length, 'image count mismatch');
    assert(bundle.coverage.prices === bundle.pricing_refs.length, 'price count mismatch');
    assert(target.summary.full_text === 2, 'expected 2 full-text hash-matched documents');
    const fullTextChecks = [];
    for (const document of target.documents) {
        if (document.body_status !== 'verified_full_text_hash_matched_local_mirror') continue;
        const file = path.join(targetDir, document.body_path);
        const actual = hash(file);
        assert(actual === document.sha256, `document hash mismatch: ${document.title}`);
        fullTextChecks.push({ title: document.title, sha256: actual });
    }
    const manifest = readJson(path.join(targetDir, target.image_manifest_path));
    assert(manifest.counts.candidates === 9 && manifest.counts.verified_model === 0, 'image candidate counts or verification status invalid');
    assert(bundle.facts.some(fact => fact.source.source_type === 'huawei_official'), 'official supplement facts missing');
    assert(manifest.images.some(image => image.source.source_type === 'local_knowledge'), 'local knowledge images missing');
    const imageChecks = [];
    for (const image of manifest.images) {
        const file = path.join(dataRoot, image.data_path);
        const actual = hash(file);
        assert(actual === image.content_sha256, `image hash mismatch: ${image.title}`);
        assert(image.bytes === fs.statSync(file).size, `image byte count mismatch: ${image.title}`);
        assert(image.model_verified === false && image.rights_status === 'unknown', `image overclaims verification: ${image.title}`);
        imageChecks.push({ title: image.caption, sha256: actual });
    }
    assert(bundle.pricing_refs.every(item => item.verification === 'unverified'), 'historical prices must remain unverified');
    return {
        status: 'ok', capture_status: base.capture_status, quota_code: base.quota.code,
        documents: target.summary.documents, full_text_hash_verified: fullTextChecks.length,
        facts: bundle.facts.length, prices: bundle.pricing_refs.length,
        images_sha256_verified: imageChecks.length, formal_images: 0,
        source_types: [...new Set(bundle.facts.map(fact => fact.source.source_type))].sort(),
        full_text_checks: fullTextChecks, image_checks: imageChecks,
    };
}

if (require.main === module) {
    try {
        const dataIndex = process.argv.indexOf('--data-root');
        const result = validate({ dataRoot: dataIndex >= 0 ? path.resolve(process.argv[dataIndex + 1]) : DATA_ROOT });
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } catch (error) {
        process.stderr.write(JSON.stringify({ status: 'failed', message: error.message }, null, 2) + '\n');
        process.exitCode = 1;
    }
}

module.exports = { validate };








