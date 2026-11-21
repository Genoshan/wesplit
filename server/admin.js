// Backoffice Fase 1: rol global superadmin + métricas agregadas.
// Ningún endpoint devuelve filas de usuario: solo números y agrupaciones.
const express = require('express');
const db = require('./database');
const { authMiddleware } = require('./auth');

const router = express.Router();

async function isSuperadmin(userId) {
    if (!userId) return false;
    const result = await db.execute('SELECT 1 FROM superadmins WHERE user_id = ? LIMIT 1', [Number(userId)]);
    return result.rows.length > 0;
}

router.use(authMiddleware);

// El front usa este endpoint para saber si muestra el enlace a /admin.
// Responde 200 con false para usuarios normales (evita 403 ruidoso en la consola).
router.get('/me', async (req, res) => {
    try {
        res.json({ superadmin: await isSuperadmin(req.user.userId), username: req.user.username });
    } catch (err) {
        console.error('[ADMIN] Error en /me:', err);
        res.status(500).json({ error: 'No se pudo verificar el permiso' });
    }
});

async function requireSuperadmin(req, res, next) {
    try {
        if (!(await isSuperadmin(req.user.userId))) {
            return res.status(403).json({ error: 'Acceso restringido a superadmins' });
        }
        next();
    } catch (err) {
        console.error('[ADMIN] Error verificando superadmin:', err);
        res.status(500).json({ error: 'No se pudo verificar el permiso' });
    }
}

router.use(requireSuperadmin);

const count = async (sql, args = []) => {
    const result = await db.execute(sql, args);
    return Number(result.rows[0]?.n ?? 0);
};

const dayCutoff = () => Math.floor(Date.now() / 1000) - 13 * 86400;
const dateCutoff = () => new Date(Date.now() - 13 * 86400 * 1000).toISOString().slice(0, 10);

function mergeByDay(expenses, payments) {
    const days = new Set([...expenses.map(r => r.day), ...payments.map(r => r.day)]);
    return [...days].sort().map(day => ({
        day,
        expenses: Number(expenses.find(r => r.day === day)?.n ?? 0),
        payments: Number(payments.find(r => r.day === day)?.n ?? 0)
    }));
}

function mergeByCurrency(expenses, payments) {
    const currencies = new Set([...expenses.map(r => r.currency), ...payments.map(r => r.currency)]);
    return [...currencies].sort().map(currency => ({
        currency,
        expenses: Number(expenses.find(r => r.currency === currency)?.n ?? 0),
        payments: Number(payments.find(r => r.currency === currency)?.n ?? 0),
        expenseAmount: Number(expenses.find(r => r.currency === currency)?.amount ?? 0),
        paymentAmount: Number(payments.find(r => r.currency === currency)?.amount ?? 0)
    }));
}

router.get('/overview', async (req, res) => {
    try {
        const [users, groups, expenses, payments, activeSessions, signupsByDay, authProviders,
            groupsByDay, expenseDays, paymentDays, expenseByCurrency, paymentByCurrency,
            usersWithExpense, retentionD7, retentionD30] = await Promise.all([
            count('SELECT COUNT(*) AS n FROM users'),
            count('SELECT COUNT(*) AS n FROM groups'),
            count('SELECT COUNT(*) AS n FROM group_expenses'),
            count('SELECT COUNT(*) AS n FROM group_payments'),
            count('SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE expires_at > ?', [Date.now()]),
            db.execute('SELECT date(created_at, \'unixepoch\') AS day, COUNT(*) AS n FROM users WHERE created_at >= ? GROUP BY day ORDER BY day', [dayCutoff()]),
            db.execute('SELECT auth_provider AS provider, COUNT(*) AS n FROM users GROUP BY provider ORDER BY n DESC'),
            db.execute('SELECT date(created_at, \'unixepoch\') AS day, COUNT(*) AS n FROM groups WHERE created_at >= ? GROUP BY day ORDER BY day', [dayCutoff()]),
            db.execute('SELECT date AS day, COUNT(*) AS n FROM group_expenses WHERE date >= ? GROUP BY day ORDER BY day', [dateCutoff()]),
            db.execute('SELECT date AS day, COUNT(*) AS n FROM group_payments WHERE date >= ? GROUP BY day ORDER BY day', [dateCutoff()]),
            db.execute('SELECT currency, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amount FROM group_expenses GROUP BY currency ORDER BY amount DESC'),
            db.execute('SELECT currency, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amount FROM group_payments GROUP BY currency ORDER BY amount DESC'),
            count('SELECT COUNT(DISTINCT g.owner_id) AS n FROM groups g WHERE EXISTS (SELECT 1 FROM group_expenses ge WHERE ge.group_id = g.id)'),
            count('SELECT COUNT(DISTINCT u.id) AS n FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.created_at BETWEEN u.created_at + 86400 AND u.created_at + 604800'),
            count('SELECT COUNT(DISTINCT u.id) AS n FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.created_at BETWEEN u.created_at + 86400 AND u.created_at + 2592000')
        ]);

        res.json({
            generatedAt: new Date().toISOString(),
            totals: { users, groups, expenses, payments, activeSessions },
            signupsByDay: signupsByDay.rows.map(r => ({ day: r.day, count: Number(r.n) })),
            authProviders: authProviders.rows.map(r => ({ provider: r.provider || 'unknown', count: Number(r.n) })),
            groupsByDay: groupsByDay.rows.map(r => ({ day: r.day, count: Number(r.n) })),
            activityByDay: mergeByDay(expenseDays.rows, paymentDays.rows),
            byCurrency: mergeByCurrency(expenseByCurrency.rows, paymentByCurrency.rows),
            firstExpense: {
                usersWithExpense,
                totalUsers: users,
                percent: users ? Math.round((usersWithExpense / users) * 100) : 0
            },
            retention: { d7: retentionD7, d30: retentionD30 },
            windowDays: 14,
            note: 'Los montos se agrupan por moneda; no hay conversión entre monedas.'
        });
    } catch (err) {
        console.error('[ADMIN] Error en /overview:', err);
        res.status(500).json({ error: 'No se pudieron calcular las métricas' });
    }
});

module.exports = router;
module.exports.isSuperadmin = isSuperadmin;
