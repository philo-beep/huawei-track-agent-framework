#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { ROOT, redact } = require('./support');
const { imaConfig } = require('./config');
const { generateImaEvidenceBase } = require('./ima-evidence');

const DATA_ROOT = path.resolve(ROOT, '..', 'huawei-sales-agent-data');

function parseArgs(argv) {
    const options = {
        product: 'HUAWEI MateBook 14（鸿蒙版）',
        aliases: ['MateBook 14 鸿蒙版', 'HUAWEI MateBook 14 鸿蒙版'],
        modelPattern: 'MateBook\\s*14.*鸿蒙版|鸿蒙版.*MateBook\\s*14',
        queries: ['鸿蒙版', 'MateBook 14 鸿蒙版', 'HUAWEI MateBook 14 鸿蒙版'],
        output: path.join(DATA_ROOT, 'datasets', 'ima'),
        maxTreeDepth: 8,
        maxTreeItems: 2500,
        downloadImages: true,
        asOf: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
    };
    const explicitQueries = [];
    for (let index = 0; index < argv.length; index += 1) {
        const name = argv[index];
        const value = argv[index + 1];
        if (name === '--help' || name === '-h') options.help = true;
        else if (name === '--product') { options.product = value; index += 1; }
        else if (name === '--alias') { options.aliases.push(value); index += 1; }
        else if (name === '--model-pattern') { options.modelPattern = value; index += 1; }
        else if (name === '--query') { explicitQueries.push(value); index += 1; }
        else if (name === '--output') { options.output = path.resolve(value); index += 1; }
        else if (name === '--knowledge-base-id') { options.knowledgeBaseId = value; index += 1; }
        else if (name === '--knowledge-base-name') { options.knowledgeBaseName = value; index += 1; }
        else if (name === '--as-of') { options.asOf = value; index += 1; }
        else if (name === '--max-tree-depth') { options.maxTreeDepth = Number(value); index += 1; }
        else if (name === '--max-tree-items') { options.maxTreeItems = Number(value); index += 1; }
        else if (name === '--asset-reuse-dir') { options.assetReuseDir = path.resolve(value); index += 1; }
        else if (name === '--skip-images') options.downloadImages = false;
        else throw new Error(`未知参数：${name}`);
    }
    if (explicitQueries.length) options.queries = explicitQueries;
    options.output = path.resolve(options.output);
    options.assetReuseDir = path.resolve(options.assetReuseDir || path.join(DATA_ROOT, 'datasets', 'raw', 'assets'));
    if (options.output !== DATA_ROOT && !options.output.startsWith(DATA_ROOT + path.sep)) throw new Error('输出必须位于 huawei-sales-agent-data/，禁止写入业务工作区');
    if (!options.knowledgeBaseName && !options.knowledgeBaseId) options.knowledgeBaseName = imaConfig().knowledgeBaseName || '任德耀新建华为PC知识库';
    return options;
}

function usage() {
    return [
        'Usage: node backend/agent/ima-evidence-cli.js [options]',
        '  --product <name>             Target product name',
        '  --alias <name>               Repeatable product alias',
        '  --model-pattern <regex>      Title model matcher',
        '  --query <text>               Repeatable IMA search query',
        '  --output <dir>               Output under huawei-sales-agent-data/',
        '  --knowledge-base-id <id>     Override IMA knowledge base ID',
        '  --knowledge-base-name <name> Override IMA knowledge base name',
        '  --as-of <YYYY-MM-DD>         Evidence as-of date',
        '  --max-tree-depth <n>         Directory depth cap (default 8)',
        '  --max-tree-items <n>         Directory entry cap (default 2500)',
        '  --asset-reuse-dir <dir>      Reuse byte-identical existing assets',
        '  --skip-images                Do not download image candidates',
    ].join('\n');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { process.stdout.write(usage() + '\n'); return; }
    const { output, ...settings } = options;
    const result = await generateImaEvidenceBase({ ...settings, outputDir: output });
    process.stdout.write(JSON.stringify({ status: 'ok', ...result }, null, 2) + '\n');
}

main().catch(error => {
    process.stderr.write(JSON.stringify({ status: 'failed', code: error.code || 'IMA_EVIDENCE_FAILED', message: redact(error.message || String(error)) }, null, 2) + '\n');
    process.exitCode = 1;
});




