const crypto = require('crypto');

const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 horas

const USERS = {
    tin: { password: process.env.AUTH_TIN, payer: 'me' },
    noe: { password: process.env.AUTH_NOE, payer: 'partner' }
};

// Validar que las contraseñas estén configuradas
Object.entries(USERS).forEach(([name, user]) => {
    if (!user.password) {
        console.error(`[AUTH] Falta AUTH_${name.toUpperCase()} en variables de entorno`);
    }
});

const sessions = new Map();

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

function cleanExpiredSessions() {
    const now = Date.now();
    for (const [token, session] of sessions) {
        if (now - session.createdAt > SESSION_TTL) {
            sessions.delete(token);
        }
    }
}

function authMiddleware(req, res, next) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies['session_token'];

    if (!token || !sessions.has(token)) {
        return res.status(401).json({ error: 'No autenticado' });
    }

    const session = sessions.get(token);
    if (Date.now() - session.createdAt > SESSION_TTL) {
        sessions.delete(token);
        return res.status(401).json({ error: 'Sesión expirada' });
    }

    req.user = { username: session.username, payer: session.payer };
    next();
}

function login(username, password) {
    const user = USERS[username];
    console.log(`[AUTH login] username="${username}" password="${password}"`);
    console.log(`[AUTH login] USERS[username] =`, user);
    console.log(`[AUTH login] user.password="${user?.password}"`);
    console.log(`[AUTH login] match: ${user?.password === password}`);
    if (!user || !user.password || user.password !== password) {
        console.log(`[AUTH login] FALLO: user=${!!user}, pass=${!!user?.password}, match=${user?.password === password}`);
        return null;
    }

    cleanExpiredSessions();

    const token = generateToken();
    sessions.set(token, { username, payer: user.payer, createdAt: Date.now() });
    return token;
}

function logout(token) {
    sessions.delete(token);
}

function getUser(token) {
    const session = sessions.get(token);
    if (!session) return null;
    if (Date.now() - session.createdAt > SESSION_TTL) {
        sessions.delete(token);
        return null;
    }
    return { username: session.username, payer: session.payer };
}

module.exports = { authMiddleware, login, logout, getUser };
