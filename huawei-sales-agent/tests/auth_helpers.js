'use strict';

const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

function temporaryAuthFile() {
    return path.join(os.tmpdir(), `huawei-auth-test-${crypto.randomUUID()}.json`);
}

function cookieValue(response, name) {
    const values = response.headers.getSetCookie();
    const match = values.find(value => value.startsWith(`${name}=`));
    return match ? match.split(';')[0] : '';
}

async function authenticate(origin, options = {}) {
    const suffix = crypto.randomBytes(5).toString('hex');
    const username = options.username || `test_admin_${suffix}`;
    const password = options.password || 'TestAdmin2026!';
    const headers = { 'Content-Type': 'application/json; charset=utf-8', Origin: origin };
    const registration = await fetch(`${origin}/api/auth/register`, {
        method: 'POST', headers, body: JSON.stringify({ username, password }),
    });
    if (registration.status !== 201) throw new Error(`register failed: ${registration.status} ${await registration.text()}`);
    const loginResponse = await fetch(`${origin}/api/auth/login`, {
        method: 'POST', headers, body: JSON.stringify({ username, password }),
    });
    if (loginResponse.status !== 200) throw new Error(`login failed: ${loginResponse.status} ${await loginResponse.text()}`);
    const login = await loginResponse.json();
    const authCookie = cookieValue(loginResponse, 'huawei_session');
    const examplesResponse = await fetch(`${origin}/api/examples`, { headers: { Origin: origin, Cookie: authCookie } });
    if (examplesResponse.status !== 200) throw new Error(`examples failed: ${examplesResponse.status} ${await examplesResponse.text()}`);
    const examples = await examplesResponse.json();
    const demoCookie = cookieValue(examplesResponse, 'huawei_demo');
    return {
        username,
        session: login.user,
        authCsrf: login.csrf_token,
        authCookie,
        demoCookie,
        cookie: `${authCookie}; ${demoCookie}`,
        examples,
    };
}

module.exports = { authenticate, temporaryAuthFile, cookieValue, fs };