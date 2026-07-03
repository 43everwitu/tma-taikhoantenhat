const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const prefs = require('../../src/services/userNotificationPreferenceService');

function seedUser(overrides = {}) {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const telegramId = 870_100_000 + Math.floor(Math.random() * 100000);
  db.prepare(`
    INSERT INTO users (telegram_id, username, full_name, notification_prefs)
    VALUES (?, ?, ?, ?)
  `).run(
    telegramId,
    `pref_${suffix}`,
    `Pref ${suffix}`,
    overrides.notificationPrefs === undefined ? '{}' : overrides.notificationPrefs,
  );
  return telegramId;
}

function cleanup(telegramId) {
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(telegramId);
}

test('telegram marketing preference defaults to enabled when key is missing', (t) => {
  const telegramId = seedUser();
  t.after(() => cleanup(telegramId));

  assert.strictEqual(prefs.isTelegramMarketingEnabled(telegramId), true);
});

test('setTelegramMarketingEnabled toggles value and preserves existing JSON keys', (t) => {
  const telegramId = seedUser({
    notificationPrefs: JSON.stringify({ linkCode: '123456', resetCode: '654321' }),
  });
  t.after(() => cleanup(telegramId));

  prefs.setTelegramMarketingEnabled(telegramId, false);
  assert.strictEqual(prefs.isTelegramMarketingEnabled(telegramId), false);

  let row = db.prepare('SELECT notification_prefs FROM users WHERE telegram_id = ?').get(telegramId);
  let parsed = JSON.parse(row.notification_prefs);
  assert.strictEqual(parsed.linkCode, '123456');
  assert.strictEqual(parsed.resetCode, '654321');
  assert.strictEqual(parsed.telegramMarketingEnabled, false);

  prefs.setTelegramMarketingEnabled(telegramId, true);
  assert.strictEqual(prefs.isTelegramMarketingEnabled(telegramId), true);

  row = db.prepare('SELECT notification_prefs FROM users WHERE telegram_id = ?').get(telegramId);
  parsed = JSON.parse(row.notification_prefs);
  assert.strictEqual(parsed.linkCode, '123456');
  assert.strictEqual(parsed.telegramMarketingEnabled, true);
});

test('invalid notification_prefs JSON is treated as empty preferences', (t) => {
  const telegramId = seedUser({ notificationPrefs: '{not-json' });
  t.after(() => cleanup(telegramId));

  assert.strictEqual(prefs.isTelegramMarketingEnabled(telegramId), true);
  prefs.setTelegramMarketingEnabled(telegramId, false);

  const row = db.prepare('SELECT notification_prefs FROM users WHERE telegram_id = ?').get(telegramId);
  assert.deepStrictEqual(JSON.parse(row.notification_prefs), { telegramMarketingEnabled: false });
});
