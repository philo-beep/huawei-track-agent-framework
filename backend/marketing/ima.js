'use strict';

const { PipelineError } = require('./support');

async function disabled() {
    throw new PipelineError('IMA_DISABLED_BY_USER', '用户已停止IMA调用；兼容入口已停用，即使配置凭证也不会访问IMA、执行SDK或读取客户端配置');
}

function credentialEnvironment() {
    const environment = { ...process.env };
    for (const name of Object.keys(environment)) if (/^IMA_/i.test(name)) delete environment[name];
    return environment;
}

module.exports = { officialCall: disabled, imaKnowledge: disabled, credentialEnvironment, search_knowledge_base: disabled, get_knowledge_list: disabled, search_knowledge: disabled, get_media_info: disabled };
