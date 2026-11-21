// Integración: pagos group-scoped (settle up). Usa cuentas ficticias creadas
// en el propio test y las elimina al final. No depende de datos ni secretos locales.
const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';
const PASSWORD = 'TestPayment12345!';
const SUFFIX = Date.now();

const users = {
  owner: { username: `paytest${SUFFIX}a`, name: 'Pago Test Owner', email: `paytest${SUFFIX}a@example.invalid`, cookie: null },
  member: { username: `paytest${SUFFIX}b`, name: 'Pago Test Member', email: `paytest${SUFFIX}b@example.invalid`, cookie: null }
};
let groupId;
let createdPaymentId;

function cookieOf(response) {
  const setCookie = response.headers.get('set-cookie') || '';
  return setCookie.match(/session_token=[^;]+/)?.[0] || '';
}

async function register(user) {
  const res = await fetch(`${BASE_URL}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user.username, password: PASSWORD, email: user.email, name: user.name })
  });
  if (!res.ok) throw new Error(`No se pudo registrar ${user.username}: ${res.status}`);
}

async function login(user) {
  const res = await fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user.username, password: PASSWORD })
  });
  if (!res.ok) throw new Error(`No se pudo loguear ${user.username}: ${res.status}`);
  user.cookie = cookieOf(res);
}

function opts(user, method, body) {
  const headers = { Cookie: user.cookie };
  if (body) headers['Content-Type'] = 'application/json';
  return { method, headers, body: body ? JSON.stringify(body) : undefined };
}

beforeAll(async () => {
  await register(users.owner);
  await register(users.member);
  await login(users.owner);
  await login(users.member);

  const created = await fetch(`${BASE_URL}/api/groups`, opts(users.owner, 'POST', {
    name: 'Grupo pagos test', base_currency: 'UYU'
  }));
  if (!created.ok) throw new Error(`No se pudo crear el grupo: ${created.status}`);
  groupId = (await created.json()).id;

  const invited = await fetch(`${BASE_URL}/api/groups/${groupId}/members`, opts(users.owner, 'POST', {
    username: users.member.username, role: 'member'
  }));
  if (!invited.ok) throw new Error(`No se pudo invitar: ${invited.status}`);
  const invitationsRes = await fetch(`${BASE_URL}/api/groups/invitations`, opts(users.member, 'GET'));
  const invitations = await invitationsRes.json();
  const invitation = invitations.find(i => String(i.group_id) === String(groupId));
  if (!invitation) throw new Error('No apareció la invitación');
  const accepted = await fetch(`${BASE_URL}/api/groups/invitations/${invitation.id}/accept`, opts(users.member, 'POST', {}));
  if (!accepted.ok) throw new Error(`No se pudo aceptar: ${accepted.status}`);
}, 30000);

afterAll(async () => {
  for (const user of [users.owner, users.member]) {
    if (!user.cookie) continue;
    await fetch(`${BASE_URL}/api/profile`, opts(user, 'DELETE', { current_password: PASSWORD })).catch(() => {});
  }
}, 15000);

describe('Pagos group-scoped', () => {
  test('POST crea un pago en el grupo', async () => {
    const res = await fetch(`${BASE_URL}/api/groups/${groupId}/payments`, opts(users.owner, 'POST', {
      from_user: users.owner.username,
      to_user: users.member.username,
      amount: 500,
      currency: 'UYU',
      date: '2026-11-20',
      description: 'test_pago_uy'
    }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.id).toBeDefined();
    createdPaymentId = data.id;
  });

  test('POST rechaza monto negativo', async () => {
    const res = await fetch(`${BASE_URL}/api/groups/${groupId}/payments`, opts(users.owner, 'POST', {
      from_user: users.owner.username, to_user: users.member.username, amount: -1, date: '2026-11-20'
    }));
    expect(res.status).toBe(400);
  });

  test('POST rechaza pagarse a sí mismo', async () => {
    const res = await fetch(`${BASE_URL}/api/groups/${groupId}/payments`, opts(users.owner, 'POST', {
      from_user: users.owner.username, to_user: users.owner.username, amount: 10, date: '2026-11-20'
    }));
    expect(res.status).toBe(400);
  });

  test('POST rechaza fecha inválida', async () => {
    const res = await fetch(`${BASE_URL}/api/groups/${groupId}/payments`, opts(users.owner, 'POST', {
      from_user: users.owner.username, to_user: users.member.username, amount: 10, date: '2026-99-99'
    }));
    expect(res.status).toBe(400);
  });

  test('GET lista pagos del grupo', async () => {
    const res = await fetch(`${BASE_URL}/api/groups/${groupId}/payments`, opts(users.owner, 'GET'));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.some(p => p.id === createdPaymentId)).toBe(true);
    expect(data[0]).toHaveProperty('from_name');
  });

  test('GET balance refleja el pago', async () => {
    const res = await fetch(`${BASE_URL}/api/groups/${groupId}/balance`, opts(users.owner, 'GET'));
    const data = await res.json();
    expect(res.status).toBe(200);
    const owner = data.balances.find(b => b.username === users.owner.username);
    expect(owner.payments_net).toBe(500);
  });

  test('GET exporta CSV del grupo', async () => {
    const res = await fetch(`${BASE_URL}/api/groups/${groupId}/export/csv`, opts(users.owner, 'GET'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const csv = await res.text();
    expect(csv).toContain('Reparto');
    expect(csv).toContain('test_pago_uy');
  });

  test('DELETE elimina el pago y luego da 404', async () => {
    const res = await fetch(`${BASE_URL}/api/groups/${groupId}/payments/${createdPaymentId}`, opts(users.owner, 'DELETE'));
    expect(res.status).toBe(200);
    const again = await fetch(`${BASE_URL}/api/groups/${groupId}/payments/${createdPaymentId}`, opts(users.owner, 'DELETE'));
    expect(again.status).toBe(404);
  });

  test('GET sin sesión devuelve 401', async () => {
    const res = await fetch(`${BASE_URL}/api/groups/${groupId}/payments`);
    expect(res.status).toBe(401);
  });
});
