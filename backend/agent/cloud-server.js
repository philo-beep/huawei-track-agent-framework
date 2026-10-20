'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ROOT, PipelineError } = require('./support');
const { ENGINE, examples, validateCloudInput, runCloud, cloudMarkdown } = require('./cloud-runner');
const { getSourceStatus, sourceReadiness } = require('./source-health');
const { MANIFEST } = require('./official');

const TTL = 20 * 60 * 1000;
const BODY_LIMIT = 4096;
const STATIC = {
    '/': ['frontend/index.html', 'text/html; charset=utf-8'],
    '/index.html': ['frontend/index.html', 'text/html; charset=utf-8'],
    '/static/js/app.js': ['frontend/static/js/app.js', 'text/javascript; charset=utf-8'],
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
    let active = null;
    let windowStarted = Date.now();
    let globalRuns = 0;
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
        if (!platformProxyHost && request.headers.host !== publicOrigin.host && !internalHealth) return fail(response, 403, 'HOST_FORBIDDEN', '请求域名不在公开演示配置中');
        if (request.headers.origin && !originAllowed(request.headers.origin)) return fail(response, 403, 'ORIGIN_FORBIDDEN', `请求来源不在允许范围内（${originHostLabel(request.headers.origin)}）`);
        let url;
        try { url = new URL(request.url, publicOrigin); } catch { return fail(response, 400, 'INVALID_PATH', '路径无效'); }
        if (url.origin !== publicOrigin.origin || url.username || url.password) return fail(response, 400, 'INVALID_PATH', '不接受外部代理地址');
        purge();
        try {
            if (request.method === 'GET' && ['/healthz', '/health', '/api/health'].includes(url.pathname)) return send(response, 200, { status: 'ok', busy: active !== null, engine: ENGINE, model: null, model_ready: 'disabled', ima_enabled: false, public_demo: true, source_manifest_available: fs.existsSync(MANIFEST), source_readiness: sourceReadiness(getSourceStatus()) });
            if (request.method === 'GET' && url.pathname === '/api/source-status') {
                if (url.search) return fail(response, 400, 'SOURCE_QUERY_FORBIDDEN', '来源状态不接受参数或更新指令');
                return send(response, 200, getSourceStatus());
            }
            const sessionId = (request.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith('huawei_demo='))?.slice('huawei_demo='.length);
            let session = sessions.get(sessionId);
            if (request.method === 'GET' && url.pathname === '/api/examples') {
                if (!session) {
                    if (sessions.size >= 100) return fail(response, 429, 'SESSION_LIMIT', '演示会话已满，请稍后重试');
                    const identifier = crypto.randomBytes(32).toString('hex');
                    session = { id: identifier, created: Date.now(), csrf: crypto.randomBytes(32).toString('hex'), runs: 0, lastRun: 0 };
                    sessions.set(identifier, session);
                    response.setHeader('Set-Cookie', `huawei_demo=${identifier}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1200${publicOrigin.protocol === 'https:' ? '; Secure' : ''}`);
                }
                return send(response, 200, { csrf_token: session.csrf, examples: examples(), engine: ENGINE, session_ttl_seconds: 1200 });
            }
            if (request.method === 'POST' && url.pathname === '/api/runs') {
                const csrf = request.headers['x-csrf-token'];
                if (!session || !samePublicOriginHost(request.headers.origin) || request.headers['sec-fetch-site'] === 'cross-site' || typeof csrf !== 'string' || !/^[a-f0-9]{64}$/.test(csrf) || !crypto.timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf))) return fail(response, 403, 'CSRF_REJECTED', '会话或令牌无效，请刷新当前页面');
                if (active !== null) return fail(response, 409, 'BUSY', '已有演示运行，请稍后提交');
                if (session.runs >= 3 || globalRuns >= 60 || Date.now() - session.lastRun < 2000) return fail(response, 429, 'RATE_LIMIT', '每会话20分钟最多3次，需间隔2秒；请稍后重试');
                if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) return fail(response, 415, 'JSON_REQUIRED', '只接受application/json');
                if (Number(request.headers['content-length'] || 0) > BODY_LIMIT) { request.resume(); return fail(response, 413, 'BODY_TOO_LARGE', '公开演示请求最多4096字节'); }
                const body = await new Promise((resolve, reject) => {
                    let length = 0;
                    const chunks = [];
                    request.on('data', chunk => { length += chunk.length; if (length <= BODY_LIMIT) chunks.push(chunk); });
                    request.on('end', () => {
                        if (length > BODY_LIMIT) return reject(new PipelineError('BODY_TOO_LARGE', '公开演示请求最多4096字节'));
                        try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); } catch { reject(new PipelineError('INVALID_JSON', '必须提交有效UTF-8 JSON')); }
                    });
                    request.on('error', () => reject(new PipelineError('INVALID_JSON', '请求读取中断')));
                });
                const input = validateCloudInput(body);
                if (active !== null) return fail(response, 409, 'BUSY', '已有演示运行，请稍后提交');
                while (jobs.size >= 20) jobs.delete(jobs.keys().next().value);
                const id = crypto.randomUUID();
                const job = { id, status: 'running', result: null, markdown: null, error: null, created: Date.now(), session: session.id };
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
            const match = url.pathname.match(/^\/api\/runs\/([a-f0-9-]{36})(\/export)?$/i);
            if (request.method === 'GET' && match) {
                const job = jobs.get(match[1]);
                if (!session || !job || job.session !== session.id) return fail(response, 404, 'RUN_NOT_FOUND', '当前会话无此任务，或任务已过期');
                if (!match[2]) { const { session: omittedSession, created: omittedCreated, ...publicJob } = job; return send(response, 200, publicJob); }
                const format = url.searchParams.get('format');
                if (!['json', 'markdown'].includes(format) || [...url.searchParams.keys()].some(name => name !== 'format')) return fail(response, 400, 'EXPORT_FORMAT_INVALID', '仅允许json或markdown导出');
                if (job.status !== 'completed') return fail(response, 409, 'RUN_NOT_COMPLETED', '任务尚未完成');
                response.setHeader('Content-Disposition', `attachment; filename="huawei-demo-${job.id}.${format === 'json' ? 'json' : 'md'}"`);
                response.writeHead(200, { 'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8' });
                response.end(format === 'json' ? JSON.stringify(job.result, null, 2) + '\n' : job.markdown);
                return;
            }
            if (request.method === 'GET' && Object.hasOwn(STATIC, url.pathname)) {
                const [relative, type] = STATIC[url.pathname];
                let contents;
                try { contents = readStatic(relative); } catch { return fail(response, 404, 'NOT_FOUND', '资源不可用'); }
                response.writeHead(200, { 'Content-Type': type });
                response.end(contents);
                return;
            }
            fail(response, 404, 'NOT_FOUND', '页面或接口不存在');
        } catch (error) {
            if (response.headersSent) return response.end();
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
