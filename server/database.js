const crypto = require('crypto');
const { createClient } = require('@libsql/client');
const { hashPassword } = require('./password');
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

async function hasMigration(name) {
    const result = await db.execute('SELECT name FROM migrations WHERE name = ?', [name]);
    return result.rows.length > 0;
}

async function markMigration(name) {
    await db.execute('INSERT OR IGNORE INTO migrations (name, applied_at) VALUES (?, ?)', [
        name, new Date().toISOString()
    ]);
}

// Promueve a superadmin al usuario indicado por SUPERADMIN_USERNAME.
// El valor de la ENV nunca se imprime ni se devuelve al front-end.
async function bootstrapSuperadmin(targetUsername) {
    const envName = (process.env.SUPERADMIN_USERNAME || '').trim().toLowerCase();
    const candidate = String(targetUsername || '').trim().toLowerCase();
    if (!envName || !candidate || candidate !== envName) return false;

    const found = await db.execute('SELECT id FROM users WHERE LOWER(username) = ? LIMIT 1', [envName]);
    if (found.rows.length === 0) return false;

    await db.execute(
        'INSERT OR IGNORE INTO superadmins (user_id, created_by) VALUES (?, ?)',
        [Number(found.rows[0].id), 'env-bootstrap']
    );
    console.log('[DB] Bootstrap de superadmin aplicado');
    return true;
}

async function initDB() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
    `);

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

    // Superadmins: rol global separado de `users.role` (admin de grupo).
    // Tabla propia para no reconstruir users con CHECK y romper FKs.
    await db.execute(`
        CREATE TABLE IF NOT EXISTS superadmins (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            created_by TEXT NOT NULL DEFAULT 'env-bootstrap'
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
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'pending', 'inactive')),
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

    // ────────────────────────────────────────
    // Migración: estado de miembros (activo / invitación pendiente / inactivo)
    // ────────────────────────────────────────
    try {
        await db.execute("ALTER TABLE group_members ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
        console.log('[DB] Columna status agregada a group_members');
    } catch (e) {
        if (!/duplicate|already exists/i.test(e.message)) {
            console.log('[DB] Columna status puede que ya exista');
        }
    }

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
    // Origen del alta. No se adivina en cuentas viejas: quedan 'unknown'.
    try {
        await db.execute('ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT \'unknown\'');
        console.log('[DB] Columna auth_provider agregada a users');
    } catch (e) {
        if (!e.message.toLowerCase().includes('duplicate') && !e.message.toLowerCase().includes('already exists')) {
            console.log('[DB] Columna auth_provider puede que ya exista');
        }
    }

    // ────────────────────────────────────────
    // Seed: usuarios por defecto
    // ────────────────────────────────────────

    // El seed legacy (tin/noe) se ejecuta UNA SOLA VEZ. Antes se
    // reejecutaba en cada reinicio, restaurando grupos borrados, emails
    // personales y roles que el usuario había cambiado.
    const runLegacySeed = !(await hasMigration('legacy-seed-v1'));

    // Nunca usar passwords conocidos como "tin"/"noe". En producción la
    // falta de credenciales debe abortar el arranque; en desarrollo se
    // genera uno aleatorio para que el servidor siga levantando.
    const isProduction = process.env.NODE_ENV === 'production';
    const tinPassword = process.env.AUTH_TIN || (isProduction ? null : crypto.randomBytes(24).toString('hex'));
    const noePassword = process.env.AUTH_NOE || (isProduction ? null : crypto.randomBytes(24).toString('hex'));
    if (!tinPassword || !noePassword) {
        throw new Error('[DB] Faltan AUTH_TIN/AUTH_NOE: abortando arranque en producción');
    }

    const defaultUsers = [
        { username: 'tin', password_hash: await hashPassword(tinPassword), global_role: 'admin', name: 'Tin' },
        { username: 'noe', password_hash: await hashPassword(noePassword), global_role: 'member', name: 'Noe' },
    ];

    if (runLegacySeed) for (const u of defaultUsers) {
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
    if (runLegacySeed) for (const item of legacyGoogleEmails) {
        await db.execute(
            'UPDATE users SET email = ? WHERE username = ? AND (email IS NULL OR email = \'\')',
            [item.email, item.username]
        );
    }

    // ────────────────────────────────────────
    // Seed: grupo personal por defecto "Mis gastos"
    // ────────────────────────────────────────

    // Solo crear "Mis gastos" si no existe ya para tin
    if (runLegacySeed) {
    const existingCasa = await db.execute(`
        SELECT g.id FROM groups g
        JOIN users u ON g.owner_id = u.id
        WHERE g.name = 'Mis gastos' AND u.username = 'tin'
        LIMIT 1
    `);
    if (existingCasa.rows.length === 0) {
        await db.execute(`
            INSERT INTO groups (name, owner_id, base_currency)
            SELECT 'Mis gastos', id, 'UYU'
            FROM users
            WHERE username = 'tin'
            LIMIT 1
        `);
    }

    // Solo agregar miembros si no existen ya
    const casaGroup = await db.execute(`
        SELECT id FROM groups WHERE name = 'Mis gastos' AND owner_id = (SELECT id FROM users WHERE username = 'tin') LIMIT 1
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
    }

    // ────────────────────────────────────────
    // Migración única: grupo personal legacy "Casa" -> "Mis gastos"
    // Solo se renombra si el creador es el único miembro (grupo personal).
    // ────────────────────────────────────────
    if (!(await hasMigration('rename-personal-casa-v1'))) {
        try {
            await db.execute(`
                UPDATE groups SET name = 'Mis gastos'
                WHERE name = 'Casa'
                  AND (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = groups.id) = 1
                  AND EXISTS (
                      SELECT 1 FROM group_members gm
                      WHERE gm.group_id = groups.id AND gm.user_id = groups.owner_id
                  )
            `);
        } catch (e) {
            console.log('[DB] No se pudo renombrar el grupo personal legacy:', e.message);
        }
        await markMigration('rename-personal-casa-v1');
    }

    // ────────────────────────────────────────
    // Migración única de roles legacy
    // ────────────────────────────────────────

    if (runLegacySeed) {
        // Migración única de role -> global_role (antes se repetía en cada
        // boot y re-promovía a quien hubiera sido degradado a member).
        try {
            await db.execute('UPDATE users SET global_role = role WHERE global_role IS NULL OR global_role = \'member\'');
        } catch (e) {
            // Ignorar si la columna role ya no existe
        }

        await markMigration('legacy-seed-v1');
        console.log('[DB] Seed legacy aplicado una sola vez (legacy-seed-v1)');
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

    // Bootstrap del superadmin: solo si la ENV existe y el usuario ya está cargado.
    // Si se registra más tarde, el handler de /api/register vuelve a intentarlo.
    await bootstrapSuperadmin(process.env.SUPERADMIN_USERNAME);

    console.log('[DB] Tablas inicializadas: users, sessions, groups, group_members, group_expenses, group_splits, group_payments, expenses, expense_splits');
}

initDB().catch(err => {
    console.error('[DB] Error inicializando Turso:', err);
});

module.exports = db;
module.exports.bootstrapSuperadmin = bootstrapSuperadmin;
