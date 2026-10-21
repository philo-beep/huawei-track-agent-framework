'use strict';

// 销售准备：只生成待执行计划，不报告报价或实际半小时交付成果。
function prepareSales(request, profile, facts) {
    const scenario = request.scenario;
    const subject = /备课|课堂|学校|教研/.test(`${scenario}${request.audience}`) ? '课堂文稿与备课材料' : /设计|制图/.test(`${scenario}${request.audience}`) ? '一份经客户授权的设计样稿' : /培训/.test(scenario) ? '培训课件及学员操作清单' : '客户日常办公文档';
    const stage = String(profile.purchase_stage.value || '尚未明确');
    const checklist = [
        `准备（建议5分钟）：与${request.audience}确认“${scenario}”的验收任务，选取${subject}；记录软件名称/版本、文件格式、外接设备、网络和数据权限，不预设兼容。`,
        `操作（建议10分钟）：在实际销售SKU上由演示人员打开经客户授权的${subject}，演示客户确认的基础操作；若应用尚未核实，先核对官方适配清单，不承诺可用。`,
        `检查（建议10分钟）：客户逐项确认打开/编辑/保存/导出结果，记录失败步骤、实际时长和配置；对照${facts.map(fact => fact.id).join('、')}及其全部脚注，不把规格等同体验结论。`,
        '复核（建议5分钟）：记录客户验收/待确认事项并约定下一次验证；任一步失败就保留错误现象、换用已授权的脱敏样例或延期核验，不能宣称已通过。',
        '上述5+10+10+5分钟是建议安排，不是实测或半小时交付保证；设备准备、安装和审批不计为已完成。',
    ];
    const actions = [];
    if (/比价|比较/.test(stage)) actions.push({ action: '询问：“请确认要比较的完整SKU、必需软件任务和同口径证据维度，暂不比较未经证实的性能或价格。”', owner: '销售负责人（待指定）', trigger: '客户确认比价意向后', pending_dependencies: ['另一产品真实同版本资料', '客户认可的比较维度'] });
    else if (/续约/.test(stage)) actions.push({ action: '询问：“本次是服务续约还是硬件采购？请确认原合同范围、设备型号及到期时间，先核对授权服务条款。”', owner: '原客户服务负责人（待指定）', trigger: '客户确认续约需求后', pending_dependencies: ['原合同与服务权限', '续约范围和审批人'] });
    else if (/加购|增加/.test(stage)) actions.push({ action: '询问：“请分别确认本次新增数量与原有设备，是否需统一软件/设备环境？员工规模与存量不作为新增数量。”', owner: '客户经理（待指定）', trigger: '客户确认加购范围后', pending_dependencies: ['新增数量、现有型号', '实际部署条件和审批链'] });
    else if (/试点/.test(stage)) actions.push({ action: `确认“${scenario}”试点参与人、任务与成功标准；由客户确认试点结果后再讨论扩容，不承诺扩容效果。`, owner: '方案工程师（待指定）', trigger: '客户确认试点人员和场地后', pending_dependencies: ['试点SKU和软件清单', '验收指标及失败退出条件'] });
    else actions.push({ action: `询问：“围绕${scenario}，最需要完成哪项任务？请补充常用软件版本和实际设备，我们先核对资料再安排演示。”`, owner: '销售负责人（待指定）', trigger: '客户愿意继续了解后', pending_dependencies: ['任务优先级', '软件、外设与客户可用时段'] });
    actions.push({ action: `核对${facts.map(fact => fact.id).join('、') || '待补充'}对应原文、适用条件与官网限制，逐项映射“${scenario}”所需软件、设备与权限；缺少证据时保持待确认。`, owner: '方案工程师（待指定）', trigger: '客户确认具体任务和软件版本后', pending_dependencies: ['软件名称/版本与文件格式', '完整销售SKU、适配记录和来源原文'] });
    actions.push({ action: `在客户同意且样例获得授权后，按“${scenario}”准备一次可计时的打开、编辑、保存和导出验证；未执行前不报告半小时交付。`, owner: '销售负责人（待指定）', trigger: '客户确认验收任务、参与人和可用时段后', pending_dependencies: ['演示设备与软件环境', '脱敏样例、网络和权限', '客户验收标准'] });
    if (profile.decision_chain.value === null) actions.push({ action: '确认采购发起人、预算审批人、技术验收人和最终决策人；未核实前不假定客户拥有采购权限。', owner: '客户经理（待指定）', trigger: '客户进入方案评估或采购流程后', pending_dependencies: ['决策角色与审批链', '采购流程和所需资料'] });
    if (profile.budget.value === null) actions.push({ action: '询问：“预算尚未确定，是否先记录单台/总额、币种和数量的待确认口径？不要求先接受未经授权价格。”', owner: '客户经理（待指定）', trigger: '客户进入采购准备且愿意讨论预算时', pending_dependencies: ['预算口径和币种', '采购数量'] });
    actions.push({ action: '收集真实四级报价规则、资格及审批依据后，再由获授权人员出具报价单；当前金额留空，不使用历史快照承诺成交价。', owner: '报价审核负责人（待指定）', trigger: '客户明确SKU与数量且企业提供有效政策后', pending_dependencies: ['四级定义/数值和叠加顺序', '资格、地区、税费、舍入、有效期与授权'] });
    actions.push({ action: '向客户确认可联系渠道与方便时间，再由人工提出下一次演示建议；记录咨询结果，后续用真实数据评估，当前不报告转化提升。', owner: '销售负责人（待指定）', trigger: profile.channels.value ? `客户确认可使用${profile.channels.value.join?.('、') || profile.channels.value}联系后` : '客户明确授权可触达渠道后', pending_dependencies: ['联系同意与渠道', '可用时间和责任人'] });
    return { checklist, next_actions: actions };
}

module.exports = { prepareSales };
