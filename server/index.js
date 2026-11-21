require('dotenv').config({ path: require('path').join(__dirname, '.env') });

process.on('uncaughtException', (err) => { console.error('[FATAL]', err); process.exit(1); });
process.on('unhandledRejection', (reason, promise) => { console.error('[UNHANDLED]', reason); });

// Identificador de deploy. Se calcula una sola vez al arrancar: en Render viene
// de las variables que el propio servicio inyecta; en local se marca como tal.
// Antes `buildTime` devolvía la hora de cada request, así que no servía para
// saber qué versión estaba corriendo.
const buildInfo = {
    version: require('../package.json').version,
    commit: (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7),
    branch: process.env.RENDER_GIT_BRANCH || 'local',
    preview: process.env.IS_PULL_REQUEST === 'true',
    startedAt: new Date().toISOString()
};

function categoryName(cat) {
    const names = {
        'food': 'Alimentación',
        'transport': 'Transporte',
        'entertainment': 'Ocio',
        'bills': 'Servicios',
        'others': 'Otros'
    };
    return names[cat] || cat;
}

function payerName(payer) {
    return payer === 'me' ? 'Tin' : 'Noe';
}

function fromUser(user) {
    return user === 'me' ? 'Tin' : 'Noe';
}

function toUser(user) {
    return user === 'me' ? 'Noe' : 'Tin';
}

const express = require('express');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./database');
const { authMiddleware, login, logout, getUser, getUserGroups, initGoogleAuth, handleGoogleCallback, cleanGoogleSessions, parseCookies } = require('./auth');
const groupsRouter = require('./groups');
const { hashPassword, verifyValue, needsRehash } = require('./password');

const app = express();
const PORT = process.env.PORT || 4000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const COOKIE_FLAGS = `HttpOnly; SameSite=Strict; Path=/${IS_PRODUCTION ? '; Secure' : ''}`;

// Version endpoint (public, no auth required)
app.get('/api/version', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json({ ...buildInfo, buildTime: buildInfo.startedAt });
});

// Security: CSP activa. Los handlers inline se sacaron de index.html/app.js
// (ahora son addEventListener) para poder mantener script-src-attr 'none'.
// upgrade-insecure-requests se desactiva en local porque el server corre por http.
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
            styleSrc: ["'self'", 'https://cdn.jsdelivr.net', "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", 'https://cdn.jsdelivr.net', 'data:'],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            ...(IS_PRODUCTION ? {} : { upgradeInsecureRequests: null })
        }
    }
}));

// Detrás de un reverse proxy, express-rate-limit necesita saber cuántos
// proxies hay para no agrupar a todos los usuarios bajo una misma IP.
// Configurar TRUST_PROXY=1 en producción (dejar unset en local).
if (process.env.TRUST_PROXY) {
    app.set('trust proxy', Number(process.env.TRUST_PROXY));
}

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas peticiones, intentá de nuevo en un minuto' }
});
const authActionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos, intentá de nuevo en unos minutos' }
});
app.use('/api/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// Middleware
app.use(bodyParser.json({ limit: '100kb' }));

// Limiter global: antes estaba montado al final de /api, por lo que register,
// login, groups y google quedaban sin límite. Se aplica una sola vez
// a todas las rutas /api que se registren a partir de acá.
app.use('/api', apiLimiter);

// Grupos API
app.use('/api/groups', groupsRouter);

// Servir únicamente los archivos del front-end. El resto del repo (server/,
// scripts/, memory/, .env, etc.) nunca debe ser accesible por HTTP.
const PUBLIC_ASSETS = new Set(['/index.html', '/style.css', '/app.js', '/favicon.ico']);
app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/') return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!PUBLIC_ASSETS.has(req.path)) return res.status(404).end();
    next();
});
app.use(express.static(path.join(__dirname, '..'), { index: false, dotfiles: 'ignore' }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

// Auth endpoints (no requieren autenticación)
// Registro de nuevos usuarios
app.post('/api/register', authActionLimiter, async (req, res) => {
    const { username, password, email, name } = req.body;
    const cleanUsername = username ? username.trim().toLowerCase() : '';
    const cleanName = name ? String(name).trim() : '';
    const cleanEmail = email ? String(email).trim().toLowerCase() : '';

    if (!cleanUsername || cleanUsername.length < 3) {
        return res.status(400).json({ error: 'El username debe tener al menos 3 caracteres' });
    }
    if (!password || password.length < 12) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 12 caracteres' });
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
        return res.status(400).json({ error: 'El email es obligatorio y debe ser válido' });
    }

    try {
        const existing = await db.execute('SELECT id FROM users WHERE username = ?', [cleanUsername]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'El username ya existe' });
        }
        // Verificar unicidad de email
        const existingEmail = await db.execute('SELECT id FROM users WHERE LOWER(email) = ?', [cleanEmail]);
        if (existingEmail.rows.length > 0) {
            return res.status(409).json({ error: 'El email ya está en uso' });
        }

        const passwordHash = await hashPassword(password);

        const insertResult = await db.execute({
            sql: 'INSERT INTO users (username, password_hash, global_role, email, name) VALUES (?, ?, ?, ?, ?)',
            args: [cleanUsername, passwordHash, 'member', cleanEmail || null, cleanName || cleanUsername]
        });

        const userId = insertResult.lastInsertRowid;

        // Auto-crear grupo personal "Mis gastos"
        const groupResult = await db.execute({
            sql: 'INSERT INTO groups (name, owner_id, base_currency) VALUES (?, ?, ?)',
            args: ['Mis gastos', userId, 'UYU']
        });
        const groupId = groupResult.lastInsertRowid;
        await db.execute({
            sql: 'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
            args: [groupId, userId, 'admin']
        });

        console.log(`[REGISTER] Usuario creado: ${cleanUsername} (ID: ${userId}), grupo Mis gastos (ID: ${groupId})`);
        res.json({ message: 'Usuario creado con éxito', username: cleanUsername });
    } catch (err) {
        console.error('[REGISTER] Error:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// Actualizar perfil de usuario. Verifica current_password, así que comparte
// el limiter estricto de login/delete para evitar fuerza bruta de la clave.
app.put('/api/profile', authActionLimiter, async (req, res) => {
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

    const { email, password, current_password, name } = req.body;

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
        if (!(await verifyValue(current_password, storedHash))) {
            return res.status(403).json({ error: 'Contraseña actual incorrecta' });
        }
        // Aprovechamos el cambio autenticado para migrar un hash del esquema viejo.
        if (needsRehash(storedHash)) {
            await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [
                await hashPassword(current_password), user.id
            ]);
        }
    }

    try {
        if (name !== undefined) {
            const cleanName = String(name).trim();
            if (!cleanName) {
                return res.status(400).json({ error: 'El nombre no puede estar vacío' });
            }
            await db.execute('UPDATE users SET name = ? WHERE id = ?', [cleanName, user.id]);
        }
        if (email !== undefined) {
            const cleanEmail = String(email).trim().toLowerCase();
            if (!cleanEmail || !cleanEmail.includes('@')) {
                return res.status(400).json({ error: 'Email inválido' });
            }
            // Verificar unicidad de email (normalizado)
            const existing = await db.execute('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?', [cleanEmail, user.id]);
            if (existing.rows.length > 0) {
                return res.status(409).json({ error: 'El email ya está en uso' });
            }
            await db.execute('UPDATE users SET email = ? WHERE id = ?', [cleanEmail, user.id]);
        }
        if (password) {
            if (password.length < 12) {
                return res.status(400).json({ error: 'La contraseña debe tener al menos 12 caracteres' });
            }
            const passwordHash = await hashPassword(password);
            await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, user.id]);
        }
        res.json({
            message: 'Perfil actualizado con éxito',
            name: name !== undefined ? String(name).trim() : (user.name || user.username)
        });
    } catch (err) {
        console.error('[PROFILE] Error:', err);
        res.status(500).json({ error: 'Error interno en la base de datos' });
    }
});

// Eliminar cuenta de usuario
app.delete('/api/profile', authActionLimiter, async (req, res) => {
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
        if (!(await verifyValue(current_password, storedHash))) {
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
        // 4. Limpiar membresías huérfanas (grupos borrados por otro usuario,
        //    pendientes o inactivos). SQLite no aplica CASCADE sin PRAGMA
        //    foreign_keys = ON, así que lo hacemos explícito.
        await db.execute('DELETE FROM group_members WHERE group_id NOT IN (SELECT id FROM groups)');
        // 5. Eliminar usuario
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

    let token;
    try {
        token = await login(username, password);
    } catch (err) {
        // Un error de DB NO debe caer al fallback legacy ni filtrarse.
        console.error('[LOGIN] Error verificando credenciales:', err.message);
        return res.status(503).json({ error: 'Servicio no disponible' });
    }
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
app.get('/api/google/config', (req, res) => {
    res.json({ enabled: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) });
});

app.post('/api/google/init', bodyParser.json(), async (req, res) => {
    cleanGoogleSessions();
    const clientOrigin = req.body?.origin;
    const result = await initGoogleAuth(clientOrigin);
    if (!result) {
        return res.status(500).json({ error: 'Google OAuth no configurado correctamente' });
    }
    // Nonce ligado al browser. SameSite=Lax es necesario porque el callback
    // de Google es una navegación GET cross-site (Strict no enviaría la cookie).
    res.cookie('oauth_state', result.cookieToken, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 10 * 60 * 1000,
        secure: IS_PRODUCTION
    });
    res.json({ redirectUrl: result.authUrl });
});

app.get('/api/google/callback', async (req, res) => {
    const { code, state, error } = req.query;
    const clearStateCookie = () => res.cookie('oauth_state', '', {
        httpOnly: true, sameSite: 'lax', path: '/', expires: new Date(0), secure: IS_PRODUCTION
    });

    if (error) {
        clearStateCookie();
        return res.status(400).json({ error: 'Error de autenticación con Google' });
    }
    if (!code || !state) {
        clearStateCookie();
        return res.status(400).json({ error: 'Faltan parámetros requeridos' });
    }

    try {
        const cookies = parseCookies(req.headers.cookie);
        const result = await handleGoogleCallback(code, state, cookies['oauth_state']);
        clearStateCookie();

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
        clearStateCookie();
        console.error('[GOOGLE CALLBACK] Error:', err.message);
        res.status(500).json({ error: 'Error al completar el login con Google' });
    }
});

app.post('/api/google/logout', (req, res) => {
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
    res.json({ user: user.username, name: user.name, global_role: user.global_role, groups, defaultGroup });
});

// Sugerencias para el modal de invitación. Requiere sesión y comparte el
// rate limit global de /api. No filtra por grupo: el admin decide a quién invita.
app.get('/api/users/search', authMiddleware, async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q.length < 2) return res.json([]);
    try {
        // Los comodines del usuario son texto literal, no patrones LIKE.
        const literal = q.replace(/[\\%_]/g, ch => `\\${ch}`);
        const result = await db.execute(
            "SELECT username, name FROM users WHERE LOWER(username) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(name, '')) LIKE ? ESCAPE '\\' ORDER BY username LIMIT 8",
            [`${literal}%`, `${literal}%`]
        );
        res.json(result.rows.map(u => ({ username: u.username, name: u.name || u.username })));
    } catch (err) {
        console.error('[USERS] Error buscando usuarios:', err);
        res.status(500).json({ error: 'Error al buscar usuarios' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
