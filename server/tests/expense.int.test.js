// Integración: gastos group-scoped, reparto, validaciones y moneda del grupo.
// Usa cuentas ficticias creadas en el propio test y las elimina al final.
const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';
const PASSWORD = 'TestExpense12345!';
const SUFFIX = Date.now();

const users = {
  owner: { username: `extest${SUFFIX}a`, name: 'Gasto Test Owner', email: `extest${SUFFIX}a@example.invalid`, cookie: null },
  member: { username: `extest${SUFFIX}b`, name: 'Gasto Test Member', email: `extest${SUFFIX}b@example.invalid`, cookie: null }
};
let groupId;
let memberIds = [];
let equalExpenseId;
let customExpenseId;

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

function expensePayload(overrides = {}) {
  return {
    date: '2026-11-21',
    description: 'gasto_test',
    amount: 10,
    payer: users.owner.username,
    category: 'Otros',
    split_mode: 'equal',
    currency: 'EUR', // debe ignorarse: el grupo es USD
    ...overrides
  };
}

beforeAll(async () => {
  await register(users.owner);
  await register(users.member);
  await login(users.owner);
  await login(users.member);

  const created = await fetch(`${BASE_URL}/api/groups`, opts(users.owner, 'POST', {
    name: 'Grupo gastos test', base_currency: 'USD'
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

  const infoRes = await fetch(`${BASE_URL}/api/groups/${groupId}`, opts(users.owner, 'GET'));
  const info = await infoRes.json();
  memberIds = info.members.filter(m => m.status === 'active').map(m => m.user_id);
}, 30000);

afterAll(async () => {
  for (const user of [users.owner, users.member]) {
    if (!user.cookie) continue;
    await fetch(`${BASE_URL}/api/profile`, opts(user, 'DELETE', { current_password: PASSWORD })).catch(() => {});
  }
}, 15000);

describe('Gastos group-scoped', () => {
  test('auth/check trae los miembros activos del grupo para el selector', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/check`, opts(users.owner, 'GET'));
    const data = await res.json();
    const group = data.groups.find(g => String(g.id) === String(groupId));
    expect(group).toBeDefined();
    expect(group.member_names).toContain(users.owner.username);
    expect(group.member_names).toContain(users.member.username);
  });

  test('POST equal reparte los centavos sobrantes sin perder importes', async () => {
    const res = await fetch(`${BASE_URL}/api/groups/${groupId}/expenses`, opts(users.owner, 'POST',
      expensePayload({ description: 'gasto_centavos', amount: 0.01 })));
    const data = await res.json();
    expect(res.status).toBe(200);
    equalExpenseId = data.id;

    const list = await (await fetch(`${BASE_URL}/api/groups/${groupId}/expenses`, opts(users.owner, 'GET'))).json();
    const expense = list.find(e => e.id === equalExpenseId);
    expect(expense).toBeDefined();
    expect(expense.splits).toHaveLength(2);
    const sum = expense.splits.reduce((acc, s) => acc + Number(s.amount), 0);
    expect(sum).toBeCloseTo(0.01, 2);
  });

  test('POST rechaza fecha inválida', async () => {
    const res = await fetch(`${BASE_URL}/api/groups/${groupId}/expenses`, opts(users.owner, 'POST',
      expensePayload({ date: '2026-02-30' })));
    expect(res.status).toBe(400);
  });

  test('POST ignora la moneda del body y usa la del grupo', async () => {
    const res = await fetch(`${BASE_URL}/api/groups/${groupId}/expenses`, opts(users.owner, 'POST',
      expensePayload({ description: 'gasto_moneda' })));
    expect(res.status).toBe(200);
    const list = await (await fetch(`${BASE_URL}/api/groups/${groupId}/expenses`, opts(users.owner, 'GET'))).json();
    const expense = list.find(e => e.description === 'gasto_moneda');
    expect(expense.currency).toBe('USD');
  });

  test('POST custom tolera 1 centavo pero rechaza 2', async () => {
    const splits = [
      { user_id: memberIds[0], amount: 5 },
      { user_id: memberIds[1], amount: 4.99 }
    ];
    const ok = await fetch(`${BASE_URL}/api/groups/${groupId}/expenses`, opts(users.owner, 'POST',
      expensePayload({ description: 'gasto_custom_ok', split_mode: 'custom', splits })));
    expect(ok.status).toBe(200);
    customExpenseId = (await ok.json()).id;

    const bad = await fetch(`${BASE_URL}/api/groups/${groupId}/expenses`, opts(users.owner, 'POST',
      expensePayload({ description: 'gasto_custom_bad', split_mode: 'custom', splits: [
        { user_id: memberIds[0], amount: 5 },
        { user_id: memberIds[1], amount: 4.98 }
      ] })));
    expect(bad.status).toBe(400);
  });

  test('PUT actualiza monto y descripción', async () => {
    const res = await fetch(`${BASE_URL}/api/groups/${groupId}/expenses/${customExpenseId}`, opts(users.owner, 'PUT',
      expensePayload({ description: 'gasto_editado', amount: 20, split_mode: 'equal' })));
    expect(res.status).toBe(200);
    const list = await (await fetch(`${BASE_URL}/api/groups/${groupId}/expenses`, opts(users.owner, 'GET'))).json();
    const expense = list.find(e => e.id === customExpenseId);
    expect(expense.description).toBe('gasto_editado');
    expect(expense.amount).toBe(20);
  });

  test('DELETE borra el gasto y sus splits', async () => {
    const res = await fetch(`${BASE_URL}/api/groups/${groupId}/expenses/${equalExpenseId}`, opts(users.owner, 'DELETE'));
    expect(res.status).toBe(200);
    const list = await (await fetch(`${BASE_URL}/api/groups/${groupId}/expenses`, opts(users.owner, 'GET'))).json();
    expect(list.some(e => e.id === equalExpenseId)).toBe(false);
  });

  test('Un miembro no puede editar el grupo (403)', async () => {
    const res = await fetch(`${BASE_URL}/api/groups/${groupId}`, opts(users.member, 'PUT', {
      name: 'Intento de cambio', base_currency: 'USD'
    }));
    expect(res.status).toBe(403);
  });

  test('GET sin sesión devuelve 401', async () => {
    const res = await fetch(`${BASE_URL}/api/groups/${groupId}/expenses`);
    expect(res.status).toBe(401);
  });
});

describe('Moneda única también en pagos', () => {
  test('POST ignora la moneda del body y usa la del grupo', async () => {
    const res = await fetch(`${BASE_URL}/api/groups/${groupId}/payments`, opts(users.owner, 'POST', {
      from_user: users.owner.username,
      to_user: users.member.username,
      amount: 5,
      currency: 'EUR',
      date: '2026-11-21',
      description: 'pago_moneda'
    }));
    expect(res.status).toBe(200);
    const paymentId = (await res.json()).id;
    const list = await (await fetch(`${BASE_URL}/api/groups/${groupId}/payments`, opts(users.owner, 'GET'))).json();
    const payment = list.find(p => p.id === paymentId);
    expect(payment.currency).toBe('USD');
    await fetch(`${BASE_URL}/api/groups/${groupId}/payments/${paymentId}`, opts(users.owner, 'DELETE'));
  });
});
