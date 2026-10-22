'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCloudServer } = require('../backend/agent/cloud-server');

const ORIGIN = 'http://127.0.0.1';
const dataFile = path.join(os.tmpdir(), `huawei-auth-${crypto.randomUUID()}.json`);

function cookieFrom(response, name) {
    const values = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    const found = values.find(value => value.startsWith(`${name}=`));
    return found ? found.split(';')[0] : '';
}

async function start(port = 0) {
    const server = createCloudServer({ publicOrigin: ORIGIN, platformProxyHost: true, authDataFile: dataFile });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    return server;
}

async function call(server, method, pathname, { body, cookie = '', csrf = '' } = {}) {
    const headers = { Origin: ORIGIN };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    if (csrf) headers['X-CSRF-Token'] = csrf;
    return new Promise((resolve, reject) => {
        const request = http.request({ host: '127.0.0.1', port: server.address().port, path: pathname, method, headers }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                const payload = Buffer.concat(chunks).toString('utf8');
                const setCookies = response.headers['set-cookie'] || [];
                resolve({
                    status: response.statusCode,
                    headers: { getSetCookie: () => Array.isArray(setCookies) ? setCookies : [setCookies] },
                    json: async () => JSON.parse(payload),
                });
            });
        });
        request.on('error', reject);
        if (body !== undefined) request.write(JSON.stringify(body));
        request.end();
    });
}

async function json(response) {
    return response.json();
}

(async () => {
    let server = await start();
    try {
        let response = await call(server, 'GET', '/api/examples');
        assert.equal(response.status, 401, '未登录不得读取工作台示例');
        assert.equal((await json(response)).error.code, 'AUTH_REQUIRED');

        response = await call(server, 'POST', '/api/auth/register', { body: { username: 'admin_user', password: 'AdminPass123!' } });
        assert.equal(response.status, 201);
        const adminRegistration = await json(response);
        assert.equal(adminRegistration.user.role, 'admin');
        assert.equal(adminRegistration.first_admin, true);

        response = await call(server, 'POST', '/api/auth/login', { body: { username: 'admin_user', password: 'AdminPass123!' } });
        assert.equal(response.status, 200);
        const adminLogin = await json(response);
        const adminCookie = cookieFrom(response, 'huawei_session');
        const adminCsrf = adminLogin.csrf_token;
        assert.match(adminCookie, /^huawei_session=[a-f0-9]{64}$/);
        assert.match(adminCsrf, /^[a-f0-9]{64}$/);

        response = await call(server, 'GET', '/api/auth/me', { cookie: adminCookie });
        assert.equal(response.status, 200);
        assert.equal((await json(response)).user.username, 'admin_user');

        response = await call(server, 'GET', '/api/examples', { cookie: adminCookie });
        assert.equal(response.status, 200);
        const examples = await json(response);
        const demoCookie = cookieFrom(response, 'huawei_demo');
        assert.ok(demoCookie.startsWith('huawei_demo='));
        assert.match(examples.csrf_token, /^[a-f0-9]{64}$/);

        response = await call(server, 'GET', '/api/admin/users', { cookie: adminCookie });
        assert.equal(response.status, 200);
        assert.equal((await json(response)).items.length, 1);

        response = await call(server, 'POST', '/api/auth/register', { body: { username: 'member_user', password: 'MemberPass123!' } });
        assert.equal(response.status, 201);
        const memberRegistration = await json(response);
        assert.equal(memberRegistration.user.role, 'member');

        response = await call(server, 'POST', '/api/auth/login', { body: { username: 'member_user', password: 'MemberPass123!' } });
        assert.equal(response.status, 200);
        const memberLogin = await json(response);
        const memberCookie = cookieFrom(response, 'huawei_session');
        const memberCsrf = memberLogin.csrf_token;

        response = await call(server, 'GET', '/api/admin/users', { cookie: memberCookie });
        assert.equal(response.status, 403, '普通成员不得访问管理员接口');
        assert.equal((await json(response)).error.code, 'PERMISSION_DENIED');

        response = await call(server, 'PATCH', `/api/admin/users/${memberRegistration.user.id}`, {
            cookie: adminCookie,
            body: { role: 'viewer' },
        });
        assert.equal(response.status, 403, '权限修改必须携带 CSRF 令牌');

        response = await call(server, 'PATCH', `/api/admin/users/${memberRegistration.user.id}`, {
            cookie: adminCookie,
            csrf: adminCsrf,
            body: { role: 'viewer' },
        });
        assert.equal(response.status, 200);
        assert.equal((await json(response)).user.role, 'viewer');

        response = await call(server, 'GET', '/api/auth/me', { cookie: memberCookie });
        assert.equal(response.status, 200);
        assert.equal((await json(response)).user.role, 'viewer', '角色变更必须实时反映到已有会话');

        response = await call(server, 'GET', '/api/examples', { cookie: memberCookie });
        assert.equal(response.status, 200);
        const viewerExamples = await json(response);
        const viewerDemoCookie = cookieFrom(response, 'huawei_demo');

        response = await call(server, 'POST', '/api/runs', {
            cookie: `${memberCookie}; ${viewerDemoCookie}`,
            csrf: viewerExamples.csrf_token,
            body: {},
        });
        assert.equal(response.status, 403, '只读角色不得运行分析');
        assert.equal((await json(response)).error.code, 'PERMISSION_DENIED');

        response = await call(server, 'POST', '/api/auth/logout', { cookie: memberCookie, csrf: memberCsrf });
        assert.equal(response.status, 200);
        response = await call(server, 'GET', '/api/auth/me', { cookie: memberCookie });
        assert.equal(response.status, 401, '退出后会话必须立即撤销');

        await new Promise(resolve => server.close(resolve));
        server = await start();
        response = await call(server, 'GET', '/api/auth/me', { cookie: adminCookie });
        assert.equal(response.status, 200, '服务重启后有效会话应可恢复');
        assert.equal((await json(response)).user.role, 'admin');
    } finally {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(dataFile, { force: true });
    }
    process.stdout.write('access_control.test.js: passed\n');
})().catch(error => {
    process.stderr.write(`access_control.test.js: failed\n${error.stack}\n`);
    process.exitCode = 1;
});