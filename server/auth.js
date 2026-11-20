const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');
const db = require('./database');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas
const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000;  // 10 minutos

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function parseCookies(header) {
    const cookies = {};
    if (!header) return cookies;
    header.split(';').forEach(pair => {
        const [key, ...rest] = pair.split('=');
        cookies[key.trim()] = rest.join('=').trim();
    });
    return cookies;
}

// ────────────────────────────────────────
// Auth: credenciales desde DB (con fallback a legacy)
// ────────────────────────────────────────

function simpleHashVerify(input, stored) {
    if (!stored) return false;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        const ch = input.charCodeAt(i);
        hash = ((hash << 5) - hash) + ch;
        hash = hash & hash;
    }
    return stored === `simple:${Math.abs(hash).toString(16)}`;
}

async function findUser(username) {
    try {
        const result = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
        if (result.rows.length > 0) return result.rows[0];
    } catch (e) {
        console.warn('[AUTH] No se pudo consultar tabla users, usando fallback en memoria');
    }
    return null;
}

async function findUserByEmail(email) {
    try {
        const result = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (result.rows.length > 0) return result.rows[0];
    } catch (e) {
        console.warn('[AUTH] No se pudo consultar tabla users por email');
    }
    return null;
}

function findUserLegacy(username) {
    const USERS = {
        tin: { password: process.env.AUTH_TIN, payer: 'me' },
        noe: { password: process.env.AUTH_NOE, payer: 'partner' }
    };
    if (USERS[username]) {
        return { ...USERS[username], username };
    }
    return null;
}

async function verifyPasswordDB(username, password) {
    const user = await findUser(username);
    if (!user) return null;

    // Verificar password_hash (simpleHash o bcrypt)
    if (user.password_hash && user.password_hash.startsWith('simple:')) {
        if (simpleHashVerify(password, user.password_hash)) {
            return { id: Number(user.id), username: user.username, global_role: user.global_role || user.role || 'member' };
        }
    }
    return null;
}

async function verifyPassword(username, password) {
    // Primero intenta DB
    const dbUser = await verifyPasswordDB(username, password);
    if (dbUser) return dbUser;

    // Fallback a legacy (hardcoded)
    const legacy = findUserLegacy(username);
    if (legacy && legacy.password === password) {
        return { id: legacy.username === 'tin' ? 1 : 2, username: legacy.username, global_role: 'admin' };
    }
    return null;
}

// ────────────────────────────────────────
// Sesiones: persistencia en DB
// ────────────────────────────────────────

async function createSession(userId) {
    const token = generateToken();
    const expiresAt = Date.now() + SESSION_TTL_MS;
    try {
        await db.execute({
            sql: 'INSERT OR REPLACE INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
            args: [token, userId, expiresAt]
        });
    } catch (e) {
        console.error('[AUTH] Error creando sesión en DB:', e);
    }
    return token;
}

async function getSession(token) {
    try {
        const result = await db.execute('SELECT * FROM sessions WHERE token = ?', [token]);
        if (result.rows.length === 0) return null;
        const session = result.rows[0];
        if (Date.now() > session.expires_at) {
            await db.execute('DELETE FROM sessions WHERE token = ?', [token]);
            return null;
        }
        // Refresh TTL
        const newExpiry = Date.now() + SESSION_TTL_MS;
        await db.execute('UPDATE sessions SET expires_at = ? WHERE token = ?', [newExpiry, token]);
        return { userId: session.user_id, username: session.user_id }; // Se llena con getUser
    } catch (e) {
        console.error('[AUTH] Error leyendo sesión de DB:', e);
        return null;
    }
}

async function deleteSession(token) {
    try {
        await db.execute('DELETE FROM sessions WHERE token = ?', [token]);
    } catch (e) {
        console.error('[AUTH] Error eliminando sesión de DB:', e);
    }
}

async function cleanExpiredSessions() {
    try {
        await db.execute('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
    } catch (e) {
        // Silenciar errores en limpieza periódica
    }
}

// ────────────────────────────────────────
// Middleware
// ────────────────────────────────────────

async function authMiddleware(req, res, next) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies['session_token'];

    if (!token) {
        return res.status(401).json({ error: 'No autenticado' });
    }

    // Verificar sesión en DB
    try {
        const result = await db.execute('SELECT * FROM sessions WHERE token = ?', [token]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Sesión no encontrada' });
        }
        const session = result.rows[0];
        if (Date.now() > session.expires_at) {
            await deleteSession(token);
            return res.status(401).json({ error: 'Sesión expirada' });
        }

        // Obtener info del usuario
        const userResult = await db.execute('SELECT * FROM users WHERE id = ?', [session.user_id]);
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Usuario no encontrado' });
        }

        req.user = { username: userResult.rows[0].username, global_role: userResult.rows[0].global_role || userResult.rows[0].role || 'member', userId: Number(userResult.rows[0].id) };

        // Refresh TTL en cada request
        const newExpiry = Date.now() + SESSION_TTL_MS;
        await db.execute('UPDATE sessions SET expires_at = ? WHERE token = ?', [newExpiry, token]);

        next();
    } catch (e) {
        console.error('[AUTH] Error en middleware:', e);
        return res.status(401).json({ error: 'Error de autenticación' });
    }
}

// ────────────────────────────────────────
// Funciones de login/logout
// ────────────────────────────────────────

async function login(username, password) {
    const user = await verifyPassword(username, password);
    if (!user) {
        console.log(`[AUTH] FALLO: credenciales inválidas para user="${username}"`);
        return null;
    }

    await createSession(user.id);

    // Revisar si la sesión fue creada
    const tokenResult = await db.execute('SELECT token FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [user.id]);
    if (tokenResult.rows.length > 0) {
        return tokenResult.rows[0].token;
    }
    return generateToken(); // fallback
}

function logout(token) {
    deleteSession(token);
}

async function getUser(token) {
    if (!token) return null;

    try {
        const result = await db.execute('SELECT * FROM sessions WHERE token = ?', [token]);
        if (result.rows.length === 0) return null;
        const session = result.rows[0];
        if (Date.now() > session.expires_at) {
            await deleteSession(token);
            return null;
        }

        const userResult = await db.execute('SELECT * FROM users WHERE id = ?', [Number(session.user_id)]);
        if (userResult.rows.length === 0) return null;
        const user = userResult.rows[0];
        return { id: Number(user.id), username: user.username, global_role: user.global_role || user.role || 'member' };
    } catch (e) {
        console.error('[AUTH] Error en getUser:', e);
        return null;
    }
}

// ────────────────────────────────────────
// Google OAuth functions
// ────────────────────────────────────────

// Google OAuth state store (en memoria, suficiente para OAuth state)
const googleSessions = new Map();

function buildGoogleAuthUrl(clientId, redirectUri, state) {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'openid email',
        state: state,
        access_type: 'offline'
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function exchangeCodeForToken(code, redirectUri) {
    return new Promise((resolve, reject) => {
        const data = new URLSearchParams({
            code,
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
        }).toString();

        const options = {
            hostname: 'oauth2.googleapis.com',
            path: '/token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': data.length
            }
        };

        const req = https.request(options, res => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                try {
                    const tokenResponse = JSON.parse(body);
                    if (res.statusCode !== 200) {
                        return reject(new Error(tokenResponse.error || `Token exchange failed: ${res.statusCode}`));
                    }
                    resolve(tokenResponse);
                } catch (e) {
                    reject(new Error('Invalid token response'));
                }
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function getGoogleRedirectUri(req, clientOrigin) {
    if (process.env.GOOGLE_REDIRECT_URI) {
        return process.env.GOOGLE_REDIRECT_URI;
    }
    if (clientOrigin) {
        return `${clientOrigin}/api/google/callback`;
    }
    const port = process.env.PORT || 4000;
    let host;
    if (req) {
        host = req.get('x-forwarded-host') || req.get('host') || `localhost:${port}`;
    } else {
        host = process.env.NODE_ENV === 'production'
            ? `https://wesplit.genoshan.com`
            : `http://localhost:${port}`;
    }
    if (!host.startsWith('http')) {
        const proto = process.env.NODE_ENV === 'production' ? 'https' : 'http';
        host = `${proto}://${host}`;
    }
    return `${host}/api/google/callback`;
}

function cleanGoogleSessions() {
    const now = Date.now();
    for (const [state, session] of googleSessions) {
        if (now - session.createdAt > GOOGLE_STATE_TTL_MS) {
            googleSessions.delete(state);
        }
    }
}

// Genera un username a partir del email
function emailToUsername(email) {
    const base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    return base || 'user';
}

// Verifica si un username ya existe
async function usernameExists(username) {
    const result = await db.execute('SELECT id FROM users WHERE username = ?', [username]);
    return result.rows.length > 0;
}

// Genera un username único
async function uniqueUsername(base) {
    let username = base;
    let counter = 1;
    while (await usernameExists(username)) {
        username = base + counter;
        counter++;
    }
    return username;
}

async function initGoogleAuth(req, clientOrigin) {
    if (!process.env.GOOGLE_CLIENT_ID) {
        console.error('[AUTH] Falta GOOGLE_CLIENT_ID en variables de entorno');
        return null;
    }

    if (!process.env.GOOGLE_CLIENT_SECRET) {
        console.error('[AUTH] Falta GOOGLE_CLIENT_SECRET en variables de entorno');
        return null;
    }

    cleanGoogleSessions();
    const state = crypto.randomBytes(32).toString('hex');
    const redirectUri = getGoogleRedirectUri(req, clientOrigin);
    const authUrl = buildGoogleAuthUrl(process.env.GOOGLE_CLIENT_ID, redirectUri, state);
    googleSessions.set(state, { redirectUri, createdAt: Date.now() });
    return { authUrl, state };
}

async function handleGoogleCallback(code, state) {
    const sessionData = googleSessions.get(state);
    if (!sessionData) {
        return { error: 'Estado inválido o expirado' };
    }

    try {
        const tokenResponse = await exchangeCodeForToken(code, sessionData.redirectUri);

        const userInfoResult = await new Promise((resolve, reject) => {
            https.get(`https://www.googleapis.com/oauth2/v2/tokeninfo?access_token=${encodeURIComponent(tokenResponse.access_token)}`, res => {
                let body = '';
                res.on('data', chunk => { body += chunk; });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        reject(new Error('Invalid user info response'));
                    }
                });
            }).on('error', reject);
        });

        const email = userInfoResult.email;
        if (!email) {
            googleSessions.delete(state);
            return { error: 'No se pudo obtener el email de Google' };
        }

        // Verificar si el usuario ya existe por email
        let dbUser = await findUserByEmail(email);

        if (!dbUser) {
            // Generar username único a partir del email
            const baseUsername = emailToUsername(email);
            const username = await uniqueUsername(baseUsername);

            // Crear usuario con password aleatorio (no usará password, solo Google OAuth)
            const randomPassword = crypto.randomBytes(16).toString('hex');
            let hash = 0;
            for (let i = 0; i < randomPassword.length; i++) {
                const ch = randomPassword.charCodeAt(i);
                hash = ((hash << 5) - hash) + ch;
                hash = hash & hash;
            }
            const passwordHash = 'simple:' + Math.abs(hash).toString('hex');

            const insertResult = await db.execute({
                sql: 'INSERT INTO users (username, password_hash, global_role, email) VALUES (?, ?, ?, ?)',
                args: [username, passwordHash, 'member', email],
            });
            dbUser = { id: Number(insertResult.lastInsertRowid), username };

            // Auto-crear grupo "Casa"
            const groupResult = await db.execute({
                sql: 'INSERT INTO groups (name, owner_id, base_currency) VALUES (?, ?, ?)',
                args: ['Casa', dbUser.id, 'UYU']
            });
            const groupId = groupResult.lastInsertRowid;
            await db.execute({
                sql: 'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
                args: [groupId, dbUser.id, 'admin']
            });

            console.log(`[GOOGLE AUTH] Nuevo usuario creado: ${username} (${email}), grupo Casa (ID: ${groupId})`);
        } else {
            console.log(`[GOOGLE AUTH] Usuario existente: ${dbUser.username} (${email})`);
        }

        // Crear sesión
        const token = generateToken();
        const expiresAt = Date.now() + SESSION_TTL_MS;
        try {
            await db.execute({
                sql: 'INSERT OR REPLACE INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
                args: [token, dbUser.id, expiresAt]
            });
        } catch (e) {
            console.error('[AUTH] Error creando sesión Google:', e);
        }

        googleSessions.delete(state);
        return { token, user: dbUser.username };
    } catch (err) {
        googleSessions.delete(state);
        return { error: err.message || 'Error al autenticar con Google' };
    }
}

async function getUserGroups(userId) {
    try {
        const result = await db.execute(`
            SELECT g.*, gm.role as member_role
            FROM groups g
            JOIN group_members gm ON g.id = gm.group_id
            WHERE gm.user_id = ?
            ORDER BY g.name ASC
        `, [userId]);
        return result.rows;
    } catch (e) {
        console.error('[AUTH] Error obteniendo grupos de usuario:', e);
        return [];
    }
}

module.exports = {
    authMiddleware,
    login,
    logout,
    getUser,
    getUserGroups,
    initGoogleAuth,
    handleGoogleCallback,
    cleanGoogleSessions,
    findUser,
    verifyPassword,
    createSession,
    getSession,
    deleteSession,
    parseCookies,
    cleanExpiredSessions
};
