// Integración del backoffice: acceso restringido, métricas y Fase 2 (usuarios/sesiones/auditoría).
// Usa cuentas ficticias con nombres fijos para poder re-correr la suite sin disparar
// el rate limit de /api/register. No lee .env ni secretos.
const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';
const PASSWORD = 'AdminTest12345!';

const accounts = {
    admin: { username: 'adminqa', email: 'adminqa@example.invalid', name: 'Admin QA', cookie: null, isSuperadmin: false },
    normal: { username: 'normalqa', email: 'normalqa@example.invalid', name: 'Normal QA', cookie: null, isSuperadmin: false },
    target: { username: 'targetqa', email: 'targetqa@example.invalid', name: 'Target QA', cookie: null, isSuperadmin: false }
};

function cookieOf(response) {
    const setCookie = response.headers.get('set-cookie') || '';
    return setCookie.match(/session_token=[^;]+/)?.[0] || '';
}

function opts(account, method, body) {
    const headers = {};
    if (account.cookie) headers.Cookie = account.cookie;
    if (body) headers['Content-Type'] = 'application/json';
    return { method, headers, body: body ? JSON.stringify(body) : undefined };
}

async function login(account) {
    const response = await fetch(`${BASE_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: account.username, password: PASSWORD })
    });
    account.cookie = response.ok ? cookieOf(response) : null;
    return response;
}

async function ensureAccount(account) {
    const registered = await fetch(`${BASE_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: account.username,
            password: PASSWORD,
            email: account.email,
            name: account.name
        })
    });
    if (!registered.ok && registered.status !== 409) {
        throw new Error(`No se pudo registrar ${account.username}: ${registered.status}`);
    }
    const logged = await login(account);
    if (!logged.ok) throw new Error(`No se pudo loguear ${account.username}: ${logged.status}`);
}

async function api(account, path, method = 'GET', body) {
    const response = await fetch(`${BASE_URL}${path}`, opts(account, method, body));
    const json = await response.json().catch(() => ({}));
    return { status: response.status, body: json };
}

beforeAll(async () => {
    await ensureAccount(accounts.admin);
    await ensureAccount(accounts.normal);
    await ensureAccount(accounts.target);
    const me = await api(accounts.admin, '/api/admin/me');
    accounts.admin.isSuperadmin = me.body.superadmin === true;
    if (accounts.admin.isSuperadmin) {
        const users = await api(accounts.admin, '/api/admin/users?limit=100');
        for (const account of Object.values(accounts)) {
            account.id = users.body.users.find(u => u.username === account.username)?.id;
        }
    }
}, 30000);

afterAll(async () => {
    for (const account of Object.values(accounts)) {
        if (!account.cookie) await login(account).catch(() => {});
        if (account.cookie) {
            await fetch(`${BASE_URL}/api/profile`, opts(account, 'DELETE', { current_password: PASSWORD })).catch(() => {});
        }
    }
}, 15000);

describe('Backoffice /api/admin — acceso', () => {
    test('sin sesión devuelve 401', async () => {
        expect((await api({}, '/api/admin/overview')).status).toBe(401);
    });

    test('usuario normal no ve /me como superadmin', async () => {
        const { status, body } = await api(accounts.normal, '/api/admin/me');
        expect(status).toBe(200);
        expect(body).toMatchObject({ superadmin: false, username: accounts.normal.username });
    });

    test('usuario normal recibe 403 en /overview', async () => {
        const { status, body } = await api(accounts.normal, '/api/admin/overview');
        expect(status).toBe(403);
        expect(body).toHaveProperty('error');
    });

    test('la ruta /admin se sirve públicamente (el control de acceso es en la API)', async () => {
        const res = await fetch(`${BASE_URL}/admin`);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('Backoffice');
    });

    test('usuario normal no puede listar usuarios ni leer auditoría', async () => {
        expect((await api(accounts.normal, '/api/admin/users')).status).toBe(403);
        expect((await api(accounts.normal, '/api/admin/audit')).status).toBe(403);
    });

    test('usuario normal no puede desactivar ni revocar sesiones', async () => {
        const id = accounts.target.id;
        expect((await api(accounts.normal, `/api/admin/users/${id}/disable`, 'POST', { reason: 'test' })).status).toBe(403);
        expect((await api(accounts.normal, `/api/admin/users/${id}/sessions`, 'DELETE', { reason: 'test' })).status).toBe(403);
    });
});

describe('Backoffice /api/admin — Fase 2 (requiere SUPERADMIN_USERNAME=adminqa)', () => {
    test('el bootstrap aplicó el rol de superadmin', () => {
        expect(accounts.admin.isSuperadmin).toBe(true);
    });

    test('lista usuarios curada, sin emails ni hashes', async () => {
        const { status, body } = await api(accounts.admin, '/api/admin/users?limit=100');
        expect(status).toBe(200);
        expect(Array.isArray(body.users)).toBe(true);
        const target = body.users.find(u => u.username === accounts.target.username);
        expect(target).toBeDefined();
        accounts.target.id = target.id;
        accounts.admin.id = body.users.find(u => u.username === accounts.admin.username).id;
        expect(target).not.toHaveProperty('email');
        expect(target).not.toHaveProperty('password_hash');
        expect(target).toHaveProperty('status', 'active');
        expect(target).toHaveProperty('isSuperadmin', false);
        expect(body.users.find(u => u.username === accounts.admin.username).isSuperadmin).toBe(true);
        expect(target).toHaveProperty('authProvider');
        expect(target).toHaveProperty('groupCount');
    });

    test('la búsqueda y el filtro por estado funcionan', async () => {
        const byName = await api(accounts.admin, `/api/admin/users?search=${accounts.target.username}`);
        expect(byName.status).toBe(200);
        expect(byName.body.users.every(u => u.username === accounts.target.username)).toBe(true);

        const byStatus = await api(accounts.admin, '/api/admin/users?status=active');
        expect(byStatus.status).toBe(200);
        expect(byStatus.body.users.every(u => u.status === 'active')).toBe(true);
    });

    test('toda acción requiere motivo', async () => {
        expect((await api(accounts.admin, `/api/admin/users/${accounts.target.id}/disable`, 'POST')).status).toBe(400);
        expect((await api(accounts.admin, `/api/admin/users/${accounts.target.id}/sessions`, 'DELETE', { reason: '   ' })).status).toBe(400);
    });

    test('no se puede desactivar la propia cuenta', async () => {
        const { status } = await api(accounts.admin, `/api/admin/users/${accounts.admin.id}/disable`, 'POST', { reason: 'test' });
        expect(status).toBe(400);
    });

    test('dar de baja bloquea login, cierra sesiones y deja auditoría', async () => {
        const action = await api(accounts.admin, `/api/admin/users/${accounts.target.id}/disable`, 'POST',
            { reason: 'Prueba automatizada de baja' });
        expect(action.status).toBe(200);
        expect(action.body.sessionsRevoked).toBeGreaterThanOrEqual(1);

        expect((await api(accounts.target, '/api/admin/me')).status).toBe(401);
        expect((await login(accounts.target)).status).toBe(401);

        const audit = await api(accounts.admin, '/api/admin/audit?limit=20');
        expect(audit.status).toBe(200);
        const event = audit.body.events.find(e => e.action === 'user.disable' && e.targetId === accounts.target.id);
        expect(event).toBeDefined();
        expect(event.reason).toBe('Prueba automatizada de baja');
        expect(event.actor).toBe(accounts.admin.username);
        expect(event).not.toHaveProperty('email');
    });

    test('reactivar permite volver a entrar', async () => {
        const action = await api(accounts.admin, `/api/admin/users/${accounts.target.id}/enable`, 'POST',
            { reason: 'Prueba automatizada de alta' });
        expect(action.status).toBe(200);
        expect((await login(accounts.target)).status).toBe(200);
        expect((await api(accounts.target, '/api/admin/me')).status).toBe(200);
    });

    test('revocar sesiones invalida la cookie actual', async () => {
        const action = await api(accounts.admin, `/api/admin/users/${accounts.target.id}/sessions`, 'DELETE',
            { reason: 'Prueba automatizada de revocación' });
        expect(action.status).toBe(200);
        expect((await api(accounts.target, '/api/admin/me')).status).toBe(401);
        accounts.target.cookie = null; // afterAll vuelve a loguear para poder borrar la cuenta
    });
});
