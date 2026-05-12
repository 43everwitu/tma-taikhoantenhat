const test = require('node:test');
const assert = require('node:assert');

process.env.ENCRYPTION_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

const { encryptString, decryptString } = require('../../src/utils/secrets');

test('round-trips a string', () => {
  assert.equal(decryptString(encryptString('hello@example.com')), 'hello@example.com');
});

test('returns null for null/empty', () => {
  assert.equal(encryptString(null), null);
  assert.equal(encryptString(''), null);
  assert.equal(decryptString(null), null);
});

test('ciphertext differs across calls (random IV)', () => {
  const a = encryptString('same');
  const b = encryptString('same');
  assert.notEqual(a, b);
  assert.equal(decryptString(a), 'same');
  assert.equal(decryptString(b), 'same');
});

test('decrypt fails on tampered ciphertext', () => {
  const ct = encryptString('secret');
  const tampered = Buffer.from(ct, 'base64');
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptString(tampered.toString('base64')));
});
