const crypto = require('crypto');

const USERS = {
    tin: { password: process.env.AUTH_TIN || 'tin123', payer: 'me' },
    noe: { password: process.env.AUTH_NOE || 'noe123', payer: 'partner' }
};

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

function authMiddleware(req, res, next) {
    if (req.path === '/api/login') return next();

    const cookies = parseCookies(req.headers.cookie);
    const token = cookies['session_token'];

    if (!token || !sessions.has(token)) {
        return res.status(401).json({ error: 'No autenticado' });
    }

    req.user = sessions.get(token);
    next();
}

function login(username, password) {
    const user = USERS[username];
    if (!user || user.password !== password) return null;

    const token = generateToken();
    sessions.set(token, { username, payer: user.payer });
    return token;
}

function logout(token) {
    sessions.delete(token);
}

function getUser(token) {
    return sessions.get(token) || null;
}

module.exports = { authMiddleware, login, logout, getUser };
