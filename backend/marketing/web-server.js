'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ROOT, schema, validateSchema, PipelineError } = require('./support');
const { validateExtended } = require('./pricing');
const { runFourSteps, renderMarkdown } = require('./fourstep');

const BODY_LIMIT = 65536;
const JOB_LIMIT = 20;
const IDENTIFIER = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/style.css': ['styles.css', 'text/css; charset=utf-8'] };

function examples() {
    const pricing = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs/D/synthetic-stage2/pricing-demo-input.json'), 'utf8').replace(/^\uFEFF/, ''));
    pricing.policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs/D/synthetic-stage2/pricing-demo-policy.json'), 'utf8').replace(/^\uFEFF/, ''));
    const build = (id, label, product, scenario) => {
        const price = structuredClone(pricing);
        price.product = product;
        price.policy.product = product;
        return { id, label, synthetic: true, marketing_input: { product, audience: '合成示例：移动办公用户', ...(scenario ? { scenario } : {}), platform: '公众号', mode: 'local' }, pricing_input: price };
    };
    return [build('official-harmony', '合成案例一：鸿蒙版官网系列规格，假设价格非交易报价', 'HUAWEI MateBook 14 鸿蒙版', '移动办公文稿打开、编辑与导出任务核对'), build('local-family', '合成案例二：泛名回退任德耀本地原文，代际待确认', 'HUAWEI MateBook 14', '移动办公选型，先确认软件和完整型号'), build('needs-clarification', '合成案例三：缺少场景，展示需澄清状态；不猜预算', 'HUAWEI MateBook 14', null)];
}

function sendJson(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
}

function failure(response, status, code, message) {
    sendJson(response, status, { error: { code, message } });
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let length = 0;
        const chunks = [];
        let failed = false;
        request.on('data', chunk => {
            length += chunk.length;
            if (length > BODY_LIMIT) {
                if (!failed) reject(new PipelineError('BODY_TOO_LARGE', '请求体最多65536字节'));
                failed = true;
                chunks.length = 0;
            } else if (!failed) chunks.push(chunk);
        });
        request.on('end', () => {
            if (failed) return;
            try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); } catch { reject(new PipelineError('INVALID_JSON', '请求不是有效UTF-8 JSON对象')); }
        });
        request.on('error', () => reject(new PipelineError('REQUEST_INTERRUPTED', '请求读取中断')));
    });
}

function validateRequest(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(name => !['marketing_input', 'pricing_input'].includes(name))) throw new PipelineError('INVALID_INPUT', '只允许marketing_input和pricing_input业务对象');
    if (!body.marketing_input || typeof body.marketing_input !== 'object' || Array.isArray(body.marketing_input)) throw new PipelineError('INVALID_INPUT', '必须提供marketing_input对象');
    if (body.marketing_input.revision) throw new PipelineError('PATH_INPUT_FORBIDDEN', '网页不接受历史结果路径；修改后重新提交完整业务输入');
    validateSchema(body.marketing_input, schema('input'));
    const pricingSchema = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts/pricing-input.schema.json'), 'utf8'));
    if (body.pricing_input !== undefined) validateExtended(body.pricing_input, pricingSchema);
}

function createWebServer(options = {}) {
    const runner = options.runner || runFourSteps;
    const jobs = new Map();
    const csrfToken = crypto.randomBytes(32).toString('hex');
    let active = null;
    const server = http.createServer(async (request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
        const port = server.address()?.port || options.port || 8765;
        const host = request.headers.host;
        if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) return failure(response, 403, 'HOST_FORBIDDEN', '仅允许当前端口的本机同源访问');
        const origin = `http://${host}`;
        if (request.headers.origin && request.headers.origin !== origin) return failure(response, 403, 'ORIGIN_FORBIDDEN', '请求来源与当前页面不同源');
        if (request.headers['sec-fetch-site'] === 'cross-site') return failure(response, 403, 'ORIGIN_FORBIDDEN', '不接受跨站访问');
        let url;
        try { url = new URL(request.url, origin); } catch { return failure(response, 400, 'INVALID_PATH', '请求路径无效'); }
        if (url.origin !== origin || url.username || url.password) return failure(response, 400, 'INVALID_PATH', '不允许代理外部网址');
        const pathname = url.pathname;
        try {
            if (request.method === 'GET' && ['/health', '/api/health'].includes(pathname)) return sendJson(response, 200, { status: 'ok', busy: active !== null, ima_enabled: false, model: 'qwen2.5vl:7b', model_ready: 'not_probed', source_manifest_available: fs.existsSync(path.join(ROOT, 'data/official/manifest.json')) });
            if (request.method === 'GET' && pathname === '/api/examples') return sendJson(response, 200, { csrf_token: csrfToken, examples: examples() });
            if (request.method === 'POST' && pathname === '/api/runs') {
                const candidate = request.headers['x-csrf-token'];
                if (request.headers.origin !== origin || typeof candidate !== 'string' || !/^[a-f0-9]{64}$/.test(candidate) || !crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(csrfToken))) return failure(response, 403, 'CSRF_REJECTED', '请从本机网页重新获取案例后提交，同源与请求令牌必须有效');
                if (active !== null) return failure(response, 409, 'BUSY', '已有任务正在运行，通常需30至120秒；请等待当前结果，不重复提交');
                if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) return failure(response, 415, 'JSON_REQUIRED', '请求Content-Type必须为application/json');
                if (request.headers['content-length'] && (!/^\d+$/.test(request.headers['content-length']) || Number(request.headers['content-length']) > BODY_LIMIT)) { request.resume(); return failure(response, 413, 'BODY_TOO_LARGE', '请求体最多65536字节'); }
                const body = await readBody(request);
                validateRequest(body);
                if (active !== null) return failure(response, 409, 'BUSY', '另一任务已开始；请等待当前结果');
                while (jobs.size >= JOB_LIMIT) jobs.delete(jobs.keys().next().value);
                const id = crypto.randomUUID();
                const job = { id, status: 'running', result: null, markdown: null, error: null };
                jobs.set(id, job);
                active = id;
                sendJson(response, 202, { id, status: 'running' });
                setImmediate(async () => {
                    try {
                        const result = await runner(body.marketing_input, body.pricing_input);
                        const markdown = renderMarkdown(result);
                        job.result = result;
                        job.markdown = markdown;
                        job.status = 'completed';
                    } catch {
                        job.status = 'failed';
                        job.error = { code: 'RUN_FAILED', message: '执行未完成，请检查本地模型与数据是否可用；未输出客户原文或内部异常' };
                    } finally { if (active === id) active = null; }
                });
                return;
            }
            const match = pathname.match(/^\/api\/runs\/([^/]+)(\/export)?$/);
            if (request.method === 'GET' && match) {
                if (!IDENTIFIER.test(match[1]) || !jobs.has(match[1])) return failure(response, 404, 'RUN_NOT_FOUND', '任务不存在、已清理或服务已重启');
                const job = jobs.get(match[1]);
                if (!match[2]) return sendJson(response, 200, job);
                const format = url.searchParams.get('format');
                if (!['json', 'markdown'].includes(format) || [...url.searchParams.keys()].some(name => name !== 'format')) return failure(response, 400, 'EXPORT_FORMAT_INVALID', '导出格式只允许json或markdown');
                if (job.status !== 'completed') return failure(response, 409, 'RUN_NOT_COMPLETED', '任务尚未完成，暂不能导出');
                response.setHeader('Content-Disposition', `attachment; filename="huawei-${job.id}.${format === 'json' ? 'json' : 'md'}"`);
                response.writeHead(200, { 'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8' });
                response.end(format === 'json' ? JSON.stringify(job.result, null, 2) + '\n' : job.markdown);
                return;
            }
            if (request.method === 'GET' && Object.hasOwn(STATIC, pathname)) {
                const [name, type] = STATIC[pathname];
                const target = path.join(ROOT, 'frontend/growth', name);
                for (const relative of ['frontend', 'frontend/growth', `frontend/growth/${name}`]) if (fs.lstatSync(path.join(ROOT, relative)).isSymbolicLink()) return failure(response, 404, 'STATIC_UNAVAILABLE', '页面资源不可用');
                const content = fs.readFileSync(target);
                response.writeHead(200, { 'Content-Type': type });
                response.end(content);
                return;
            }
            failure(response, 404, 'NOT_FOUND', '未找到允许访问的页面或接口');
        } catch (error) {
            if (response.headersSent) { response.end(); return; }
            const known = error instanceof PipelineError;
            failure(response, error.code === 'BODY_TOO_LARGE' ? 413 : known ? 400 : 500, known ? error.code : 'REQUEST_FAILED', known ? error.message : '请求无法完成，请检查页面与本地数据；未输出内部异常');
        }
    });
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    server.keepAliveTimeout = 5000;
    return server;
}

async function startServer(options = {}) {
    const server = createWebServer(options);
    const port = options.port === undefined ? 8765 : options.port;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    return server;
}

async function cli(args = []) {
    try {
        if (args.length && (args.length !== 2 || args[0] !== '--port' || !/^\d+$/.test(args[1]))) throw new Error('INVALID_ARGUMENTS');
        const port = args.length ? Number(args[1]) : 8765;
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_PORT');
        const server = await startServer({ port });
        process.stdout.write(JSON.stringify({ status: 'listening', url: `http://127.0.0.1:${server.address().port}/`, ima_enabled: false }) + '\n');
        return server;
    } catch {
        process.stderr.write('本地网页启动失败：请检查端口占用；用法 node backend/marketing/web-server.js [--port 8765]\n');
        process.exitCode = 1;
        return null;
    }
}

if (require.main === module) cli(process.argv.slice(2));

module.exports = { createWebServer, createServer: createWebServer, startServer, cli, examples, validateRequest, BODY_LIMIT, JOB_LIMIT };
