const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const twofaPolicy = require('../../src/services/twofaPolicy');

function setGlobal(value) {
  db.prepare("INSERT INTO settings (key,value) VALUES ('require_2fa_all', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(value);
  twofaPolicy.invalidateCache();
}

test('isEnrollmentRequired: global force on + admin without totp → true', () => {
  setGlobal('true');
  assert.strictEqual(
    twofaPolicy.isEnrollmentRequired({ role: 'manager', totp_enabled: 0, totp_required: 0 }),
    true,
  );
});

test('isEnrollmentRequired: enrolled admin never re-enrolls', () => {
  setGlobal('true');
  assert.strictEqual(
    twofaPolicy.isEnrollmentRequired({ role: 'super_admin', totp_enabled: 1, totp_required: 1 }),
    false,
  );
});

test('isEnrollmentRequired: global off, no per-row required → false', () => {
  setGlobal('false');
  assert.strictEqual(
    twofaPolicy.isEnrollmentRequired({ role: 'admin', totp_enabled: 0, totp_required: 0 }),
    false,
  );
});

test('isEnrollmentRequired: super_admin always required regardless of global', () => {
  setGlobal('false');
  assert.strictEqual(
    twofaPolicy.isEnrollmentRequired({ role: 'super_admin', totp_enabled: 0, totp_required: 0 }),
    true,
  );
});

test('isRequired: returns true when global force on for non-enrolled', () => {
  setGlobal('true');
  assert.strictEqual(twofaPolicy.isRequired({ role: 'manager', totp_required: 0 }), true);
  setGlobal('false');
  assert.strictEqual(twofaPolicy.isRequired({ role: 'manager', totp_required: 0 }), false);
});

test('cleanup', () => { setGlobal('false'); });
