const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const { NotificationService } = require('../../src/services/notificationService');
const telegramApiClient = require('../../src/services/telegramApiClient');

function createBot() {
  const calls = [];
  return {
    calls,
    telegram: {
      async sendMessage(chatId, body, extra) {
        calls.push({ kind: 'message', chatId, body, extra });
      },
      async sendPhoto(chatId, photo, extra) {
        calls.push({ kind: 'photo', chatId, photo, extra });
      },
    },
  };
}

test('broadcast with image sends Telegram photo and text-only web notification', async (t) => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userTg = 991_000_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)').run(userTg, `ann_user_${suffix}`, 'Ann User');
  t.after(() => {
    db.prepare('DELETE FROM announcements WHERE title = ?').run(`Ảnh ${suffix}`);
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userTg);
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(userTg);
  });

  const bot = createBot();
  const service = new NotificationService(bot);
  const result = await service.broadcast(`Ảnh ${suffix}`, '<b>Nội dung</b>', 'all', 1, undefined, {
    imageUrl: 'https://example.com/announcement.png',
  });

  assert.ok(result.sent >= 1);
  const call = bot.calls.find((item) => item.chatId === userTg);
  assert.ok(call, 'expected Telegram call for seeded user');
  assert.strictEqual(call.kind, 'photo');
  assert.strictEqual(call.photo, 'https://example.com/announcement.png');
  assert.strictEqual(call.extra.caption, '<b>Nội dung</b>');

  const notification = db.prepare('SELECT body FROM notifications WHERE user_id = ? ORDER BY id DESC').get(userTg);
  assert.strictEqual(notification.body, '<b>Nội dung</b>');

  const announcement = db.prepare('SELECT image_url FROM announcements WHERE id = ?').get(result.announcementId);
  assert.strictEqual(announcement.image_url, 'https://example.com/announcement.png');
});

test('broadcast sends Telegram-ready HTML while keeping web rich HTML', async (t) => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userTg = 992_000_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)').run(userTg, `ann_html_${suffix}`, 'Ann Html');
  const sent = [];
  telegramApiClient.setTelegramRequestForTest(async (method, payload) => {
    sent.push({ chatId: payload.chat_id, body: payload.text });
    return { message_id: sent.length };
  });
  t.after(() => {
    telegramApiClient.setTelegramRequestForTest(null);
    db.prepare('DELETE FROM announcements WHERE title = ?').run(`HTML ${suffix}`);
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userTg);
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(userTg);
  });

  const bot = createBot();
  const service = new NotificationService(bot);
  await service.broadcast(`HTML ${suffix}`, '<b>99K</b><br><s>149K</s>', 'all', 1);

  const call = sent.find((item) => item.chatId === userTg);
  assert.ok(call, 'expected Telegram call for seeded user');
  assert.strictEqual(call.body, '<b>99K</b>\n<s>149K</s>');

  const notification = db.prepare('SELECT body FROM notifications WHERE user_id = ? ORDER BY id DESC').get(userTg);
  assert.strictEqual(notification.body, '<b>99K</b><br><s>149K</s>');
});
