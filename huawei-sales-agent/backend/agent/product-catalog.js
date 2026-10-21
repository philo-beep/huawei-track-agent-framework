'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ROOT, PipelineError } = require('./support');

const DEFAULT_DATA_ROOT = path.resolve(ROOT, '..', 'huawei-sales-agent-data');
const DATA_ROOT = process.env.HUAWEI_DATA_ROOT ? path.resolve(process.env.HUAWEI_DATA_ROOT) : DEFAULT_DATA_ROOT;
const INDEX_PATH = process.env.HUAWEI_MATCH_INDEX_PATH ? path.resolve(process.env.HUAWEI_MATCH_INDEX_PATH) : path.join(DATA_ROOT, 'datasets', 'cleaned', 'local_kb_index.json');

const TERM_ALIASES = Object.freeze({
    '移动办公': ['移动办公', '差旅', '便携', '轻薄', '重量'],
    '长续航': ['长续航', '续航', '电池', 'wh', '小时'],
    '软件兼容性': ['兼容', '操作系统', '软件', 'windows', 'harmonyos', '应用'],
    '专业设计': ['设计', '显卡', '处理器', '内存', '屏幕', '色彩'],
    '大屏': ['大屏', '屏幕', '英寸', 'oled'],
    '触控': ['触控', '触摸', '手写'],
    '便携': ['便携', '轻薄', '重量', 'kg'],
    '安静': ['静音', '噪音', '散热'],
    '低噪': ['静音', '噪音', '低噪', '散热'],
    '办公': ['办公', '文档', '键盘', '会议'],
    '打印': ['打印', '粉盒', '硒鼓', '喷头', '墨水'],
    '扫描': ['扫描', '打印'],
    '显示器': ['显示器', 'mateview', '屏幕'],
    '鼠标': ['鼠标'],
    '键盘': ['键盘'],
    '电脑': ['电脑', '笔记本', 'matebook', '擎云'],
    '笔记本': ['笔记本', 'matebook', '擎云'],
    '台式机': ['台式机', '擎云 w', 'desktop'],
    '平板': ['平板', 'matepad'],
});

const PRODUCT_TYPE_ALIASES = Object.freeze({
    '电脑': ['电脑', '笔记本', '台式机', 'matebook', '擎云'],
    '笔记本': ['笔记本', 'matebook', '擎云'],
    '台式机': ['台式机', '擎云 w', 'desktop'],
    '打印机': ['打印机', 'pixlab', '毕昇', '粉盒', '硒鼓'],
    '显示器': ['显示器', 'mateview'],
    '配件': ['鼠标', '键盘', 'matedock', '充电器', 'm-pen', '包'],
});

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeName(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, '').trim();
}

function cleanProductTitle(value) {
    return String(value || '')
        .replace(/^#+\s*/, '')
        .replace(/[|｜].*$/, '')
        .replace(/\s*[-—]\s*产品事实\s*$/i, '')
        .replace(/官方公开价格卡\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
}

function inferCategory(text, name = '') {
    const productName = String(name || '').toLowerCase();
    const structured = (String(text || '').match(/产品类别[：:]\s*([^\n]+)/) || [])[1] || '';
    const detail = String(text || '').toLowerCase();
    if (/pixlab|毕昇|打印机|粉盒|硒鼓|喷头|墨水/.test(productName)) return '打印机与耗材';
    if (/mateview|显示器/.test(productName)) return '显示器';
    if (/鼠标|键盘|matedock|充电器|m-pen|内胆包|双肩包/.test(productName)) return '电脑配件';
    if (/matebook fold|折叠电脑/.test(productName) || /折叠电脑/.test(structured)) return '折叠电脑';
    if (/擎云\s*w|台式机/.test(productName) || /台式机/.test(structured)) return '商用台式机';
    if (/擎云|商用/.test(productName) || /商用电脑/.test(structured)) return '商用笔记本';
    if (/matebook|笔记本|laptop/.test(productName) || /笔记本/.test(structured)) return '消费笔记本';
    if (/打印机|喷墨|激光|粉盒|硒鼓|喷头|墨水/.test(detail)) return '打印机与耗材';
    if (/显示器|mateview|m27[0-9]|b3-24/.test(detail)) return '显示器';
    if (/鼠标|键盘|matedock|m-pen|内胆包|双肩包/.test(productName)) return '电脑配件';
    if (/折叠电脑/.test(detail)) return '折叠电脑';
    if (/台式机|擎云 w|desktop/.test(detail)) return '商用台式机';
    if (/商用电脑|擎云/.test(detail)) return '商用笔记本';
    if (/笔记本|matebook|laptop/.test(detail)) return '消费笔记本';
    return '其他产品';
}

function inferFamily(name) {
    const text = String(name || '');
    const patterns = [
        'MateBook Fold', 'MateBook Pro', 'MateBook X', 'MateBook D', 'MateBook GT', 'MateBook 14',
        '擎云 HM', '擎云 L', '擎云 W', 'MateView', 'PixLab', '毕昇', '擎云 P5', '擎云 M', '华为显示器',
    ];
    return patterns.find(pattern => text.toLowerCase().includes(pattern.toLowerCase())) || text.split(/\s+/).slice(0, 2).join(' ') || '待确认系列';
}

function termTerms(value) {
    const base = String(value || '').trim().toLowerCase();
    if (!base) return [];
    const aliases = TERM_ALIASES[String(value || '').trim()] || [];
    return [...new Set([base, ...aliases.map(item => item.toLowerCase())].filter(Boolean))];
}

function criterionMatches(text, value) {
    const haystack = String(text || '').toLowerCase();
    return termTerms(value).some(token => haystack.includes(token));
}

function productTypeMatches(candidate, productType) {
    if (!productType) return true;
    const haystack = `${candidate.product_name} ${candidate.category} ${candidate.product_family}`.toLowerCase();
    const terms = PRODUCT_TYPE_ALIASES[productType] || [productType.toLowerCase()];
    return terms.some(term => haystack.includes(term.toLowerCase()));
}

function sourceUrl(source, text) {
    const explicit = Array.isArray(source?.urls) ? source.urls.find(Boolean) : null;
    if (explicit) return explicit;
    const match = String(text || '').match(/https:\/\/[^\s)>]+/i);
    return match ? match[0] : null;
}

function retrievedAt(text, fallback) {
    const match = String(text || '').match(/(?:抓取日期|核验时间|快照日期)[：:]\s*([^\n]+)/);
    return match ? match[1].trim() : fallback || null;
}

function readIndex(indexOverride) {
    try {
        const raw = indexOverride ? JSON.stringify(indexOverride) : fs.readFileSync(INDEX_PATH, 'utf8').replace(/^\uFEFF/, '');
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.documents)) throw new Error('documents missing');
        return { data: parsed, raw, indexPath: indexOverride ? 'injected-index' : INDEX_PATH };
    } catch (error) {
        throw new PipelineError('MATCH_INDEX_UNAVAILABLE', '产品匹配索引不可读或结构异常；未生成候选');
    }
}

function buildLocalCatalog(indexData) {
    const documents = Array.isArray(indexData?.documents) ? indexData.documents : [];
    const prices = Array.isArray(indexData?.price_records) ? indexData.price_records : [];
    const groups = new Map();
    for (const document of documents) {
        const names = Array.isArray(document.product_names) ? document.product_names.filter(Boolean) : [];
        for (const rawName of names) {
            const productName = cleanProductTitle(rawName);
            const key = normalizeName(productName);
            if (!key) continue;
            if (!groups.has(key)) groups.set(key, { key, productName, aliases: new Set(), documents: [], prices: [] });
            const group = groups.get(key);
            group.aliases.add(String(rawName));
            group.documents.push(document);
        }
    }
    for (const price of prices) {
        const name = cleanProductTitle(price?.raw_fields?.['规范产品名称'] || '');
        const group = groups.get(normalizeName(name));
        if (group) group.prices.push(price);
    }
    return [...groups.values()].map(group => {
        const combinedText = group.documents.map(document => document.text || '').join('\n');
        const category = inferCategory(combinedText, group.productName);
        return {
            candidate_id: `candidate-${sha256(group.key).slice(0, 12)}`,
            product_name: group.productName,
            aliases: [...group.aliases],
            product_family: inferFamily(group.productName),
            category,
            documents: group.documents,
            prices: group.prices,
            source_mode: 'local',
            combined_text: combinedText,
        };
    }).sort((first, second) => first.product_name.localeCompare(second.product_name, 'zh-CN'));
}

function localRecallScore(candidate, criteria) {
    let score = 0;
    const values = criteria.filter(item => ['need', 'preference', 'pain_point', 'scenario'].includes(item.kind) && typeof item.value === 'string');
    for (const criterion of values) if (criterionMatches(candidate.combined_text, criterion.value)) score += 4;
    const productType = criteria.find(item => item.kind === 'product_type' && typeof item.value === 'string');
    if (productType && productTypeMatches(candidate, productType.value)) score += 8;
    if (candidate.documents.some(document => document.kind === 'product_fact')) score += 2;
    return score;
}

function recallLocalCandidates(catalog, criteria, limit = 8) {
    return catalog
        .map(candidate => ({ ...candidate, recall_score: localRecallScore(candidate, criteria) }))
        .filter(candidate => candidate.recall_score > 0)
        .sort((first, second) => second.recall_score - first.recall_score || first.product_name.localeCompare(second.product_name, 'zh-CN'))
        .slice(0, limit);
}

function evidenceBase(document, requirementTerms) {
    const source = document.source || {};
    const level = document.kind === 'product_fact' ? 'E1' : 'E2';
    return {
        sourceType: document.kind === 'product_fact' ? 'local_product_fact' : document.kind === 'public_price_snapshot' ? 'local_price_snapshot' : 'local_product_catalog',
        level,
        title: document.title || source.entry || '本地产品证据',
        url: sourceUrl(source, document.text),
        retrievedAt: retrievedAt(document.text, source.retrieved_at),
        sha256: source.entry_sha256 || sha256(document.text || ''),
        entry: source.entry || document.id || document.title,
        documentId: document.id || null,
        terms: requirementTerms,
    };
}

function selectedSections(text, terms, limit = 3) {
    const sections = String(text || '').split(/(?=^##\s+)/m).filter(Boolean);
    const scored = sections.map((section, index) => ({
        section,
        index,
        score: terms.reduce((total, term) => total + (String(section).toLowerCase().includes(String(term).toLowerCase()) ? 1 : 0), 0),
    }));
    const matching = scored.filter(item => item.score > 0).sort((first, second) => second.score - first.score || first.index - second.index);
    return (matching.length ? matching : scored).slice(0, limit).map(item => item.section.trim()).filter(Boolean);
}

function evidenceId(sourceType, locator, excerpt) {
    return `ev-${sha256(`${sourceType}|${locator}|${excerpt}`).slice(0, 14)}`;
}

function localEvidence(candidate, criteria, indexBuiltAt) {
    const terms = criteria
        .filter(item => ['need', 'preference', 'pain_point', 'scenario', 'product_type'].includes(item.kind) && typeof item.value === 'string')
        .flatMap(item => termTerms(item.value));
    const evidence = [];
    const facts = candidate.documents.filter(document => document.kind === 'product_fact');
    const catalogs = candidate.documents.filter(document => document.kind === 'product_catalog');
    const priceDocs = candidate.documents.filter(document => document.kind === 'public_price_snapshot');
    for (const document of facts) {
        for (const section of selectedSections(document.text, terms)) {
            if (!section.trim()) continue;
            const base = evidenceBase(document, terms);
            const heading = (section.match(/^##\s+([^\n]+)/) || [])[1] || '产品事实';
            const excerpt = section.slice(0, 1800);
            const locator = `${base.entry}#${heading}`;
            evidence.push({
                evidence_id: evidenceId(base.sourceType, locator, excerpt), source_type: base.sourceType, source_level: base.level,
                title: base.title, locator, url: base.url, retrieved_at: base.retrievedAt || indexBuiltAt || null,
                sha256: base.sha256, excerpt,
            });
        }
    }
    for (const document of catalogs.slice(0, 1)) {
        const text = String(document.text || '');
        const category = (text.match(/产品类别[：:]\s*([^\n]+)/) || [])[1] || candidate.category;
        const tagline = (text.match(/##\s*官网公开定位摘要\s*\n+([^\n]+)/) || [])[1] || candidate.product_family;
        const excerpt = `产品类别：${category.trim()}\n官网公开定位摘要：${tagline.trim()}`;
        const base = evidenceBase(document, terms);
        const locator = `${base.entry}#产品目录`;
        evidence.push({
            evidence_id: evidenceId(base.sourceType, locator, excerpt), source_type: base.sourceType, source_level: base.level,
            title: base.title, locator, url: base.url, retrieved_at: base.retrievedAt || indexBuiltAt || null,
            sha256: base.sha256, excerpt,
        });
    }
    for (const document of priceDocs.slice(0, 1)) {
        const base = evidenceBase(document, terms);
        const excerpt = String(document.text || '').slice(0, 1200);
        const locator = `${base.entry}#公开价格卡`;
        evidence.push({
            evidence_id: evidenceId(base.sourceType, locator, excerpt), source_type: base.sourceType, source_level: base.level,
            title: base.title, locator, url: base.url, retrieved_at: base.retrievedAt || indexBuiltAt || null,
            sha256: base.sha256, excerpt,
        });
    }
    if (!evidence.length && candidate.prices.length) {
        const price = candidate.prices[0];
        const fields = price.raw_fields || {};
        const excerpt = `价格类型：${fields['价格类型'] || '待确认'}；页面金额：${fields['页面金额（元）'] || '未公开'}；核验状态：${fields['核验状态'] || '待确认'}；当前成交报价：否`;
        const locator = `价格记录:${fields['记录ID'] || 'unknown'}`;
        evidence.push({
            evidence_id: evidenceId('local_price_snapshot', locator, excerpt), source_type: 'local_price_snapshot', source_level: 'E2',
            title: fields['来源标题'] || '本地公开价格快照', locator, url: fields['官方URL'] || null,
            retrieved_at: fields['核验时间'] || indexBuiltAt || null, sha256: price.source_entry_sha256 || null, excerpt,
        });
    }
    return evidence;
}

function profileEvidence(criteria) {
    return criteria
        .filter(item => item.status === 'explicit' && item.kind !== 'budget')
        .map(item => {
            const value = typeof item.value === 'string' ? item.value : JSON.stringify(item.value);
            const excerpt = `客户画像字段 ${item.kind}：${value}`;
            return {
                evidence_id: `profile-${sha256(`${item.kind}|${value}`).slice(0, 12)}`, source_type: 'customer_input', source_level: 'E4',
                title: '脱敏客户画像输入', locator: `input.profile.${item.kind}`, url: null, retrieved_at: null,
                sha256: sha256(excerpt), excerpt,
            };
        });
}

function imaCandidateFromResult(result, localCatalog, includeLocalBase = true) {
    const productName = cleanProductTitle(result.title || '');
    if (!productName) return null;
    const aliases = localCatalog.flatMap(candidate => candidate.aliases.map(alias => [candidate, alias]));
    const matched = aliases.find(([, alias]) => normalizeName(productName).includes(normalizeName(alias)) || normalizeName(alias).includes(normalizeName(productName)));
    const base = matched && includeLocalBase ? matched[0] : {
        product_name: productName, aliases: [productName], product_family: inferFamily(productName),
        category: inferCategory(`${result.title || ''} ${result.highlight_content || ''}`, productName), documents: [], prices: [], combined_text: result.highlight_content || '',
    };
    const excerpt = String(result.highlight_content || result.title || productName).slice(0, 1200);
    const locator = result.source_ref?.entry || `ima:${result.media_id}`;
    const evidence = {
        evidence_id: evidenceId('ima_metadata', locator, excerpt), source_type: 'ima_metadata', source_level: 'E3',
        title: result.title || productName, locator, url: null, retrieved_at: null,
        sha256: result.source_ref?.entry_sha256 || sha256(`${locator}|${excerpt}`), excerpt,
    };
    return {
        ...base,
        candidate_id: base.candidate_id || `candidate-${sha256(normalizeName(productName)).slice(0, 12)}`,
        source_mode: base.documents?.length ? 'hybrid' : 'ima',
        ima_evidence: [evidence], ima_media_id: result.media_id || null,
    };
}

function mergeCandidates(localCandidates, imaCandidates) {
    const merged = new Map(localCandidates.map(candidate => [candidate.candidate_id, { ...candidate }]));
    for (const candidate of imaCandidates.filter(Boolean)) {
        const existing = [...merged.values()].find(item => item.aliases.some(alias => candidate.aliases.some(other => normalizeName(alias) === normalizeName(other))));
        if (existing) {
            existing.ima_evidence = [...(existing.ima_evidence || []), ...(candidate.ima_evidence || [])];
            existing.source_mode = 'hybrid';
        } else {
            merged.set(candidate.candidate_id, candidate);
        }
    }
    return [...merged.values()];
}

module.exports = {
    INDEX_PATH,
    DATA_ROOT,
    TERM_ALIASES,
    PRODUCT_TYPE_ALIASES,
    sha256,
    normalizeName,
    cleanProductTitle,
    inferCategory,
    inferFamily,
    termTerms,
    criterionMatches,
    productTypeMatches,
    readIndex,
    buildLocalCatalog,
    localRecallScore,
    recallLocalCandidates,
    localEvidence,
    profileEvidence,
    imaCandidateFromResult,
    mergeCandidates,
};
