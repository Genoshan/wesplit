// Integración del backoffice (Fase 1): acceso restringido y métricas agregadas.
// Crea una cuenta ficticia y la elimina al final. No lee .env ni secretos.
const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';
const PASSWORD = 'AdminTest12345!';
const SUFFIX = Date.now();
const user = {
  username: `admintest${SUFFIX}`,
  name: 'Admin Test',
  email: `admintest${SUFFIX}@example.invalid`,
  cookie: null
};

function cookieOf(response) {
  const setCookie = response.headers.get('set-cookie') || '';
  return setCookie.match(/session_token=[^;]+/)?.[0] || '';
}

function opts(method, body) {
  const headers = { Cookie: user.cookie };
  if (body) headers['Content-Type'] = 'application/json';
  return { method, headers, body: body ? JSON.stringify(body) : undefined };
}

beforeAll(async () => {
  const res = await fetch(`${BASE_URL}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user.username, password: PASSWORD, email: user.email, name: user.name })
  });
  if (!res.ok) throw new Error(`No se pudo registrar ${user.username}: ${res.status}`);
  const login = await fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user.username, password: PASSWORD })
  });
  if (!login.ok) throw new Error(`No se pudo loguear ${user.username}: ${login.status}`);
  user.cookie = cookieOf(login);
}, 30000);

afterAll(async () => {
  if (user.cookie) {
    await fetch(`${BASE_URL}/api/profile`, opts('DELETE', { current_password: PASSWORD })).catch(() => {});
  }
}, 15000);

describe('Backoffice /api/admin', () => {
  test('sin sesión devuelve 401', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/overview`);
    expect(res.status).toBe(401);
  });

  test('usuario normal no ve /me como superadmin', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/me`, opts('GET'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ superadmin: false, username: user.username });
  });

  test('usuario normal recibe 403 en /overview', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/overview`, opts('GET'));
    expect(res.status).toBe(403);
    expect(await res.json()).toHaveProperty('error');
  });

  test('la ruta /admin se sirve públicamente (el control de acceso es en la API)', async () => {
    const res = await fetch(`${BASE_URL}/admin`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Backoffice');
  });
});
