const { createClient } = require('@libsql/client');
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initDB() {
    // ────────────────────────────────────────
    // Tablas de autenticación
    // ────────────────────────────────────────

    await db.execute(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')),
            payer TEXT NOT NULL DEFAULT 'me',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            ip TEXT DEFAULT '',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // ────────────────────────────────────────
    // Tablas de grupos
    // ────────────────────────────────────────

    await db.execute(`
        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            owner_id INTEGER NOT NULL,
            base_currency TEXT NOT NULL DEFAULT 'UYU',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS group_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')),
            joined_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            UNIQUE(group_id, user_id),
            FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // ────────────────────────────────────────
    // Tablas de gastos (por grupo)
    // ────────────────────────────────────────

    await db.execute(`
        CREATE TABLE IF NOT EXISTS group_expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            description TEXT,
            amount REAL NOT NULL,
            payer TEXT NOT NULL,
            category TEXT,
            currency TEXT NOT NULL DEFAULT 'UYU',
            split_mode TEXT NOT NULL DEFAULT 'equal',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS group_splits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            expense_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            amount REAL NOT NULL,
            FOREIGN KEY (expense_id) REFERENCES group_expenses(id) ON DELETE CASCADE
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS group_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            from_user TEXT NOT NULL,
            to_user TEXT NOT NULL,
            amount REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'UYU',
            date TEXT NOT NULL DEFAULT (date('now')),
            description TEXT,
            FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
        )
    `);

    // ────────────────────────────────────────
    // Tablas existentes (compatibilidad legacy)
    // ────────────────────────────────────────

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

    // ────────────────────────────────────────
    // Migraciones: columnas nuevas en users
    // ────────────────────────────────────────
    try {
        await db.execute('ALTER TABLE users ADD COLUMN name TEXT');
        console.log('[DB] Columna name agregada a users');
    } catch (e) {
        if (!e.message.toLowerCase().includes('duplicate') && !e.message.toLowerCase().includes('already exists')) {
            console.log('[DB] Columna name puede que ya exista');
        }
    }
    try {
        await db.execute('ALTER TABLE users ADD COLUMN global_role TEXT NOT NULL DEFAULT \'member\'');
        console.log('[DB] Columna global_role agregada a users');
    } catch (e) {
        if (!e.message.toLowerCase().includes('duplicate') && !e.message.toLowerCase().includes('already exists')) {
            console.log('[DB] Columna global_role puede que ya exista');
        }
    }

    // ────────────────────────────────────────
    // Seed: usuarios por defecto
    // ────────────────────────────────────────

    // Hash simple como placeholder para bcrypt
    function simpleHash(text) {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const ch = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + ch;
            hash = hash & hash;
        }
        return `simple:${Math.abs(hash).toString(16)}`;
    }

    const defaultUsers = [
        { username: 'tin', password_hash: simpleHash(process.env.AUTH_TIN || 'tin'), global_role: 'admin', name: 'Tin' },
        { username: 'noe', password_hash: simpleHash(process.env.AUTH_NOE || 'noe'), global_role: 'member', name: 'Noe' },
    ];

    for (const u of defaultUsers) {
        await db.execute({
            sql: 'INSERT OR IGNORE INTO users (username, password_hash, global_role, name) VALUES (?, ?, ?, ?)',
            args: [u.username, u.password_hash, u.global_role, u.name],
        });
        // Update name if user already exists
        await db.execute('UPDATE users SET name = ? WHERE username = ? AND (name IS NULL OR name = \'\')', [u.name, u.username]);
    }

    // Migración: vincular los emails de Google de los usuarios de prueba
    // para que sigan ingresando a sus cuentas existentes (y no creen otras nuevas)
    const legacyGoogleEmails = [
        { username: 'tin', email: 'argordster@gmail.com' },
        { username: 'noe', email: 'mnovoapacilio@gmail.com' },
    ];
    for (const item of legacyGoogleEmails) {
        await db.execute(
            'UPDATE users SET email = ? WHERE username = ? AND (email IS NULL OR email = \'\')',
            [item.email, item.username]
        );
    }

    // ────────────────────────────────────────
    // Seed: grupo por defecto "Casa"
    // ────────────────────────────────────────

    // Solo crear "Casa" si no existe ya un grupo con ese nombre para tin
    const existingCasa = await db.execute(`
        SELECT g.id FROM groups g
        JOIN users u ON g.owner_id = u.id
        WHERE g.name = 'Casa' AND u.username = 'tin'
        LIMIT 1
    `);
    if (existingCasa.rows.length === 0) {
        await db.execute(`
            INSERT INTO groups (name, owner_id, base_currency)
            SELECT 'Casa', id, 'UYU'
            FROM users
            WHERE username = 'tin'
            LIMIT 1
        `);
    }

    // Solo agregar miembros si no existen ya
    const casaGroup = await db.execute(`
        SELECT id FROM groups WHERE name = 'Casa' AND owner_id = (SELECT id FROM users WHERE username = 'tin') LIMIT 1
    `);
    if (casaGroup.rows.length > 0) {
        const casaId = casaGroup.rows[0].id;
        await db.execute({
            sql: 'INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, (SELECT id FROM users WHERE username = ?), ?)',
            args: [casaId, 'tin', 'admin']
        });
        await db.execute({
            sql: 'INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, (SELECT id FROM users WHERE username = ?), ?)',
            args: [casaId, 'noe', 'member']
        });
    }

    // ────────────────────────────────────────
    // Seed: monedas predeterminadas
    // ────────────────────────────────────────

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

    await db.execute('UPDATE currencies SET is_default = 0 WHERE code != ?', ['UYU']);
    await db.execute('UPDATE currencies SET is_default = 1 WHERE code = ?', ['UYU']);

    // Migrar datos de role -> global_role
    try {
        await db.execute('UPDATE users SET global_role = role WHERE global_role IS NULL OR global_role = \'member\'');
    } catch (e) {
        // Ignorar si la columna role ya no existe
    }

    // ────────────────────────────────────────
    // Migración: columna currency en expenses
    // ────────────────────────────────────────

    try {
        await db.execute('ALTER TABLE expenses ADD COLUMN currency TEXT NOT NULL DEFAULT \'UYU\'');
        console.log('[DB] Columna currency agregada a expenses');
    } catch (e) {
        if (!e.message.toLowerCase().includes('duplicate') && !e.message.toLowerCase().includes('already exists')) {
            console.log('[DB] Columna currency puede que ya exista');
        }
    }

    // ────────────────────────────────────────
    // Migración: splits para gastos existentes
    // ────────────────────────────────────────

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

    console.log('[DB] Tablas inicializadas: users, sessions, groups, group_members, group_expenses, group_splits, group_payments, expenses, expense_splits, recurring_expenses, currencies');
}

initDB().catch(err => {
    console.error('[DB] Error inicializando Turso:', err);
});

module.exports = db;
