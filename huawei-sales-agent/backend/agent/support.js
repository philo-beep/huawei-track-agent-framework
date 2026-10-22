'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

class PipelineError extends Error {
    constructor(code, message, retryable = false) {
        super(message);
        this.code = code;
        this.retryable = retryable;
    }
}

function validateSchema(value, schema, root = schema, location = '$') {
    if (schema.$ref) return validateSchema(value, schema.$ref.split('/').slice(1).reduce((current, name) => current[name], root), root, location);
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value;
    const allowed = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : null;
    if (allowed && !allowed.includes(type) && !(type === 'integer' && allowed.includes('number'))) throw new PipelineError('INVALID_INPUT', `填写内容格式不正确，请检查后重试`);
    if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) throw new PipelineError('INVALID_INPUT', `填写内容与当前操作不一致，请刷新页面后重试`);
    if (schema.enum && !schema.enum.some(entry => JSON.stringify(entry) === JSON.stringify(value))) throw new PipelineError('INVALID_INPUT', `填写内容不在可选范围内，请重新选择`);
    if (typeof value === 'string' && schema.minLength && value.trim().length < schema.minLength) throw new PipelineError('INVALID_INPUT', `必填内容不能为空`);
    if (typeof value === 'number' && (!Number.isFinite(value) || (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) throw new PipelineError('INVALID_INPUT', `填写的数值超出可用范围，请检查后重试`);
    if (Array.isArray(value)) {
        if (schema.minItems && value.length < schema.minItems) throw new PipelineError('INVALID_INPUT', `至少需要补充一项内容`);
        if (schema.items) value.forEach((entry, index) => validateSchema(entry, schema.items, root, `${location}/${index}`));
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const name of schema.required || []) if (!(name in value)) throw new PipelineError('INVALID_INPUT', `还有必填信息未填写`);
        if (schema.minProperties && Object.keys(value).length < schema.minProperties) throw new PipelineError('INVALID_INPUT', `必填内容不能为空`);
        for (const [name, entry] of Object.entries(value)) {
            if (schema.properties?.[name]) validateSchema(entry, schema.properties[name], root, `${location}/${name}`);
            else if (schema.additionalProperties === false) throw new PipelineError('INVALID_INPUT', `填写内容中包含无法识别的项目，请刷新页面后重试`);
        }
    }
    if (schema.not) {
        let matches = false;
        try { validateSchema(value, schema.not, root, location); matches = true; } catch {}
        if (matches) throw new PipelineError('INVALID_INPUT', `填写内容不符合当前操作要求，请检查后重试`);
    }
    for (const clause of schema.allOf || []) {
        if (!clause.if) validateSchema(value, clause, root, location);
        else {
            let matches = true;
            try { validateSchema(value, clause.if, root, location); } catch { matches = false; }
            if (matches && clause.then) validateSchema(value, clause.then, root, location);
            if (!matches && clause.else) validateSchema(value, clause.else, root, location);
        }
    }
    return true;
}

function schema(name) {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'contracts', `marketing-${name}.schema.json`), 'utf8'));
}

function redact(message) {
    let safe = String(message);
    for (const name of ['IMA_OPENAPI_CLIENTID', 'IMA_OPENAPI_APIKEY', 'IMA_CLIENT_ID', 'IMA_API_KEY']) {
        if (process.env[name]) safe = safe.split(process.env[name]).join('[已脱敏]');
    }
    return safe.replace(/Bearer\s+\S+/gi, 'Bearer [已脱敏]').slice(0, 500);
}

function outputPath(target, mustExist = false, extension = '.json') {
    const resolved = path.resolve(ROOT, target);
    const allowed = path.join(ROOT, 'tests', 'outputs');
    if (!['.json', '.md'].includes(extension) || !resolved.startsWith(allowed + path.sep) || !resolved.endsWith(extension)) throw new PipelineError('REVISION_INVALID', '结果保存位置不可用，请选择系统允许的位置');
    let current = ROOT;
    for (const component of path.relative(ROOT, resolved).split(path.sep)) {
        current = path.join(current, component);
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new PipelineError('REVISION_INVALID', '结果保存位置不符合要求，请重新选择');
    }
    if (mustExist && (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile())) throw new PipelineError('REVISION_INVALID', '历史结果不存在');
    if (!mustExist && fs.existsSync(resolved)) throw new PipelineError('REVISION_INVALID', '输出文件已存在，请使用新文件名，避免覆盖历史结果');
    return resolved;
}

module.exports = { ROOT, PipelineError, validateSchema, schema, redact, outputPath };
