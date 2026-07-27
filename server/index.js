const express = require('express');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./database');
const { authMiddleware, login, logout, getUser } = require('./auth');

const app = express();
const PORT = process.env.PORT || 4000;

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
app.use('/api/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));

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
    if (!username || !password) {
        return res.status(400).json({ error: 'Faltan credenciales' });
    }

    const token = login(username, password);
    if (!token) {
        return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    res.setHeader('Set-Cookie', `session_token=${token}; HttpOnly; SameSite=Strict; Path=/`);
    res.json({ message: 'Login exitoso', user: username });
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
    res.setHeader('Set-Cookie', 'session_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ message: 'Logout exitoso' });
});

app.get('/api/auth/check', (req, res) => {
    const cookies = {};
    if (req.headers.cookie) {
        req.headers.cookie.split(';').forEach(pair => {
            const [key, ...rest] = pair.split('=');
            cookies[key.trim()] = rest.join('=').trim();
        });
    }
    const user = getUser(cookies['session_token']);
    if (!user) {
        return res.status(401).json({ error: 'No autenticado' });
    }
    res.json({ user: user.username, payer: user.payer });
});

// Auth middleware + rate limit para el resto de la API
app.use('/api', apiLimiter);
app.use('/api', authMiddleware);

app.get('/api/expenses', (req, res) => {
    db.all('SELECT * FROM expenses ORDER BY date DESC', [], (err, rows) => {
        if (err) {
            console.error(`[ERROR_QUERY] Fallo al obtener gastos: ${err}`);
            res.status(500).json({ error: 'Error interno en la base de datos' });
        } else {
            let totalMe = 0;
            let totalPartner = 0;
            rows.forEach(row => {
                if (row.payer === 'me') totalMe += row.amount;
                else if (row.payer === 'partner') totalPartner += row.amount;
            });
            const difference = totalMe - totalPartner;

            res.json({
                expenses: rows,
                summary: {
                    totalMe: totalMe,
                    totalPartner: totalPartner,
                    balance: difference > 0 ? (difference / 2).toFixed(2) : (Math.abs(difference) / 2).toFixed(2),
                    status: difference > 0 ? "Te deben" : "Le debes"
                }
            });
        }
    });
});

app.post('/api/expense', (req, res) => {
    const { date, description, amount, payer, category } = req.body;
    const cleanDescription = description ? description.trim() : '';
    const parsedAmount = parseFloat(amount);

    const validPayers = ['me', 'partner'];
    const validCategories = ['Alimentación', 'Transporte', 'Ocio', 'Servicios', 'Otros'];

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

    const query = `INSERT INTO expenses (date, description, amount, payer, category) VALUES (?, ?, ?, ?, ?)`;
    db.run(query, [date, cleanDescription, parsedAmount, payer, category], function(err) {
        if (err) {
            console.error(`[ERROR_DB] Fallo al insertar en la base de datos: ${err}`);
            res.status(500).json({ error: 'Error interno en la base de datos' });
        } else {
            console.log(`[ÉXITO] Gasto registrado: ${cleanDescription} - $${parsedAmount}`);
            res.json({ id: this.lastID, message: 'Gasto registrado con éxito' });
        }
    });
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
