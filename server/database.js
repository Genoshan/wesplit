const { createClient } = require('@libsql/client');
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initDB() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            description TEXT,
            amount REAL NOT NULL,
            payer TEXT NOT NULL,
            category TEXT
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS expense_splits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            expense_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            amount REAL NOT NULL,
            FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS recurring_expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            description TEXT NOT NULL,
            amount REAL NOT NULL,
            payer TEXT NOT NULL,
            category TEXT NOT NULL,
            frequency TEXT NOT NULL,
            next_due_date TEXT NOT NULL
        )
    `);

    // Migrar gastos existentes con 50/50 splits
    const existing = await db.execute('SELECT * FROM expenses');
    if (existing.rows.length > 0) {
        for (const row of existing.rows) {
            const half = row.amount / 2;
            await db.execute({
                sql: 'INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (?, ?, ?), (?, ?, ?)',
                args: [row.id, 'me', half, row.id, 'partner', half]
            });
        }
    }

    console.log('[DB] Tablas expenses, expense_splits y recurring_expenses inicializadas');
}

initDB().catch(err => {
    console.error('[DB] Error inicializando Turso:', err);
});

module.exports = db;
