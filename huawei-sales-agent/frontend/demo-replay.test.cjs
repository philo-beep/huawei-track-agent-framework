'use strict';

// Dependency-free DOM harness for C-owned replay logic. Real image/layout QA is separate.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, 'static/js/app.js'), 'utf8');
const json = html.match(/<script type="application\/json" id="demo-presets">([\s\S]*?)<\/script>/)[1];
const bundle = JSON.parse(json);

function harness(storage = new Map(), storageFails = false) {
    class Element {
        constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.style = {}; this.events = {}; this.value = ''; this.className = ''; this.hidden = false; this.disabled = false; this._text = ''; if (this.tagName === 'DIALOG') { this.open = false; this.showModal = () => { this.open = true; }; this.close = () => { this.open = false; }; } }
        get textContent() { return this._text + this.children.map(child => child.textContent ?? child).join(''); }
        set textContent(value) { this._text = String(value); this.children = []; }
        get classList() { return { add: (...names) => { this.className = [...new Set([...this.className.split(' '), ...names])].join(' '); }, remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); }, contains: name => this.className.split(' ').includes(name), toggle: (name, enabled) => { if (enabled ?? !this.classList.contains(name)) this.classList.add(name); else this.classList.remove(name); } }; }
        append(...children) { children.forEach(child => { if (typeof child === 'object') child.parent = this; this.children.push(child); }); }
        prepend(...children) { children.forEach(child => { if (typeof child === 'object') child.parent = this; }); this.children.unshift(...children); }
        replaceChildren(...children) { this._text = ''; this.children = []; this.append(...children); }
        remove() { if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); }
        setAttribute(key, value) { this[key] = value; }
        removeAttribute(key) { delete this[key]; }
        addEventListener(type, handler) { (this.events[type] ||= []).push(handler); }
        async emit(type) { for (const handler of this.events[type] || []) await handler({ preventDefault() {} }); }
        focus() {} scrollIntoView() {} select() {} setSelectionRange() {} reset() {}
        get lastElementChild() { return this.children.at(-1); }
        closest(selector) { if (this.matches(selector)) return this; return this.parent?.closest(selector) || containers[selector] || new Element(); }
        matches(selector) {
            if (selector.startsWith('.')) return selector.slice(1).split('.').every(name => this.classList.contains(name));
            if (selector.startsWith('[id^=')) return this.id?.startsWith(selector.match(/"([^"]+)"/)[1]);
            if (selector === '[data-wizard-panel]') return Boolean(this.dataset.wizardPanel);
            if (/^[a-z][a-z0-9-]*$/i.test(selector)) return this.tagName === selector.toUpperCase();
            return false;
        }
        querySelectorAll(selector) { const result = []; const walk = node => { for (const child of node.children) if (typeof child === 'object') { if (selector.split(',').some(part => child.matches(part.trim()))) result.push(child); walk(child); } }; walk(this); result.item = index => result.at(index); return result; }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    }
    const body = new Element('body');
    const containers = { '.demo-panel': new Element(), '.platform-matrix-panel': new Element() };
    containers['.demo-panel'].className = 'demo-panel';
    const ids = new Map();
    const markup = html.replace(/<script type="application\/json" id="demo-presets">[\s\S]*?<\/script>/, '');
    for (const match of markup.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
        const node = new Element(match[1]); node.id = match[3]; node.className = match[2].match(/class="([^"]+)"/)?.[1] || '';
        node.hidden = /\bhidden\b/.test(match[2]); node.disabled = /\bdisabled\b/.test(match[2]); node.checked = /\bchecked\b/.test(match[2]);
        const panel = match[2].match(/data-wizard-panel="(\d)"/); if (panel) node.dataset.wizardPanel = panel[1];
        ids.set(node.id, node); body.append(node);
    }
    const data = new Element('script'); data.textContent = json; ids.set('demo-presets', data);
    ids.get('demo-title').parent = containers['.demo-panel'];
    ids.get('content-platform').value = '公众号'; ids.get('platform').value = '公众号'; ids.get('product').value = 'HUAWEI MateBook 14 鸿蒙版';
    const document = { body, createElement: tag => new Element(tag), getElementById: id => { assert.ok(ids.has(id), `Missing DOM id: ${id}`); return ids.get(id); }, querySelectorAll: selector => body.querySelectorAll(selector), addEventListener() {} };
    const timers = new Map(); let timerId = 0; let requests = 0; let clipboardText = '';
    const windowEvents = {};
    const context = vm.createContext({ document, navigator: { clipboard: { writeText: async value => { clipboardText = String(value); } } }, TextEncoder, Intl, Blob, console,
        URL: class extends URL { static createObjectURL() { return `blob:demo-${++timerId}`; } static revokeObjectURL() {} },
        window: { isSecureContext: true, addEventListener(type, handler) { (windowEvents[type] ||= []).push(handler); } },
        localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => { if (storageFails) throw new Error('Quota denied'); storage.set(key, value); } },
        fetch: async () => { requests += 1; throw new Error('Network forbidden in replay tests'); },
        setTimeout: (handler, delay) => { const id = ++timerId; timers.set(id, { handler, delay }); return id; }, clearTimeout: id => timers.delete(id),
    });
    vm.runInContext(source, context);
    const run = script => vm.runInContext(script, context);
    run("state.access.canRun = true; state.csrf = 'test'; state.capabilities = {}; setRunning(false);");
    return { run, ids, storage, timers, requests: () => requests, clipboard: () => clipboardText, async click(id) { await ids.get(id).emit('click'); }, async event(type) { for (const handler of windowEvents[type] || []) await handler(); } };
}

test('bundled scenarios contain six evidence-backed rounds and all three platform variants', () => {
    assert.equal(bundle.scenarios.length, 2);
    for (const scenario of bundle.scenarios) {
        assert.equal(scenario.rounds.length, 6);
        scenario.rounds.forEach((round, index) => {
            assert.equal(round.result.turn, index + 1);
            assert.equal(round.result.runtime.called, false);
            assert.equal(round.result.status, index === 5 ? 'complete' : 'question');
            for (const field of Object.values(round.result.fields)) for (const evidence of field.evidence) assert.ok(scenario.rounds.slice(0, index + 1).some(item => item.answer.includes(evidence.quote)));
        });
        assert.equal(scenario.match.input.use_cloud_model, false);
        assert.deepEqual(Object.keys(scenario.contents), ['公众号', '小红书', '朋友圈']);
        for (const [platform, snapshot] of Object.entries(scenario.contents)) {
            assert.equal(snapshot.result.platform, platform);
            assert.equal(snapshot.result.image_sources.length, platform === '公众号' ? 4 : platform === '小红书' ? 3 : 1);
            for (const image of snapshot.result.image_sources) {
                assert.equal(image.asset_url, 'demo-product:' + image.sha256);
                const data = bundle.product_images[image.sha256].data_url;
                assert.match(data, /^data:image\/(png|jpeg);base64,/);
                const bytes = Buffer.from(data.split(',')[1], 'base64');
                assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), image.sha256);
                assert.equal(image.product, snapshot.result.product.resolved_name);
                assert.equal(image.publication_ready, false);
                assert.match(image.original_url, /^https:/);
            }
            assert.match(snapshot.result.draft.lead, /想象一下|不妨设想/);
            assert.doesNotMatch(snapshot.result.publication_readiness.cover_copy.image_caption, /原创场景/);
        }
    }
    assert.notEqual(bundle.scenarios[0].contents['公众号'].result.draft.title, bundle.scenarios[1].contents['公众号'].result.draft.title);
});

test('both complete replays make zero network requests and generate local download links', () => {
    const h = harness();
    for (const id of ['procurement', 'creator']) {
        h.run(`byId('demo-auto').checked = false; startDemo('${id}');`);
        assert.equal(h.ids.get('profile-answer').value, '');
        for (let round = 0; round < 6; round++) {
            h.run('advanceDemo(true)');
            assert.ok(h.ids.get('profile-answer').value.length > 0);
            h.run('advanceDemo(true)');
            assert.equal(Number(h.ids.get('profile-turn-value').textContent), round + 1);
        }
        for (let stage = 0; stage < 5; stage++) h.run('advanceDemo(true)');
        assert.equal(h.run('demoReplay.phase'), 'complete');
        assert.equal(h.run('state.wizardStep'), 4);
        assert.match(h.ids.get('download-json').href, /^blob:/);
        assert.match(h.ids.get('content-download-images').href, /^blob:/);
        assert.equal(h.run('state.contentResult.image_sources.length'), 1);
        assert.equal(h.requests(), 0);
    }
    assert.ok(h.storage.has('huawei.demo.confirmed.v1.procurement'));
    assert.ok(h.storage.has('huawei.demo.confirmed.v1.creator'));
});

test('full-text quick view exposes every generated block and copies the complete text', async () => {
    const h = harness();
    const snapshot = bundle.scenarios[0].contents['公众号'];
    h.run("renderContentDraftResult(demoBundle.scenarios[0].contents['公众号'].result, demoBundle.scenarios[0].contents['公众号'].markdown, { fromHistory: true })");
    await h.click('content-view-all');
    assert.equal(h.run('state.contentViewOpen'), true);
    assert.equal(h.ids.get('content-view-dialog').open, true);
    assert.match(h.ids.get('content-view-title').textContent, /公众号完整文案/);
    const blocks = snapshot.result.publication_readiness.copy_blocks;
    for (const block of blocks) assert.ok(h.ids.get('content-view-body').textContent.includes(block.text));
    await h.click('content-view-copy-all');
    assert.equal(h.clipboard(), blocks.map(block => block.text).filter(Boolean).join('\n\n'));
    assert.match(h.ids.get('content-view-feedback').textContent, /已复制全部文案/);
    await h.click('content-view-close-bottom');
    assert.equal(h.run('state.contentViewOpen'), false);
    assert.equal(h.ids.get('content-view-dialog').open, false);

    const viewButtons = h.ids.get('content-copy-blocks').querySelectorAll('button').filter(button => button.textContent === '查看全文');
    assert.equal(viewButtons.length, 3);
    await viewButtons[1].emit('click');
    assert.equal(h.run('state.contentViewOpen'), true);
    assert.match(h.ids.get('content-view-meta').textContent, /正在查看正文/);
    await h.click('content-view-close');
    assert.equal(h.ids.get('content-view-dialog').open, false);
});

test('automatic playback progresses with staged timers and never claims human confirmation', () => {
    const h = harness(); h.run("startDemo('creator')");
    let ticks = 0;
    while (h.run('demoReplay.phase') !== 'complete' && ticks++ < 30) {
        assert.equal(h.timers.size, 1);
        const [id, timer] = h.timers.entries().next().value; h.timers.delete(id); timer.handler();
    }
    assert.equal(ticks, 17);
    assert.equal(h.run('demoReplay.phase'), 'complete');
    assert.equal(h.storage.size, 0);
    assert.equal(h.requests(), 0);
});

test('explicit confirmation restores only the saved prefix after a page reload', async () => {
    const h = harness(); h.run("byId('demo-auto').checked = false; startDemo('procurement')");
    for (let i = 0; i < 4; i++) h.run('advanceDemo(true)');
    const refreshed = harness(h.storage);
    assert.equal(refreshed.ids.get('demo-resume').hidden, false);
    await refreshed.click('demo-resume');
    assert.equal(refreshed.run('demoReplay.round'), 2);
    assert.equal(refreshed.run('demoReplay.phase'), 'question');
    assert.equal(refreshed.run('demoReplay.paused'), true);
    assert.equal(refreshed.timers.size, 0);
    assert.equal(Number(refreshed.ids.get('profile-turn-value').textContent), 2);
});

test('pause, scenario switch, logout, and storage failure leave no active playback timers', async () => {
    const h = harness(new Map(), true); h.run("startDemo('procurement')");
    await h.click('demo-pause'); assert.equal(h.timers.size, 0);
    h.run('advanceDemo(true); advanceDemo(true)');
    assert.match(h.ids.get('demo-save-status').textContent, /未允许本机保存/);
    h.run("startDemo('creator')");
    assert.equal(h.run('demoReplay.round'), 0);
    assert.equal(h.run('state.contentResult'), null);
    await h.event('huawei:session-ended');
    assert.equal(h.timers.size, 0);
    assert.equal(h.run('demoReplay.active'), false);
    assert.equal(h.ids.get('profile-answer').readOnly, false);
    assert.equal(h.run('state.access.canRun'), false);
    assert.equal(h.ids.get('download-json').href, undefined);
});

test('viewer cannot launch replay; invalid or outdated stored data is ignored', () => {
    const h = harness(new Map([['huawei.demo.confirmed.v1', '{invalid']]));
    h.run("state.access.canRun = false; startDemo('creator')");
    assert.equal(h.run('demoReplay.active'), false);
    assert.equal(h.ids.get('demo-resume').hidden, true);
    h.storage.set('huawei.demo.confirmed.v1', JSON.stringify({ version: 'old', scenario_id: 'creator', rounds: [] }));
    assert.equal(h.run('readDemoConfirmation()'), null);
});

test('wizard navigation requires completed interviews and reuses presets while paused', () => {
    const h = harness(); h.run("startDemo('creator'); demoNavigateStep(3)");
    assert.equal(h.run('state.wizardStep'), 1);
    assert.equal(h.timers.size, 0);
    for (let i = 0; i < 12; i++) h.run('advanceDemo(true)');
    h.run('demoNavigateStep(2)');
    assert.match(h.ids.get('match-download-json').href, /^blob:/);
    h.run('goToNextWizardStep()');
    assert.equal(h.run('state.contentPlatform'), '小红书');
    assert.equal(h.run('demoReplay.paused'), true);
    assert.equal(h.timers.size, 0);
    h.run('goToNextWizardStep()');
    assert.equal(h.run('state.wizardStep'), 4);
    assert.ok(h.run('state.markdown.length') > 0);
    assert.equal(h.requests(), 0);
});
