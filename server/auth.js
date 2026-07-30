const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 horas
const GOOGLE_STATE_TTL = 10 * 60 * 1000; // 10 minutos

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

// Google OAuth state store
const googleSessions = new Map();

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

// Google OAuth functions

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

function getGoogleRedirectUri() {
    if (process.env.GOOGLE_REDIRECT_URI) {
        return process.env.GOOGLE_REDIRECT_URI;
    }
    const port = process.env.PORT || 4000;
    const host = process.env.NODE_ENV === 'production'
        ? `https://wesplit.genoshan.com`
        : `http://localhost:${port}`;
    return `${host}/api/google/callback`;
}

function cleanGoogleSessions() {
    const now = Date.now();
    for (const [state, session] of googleSessions) {
        if (now - session.createdAt > GOOGLE_STATE_TTL) {
            googleSessions.delete(state);
        }
    }
}

function getAuthorizedEmails() {
    const emails = process.env.GOOGLE_AUTHORIZED_EMAILS;
    if (!emails) return new Set();
    return new Set(emails.split(',').map(e => e.trim().toLowerCase()));
}

function mapEmailToUser(email) {
    const authorizedEmails = getAuthorizedEmails();
    if (!authorizedEmails.has(email.toLowerCase())) {
        return null;
    }

    const emailMap = {
        'tin@wesplit.local': { username: 'tin', payer: 'me' },
        'noe@wesplit.local': { username: 'noe', payer: 'partner' }
    };

    return emailMap[email.toLowerCase()] || null;
}

function initGoogleAuth() {
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
    const redirectUri = getGoogleRedirectUri();
    const authUrl = buildGoogleAuthUrl(process.env.GOOGLE_CLIENT_ID, redirectUri, state);
    googleSessions.set(state, { redirectUri, createdAt: Date.now() });
    return { authUrl, state };
}

function handleGoogleCallback(code, state) {
    const sessionData = googleSessions.get(state);
    if (!sessionData) {
        return { error: 'Estado invalido o expirado' };
    }

    cleanGoogleSessions();

    return exchangeCodeForToken(code, sessionData.redirectUri)
        .then(tokenResponse => {
            return new Promise((resolve, reject) => {
                https.get(`https://www.googleapis.com/oauth2/v2/tokeninfo?access_token=${encodeURIComponent(tokenResponse.access_token)}`, res => {
                    let body = '';
                    res.on('data', chunk => { body += chunk; });
                    res.on('end', async () => {
                        try {
                            const userInfo = JSON.parse(body);
                            const user = mapEmailToUser(userInfo.email);
                            if (!user) {
                                return resolve({ error: 'Email no autorizado para acceder a la aplicacion' });
                            }

                            const token = generateToken();
                            sessions.set(token, { username: user.username, payer: user.payer, createdAt: Date.now() });
                            googleSessions.delete(state);
                            resolve({ token, user: user.username, payer: user.payer });
                        } catch (e) {
                            reject(new Error('Invalid user info response'));
                        }
                    });
                }).on('error', reject);
            });
        })
        .catch(err => ({ error: err.message || 'Error al autenticar con Google' }));
}

module.exports = { authMiddleware, login, logout, getUser, initGoogleAuth, handleGoogleCallback, cleanGoogleSessions };
