require('dotenv').config({ path: require('path').join(__dirname, '.env') });

process.on('uncaughtException', (err) => { console.error('[FATAL]', err); process.exit(1); });
process.on('unhandledRejection', (reason, promise) => { console.error('[UNHANDLED]', reason); });

const express = require('express');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./database');
const { authMiddleware, login, logout, getUser, initGoogleAuth, handleGoogleCallback, cleanGoogleSessions } = require('./auth');

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

// Servir archivos estáticos (login incluido)
app.use(express.static(path.join(__dirname, '..')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

// Auth endpoints (no requieren autenticación)
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    console.log(`[LOGIN] Recibido: user="${username}" pass="${password}"`);
    console.log(`[LOGIN] AUTH_TIN="${process.env.AUTH_TIN}"`);
    if (!username || !password) {
        return res.status(400).json({ error: 'Faltan credenciales' });
    }

    const token = login(username, password);
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

app.get('/api/auth/check', (req, res) => {
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
    console.log(`[AUTH/CHECK] Cookie header: ${req.headers.cookie}`);
    console.log(`[AUTH/CHECK] Parsed cookies:`, cookies);
    console.log(`[AUTH/CHECK] session_token:`, cookies['session_token']);
    const user = getUser(cookies['session_token']);
    if (!user) {
        return res.status(401).json({ error: 'No autenticado' });
    }
    res.json({ user: user.username, payer: user.payer });
});

// Auth middleware + rate limit para el resto de la API
app.use('/api', apiLimiter);
app.use('/api', authMiddleware);

app.get('/api/expenses', async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM expenses ORDER BY date DESC');
        const rows = result.rows;

        const expensesWithSplits = await Promise.all(rows.map(async (row) => {
            const splitsResult = await db.execute('SELECT * FROM expense_splits WHERE expense_id = ?', [row.id]);
            const splits = splitsResult.rows;
            const meShare = splits.filter(s => s.user_id === 'me').reduce((sum, s) => sum + s.amount, 0);
            const partnerShare = splits.filter(s => s.user_id === 'partner').reduce((sum, s) => sum + s.amount, 0);

            return {
                ...row,
                splits,
                meShare,
                partnerShare
            };
        }));

        let totalMe = 0;
        let totalPartner = 0;

        expensesWithSplits.forEach(expense => {
            if (expense.payer === 'me') {
                totalMe += (expense.amount - expense.meShare);
            } else {
                totalPartner += (expense.amount - expense.partnerShare);
            }
        });

        const balance = totalMe - totalPartner;

        res.json({
            expenses: expensesWithSplits,
            summary: {
                totalMe,
                totalPartner,
                balance: balance > 0 ? (balance / 2).toFixed(2) : (Math.abs(balance) / 2).toFixed(2),
                status: balance > 0 ? "Te deben" : "Le debes"
            }
        });
    } catch (err) {
        console.error(`[ERROR_QUERY] Fallo al obtener gastos: ${err}`);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

app.get('/api/expense/:id', async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
        if (!result.rows || result.rows.length === 0) {
            return res.status(404).json({ error: 'Gasto no encontrado' });
        }
        const expense = result.rows[0];

        const splitsResult = await db.execute('SELECT * FROM expense_splits WHERE expense_id = ?', [req.params.id]);
        const splits = splitsResult.rows;

        res.json({ ...expense, splits });
    } catch (err) {
        console.error(`[ERROR_QUERY] Fallo al obtener gasto: ${err}`);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

app.post('/api/expense', async (req, res) => {
    const { date, description, amount, payer, category, split_mode, splits } = req.body;
    const cleanDescription = description ? description.trim() : '';
    const parsedAmount = parseFloat(amount);

    const validPayers = ['me', 'partner'];
    const validCategories = ['Alimentación', 'Transporte', 'Ocio', 'Servicios', 'Otros'];
    const validSplitModes = ['equal', 'solo', 'custom'];

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
        console.warn(`[VALIDACIÓN] Monto inválido recibido`);
        return res.status(400).json({ error: 'El monto debe ser un número positivo' });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Fecha inválida' });
    }
    if (!validPayers.includes(payer)) {
        return res.status(400).json({ error: 'Pagador inválido' });
    }
    if (!validCategories.includes(category)) {
        return res.status(400).json({ error: 'Categoría inválida' });
    }
    if (cleanDescription.length > 500) {
        return res.status(400).json({ error: 'Descripción demasiado larga (máximo 500 caracteres)' });
    }
    if (!split_mode || !validSplitModes.includes(split_mode)) {
        return res.status(400).json({ error: 'Modo de división inválido' });
    }

    let splitAmounts = [];
    if (split_mode === 'equal') {
        splitAmounts = [{ user_id: 'me', amount: parsedAmount / 2 }, { user_id: 'partner', amount: parsedAmount / 2 }];
    } else if (split_mode === 'solo') {
        splitAmounts = [{ user_id: payer, amount: parsedAmount }];
    } else if (split_mode === 'custom') {
        if (!Array.isArray(splits) || splits.length === 0) {
            return res.status(400).json({ error: 'Faltan splits para modo personalizado' });
        }
        let totalSplit = splits.reduce((sum, s) => sum + (s.amount || 0), 0);
        if (Math.abs(totalSplit - parsedAmount) > 0.01) {
            return res.status(400).json({ error: `La suma de los splits ($${totalSplit}) no coincide con el monto ($${parsedAmount})` });
        }
        splitAmounts = splits.map(s => ({ user_id: s.user_id, amount: parseFloat(s.amount) }));
    }

    try {
        const result = await db.execute({
            sql: 'INSERT INTO expenses (date, description, amount, payer, category) VALUES (?, ?, ?, ?, ?)',
            args: [date, cleanDescription, parsedAmount, payer, category],
        });
        const expenseId = result.lastInsertRowid;

        for (const split of splitAmounts) {
            await db.execute({
                sql: 'INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (?, ?, ?)',
                args: [Number(expenseId), split.user_id, split.amount],
            });
        }

        console.log(`[ÉXITO] Gasto registrado: ${cleanDescription} - $${parsedAmount} (${split_mode})`);
        res.json({ id: Number(expenseId), message: 'Gasto registrado con éxito' });
    } catch (err) {
        console.error(`[ERROR_DB] Fallo al insertar en la base de datos: ${err}`);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

app.delete('/api/expense/:id', async (req, res) => {
    try {
        const result = await db.execute('DELETE FROM expenses WHERE id = ?', [req.params.id]);
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
    const { date, description, amount, payer, category, split_mode, splits } = req.body;
    const cleanDescription = description ? description.trim() : '';
    const parsedAmount = parseFloat(amount);

    const validPayers = ['me', 'partner'];
    const validCategories = ['Alimentación', 'Transporte', 'Ocio', 'Servicios', 'Otros'];
    const validSplitModes = ['equal', 'solo', 'custom'];

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: 'El monto debe ser un número positivo' });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Fecha inválida' });
    }
    if (!validPayers.includes(payer)) {
        return res.status(400).json({ error: 'Pagador inválido' });
    }
    if (!validCategories.includes(category)) {
        return res.status(400).json({ error: 'Categoría inválida' });
    }
    if (cleanDescription.length > 500) {
        return res.status(400).json({ error: 'Descripción demasiado larga (máximo 500 caracteres)' });
    }
    if (!split_mode || !validSplitModes.includes(split_mode)) {
        return res.status(400).json({ error: 'Modo de división inválido' });
    }

    let splitAmounts = [];
    if (split_mode === 'equal') {
        splitAmounts = [{ user_id: 'me', amount: parsedAmount / 2 }, { user_id: 'partner', amount: parsedAmount / 2 }];
    } else if (split_mode === 'solo') {
        splitAmounts = [{ user_id: payer, amount: parsedAmount }];
    } else if (split_mode === 'custom') {
        if (!Array.isArray(splits) || splits.length === 0) {
            return res.status(400).json({ error: 'Faltan splits para modo personalizado' });
        }
        let totalSplit = splits.reduce((sum, s) => sum + (s.amount || 0), 0);
        if (Math.abs(totalSplit - parsedAmount) > 0.01) {
            return res.status(400).json({ error: `La suma de los splits ($${totalSplit}) no coincide con el monto ($${parsedAmount})` });
        }
        splitAmounts = splits.map(s => ({ user_id: s.user_id, amount: parseFloat(s.amount) }));
    }

    try {
        const existing = await db.execute('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Gasto no encontrado' });
        }

        await db.execute(
            'UPDATE expenses SET date = ?, description = ?, amount = ?, payer = ?, category = ? WHERE id = ?',
            [date, cleanDescription, parsedAmount, payer, category, req.params.id]
        );

        await db.execute('DELETE FROM expense_splits WHERE expense_id = ?', [req.params.id]);

        for (const split of splitAmounts) {
            await db.execute({
                sql: 'INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (?, ?, ?)',
                args: [req.params.id, split.user_id, split.amount],
            });
        }

        console.log(`[ÉXITO] Gasto actualizado: ${req.params.id} - ${cleanDescription} (${split_mode})`);
        res.json({ message: 'Gasto actualizado con éxito' });
    } catch (err) {
        console.error(`[ERROR_DB] Fallo al actualizar gasto: ${err}`);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
