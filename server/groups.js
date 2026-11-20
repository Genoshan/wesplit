const express = require('express');
const router = express.Router();
const db = require('./database');
const { authMiddleware } = require('./auth');

// Todas las rutas requieren autenticación
router.use(authMiddleware);

// ────────────────────────────────────────
// GET / — listar grupos del usuario
// ────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const { userId } = req.user;
        const result = await db.execute(`
            SELECT g.*, gm.role as member_role
            FROM groups g
            JOIN group_members gm ON g.id = gm.group_id
            WHERE gm.user_id = ?
            ORDER BY g.name ASC
        `, [userId]);

        res.json(result.rows);
    } catch (err) {
        console.error('[GROUPS] Error listando grupos:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// ────────────────────────────────────────
// POST / — crear grupo
// ────────────────────────────────────────
router.post('/', async (req, res) => {
    const { name, base_currency } = req.body;
    const cleanName = name ? name.trim() : '';
    const currency = (base_currency || 'UYU').toUpperCase();

    if (!cleanName || cleanName.length < 1) {
        return res.status(400).json({ error: 'El nombre del grupo es requerido' });
    }
    if (cleanName.length > 100) {
        return res.status(400).json({ error: 'Nombre demasiado largo (máximo 100 caracteres)' });
    }

    try {
        const { userId, username } = req.user;

        const result = await db.execute({
            sql: 'INSERT INTO groups (name, owner_id, base_currency) VALUES (?, ?, ?)',
            args: [cleanName, userId, currency]
        });

        await db.execute({
            sql: 'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
            args: [result.lastInsertRowid, userId, 'admin']
        });

        console.log(`[GROUPS] Grupo creado: "${cleanName}" por ${username}`);
        res.json({
            id: Number(result.lastInsertRowid),
            name: cleanName,
            currency,
            message: 'Grupo creado con éxito'
        });
    } catch (err) {
        console.error('[GROUPS] Error creando grupo:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// ────────────────────────────────────────
// GET /:id — info del grupo + miembros
// ────────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const groupId = req.params.id;
        const { userId } = req.user;

        const memberCheck = await db.execute(`
            SELECT role FROM group_members WHERE group_id = ? AND user_id = ?
        `, [groupId, userId]);

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }

        const groupResult = await db.execute(`
            SELECT g.*, u.username, u.role as owner_role
            FROM groups g
            JOIN users u ON g.owner_id = u.id
            WHERE g.id = ?
        `, [groupId]);

        if (groupResult.rows.length === 0) {
            return res.status(404).json({ error: 'Grupo no encontrado' });
        }

        const membersResult = await db.execute(`
            SELECT gm.user_id, gm.role as member_role, u.username
            FROM group_members gm
            JOIN users u ON gm.user_id = u.id
            WHERE gm.group_id = ?
            ORDER BY gm.role ASC, u.username ASC
        `, [groupId]);

        const group = groupResult.rows[0];
        group.members = membersResult.rows;

        res.json(group);
    } catch (err) {
        console.error('[GROUPS] Error obteniendo grupo:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// ────────────────────────────────────────
// PUT /:id — editar grupo (solo owner)
// ────────────────────────────────────────
router.put('/:id', async (req, res) => {
    const { name, base_currency } = req.body;
    const cleanName = name ? name.trim() : '';

    if (!cleanName || cleanName.length < 1) {
        return res.status(400).json({ error: 'El nombre del grupo es requerido' });
    }

    try {
        const { userId } = req.user;
        const groupId = req.params.id;

        const memberCheck = await db.execute(`
            SELECT role FROM group_members WHERE group_id = ? AND user_id = ?
        `, [groupId, userId]);

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }
        if (memberCheck.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Solo el owner puede editar el grupo' });
        }

        const currency = base_currency ? base_currency.toUpperCase() : 'UYU';
        await db.execute(
            'UPDATE groups SET name = ?, base_currency = ? WHERE id = ?',
            [cleanName, currency, groupId]
        );

        console.log(`[GROUPS] Grupo actualizado: "${cleanName}" (ID: ${groupId})`);
        res.json({ message: 'Grupo actualizado con éxito', name: cleanName, currency });
    } catch (err) {
        console.error('[GROUPS] Error editando grupo:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// ────────────────────────────────────────
// DELETE /:id — eliminar grupo (solo owner)
// ────────────────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const { userId } = req.user;
        const groupId = req.params.id;

        const memberCheck = await db.execute(`
            SELECT role FROM group_members WHERE group_id = ? AND user_id = ?
        `, [groupId, userId]);

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }
        if (memberCheck.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Solo el owner puede eliminar el grupo' });
        }

        await db.execute('DELETE FROM groups WHERE id = ?', [groupId]);
        console.log(`[GROUPS] Grupo eliminado (ID: ${groupId})`);
        res.json({ message: 'Grupo eliminado con éxito' });
    } catch (err) {
        console.error('[GROUPS] Error eliminando grupo:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// ────────────────────────────────────────
// POST /:id/members — agregar miembro
// ────────────────────────────────────────
router.post('/:id/members', async (req, res) => {
    const { username, role } = req.body;
    const cleanRole = role || 'member';

    if (!username || !['admin', 'member'].includes(cleanRole)) {
        return res.status(400).json({ error: 'Se requiere username y role válido (admin/member)' });
    }

    try {
        const { userId } = req.user;
        const groupId = req.params.id;

        const memberCheck = await db.execute(`
            SELECT role FROM group_members WHERE group_id = ? AND user_id = ?
        `, [groupId, userId]);

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }
        if (memberCheck.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Solo los admins pueden agregar miembros' });
        }

        const userResult = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const targetUserId = userResult.rows[0].id;
        if (targetUserId === userId) {
            return res.status(400).json({ error: 'No puedes agregarte a ti mismo' });
        }

        await db.execute({
            sql: 'INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
            args: [groupId, targetUserId, cleanRole]
        });

        console.log(`[GROUPS] Miembro "${username}" agregado al grupo (ID: ${groupId})`);
        res.json({ message: 'Miembro agregado con éxito', username, role: cleanRole });
    } catch (err) {
        console.error('[GROUPS] Error agregando miembro:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// ────────────────────────────────────────
// DELETE /:id/members/:userId — remover miembro
// ────────────────────────────────────────
router.delete('/:id/members/:userId', async (req, res) => {
    try {
        const { userId } = req.user;
        const groupId = req.params.id;
        const targetUserId = req.params.userId;

        const memberCheck = await db.execute(`
            SELECT role FROM group_members WHERE group_id = ? AND user_id = ?
        `, [groupId, userId]);

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }
        if (memberCheck.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Solo los admins pueden remover miembros' });
        }

        if (targetUserId === userId) {
            return res.status(400).json({ error: 'Para salir, elimina el grupo completo' });
        }

        await db.execute(
            'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, targetUserId]
        );

        console.log(`[GROUPS] Miembro (ID: ${targetUserId}) removido del grupo (ID: ${groupId})`);
        res.json({ message: 'Miembro removido con éxito' });
    } catch (err) {
        console.error('[GROUPS] Error removiendo miembro:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// ────────────────────────────────────────
// GET /:id/expenses — listar gastos del grupo
// ────────────────────────────────────────
router.get('/:id/expenses', async (req, res) => {
    try {
        const groupId = req.params.id;
        const { userId } = req.user;

        const memberCheck = await db.execute(
            'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, userId]
        );
        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }

        const result = await db.execute(`
            SELECT ge.*, u2.username as payer_username
            FROM group_expenses ge
            JOIN users u2 ON ge.payer = u2.username
            WHERE ge.group_id = ?
            ORDER BY ge.date DESC, ge.created_at DESC
        `, [groupId]);

        const expenses = result.rows.map(row => {
            row.splits = [];
            return row;
        });

        if (expenses.length > 0) {
            const ids = expenses.map(e => e.id);
            const placeholders = ids.map(() => '?').join(',');
            const splitsResult = await db.execute(`
                SELECT gs.*, u3.username as split_username
                FROM group_splits gs
                LEFT JOIN users u3 ON gs.user_id = u3.username
                WHERE gs.expense_id IN (${placeholders})
                ORDER BY gs.expense_id
            `, ids);

            for (const split of splitsResult.rows) {
                const exp = expenses.find(e => e.id === split.expense_id);
                if (exp) exp.splits.push(split);
            }
        }

        res.json(expenses);
    } catch (err) {
        console.error('[GROUPS] Error listando gastos:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// ────────────────────────────────────────
// POST /:id/expenses — crear gasto
// ────────────────────────────────────────
router.post('/:id/expenses', async (req, res) => {
    try {
        const groupId = req.params.id;
        const { userId, username } = req.user;
        const { date, description, amount, payer, category, currency, split_mode, splits } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
        }
        if (!date) {
            return res.status(400).json({ error: 'La fecha es requerida' });
        }

        const memberCheck = await db.execute(
            'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, userId]
        );
        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }

        const groupInfo = await db.execute(
            'SELECT base_currency FROM groups WHERE id = ?', [groupId]
        );
        const currencyCode = currency || groupInfo.rows[0].base_currency || 'UYU';

        const payerCheck = await db.execute(
            'SELECT u.id FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ? AND u.username = ?',
            [groupId, payer]
        );
        const validPayer = payerCheck.rows.length > 0 ? payer : username;

        const result = await db.execute({
            sql: 'INSERT INTO group_expenses (group_id, date, description, amount, payer, category, currency, split_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            args: [groupId, date, description || '', Number(amount), validPayer, category || '', currencyCode, split_mode || 'equal']
        });

        const expenseId = result.lastInsertRowid;
        if (splits && Array.isArray(splits)) {
            for (const split of splits) {
                await db.execute({
                    sql: 'INSERT INTO group_splits (expense_id, user_id, amount) VALUES (?, ?, ?)',
                    args: [expenseId, split.user_id, Number(split.amount) || 0]
                });
            }
        } else {
            const memberCheck2 = await db.execute(
                'SELECT user_id FROM group_members WHERE group_id = ?', [groupId]
            );
            const members = memberCheck2.rows;
            const splitAmount = Number(amount) / members.length;
            for (const m of members) {
                await db.execute({
                    sql: 'INSERT INTO group_splits (expense_id, user_id, amount) VALUES (?, ?, ?)',
                    args: [expenseId, m.user_id, splitAmount]
                });
            }
        }

        console.log(`[GROUPS] Gasto creado en grupo ${groupId} por ${validPayer} (monto: ${amount})`);
        res.json({ id: Number(expenseId), message: 'Gasto creado con éxito' });
    } catch (err) {
        console.error('[GROUPS] Error creando gasto:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// ────────────────────────────────────────
// DELETE /:id/expenses/:expenseId — eliminar gasto
// ────────────────────────────────────────
router.delete('/:id/expenses/:expenseId', async (req, res) => {
    try {
        const groupId = req.params.id;
        const { userId } = req.user;

        const memberCheck = await db.execute(
            'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, userId]
        );
        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }

        await db.execute(
            'DELETE FROM group_expenses WHERE group_id = ? AND id = ?',
            [groupId, req.params.expenseId]
        );

        console.log(`[GROUPS] Gasto ${req.params.expenseId} eliminado del grupo ${groupId}`);
        res.json({ message: 'Gasto eliminado con éxito' });
    } catch (err) {
        console.error('[GROUPS] Error eliminando gasto:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// ────────────────────────────────────────
// GET /:id/balance — saldos del grupo
// ────────────────────────────────────────
router.get('/:id/balance', async (req, res) => {
    try {
        const groupId = req.params.id;
        const { userId } = req.user;

        const memberCheck = await db.execute(
            'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, userId]
        );
        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }

        const membersResult = await db.execute(
            'SELECT user_id, username FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE group_id = ? ORDER BY user_id',
            [groupId]
        );

        const expensesResult = await db.execute(`
            SELECT ge.id, ge.payer, ge.amount, ge.split_mode
            FROM group_expenses ge
            WHERE ge.group_id = ?
            ORDER BY ge.date
        `, [groupId]);

        const balances = {};
        const usernameToId = {};
        for (const m of membersResult.rows) {
            balances[m.user_id] = { user_id: m.user_id, username: m.username, balance: 0, total_paid: 0, total_spent: 0 };
            usernameToId[m.username] = m.user_id;
        }

        for (const expense of expensesResult.rows) {
            const splitsResult = await db.execute(
                'SELECT user_id, amount FROM group_splits WHERE expense_id = ?', [expense.id]
            );

            // Resolve payer username to user_id
            const payerId = usernameToId[expense.payer] || expense.payer;
            if (balances[payerId]) {
                balances[payerId].total_paid += Number(expense.amount);
            }

            for (const split of splitsResult.rows) {
                const splitUserId = usernameToId[split.user_id] || split.user_id;
                if (balances[splitUserId]) {
                    balances[splitUserId].total_spent += Number(split.amount);
                }
            }
        }

        for (const key of Object.keys(balances)) {
            balances[key].balance = balances[key].total_paid - balances[key].total_spent;
        }

        res.json({ members: membersResult.rows, balances: Object.values(balances) });
    } catch (err) {
        console.error('[GROUPS] Error calculando balances:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// ────────────────────────────────────────
// POST /:id/payments — registrar pago
// ────────────────────────────────────────
router.post('/:id/payments', async (req, res) => {
    try {
        const groupId = req.params.id;
        const { userId, username } = req.user;
        const { from_user, to_user, amount, currency, date, description } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
        }
        if (!from_user || !to_user) {
            return res.status(400).json({ error: 'from_user y to_user son requeridos' });
        }

        const memberCheck = await db.execute(
            'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, userId]
        );
        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }

        const currencyCode = currency || 'UYU';

        await db.execute({
            sql: 'INSERT INTO group_payments (group_id, from_user, to_user, amount, currency, date, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
            args: [groupId, from_user, to_user, Number(amount), currencyCode, date || new Date().toISOString().split('T')[0], description || '']
        });

        console.log(`[GROUPS] Pago registrado: ${from_user} -> ${to_user} (${amount}) en grupo ${groupId}`);
        res.json({ message: 'Pago registrado con éxito' });
    } catch (err) {
        console.error('[GROUPS] Error registrando pago:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

module.exports = router;
