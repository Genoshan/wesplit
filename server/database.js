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
    console.log('[DB] Tabla expenses inicializada en Turso');
}

initDB().catch(err => {
    console.error('[DB] Error inicializando Turso:', err);
});

module.exports = db;
