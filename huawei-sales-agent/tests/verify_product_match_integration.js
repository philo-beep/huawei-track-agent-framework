'use strict';

const { runtimeCapabilities } = require('../backend/agent/config');
const { runProductMatch, productMatchExamples } = require('../backend/agent/product-match');

async function main() {
    const capabilities = runtimeCapabilities();
    const output = { status: 'started', capabilities, result: null };
    if (!process.argv.includes('--live')) {
        output.status = 'skipped';
        output.notice = '如需真实调用 IMA 和云端模型，请运行 node tests/verify_product_match_integration.js --live';
        process.stdout.write(JSON.stringify(output, null, 2) + '\n');
        return;
    }
    if (!capabilities.ima_configured || !capabilities.cloud_model_configured) throw new Error('IMA 或云端模型未配置，拒绝伪造联调成功');
    const input = productMatchExamples()[0].input;
    const result = await runProductMatch(input);
    output.status = result.provenance.effective_mode === 'hybrid' && result.provenance.model.status === 'called' ? 'ok' : 'needs_attention';
    output.result = {
        match_status: result.status,
        effective_mode: result.provenance.effective_mode,
        ima_request_ids: result.provenance.ima_request_ids,
        knowledge_base: result.provenance.knowledge_base,
        model: result.provenance.model,
        candidate_count: result.verification.candidate_count,
        recommended_count: result.verification.recommended_count,
        pending_count: result.verification.pending_count,
        unsupported_claims_dropped: result.verification.unsupported_claims_dropped,
        candidates: result.candidates.slice(0, 3).map(candidate => ({
            product: candidate.product_name,
            status: candidate.status,
            reason_count: candidate.matching_reasons.length,
            evidence_levels: [...new Set(candidate.evidence.map(item => item.source_level))],
            source_mode: candidate.source_mode,
        })),
        diagnostics: result.diagnostics.map(item => item.code),
    };
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    if (output.status !== 'ok') process.exitCode = 1;
}

main().catch(error => {
    process.stdout.write(JSON.stringify({ status: 'failed', code: error.code || 'VERIFY_FAILED', message: error.message }, null, 2) + '\n');
    process.exitCode = 1;
});
