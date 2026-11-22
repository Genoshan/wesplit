const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');
const db = require('./database');
const { verifyValue, needsRehash, hashPassword } = require('./password');

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

async function findUser(identifier) {
    // El registro guarda el username en minúsculas. Normalizar evita que un
    // login con mayúsculas falle, y el mismo campo acepta también el email
    // (Google ya buscaba por email, de ahí la diferencia de comportamiento).
    const normalized = String(identifier || '').trim().toLowerCase();
    if (!normalized) return null;
    // Propagar errores de DB: antes se devolvía null ante CUALQUIER fallo, lo
    // que activaba el fallback legacy y podía crear una sesión admin sin DB.
    let result = await db.execute('SELECT * FROM users WHERE username = ?', [normalized]);
    if (result.rows.length === 0 && normalized.includes('@')) {
        result = await db.execute('SELECT * FROM users WHERE LOWER(email) = ?', [normalized]);
    }
    return result.rows.length > 0 ? result.rows[0] : null;
}

async function findUserByEmail(email) {
    // Normalizar: la comparación BINARY permitía registrar "Victim@x.com" y
    // capturar el login OAuth de "victim@x.com".
    const normalized = String(email || '').trim().toLowerCase();
    const result = await db.execute('SELECT * FROM users WHERE LOWER(email) = ?', [normalized]);
    return result.rows.length > 0 ? result.rows[0] : null;
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

    const ok = await verifyValue(password, user.password_hash);
    if (!ok) return null;

    // Migración transparente: si el hash era del esquema viejo ('simple:'),
    // lo reemplazamos por bcrypt usando la contraseña recién verificada.
    if (needsRehash(user.password_hash)) {
        try {
            await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [
                await hashPassword(password), user.id
            ]);
        } catch (e) {
            console.error('[AUTH] No se pudo migrar el hash de password:', e);
        }
    }

    return { id: Number(user.id), username: user.username, global_role: user.global_role || user.role || 'member', name: user.name || user.username };
}

async function isUserDisabled(userId) {
    if (!userId) return false;
    try {
        const result = await db.execute('SELECT status FROM users WHERE id = ?', [Number(userId)]);
        return result.rows[0]?.status === 'disabled';
    } catch (e) {
        console.error('[AUTH] Error leyendo estado del usuario:', e);
        return false;
    }
}

async function verifyPassword(username, password) {
    // Primero intenta DB
    const dbUser = await verifyPasswordDB(username, password);
    if (dbUser) return dbUser;

    // Fallback a legacy (AUTH_TIN/AUTH_NOE) solo si el username NO existe en DB.
    // Si existe, una contraseña vieja en el entorno no debe poder sobrevivir
    // a un cambio de contraseña hecho desde /api/profile.
    const existing = await findUser(username);
    if (existing) return null;

    const legacy = findUserLegacy(username);
    if (legacy && legacy.password === password) {
        return { id: legacy.username === 'tin' ? 1 : 2, username: legacy.username, global_role: 'admin', name: legacy.username.charAt(0).toUpperCase() + legacy.username.slice(1) };
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
        // Un usuario dado de baja pierde cualquier sesión ya abierta.
        if (userResult.rows[0].status === 'disabled') {
            await deleteSession(token);
            return res.status(401).json({ error: 'Sesión no válida' });
        }

        req.user = { username: userResult.rows[0].username, global_role: userResult.rows[0].global_role || userResult.rows[0].role || 'member', userId: Number(userResult.rows[0].id), name: userResult.rows[0].name || userResult.rows[0].username };

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
    // La baja de cuenta bloquea también el login legacy y el de Google.
    // Se responde como credenciales inválidas para no revelar el estado.
    if (await isUserDisabled(user.id)) return null;

    // Devolver directamente el token creado. Antes se re-leía con
    // ORDER BY created_at DESC (granularidad de segundo), lo que podía
    // devolver el token de otro login concurrente del mismo usuario.
    return createSession(user.id);
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
        return { id: Number(user.id), username: user.username, global_role: user.global_role || user.role || 'member', name: user.name || user.username };
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
        scope: 'openid email profile',
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

// El origen lo envía el navegador, por lo que no es confiable: se acepta solo
// si está en ALLOWED_ORIGINS (o es el local por defecto). Así no se puede
// desviar el código de autorización de Google a un host externo.
function isAllowedOrigin(origin) {
    if (!origin) return false;
    let parsed;
    try {
        parsed = new URL(origin);
    } catch {
        return false;
    }
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) return false;

    const port = process.env.PORT || 4000;
    const allowed = [
        ...(process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
        `http://localhost:${port}`,
        `http://127.0.0.1:${port}`
    ];
    return allowed.some(candidate => {
        try {
            return new URL(candidate).origin === parsed.origin;
        } catch {
            return candidate === origin;
        }
    });
}

function getGoogleRedirectUri(clientOrigin) {
    // Nunca derivar el redirect_uri de Host / X-Forwarded-Host: son
    // controlables por el cliente y permiten desviar el code de autorización.
    if (process.env.GOOGLE_REDIRECT_URI) {
        return process.env.GOOGLE_REDIRECT_URI;
    }
    if (isAllowedOrigin(clientOrigin)) {
        return `${new URL(clientOrigin).origin}/api/google/callback`;
    }
    return null;
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

// Allowlist de emails habilitados para entrar con Google.
// - Variable AUSENTE: se permite cualquier email verificado (comportamiento legacy).
// - Variable PRESENTE (incluso vacía): se aplica la lista; vacía = ninguno.
// Se compara en lowercase porque Gmail es case-insensitive y el email ya se
// normalizó arriba; así se evita el bypass "Victim@x.com" vs "victim@x.com".
function isGoogleEmailAllowed(email) {
    if (process.env.GOOGLE_AUTHORIZED_EMAILS === undefined) return true;
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return false;
    const allowed = process.env.GOOGLE_AUTHORIZED_EMAILS
        .split(',')
        .map(entry => entry.trim().toLowerCase())
        .filter(Boolean);
    return allowed.includes(normalized);
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

async function initGoogleAuth(clientOrigin) {
    if (!process.env.GOOGLE_CLIENT_ID) {
        console.error('[AUTH] Falta GOOGLE_CLIENT_ID en variables de entorno');
        return null;
    }

    if (!process.env.GOOGLE_CLIENT_SECRET) {
        console.error('[AUTH] Falta GOOGLE_CLIENT_SECRET en variables de entorno');
        return null;
    }

    cleanGoogleSessions();
    const redirectUri = getGoogleRedirectUri(clientOrigin);
    if (!redirectUri) {
        return null;
    }
    const state = crypto.randomBytes(32).toString('hex');
    const cookieToken = crypto.randomBytes(32).toString('hex');
    const authUrl = buildGoogleAuthUrl(process.env.GOOGLE_CLIENT_ID, redirectUri, state);
    googleSessions.set(state, { redirectUri, cookieToken, createdAt: Date.now() });
    return { authUrl, state, cookieToken };
}

// Google usa representaciones distintas según el endpoint: booleano en OIDC
// userinfo, string "true" en tokeninfo. Aceptar ambas sin confundir "false".
function googleVerifiedFlag(value) {
    return value === true || String(value).trim().toLowerCase() === 'true';
}

async function handleGoogleCallback(code, state, cookieToken) {
    const sessionData = googleSessions.get(state);
    if (!sessionData) {
        return { error: 'Estado inválido o expirado' };
    }

    // Consumir el state ANTES de cualquier llamada de red: anti-replay.
    googleSessions.delete(state);

    if (Date.now() - sessionData.createdAt > GOOGLE_STATE_TTL_MS) {
        return { error: 'Estado expirado' };
    }
    // El state debe venir acompañado del nonce que pusimos en la cookie del
    // browser que inició el flujo; si no, es un login-CSRF.
    if (!cookieToken || cookieToken !== sessionData.cookieToken) {
        return { error: 'Estado inválido' };
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

        const email = String(userInfoResult.email || '').trim().toLowerCase();
        if (!email) {
            googleSessions.delete(state);
            return { error: 'No se pudo obtener el email de Google' };
        }

        // userinfo (OIDC) devuelve `email_verified` booleano; tokeninfo lo devuelve
        // como string. Se consulta una sola vez y sirve para nombre y verificación.
        let userInfo = {};
        try {
            userInfo = await new Promise((resolve, reject) => {
                https.get(`https://www.googleapis.com/oauth2/v2/userinfo?access_token=${encodeURIComponent(tokenResponse.access_token)}`, res => {
                    let body = '';
                    res.on('data', chunk => { body += chunk; });
                    res.on('end', () => {
                        try {
                            resolve(JSON.parse(body));
                        } catch (e) {
                            reject(new Error('Invalid userinfo response'));
                        }
                    });
                }).on('error', reject);
            });
        } catch (e) {
            console.warn('[GOOGLE AUTH] No se pudo obtener userinfo:', e.message);
        }
        const googleName = userInfo.name || '';

        const emailVerified = googleVerifiedFlag(userInfoResult.email_verified)
            || googleVerifiedFlag(userInfoResult.verified_email)
            || googleVerifiedFlag(userInfo.email_verified)
            || googleVerifiedFlag(userInfo.verified_email);
        if (!emailVerified) {
            googleSessions.delete(state);
            return { error: 'El email de Google no está verificado' };
        }
        if (!isGoogleEmailAllowed(email)) {
            return { error: 'Este email no está autorizado para ingresar' };
        }

        // Verificar si el usuario ya existe por email
        let dbUser = await findUserByEmail(email);

        if (!dbUser) {
            // Generar username único a partir del email
            const baseUsername = emailToUsername(email);
            const username = await uniqueUsername(baseUsername);

            // Crear usuario con password aleatorio (no usará password, solo Google OAuth)
            const randomPassword = crypto.randomBytes(16).toString('hex');
            const passwordHash = await hashPassword(randomPassword);

            const insertResult = await db.execute({
                sql: 'INSERT INTO users (username, password_hash, global_role, email, name, auth_provider) VALUES (?, ?, ?, ?, ?, ?)',
                args: [username, passwordHash, 'member', email, googleName || username, 'google'],
            });
            dbUser = { id: Number(insertResult.lastInsertRowid), username, name: googleName || username };

            // Auto-crear grupo personal "Mis gastos"
            const groupResult = await db.execute({
                sql: 'INSERT INTO groups (name, owner_id, base_currency) VALUES (?, ?, ?)',
                args: ['Mis gastos', dbUser.id, 'UYU']
            });
            const groupId = groupResult.lastInsertRowid;
            await db.execute({
                sql: 'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
                args: [groupId, dbUser.id, 'admin']
            });

            console.log(`[GOOGLE AUTH] Nuevo usuario creado: ${username} (id: ${dbUser.id}), grupo Mis gastos (ID: ${groupId})`);
        } else {
            // Actualizar nombre si no tiene
            if (!dbUser.name && googleName) {
                await db.execute('UPDATE users SET name = ? WHERE id = ?', [googleName, dbUser.id]);
            }
            dbUser.name = dbUser.name || googleName || dbUser.username;
            console.log(`[GOOGLE AUTH] Usuario existente: ${dbUser.username} (id: ${dbUser.id})`);
        }

        // Una cuenta dada de baja no puede reingresar ni por Google.
        if (await isUserDisabled(dbUser.id)) {
            googleSessions.delete(state);
            return { error: 'Esta cuenta no está habilitada para ingresar' };
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
        console.error('[GOOGLE AUTH] Error en callback:', err.message);
        return { error: 'No se pudo completar la autenticación con Google' };
    }
}

async function getUserGroups(userId) {
    try {
        const result = await db.execute(`
            SELECT g.*, gm.role as member_role,
                (SELECT GROUP_CONCAT(u.username, ', ')
                   FROM group_members gm2
                   JOIN users u ON u.id = gm2.user_id
                  WHERE gm2.group_id = g.id AND gm2.status = 'active') AS member_names
            FROM groups g
            JOIN group_members gm ON g.id = gm.group_id
            WHERE gm.user_id = ? AND gm.status = 'active'
            ORDER BY COALESCE(g.created_at, 0) ASC, g.id ASC
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
    isGoogleEmailAllowed,
    cleanGoogleSessions,
    findUser,
    verifyPassword,
    createSession,
    getSession,
    deleteSession,
    parseCookies,
    cleanExpiredSessions
};
