const assert = require('node:assert');
const test = require('node:test');
const bcrypt = require('bcrypt');
const db = require('../../src/database');

const TEST_PASSWORD = 'admin-expiry-password';

async function createAdmin(username, overrides = {}) {
  db.prepare('DELETE FROM admins WHERE username = ?').run(username);
  db.prepare("INSERT INTO settings (key, value) VALUES ('require_2fa_all', 'false') ON CONFLICT(key) DO UPDATE SET value='false'").run();
  const hash = await bcrypt.hash(TEST_PASSWORD, 4);
  db.prepare(`
    INSERT INTO admins (username, password_hash, display_name, role, is_active, totp_enabled, totp_required)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `).run(
    username,
    hash,
    username,
    overrides.role || 'admin',
    overrides.totpEnabled ? 1 : 0,
    overrides.totpRequired ? 1 : 0,
  );
}

async function decodeToken(token) {
  const { decodeJwt } = await import('jose');
  return decodeJwt(token);
}

function reloadAuthService(expiry) {
  if (expiry === undefined) delete process.env.ADMIN_TOKEN_EXPIRY;
  else process.env.ADMIN_TOKEN_EXPIRY = expiry;
  process.env.JWT_SECRET = 'test-secret-for-admin-expiry-tests-must-be-long';

  delete require.cache[require.resolve('../../src/config')];
  delete require.cache[require.resolve('../../src/services/twofaPolicy')];
  delete require.cache[require.resolve('../../src/services/authService')];
  return require('../../src/services/authService');
}

test('full admin token defaults to 30 days', async () => {
  const authService = reloadAuthService(undefined);
  const token = await authService.issueFullAdminToken({ id: -9001, role: 'admin', username: 'expiry-default' });
  const payload = await decodeToken(token);

  assert.strictEqual(payload.exp - payload.iat, 30 * 24 * 60 * 60);
});

test('full admin token uses ADMIN_TOKEN_EXPIRY from env', async () => {
  const authService = reloadAuthService('7d');
  const token = await authService.issueFullAdminToken({ id: -9002, role: 'admin', username: 'expiry-custom' });
  const payload = await decodeToken(token);

  assert.strictEqual(payload.exp - payload.iat, 7 * 24 * 60 * 60);
});

test('password login full admin token defaults to 30 days', async () => {
  const username = 'expiry-login-default';
  await createAdmin(username);
  const authService = reloadAuthService(undefined);

  const result = await authService.adminLogin(username, TEST_PASSWORD);
  const payload = await decodeToken(result.token);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.requires2fa, undefined);
  assert.strictEqual(result.requiresEnroll, undefined);
  assert.strictEqual(payload.exp - payload.iat, 30 * 24 * 60 * 60);
});

test('2FA challenge token remains 5 minutes', async () => {
  const username = 'expiry-login-2fa';
  await createAdmin(username, { totpEnabled: true });
  const authService = reloadAuthService(undefined);

  const result = await authService.adminLogin(username, TEST_PASSWORD);
  const payload = await decodeToken(result.challengeToken);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.requires2fa, true);
  assert.strictEqual(payload.exp - payload.iat, 5 * 60);
});

test('2FA enroll token remains 15 minutes', async () => {
  const username = 'expiry-login-enroll';
  await createAdmin(username, { role: 'super_admin' });
  const authService = reloadAuthService(undefined);

  const result = await authService.adminLogin(username, TEST_PASSWORD);
  const payload = await decodeToken(result.enrollToken);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.requiresEnroll, true);
  assert.strictEqual(payload.exp - payload.iat, 15 * 60);
});
