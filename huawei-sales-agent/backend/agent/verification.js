'use strict';

const { PipelineError } = require('./support');

const FORBIDDEN = /(?:最强|最好|第一|顶级|唯一|必买|必然|保证|确保|百分之百|100%|零风险|永久|全网最低|补贴|优惠|折扣|立减|到手价|售价|成交率|亲测|实测|吊打|碾压|竞品不行)/;
const CLAIM = /\d|[０-９]|(?:支持|搭载|配备|轻至|OLED|HarmonyOS|麒麟|流畅|更快|提升|降低|减少|节省|长效|护眼|确保兼容|完全兼容|轻薄便携|轻便|高效|理想选择)/i;

function constrainedNarrative(request) {
    const context = String(request.scenario || '');
    const scene = /备课|课堂|教研/.test(context) ? '备课文稿' : /培训/.test(context) ? '培训材料' : /设计/.test(context) ? '设计文件' : /会议/.test(context) ? '会议文档' : /移动|外出/.test(context) ? '移动办公' : '日常办公';
    const transitions = request.platform === '朋友圈' ? ['你准备在哪种场合完成什么任务？'] : request.platform === '小红书' ? ['你的任务清单里，最需要先确认哪一项？', '请补充软件版本与文件格式，先核对资料，再准备演示。'] : ['需要打开、编辑和导出哪些文件，使用什么软件版本？', '安排演示之前，哪些设备、网络或权限条件仍待确认？'];
    return { title: `${request.product}｜${scene}任务核对清单`, lead: `围绕${scene}，先列出要完成的任务，再对照有来源的资料确认配置与限制。`, transitions, cta: request.platform === '朋友圈' ? '愿意继续了解的话，请提供使用任务和方便联系的渠道，先确认再安排。' : request.platform === '小红书' ? '欢迎留言补充具体任务与软件版本，一起整理待核对清单。' : '欢迎补充实际任务、软件版本与采购限制，由人工确认演示条件和下一步安排。' };
}

// 模块6：模型自评不构成核验；未支持的宣传和事实不进入成稿。
function verifyGenerated(value, facts) {
    if (!value || typeof value !== 'object' || !['title', 'lead', 'cta'].every(name => typeof value[name] === 'string') || !Array.isArray(value.transitions) || !value.transitions.every(item => typeof item === 'string') || !Array.isArray(value.fact_ids) || !value.title.trim() || !value.cta.trim()) throw new PipelineError('MODEL_OUTPUT_INVALID', '智能分析整理的内容格式暂时无法读取，请稍后重试');
    const prose = [value.title, value.lead, ...value.transitions, value.cta].join('\n');
    if (FORBIDDEN.test(prose)) throw new PipelineError('COMPLIANCE_FAILED', '智能分析整理的内容含有缺少依据的宣传、价格或效果表述，已拦截，未输出正文');
    const checkedProse = facts.reduce((text, fact) => text.split(fact.product).join('目标产品').split(fact.product.replace(/^HUAWEI\s*/i, '')).join('目标产品'), prose);
    const unsupported = checkedProse.match(CLAIM);
    if (unsupported) throw new PipelineError('FACT_VERIFICATION_FAILED', `整理内容出现缺少出处的参数或能力表述，已拦截`);
    const { selected } = verifySelection(value, facts);
    return { selected, prose };
}

function verifySelection(value, facts) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.fact_ids)) throw new PipelineError('MODEL_OUTPUT_INVALID', '智能分析没有返回可用的资料选择，请稍后重试');
    const selected = [...new Set(value.fact_ids)];
    if (!selected.length || selected.length !== value.fact_ids.length || selected.some(id => typeof id !== 'string' || !id.trim() || !facts.some(fact => fact.id === id))) throw new PipelineError('FACT_VERIFICATION_FAILED', '整理内容引用了缺失或不一致的资料依据，已拦截');
    for (const fact of facts.filter(item => selected.includes(item.id))) {
        if (!fact.source_refs.length || !fact.source_refs.every(source => source.excerpt.includes(fact.claim))) throw new PipelineError('FACT_VERIFICATION_FAILED', '产品资料无法在来源原文中准确定位，已停止使用');
        if (fact.conditions.some(condition => !fact.source_refs.some(source => source.excerpt.includes(condition)))) throw new PipelineError('FACT_VERIFICATION_FAILED', '限制脚注缺少完整原文');
    }
    return { selected };
}

function composeContent(value, facts, request = {}) {
    const verified = verifySelection(value, facts);
    const product = facts.find(fact => fact.id === verified.selected[0]).product;
    if ((request.product !== undefined && request.product !== product) || facts.some(fact => verified.selected.includes(fact.id) && fact.product !== product)) throw new PipelineError('FACT_VERIFICATION_FAILED', '实际内容与所选产品型号不一致，已拦截');
    const narrative = constrainedNarrative({ scenario: '日常办公', platform: '公众号', ...request, product });
    verifyGenerated({ ...narrative, fact_ids: verified.selected }, facts);
    let selectedFacts = facts.filter(fact => verified.selected.includes(fact.id));
    if (request.platform === '朋友圈') selectedFacts = [...selectedFacts].sort((first, second) => first.claim.length - second.claim.length).slice(0, 1);
    else selectedFacts = selectedFacts.slice(0, request.platform === '小红书' ? 2 : 3);
    const compact = request.platform === '小红书' || request.platform === '朋友圈';
    const cards = selectedFacts.map(fact => {
        const excerpt = compact ? fact.claim.split(/\n\s*\n/).filter(Boolean).slice(0, 3).join('\n\n') : fact.claim;
        const citation = fact.source_refs.map(source => `${source.title}${source.archive_aliases.length ? '｜' + source.archive_aliases.join('、') : ''}`).join('；');
        return `【${compact ? '产品资料节选' : '产品资料原文'}】\n${excerpt}\n来源：${citation}${compact && excerpt !== fact.claim ? '\n以上只节选与本次沟通最相关的字段，完整使用条件见文末。' : ''}`;
    });
    const opening = request.platform === '公众号' ? ['### 从实际任务开始', ...narrative.transitions, '### 对照资料做选型核对'] : request.platform === '小红书' ? ['### 先列任务，再看资料', ...narrative.transitions.map(item => `- ${item}`), '### 资料核对卡'] : [...narrative.transitions.slice(0, 1)];
    const body = ['【内容说明】以下内容只使用已核对的产品资料；标题、导语和下一步沟通为销售准备稿。', ...opening, ...cards, '【使用条件与说明】', ...new Set(selectedFacts.flatMap(fact => fact.conditions)), '【图片说明】当前没有完成发布授权的正式配图，发布前仍需人工确认。'].join('\n\n');
    const inserted = selectedFacts.map(fact => [fact.claim, ...fact.conditions].join('\n')).join('\n');
    if (FORBIDDEN.test(inserted)) throw new PipelineError('COMPLIANCE_FAILED', '知识库原文含价格、优惠或绝对化表达，未取得独立营销合规确认，已阻塞成稿');
    return { title: narrative.title, lead: narrative.lead, body, cta: narrative.cta, images: [], fact_ids: selectedFacts.map(fact => fact.id) };
}

const releaseVerification = require('./release-verification');

module.exports = { verifyGenerated, verifySelection, composeContent, constrainedNarrative, ...releaseVerification };
