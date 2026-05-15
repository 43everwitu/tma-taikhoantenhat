const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

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

test('low_stock falls back to ADMIN_ID when low_stock_chat_id empty', async () => {
  clearLowStockSettings();
  const sent = [];
  const svc = freshService(makeFakeBot(sent));
  await svc.notify('low_stock', 'body', { parse_mode: 'HTML' });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].chatId, require('../../src/config').ADMIN_ID);
  assert.strictEqual(sent[0].opts.message_thread_id, undefined);
});

test('low_stock routes to configured chat + thread when set', async () => {
  clearLowStockSettings();
  db.prepare("UPDATE settings SET value='-1003865156744' WHERE key='low_stock_chat_id'").run();
  db.prepare("UPDATE settings SET value='2' WHERE key='low_stock_thread_id'").run();
  const sent = [];
  const svc = freshService(makeFakeBot(sent));
  await svc.notify('low_stock', 'body', { parse_mode: 'HTML' });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(String(sent[0].chatId), '-1003865156744');
  assert.strictEqual(sent[0].opts.message_thread_id, 2);
});

test('cleanup', () => { clearLowStockSettings(); });
