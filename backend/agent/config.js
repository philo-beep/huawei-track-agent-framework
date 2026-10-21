'use strict';

const fs = require('node:fs');
const path = require('node:path');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(APP_ROOT, '.env');

function parseEnvLine(line) {
    const text = String(line || '').trim();
    if (!text || text.startsWith('#')) return null;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(text);
    if (!match) return null;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
    } else {
        const comment = value.search(/\s+#/);
        if (comment >= 0) value = value.slice(0, comment).trim();
    }
    return [match[1], value];
}

function loadEnvFile(file = ENV_PATH) {
    if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) return false;
    for (const line of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
        const parsed = parseEnvLine(line);
        if (parsed && process.env[parsed[0]] === undefined) process.env[parsed[0]] = parsed[1];
    }
    return true;
}

loadEnvFile();

function text(name, fallback = '') {
    const value = process.env[name];
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function integer(name, fallback, minimum, maximum) {
    const value = Number(text(name, String(fallback)));
    return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function bool(name, fallback = false) {
    const value = text(name, '').toLowerCase();
    if (!value) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(value)) return true;
    if (['0', 'false', 'no', 'off'].includes(value)) return false;
    return fallback;
}

function trimUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function modelConfig() {
    const provider = text('CLOUD_MODEL_PROVIDER', 'openai-compatible').toLowerCase();
    const apiKey = text('CLOUD_MODEL_API_KEY');
    const baseUrl = trimUrl(text('CLOUD_MODEL_BASE_URL'));
    const model = text('CLOUD_MODEL_NAME', 'deepseek-v4.1-flash');
    return {
        provider,
        apiKey,
        baseUrl,
        model,
        configured: Boolean(apiKey && baseUrl && model),
        timeoutMs: integer('CLOUD_MODEL_TIMEOUT_MS', 120000, 5000, 300000),
    };
}

function imaConfig() {
    const apiKey = text('IMA_OPENAPI_APIKEY');
    const clientId = text('IMA_OPENAPI_CLIENTID');
    return {
        apiKey,
        clientId,
        baseUrl: trimUrl(text('IMA_OPENAPI_BASE_URL', 'https://ima.qq.com')),
        knowledgeBaseId: text('IMA_OPENAPI_DEFAULT_KB_ID'),
        knowledgeBaseName: text('IMA_OPENAPI_DEFAULT_KB_NAME'),
        timeoutMs: integer('IMA_OPENAPI_TIMEOUT_MS', 30000, 3000, 120000),
        configured: Boolean(apiKey && clientId),
    };
}

function webConfig() {
    return {
        enabled: bool('WEB_RESEARCH_ENABLED', true),
        searchBaseUrl: trimUrl(text('WEB_SEARCH_BASE_URL', 'https://www.bing.com/search')),
        timeoutMs: integer('WEB_RESEARCH_TIMEOUT_MS', 20000, 3000, 60000),
        maxBytes: integer('WEB_RESEARCH_MAX_BYTES', 1048576, 65536, 5242880),
    };
}

function runtimeCapabilities() {
    const model = modelConfig();
    const ima = imaConfig();
    const web = webConfig();
    return {
        cloud_model_configured: model.configured,
        cloud_model_name: model.configured ? model.model : null,
        ima_configured: ima.configured,
        ima_knowledge_base_name: ima.knowledgeBaseName || null,
        web_research_configured: web.enabled,
    };
}

module.exports = {
    APP_ROOT,
    ENV_PATH,
    loadEnvFile,
    bool,
    integer,
    text,
    runtimeCapabilities,
    modelConfig,
    imaConfig,
    webConfig,
};