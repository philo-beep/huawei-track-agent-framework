'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PipelineError } = require('./support');
const { imaConfig } = require('./config');

const SKILL_DIR = path.join(__dirname, 'skills', 'ima-skill');
const SKILL_META = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'meta.json'), 'utf8'));
const SKILL_VERSION = SKILL_META.version || 'unknown';
const UPDATE_CHECK_FILE = path.join(os.tmpdir(), 'huawei-ima-skill-last-check');

let officialSkillApi = null;
function loadOfficialSkillApi() {
    if (officialSkillApi) return officialSkillApi;
    try {
        officialSkillApi = require(path.join(SKILL_DIR, 'ima_api.cjs')).imaApi;
        return officialSkillApi;
    } catch (error) {
        throw new PipelineError('IMA_SKILL_UNAVAILABLE', '官方 IMA Skill 未正确纳入或无法加载', false);
    }
}

function normalizeMessage(value) {
    return String(value || '').replace(/[\r\n]+/g, ' ').slice(0, 500);
}

function requestError(envelope) {
    const code = Number(envelope?.code);
    const retryable = code === 110010 || code === 110021;
    return new PipelineError('IMA_REQUEST_FAILED', `IMA OpenAPI 返回业务错误 ${code || 'unknown'}：${normalizeMessage(envelope?.msg)}${envelope?.request_id ? `；request_id=${envelope.request_id}` : ''}`, retryable);
}

const MIN_REQUEST_INTERVAL_MS = 1200;
let lastRequestAt = 0;
function sleep(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }

async function callOfficial(apiPath, body) {
    const officialApi = loadOfficialSkillApi();
    let lastError = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
        if (wait) await sleep(wait);
        lastRequestAt = Date.now();
        let raw;
        try {
            raw = await officialApi(apiPath, body, { lastCheckFile: UPDATE_CHECK_FILE });
        } catch (error) {
            if (error && error.code === -200) {
                throw new PipelineError('IMA_SKILL_UPDATE_AVAILABLE', normalizeMessage(error.msg || error.message || '官方 IMA Skill 需要更新'), false);
            }
            lastError = error;
            if (attempt < 5) { await sleep(5000 * (2 ** attempt)); continue; }
            throw new PipelineError('IMA_UNAVAILABLE', '官方 IMA Skill 调用失败；未记录凭据或完整请求体', true);
        }
        let envelope;
        try {
            envelope = JSON.parse(raw);
        } catch (error) {
            throw new PipelineError('IMA_INVALID_RESPONSE', 'IMA OpenAPI 返回了无法解析的响应', true);
        }
        if (envelope && envelope.code === 0) return envelope;
        const code = Number(envelope?.code);
        const retryable = code === 110010 || code === 110021 || code === 200001;
        if (retryable && attempt < 5) {
            await sleep(5000 * (2 ** attempt));
            lastError = requestError(envelope);
            continue;
        }
        throw requestError(envelope);
    }
    throw lastError || new PipelineError('IMA_UNAVAILABLE', 'IMA OpenAPI 调用失败', true);
}
function normalizeKnowledgeBase(item = {}) {
    const id = item.kb_id || item.id || '';
    const name = item.kb_name || item.name || id;
    return {
        kb_id: id,
        kb_name: name,
        description: String(item.description || ''),
        cover_url: String(item.cover_url || ''),
        member_count: item.member_count ?? null,
        content_count: item.content_count ?? null,
        creator: item.creator || null,
        role_type: item.role_type || null,
        base_type: item.base_type || null,
    };
}

async function searchKnowledgeBase(query, { cursor = '', limit = 20, maxPages = 10 } = {}) {
    const requestIds = [];
    const items = [];
    let nextCursor = cursor;
    for (let page = 0; page < maxPages; page += 1) {
        const envelope = await callOfficial('openapi/wiki/v1/search_knowledge_base', { query, cursor: nextCursor, limit });
        const data = envelope.data || {};
        if (envelope.request_id) requestIds.push(envelope.request_id);
        for (const item of data.info_list || []) items.push(normalizeKnowledgeBase(item));
        if (data.is_end !== false || !data.next_cursor || data.next_cursor === nextCursor) break;
        nextCursor = data.next_cursor;
    }
    return { request_id: requestIds[0] || null, request_ids: requestIds, info_list: items, knowledge_bases: items };
}

async function getKnowledgeBase(ids) {
    const envelope = await callOfficial('openapi/wiki/v1/get_knowledge_base', { ids });
    const infos = envelope.data?.infos || {};
    return {
        request_id: envelope.request_id || null,
        infos: Object.fromEntries(Object.entries(infos).map(([id, item]) => [id, normalizeKnowledgeBase({ id, ...item })])),
    };
}

async function getKnowledgeList({ knowledgeBaseId, folderId = '', cursor = '', limit = 50, maxPages = 20 } = {}) {
    if (!knowledgeBaseId) throw new PipelineError('IMA_KB_NOT_CONFIGURED', '未指定 IMA 知识库 ID');
    const requestIds = [];
    const entries = [];
    let currentPath = [];
    let nextCursor = cursor;
    let isEnd = false;
    for (let page = 0; page < maxPages; page += 1) {
        const payload = { knowledge_base_id: knowledgeBaseId, cursor: nextCursor, limit: Math.max(1, Math.min(50, Number(limit) || 50)) };
        if (folderId) payload.folder_id = folderId;
        const envelope = await callOfficial('openapi/wiki/v1/get_knowledge_list', payload);
        const data = envelope.data || {};
        if (envelope.request_id) requestIds.push(envelope.request_id);
        entries.push(...(data.knowledge_list || []));
        currentPath = data.current_path || currentPath;
        isEnd = data.is_end !== false;
        if (isEnd || !data.next_cursor || data.next_cursor === nextCursor) break;
        nextCursor = data.next_cursor;
    }
    return { request_id: requestIds[0] || null, request_ids: requestIds, knowledge_list: entries, current_path: currentPath, is_end: isEnd, next_cursor: isEnd ? null : nextCursor };
}

async function searchKnowledge(query, { knowledgeBaseId, cursor = '', limit = 20, maxPages = 10 } = {}) {
    const config = imaConfig();
    const kbId = knowledgeBaseId || config.knowledgeBaseId;
    if (!kbId) throw new PipelineError('IMA_KB_NOT_CONFIGURED', '未配置 IMA 默认知识库 ID');
    const requestIds = [];
    const entries = [];
    let nextCursor = cursor;
    for (let page = 0; page < maxPages; page += 1) {
        const envelope = await callOfficial('openapi/wiki/v1/search_knowledge', { query, cursor: nextCursor, knowledge_base_id: kbId, limit });
        const data = envelope.data || {};
        if (envelope.request_id) requestIds.push(envelope.request_id);
        entries.push(...(data.info_list || []));
        if (data.is_end === undefined || data.is_end !== false || !data.next_cursor || data.next_cursor === nextCursor) break;
        nextCursor = data.next_cursor;
    }
    return { request_id: requestIds[0] || null, request_ids: requestIds, knowledge_base_id: kbId, info_list: entries, is_end: true };
}

async function getMediaInfo(mediaId) {
    if (!mediaId) throw new PipelineError('IMA_MEDIA_ID_REQUIRED', '读取媒体信息必须提供 media_id');
    const envelope = await callOfficial('openapi/wiki/v1/get_media_info', { media_id: mediaId });
    const data = envelope.data || {};
    return {
        request_id: envelope.request_id || null,
        media_id: mediaId,
        media_type: data.media_type ?? null,
        url_info: data.url_info || null,
        notebook_ext_info: data.notebook_ext_info || null,
    };
}

async function getNoteContent(noteId) {
    if (!noteId) throw new PipelineError('IMA_NOTE_ID_REQUIRED', '读取笔记正文必须提供 note_id');
    const envelope = await callOfficial('openapi/note/v1/get_doc_content', { note_id: noteId, target_content_format: 0 });
    return {
        request_id: envelope.request_id || null,
        content: String(envelope.data?.content || ''),
        raw: envelope.data || {},
    };
}

function resolveKnowledgeBase(infoList, preferredName, preferredId) {
    const items = Array.isArray(infoList) ? infoList : [];
    if (preferredId) return items.find(item => (item.kb_id || item.id) === preferredId) || { kb_id: preferredId, kb_name: preferredName || '已配置知识库' };
    if (preferredName) {
        const exact = items.find(item => (item.kb_name || item.name) === preferredName);
        if (exact) return exact;
    }
    return items.find(item => /任德耀|华为|MateBook/i.test(`${item.kb_name || item.name || ''} ${item.description || ''}`)) || items[0] || null;
}

function evidenceReference(kb, item) {
    const fingerprint = crypto.createHash('sha256').update(`${kb.kb_id || kb.id}|${item.media_id}|${item.title}`).digest('hex');
    const excerpt = String(item.highlight_content || item.title || '').trim();
    return {
        title: item.title || item.media_id,
        archive_aliases: ['IMA', kb.kb_name || kb.name].filter(Boolean),
        entry: `ima-metadata:${kb.kb_id || kb.id}:${item.media_id}`,
        entry_sha256: fingerprint,
        urls: [],
        excerpt: excerpt || item.title || item.media_id,
    };
}

async function imaKnowledge(query, options = {}) {
    const config = imaConfig();
    const baseSearch = await searchKnowledgeBase(query, { limit: 20 });
    let kb = resolveKnowledgeBase(baseSearch.info_list, config.knowledgeBaseName, config.knowledgeBaseId);
    if (!kb && config.knowledgeBaseId) kb = { kb_id: config.knowledgeBaseId, kb_name: config.knowledgeBaseName || '已配置知识库' };
    if (!kb) return { status: 'no_knowledge_base', query, knowledge_bases: [], results: [], request_ids: baseSearch.request_ids, knowledge_base: null };
    const found = await searchKnowledge(query, { knowledgeBaseId: kb.kb_id || kb.id, limit: options.limit || 20 });
    const results = (Array.isArray(found.info_list) ? found.info_list : []).map(item => ({
        media_id: item.media_id,
        title: item.title,
        parent_folder_id: item.parent_folder_id || null,
        highlight_content: item.highlight_content || '',
        media_type: item.media_type ?? null,
        source_ref: evidenceReference(kb, item),
    }));
    return {
        status: 'connected',
        query,
        knowledge_base: kb,
        knowledge_bases: baseSearch.info_list,
        results,
        request_ids: [...baseSearch.request_ids, ...found.request_ids],
    };
}

async function probeIma() {
    const result = await searchKnowledgeBase('华为 MateBook', { limit: 5 });
    const kb = resolveKnowledgeBase(result.info_list, imaConfig().knowledgeBaseName, imaConfig().knowledgeBaseId);
    if (!kb) return { status: 'connected_no_knowledge_base', request_id: result.request_id || null, knowledge_base: null };
    const found = await searchKnowledge('MateBook 14', { knowledgeBaseId: kb.kb_id || kb.id, limit: 3 });
    return {
        status: 'ok',
        request_id: found.request_id || result.request_id || null,
        knowledge_base: { kb_id: kb.kb_id || kb.id, kb_name: kb.kb_name || kb.name },
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
    SKILL_VERSION,
    imaKnowledge,
    probeIma,
    searchKnowledgeBase,
    getKnowledgeBase,
    getKnowledgeList,
    searchKnowledge,
    getMediaInfo,
    getNoteContent,
    credentialEnvironment,
    officialCall: probeIma,
    search_knowledge_base: searchKnowledgeBase,
    get_knowledge_list: getKnowledgeList,
    search_knowledge: searchKnowledge,
    get_media_info: getMediaInfo,
};


