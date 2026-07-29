const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

const TEST_USER_ID = 998877661;

function resetUser() {
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(TEST_USER_ID);
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(TEST_USER_ID, 'Moderation Test');
}

test('userModerationService manages active, shadow_banned, and banned statuses', (t) => {
  resetUser();
  t.after(() => db.prepare('DELETE FROM users WHERE telegram_id = ?').run(TEST_USER_ID));

  const service = require('../../src/services/userModerationService');

  assert.deepStrictEqual(service.STATUSES, ['active', 'shadow_banned', 'banned']);
  assert.strictEqual(service.normalizeStatus(undefined), 'active');
  assert.throws(() => service.normalizeStatus('muted'), /INVALID_STATUS/);
  assert.strictEqual(service.getStatus(TEST_USER_ID).accountStatus, 'active');
  assert.strictEqual(service.isBanned(TEST_USER_ID), false);
  assert.strictEqual(service.isShadowBanned(TEST_USER_ID), false);

  const shadow = service.setStatus(TEST_USER_ID, 'shadow_banned', {
    reason: 'manual review',
    adminId: 1,
  });
  assert.strictEqual(shadow.accountStatus, 'shadow_banned');
  assert.strictEqual(service.isShadowBanned(TEST_USER_ID), true);
  assert.strictEqual(service.isBanned(TEST_USER_ID), false);
  assert.strictEqual(shadow.banReason, 'manual review');
  assert.strictEqual(shadow.bannedBy, 1);
  assert.ok(shadow.bannedAt);

  const banned = service.setStatus(TEST_USER_ID, 'banned', {
    reason: 'abuse',
    adminId: 2,
  });
  assert.strictEqual(banned.accountStatus, 'banned');
  assert.strictEqual(service.isBanned(TEST_USER_ID), true);
  assert.strictEqual(banned.banReason, 'abuse');
  assert.strictEqual(banned.bannedBy, 2);

  const active = service.setStatus(TEST_USER_ID, 'active', {
    reason: 'clear',
    adminId: 3,
  });
  assert.strictEqual(active.accountStatus, 'active');
  assert.strictEqual(active.banReason, null);
  assert.strictEqual(active.bannedAt, null);
  assert.strictEqual(active.bannedBy, null);
});
