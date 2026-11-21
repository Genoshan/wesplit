const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

// Política vigente: al menos 8 caracteres, con letra, número y un carácter
// distinto (no alfanumérico y no espacio). Se valida en registro y en el
// cambio de contraseña del perfil; el servidor es la única fuente de verdad.
function validatePassword(plain) {
    const value = String(plain || '');
    if (value.length < MIN_PASSWORD_LENGTH) {
        return 'La contraseña debe tener al menos 8 caracteres';
    }
    if (!/\p{L}/u.test(value) || !/\p{N}/u.test(value) || !/[^\p{L}\p{N}\s]/u.test(value)) {
        return 'La contraseña debe incluir al menos una letra, un número y un símbolo';
    }
    return null;
}

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

module.exports = { hashPassword, verifyValue, needsRehash, simpleHash, SALT_ROUNDS, MIN_PASSWORD_LENGTH, validatePassword };
