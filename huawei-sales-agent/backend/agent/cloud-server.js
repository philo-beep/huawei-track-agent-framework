'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ROOT, PipelineError } = require('./support');
const { AuthStore, AccessError, SESSION_TTL_MS } = require('../session/auth-store');
const { ENGINE, CAPABILITIES, examples, validateCloudInput, runCloud, cloudMarkdown } = require('./cloud-runner');
const { getSourceStatus, sourceReadiness } = require('./source-health');
const { MANIFEST } = require('./official');
const { runProductMatch, renderProductMatchMarkdown, productMatchExamples } = require('./product-match');
const { runContentDraft, renderContentDraftMarkdown, readReviewedImage } = require('./content-generation');
const { runGuidedProfile, renderGuidedProfileMarkdown, MAX_GUIDED_TURNS } = require('./guided-profile');

const TTL = 20 * 60 * 1000;
const BODY_LIMIT = 4096;
const MATCH_BODY_LIMIT = 16384;
const AUTH_BODY_LIMIT = 8192;
const AUTH_COOKIE = 'huawei_session';
const DEMO_COOKIE = 'huawei_demo';
const STATIC = {
    '/': ['frontend/index.html', 'text/html; charset=utf-8'],
    '/index.html': ['frontend/index.html', 'text/html; charset=utf-8'],
    '/static/js/app.js': ['frontend/static/js/app.js', 'text/javascript; charset=utf-8'],
    '/static/js/auth.js': ['frontend/static/js/auth.js', 'text/javascript; charset=utf-8'],
    '/favicon.svg': ['frontend/static/favicon.svg', 'image/svg+xml'],
    '/static/css/styles.css': ['frontend/static/css/styles.css', 'text/css; charset=utf-8'],
};

function readStatic(relative) {
    const resolved = path.resolve(ROOT, relative);
    if (!resolved.startsWith(ROOT + path.sep)) throw new PipelineError('STATIC_UNAVAILABLE', '静态资源路径越界');
    let current = ROOT;
    for (const component of path.relative(ROOT, resolved).split(path.sep)) {
        current = path.join(current, component);
        if (!fs.existsSync(current) || fs.lstatSync(current).isSymbolicLink()) throw new PipelineError('STATIC_UNAVAILABLE', '静态资源不存在或为符号链接');
    }
    if (!fs.statSync(resolved).isFile()) throw new PipelineError('STATIC_UNAVAILABLE', '静态资源不是普通文件');
    return fs.readFileSync(resolved);
}

function createCloudServer(options = {}) {
    const publicOrigin = new URL(options.publicOrigin || process.env.PUBLIC_ORIGIN || 'http://localhost:7860');
    if (!['http:', 'https:'].includes(publicOrigin.protocol) || publicOrigin.username || publicOrigin.password || publicOrigin.pathname !== '/' || publicOrigin.search || publicOrigin.hash) throw new Error('PUBLIC_ORIGIN must be one exact http(s) origin');
    const allowedOriginHosts = new Set([publicOrigin.hostname, 'modelscope.cn', 'www.modelscope.cn']);
    const originHost = value => {
        const normalized = String(value || '').trim().replace(/\/$/, '');
        try {
            const parsed = new URL(normalized);
            if (['http:', 'https:'].includes(parsed.protocol) && parsed.hostname) return parsed.hostname.toLowerCase();
        } catch {}
        const hostOnly = normalized.match(/^([A-Za-z0-9.-]+)(?::[0-9]{1,5})?$/);
        return hostOnly ? hostOnly[1].toLowerCase() : null;
    };
    const originAllowed = rawOrigin => String(rawOrigin || '').split(',').map(value => value.trim()).filter(Boolean).some(value => {
        const hostname = originHost(value);
        return Boolean(hostname && (allowedOriginHosts.has(hostname) || hostname.endsWith('.modelscope.cn')));
    });
    const samePublicOriginHost = rawOrigin => originHost(rawOrigin) === publicOrigin.hostname;
    const originHostLabel = rawOrigin => String(rawOrigin || '').split(',').map(value => originHost(value) || 'invalid').filter(Boolean).join(',');
    const platformProxyHost = options.platformProxyHost ?? process.env.PLATFORM_PROXY_HOST === '1';
    const sessions = new Map();
    const jobs = new Map();
    const runner = options.runner || runCloud;
    const matchRunner = options.matchRunner || runProductMatch;
    const contentRunner = options.contentRunner || runContentDraft;
    const profileRunner = options.profileRunner || runGuidedProfile;
    let active = null;
    let windowStarted = Date.now();
    let globalRuns = 0;
    const authStore = options.authStore || new AuthStore({ file: options.authDataFile || process.env.HUAWEI_AUTH_FILE || path.join(ROOT, '.runtime', 'auth.json') });
    const authAttempts = new Map();
    const parseCookies = raw => Object.fromEntries(String(raw || '').split(';').map(item => item.trim()).filter(Boolean).map(item => {
        const index = item.indexOf('=');
        return index > 0 ? [item.slice(0, index), item.slice(index + 1)] : [item, ''];
    }));
    const safeEqual = (left, right) => typeof left === 'string' && typeof right === 'string' && left.length === right.length && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
    const sessionCookie = (token, maxAge) => `${AUTH_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${publicOrigin.protocol === 'https:' ? '; Secure' : ''}`;
    const clearSessionCookie = () => `${AUTH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${publicOrigin.protocol === 'https:' ? '; Secure' : ''}`;
    const clientAddress = request => {
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) return request.socket.remoteAddress || 'unknown';
        const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
        return forwarded || request.socket.remoteAddress || 'unknown';
    };
    const takeAttempt = (request, action, username) => {
        const now = Date.now();
        const address = clientAddress(request);
        const key = `${action}:${address}:${String(username || '').trim().toLocaleLowerCase('zh-CN')}`;
        const ipKey = `${action}:${address}`;
        const recent = (authAttempts.get(key) || []).filter(value => now - value < 5 * 60 * 1000);
        const ipRecent = (authAttempts.get(ipKey) || []).filter(value => now - value < 5 * 60 * 1000);
        if (recent.length >= 10 || ipRecent.length >= 30) return false;
        recent.push(now);
        ipRecent.push(now);
        authAttempts.set(key, recent);
        authAttempts.set(ipKey, ipRecent);
        return true;
    };
    const mutationOriginValid = request => request.headers['sec-fetch-site'] !== 'cross-site' && (!request.headers.origin || samePublicOriginHost(request.headers.origin));
    const readJson = (request, limit, tooLargeMessage) => new Promise((resolve, reject) => {
        if (Number(request.headers['content-length'] || 0) > limit) {
            request.resume();
            return reject(new AccessError(413, 'BODY_TOO_LARGE', tooLargeMessage));
        }
        let length = 0;
        const chunks = [];
        request.on('data', chunk => { length += chunk.length; if (length <= limit) chunks.push(chunk); });
        request.on('end', () => {
            if (length > limit) return reject(new AccessError(413, 'BODY_TOO_LARGE', tooLargeMessage));
            try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
            catch { reject(new AccessError(400, 'INVALID_JSON', '提交内容暂时无法读取，请刷新页面后重试')); }
        });
        request.on('error', () => reject(new AccessError(400, 'INVALID_JSON', '内容没有完整提交，请重新提交')));
    });
    const requireAuth = (response, auth, permission = null) => {
        if (!auth) {
            response.setHeader('WWW-Authenticate', 'Session');
            fail(response, 401, 'AUTH_REQUIRED', '请先登录后再使用销售工作台');
            return false;
        }
        if (permission && !auth.user.permissions.includes(permission)) {
            fail(response, 403, 'PERMISSION_DENIED', '当前账号没有执行此操作的权限，请联系管理员');
            return false;
        }
        return true;
    };
    const csrfValid = (request, auth) => Boolean(auth) && samePublicOriginHost(request.headers.origin) && request.headers['sec-fetch-site'] !== 'cross-site' && safeEqual(request.headers['x-csrf-token'], auth.csrf);
    const send = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
    const fail = (response, status, code, message) => send(response, status, { error: { code, message } });
    const purge = () => {
        const now = Date.now();
        for (const [identifier, session] of sessions) if (now - session.created > TTL) sessions.delete(identifier);
        for (const [identifier, job] of jobs) if (now - job.created > TTL && active !== identifier) jobs.delete(identifier);
        if (now - windowStarted > 10 * 60 * 1000) { globalRuns = 0; windowStarted = now; }
    };
    const server = http.createServer(async (request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self' https://modelscope.cn https://www.modelscope.cn");
        const port = server.address()?.port || 7860;
        const internalHealth = request.method === 'GET' && ['/healthz', '/health', '/api/health'].includes(request.url) && [`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host) && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress);
        if (!platformProxyHost && request.headers.host !== publicOrigin.host && !internalHealth) return fail(response, 403, 'HOST_FORBIDDEN', '当前访问地址未获允许，请从正式工作台地址进入');
        if (request.headers.origin && !originAllowed(request.headers.origin)) return fail(response, 403, 'ORIGIN_FORBIDDEN', '当前访问地址未获允许，请从正式工作台地址进入');
        let url;
        try { url = new URL(request.url, publicOrigin); } catch { return fail(response, 400, 'INVALID_PATH', '页面地址不可用，请从正式工作台地址进入'); }
        if (url.origin !== publicOrigin.origin || url.username || url.password) return fail(response, 400, 'INVALID_PATH', '当前访问地址不可用，请从正式工作台地址进入');
        purge();
        try {
            const cookies = parseCookies(request.headers.cookie);
            const authToken = cookies[AUTH_COOKIE] || '';
            const currentAuth = authStore.resolve(authToken);
            if (request.method === 'GET' && ['/healthz', '/health', '/api/health'].includes(url.pathname)) return send(response, 200, { status: 'ok', busy: active !== null, engine: ENGINE, model: CAPABILITIES.cloud_model_name, model_ready: CAPABILITIES.cloud_model_configured ? 'configured' : 'disabled', ima_enabled: CAPABILITIES.ima_configured, web_research_enabled: CAPABILITIES.web_research_configured, capabilities: CAPABILITIES, public_demo: true, authentication: true, source_manifest_available: fs.existsSync(MANIFEST), source_readiness: sourceReadiness(getSourceStatus()) });
            if (request.method === 'POST' && url.pathname === '/api/auth/register') {
                if (!mutationOriginValid(request)) return fail(response, 403, 'ORIGIN_REQUIRED', '请从销售工作台页面完成注册');
                if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) return fail(response, 415, 'JSON_REQUIRED', '提交内容格式不正确，请刷新页面后重试');
                const body = await readJson(request, AUTH_BODY_LIMIT, '填写内容较长，请精简后再试');
                if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['username', 'password'].includes(key))) return fail(response, 422, 'INPUT_INVALID', '注册信息填写有误，请检查后重试');
                if (!takeAttempt(request, 'register', body.username)) return fail(response, 429, 'RATE_LIMIT', '注册尝试过于频繁，请5分钟后重试');
                const user = authStore.register(body.username, body.password);
                return send(response, 201, { user, first_admin: user.role === 'admin' });
            }
            if (request.method === 'POST' && url.pathname === '/api/auth/login') {
                if (!mutationOriginValid(request)) return fail(response, 403, 'ORIGIN_REQUIRED', '请从销售工作台页面完成登录');
                if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) return fail(response, 415, 'JSON_REQUIRED', '提交内容格式不正确，请刷新页面后重试');
                const body = await readJson(request, AUTH_BODY_LIMIT, '填写内容较长，请精简后再试');
                if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['username', 'password'].includes(key))) return fail(response, 422, 'INPUT_INVALID', '登录信息填写有误，请检查后重试');
                if (!takeAttempt(request, 'login', body.username)) return fail(response, 429, 'RATE_LIMIT', '登录尝试过于频繁，请5分钟后重试');
                const issued = authStore.login(body.username, body.password);
                response.setHeader('Set-Cookie', [sessionCookie(issued.token, Math.floor(SESSION_TTL_MS / 1000)), `${DEMO_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${publicOrigin.protocol === 'https:' ? '; Secure' : ''}`]);
                return send(response, 200, { user: issued.user, csrf_token: issued.csrf, expires_at: issued.expiresAt, session_ttl_seconds: Math.floor(SESSION_TTL_MS / 1000) });
            }
            if (request.method === 'GET' && url.pathname === '/api/auth/me') {
                if (!requireAuth(response, currentAuth)) return;
                return send(response, 200, { user: currentAuth.user, csrf_token: currentAuth.csrf, expires_at: currentAuth.expiresAt });
            }
            if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
                if (!requireAuth(response, currentAuth)) return;
                if (!csrfValid(request, currentAuth)) return fail(response, 403, 'CSRF_REJECTED', '安全校验已过期，请刷新页面后重试');
                authStore.revoke(authToken);
                response.setHeader('Set-Cookie', [clearSessionCookie(), `${DEMO_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${publicOrigin.protocol === 'https:' ? '; Secure' : ''}`]);
                return send(response, 200, { logged_out: true });
            }
            if (request.method === 'GET' && url.pathname === '/api/admin/users') {
                if (!requireAuth(response, currentAuth, 'admin:users')) return;
                return send(response, 200, { items: authStore.listUsers() });
            }
            const adminUserRoute = url.pathname.match(/^\/api\/admin\/users\/(\d+)$/);
            if (request.method === 'PATCH' && adminUserRoute) {
                if (!requireAuth(response, currentAuth, 'admin:users')) return;
                if (!csrfValid(request, currentAuth)) return fail(response, 403, 'CSRF_REJECTED', '安全校验已过期，请刷新页面后重试');
                if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) return fail(response, 415, 'JSON_REQUIRED', '提交内容格式不正确，请刷新页面后重试');
                const body = await readJson(request, AUTH_BODY_LIMIT, '填写内容较长，请精简后再试');
                if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['role', 'active'].includes(key))) return fail(response, 422, 'INPUT_INVALID', '权限设置未正确提交，请刷新后重试');
                return send(response, 200, { user: authStore.updateUser(currentAuth.user, Number(adminUserRoute[1]), body) });
            }
            if (request.method === 'GET' && url.pathname === '/api/source-status') {
                if (!requireAuth(response, currentAuth)) return;
                if (url.search) return fail(response, 400, 'SOURCE_QUERY_FORBIDDEN', '来源状态不接受参数或更新指令');
                return send(response, 200, getSourceStatus());
            }
            const image = url.pathname.match(/^\/api\/content-images\/([a-f0-9]{64})$/i);
            if (request.method === 'GET' && image) {
                if (!requireAuth(response, currentAuth)) return;
                if (url.search) return fail(response, 400, 'IMAGE_QUERY_FORBIDDEN', '图片来源不接受参数');
                try {
                    const asset = readReviewedImage(image[1]);
                    response.setHeader('Cache-Control', 'no-store');
                    response.writeHead(200, { 'Content-Type': asset.mimeType });
                    response.end(fs.readFileSync(asset.filePath));
                } catch (error) {
                    return fail(response, 404, error instanceof PipelineError ? error.code : 'IMAGE_NOT_FOUND', '图片不在已确认的产品资料中');
                }
                return;
            }
            const sessionId = (request.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith('huawei_demo='))?.slice('huawei_demo='.length);
            let session = sessions.get(sessionId);
            if (request.method === 'GET' && url.pathname === '/api/examples') {
                if (!requireAuth(response, currentAuth)) return;
                if (!session || session.ownerId !== currentAuth.user.id) {
                    if (sessions.size >= 100) return fail(response, 429, 'SESSION_LIMIT', '演示会话已满，请稍后重试');
                    const identifier = crypto.randomBytes(32).toString('hex');
                    session = { id: identifier, ownerId: currentAuth.user.id, created: Date.now(), csrf: crypto.randomBytes(32).toString('hex'), runs: 0, profileRuns: 0, lastRun: 0 };
                    sessions.set(identifier, session);
                    response.setHeader('Set-Cookie', `huawei_demo=${identifier}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1200${publicOrigin.protocol === 'https:' ? '; Secure' : ''}`);
                }
                return send(response, 200, { csrf_token: session.csrf, examples: examples(), match_examples: productMatchExamples(), engine: ENGINE, capabilities: { ...CAPABILITIES, product_matching: true, content_generation: true, guided_profile: true, guided_profile_max_turns: MAX_GUIDED_TURNS }, session_ttl_seconds: 1200 });
            }
            if (request.method === 'POST' && url.pathname === '/api/runs') {
                if (!requireAuth(response, currentAuth, 'analysis:run')) return;
                const csrf = request.headers['x-csrf-token'];
                if (!session || !samePublicOriginHost(request.headers.origin) || request.headers['sec-fetch-site'] === 'cross-site' || typeof csrf !== 'string' || !/^[a-f0-9]{64}$/.test(csrf) || !crypto.timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf))) return fail(response, 403, 'CSRF_REJECTED', '登录校验已过期，请刷新当前页面后重试');
                if (active !== null) return fail(response, 409, 'BUSY', '已有任务正在生成，请稍后再提交');
                if (session.runs >= 3 || globalRuns >= 60 || Date.now() - session.lastRun < 2000) return fail(response, 429, 'RATE_LIMIT', '当前登录的使用次数较多，请稍后再试');
                if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) return fail(response, 415, 'JSON_REQUIRED', '提交内容格式不正确，请刷新页面后重试');
                if (Number(request.headers['content-length'] || 0) > BODY_LIMIT) { request.resume(); return fail(response, 413, 'BODY_TOO_LARGE', '填写内容较长，请精简后再试'); }
                const body = await new Promise((resolve, reject) => {
                    let length = 0;
                    const chunks = [];
                    request.on('data', chunk => { length += chunk.length; if (length <= BODY_LIMIT) chunks.push(chunk); });
                    request.on('end', () => {
                        if (length > BODY_LIMIT) return reject(new PipelineError('BODY_TOO_LARGE', '填写内容较长，请精简后再试'));
                        try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); } catch { reject(new PipelineError('INVALID_JSON', '提交内容暂时无法读取，请刷新页面后重试')); }
                    });
                    request.on('error', () => reject(new PipelineError('INVALID_JSON', '内容没有完整提交，请重新提交')));
                });
                const input = validateCloudInput(body);
                if (active !== null) return fail(response, 409, 'BUSY', '已有任务正在生成，请稍后再提交');
                while (jobs.size >= 20) jobs.delete(jobs.keys().next().value);
                const id = crypto.randomUUID();
                const job = { id, status: 'running', result: null, markdown: null, error: null, created: Date.now(), session: session.id, ownerId: currentAuth.user.id };
                jobs.set(id, job);
                active = id;
                session.runs += 1;
                session.lastRun = Date.now();
                globalRuns += 1;
                send(response, 202, { id, status: 'running' });
                setImmediate(async () => {
                    try { job.result = await runner(input); job.markdown = cloudMarkdown(job.result); job.status = 'completed'; }
                    catch (error) { job.status = 'failed'; job.error = { code: error instanceof PipelineError ? error.code : 'RUN_FAILED', message: error instanceof PipelineError ? error.message : '演示执行未完成，未输出内部异常或客户原文' }; }
                    finally { if (active === id) active = null; }
                });
                return;
            }
            if (request.method === 'POST' && url.pathname === '/api/profile-steps') {
                if (!requireAuth(response, currentAuth, 'analysis:run')) return;
                const csrf = request.headers['x-csrf-token'];
                if (!session || !samePublicOriginHost(request.headers.origin) || request.headers['sec-fetch-site'] === 'cross-site' || typeof csrf !== 'string' || !/^[a-f0-9]{64}$/.test(csrf) || !crypto.timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf))) return fail(response, 403, 'CSRF_REJECTED', '登录校验已过期，请刷新当前页面后重试');
                if (active !== null) return fail(response, 409, 'BUSY', '已有任务正在生成，请等当前步骤完成后再试');
                if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) return fail(response, 415, 'JSON_REQUIRED', '提交内容格式不正确，请刷新页面后重试');
                if (Number(request.headers['content-length'] || 0) > MATCH_BODY_LIMIT) { request.resume(); return fail(response, 413, 'BODY_TOO_LARGE', '填写内容较长，请精简后再试'); }
                const body = await new Promise((resolve, reject) => {
                    let length = 0;
                    const chunks = [];
                    request.on('data', chunk => { length += chunk.length; if (length <= MATCH_BODY_LIMIT) chunks.push(chunk); });
                    request.on('end', () => {
                        if (length > MATCH_BODY_LIMIT) return reject(new PipelineError('BODY_TOO_LARGE', '填写内容较长，请精简后再试'));
                        try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); } catch { reject(new PipelineError('INVALID_JSON', '提交内容暂时无法读取，请刷新页面后重试')); }
                    });
                    request.on('error', () => reject(new PipelineError('INVALID_JSON', '内容没有完整提交，请重新提交')));
                });
                if (body?.restart === true) session.profileRuns = 0;
                if (globalRuns >= 60 || session.profileRuns > MAX_GUIDED_TURNS || Date.now() - session.lastRun < 600) return fail(response, 429, 'RATE_LIMIT', '画像访谈轮次或请求频率已达上限，请稍后重试');
                const profileInput = { schema_version: '1.0', messages: Array.isArray(body?.messages) ? body.messages : null };
                while (jobs.size >= 20) jobs.delete(jobs.keys().next().value);
                const id = crypto.randomUUID();
                const job = { id, kind: 'guided-profile', status: 'running', result: null, markdown: null, error: null, created: Date.now(), session: session.id, ownerId: currentAuth.user.id };
                jobs.set(id, job);
                active = id;
                session.profileRuns += 1;
                session.lastRun = Date.now();
                globalRuns += 1;
                send(response, 202, { id, status: 'running', kind: 'guided-profile' });
                setImmediate(async () => {
                    try {
                        job.result = await profileRunner(profileInput);
                        job.markdown = renderGuidedProfileMarkdown(job.result);
                        job.status = 'completed';
                    } catch (error) {
                        job.status = 'failed';
                        job.error = { code: error instanceof PipelineError ? error.code : 'GUIDED_PROFILE_FAILED', message: error instanceof PipelineError ? error.message : '客户画像访谈未完成，未输出内部异常或客户原文' };
                    } finally { if (active === id) active = null; }
                });
                return;
            }
            if (request.method === 'POST' && url.pathname === '/api/product-matches') {
                if (!requireAuth(response, currentAuth, 'analysis:run')) return;
                const csrf = request.headers['x-csrf-token'];
                if (!session || !samePublicOriginHost(request.headers.origin) || request.headers['sec-fetch-site'] === 'cross-site' || typeof csrf !== 'string' || !/^[a-f0-9]{64}$/.test(csrf) || !crypto.timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf))) return fail(response, 403, 'CSRF_REJECTED', '登录校验已过期，请刷新当前页面后重试');
                if (active !== null) return fail(response, 409, 'BUSY', '已有任务正在生成，请稍后再提交');
                if (session.runs >= 3 || globalRuns >= 60 || Date.now() - session.lastRun < 2000) return fail(response, 429, 'RATE_LIMIT', '当前登录的使用次数较多，请稍后再试');
                if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) return fail(response, 415, 'JSON_REQUIRED', '提交内容格式不正确，请刷新页面后重试');
                if (Number(request.headers['content-length'] || 0) > MATCH_BODY_LIMIT) { request.resume(); return fail(response, 413, 'BODY_TOO_LARGE', '填写内容较长，请精简后再试'); }
                const body = await new Promise((resolve, reject) => {
                    let length = 0;
                    const chunks = [];
                    request.on('data', chunk => { length += chunk.length; if (length <= MATCH_BODY_LIMIT) chunks.push(chunk); });
                    request.on('end', () => {
                        if (length > MATCH_BODY_LIMIT) return reject(new PipelineError('BODY_TOO_LARGE', '填写内容较长，请精简后再试'));
                        try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); } catch { reject(new PipelineError('INVALID_JSON', '提交内容暂时无法读取，请刷新页面后重试')); }
                    });
                    request.on('error', () => reject(new PipelineError('INVALID_JSON', '内容没有完整提交，请重新提交')));
                });
                while (jobs.size >= 20) jobs.delete(jobs.keys().next().value);
                const id = crypto.randomUUID();
                const job = { id, kind: 'product-match', status: 'running', result: null, markdown: null, error: null, created: Date.now(), session: session.id, ownerId: currentAuth.user.id };
                jobs.set(id, job);
                active = id;
                session.runs += 1;
                session.lastRun = Date.now();
                globalRuns += 1;
                send(response, 202, { id, status: 'running', kind: 'product-match' });
                setImmediate(async () => {
                    try { job.result = await matchRunner(body); job.markdown = renderProductMatchMarkdown(job.result); job.status = 'completed'; }
                    catch (error) { job.status = 'failed'; job.error = { code: error instanceof PipelineError ? error.code : 'MATCH_FAILED', message: error instanceof PipelineError ? error.message : '产品匹配未完成，未输出内部异常或客户原文' }; }
                    finally { if (active === id) active = null; }
                });
                return;
            }
            if (request.method === 'POST' && url.pathname === '/api/content-drafts') {
                if (!requireAuth(response, currentAuth, 'analysis:run')) return;
                const csrf = request.headers['x-csrf-token'];
                if (!session || !samePublicOriginHost(request.headers.origin) || request.headers['sec-fetch-site'] === 'cross-site' || typeof csrf !== 'string' || !/^[a-f0-9]{64}$/.test(csrf) || !crypto.timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf))) return fail(response, 403, 'CSRF_REJECTED', '登录校验已过期，请刷新当前页面后重试');
                if (active !== null) return fail(response, 409, 'BUSY', '已有任务正在生成，请稍后再提交');
                if (session.runs >= 3 || globalRuns >= 60 || Date.now() - session.lastRun < 2000) return fail(response, 429, 'RATE_LIMIT', '当前登录的使用次数较多，请稍后再试');
                if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) return fail(response, 415, 'JSON_REQUIRED', '提交内容格式不正确，请刷新页面后重试');
                if (Number(request.headers['content-length'] || 0) > MATCH_BODY_LIMIT) { request.resume(); return fail(response, 413, 'BODY_TOO_LARGE', '填写内容较长，请精简后再试'); }
                const body = await new Promise((resolve, reject) => {
                    let length = 0;
                    const chunks = [];
                    request.on('data', chunk => { length += chunk.length; if (length <= MATCH_BODY_LIMIT) chunks.push(chunk); });
                    request.on('end', () => {
                        if (length > MATCH_BODY_LIMIT) return reject(new PipelineError('BODY_TOO_LARGE', '填写内容较长，请精简后再试'));
                        try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); } catch { reject(new PipelineError('INVALID_JSON', '提交内容暂时无法读取，请刷新页面后重试')); }
                    });
                    request.on('error', () => reject(new PipelineError('INVALID_JSON', '内容没有完整提交，请重新提交')));
                });
                while (jobs.size >= 20) jobs.delete(jobs.keys().next().value);
                const id = crypto.randomUUID();
                const job = { id, kind: 'content-draft', status: 'running', result: null, markdown: null, error: null, created: Date.now(), session: session.id, ownerId: currentAuth.user.id };
                jobs.set(id, job);
                active = id;
                session.runs += 1;
                session.lastRun = Date.now();
                globalRuns += 1;
                send(response, 202, { id, status: 'running', kind: 'content-draft' });
                setImmediate(async () => {
                    try {
                        job.result = await contentRunner(body);
                        job.markdown = renderContentDraftMarkdown(job.result);
                        job.status = 'completed';
                    } catch (error) {
                        job.status = 'failed';
                        job.error = { code: error instanceof PipelineError ? error.code : 'CONTENT_GENERATION_FAILED', message: error instanceof PipelineError ? error.message : '图文生成未完成，未输出内部异常或客户原文' };
                    } finally { if (active === id) active = null; }
                });
                return;
            }
            const match = url.pathname.match(/^\/api\/runs\/([a-f0-9-]{36})(\/export)?$/i);
            if (request.method === 'GET' && match) {
                const job = jobs.get(match[1]);
                if (!requireAuth(response, currentAuth)) return;
                if (!session || session.ownerId !== currentAuth.user.id || !job || job.session !== session.id) return fail(response, 404, 'RUN_NOT_FOUND', '当前登录下找不到这次任务，或任务已过期，请重新发起');
                if (!match[2]) { const { session: omittedSession, created: omittedCreated, ...publicJob } = job; return send(response, 200, publicJob); }
                const format = url.searchParams.get('format');
                if (!['json', 'markdown'].includes(format) || [...url.searchParams.keys()].some(name => name !== 'format')) return fail(response, 400, 'EXPORT_FORMAT_INVALID', '暂不支持该下载格式');
                if (job.status !== 'completed') return fail(response, 409, 'RUN_NOT_COMPLETED', '结果仍在准备中，请稍后再下载');
                response.setHeader('Content-Disposition', `attachment; filename="huawei-demo-${job.id}.${format === 'json' ? 'json' : 'md'}"`);
                response.writeHead(200, { 'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8' });
                response.end(format === 'json' ? JSON.stringify(job.result, null, 2) + '\n' : job.markdown);
                return;
            }
            if (request.method === 'GET' && Object.hasOwn(STATIC, url.pathname)) {
                const [relative, type] = STATIC[url.pathname];
                let contents;
                try { contents = readStatic(relative); } catch { return fail(response, 404, 'NOT_FOUND', '页面内容暂时无法加载，请刷新后重试'); }
                response.writeHead(200, { 'Content-Type': type });
                response.end(contents);
                return;
            }
            fail(response, 404, 'NOT_FOUND', '没有找到该页面或功能');
        } catch (error) {
            if (response.headersSent) return response.end();
            if (error instanceof AccessError) return fail(response, error.status, error.code, error.message);
            const known = error instanceof PipelineError;
            fail(response, error.code === 'BODY_TOO_LARGE' ? 413 : known ? 400 : 500, known ? error.code : 'REQUEST_FAILED', known ? error.message : '请求未完成，请稍后重试');
        }
    });
    server.requestTimeout = 10000;
    server.headersTimeout = 8000;
    server.keepAliveTimeout = 3000;
    return server;
}

async function startCloudServer(options = {}) {
    const port = options.port ?? Number(process.env.PORT || 7860);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT invalid');
    const server = createCloudServer(options);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, options.host || '0.0.0.0', resolve); });
    return server;
}

if (require.main === module) startCloudServer({ host: process.env.HOST || '0.0.0.0' }).then(server => process.stdout.write(JSON.stringify({ status: 'listening', port: server.address().port, engine: ENGINE.mode }) + '\n')).catch(() => { process.stderr.write('公开演示启动失败，请检查PORT、HOST和PUBLIC_ORIGIN配置\n'); process.exitCode = 1; });

module.exports = { createCloudServer, startCloudServer, TTL, BODY_LIMIT };
