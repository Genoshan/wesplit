const express = require('express');
const router = express.Router();
const db = require('./database');
const { authMiddleware } = require('./auth');

// Todas las rutas requieren autenticación
router.use(authMiddleware);

// ────────────────────────────────────────
// Helpers de miembros / pagador / splits
// ────────────────────────────────────────

// Un código de moneda es exactamente 3 letras. Sin esto, un valor arbitrario
// llega a Intl.NumberFormat en el front, que lanza y devuelve el código crudo
// dentro de un innerHTML (vector de XSS).
function normalizeCurrency(value) {
    const code = String(value || 'UYU').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(code) ? code : null;
}

async function getGroupMembers(groupId, statuses = ['active']) {
    const placeholders = statuses.map(() => '?').join(', ');
    const result = await db.execute(`
        SELECT gm.user_id, gm.role, gm.status, u.username, u.name
        FROM group_members gm
        JOIN users u ON gm.user_id = u.id
        WHERE gm.group_id = ? AND gm.status IN (${placeholders})
        ORDER BY gm.user_id
    `, [groupId, ...statuses]);
    return result.rows;
}

// Acepta el id entero del miembro o su username (compatibilidad con datos viejos)
function resolveMemberId(value, members) {
    if (value === undefined || value === null || value === '') return null;
    const byId = members.find(m => String(m.user_id) === String(value));
    if (byId) return Number(byId.user_id);
    const byName = members.find(m => m.username === value);
    return byName ? Number(byName.user_id) : null;
}

// 'me' -> usuario actual; 'partner' -> el otro miembro real del grupo;
// cualquier otro valor debe ser un miembro del grupo.
function resolvePayerUsername(value, members, currentUsername) {
    if (value === 'me' || value === undefined || value === null || value === '') return currentUsername;
    if (value === 'partner') {
        const other = members.find(m => m.username !== currentUsername);
        return other ? other.username : null;
    }
    const match = members.find(m => m.username === value || String(m.user_id) === String(value));
    return match ? match.username : null;
}

// Parte equitativa en centavos: el resto se reparte para que la suma sea exacta.
function evenSplits(totalAmount, members) {
    const cents = Math.round(Number(totalAmount) * 100);
    const base = Math.floor(cents / members.length);
    let remainder = cents - base * members.length;
    return members.map(m => ({
        user_id: Number(m.user_id),
        amount: (base + (remainder-- > 0 ? 1 : 0)) / 100
    }));
}

// ────────────────────────────────────────
// Invitaciones pendientes del usuario actual
// Se registran antes de /:id para que Express no las trate como un ID.
// ────────────────────────────────────────
router.get('/invitations', async (req, res) => {
    try {
        const result = await db.execute(`
            SELECT gm.id, gm.group_id, gm.role, g.name AS group_name, u.username AS owner_username
            FROM group_members gm
            JOIN groups g ON g.id = gm.group_id
            JOIN users u ON u.id = g.owner_id
            WHERE gm.user_id = ? AND gm.status = 'pending'
            ORDER BY g.name
        `, [req.user.userId]);
        res.json(result.rows);
    } catch (err) {
        console.error('[GROUPS] Error listando invitaciones:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// POST /invitations/:id/accept — aceptar invitación
router.post('/invitations/:id/accept', async (req, res) => {
    try {
        const result = await db.execute(
            "UPDATE group_members SET status = 'active', joined_at = strftime('%s', 'now') WHERE id = ? AND user_id = ? AND status = 'pending'",
            [req.params.id, req.user.userId]
        );
        if (!result.rowsAffected) {
            return res.status(404).json({ error: 'Invitación no encontrada' });
        }
        res.json({ message: 'Invitación aceptada' });
    } catch (err) {
        console.error('[GROUPS] Error aceptando invitación:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// DELETE /invitations/:id — rechazar invitación (el invitado)
router.delete('/invitations/:id', async (req, res) => {
    try {
        const result = await db.execute(
            "DELETE FROM group_members WHERE id = ? AND user_id = ? AND status = 'pending'",
            [req.params.id, req.user.userId]
        );
        if (!result.rowsAffected) {
            return res.status(404).json({ error: 'Invitación no encontrada' });
        }
        res.json({ message: 'Invitación rechazada' });
    } catch (err) {
        console.error('[GROUPS] Error rechazando invitación:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

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
            WHERE gm.user_id = ? AND gm.status = 'active'
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
    const currency = normalizeCurrency(base_currency);

    if (!currency) {
        return res.status(400).json({ error: 'Código de moneda inválido (3 letras)' });
    }
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
            SELECT role, status FROM group_members WHERE group_id = ? AND user_id = ?
        `, [groupId, userId]);

        if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
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
            SELECT gm.user_id, gm.role as member_role, gm.status, u.username, u.name
            FROM group_members gm
            JOIN users u ON gm.user_id = u.id
            WHERE gm.group_id = ?
            ORDER BY CASE gm.status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, gm.role ASC, u.username ASC
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
            SELECT role, status FROM group_members WHERE group_id = ? AND user_id = ?
        `, [groupId, userId]);

        if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }
        if (memberCheck.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Solo el owner puede editar el grupo' });
        }

        const currency = normalizeCurrency(base_currency);
        if (!currency) {
            return res.status(400).json({ error: 'Código de moneda inválido (3 letras)' });
        }
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
            SELECT role, status FROM group_members WHERE group_id = ? AND user_id = ?
        `, [groupId, userId]);

        if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
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
    const cleanRole = req.body.role || 'member';
    const cleanUsername = String(req.body.username || '').trim().toLowerCase();

    if (!cleanUsername || !['admin', 'member'].includes(cleanRole)) {
        return res.status(400).json({ error: 'Se requiere username y role válido (admin/member)' });
    }

    try {
        const { userId } = req.user;
        const groupId = req.params.id;

        const memberCheck = await db.execute(`
            SELECT role, status FROM group_members WHERE group_id = ? AND user_id = ?
        `, [groupId, userId]);

        if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }
        if (memberCheck.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Solo los admins pueden agregar miembros' });
        }

        const userResult = await db.execute('SELECT * FROM users WHERE LOWER(username) = ?', [cleanUsername]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const targetUserId = userResult.rows[0].id;
        if (Number(targetUserId) === Number(userId)) {
            return res.status(400).json({ error: 'No puedes agregarte a ti mismo' });
        }

        const invitedUsername = userResult.rows[0].username;
        const existing = await db.execute(
            'SELECT status FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, targetUserId]
        );
        if (existing.rows.length > 0 && existing.rows[0].status === 'active') {
            return res.status(400).json({ error: 'Ese usuario ya es miembro del grupo' });
        }
        if (existing.rows.length > 0 && existing.rows[0].status === 'pending') {
            return res.status(400).json({ error: 'La invitación ya está pendiente' });
        }
        let message;
        if (existing.rows.length > 0) {
            await db.execute(
                "UPDATE group_members SET status = 'active', role = ?, joined_at = strftime('%s', 'now') WHERE group_id = ? AND user_id = ?",
                [cleanRole, groupId, targetUserId]
            );
            message = 'Miembro reactivado con éxito';
        } else {
            await db.execute({
                sql: "INSERT INTO group_members (group_id, user_id, role, status) VALUES (?, ?, ?, 'pending')",
                args: [groupId, targetUserId, cleanRole]
            });
            message = 'Invitación enviada: espera a que el usuario la acepte';
        }
        console.log(`[GROUPS] ${message} :: ${invitedUsername} -> grupo ${groupId}`);
        res.json({ message, username: invitedUsername, role: cleanRole, status: existing.rows.length > 0 ? 'active' : 'pending' });
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
            SELECT role, status FROM group_members WHERE group_id = ? AND user_id = ?
        `, [groupId, userId]);

        if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }
        if (memberCheck.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Solo los admins pueden remover miembros' });
        }

        // req.params es string, req.user.userId es number: con === el guard
        // daba siempre false y un admin podía removerse a sí mismo.
        if (Number(targetUserId) === Number(userId)) {
            return res.status(400).json({ error: 'Para salir, elimina el grupo completo' });
        }

        const target = await db.execute(
            'SELECT id, role, status FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, targetUserId]
        );
        if (target.rows.length === 0) {
            return res.status(404).json({ error: 'Ese usuario no pertenece al grupo' });
        }
        if (target.rows[0].status === 'pending') {
            await db.execute('DELETE FROM group_members WHERE id = ?', [target.rows[0].id]);
            return res.json({ message: 'Invitación cancelada' });
        }
        if (target.rows[0].role === 'admin') {
            const admins = await db.execute(
                "SELECT COUNT(*) AS count FROM group_members WHERE group_id = ? AND role = 'admin' AND status = 'active'",
                [groupId]
            );
            if (Number(admins.rows[0].count) <= 1) {
                return res.status(400).json({ error: 'El grupo debe tener al menos un administrador' });
            }
        }

        if (target.rows[0].status === 'inactive') {
            return res.status(400).json({ error: 'El miembro ya está inactivo' });
        }
        await db.execute(
            "UPDATE group_members SET status = 'inactive' WHERE group_id = ? AND user_id = ?",
            [groupId, targetUserId]
        );

        console.log(`[GROUPS] Miembro (ID: ${targetUserId}) marcado inactivo en grupo ${groupId}`);
        res.json({ message: 'Miembro marcado como inactivo; su historial se conserva' });
    } catch (err) {
        console.error('[GROUPS] Error removiendo miembro:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// ────────────────────────────────────────
// POST /:id/members/:userId/reactivate — volver a activar
// ────────────────────────────────────────
router.post('/:id/members/:userId/reactivate', async (req, res) => {
    try {
        const { userId } = req.user;
        const groupId = req.params.id;
        const memberCheck = await db.execute(
            'SELECT role, status FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, userId]
        );
        if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }
        if (memberCheck.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Solo los admins pueden reactivar miembros' });
        }
        const result = await db.execute(
            "UPDATE group_members SET status = 'active' WHERE group_id = ? AND user_id = ? AND status = 'inactive'",
            [groupId, req.params.userId]
        );
        if (!result.rowsAffected) {
            return res.status(404).json({ error: 'Miembro inactivo no encontrado' });
        }
        res.json({ message: 'Miembro reactivado' });
    } catch (err) {
        console.error('[GROUPS] Error reactivando miembro:', err);
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
            'SELECT role, status FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, userId]
        );
        if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
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
                LEFT JOIN users u3 ON (gs.user_id = CAST(u3.id AS TEXT) OR gs.user_id = u3.username)
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
        const { date, description, amount, payer, category, split_mode, splits } = req.body;

        const parsedAmount = Number(amount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: 'El monto debe ser un número mayor a 0' });
        }
        if (!date) {
            return res.status(400).json({ error: 'La fecha es requerida' });
        }

        const memberCheck = await db.execute(
            'SELECT role, status FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, userId]
        );
        if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }

        const members = await getGroupMembers(groupId);
        if (members.length === 0) {
            return res.status(400).json({ error: 'El grupo no tiene miembros' });
        }

        const groupInfo = await db.execute(
            'SELECT base_currency FROM groups WHERE id = ?', [groupId]
        );
        // Moneda única por grupo: se ignora cualquier moneda enviada por el front.
        const currencyCode = groupInfo.rows[0]?.base_currency || 'UYU';

        const payerUsername = resolvePayerUsername(payer, members, username);
        if (!payerUsername) {
            return res.status(400).json({ error: 'El pagador debe ser un miembro del grupo' });
        }

        const mode = split_mode || 'equal';
        if (!['equal', 'solo', 'custom'].includes(mode)) {
            return res.status(400).json({ error: 'Modo de división inválido' });
        }

        // Los splits equitativos y "solo yo" se calculan en servidor: el front
        // no puede inventar miembros ni dejar la mitad del gasto sin asignar.
        let splitRows;
        if (mode === 'equal') {
            splitRows = evenSplits(parsedAmount, members);
        } else if (mode === 'solo') {
            splitRows = [{ user_id: resolveMemberId(payerUsername, members), amount: parsedAmount }];
        } else {
            if (!Array.isArray(splits) || splits.length === 0) {
                return res.status(400).json({ error: 'Faltan splits para modo personalizado' });
            }
            splitRows = splits.map(s => ({
                user_id: resolveMemberId(s.user_id, members),
                amount: Number(s.amount)
            }));
            if (splitRows.some(s => s.user_id === null || !Number.isFinite(s.amount) || s.amount < 0)) {
                return res.status(400).json({ error: 'Splits inválidos: usá miembros del grupo y montos válidos' });
            }
            const totalCents = Math.round(parsedAmount * 100);
            const splitCents = splitRows.reduce((sum, s) => sum + Math.round(s.amount * 100), 0);
            if (Math.abs(splitCents - totalCents) > 1) {
                return res.status(400).json({ error: 'La suma de los splits no coincide con el monto' });
            }
        }

        const result = await db.execute({
            sql: 'INSERT INTO group_expenses (group_id, date, description, amount, payer, category, currency, split_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            args: [groupId, date, description || '', parsedAmount, payerUsername, category || '', currencyCode, mode]
        });

        const expenseId = result.lastInsertRowid;
        for (const split of splitRows) {
            await db.execute({
                sql: 'INSERT INTO group_splits (expense_id, user_id, amount) VALUES (?, ?, ?)',
                args: [expenseId, String(split.user_id), split.amount]
            });
        }

        console.log(`[GROUPS] Gasto creado en grupo ${groupId} por ${payerUsername} (monto: ${amount}, ${splitRows.length} splits)`);
        res.json({ id: Number(expenseId), message: 'Gasto creado con éxito' });
    } catch (err) {
        console.error('[GROUPS] Error creando gasto:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// ────────────────────────────────────────
// PUT /:id/expenses/:expenseId — editar gasto
// ────────────────────────────────────────
router.put('/:id/expenses/:expenseId', async (req, res) => {
    try {
        const groupId = req.params.id;
        const expenseId = req.params.expenseId;
        const { userId, username } = req.user;
        const { date, description, amount, payer, category, split_mode, splits } = req.body;

        const memberCheck = await db.execute(
            'SELECT role, status FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, userId]
        );
        if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }

        const existing = await db.execute(
            'SELECT id FROM group_expenses WHERE group_id = ? AND id = ?',
            [groupId, expenseId]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Gasto no encontrado en este grupo' });
        }

        const parsedAmount = Number(amount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: 'El monto debe ser un número mayor a 0' });
        }
        if (!date) {
            return res.status(400).json({ error: 'La fecha es requerida' });
        }

        // Se incluyen inactivos para no perder las partes históricas al editar.
        const members = await getGroupMembers(groupId, ['active', 'inactive']);
        if (members.length === 0) {
            return res.status(400).json({ error: 'El grupo no tiene miembros' });
        }

        const payerUsername = resolvePayerUsername(payer, members, username);
        if (!payerUsername) {
            return res.status(400).json({ error: 'El pagador debe ser un miembro del grupo' });
        }

        const mode = split_mode || 'equal';
        if (!['equal', 'solo', 'custom'].includes(mode)) {
            return res.status(400).json({ error: 'Modo de división inválido' });
        }

        let splitRows;
        if (mode === 'equal') {
            splitRows = evenSplits(parsedAmount, members);
        } else if (mode === 'solo') {
            splitRows = [{ user_id: resolveMemberId(payerUsername, members), amount: parsedAmount }];
        } else {
            if (!Array.isArray(splits) || splits.length === 0) {
                return res.status(400).json({ error: 'Faltan splits para modo personalizado' });
            }
            splitRows = splits.map(s => ({
                user_id: resolveMemberId(s.user_id, members),
                amount: Number(s.amount)
            }));
            if (splitRows.some(s => s.user_id === null || !Number.isFinite(s.amount) || s.amount < 0)) {
                return res.status(400).json({ error: 'Splits inválidos: usá miembros del grupo y montos válidos' });
            }
            const totalCents = Math.round(parsedAmount * 100);
            const splitCents = splitRows.reduce((sum, s) => sum + Math.round(s.amount * 100), 0);
            if (Math.abs(splitCents - totalCents) > 1) {
                return res.status(400).json({ error: 'La suma de los splits no coincide con el monto' });
            }
        }

        const groupInfo = await db.execute(
            'SELECT base_currency FROM groups WHERE id = ?', [groupId]
        );
        const currencyCode = groupInfo.rows[0]?.base_currency || 'UYU';

        await db.execute(
            'UPDATE group_expenses SET date = ?, description = ?, amount = ?, payer = ?, category = ?, currency = ?, split_mode = ? WHERE group_id = ? AND id = ?',
            [date, description || '', parsedAmount, payerUsername, category || '', currencyCode, mode, groupId, expenseId]
        );
        await db.execute(
            'DELETE FROM group_splits WHERE expense_id = ?', [expenseId]
        );
        for (const split of splitRows) {
            await db.execute({
                sql: 'INSERT INTO group_splits (expense_id, user_id, amount) VALUES (?, ?, ?)',
                args: [expenseId, String(split.user_id), split.amount]
            });
        }

        console.log(`[GROUPS] Gasto ${expenseId} actualizado en grupo ${groupId}`);
        res.json({ id: Number(expenseId), message: 'Gasto actualizado con éxito' });
    } catch (err) {
        console.error('[GROUPS] Error editando gasto:', err);
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
            'SELECT role, status FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, userId]
        );
        if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }

        // Borrado físico con limpieza explícita: SQLite no aplica ON DELETE
        // CASCADE sin PRAGMA foreign_keys = ON, así que no confiamos en él.
        await db.execute(
            'DELETE FROM group_splits WHERE expense_id IN (SELECT id FROM group_expenses WHERE group_id = ? AND id = ?)',
            [groupId, req.params.expenseId]
        );
        const deleted = await db.execute(
            'DELETE FROM group_expenses WHERE group_id = ? AND id = ?',
            [groupId, req.params.expenseId]
        );
        if (!deleted.rowsAffected) {
            return res.status(404).json({ error: 'Gasto no encontrado en este grupo' });
        }

        console.log(`[GROUPS] Gasto ${req.params.expenseId} eliminado del grupo ${groupId} (splits limpiados)`);
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
            'SELECT role, status FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, userId]
        );
        if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }

        const membersResult = await db.execute(
            "SELECT gm.user_id, u.username FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ? AND gm.status IN ('active', 'inactive') ORDER BY gm.user_id",
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
            balances[m.user_id] = { user_id: m.user_id, username: m.username, balance: 0, total_paid: 0, total_spent: 0, payments_net: 0 };
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

        // Los pagos ajustan el saldo: quien paga reduce su deuda (o aumenta su
        // crédito) y quien recibe hace el camino inverso. Se guardan aparte para
        // no mezclarlos con lo pagado/gastado en gastos.
        const paymentsResult = await db.execute(
            'SELECT from_user, to_user, amount FROM group_payments WHERE group_id = ?', [groupId]
        );
        for (const payment of paymentsResult.rows) {
            const fromId = usernameToId[payment.from_user] || payment.from_user;
            const toId = usernameToId[payment.to_user] || payment.to_user;
            const value = Number(payment.amount) || 0;
            if (balances[fromId]) balances[fromId].payments_net += value;
            if (balances[toId]) balances[toId].payments_net -= value;
        }

        for (const key of Object.keys(balances)) {
            const b = balances[key];
            b.balance = b.total_paid - b.total_spent + b.payments_net;
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

        const parsedAmount = Number(amount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: 'El monto debe ser un número mayor a 0' });
        }
        if (!from_user || !to_user) {
            return res.status(400).json({ error: 'from_user y to_user son requeridos' });
        }
        if (String(from_user) === String(to_user)) {
            return res.status(400).json({ error: 'No podés pagarte a vos mismo' });
        }
        const cleanDate = String(date || new Date().toISOString().split('T')[0]);
        const parsedDate = new Date(`${cleanDate}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate) ||
            Number.isNaN(parsedDate.getTime()) ||
            parsedDate.toISOString().split('T')[0] !== cleanDate) {
            return res.status(400).json({ error: 'Fecha inválida' });
        }

        const memberCheck = await db.execute(
            'SELECT role, status FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, userId]
        );
        if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }

        // Los participantes deben ser miembros reales; antes se insertaban
        // usernames arbitrarios en group_payments.
        const members = await getGroupMembers(groupId);
        const fromName = resolvePayerUsername(from_user, members, username);
        const toName = resolvePayerUsername(to_user, members, username);
        if (!fromName || !toName) {
            return res.status(400).json({ error: 'Los participantes deben ser miembros del grupo' });
        }

        const currencyCode = normalizeCurrency(currency);
        if (!currencyCode) {
            return res.status(400).json({ error: 'Moneda inválida' });
        }

        const result = await db.execute({
            sql: 'INSERT INTO group_payments (group_id, from_user, to_user, amount, currency, date, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
            args: [groupId, fromName, toName, parsedAmount, currencyCode, cleanDate, String(description || '').trim()]
        });

        const insertedId = result.lastInsertRowid;
        console.log(`[GROUPS] Pago registrado: ${fromName} -> ${toName} (${parsedAmount}) en grupo ${groupId}`);
        res.json({ id: Number(insertedId), message: 'Pago registrado con éxito' });
    } catch (err) {
        console.error('[GROUPS] Error registrando pago:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// ────────────────────────────────────────
// GET /:id/payments — historial de pagos del grupo
// ────────────────────────────────────────
router.get('/:id/payments', async (req, res) => {
    try {
        const groupId = req.params.id;
        const memberCheck = await db.execute(
            'SELECT status FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, req.user.userId]
        );
        if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }

        const result = await db.execute(
            'SELECT id, from_user, to_user, amount, currency, date, description FROM group_payments WHERE group_id = ? ORDER BY date DESC, id DESC',
            [groupId]
        );
        const members = await getGroupMembers(groupId, ['active', 'inactive']);
        const nameOf = username => members.find(m => m.username === username)?.name || username;
        res.json(result.rows.map(p => ({
            ...p,
            from_name: nameOf(p.from_user),
            to_name: nameOf(p.to_user)
        })));
    } catch (err) {
        console.error('[GROUPS] Error listando pagos:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// ────────────────────────────────────────
// DELETE /:id/payments/:paymentId
// ────────────────────────────────────────
router.delete('/:id/payments/:paymentId', async (req, res) => {
    try {
        const groupId = req.params.id;
        const memberCheck = await db.execute(
            'SELECT status FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, req.user.userId]
        );
        if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }

        const result = await db.execute(
            'DELETE FROM group_payments WHERE id = ? AND group_id = ?',
            [req.params.paymentId, groupId]
        );
        // libsql usa rowsAffected (no changes).
        if (!result.rowsAffected) {
            return res.status(404).json({ error: 'Pago no encontrado' });
        }
        res.json({ message: 'Pago eliminado con éxito' });
    } catch (err) {
        console.error('[GROUPS] Error eliminando pago:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// ────────────────────────────────────────
// GET /:id/export/csv — gastos y pagos del grupo
// ────────────────────────────────────────
router.get('/:id/export/csv', async (req, res) => {
    try {
        const groupId = req.params.id;
        const memberCheck = await db.execute(
            'SELECT status FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, req.user.userId]
        );
        if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
            return res.status(403).json({ error: 'No perteneces a este grupo' });
        }

        const groupResult = await db.execute('SELECT name, base_currency FROM groups WHERE id = ?', [groupId]);
        const group = groupResult.rows[0] || {};
        const currency = normalizeCurrency(group.base_currency) || 'UYU';
        const members = await getGroupMembers(groupId, ['active', 'inactive']);
        const nameOf = username => members.find(m => m.username === username)?.name || username;
        const esc = value => `"${String(value ?? '').replace(/"/g, '""')}"`;

        const expensesResult = await db.execute(
            'SELECT date, description, amount, category, payer FROM group_expenses WHERE group_id = ? ORDER BY date DESC, id DESC',
            [groupId]
        );
        const splitsResult = await db.execute(`
            SELECT s.expense_id, s.user_id, s.amount
            FROM group_splits s
            JOIN group_expenses e ON e.id = s.expense_id
            WHERE e.group_id = ?
        `, [groupId]);
        const paymentsResult = await db.execute(
            'SELECT date, description, amount, from_user, to_user FROM group_payments WHERE group_id = ? ORDER BY date DESC, id DESC',
            [groupId]
        );

        const expenseRows = expensesResult.rows.map(e => {
            const parts = splitsResult.rows
                .filter(s => String(s.expense_id) === String(e.id))
                .map(s => `${nameOf(s.user_id)}: ${Number(s.amount).toFixed(2)}`)
                .join(' | ');
            return [e.date, esc(e.description), esc(e.category || 'Otros'), Number(e.amount).toFixed(2),
                esc(nameOf(e.payer)), esc(parts)].join(',');
        });
        const paymentRows = paymentsResult.rows.map(p => [
            p.date, esc(p.description), Number(p.amount).toFixed(2),
            esc(nameOf(p.from_user)), esc(nameOf(p.to_user))
        ].join(','));

        const header = `Grupo,${esc(group.name || '')},Moneda,${currency}`;
        const expenseHeader = 'Fecha,Descripción,Categoría,Monto,Pagador,Reparto';
        const paymentHeader = 'Fecha,Descripción,Monto,De,Para';
        const csv = [header, '', expenseHeader, ...expenseRows, '', paymentHeader, ...paymentRows].join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="wesplit-${groupId}.csv"`);
        res.send(csv);
    } catch (err) {
        console.error('[GROUPS] Error exportando CSV:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

module.exports = router;
