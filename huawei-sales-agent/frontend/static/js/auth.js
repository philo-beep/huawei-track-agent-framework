'use strict';

(() => {
    const byId = id => document.getElementById(id);
    const state = { session: null, mode: 'login', busy: false, motionPaused: false, usersLoaded: false };
    let readyResolve;
    const ready = new Promise(resolve => { readyResolve = resolve; });

    const roleNames = { admin: '管理员', member: '成员', viewer: '只读' };
    const permissionNames = { 'analysis:run': '运行分析', 'admin:users': '管理用户与权限' };

    function rememberMotion() {
        try { state.motionPaused = localStorage.getItem('huawei.motion.paused') === '1'; } catch { state.motionPaused = false; }
        applyMotion();
    }

    function applyMotion() {
        document.body.classList.toggle('motion-paused', state.motionPaused);
        const button = byId('motion-toggle');
        if (!button) return;
        button.setAttribute('aria-pressed', String(state.motionPaused));
        button.innerHTML = `<span aria-hidden="true">${state.motionPaused ? '▷' : 'Ⅱ'}</span>${state.motionPaused ? '继续动效' : '暂停动效'}`;
    }

    function setMessage(kind, message) {
        const error = byId('auth-error');
        const success = byId('auth-success');
        error.hidden = kind !== 'error' || !message;
        success.hidden = kind !== 'success' || !message;
        if (kind === 'error') error.textContent = message || '';
        if (kind === 'success') success.textContent = message || '';
    }

    function setBusy(busy) {
        state.busy = busy;
        byId('auth-form').setAttribute('aria-busy', String(busy));
        for (const id of ['auth-username', 'auth-password', 'auth-submit', 'password-toggle']) byId(id).disabled = busy;
        byId('auth-submit-label').textContent = busy ? '正在校验…' : state.mode === 'login' ? '安全登录' : '创建账号';
        for (const button of document.querySelectorAll('[data-auth-mode]')) button.disabled = busy;
    }

    function showStage(stage) {
        byId('prelogin').hidden = false;
        byId('app-shell').hidden = true;
        byId('prelogin').dataset.stage = stage;
        byId('welcome-stage').hidden = stage !== 'welcome';
        byId('auth-stage').hidden = stage !== 'auth';
        document.body.classList.add('auth-locked');
        document.body.classList.remove('app-ready');
        if (stage === 'auth') setTimeout(() => byId('auth-username').focus({ preventScroll: true }), 40);
    }

    function setMode(mode) {
        state.mode = mode === 'register' ? 'register' : 'login';
        byId('auth-mode-login').classList.toggle('is-active', state.mode === 'login');
        byId('auth-mode-register').classList.toggle('is-active', state.mode === 'register');
        byId('auth-mode-login').setAttribute('aria-selected', String(state.mode === 'login'));
        byId('auth-mode-register').setAttribute('aria-selected', String(state.mode === 'register'));
        byId('auth-eyebrow').textContent = state.mode === 'login' ? 'WELCOME BACK' : 'JOIN THE WORKSPACE';
        byId('auth-title').textContent = state.mode === 'login' ? '欢迎回来' : '创建你的账号';
        byId('auth-intro').textContent = state.mode === 'login' ? '登录后继续你的销售推进工作。' : '注册后进入受保护的销售智能工作台。';
        byId('auth-username-hint').hidden = state.mode !== 'register';
        byId('auth-password-hint').hidden = state.mode !== 'register';
        byId('auth-first-admin').hidden = state.mode !== 'register';
        byId('auth-password').setAttribute('autocomplete', state.mode === 'login' ? 'current-password' : 'new-password');
        byId('auth-submit-label').textContent = state.mode === 'login' ? '安全登录' : '创建账号';
        setMessage('', '');
    }

    async function request(path, options = {}) {
        const { body, anonymous = false, csrf = false, ...rest } = options;
        const headers = new Headers(options.headers || {});
        if (body !== undefined) headers.set('Content-Type', 'application/json');
        if (csrf && state.session?.csrf_token) headers.set('X-CSRF-Token', state.session.csrf_token);
        let response;
        try {
            response = await fetch(path, { ...rest, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
        } catch {
            const error = new Error('无法连接服务端，请确认服务已启动后重试');
            error.code = 'NETWORK_ERROR';
            throw error;
        }
        let payload = null;
        try { payload = await response.json(); } catch { /* 错误响应也可能不是 JSON。 */ }
        if (!response.ok) {
            const error = new Error(payload?.error?.message || `请求失败（${response.status}）`);
            error.status = response.status;
            error.code = payload?.error?.code || 'REQUEST_FAILED';
            if (response.status === 401 && !anonymous) expire(error);
            throw error;
        }
        return payload;
    }

    function expire(error = null) {
        if (!state.session && !error) return;
        state.session = null;
        state.usersLoaded = false;
        showStage('auth');
        setMode('login');
        setMessage('error', error?.message || '登录状态已失效，请重新登录。');
        window.dispatchEvent(new CustomEvent('huawei:session-ended'));
    }
    function updateAccountUi() {
        const user = state.session?.user;
        if (!user) return;
        byId('current-user-name').textContent = user.username;
        byId('current-user-avatar').textContent = [...user.username][0]?.toUpperCase() || 'H';
        byId('current-role').textContent = roleNames[user.role] || user.role;
        byId('current-role').dataset.role = user.role;
        byId('admin-open').hidden = !user.permissions.includes('admin:users');
        const canRun = user.permissions.includes('analysis:run');
        const notice = byId('access-notice');
        notice.hidden = canRun;
        if (!canRun) notice.textContent = '当前账号为只读角色：可以查看工作台与权限说明，但不能运行客户画像、产品匹配或内容生成。请联系管理员调整角色。';
    }

    function revealApp() {
        if (!state.session?.user) return;
        updateAccountUi();
        byId('prelogin').hidden = true;
        byId('app-shell').hidden = false;
        document.body.classList.remove('auth-locked');
        document.body.classList.add('app-ready');
    }

    function establishSession(payload) {
        if (!payload?.user?.id || !payload?.csrf_token) throw new Error('登录响应不完整，请重试');
        state.session = { user: payload.user, csrf_token: payload.csrf_token, expires_at: payload.expires_at };
        revealApp();
    }

    async function bootstrap() {
        rememberMotion();
        try {
            const payload = await request('/api/auth/me', { anonymous: true });
            establishSession(payload);
        } catch (error) {
            showStage('welcome');
            if (error.status !== 401) {
                showStage('auth');
                setMode('login');
                setMessage('error', error.message);
            }
        } finally {
            readyResolve(state.session);
            window.dispatchEvent(new CustomEvent('huawei:auth-ready', { detail: state.session }));
        }
    }

    function renderUsers(items) {
        const container = byId('admin-users');
        container.replaceChildren();
        for (const user of items) {
            const row = document.createElement('article');
            row.className = 'admin-user';
            const identity = document.createElement('div');
            identity.className = 'admin-user-identity';
            const avatar = document.createElement('span');
            avatar.className = 'account-avatar';
            avatar.textContent = [...user.username][0]?.toUpperCase() || 'U';
            const copy = document.createElement('span');
            const name = document.createElement('strong');
            name.textContent = user.username;
            const detail = document.createElement('small');
            detail.textContent = `${user.active ? '有效账号' : '已停用'} · ${(user.permissions || []).map(code => permissionNames[code] || code).join(' / ') || '无分析权限'}`;
            copy.append(name, detail);
            identity.append(avatar, copy);

            const controls = document.createElement('div');
            controls.className = 'admin-user-controls';
            const select = document.createElement('select');
            select.setAttribute('aria-label', `${user.username} 的角色`);
            for (const [role, label] of Object.entries(roleNames)) {
                const option = document.createElement('option');
                option.value = role;
                option.textContent = label;
                option.selected = role === user.role;
                select.append(option);
            }
            select.disabled = state.session.user.id === user.id;
            select.addEventListener('change', async () => {
                byId('admin-status').textContent = '正在保存角色变更…';
                try {
                    const result = await request(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'PATCH', csrf: true, body: { role: select.value } });
                    Object.assign(user, result.user);
                    byId('admin-status').textContent = `${user.username} 的角色已更新，权限立即生效。`;
                    renderUsers(items);
                } catch (error) {
                    select.value = user.role;
                    byId('admin-status').textContent = error.message;
                }
            });
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.textContent = user.active ? '停用' : '启用';
            toggle.disabled = state.session.user.id === user.id;
            toggle.addEventListener('click', async () => {
                byId('admin-status').textContent = '正在更新账号状态…';
                try {
                    const result = await request(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'PATCH', csrf: true, body: { active: !user.active } });
                    Object.assign(user, result.user);
                    byId('admin-status').textContent = `${user.username} 已${user.active ? '启用' : '停用'}。`;
                    renderUsers(items);
                } catch (error) {
                    byId('admin-status').textContent = error.message;
                }
            });
            controls.append(select, toggle);
            row.append(identity, controls);
            container.append(row);
        }
    }
    async function loadUsers() {
        byId('admin-status').textContent = state.usersLoaded ? '' : '正在读取用户…';
        try {
            const payload = await request('/api/admin/users');
            renderUsers(Array.isArray(payload?.items) ? payload.items : []);
            state.usersLoaded = true;
            byId('admin-status').textContent = '';
        } catch (error) {
            byId('admin-status').textContent = error.message;
        }
    }

    function openAdmin() {
        if (!state.session?.user?.permissions.includes('admin:users')) return;
        byId('admin-panel').hidden = false;
        document.body.classList.add('admin-open');
        loadUsers();
        setTimeout(() => byId('admin-close').focus({ preventScroll: true }), 20);
    }

    function closeAdmin() {
        byId('admin-panel').hidden = true;
        document.body.classList.remove('admin-open');
        byId('admin-open').focus({ preventScroll: true });
    }

    async function submitAuth(event) {
        event.preventDefault();
        if (state.busy) return;
        const username = byId('auth-username').value.trim();
        const password = byId('auth-password').value;
        if (!username || !password) return setMessage('error', '请填写用户名和密码。');
        if (password.length < 10 || password.length > 128) return setMessage('error', '密码长度需为 10–128 个字符。');
        setBusy(true);
        setMessage('', '');
        try {
            if (state.mode === 'register') {
                const result = await request('/api/auth/register', { method: 'POST', anonymous: true, body: { username, password } });
                byId('auth-password').value = '';
                setMode('login');
                setMessage('success', result.first_admin ? '管理员账号已创建，请登录。' : '账号已创建，请登录。');
                byId('auth-username').value = username;
                byId('auth-password').focus();
            } else {
                const result = await request('/api/auth/login', { method: 'POST', anonymous: true, body: { username, password } });
                byId('auth-password').value = '';
                establishSession(result);
                window.dispatchEvent(new CustomEvent('huawei:authenticated', { detail: state.session }));
            }
        } catch (error) {
            setMessage('error', error.message);
        } finally {
            setBusy(false);
        }
    }

    async function logout() {
        if (!state.session) return;
        byId('logout-button').disabled = true;
        try { await request('/api/auth/logout', { method: 'POST', csrf: true }); }
        catch (error) { byId('access-notice').hidden = false; byId('access-notice').textContent = error.message; return; }
        state.session = null;
        window.location.assign('/');
    }
    byId('welcome-enter').addEventListener('click', () => showStage('auth'));
    byId('auth-back').addEventListener('click', () => showStage('welcome'));
    for (const button of document.querySelectorAll('[data-auth-mode]')) button.addEventListener('click', () => setMode(button.dataset.authMode));
    byId('auth-form').addEventListener('submit', submitAuth);
    byId('password-toggle').addEventListener('click', () => {
        const input = byId('auth-password');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        byId('password-toggle').textContent = show ? '隐藏' : '显示';
        byId('password-toggle').setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    });
    byId('motion-toggle').addEventListener('click', () => {
        state.motionPaused = !state.motionPaused;
        try { localStorage.setItem('huawei.motion.paused', state.motionPaused ? '1' : '0'); } catch { /* 本地存储不可用不影响操作。 */ }
        applyMotion();
    });
    byId('logout-button').addEventListener('click', logout);
    byId('admin-open').addEventListener('click', openAdmin);
    byId('admin-close').addEventListener('click', closeAdmin);
    byId('admin-close-backdrop').addEventListener('click', closeAdmin);
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !byId('admin-panel').hidden) closeAdmin(); });

    window.HuaweiAuth = {
        ready,
        session: () => state.session,
        expire,
        openAdmin,
        logout,
        permission: code => Boolean(state.session?.user?.permissions.includes(code)),
    };
    bootstrap();
})();