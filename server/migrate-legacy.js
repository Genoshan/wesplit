const db = require('./database');

async function migrate() {
    console.log('[MIGRATE] Iniciando migracion de datos legacy...');

    const casaResult = await db.execute("SELECT id FROM groups WHERE name = 'Casa' LIMIT 1");
    if (casaResult.rows.length === 0) {
        console.error('[MIGRATE] No se encontro grupo Casa. Abortando.');
        process.exit(1);
    }
    const groupId = casaResult.rows[0].id;
    console.log('[MIGRATE] Grupo Casa ID: ' + groupId);

    // Limpiar datos migrados previamente
    await db.execute('DELETE FROM group_splits WHERE expense_id IN (SELECT id FROM group_expenses WHERE group_id = ?)', [groupId]);
    await db.execute('DELETE FROM group_expenses WHERE group_id = ?', [groupId]);
    console.log('[MIGRATE] Datos migrados previamente eliminados');

    function resolvePayer(payer) {
        if (payer === 'me') return 'tin';
        if (payer === 'partner') return 'noe';
        return payer;
    }

    function resolveUserId(userId) {
        if (userId === 'me') return 'tin';
        if (userId === 'partner') return 'noe';
        return userId;
    }

    const legacyExpenses = await db.execute('SELECT * FROM expenses ORDER BY id');
    console.log('[MIGRATE] ' + legacyExpenses.rows.length + ' gastos legacy encontrados');

    let migrated = 0;
    for (const exp of legacyExpenses.rows) {
        const payer = resolvePayer(exp.payer);
        const currency = exp.currency || 'UYU';

        const result = await db.execute({
            sql: 'INSERT INTO group_expenses (group_id, date, description, amount, payer, category, currency, split_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            args: [groupId, exp.date, exp.description || '', Number(exp.amount), payer, exp.category || '', currency, 'equal']
        });

        const newExpenseId = result.lastInsertRowid;

        // Obtener splits unicos (deduplicar por user_id)
        const legacySplits = await db.execute(
            'SELECT * FROM expense_splits WHERE expense_id = ?', [exp.id]
        );

        // Deduplicar: solo un split por user_id
        const seen = new Set();
        const uniqueSplits = [];
        for (const split of legacySplits.rows) {
            if (!seen.has(split.user_id)) {
                seen.add(split.user_id);
                uniqueSplits.push(split);
            }
        }

        for (const split of uniqueSplits) {
            const userId = resolveUserId(split.user_id);
            await db.execute({
                sql: 'INSERT INTO group_splits (expense_id, user_id, amount) VALUES (?, ?, ?)',
                args: [Number(newExpenseId), userId, Number(split.amount)]
            });
        }

        migrated++;
        console.log('[MIGRATE] Gasto ' + exp.id + ' -> ' + newExpenseId + ' (splits unicos: ' + uniqueSplits.length + ')');
    }

    console.log('[MIGRATE] Migracion completa: ' + migrated + ' gastos migrados');

    const count = await db.execute('SELECT COUNT(*) as c FROM group_expenses WHERE group_id = ?', [groupId]);
    console.log('[MIGRATE] group_expenses para Casa: ' + count.rows[0].c);
    const sc = await db.execute('SELECT COUNT(*) as c FROM group_splits');
    console.log('[MIGRATE] group_splits total: ' + sc.rows[0].c);

    process.exit(0);
}

migrate().catch(function(err) {
    console.error('[MIGRATE] Error:', err);
    process.exit(1);
});