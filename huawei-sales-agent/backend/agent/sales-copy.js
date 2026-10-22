'use strict';

const STATUS_LABELS = Object.freeze({
    ready: '资料可用',
    demo_ready: '销售准备稿已生成',
    needs_attention: '需要确认',
    needs_clarification: '需要补充信息',
    partial: '部分完成',
    blocked: '需先处理',
    completed: '已完成',
    running: '处理中',
    failed: '未完成',
    missing_basis: '缺少价格依据',
    basis_sufficient: '依据齐全',
    cannot_determine: '暂时无法判断',
    not_provided: '客户未提供',
    not_evaluated: '尚未判断',
    not_executed: '尚未执行',
    pending_assignment: '待指定负责人',
    pending_confirmation: '待确认',
    preparation_only: '仅作准备',
    programmatic_constrained_preparation: '按已核对资料准备',
    invalid_input: '填写内容需调整',
    pending: '待确认',
    calculated_demo: '演示测算完成',
    explicit: '客户明确说明',
    verified_model_snapshot: '资料可用',
    no_usable_fields: '没有可用产品信息',
    unavailable: '资料暂时不可用',
    official_snapshot: '华为公开资料',
    public_retail_snapshot_reference: '公开价格参考',
    inferred: '推断，待核对'
});

const COVERAGE_LABELS = Object.freeze({ supported: '资料支持', pending: '仍需确认', unsupported: '资料不支持', conflict: '信息有冲突', missing: '暂无资料', not_applicable: '不适用' });
const CRITERIA_LABELS = Object.freeze({ product_type: '产品类型', scenario: '使用场景', need: '明确需求', preference: '客户偏好', pain_point: '待确认问题', budget: '预算', quantity: '采购数量', industry: '客户行业', company_size: '组织规模' });
const PROFILE_LABELS = Object.freeze({ identity: '客户角色', relationship: '新老客户关系', industry: '客户行业', company_size: '组织规模', needs: '核心需求', budget: '预算与数量', decision_chain: '决策参与人', preferences: '客户偏好', pain_points: '当前痛点', purchase_stage: '采购阶段', channels: '可联系渠道' });

function plainText(value) {
    return String(value ?? '')
        .replace(/deepseek[^\s；,，。]*/gi, '智能分析服务')
        .replace(/云端(?:大)?模型/g, '智能分析')
        .replace(/联网(?:实时)?检索/g, '公开资料查询')
        .replace(/规则画像/g, '客户画像')
        .replace(/密钥/g, '系统密码')
        .replace(/合成政策/g, '演示价格规则')
        .replace(/销售销售配置/g, '销售配置')
        .replace(/产品资料库\s*知识库/g, '产品资料库')
        .replace(/销售\s+销售配置/g, '销售配置')
        .replace(/模型常识/g, '未经核对的信息')
        .replace(/规则引擎/g, '既定销售规则')
        .replace(/模型/g, '智能分析')
        .replace(/产品事实/g, '产品资料')
        .replace(/事实来源/g, '资料来源')
        .replace(/事实/g, '资料')
        .replace(/合成/g, '演示')
        .replace(/\bIMA(?:\s+OpenAPI)?\b/gi, '产品资料库')
        .replace(/\bOpenAPI\b/gi, '资料服务')
        .replace(/\bJSON\b/gi, '数据文件')
        .replace(/\bMarkdown\b/gi, '说明文档')
        .replace(/\bHTTP\b/gi, '网络服务')
        .replace(/\bAPI\b/gi, '服务')
        .replace(/\bSKU\b/gi, '销售配置')
        .replace(/字段/g, '信息')
        .replace(/\bCTA\b/gi, '下一步沟通')
        .replace(/资格键/g, '适用条件')
        .replace(/公开价格快照/g, '公开价格参考')
        .replace(/检索线索/g, '资料线索')
        .replace(/命中/g, '找到')
        .replace(/\bofficial-\d+-[a-f0-9]+\b/gi, '相关产品资料')
        .replace(/\b(?:profile|ev|fact)-[a-f0-9]+\b/gi, '资料依据')
        .replace(/\bSHA-?256\b/gi, '资料核对信息')
        .replace(/\bID\b/g, '编号')
        .replace(/\bnull\b/gi, '待确认')
        .replace(/\bready\b/gi, '可参考')
        .replace(/\bneeds_update\b/gi, '需更新')
        .replace(/\bunknown\b/gi, '待确认')
        .replace(/\bcalled(?:_with_fallback)?\b/gi, '已使用')
        .replace(/\bconfigured\b/gi, '已就绪')
        .replace(/\bE[1-4]事实\b/g, '产品资料')
        .replace(/\bE[1-4]\b/g, '资料')
        .replace(/降级/g, '需要调整')
        .replace(/阻塞/g, '需先处理')
        .replace(/产品资料库\s*知识库/g, '产品资料库')
        .replace(/销售\s*销售配置/g, '销售配置')
        .replace(/事实\s*编号/g, '资料依据')
        .replace(/四级报价规则/g, '四级价格规则')
        .replace(/\bURL\b/gi, '公开链接')
        .replace(/内容指纹/g, '资料核对信息')
        .replace(/参数事实/g, '参数资料')
        .replace(/资料证据/g, '资料依据')
        .replace(/证据/g, '依据')
        .replace(/产品资料库\s*产品资料/g, '产品资料库')
        .replace(/产品资料库[^｜\n]*镜像条目/g, '产品资料库')
        .replace(/完整\s+销售配置/g, '完整销售配置')
        .replace(/销售配置\s+缺口/g, '销售配置缺口')
        .replace(/\s+与公开资料查询/g, '与公开资料查询')
        .replace(/客户画像(?:字段|信息)\s+[a-z][a-z0-9_]*：/gi, '客户填写：')
        .replace(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/gi, '相关信息')
        .replace(/\s*[(（][A-Z][A-Z0-9_]{2,}[)）]\s*/g, '')
        .trim();
}

function humanStatus(value) {
    return STATUS_LABELS[value] || plainText(value || '待确认');
}

function coverageStatus(value) {
    return COVERAGE_LABELS[value] || plainText(value || '待确认');
}

function criterionLabel(value) {
    return CRITERIA_LABELS[value] || plainText(String(value || '其他条件').replaceAll('_', ' '));
}

function profileLabel(value) {
    return PROFILE_LABELS[value] || plainText(String(value || '客户信息').replaceAll('_', ' '));
}

function humanMoney(cents) {
    if (!Number.isSafeInteger(cents)) return '待确认';
    const amount = BigInt(cents);
    return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}元`;
}

function humanDate(value) {
    if (!value) return '待确认';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return plainText(value);
    return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function cleanSourceTitle(value) {
    return plainText(String(value || '产品资料').split('｜')[0]
        .replace(/\s*-\s*产品事实\s*$/i, ' 产品资料')
        .replace(/^input\.profile\./i, '客户填写：')
        .replace(/\.[a-f0-9]{12,}(?:\.(?:html?|txt))?$/i, '')
        .replace(/\.(?:html?|txt)$/i, ''));
}

function readableValue(value) {
    if (value === null || value === undefined || value === '') return '待确认';
    if (Array.isArray(value)) return value.length ? value.map(readableValue).join('、') : '无';
    if (typeof value === 'object') {
        if (Number.isFinite(value.min) || Number.isFinite(value.max)) {
            const range = Number.isFinite(value.min) && Number.isFinite(value.max) ? `${value.min} 至 ${value.max}` : Number.isFinite(value.max) ? `不超过 ${value.max}` : `不低于 ${value.min}`;
            return `${range}${value.currency ? ` ${value.currency}` : ''}${value.scope ? `，按${value.scope}` : ''}${Number.isFinite(value.quantity) ? `，${value.quantity} 台` : ''}`;
        }
        if (value.label) return plainText(value.label);
        return Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== '')
            .map(([key, item]) => `${profileLabel(key)}：${readableValue(item)}`).join('；') || '待确认';
    }
    return plainText(value);
}

function cleanProse(value) {
    return String(value || '').split(/\n{2,}/)
        .filter(chunk => !/<!--\s*IMAGE:/i.test(chunk))
        .map(chunk => chunk.split(/\r?\n/)
            .filter(line => !/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line))
            .filter(line => !/^\s*>\s*\*\*配图/i.test(line))
            .filter(line => !/^\s*>\s*(?:插入位置|图片|说明|来源|状态)：/i.test(line))
            .join('\n'))
        .map(chunk => plainText(chunk).replace(/^来源定位：.*$/gmi, '').trim())
        .filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n');
}

module.exports = { plainText, cleanProse, humanStatus, coverageStatus, criterionLabel, profileLabel, humanMoney, humanDate, cleanSourceTitle, readableValue };
