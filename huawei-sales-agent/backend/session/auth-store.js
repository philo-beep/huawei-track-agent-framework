'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROLE_PERMISSIONS = Object.freeze({
    admin: Object.freeze(['analysis:run', 'admin:users']),
    member: Object.freeze(['analysis:run']),
    viewer: Object.freeze([]),
});
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_SESSIONS_PER_USER = 5;
const USERNAME_PATTERN = /^[\p{L}\p{N}_.-]{3,64}$/u;

class AccessError extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = 'AccessError';
        this.status = status;
        this.code = code;
    }
}

function normalizeUsername(value) {
    return typeof value === 'string' ? value.trim().normalize('NFKC') : '';
}

function usernameKey(value) {
    return normalizeUsername(value).toLocaleLowerCase('zh-CN');
}

function validateUsername(value) {
    const username = normalizeUsername(value);
    if (!USERNAME_PATTERN.test(username)) {
        throw new AccessError(422, 'USERNAME_INVALID', '用户名需为 3–64 个字符，可使用文字、数字、下划线、点和短横线');
    }
    return username;
}

function validatePassword(value) {
    if (typeof value !== 'string' || value.length < 10 || value.length > 128) {
        throw new AccessError(422, 'PASSWORD_INVALID', '密码长度需为 10–128 个字符');
    }
    return value;
}

function passwordDigest(password, salt) {
    return crypto.scryptSync(password, salt, 64);
}

function tokenDigest(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        role: user.role,
        active: user.active,
        permissions: [...ROLE_PERMISSIONS[user.role]],
        created_at: user.createdAt,
        last_login_at: user.lastLoginAt || null,
    };
}

class AuthStore {
    constructor(options = {}) {
        this.file = path.resolve(options.file || path.join(process.cwd(), '.runtime', 'auth.json'));
        this.state = this._load();
        if (this._purgeExpired()) this._save();
    }

    _emptyState() {
        return { version: 1, next_user_id: 1, users: [], sessions: [] };
    }

    _load() {
        if (!fs.existsSync(this.file)) return this._emptyState();
        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        } catch {
            throw new Error('访问控制数据文件损坏，服务已停止以避免绕过鉴权');
        }
        if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.users) || !Array.isArray(parsed.sessions) || !Number.isInteger(parsed.next_user_id)) {
            throw new Error('访问控制数据文件格式无效，服务已停止以避免绕过鉴权');
        }
        return parsed;
    }

    _save() {
        fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
        const temporary = `${this.file}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(temporary, this.file);
    }

    _purgeExpired(now = Date.now()) {
        const before = this.state.sessions.length;
        this.state.sessions = this.state.sessions.filter(session => session.expiresAt > now);
        return before !== this.state.sessions.length;
    }

    register(rawUsername, rawPassword) {
        const username = validateUsername(rawUsername);
        const password = validatePassword(rawPassword);
        const key = usernameKey(username);
        if (this.state.users.some(user => user.usernameKey === key)) {
            throw new AccessError(409, 'USERNAME_EXISTS', '用户名已存在，请更换用户名');
        }
        const now = Date.now();
        const role = this.state.users.length === 0 ? 'admin' : 'member';
        const salt = crypto.randomBytes(24).toString('hex');
        const user = {
            id: this.state.next_user_id++,
            username,
            usernameKey: key,
            salt,
            passwordHash: passwordDigest(password, salt).toString('hex'),
            role,
            active: true,
            createdAt: now,
            updatedAt: now,
            lastLoginAt: null,
        };
        this.state.users.push(user);
        this._save();
        return publicUser(user);
    }

    verifyCredentials(rawUsername, rawPassword) {
        const key = usernameKey(rawUsername);
        const user = this.state.users.find(item => item.usernameKey === key);
        const salt = user?.salt || '000000000000000000000000000000000000000000000000';
        const expectedHex = user?.passwordHash || '00'.repeat(64);
        let actual;
        try {
            actual = passwordDigest(typeof rawPassword === 'string' ? rawPassword : '', salt);
        } catch {
            return null;
        }
        const expected = Buffer.from(expectedHex, 'hex');
        const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
        return user && matches && user.active ? user : null;
    }

    login(rawUsername, rawPassword) {
        const user = this.verifyCredentials(rawUsername, rawPassword);
        if (!user) throw new AccessError(401, 'AUTH_INVALID', '用户名或密码错误，或账号已停用');
        const now = Date.now();
        const token = crypto.randomBytes(32).toString('hex');
        const csrf = crypto.randomBytes(32).toString('hex');
        const session = {
            id: crypto.randomUUID(),
            tokenHash: tokenDigest(token),
            userId: user.id,
            csrf,
            createdAt: now,
            expiresAt: now + SESSION_TTL_MS,
        };
        const existing = this.state.sessions.filter(item => item.userId === user.id).sort((a, b) => b.createdAt - a.createdAt);
        for (const stale of existing.slice(MAX_SESSIONS_PER_USER - 1)) this.state.sessions = this.state.sessions.filter(item => item.id !== stale.id);
        this.state.sessions.push(session);
        user.lastLoginAt = now;
        user.updatedAt = now;
        this._save();
        return { token, csrf, expiresAt: session.expiresAt, sessionId: session.id, user: publicUser(user) };
    }

    resolve(rawToken) {
        if (typeof rawToken !== 'string' || !/^[a-f0-9]{64}$/.test(rawToken)) return null;
        const now = Date.now();
        const digest = tokenDigest(rawToken);
        const session = this.state.sessions.find(item => item.tokenHash === digest);
        if (!session || session.expiresAt <= now) {
            if (session && this._purgeExpired(now)) this._save();
            return null;
        }
        const user = this.state.users.find(item => item.id === session.userId);
        if (!user || !user.active) {
            this.state.sessions = this.state.sessions.filter(item => item.id !== session.id);
            this._save();
            return null;
        }
        return {
            id: session.id,
            csrf: session.csrf,
            expiresAt: session.expiresAt,
            user: publicUser(user),
        };
    }

    revoke(rawToken) {
        if (typeof rawToken !== 'string') return false;
        const digest = tokenDigest(rawToken);
        const before = this.state.sessions.length;
        this.state.sessions = this.state.sessions.filter(item => item.tokenHash !== digest);
        if (before !== this.state.sessions.length) this._save();
        return before !== this.state.sessions.length;
    }

    listUsers() {
        return this.state.users
            .slice()
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(publicUser);
    }

    updateUser(actor, userId, changes) {
        if (!actor || actor.role !== 'admin') throw new AccessError(403, 'ADMIN_REQUIRED', '仅管理员可修改用户权限');
        const user = this.state.users.find(item => item.id === userId);
        if (!user) throw new AccessError(404, 'USER_NOT_FOUND', '用户不存在');
        const nextRole = changes.role === undefined ? user.role : changes.role;
        const nextActive = changes.active === undefined ? user.active : changes.active;
        if (!Object.hasOwn(ROLE_PERMISSIONS, nextRole)) throw new AccessError(422, 'ROLE_INVALID', '角色无效');
        if (typeof nextActive !== 'boolean') throw new AccessError(422, 'ACTIVE_INVALID', '账号状态必须为布尔值');
        if (actor.id === user.id && (!nextActive || nextRole !== 'admin')) {
            throw new AccessError(409, 'SELF_LOCKOUT', '不能停用或降级当前管理员账号');
        }
        const removesActiveAdmin = user.active && user.role === 'admin' && (!nextActive || nextRole !== 'admin');
        if (removesActiveAdmin && !this.state.users.some(item => item.id !== user.id && item.active && item.role === 'admin')) {
            throw new AccessError(409, 'LAST_ADMIN', '不能停用或降级最后一位管理员');
        }
        user.role = nextRole;
        user.active = nextActive;
        user.updatedAt = Date.now();
        if (!nextActive) this.state.sessions = this.state.sessions.filter(item => item.userId !== user.id);
        this._save();
        return publicUser(user);
    }
}

module.exports = { AuthStore, AccessError, ROLE_PERMISSIONS, SESSION_TTL_MS };
