'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const { webConfig } = require('./config');
const { PipelineError } = require('./support');
const { loadOfficialReference } = require('./official');

const OFFICIAL_HOSTS = new Set(['consumer.huawei.com', 'www.huawei.com', 'huawei.com', 'www.vmall.com', 'vmall.com', 'm.vmall.com']);

function decodeEntities(value) {
    return String(value || '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
        .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(Number.parseInt(number, 16)));
}

function stripHtml(value) {
    return decodeEntities(String(value || '')
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)>/gi, '\n')
        .replace(/<[^>]+>/g, ' '))
        .replace(/\r/g, '')
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n\n')
        .trim();
}

function privateAddress(address) {
    const value = String(address || '').toLowerCase();
    if (value.startsWith('::ffff:')) return privateAddress(value.slice(7));
    if (value.includes(':')) return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb');
    const parts = value.split('.').map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) || parts[0] >= 224;
}

async function validatePublicUrl(raw, allowedHosts = null) {
    let url;
    try { url = new URL(raw); } catch { throw new PipelineError('WEB_URL_INVALID', '网页地址格式无效'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new PipelineError('WEB_URL_FORBIDDEN', '只允许无账号信息的公开 HTTP/HTTPS 页面');
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (allowedHosts && !allowedHosts.has(hostname)) throw new PipelineError('WEB_HOST_FORBIDDEN', `抓取域名不在允许范围：${hostname}`);
    if (hostname === 'localhost' || hostname.endsWith('.local')) throw new PipelineError('WEB_HOST_FORBIDDEN', '不允许抓取本机或局域网地址');
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) {
        if (privateAddress(hostname)) throw new PipelineError('WEB_HOST_FORBIDDEN', '不允许抓取私有或本机 IP');
        return url;
    }
    let resolved;
    try { resolved = await dns.lookup(hostname, { all: true }); }
    catch { throw new PipelineError('WEB_HOST_UNRESOLVED', `无法解析抓取域名：${hostname}`, true); }
    if (!resolved.length || resolved.some(item => privateAddress(item.address))) throw new PipelineError('WEB_HOST_FORBIDDEN', '域名解析到私有或本机地址，已阻止抓取');
    return url;
}

async function fetchLimited(url, options = {}) {
    const config = webConfig();
    const timeoutMs = options.timeoutMs || config.timeoutMs;
    const maxBytes = options.maxBytes || config.maxBytes;
    const allowedHosts = options.allowedHosts || null;
    let current = await validatePublicUrl(url, allowedHosts);
    for (let redirect = 0; redirect < 4; redirect += 1) {
        let response;
        try {
            response = await fetch(current, {
                redirect: 'manual',
                headers: { 'User-Agent': 'HuaweiSalesAgent/1.0 (+traceable-public-research)', Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1' },
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (error) {
            if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new PipelineError('WEB_TIMEOUT', '公开网页抓取超时，未重复发送', true);
            throw new PipelineError('WEB_UNAVAILABLE', '公开网页或搜索服务连接失败；未记录请求正文或凭据', true);
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            if (!location) throw new PipelineError('WEB_REDIRECT_INVALID', '网页重定向缺少目标地址');
            current = await validatePublicUrl(new URL(location, current).href, allowedHosts);
            continue;
        }
        if (!response.ok) throw new PipelineError('WEB_FETCH_FAILED', `网页抓取返回 HTTP ${response.status}`, response.status >= 500 || response.status === 429);
        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        const allowedContent = options.allowContentTypes || /(?:text\/html|application\/xhtml\+xml|text\/plain)/i;
        if (!allowedContent.test(contentType)) throw new PipelineError('WEB_CONTENT_TYPE_UNSUPPORTED', `网页内容类型不受支持：${contentType || 'unknown'}`);
        const reader = response.body.getReader();
        const chunks = [];
        let length = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > maxBytes) {
                await reader.cancel();
                throw new PipelineError('WEB_BODY_TOO_LARGE', `网页正文超过 ${maxBytes} 字节限制`);
            }
            chunks.push(Buffer.from(value));
        }
        return { url: current.href, contentType, bytes: Buffer.concat(chunks), fetchedAt: new Date().toISOString() };
    }
    throw new PipelineError('WEB_REDIRECT_LIMIT', '网页重定向次数过多');
}

function rssTag(block, name) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(block);
    return match ? stripHtml(match[1]) : '';
}

function parseBraveResults(html) {
    const results = [];
    const links = /<a\s+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = links.exec(html))) {
        const url = decodeEntities(match[1]);
        if (/^https?:\/\/(?:www\.)?(?:search\.brave\.com|imgs\.search\.brave\.com)\//i.test(url)) continue;
        const titleMatch = /<div[^>]+class="[^"]*search-snippet-title[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(match[2]);
        if (!titleMatch) continue;
        const tail = html.slice(links.lastIndex, links.lastIndex + 3000);
        const snippetMatch = /<div[^>]+class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(tail);
        const title = stripHtml(titleMatch[1]);
        const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : '';
        if (title && !results.some(item => item.url === url)) results.push({ title, url, snippet, published_at: null });
    }
    return results;
}

function parseRss(xml) {
    const items = [];
    const pattern = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = pattern.exec(xml))) {
        const title = rssTag(match[1], 'title');
        const link = rssTag(match[1], 'link');
        if (/^https?:\/\//i.test(link)) items.push({ title, url: link, snippet: rssTag(match[1], 'description'), published_at: rssTag(match[1], 'pubDate') || null });
    }
    return items;
}

async function searchWeb(query, options = {}) {
    const config = webConfig();
    if (!config.enabled) throw new PipelineError('WEB_RESEARCH_DISABLED', '联网检索已停用');
    const search = new URL(config.searchBaseUrl);
    search.searchParams.set('q', String(query || '').slice(0, 500));
    const brave = /(^|\.)search\.brave\.com$/i.test(search.hostname);
    if (!brave) search.searchParams.set('format', 'rss');
    else search.searchParams.set('source', 'web');
    const fetched = await fetchLimited(search.href, {
        timeoutMs: config.timeoutMs,
        maxBytes: 1048576,
        allowContentTypes: brave ? /text\/html/i : /(?:application\/(?:rss|atom)\+xml|text\/xml|text\/html)/i,
    });
    const html = fetched.bytes.toString('utf8');
    return (brave ? parseBraveResults(html) : parseRss(html))
        .filter(item => /^https?:\/\//i.test(item.url))
        .slice(0, options.maxResults || 6);
}

async function inspectWebPage(url, options = {}) {
    const fetched = await fetchLimited(url, { allowedHosts: options.allowedHosts || OFFICIAL_HOSTS });
    const body = fetched.bytes.toString('utf8');
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
    const descriptionMatch = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i.exec(body);
    const text = stripHtml(body);
    return {
        title: titleMatch ? stripHtml(titleMatch[1]) : new URL(fetched.url).hostname,
        url: fetched.url,
        snippet: descriptionMatch ? stripHtml(descriptionMatch[1]) : '',
        fetched_at: fetched.fetchedAt,
        content_sha256: crypto.createHash('sha256').update(fetched.bytes).digest('hex'),
        excerpt: text.slice(0, options.maxChars || 5000),
        limitations: ['公开网页抓取结果，不代表实时库存、正式报价或兼容性认证', '内容按原始页面抓取并保留 URL、抓取时间和 SHA-256'],
    };
}

async function liveResearch(query, options = {}) {
    const allowedHosts = options.allowedHosts === undefined ? OFFICIAL_HOSTS : options.allowedHosts;
    const results = await searchWeb(query, { maxResults: options.maxResults || 6 });
    const selected = results.filter(item => !allowedHosts || allowedHosts.has(new URL(item.url).hostname.toLowerCase())).slice(0, options.maxFetch || 2);
    const pages = [];
    for (const item of selected) {
        try { pages.push({ ...await inspectWebPage(item.url, { allowedHosts, maxChars: options.maxChars || 5000 }), search_snippet: item.snippet }); }
        catch (error) { pages.push({ title: item.title, url: item.url, snippet: item.snippet, fetched_at: new Date().toISOString(), content_sha256: null, excerpt: item.snippet, error: error instanceof PipelineError ? error.code : 'WEB_FETCH_FAILED' }); }
    }
    return pages;
}

async function researchHuawei(product, scenario) {
    const queries = [
        `site:consumer.huawei.com ${product} 规格`,
        `site:vmall.com ${product} 价格`,
    ];
    const collected = [];
    const seen = new Set();
    const normalizedProduct = String(product || '').toLowerCase().replace(/\s+/g, '');
    for (const query of queries) {
        try {
            const found = await searchWeb(query, { maxResults: 8 });
            const relevant = found.filter(item => OFFICIAL_HOSTS.has(new URL(item.url).hostname.toLowerCase()) && (!normalizedProduct || `${item.title} ${item.snippet}`.toLowerCase().replace(/\s+/g, '').includes(normalizedProduct.slice(0, 10))));
            for (const item of relevant.slice(0, 1)) {
                if (seen.has(item.url)) continue;
                seen.add(item.url);
                try { collected.push({ ...await inspectWebPage(item.url, { allowedHosts: OFFICIAL_HOSTS, maxChars: 3500 }), search_snippet: item.snippet }); }
                catch { }
            }
        } catch { }
    }
    const reference = loadOfficialReference(product);
    for (const source of reference.sources || []) {
        if (seen.has(source.url) || !/^https:\/\//i.test(source.url)) continue;
        seen.add(source.url);
        try { collected.push({ ...await inspectWebPage(source.url, { allowedHosts: OFFICIAL_HOSTS, maxChars: 3500 }), search_snippet: '来自已核验官网快照清单的实时抓取种子' }); }
        catch (error) { collected.push({ title: source.url, url: source.url, snippet: '官网快照来源实时抓取失败', fetched_at: new Date().toISOString(), content_sha256: null, excerpt: '', error: error instanceof PipelineError ? error.code : 'WEB_FETCH_FAILED' }); }
        if (collected.length >= 3) break;
    }
    return collected.slice(0, 3);
}

module.exports = { searchWeb, inspectWebPage, liveResearch, researchHuawei, validatePublicUrl, stripHtml, parseRss, parseBraveResults, OFFICIAL_HOSTS };