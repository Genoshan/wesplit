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
            category TEXT,
            currency TEXT NOT NULL DEFAULT 'UYU'
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
    await db.execute(`
        CREATE TABLE IF NOT EXISTS currencies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            rate REAL NOT NULL,
            symbol TEXT NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0
        )
    `);

    // Insertar monedas predeterminadas si no existen
    const defaultCurrencies = [
        { code: 'UYU', name: 'Peso uruguayo', rate: 1, symbol: '$', is_default: 1 },
        { code: 'USD', name: 'Dólar estadounidense', rate: 0.0245, symbol: 'US$' },
        { code: 'BRL', name: 'Real brasileño', rate: 0.135, symbol: 'R$' },
        { code: 'EUR', name: 'Euro', rate: 0.0225, symbol: '€' },
        { code: 'ARS', name: 'Peso argentino', rate: 21.5, symbol: 'AR$' },
        { code: 'CLP', name: 'Peso chileno', rate: 22.8, symbol: 'CL$' },
        { code: 'MXN', name: 'Peso mexicano', rate: 0.48, symbol: 'MX$' },
        { code: 'COP', name: 'Peso colombiano', rate: 101.5, symbol: 'CO$' },
        { code: 'PEN', name: 'Sol peruano', rate: 0.093, symbol: 'S/' },
    ];

    for (const cur of defaultCurrencies) {
        const isDef = cur.is_default ? 1 : 0;
        await db.execute({
            sql: 'INSERT OR IGNORE INTO currencies (code, name, rate, symbol, is_default) VALUES (?, ?, ?, ?, ?)',
            args: [cur.code, cur.name, cur.rate, cur.symbol, isDef]
        });
    }

    // Asegurar que siempre haya una moneda default
    await db.execute('UPDATE currencies SET is_default = 0 WHERE code != ?', ['UYU']);
    await db.execute('UPDATE currencies SET is_default = 1 WHERE code = ?', ['UYU']);
    const check = await db.execute('SELECT code, is_default FROM currencies WHERE code = ?', ['UYU']);
    console.log('[DB] UYU is_default:', check.rows[0].is_default);

    // Migrar: agregar columna currency si no existe
    try {
        await db.execute('ALTER TABLE expenses ADD COLUMN currency TEXT NOT NULL DEFAULT \'UYU\'');
        console.log('[DB] Columna currency agregada a expenses');
    } catch (e) {
        if (!e.message.toLowerCase().includes('duplicate')) {
            console.log('[DB] Columna currency puede que ya exista:', e.message.substring(0, 60));
        }
    }

    // Migrar splits para gastos existentes que no tengan splits
    const existing = await db.execute('SELECT id, amount FROM expenses');
    for (const row of existing.rows) {
        const splitsCheck = await db.execute('SELECT COUNT(*) as count FROM expense_splits WHERE expense_id = ?', [row.id]);
        if (splitsCheck.rows[0].count === 0) {
            const half = row.amount / 2;
            await db.execute({
                sql: 'INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (?, ?, ?), (?, ?, ?)',
                args: [row.id, 'me', half, row.id, 'partner', half]
            });
        }
    }
    console.log('[DB] Migración de splits completada');

    console.log('[DB] Tablas inicializadas: expenses, expense_splits, recurring_expenses, currencies');
}

initDB().catch(err => {
    console.error('[DB] Error inicializando Turso:', err);
});

module.exports = db;
