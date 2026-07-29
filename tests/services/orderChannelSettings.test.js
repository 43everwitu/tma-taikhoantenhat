const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

function freshService() {
  delete require.cache[require.resolve('../../src/services/orderChannelService')];
  return require('../../src/services/orderChannelService');
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

test('order channel uses order_channel settings instead of low_stock settings', async (t) => {
  const oldEnv = {
    ORDER_CHANNEL_CHAT_ID: process.env.ORDER_CHANNEL_CHAT_ID,
    ORDER_CHANNEL_THREAD_ID: process.env.ORDER_CHANNEL_THREAD_ID,
    BOT_TOKEN: process.env.BOT_TOKEN,
  };
  const oldRows = db.prepare(`
    SELECT key, value FROM settings
    WHERE key IN (
      'order_channel_chat_id',
      'order_channel_thread_id'
    )
  `).all();

  t.after(() => {
    for (const key of Object.keys(oldEnv)) {
      if (oldEnv[key] === undefined) delete process.env[key];
      else process.env[key] = oldEnv[key];
    }
    db.prepare(`
      DELETE FROM settings
      WHERE key IN (
        'order_channel_chat_id',
        'order_channel_thread_id'
      )
    `).run();
    const ins = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    for (const row of oldRows) ins.run(row.key, row.value);
  });

  process.env.ORDER_CHANNEL_CHAT_ID = '-100env';
  process.env.ORDER_CHANNEL_THREAD_ID = '9';
  process.env.BOT_TOKEN = 'test-token';
  setSetting('order_channel_chat_id', '-100order');
  setSetting('order_channel_thread_id', '7');

  const svc = freshService();
  const target = svc.resolveOrderChannelTarget();
  assert.deepStrictEqual(target, { chatId: '-100order', threadId: 7 });

  const calls = [];
  svc.setTelegramRequestForTest(async (method, payload) => {
    calls.push({ method, payload });
    return { message_id: 321 };
  });

  await svc.postOrderCard({
    order: {
      id: 100603,
      payment_code: 'PNS100603',
      quantity: 1,
      total_price: 450260,
      input_value: null,
    },
    product: { id: 55, name: 'Tài Khoản Claude Pro/Claude Max' },
    variant: { id: 1, name: 'Claude Pro' },
    keys: null,
  });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].method, 'sendMessage');
  assert.strictEqual(calls[0].payload.chat_id, '-100order');
  assert.strictEqual(calls[0].payload.message_thread_id, 7);
});

test('order channel falls back to ORDER_CHANNEL env when settings are empty', (t) => {
  const oldEnv = {
    ORDER_CHANNEL_CHAT_ID: process.env.ORDER_CHANNEL_CHAT_ID,
    ORDER_CHANNEL_THREAD_ID: process.env.ORDER_CHANNEL_THREAD_ID,
  };
  t.after(() => {
    for (const key of Object.keys(oldEnv)) {
      if (oldEnv[key] === undefined) delete process.env[key];
      else process.env[key] = oldEnv[key];
    }
  });

  process.env.ORDER_CHANNEL_CHAT_ID = '-100env';
  process.env.ORDER_CHANNEL_THREAD_ID = '9';
  setSetting('order_channel_chat_id', '');
  setSetting('order_channel_thread_id', '');

  const svc = freshService();
  assert.deepStrictEqual(svc.resolveOrderChannelTarget(), { chatId: '-100env', threadId: 9 });
});
