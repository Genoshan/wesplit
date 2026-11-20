require('dotenv').config({ path: require('path').join(__dirname, '.env') });

process.on('uncaughtException', (err) => { console.error('[FATAL]', err); process.exit(1); });
process.on('unhandledRejection', (reason, promise) => { console.error('[UNHANDLED]', reason); });

const express = require('express');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./database');
const { authMiddleware, login, logout, getUser, getUserGroups, initGoogleAuth, handleGoogleCallback, cleanGoogleSessions } = require('./auth');
const groupsRouter = require('./groups');

const app = express();
const PORT = process.env.PORT || 4000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const COOKIE_FLAGS = `HttpOnly; SameSite=Strict; Path=/${IS_PRODUCTION ? '; Secure' : ''}`;

// Version endpoint (public, no auth required)
const pkg = require('../package.json');
app.get('/api/version', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json({ version: pkg.version, buildTime: new Date().toISOString() });
});

// Security
app.use(helmet({ contentSecurityPolicy: false }));

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas peticiones, intentá de nuevo en un minuto' }
});
app.use('/api/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// Middleware
app.use(bodyParser.json({ limit: '100kb' }));

// Grupos API
app.use('/api/groups', groupsRouter);

// Servir archivos estáticos (login incluido)
app.use(express.static(path.join(__dirname, '..')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

// Auth endpoints (no requieren autenticación)
// Registro de nuevos usuarios
app.post('/api/register', async (req, res) => {
    const { username, password, email } = req.body;
    const cleanUsername = username ? username.trim().toLowerCase() : '';

    if (!cleanUsername || cleanUsername.length < 3) {
        return res.status(400).json({ error: 'El username debe tener al menos 3 caracteres' });
    }
    if (!password || password.length < 4) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
    }
    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'El email es obligatorio y debe ser válido' });
    }

    try {
        const existing = await db.execute('SELECT id FROM users WHERE username = ?', [cleanUsername]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'El username ya existe' });
        }
        // Verificar unicidad de email
        const existingEmail = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existingEmail.rows.length > 0) {
            return res.status(409).json({ error: 'El email ya está en uso' });
        }

        // Hash simple
        let hash = 0;
        for (let i = 0; i < password.length; i++) {
            const ch = password.charCodeAt(i);
            hash = ((hash << 5) - hash) + ch;
            hash = hash & hash;
        }
        const passwordHash = 'simple:' + Math.abs(hash).toString(16);

        const insertResult = await db.execute({
            sql: 'INSERT INTO users (username, password_hash, global_role, email) VALUES (?, ?, ?, ?)',
            args: [cleanUsername, passwordHash, 'member', email || null]
        });

        const userId = insertResult.lastInsertRowid;

        // Auto-crear grupo "Casa"
        const groupResult = await db.execute({
            sql: 'INSERT INTO groups (name, owner_id, base_currency) VALUES (?, ?, ?)',
            args: ['Casa', userId, 'UYU']
        });
        const groupId = groupResult.lastInsertRowid;
        await db.execute({
            sql: 'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
            args: [groupId, userId, 'admin']
        });

        console.log(`[REGISTER] Usuario creado: ${cleanUsername} (ID: ${userId}), grupo Casa (ID: ${groupId})`);
        res.json({ message: 'Usuario creado con éxito', username: cleanUsername });
    } catch (err) {
        console.error('[REGISTER] Error:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// Actualizar perfil de usuario
app.put('/api/profile', async (req, res) => {
    const cookies = {};
    if (req.headers.cookie) {
        req.headers.cookie.split(';').forEach(pair => {
            const [key, ...rest] = pair.split('=');
            cookies[key.trim()] = rest.join('=').trim();
        });
    }
    const user = await getUser(cookies['session_token']);
    if (!user) {
        return res.status(401).json({ error: 'No autenticado' });
    }

    const { email, password, current_password } = req.body;

    // Verificar contraseña actual si se quiere cambiar email o password
    if (email !== undefined || password) {
        if (!current_password) {
            return res.status(400).json({ error: 'Se requiere la contraseña actual para hacer cambios' });
        }
        // Verificar contraseña actual
        const userRow = await db.execute('SELECT password_hash FROM users WHERE id = ?', [user.id]);
        if (userRow.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const storedHash = userRow.rows[0].password_hash;
        let hash = 0;
        for (let i = 0; i < current_password.length; i++) {
            const ch = current_password.charCodeAt(i);
            hash = ((hash << 5) - hash) + ch;
            hash = hash & hash;
        }
        const currentHash = 'simple:' + Math.abs(hash).toString(16);
        if (storedHash !== currentHash) {
            return res.status(403).json({ error: 'Contraseña actual incorrecta' });
        }
    }

    try {
        if (email !== undefined) {
            if (!email || !email.includes('@')) {
                return res.status(400).json({ error: 'Email inválido' });
            }
            // Verificar unicidad de email
            const existing = await db.execute('SELECT id FROM users WHERE email = ? AND id != ?', [email, user.id]);
            if (existing.rows.length > 0) {
                return res.status(409).json({ error: 'El email ya está en uso' });
            }
            await db.execute('UPDATE users SET email = ? WHERE id = ?', [email, user.id]);
        }
        if (password) {
            if (password.length < 4) {
                return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
            }
            let hash = 0;
            for (let i = 0; i < password.length; i++) {
                const ch = password.charCodeAt(i);
                hash = ((hash << 5) - hash) + ch;
                hash = hash & hash;
            }
            const passwordHash = 'simple:' + Math.abs(hash).toString(16);
            await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, user.id]);
        }
        res.json({ message: 'Perfil actualizado con éxito' });
    } catch (err) {
        console.error('[PROFILE] Error:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// Eliminar cuenta de usuario
app.delete('/api/profile', async (req, res) => {
    const cookies = {};
    if (req.headers.cookie) {
        req.headers.cookie.split(';').forEach(pair => {
            const [key, ...rest] = pair.split('=');
            cookies[key.trim()] = rest.join('=').trim();
        });
    }
    const user = await getUser(cookies['session_token']);
    if (!user) {
        return res.status(401).json({ error: 'No autenticado' });
    }

    const { current_password } = req.body || {};
    if (!current_password) {
        return res.status(400).json({ error: 'Se requiere la contraseña actual para eliminar la cuenta' });
    }

    try {
        // Verificar contraseña
        const userRow = await db.execute('SELECT password_hash FROM users WHERE id = ?', [user.id]);
        if (userRow.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const storedHash = userRow.rows[0].password_hash;
        let hash = 0;
        for (let i = 0; i < current_password.length; i++) {
            const ch = current_password.charCodeAt(i);
            hash = ((hash << 5) - hash) + ch;
            hash = hash & hash;
        }
        const currentHash = 'simple:' + Math.abs(hash).toString(16);
        if (storedHash !== currentHash) {
            return res.status(403).json({ error: 'Contraseña incorrecta' });
        }

        // Limpiar datos huérfanos
        // 1. Eliminar membresías del usuario
        await db.execute('DELETE FROM group_members WHERE user_id = ?', [user.id]);
        // 2. Eliminar grupos cuyo owner es este usuario (y sus datos)
        const ownedGroups = await db.execute('SELECT id FROM groups WHERE owner_id = ?', [user.id]);
        for (const g of ownedGroups.rows) {
            await db.execute('DELETE FROM group_splits WHERE expense_id IN (SELECT id FROM group_expenses WHERE group_id = ?)', [g.id]);
            await db.execute('DELETE FROM group_expenses WHERE group_id = ?', [g.id]);
            await db.execute('DELETE FROM group_members WHERE group_id = ?', [g.id]);
            await db.execute('DELETE FROM group_payments WHERE group_id = ?', [g.id]);
            await db.execute('DELETE FROM groups WHERE id = ?', [g.id]);
        }
        // 3. Eliminar sesiones
        await db.execute('DELETE FROM sessions WHERE user_id = ?', [user.id]);
        // 4. Eliminar usuario
        await db.execute('DELETE FROM users WHERE id = ?', [user.id]);

        // Limpiar cookie
        res.cookie('session_token', '', {
            httpOnly: true,
            sameSite: 'strict',
            path: '/',
            expires: new Date(0),
            secure: process.env.NODE_ENV === 'production'
        });

        console.log(`[DELETE USER] Usuario ${user.username} (ID: ${user.id}) eliminado`);
        res.json({ message: 'Cuenta eliminada con éxito' });
    } catch (err) {
        console.error('[DELETE USER] Error:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    console.log(`[LOGIN] Recibido: user="${username}" pass="****"`);
    console.log(`[LOGIN] AUTH_TIN="${process.env.AUTH_TIN ? '***' : undefined}"`);
    if (!username || !password) {
        return res.status(400).json({ error: 'Faltan credenciales' });
    }

    const token = await login(username, password);
    if (!token) {
        console.log(`[LOGIN] FALLO: credenciales inválidas para user="${username}"`);
        return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    res.cookie('session_token', token, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        secure: IS_PRODUCTION
    });
    console.log(`[LOGIN] Cookie set for user: ${username}`);
    res.json({ message: 'Login exitoso', user: username });
    console.log(`[LOGIN] Response sent`);
});

app.post('/api/logout', (req, res) => {
    const cookies = {};
    if (req.headers.cookie) {
        req.headers.cookie.split(';').forEach(pair => {
            const [key, ...rest] = pair.split('=');
            cookies[key.trim()] = rest.join('=').trim();
        });
    }
    logout(cookies['session_token']);
    res.cookie('session_token', '', {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        expires: new Date(0),
        secure: IS_PRODUCTION
    });
    res.json({ message: 'Logout exitoso' });
});

// Google OAuth endpoints (sin rate limit)
app.post('/api/google/init', bodyParser.json(), apiLimiter, (req, res) => {
    cleanGoogleSessions();
    const clientOrigin = req.body?.origin;
    const result = initGoogleAuth(req, clientOrigin);
    if (!result) {
        return res.status(500).json({ error: 'Google OAuth no configurado correctamente' });
    }
    res.json({ redirectUrl: result.authUrl });
});

app.get('/api/google/callback', apiLimiter, async (req, res) => {
    const { code, state, error } = req.query;
    
    if (error) {
        return res.status(400).json({ error: 'Error de autenticacion con Google' });
    }
    
    if (!code || !state) {
        return res.status(400).json({ error: 'Faltan parametros requeridos' });
    }
    
    try {
        const result = await handleGoogleCallback(code, state);
        
        if (result.error) {
            return res.status(401).json({ error: result.error });
        }
        
        res.cookie('session_token', result.token, {
            httpOnly: true,
            sameSite: 'strict',
            path: '/',
            secure: IS_PRODUCTION
        });
        res.redirect('/');
    } catch (err) {
        console.error('[GOOGLE CALLBACK] Error:', err);
        res.status(500).json({ error: 'Error al completar el login con Google' });
    }
});

app.post('/api/google/logout', apiLimiter, (req, res) => {
    const cookies = {};
    if (req.headers.cookie) {
        req.headers.cookie.split(';').forEach(pair => {
            const [key, ...rest] = pair.split('=');
            cookies[key.trim()] = rest.join('=').trim();
        });
    }
    logout(cookies['session_token']);
    res.cookie('session_token', '', {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        expires: new Date(0),
        secure: IS_PRODUCTION
    });
    res.json({ message: 'Logout exitoso' });
});

app.get('/api/recurring', async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM recurring_expenses ORDER BY next_due_date ASC');
        res.json(result.rows);
    } catch (err) {
        console.error(`[ERROR_DB] Fallo al obtener gastos recurrentes: ${err}`);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

app.post('/api/recurring', async (req, res) => {
    const { description, amount, payer, category, frequency, next_due_date } = req.body;
    const cleanDescription = description ? description.trim() : '';
    const parsedAmount = parseFloat(amount);

    if (!cleanDescription || cleanDescription.length === 0) {
        return res.status(400).json({ error: 'La descripción es requerida' });
    }
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: 'El monto debe ser un número positivo' });
    }
    if (!['me', 'partner'].includes(payer)) {
        return res.status(400).json({ error: 'Pagador inválido' });
    }
    if (!['Alimentación', 'Transporte', 'Ocio', 'Servicios', 'Otros'].includes(category)) {
        return res.status(400).json({ error: 'Categoría inválida' });
    }
    if (!['diario', 'semanal', 'quincenal', 'mensual', 'trimestral', 'anual'].includes(frequency)) {
        return res.status(400).json({ error: 'Frecuencia inválida' });
    }
    if (!next_due_date || !/^\d{4}-\d{2}-\d{2}$/.test(next_due_date)) {
        return res.status(400).json({ error: 'Fecha inválida' });
    }

    try {
        const result = await db.execute({
            sql: 'INSERT INTO recurring_expenses (description, amount, payer, category, frequency, next_due_date) VALUES (?, ?, ?, ?, ?, ?)',
            args: [cleanDescription, parsedAmount, payer, category, frequency, next_due_date],
        });
        console.log(`[ÉXITO] Recurrente creado: ${cleanDescription} - $${parsedAmount}`);
        res.json({ id: Number(result.lastInsertRowid), message: 'Gasto recurrente creado con éxito' });
    } catch (err) {
        console.error(`[ERROR_DB] Fallo al insertar gasto recurrente: ${err}`);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

app.delete('/api/recurring/:id', async (req, res) => {
    try {
        const result = await db.execute('DELETE FROM recurring_expenses WHERE id = ?', [req.params.id]);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Gasto recurrente no encontrado' });
        }
        console.log(`[ÉXITO] Recurrente eliminado: ${req.params.id}`);
        res.json({ message: 'Gasto recurrente eliminado con éxito' });
    } catch (err) {
        console.error(`[ERROR_DB] Fallo al eliminar gasto recurrente: ${err}`);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

app.put('/api/recurring/:id', async (req, res) => {
    const { description, amount, payer, category, frequency, next_due_date } = req.body;
    const cleanDescription = description ? description.trim() : '';
    const parsedAmount = parseFloat(amount);

    if (!cleanDescription || cleanDescription.length === 0) {
        return res.status(400).json({ error: 'La descripción es requerida' });
    }
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: 'El monto debe ser un número positivo' });
    }
    if (!['me', 'partner'].includes(payer)) {
        return res.status(400).json({ error: 'Pagador inválido' });
    }
    if (!['Alimentación', 'Transporte', 'Ocio', 'Servicios', 'Otros'].includes(category)) {
        return res.status(400).json({ error: 'Categoría inválida' });
    }
    if (!['diario', 'semanal', 'quincenal', 'mensual', 'trimestral', 'anual'].includes(frequency)) {
        return res.status(400).json({ error: 'Frecuencia inválida' });
    }
    if (!next_due_date || !/^\d{4}-\d{2}-\d{2}$/.test(next_due_date)) {
        return res.status(400).json({ error: 'Fecha inválida' });
    }

    try {
        const existing = await db.execute('SELECT * FROM recurring_expenses WHERE id = ?', [req.params.id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Gasto recurrente no encontrado' });
        }

        await db.execute(
            'UPDATE recurring_expenses SET description = ?, amount = ?, payer = ?, category = ?, frequency = ?, next_due_date = ? WHERE id = ?',
            [cleanDescription, parsedAmount, payer, category, frequency, next_due_date, req.params.id]
        );
        console.log(`[ÉXITO] Recurrente actualizado: ${req.params.id} - ${cleanDescription}`);
        res.json({ message: 'Gasto recurrente actualizado con éxito' });
    } catch (err) {
        console.error(`[ERROR_DB] Fallo al actualizar gasto recurrente: ${err}`);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

app.get('/api/auth/check', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    const cookies = {};
    if (req.headers.cookie) {
        req.headers.cookie.split(';').forEach(pair => {
            const [key, ...rest] = pair.split('=');
            cookies[key.trim()] = rest.join('=').trim();
        });
    }
    const user = await getUser(cookies['session_token']);
    if (!user) {
        return res.status(401).json({ error: 'No autenticado' });
    }
    const groups = await getUserGroups(user.id);
    const defaultGroup = groups.length > 0 ? { id: groups[0].id, name: groups[0].name, currency: groups[0].base_currency } : null;
    res.json({ user: user.username, global_role: user.global_role, groups, defaultGroup });
});

// Listado de monedas - público (antes del auth)
app.get('/api/currencies', async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM currencies ORDER BY is_default DESC, code ASC');
        res.json(result.rows);
    } catch (err) {
        console.error(`[CURRENCIES] Error: ${err}`);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// Auth middleware + rate limit para el resto de la API
app.use('/api', apiLimiter);
app.use('/api', authMiddleware);

app.post('/api/currencies', async (req, res) => {
    const { code, name, rate, symbol, is_default } = req.body;
    if (!code || !name || rate === undefined || !symbol) {
        return res.status(400).json({ error: 'Faltan campos requeridos (code, name, rate, symbol)' });
    }
    try {
        if (is_default) {
            await db.execute('UPDATE currencies SET is_default = 0');
        }
        const result = await db.execute({
            sql: 'INSERT INTO currencies (code, name, rate, symbol, is_default) VALUES (?, ?, ?, ?, ?)',
            args: [code.toUpperCase(), name, parseFloat(rate), symbol, is_default ? 1 : 0]
        });
        console.log(`[CURRENCY] Agregada: ${code} (${name})`);
        res.json({ id: Number(result.lastInsertRowid), message: `Moneda ${code} agregada` });
    } catch (err) {
        console.error(`[CURRENCY] Error: ${err}`);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

app.put('/api/currencies/:code', async (req, res) => {
    const { name, rate, symbol } = req.body;
    try {
        await db.execute(
            'UPDATE currencies SET name = ?, rate = ?, symbol = ? WHERE code = ?',
            [name, parseFloat(rate), symbol, req.params.code.toUpperCase()]
        );
        res.json({ message: 'Moneda actualizada' });
    } catch (err) {
        console.error(`[CURRENCY] Error: ${err}`);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

app.delete('/api/currencies/:code', async (req, res) => {
    const code = req.params.code.toUpperCase();
    try {
        const check = await db.execute('SELECT * FROM currencies WHERE code = ?', [code]);
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Moneda no encontrada' });
        }
        await db.execute('DELETE FROM currencies WHERE code = ?', [code]);
        res.json({ message: `Moneda ${code} eliminada` });
    } catch (err) {
        console.error(`[CURRENCY] Error: ${err}`);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

app.get('/api/expenses', async (req, res) => {
    try {
        const { username, userId } = req.user;

        // Get user's default group (first group)
        const groupResult = await db.execute(`
            SELECT g.id, g.base_currency
            FROM groups g
            JOIN group_members gm ON g.id = gm.group_id
            WHERE gm.user_id = ?
            ORDER BY g.name ASC
            LIMIT 1
        `, [userId]);

        if (groupResult.rows.length === 0) {
            return res.status(404).json({ error: 'No se encontró grupo para el usuario' });
        }

        const groupId = groupResult.rows[0].id;
        const groupCurrency = groupResult.rows[0].base_currency || 'UYU';

        // Get currencies
        const currenciesResult = await db.execute('SELECT * FROM currencies ORDER BY is_default DESC, code ASC');
        const currencies = {};
        let baseCurrency = 'UYU';
        currenciesResult.rows.forEach(c => {
            currencies[c.code] = c.rate;
            if (c.is_default) baseCurrency = c.code;
        });

        // Get expenses from group
        const result = await db.execute(`
            SELECT ge.*, u2.username as payer_username
            FROM group_expenses ge
            JOIN users u2 ON ge.payer = u2.username
            WHERE ge.group_id = ?
            ORDER BY ge.date DESC, ge.created_at DESC
        `, [groupId]);
        const rows = result.rows;

        const expensesWithSplits = await Promise.all(rows.map(async (row) => {
            const splitsResult = await db.execute('SELECT * FROM group_splits WHERE expense_id = ?', [row.id]);
            const splits = splitsResult.rows;

            // Map user_id back to 'me'/'partner' for frontend compatibility
            const meShare = splits.filter(s => s.user_id === username).reduce((sum, s) => sum + s.amount, 0);
            const partnerShare = splits.filter(s => s.user_id !== username).reduce((sum, s) => sum + s.amount, 0);

            return {
                ...row,
                splits,
                meShare,
                partnerShare
            };
        }));

        const baseRate = currencies[baseCurrency] || 1;

        let totalMe = 0;
        let totalPartner = 0;

        expensesWithSplits.forEach(expense => {
            const currencyRate = (currencies[expense.currency] || 1);
            const amountInBase = expense.amount / currencyRate;
            const meShareBase = (expense.meShare / currencyRate);
            const partnerShareBase = (expense.partnerShare / currencyRate);

            if (expense.payer === username) {
                totalMe += amountInBase - meShareBase;
            } else {
                totalPartner += amountInBase - partnerShareBase;
            }
        });

        const balance = (totalMe - totalPartner) / baseRate;

        res.json({
            expenses: expensesWithSplits,
            summary: {
                totalMe: ((totalMe / baseRate)).toFixed(2),
                totalPartner: ((totalPartner / baseRate)).toFixed(2),
                balance: balance > 0 ? (balance / 2).toFixed(2) : (Math.abs(balance) / 2).toFixed(2),
                status: balance > 0 ? "Te deben" : "Le debes",
                baseCurrency,
                groupId,
                groupName: groupCurrency ? 'Casa' : null
            }
        });
    } catch (err) {
        console.error(`[ERROR_QUERY] Fallo al obtener gastos: ${err}`);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

app.get('/api/expense/:id', async (req, res) => {
    try {
        const { userId } = req.user;
        const groupId = req.query.groupId;

        const result = await db.execute(`
            SELECT ge.*, u2.username as payer_username
            FROM group_expenses ge
            JOIN users u2 ON ge.payer = u2.username
            WHERE ge.id = ? AND ge.group_id = ?
        `, [req.params.id, groupId || '0']);
        if (!result.rows || result.rows.length === 0) {
            return res.status(404).json({ error: 'Gasto no encontrado' });
        }
        const expense = result.rows[0];

        const splitsResult = await db.execute('SELECT * FROM group_splits WHERE expense_id = ?', [req.params.id]);
        const splits = splitsResult.rows;

        res.json({ ...expense, splits });
    } catch (err) {
        console.error(`[ERROR_QUERY] Fallo al obtener gasto: ${err}`);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

app.post('/api/expense', async (req, res) => {
    try {
        const { username, userId } = req.user;
        const { date, description, amount, payer, category, currency, split_mode, splits } = req.body;
        const cleanDescription = description ? description.trim() : '';
        const parsedAmount = parseFloat(amount);

        // Resolve payer to actual username
        const payerMap = { 'me': username, 'partner': username === 'tin' ? 'noe' : 'tin' };
        const resolvedPayer = payerMap[payer] || payer;

        // Get user's default group
        const groupResult = await db.execute(`
            SELECT g.id, g.base_currency
            FROM groups g
            JOIN group_members gm ON g.id = gm.group_id
            WHERE gm.user_id = ?
            ORDER BY g.name ASC
            LIMIT 1
        `, [userId]);

        if (groupResult.rows.length === 0) {
            return res.status(404).json({ error: 'No se encontró grupo para el usuario' });
        }

        const groupId = groupResult.rows[0].id;
        const currencyCode = currency && ['UYU','USD','BRL','EUR','ARS','CLP','MXN','COP','PEN'].includes(currency.toUpperCase())
            ? currency.toUpperCase() : groupResult.rows[0].base_currency || 'UYU';

        // Validate
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: 'El monto debe ser un número positivo' });
        }
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Fecha inválida' });
        }
        if (!['Alimentación','Transporte','Ocio','Servicios','Otros'].includes(category)) {
            return res.status(400).json({ error: 'Categoría inválida' });
        }
        if (cleanDescription.length > 500) {
            return res.status(400).json({ error: 'Descripción demasiado larga' });
        }
        if (!['equal','solo','custom'].includes(split_mode)) {
            return res.status(400).json({ error: 'Modo de división inválido' });
        }

        let splitAmounts = [];
        if (split_mode === 'equal') {
            splitAmounts = [{ user_id: username, amount: parsedAmount / 2 }];
        } else if (split_mode === 'solo') {
            splitAmounts = [{ user_id: resolvedPayer, amount: parsedAmount }];
        } else if (split_mode === 'custom') {
            if (!Array.isArray(splits) || splits.length === 0) {
                return res.status(400).json({ error: 'Faltan splits para modo personalizado' });
            }
            let totalSplit = splits.reduce((sum, s) => sum + (s.amount || 0), 0);
            if (Math.abs(totalSplit - parsedAmount) > 0.01) {
                return res.status(400).json({ error: `La suma de los splits no coincide con el monto` });
            }
            splitAmounts = splits.map(s => ({ user_id: s.user_id, amount: parseFloat(s.amount) }));
        }

        const result = await db.execute({
            sql: 'INSERT INTO group_expenses (group_id, date, description, amount, payer, category, currency, split_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            args: [groupId, date, cleanDescription, parsedAmount, resolvedPayer, category, currencyCode, split_mode],
        });
        const expenseId = result.lastInsertRowid;

        for (const split of splitAmounts) {
            await db.execute({
                sql: 'INSERT INTO group_splits (expense_id, user_id, amount) VALUES (?, ?, ?)',
                args: [Number(expenseId), split.user_id, split.amount],
            });
        }

        console.log(`[ÉXITO] Gasto registrado en grupo ${groupId}: ${cleanDescription} - $${parsedAmount}`);
        res.json({ id: Number(expenseId), message: 'Gasto registrado con éxito' });
    } catch (err) {
        console.error(`[ERROR_DB] Fallo al insertar gasto: ${err}`);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

app.delete('/api/expense/:id', async (req, res) => {
    try {
        const { userId } = req.user;
        const result = await db.execute('DELETE FROM group_expenses WHERE id = ? AND group_id IN (SELECT group_id FROM group_members WHERE user_id = ?)', [req.params.id, userId]);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Gasto no encontrado' });
        }
        console.log(`[ÉXITO] Gasto eliminado: ${req.params.id}`);
        res.json({ message: 'Gasto eliminado con éxito' });
    } catch (err) {
        console.error(`[ERROR_DB] Fallo al eliminar gasto: ${err}`);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

app.put('/api/expense/:id', async (req, res) => {
    try {
        const { username, userId } = req.user;
        const { date, description, amount, payer, category, currency, split_mode, splits } = req.body;
        const cleanDescription = description ? description.trim() : '';
        const parsedAmount = parseFloat(amount);

        const payerMap = { 'me': username, 'partner': username === 'tin' ? 'noe' : 'tin' };
        const resolvedPayer = payerMap[payer] || payer;

        const result = await db.execute({
            sql: 'UPDATE group_expenses SET date = ?, description = ?, amount = ?, payer = ?, category = ?, split_mode = ? WHERE id = ? AND group_id IN (SELECT group_id FROM group_members WHERE user_id = ?)',
            args: [date, cleanDescription, parsedAmount, resolvedPayer, category, split_mode, req.params.id, userId]
        });

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Gasto no encontrado' });
        }

        await db.execute('DELETE FROM group_splits WHERE expense_id = ?', [req.params.id]);

        let splitAmounts = [];
        if (split_mode === 'equal') {
            splitAmounts = [{ user_id: username, amount: parsedAmount / 2 }];
        } else if (split_mode === 'solo') {
            splitAmounts = [{ user_id: resolvedPayer, amount: parsedAmount }];
        } else if (split_mode === 'custom') {
            if (!Array.isArray(splits) || splits.length === 0) {
                return res.status(400).json({ error: 'Faltan splits para modo personalizado' });
            }
            let totalSplit = splits.reduce((sum, s) => sum + (s.amount || 0), 0);
            if (Math.abs(totalSplit - parsedAmount) > 0.01) {
                return res.status(400).json({ error: 'La suma de los splits no coincide con el monto' });
            }
            splitAmounts = splits.map(s => ({ user_id: s.user_id, amount: parseFloat(s.amount) }));
        }

        for (const split of splitAmounts) {
            await db.execute({
                sql: 'INSERT INTO group_splits (expense_id, user_id, amount) VALUES (?, ?, ?)',
                args: [req.params.id, split.user_id, split.amount],
            });
        }

        res.json({ message: 'Gasto actualizado con éxito' });
    } catch (err) {
        console.error(`[ERROR_DB] Fallo al actualizar gasto: ${err}`);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
