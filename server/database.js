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
    console.log('[DB] Tablas expenses y recurring_expenses inicializadas en Turso');
}

initDB().catch(err => {
    console.error('[DB] Error inicializando Turso:', err);
});

module.exports = db;
