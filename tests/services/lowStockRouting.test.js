const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const telegramApiClient = require('../../src/services/telegramApiClient');

function clearLowStockSettings() {
  db.prepare("DELETE FROM settings WHERE key IN ('low_stock_chat_id','low_stock_thread_id')").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_chat_id',''),('low_stock_thread_id','')").run();
  db.prepare("INSERT INTO settings (key,value) VALUES ('notify_admin_low_stock','true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
}

function makeFakeBot(sent) {
  return { telegram: { sendMessage: async (chatId, msg, opts) => { sent.push({ chatId, msg, opts }); } } };
}

function freshService(fakeBot) {
  delete require.cache[require.resolve('../../src/services/adminNotifyService')];
  const svc = require('../../src/services/adminNotifyService');
  svc.init(fakeBot);
  svc.invalidateCache();
  return svc;
}

test('low_stock falls back to default channel when low_stock_chat_id empty', async (t) => {
  t.after(() => telegramApiClient.setTelegramRequestForTest(null));
  clearLowStockSettings();
  const sent = [];
  telegramApiClient.setTelegramRequestForTest(async (method, payload) => {
    sent.push({ method, payload });
    return { message_id: 1 };
  });
  const svc = freshService(makeFakeBot(sent));
  const delivered = await svc.notify('low_stock', 'body', { parse_mode: 'HTML' });
  assert.strictEqual(delivered, true);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].method, 'sendMessage');
  assert.strictEqual(String(sent[0].payload.chat_id), '-1003865156744');
  assert.strictEqual(sent[0].payload.message_thread_id, 2);
});

test('low_stock routes to configured chat + thread when set', async (t) => {
  t.after(() => telegramApiClient.setTelegramRequestForTest(null));
  clearLowStockSettings();
  db.prepare("UPDATE settings SET value='-1003865156744' WHERE key='low_stock_chat_id'").run();
  db.prepare("UPDATE settings SET value='2' WHERE key='low_stock_thread_id'").run();
  const sent = [];
  telegramApiClient.setTelegramRequestForTest(async (method, payload) => {
    sent.push({ method, payload });
    return { message_id: 1 };
  });
  const svc = freshService(makeFakeBot(sent));
  const delivered = await svc.notify('low_stock', 'body', { parse_mode: 'HTML' });
  assert.strictEqual(delivered, true);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].method, 'sendMessage');
  assert.strictEqual(String(sent[0].payload.chat_id), '-1003865156744');
  assert.strictEqual(sent[0].payload.message_thread_id, 2);
});

test('low_stock returns false when Telegram delivery fails', async (t) => {
  t.after(() => telegramApiClient.setTelegramRequestForTest(null));
  clearLowStockSettings();
  telegramApiClient.setTelegramRequestForTest(async () => {
    throw new Error('telegram unavailable');
  });
  const svc = freshService({
    telegram: {
      async sendMessage() {
        throw new Error('telegram unavailable');
      },
    },
  });

  assert.strictEqual(await svc.notify('low_stock', 'body'), false);
});

test('cleanup', () => { clearLowStockSettings(); });
