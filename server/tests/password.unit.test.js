const { validatePassword, MIN_PASSWORD_LENGTH } = require('../password');

describe('validatePassword', () => {
    test('acepta 8 caracteres con letra, número y símbolo', () => {
        expect(validatePassword('Abcdef1!')).toBeNull();
    });

    test('acepta letras acentuadas y símbolos variados', () => {
        expect(validatePassword('Contraseña1!')).toBeNull();
        expect(validatePassword('MiClave#27')).toBeNull();
    });

    test('rechaza menos de 8 caracteres', () => {
        expect(MIN_PASSWORD_LENGTH).toBe(8);
        expect(validatePassword('Abc1!'))
            .toBe('La contraseña debe tener al menos 8 caracteres');
    });

    test('rechaza si falta letra, número o símbolo', () => {
        const esperado = 'La contraseña debe incluir al menos una letra, un número y un símbolo';
        expect(validatePassword('1234567!')).toBe(esperado);
        expect(validatePassword('Abcdefg!')).toBe(esperado);
        expect(validatePassword('Abcdef12')).toBe(esperado);
    });

    test('un espacio no cuenta como símbolo', () => {
        expect(validatePassword('Abcdef1 '))
            .toBe('La contraseña debe incluir al menos una letra, un número y un símbolo');
    });

    test('rechaza vacío', () => {
        expect(validatePassword('')).toBe('La contraseña debe tener al menos 8 caracteres');
        expect(validatePassword(undefined)).toBe('La contraseña debe tener al menos 8 caracteres');
    });
});
