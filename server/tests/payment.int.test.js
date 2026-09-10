const { createClient } = require('@libsql/client');

const BASE_URL = 'http://localhost:4000';
const DB_URL = process.env.TURSO_DATABASE_URL;
const DB_TOKEN = process.env.TURSO_AUTH_TOKEN;

let sessionToken;

beforeAll(async () => {
    // Login y extraer session_token del header Set-Cookie
    const loginRes = await fetch(`${BASE_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'tin', password: process.env.AUTH_TIN })
    });
    const loginData = await loginRes.json();
    expect(loginData.user).toBe('tin');

    // Extraer session_token del Set-Cookie header
    const setCookie = loginRes.headers.get('set-cookie');
    const tokenMatch = setCookie.match(/session_token=([^;]+)/);
    expect(tokenMatch).not.toBeNull();
    sessionToken = tokenMatch[1];
}, 15000);

afterAll(async () => {
    // Cleanup: delete test payments
    if (DB_URL && DB_TOKEN) {
        const db = createClient({ url: DB_URL, authToken: DB_TOKEN });
        await db.execute('DELETE FROM payments WHERE description LIKE ?', ['test_%']);
        await db.close();
    }
}, 15000);

describe('Payment Endpoints', () => {

    const getFetchOpts = (method, body) => {
        const opts = {
            method,
            headers: {
                'Cookie': `session_token=${sessionToken}`
            }
        };
        if (body) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        return opts;
    };

    test('POST /api/payment - crear pago con UYU', async () => {
        const res = await fetch(`${BASE_URL}/api/payment`, getFetchOpts('POST', {
            from_user: 'me',
            to_user: 'partner',
            amount: 5000,
            currency: 'UYU',
            date: '2025-09-10',
            description: 'test_pago_uy'
        }));
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.message).toBe('Pago registrado con éxito');
        expect(data.id).toBeDefined();
    });

    test('POST /api/payment - crear pago con USD', async () => {
        const res = await fetch(`${BASE_URL}/api/payment`, getFetchOpts('POST', {
            from_user: 'partner',
            to_user: 'me',
            amount: 50,
            currency: 'USD',
            date: '2025-09-11',
            description: 'test_pago_usd'
        }));
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.message).toBe('Pago registrado con éxito');
    });

    test('POST /api/payment - validar monto negativo', async () => {
        const res = await fetch(`${BASE_URL}/api/payment`, getFetchOpts('POST', {
            from_user: 'me',
            to_user: 'partner',
            amount: -100,
            currency: 'UYU',
            date: '2025-09-10',
            description: 'test_monto_neg'
        }));
        const data = await res.json();
        expect(res.status).toBe(400);
        expect(data.error).toBe('El monto debe ser un número positivo');
    });

    test('POST /api/payment - validar mismo usuario', async () => {
        const res = await fetch(`${BASE_URL}/api/payment`, getFetchOpts('POST', {
            from_user: 'me',
            to_user: 'me',
            amount: 100,
            currency: 'UYU',
            date: '2025-09-10',
            description: 'test_mismo_user'
        }));
        const data = await res.json();
        expect(res.status).toBe(400);
        expect(data.error).toBe('No puedes pagarte a ti mismo');
    });

    test('POST /api/payment - validar fecha inválida', async () => {
        const res = await fetch(`${BASE_URL}/api/payment`, getFetchOpts('POST', {
            from_user: 'me',
            to_user: 'partner',
            amount: 100,
            currency: 'UYU',
            date: '2025-99-99',
            description: 'test_fecha'
        }));
        const data = await res.json();
        expect(res.status).toBe(400);
        expect(data.error).toBe('Fecha inválida');
    });

    test('GET /api/payments - listar pagos', async () => {
        const res = await fetch(`${BASE_URL}/api/payments`, {
            headers: { 'Cookie': `session_token=${sessionToken}` }
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBeGreaterThan(0);

        // Verificar estructura de los datos
        const firstPayment = data[0];
        expect(firstPayment).toHaveProperty('id');
        expect(firstPayment).toHaveProperty('from_user');
        expect(firstPayment).toHaveProperty('to_user');
        expect(firstPayment).toHaveProperty('amount');
        expect(firstPayment).toHaveProperty('currency');
        expect(firstPayment).toHaveProperty('date');
    });

    test('GET /api/expenses - balance incluye pagos', async () => {
        const res = await fetch(`${BASE_URL}/api/expenses`, {
            headers: { 'Cookie': `session_token=${sessionToken}` }
        });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.summary.payments).toBeDefined();
        expect(data.summary.payments).toHaveProperty('me');
        expect(data.summary.payments).toHaveProperty('partner');
        expect(data.summary.payments).toHaveProperty('net');
        expect(data.payments).toBeDefined();
        expect(Array.isArray(data.payments)).toBe(true);
    });

    test('DELETE /api/payment/:id - eliminar pago', async () => {
        // Obtener último pago de prueba
        const paymentsRes = await fetch(`${BASE_URL}/api/payments`, {
            headers: { 'Cookie': `session_token=${sessionToken}` }
        });
        const payments = await paymentsRes.json();
        const testPayment = payments.find(p => p.description === 'test_pago_uy');

        if (testPayment) {
            const delRes = await fetch(`${BASE_URL}/api/payment/${testPayment.id}`, {
                method: 'DELETE',
                headers: { 'Cookie': `session_token=${sessionToken}` }
            });
            const delData = await delRes.json();
            expect(delRes.status).toBe(200);
            expect(delData.message).toBe('Pago eliminado con éxito');

            // Verificar que ya no aparece
            const paymentsRes2 = await fetch(`${BASE_URL}/api/payments`, {
                headers: { 'Cookie': `session_token=${sessionToken}` }
            });
            const payments2 = await paymentsRes2.json();
            const stillExists = payments2.some(p => p.id === testPayment.id);
            expect(stillExists).toBe(false);
        }
    });

    test('DELETE /api/payment/:id - eliminar no existente', async () => {
        const res = await fetch(`${BASE_URL}/api/payment/999999`, {
            method: 'DELETE',
            headers: { 'Cookie': `session_token=${sessionToken}` }
        });
        const data = await res.json();
        expect(res.status).toBe(404);
        expect(data.error).toBe('Pago no encontrado');
    });

    test('GET /api/payments - sin auth', async () => {
        const res = await fetch(`${BASE_URL}/api/payments`);
        const data = await res.json();
        expect(res.status).toBe(401);
        expect(data.error).toBe('No autenticado');
    });

});
