'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { runGuidedProfile, MAX_GUIDED_TURNS, DIMENSIONS } = require('../backend/agent/guided-profile');
const { createCloudServer } = require('../backend/agent/cloud-server');
const { authenticate, temporaryAuthFile, fs } = require('./auth_helpers');

function modelOutput(dimensions, nextQuestion = null) {
    return async () => ({
        value: { dimensions, next_question: nextQuestion },
        model: 'deepseek-v4.1-flash-test',
        provider: 'openai-compatible',
    });
}

function dimension(id, value, evidence, status = 'explicit') {
    return { dimension: id, value, status, evidence, reason: '测试合成输入', confidence: 0.9 };
}

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
        await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('guided profile job timeout');
}

test('guided profile starts with one question and does not claim a model call', async () => {
    const result = await runGuidedProfile({ schema_version: '1.0', messages: [] });
    assert.equal(result.status, 'question');
    assert.equal(result.turn, 0);
    assert.equal(result.max_turns, MAX_GUIDED_TURNS);
    assert.equal(result.runtime.called, false);
    assert.equal(result.next_question.source, 'program_fallback');
    assert.match(result.next_question.text, /客户/);
    for (const dimension of DIMENSIONS) assert.match(dimension.question, /客户/);
});

test('cloud analysis uses exact evidence and stops at the core coverage threshold', async () => {
    const messages = [
        { role: 'user', content: '我是采购负责人，我们在制造业。' },
        { role: 'user', content: '设备主要在办公室和仓库移动使用。' },
        { role: 'user', content: '这次是想替换老旧电脑。' },
        { role: 'user', content: '现在最大的问题是设备卡顿。' },
        { role: 'user', content: '已经进入采购审批。' },
        { role: 'user', content: '预算还没定。' },
    ];
    const dimensions = [
        dimension('identity', '采购负责人', '采购负责人'),
        dimension('industry', '制造业', '制造业'),
        dimension('usage_scenario', '办公室和仓库移动使用', '办公室和仓库移动使用'),
        dimension('needs', ['替换老旧电脑'], '替换老旧电脑'),
        dimension('pain_points', ['设备卡顿'], '设备卡顿'),
        dimension('purchase_stage', '采购审批', '采购审批'),
        dimension('budget', '预算未定', '预算还没定'),
    ];
    const result = await runGuidedProfile({ schema_version: '1.0', messages }, { runner: modelOutput(dimensions, { dimension: 'conversation_habit', text: '客户更习惯哪种沟通方式？', options: ['文字'] }) });
    assert.equal(result.status, 'complete');
    assert.equal(result.stop_reason, 'coverage_threshold');
    assert.equal(result.next_question, null);
    assert.equal(result.coverage.covered_count, 7);
    assert.equal(result.fields.identity.evidence[0].quote, '采购负责人');
    assert.equal(result.product_match_profile.budget, null);
});

test('model hallucinated evidence is downgraded and an invalid multi-question falls back', async () => {
    const messages = [{ role: 'user', content: '我们在制造业。' }];
    const dimensions = [dimension('industry', '制造业', '这段原话不存在'), dimension('identity', '采购负责人', '制造业')];
    const result = await runGuidedProfile({ schema_version: '1.0', messages }, {
        runner: modelOutput(dimensions, { dimension: 'identity', text: '身份是什么？预算多少？', options: [] }),
    });
    assert.equal(result.status, 'question');
    assert.equal(result.fields.industry.status, 'pending');
    assert.equal(result.fields.identity.value, '采购负责人');
    assert.notEqual(result.next_question.dimension, 'identity');
    assert.match(result.next_question.text, /客户/);
    assert.ok(result.diagnostics.some(item => item.code === 'GUIDED_QUESTION_FALLBACK'));
});

test('hard maximum turn limit terminates incomplete interviews', async () => {
    const messages = Array.from({ length: MAX_GUIDED_TURNS }, (_, index) => ({ role: 'user', content: `第${index + 1}条合成回答` }));
    const result = await runGuidedProfile({ schema_version: '1.0', messages }, {
        runner: modelOutput([dimension('industry', '制造业', '第1条合成回答')]),
    });
    assert.equal(result.status, 'complete');
    assert.equal(result.stop_reason, 'max_turns');
    assert.equal(result.turn, MAX_GUIDED_TURNS);
    assert.equal(result.next_question, null);
});

test('self-addressed salesperson question is rejected and replaced by customer-centric wording', async () => {
    const messages = [{ role: 'user', content: '客户在制造业。' }];
    const result = await runGuidedProfile({ schema_version: '1.0', messages }, {
        runner: modelOutput([dimension('industry', '制造业', '制造业')], { dimension: 'identity', text: '您在公司的岗位是什么？', options: [] }),
    });
    assert.equal(result.next_question.dimension, 'identity');
    assert.match(result.next_question.text, /客户/);
    assert.doesNotMatch(result.next_question.text, /^您在/);
});

test('guided prompt explicitly treats the user as a sales advisor', async () => {
    const prompt = fs.readFileSync(path.join(__dirname, '..', 'backend', 'agent', 'prompts', 'guided-profile.md'), 'utf8');
    assert.match(prompt, /服务对象是华为销售顾问/);
    assert.match(prompt, /禁止把销售顾问本人当作客户/);
});

test('guided-profile HTTP route validates CSRF, creates a job and returns next question', async () => {
    const sample = await runGuidedProfile({ schema_version: '1.0', messages: [] });
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const authFile = temporaryAuthFile();
    const server = createCloudServer({ publicOrigin: origin, platformProxyHost: false, authDataFile: authFile, profileRunner: async input => {
        assert.deepEqual(input.messages, []);
        return sample;
    } });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    try {
        const page = await (await fetch(`${origin}/`)).text();
        assert.match(page, /profile-studio/);
        assert.match(page, /id="wizard-nav"/);
        assert.match(page, /data-wizard-panel="1"/);
        assert.match(page, /id="wizard-next"/);
        const auth = await authenticate(origin);
        const examples = auth.examples;
        assert.equal(examples.capabilities.guided_profile, true);
        const cookie = auth.cookie;
        const headers = { 'Content-Type': 'application/json; charset=utf-8', Origin: origin, Cookie: cookie, 'X-CSRF-Token': examples.csrf_token };
        const response = await fetch(`${origin}/api/profile-steps`, { method: 'POST', headers, body: JSON.stringify({ schema_version: '1.0', messages: [], restart: true }) });
        assert.equal(response.status, 202);
        const created = await response.json();
        assert.equal(created.kind, 'guided-profile');
        const job = await waitJob(origin, created.id, cookie);
        assert.equal(job.status, 'completed');
        assert.equal(job.result.status, 'question');
        assert.match(job.markdown, /客户画像/);
    } finally {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(authFile, { force: true });
    }
});
