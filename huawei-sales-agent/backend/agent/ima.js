'use strict';

const crypto = require('node:crypto');
const { PipelineError } = require('./support');
const { imaConfig } = require('./config');

function requireConfig() {
    const config = imaConfig();
    if (!config.configured) throw new PipelineError('IMA_NOT_CONFIGURED', 'IMA OpenAPI 凭据未配置；未发送请求');
    return config;
}

function normalizeMessage(value) {
    return String(value || '').replace(/[\r\n]+/g, ' ').slice(0, 300);
}

async function postJson(endpoint, payload) {
    const config = requireConfig();
    const url = `${config.baseUrl}/${String(endpoint).replace(/^\/+/, '')}`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'ima-openapi-clientid': config.clientId,
                'ima-openapi-apikey': config.apiKey,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(config.timeoutMs),
        });
        if (!response.ok) throw new PipelineError('IMA_REQUEST_FAILED', `IMA OpenAPI 返回 HTTP ${response.status}；未记录凭据或请求体`, response.status >= 500 || response.status === 429);
        const data = await response.json();
        if (!data || data.code !== 0) throw new PipelineError('IMA_REQUEST_FAILED', `IMA OpenAPI 返回业务错误：${normalizeMessage(data?.msg || data?.code || 'unknown')}`);
        return data;
    } catch (error) {
        if (error instanceof PipelineError) throw error;
        if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new PipelineError('IMA_TIMEOUT', 'IMA OpenAPI 调用超时，未重复发送', true);
        throw new PipelineError('IMA_UNAVAILABLE', 'IMA OpenAPI 连接失败；未记录凭据或完整请求体', true);
    }
}

async function searchKnowledgeBase(query, { cursor = '', limit = 20 } = {}) {
    const data = await postJson('/openapi/wiki/v1/search_knowledge_base', { query, cursor, limit });
    return { request_id: data.request_id || null, ...(data.data || {}) };
}

async function getKnowledgeBase(ids) {
    const data = await postJson('/openapi/wiki/v1/get_knowledge_base', { ids });
    return { request_id: data.request_id || null, ...(data.data || {}) };
}

async function searchKnowledge(query, { knowledgeBaseId, cursor = '', limit = 20 } = {}) {
    const config = requireConfig();
    const kbId = knowledgeBaseId || config.knowledgeBaseId;
    if (!kbId) throw new PipelineError('IMA_KB_NOT_CONFIGURED', '未配置 IMA 默认知识库 ID');
    const data = await postJson('/openapi/wiki/v1/search_knowledge', { query, cursor, knowledge_base_id: kbId });
    return { request_id: data.request_id || null, knowledge_base_id: kbId, ...(data.data || {}) };
}

function resolveKnowledgeBase(infoList, preferredName, preferredId) {
    const items = Array.isArray(infoList) ? infoList : [];
    if (preferredId) return items.find(item => item.kb_id === preferredId) || { kb_id: preferredId, kb_name: preferredName || '已配置知识库' };
    if (preferredName) {
        const exact = items.find(item => item.kb_name === preferredName);
        if (exact) return exact;
    }
    return items.find(item => /任德耀|华为|MateBook/i.test(`${item.kb_name || ''} ${item.description || ''}`)) || items[0] || null;
}

function evidenceReference(kb, item) {
    const fingerprint = crypto.createHash('sha256').update(`${kb.kb_id}|${item.media_id}|${item.title}`).digest('hex');
    const excerpt = String(item.highlight_content || item.title || '').trim();
    return {
        title: item.title || item.media_id,
        archive_aliases: ['IMA', kb.kb_name].filter(Boolean),
        entry: `ima-metadata:${kb.kb_id}:${item.media_id}`,
        entry_sha256: fingerprint,
        urls: [],
        excerpt: excerpt || item.title || item.media_id,
    };
}

async function imaKnowledge(query, options = {}) {
    const config = requireConfig();
    const baseSearch = await searchKnowledgeBase(query, { limit: 20 });
    let kb = resolveKnowledgeBase(baseSearch.info_list, config.knowledgeBaseName, config.knowledgeBaseId);
    if (!kb && config.knowledgeBaseId) kb = { kb_id: config.knowledgeBaseId, kb_name: config.knowledgeBaseName || '已配置知识库' };
    if (!kb) return { status: 'no_knowledge_base', query, knowledge_bases: [], results: [], request_ids: [baseSearch.request_id].filter(Boolean), knowledge_base: null };
    const found = await searchKnowledge(query, { knowledgeBaseId: kb.kb_id, limit: options.limit || 20 });
    const results = (Array.isArray(found.info_list) ? found.info_list : []).slice(0, options.limit || 20).map(item => ({
        media_id: item.media_id,
        title: item.title,
        parent_folder_id: item.parent_folder_id,
        highlight_content: item.highlight_content || '',
        media_type: item.media_type ?? null,
        source_ref: evidenceReference(kb, item),
    }));
    return {
        status: 'connected',
        query,
        knowledge_base: kb,
        knowledge_bases: Array.isArray(baseSearch.info_list) ? baseSearch.info_list : [],
        results,
        request_ids: [baseSearch.request_id, found.request_id].filter(Boolean),
    };
}

async function probeIma() {
    const result = await searchKnowledgeBase('华为 MateBook', { limit: 5 });
    const kb = resolveKnowledgeBase(result.info_list, imaConfig().knowledgeBaseName, imaConfig().knowledgeBaseId);
    if (!kb) return { status: 'connected_no_knowledge_base', request_id: result.request_id || null, knowledge_base: null };
    const found = await searchKnowledge('MateBook 14', { knowledgeBaseId: kb.kb_id, limit: 3 });
    return {
        status: 'ok',
        request_id: found.request_id || result.request_id || null,
        knowledge_base: { kb_id: kb.kb_id, kb_name: kb.kb_name },
        result_count: Array.isArray(found.info_list) ? found.info_list.length : 0,
        sample_titles: (found.info_list || []).slice(0, 3).map(item => item.title),
    };
}

function credentialEnvironment() {
    const environment = { ...process.env };
    for (const name of Object.keys(environment)) if (/^IMA_/i.test(name)) delete environment[name];
    return environment;
}

module.exports = {
    imaKnowledge,
    probeIma,
    searchKnowledgeBase,
    getKnowledgeBase,
    searchKnowledge,
    credentialEnvironment,
    officialCall: probeIma,
    search_knowledge_base: searchKnowledgeBase,
    get_knowledge_list: getKnowledgeBase,
    search_knowledge: searchKnowledge,
};