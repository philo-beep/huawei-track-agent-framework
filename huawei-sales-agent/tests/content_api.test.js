'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { createCloudServer } = require('../backend/agent/cloud-server');
const { productMatchExamples } = require('../backend/agent/product-match');
const { authenticate, temporaryAuthFile, fs } = require('./auth_helpers');

async function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const port = probe.address().port;
            probe.close(error => error ? reject(error) : resolve(port));
        });
    });
}

async function waitJob(origin, id, cookie) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
        const response = await fetch(`${origin}/api/runs/${id}`, { headers: { Cookie: cookie } });
        const job = await response.json();
        if (job.status !== 'running') return job;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('job timeout');
}

test('content-draft API regenerates match evidence and serves reviewed IMA images', async () => {
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const authFile = temporaryAuthFile();
    const server = createCloudServer({ publicOrigin: origin, platformProxyHost: false, authDataFile: authFile });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    try {
        const pageResponse = await fetch(`${origin}/`);
        assert.equal(pageResponse.status, 200);
        const page = await pageResponse.text();
        assert.match(page, /content-draft-results/);
        assert.match(page, /id="content-platform"/);
        assert.match(page, /小红书/);
        assert.match(page, /朋友圈/);
        assert.match(page, /content-verification-summary/);
        assert.match(page, /content-risk-items/);
        assert.match(page, /content-safe-version/);
        const scriptResponse = await fetch(`${origin}/static/js/app.js`);
        assert.equal(scriptResponse.status, 200);
        const script = await scriptResponse.text();
        assert.match(script, /startContentDraft/);
        assert.match(script, /content-platform/);
        assert.match(script, /朋友圈/);
        assert.match(script, /renderVerificationResult/);
        const auth = await authenticate(origin);
        const examples = auth.examples;
        const cookie = auth.cookie;
        const headers = { 'Content-Type': 'application/json; charset=utf-8', Origin: origin, Cookie: cookie, 'X-CSRF-Token': examples.csrf_token };
        const input = productMatchExamples()[0].input;
        input.mode = 'local';
        input.use_cloud_model = false;
        const matchResponse = await fetch(`${origin}/api/product-matches`, { method: 'POST', headers, body: JSON.stringify(input) });
        assert.equal(matchResponse.status, 202);
        const matchJob = await matchResponse.json();
        const completedMatch = await waitJob(origin, matchJob.id, cookie);
        assert.equal(completedMatch.status, 'completed');
        await new Promise(resolve => setTimeout(resolve, 2100));
        const candidateId = completedMatch.result.candidates[0].candidate_id;
        const contentResponse = await fetch(`${origin}/api/content-drafts`, {
            method: 'POST', headers,
            body: JSON.stringify({ schema_version: '1.0', match_input: input, candidate_id: candidateId, platform: '公众号', image_limit: 4 }),
        });
        assert.equal(contentResponse.status, 202);
        const contentJob = await contentResponse.json();
        assert.equal(contentJob.kind, 'content-draft');
        const completedContent = await waitJob(origin, contentJob.id, cookie);
        assert.equal(completedContent.status, 'completed');
        assert.equal(completedContent.result.schema_version, '1.2');
        assert.equal(completedContent.result.status, 'ready_for_review');
        assert.equal(completedContent.result.platform, '公众号');
        assert.equal(completedContent.result.platform_profile.id, 'wechat_article');
        assert.equal(completedContent.result.image_sources.length, 4);
        assert.equal(completedContent.result.verification.overall_status, 'downgraded');
        assert.equal(completedContent.result.verification.publication_ready, false);
        assert.equal(completedContent.result.verification.safe_content_ready, true);
        assert.equal(completedContent.result.verification.items.length, 6);
        assert.equal(completedContent.result.verification.risk_items[0].risk_level, 'downgrade');
        assert.deepEqual(completedContent.result.verification.safe_content.content.image_ids, []);
        assert.match(completedContent.markdown, /强制核验结果/);
        assert.match(completedContent.markdown, /风险项清单/);
        assert.match(completedContent.markdown, /图片来源清单/);
        const exportResponse = await fetch(`${origin}/api/runs/${contentJob.id}/export?format=markdown`, { headers: { Cookie: cookie } });
        assert.equal(exportResponse.status, 200);
        assert.match(await exportResponse.text(), /建议|配图/);
        const imageUrl = completedContent.result.image_sources[0].asset_url;
        const imageResponse = await fetch(`${origin}${imageUrl}`, { headers: { Cookie: cookie } });
        assert.equal(imageResponse.status, 200);
        assert.equal(imageResponse.headers.get('content-type'), 'image/png');
        const bytes = Buffer.from(await imageResponse.arrayBuffer());
        assert.ok(bytes.length > 10000);
    } finally {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(authFile, { force: true });
    }
});

test('content-draft API accepts all three supported platforms through real HTTP', async (t) => {
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const authFile = temporaryAuthFile();
    const server = createCloudServer({ publicOrigin: origin, platformProxyHost: false, authDataFile: authFile });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    try {
        for (const platform of ['公众号', '小红书', '朋友圈']) {
            await t.test(platform, async () => {
                const auth = await authenticate(origin);
                const examples = auth.examples;
                const cookie = auth.cookie;
                const headers = { 'Content-Type': 'application/json; charset=utf-8', Origin: origin, Cookie: cookie, 'X-CSRF-Token': examples.csrf_token };
                const input = productMatchExamples()[0].input;
                input.mode = 'local';
                input.use_cloud_model = false;
                const matchResponse = await fetch(`${origin}/api/product-matches`, { method: 'POST', headers, body: JSON.stringify(input) });
                assert.equal(matchResponse.status, 202);
                const matchJob = await matchResponse.json();
                const completedMatch = await waitJob(origin, matchJob.id, cookie);
                assert.equal(completedMatch.status, 'completed');
                const candidate = completedMatch.result.candidates.find(item => item.evidence.some(evidence => /鸿蒙版|harmonyos/i.test(`${evidence.title || ''} ${evidence.excerpt || ''}`)));
                assert.ok(candidate);
                await new Promise(resolve => setTimeout(resolve, 2100));
                const contentResponse = await fetch(`${origin}/api/content-drafts`, {
                    method: 'POST', headers,
                    body: JSON.stringify({ schema_version: '1.0', match_input: input, candidate_id: candidate.candidate_id, platform }),
                });
                assert.equal(contentResponse.status, 202);
                const contentJob = await contentResponse.json();
                const completedContent = await waitJob(origin, contentJob.id, cookie);
                assert.equal(completedContent.status, 'completed');
                assert.equal(completedContent.result.schema_version, '1.2');
                assert.equal(completedContent.result.platform, platform);
                assert.equal(completedContent.result.status, 'ready_for_review');
                assert.ok(completedContent.result.citations.length >= 1);
                assert.ok(completedContent.result.verification.items.every(item => item.status !== 'fail'));
            });
        }
    } finally {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(authFile, { force: true });
    }
});
