'use strict';

const { runtimeCapabilities } = require('../backend/agent/config');
const { generateJson } = require('../backend/agent/model');
const { probeIma } = require('../backend/agent/ima');
const { researchHuawei } = require('../backend/agent/research');
const { runCloud } = require('../backend/agent/cloud-runner');

async function main() {
    const capabilities = runtimeCapabilities();
    const result = { capabilities, cloud_model: null, ima: null, web: null, end_to_end: null };
    let failed = false;
    try {
        const model = await generateJson('只输出合法JSON。', '返回JSON对象，字段ok为true，message为“连接成功”。', 300);
        result.cloud_model = { status: 'ok', model: model.model, provider: model.provider, elapsed_ms: model.elapsed_ms, response_ok: model.value?.ok === true };
        if (!result.cloud_model.response_ok) failed = true;
    } catch (error) {
        result.cloud_model = { status: 'failed', code: error.code || 'MODEL_ERROR', message: error.message };
        failed = true;
    }
    try {
        result.ima = await probeIma();
        if (result.ima.status !== 'ok') failed = true;
    } catch (error) {
        result.ima = { status: 'failed', code: error.code || 'IMA_ERROR', message: error.message };
        failed = true;
    }
    try {
        const pages = await researchHuawei('HUAWEI MateBook 14 鸿蒙版', '移动办公');
        result.web = { status: pages.some(page => page.content_sha256 && !page.error) ? 'ok' : 'failed', page_count: pages.length, pages: pages.map(page => ({ title: page.title, url: page.url, fetched_at: page.fetched_at, content_sha256: page.content_sha256, error: page.error || null })) };
        if (result.web.status !== 'ok') failed = true;
    } catch (error) {
        result.web = { status: 'failed', code: error.code || 'WEB_ERROR', message: error.message };
        failed = true;
    }
    if (process.argv.includes('--full')) {
        try {
            const full = await runCloud({
                marketing_input: {
                    schema_version: '1.0',
                    product: 'HUAWEI MateBook 14 鸿蒙版',
                    platform: '公众号',
                    audience: '合成：办公电脑选型用户',
                    scenario: '核对移动办公文稿打开、编辑、保存与导出的任务条件',
                    raw_request: '合成样例：需要确认移动办公文件处理流程；预算尚未确定',
                },
                demo_pricing: true,
                use_cloud_model: true,
                use_ima: true,
                use_web_research: true,
            });
            result.end_to_end = {
                status: full.status,
                runtime_engine: full.runtime_engine,
                ima_connection: full.marketing_result?.ima_connection,
                content_ready: Boolean(full.content?.marketing_content),
                diagnostics: (full.marketing_result?.diagnostics || []).map(item => item.code),
            };
            if (full.status !== 'demo_ready' || !result.end_to_end.content_ready) failed = true;
        } catch (error) {
            result.end_to_end = { status: 'failed', code: error.code || 'PIPELINE_ERROR', message: error.message };
            failed = true;
        }
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (failed) process.exitCode = 1;
}

main().catch(error => {
    process.stderr.write(JSON.stringify({ status: 'failed', code: error.code || 'VERIFY_ERROR', message: error.message }) + '\n');
    process.exitCode = 1;
});