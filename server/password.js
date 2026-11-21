const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

// Legacy: hash casero sin salt que usaban las versiones anteriores.
// Solo se mantiene para poder verificar (y migrar) contraseñas ya guardadas.
function simpleHash(text) {
    let hash = 0;
    for (let i = 0; i < String(text).length; i++) {
        const ch = String(text).charCodeAt(i);
        hash = ((hash << 5) - hash) + ch;
        hash = hash & hash;
    }
    return `simple:${Math.abs(hash).toString(16)}`;
}

function simpleHashVerify(input, stored) {
    if (!stored) return false;
    return stored === simpleHash(input);
}

async function hashPassword(plain) {
    return bcrypt.hash(String(plain), SALT_ROUNDS);
}

// Verifica contra bcrypt ($2a/$2b/$2y) o contra el legacy 'simple:'.
async function verifyValue(plain, stored) {
    if (!stored) return false;
    if (stored.startsWith('simple:')) {
        return simpleHashVerify(plain, stored);
    }
    if (stored.startsWith('$2')) {
        try {
            return await bcrypt.compare(String(plain), stored);
        } catch {
            return false;
        }
    }
    return false;
}

// Un hash legacy debe re-hashearse apenas el usuario inicie sesión.
function needsRehash(stored) {
    return Boolean(stored && stored.startsWith('simple:'));
}

module.exports = { hashPassword, verifyValue, needsRehash, simpleHash, SALT_ROUNDS };
