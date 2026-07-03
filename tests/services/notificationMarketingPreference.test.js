const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const { NotificationService, sendDelivery } = require('../../src/services/notificationService');
const telegramApiClient = require('../../src/services/telegramApiClient');
const userNotificationPreferenceService = require('../../src/services/userNotificationPreferenceService');

function seedUser({ disabled = false } = {}) {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const telegramId = 872_100_000 + Math.floor(Math.random() * 100000);
  const notificationPrefs = disabled ? JSON.stringify({ telegramMarketingEnabled: false }) : '{}';
  db.prepare(`
    INSERT INTO users (telegram_id, username, full_name, notification_prefs)
    VALUES (?, ?, ?, ?)
  `).run(telegramId, `marketing_${suffix}`, `Marketing ${suffix}`, notificationPrefs);
  return { telegramId, suffix };
}

function cleanupUser(telegramId) {
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(telegramId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(telegramId);
}

test('broadcast skips Telegram for disabled marketing user but still creates web notification', async (t) => {
  const disabled = seedUser({ disabled: true });
  const enabled = seedUser({ disabled: false });
  const title = `Marketing pref ${disabled.telegramId}`;
  const calls = [];
  const originalIsTelegramMarketingEnabled = userNotificationPreferenceService.isTelegramMarketingEnabled;
  telegramApiClient.setTelegramRequestForTest(async (method, payload) => {
    calls.push({ method, payload });
    return { message_id: calls.length };
  });
  userNotificationPreferenceService.isTelegramMarketingEnabled = (rowOrTelegramId) => {
    const telegramId = typeof rowOrTelegramId === 'object' ? rowOrTelegramId.telegram_id : rowOrTelegramId;
    if (telegramId === disabled.telegramId || telegramId === enabled.telegramId) {
      return originalIsTelegramMarketingEnabled(rowOrTelegramId);
    }
    return false;
  };
  t.after(() => {
    telegramApiClient.setTelegramRequestForTest(null);
    userNotificationPreferenceService.isTelegramMarketingEnabled = originalIsTelegramMarketingEnabled;
    db.prepare('DELETE FROM notifications WHERE title = ?').run(title);
    db.prepare('DELETE FROM announcements WHERE title = ?').run(title);
    cleanupUser(disabled.telegramId);
    cleanupUser(enabled.telegramId);
  });

  const service = new NotificationService({ telegram: {} });
  const result = await service.broadcast(title, '<b>Sale</b>', 'all', 1);

  assert.ok(calls.some((call) => call.payload.chat_id === enabled.telegramId));
  assert.ok(!calls.some((call) => call.payload.chat_id === disabled.telegramId));
  assert.ok(result.skippedByPreference >= 1);
  assert.strictEqual(result.failed, 0);

  const notification = db.prepare('SELECT body FROM notifications WHERE user_id = ? ORDER BY id DESC').get(disabled.telegramId);
  assert.strictEqual(notification.body, '<b>Sale</b>');
});

test('notify marketing telegram channel skips disabled user without creating web notification', async (t) => {
  const disabled = seedUser({ disabled: true });
  const calls = [];
  telegramApiClient.setTelegramRequestForTest(async (method, payload) => {
    calls.push({ method, payload });
    return { message_id: calls.length };
  });
  t.after(() => {
    telegramApiClient.setTelegramRequestForTest(null);
    cleanupUser(disabled.telegramId);
  });

  const service = new NotificationService({ telegram: {} });
  const result = await service.notify(
    disabled.telegramId,
    'stock_alert',
    'Sản phẩm có hàng',
    '<b>Có hàng</b>',
    {},
    'telegram',
  );

  assert.deepStrictEqual(calls, []);
  assert.strictEqual(result.sentTelegram, 0);
  assert.strictEqual(result.sentWeb, 0);
  assert.strictEqual(result.skippedByPreference, 1);
});

test('sendDelivery still sends order keys when user disabled marketing notifications', async (t) => {
  const disabled = seedUser({ disabled: true });
  const calls = [];
  telegramApiClient.setTelegramRequestForTest(async (method, payload) => {
    calls.push({ method, payload });
    return { message_id: calls.length };
  });
  t.after(() => {
    telegramApiClient.setTelegramRequestForTest(null);
    cleanupUser(disabled.telegramId);
  });

  await sendDelivery(
    { telegram: { async deleteMessage() {} } },
    {
      id: 123456,
      user_id: disabled.telegramId,
      product_id: 0,
      product_name: 'Sản phẩm test',
      quantity: 1,
    },
    ['email@example.com|pass'],
    { usageInstructions: '' },
  );

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].method, 'sendMessage');
  assert.strictEqual(calls[0].payload.chat_id, disabled.telegramId);
});
