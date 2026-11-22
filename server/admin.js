// Backoffice: rol global superadmin, métricas agregadas y administración acotada.
// Las vistas de usuario son curadas: nunca se devuelven emails, hashes ni tokens.
const express = require('express');
const rateLimit = require('express-rate-limit');
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

// ────────────────────────────────────────
// Fase 2 — Usuarios, sesiones y auditoría
// ────────────────────────────────────────

const writeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas acciones de administración, esperá un minuto' }
});

const toIso = seconds => seconds ? new Date(Number(seconds) * 1000).toISOString() : null;
const parseId = value => {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
};

function reasonOf(req) {
    return String(req.body?.reason ?? '').trim().slice(0, 300);
}

function requireReason(req, res) {
    const reason = reasonOf(req);
    if (!reason) {
        res.status(400).json({ error: 'El motivo es obligatorio y debe aparecer en la auditoría' });
        return null;
    }
    return reason;
}

async function writeAudit(actorId, action, targetType, targetId, reason) {
    await db.execute({
        sql: `INSERT INTO admin_audit_log (actor_id, action, target_type, target_id, reason)
              VALUES (?, ?, ?, ?, ?)`,
        args: [Number(actorId), action, targetType, targetId, reason]
    });
}

async function findUser(id) {
    const result = await db.execute('SELECT id, username, status FROM users WHERE id = ?', [id]);
    return result.rows[0] || null;
}

router.get('/users', async (req, res) => {
    try {
        const search = String(req.query.search ?? '').trim().slice(0, 80).toLowerCase();
        const status = ['active', 'disabled'].includes(req.query.status) ? req.query.status : null;
        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);

        const where = [];
        const args = [];
        if (search) {
            where.push('LOWER(u.username) LIKE ?');
            args.push(`%${search}%`);
        }
        if (status) {
            where.push('u.status = ?');
            args.push(status);
        }
        args.push(limit);

        const result = await db.execute({
            sql: `SELECT u.id, u.username, u.status,
                         COALESCE(u.global_role, u.role, 'member') AS role,
                         u.auth_provider, u.created_at,
                         (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen,
                         (SELECT COUNT(*) FROM group_members gm WHERE gm.user_id = u.id) AS group_count,
                         (SELECT 1 FROM superadmins sa WHERE sa.user_id = u.id) AS is_superadmin
                  FROM users u
                  ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                  ORDER BY u.id
                  LIMIT ?`,
            args
        });

        res.json({
            users: result.rows.map(r => ({
                id: Number(r.id),
                username: r.username,
                status: r.status === 'disabled' ? 'disabled' : 'active',
                role: r.role || 'member',
                authProvider: r.auth_provider || 'unknown',
                groupCount: Number(r.group_count ?? 0),
                isSuperadmin: r.is_superadmin === 1 || r.is_superadmin === true,
                createdAt: toIso(r.created_at),
                lastSeen: toIso(r.last_seen)
            })),
            limit
        });
    } catch (err) {
        console.error('[ADMIN] Error en /users:', err);
        res.status(500).json({ error: 'No se pudo listar los usuarios' });
    }
});

router.post('/users/:id/disable', writeLimiter, async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID de usuario inválido' });
        const reason = requireReason(req, res);
        if (!reason) return;

        const target = await findUser(id);
        if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
        if (id === Number(req.user.userId)) return res.status(400).json({ error: 'No podés desactivar tu propia cuenta' });
        if (await isSuperadmin(id)) return res.status(400).json({ error: 'No se puede desactivar a un superadmin' });
        if (target.status === 'disabled') return res.status(400).json({ error: 'El usuario ya está desactivado' });

        await db.execute("UPDATE users SET status = 'disabled' WHERE id = ?", [id]);
        const sessions = await db.execute('DELETE FROM sessions WHERE user_id = ?', [id]);
        await writeAudit(req.user.userId, 'user.disable', 'user', id, reason);
        console.log(`[ADMIN] Usuario ${target.username} (id ${id}) desactivado por ${req.user.username}`);
        res.json({ message: 'Usuario desactivado', userId: id, sessionsRevoked: Number(sessions.rowsAffected ?? 0) });
    } catch (err) {
        console.error('[ADMIN] Error desactivando usuario:', err);
        res.status(500).json({ error: 'No se pudo desactivar el usuario' });
    }
});

router.post('/users/:id/enable', writeLimiter, async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID de usuario inválido' });
        const reason = requireReason(req, res);
        if (!reason) return;

        const target = await findUser(id);
        if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
        if (target.status !== 'disabled') return res.status(400).json({ error: 'El usuario ya está activo' });

        await db.execute("UPDATE users SET status = 'active' WHERE id = ?", [id]);
        await writeAudit(req.user.userId, 'user.enable', 'user', id, reason);
        console.log(`[ADMIN] Usuario ${target.username} (id ${id}) reactivado por ${req.user.username}`);
        res.json({ message: 'Usuario reactivado', userId: id });
    } catch (err) {
        console.error('[ADMIN] Error reactivando usuario:', err);
        res.status(500).json({ error: 'No se pudo reactivar el usuario' });
    }
});

router.delete('/users/:id/sessions', writeLimiter, async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID de usuario inválido' });
        const reason = requireReason(req, res);
        if (!reason) return;

        const target = await findUser(id);
        if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
        if (id === Number(req.user.userId)) return res.status(400).json({ error: 'No podés revocar tus propias sesiones' });

        const sessions = await db.execute('DELETE FROM sessions WHERE user_id = ?', [id]);
        await writeAudit(req.user.userId, 'user.sessions_revoke', 'user', id, reason);
        console.log(`[ADMIN] Sesiones de ${target.username} (id ${id}) revocadas por ${req.user.username}`);
        res.json({ message: 'Sesiones revocadas', userId: id, revoked: Number(sessions.rowsAffected ?? 0) });
    } catch (err) {
        console.error('[ADMIN] Error revocando sesiones:', err);
        res.status(500).json({ error: 'No se pudieron revocar las sesiones' });
    }
});

router.get('/audit', async (req, res) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
        const result = await db.execute({
            sql: `SELECT a.id, a.action, a.target_type, a.target_id, a.reason, a.created_at,
                         a.actor_id, u.username AS actor
                  FROM admin_audit_log a
                  LEFT JOIN users u ON u.id = a.actor_id
                  ORDER BY a.id DESC
                  LIMIT ?`,
            args: [limit]
        });
        res.json({
            events: result.rows.map(r => ({
                id: Number(r.id),
                action: r.action,
                actor: r.actor || `usuario #${r.actor_id ?? ''}`,
                targetType: r.target_type,
                targetId: r.target_id === null || r.target_id === undefined ? null : Number(r.target_id),
                reason: r.reason || '',
                createdAt: toIso(r.created_at)
            })),
            limit
        });
    } catch (err) {
        console.error('[ADMIN] Error en /audit:', err);
        res.status(500).json({ error: 'No se pudo leer la auditoría' });
    }
});

module.exports = router;
module.exports.isSuperadmin = isSuperadmin;
