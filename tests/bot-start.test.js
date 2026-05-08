const test = require('node:test');
const assert = require('node:assert');

// Test the handler function in isolation.
// The module exports a default registration function and a named `handleStart` for testing.
const startCommand = require('../src/commands/start');

// Stub the userService.findOrCreate to avoid touching the DB during this unit test.
// We replace it via require-cache injection.
const userServicePath = require.resolve('../src/services/userService');
require.cache[userServicePath] = {
  id: userServicePath,
  filename: userServicePath,
  loaded: true,
  exports: {
    findOrCreate: (from) => ({
      id: 1,
      telegram_id: from?.id ?? 0,
      full_name: from?.first_name ?? '',
      username: from?.username ?? '',
      balance: 0,
    }),
  },
};

// Re-require start.js after the cache injection so it sees the stub
delete require.cache[require.resolve('../src/commands/start')];
const { handleStart } = require('../src/commands/start');

test('/start replies with Vietnamese Taikhoantenhat greeting and Mini App button', async () => {
  process.env.MINIAPP_URL = 'https://taikhoantenhat.example.com/';

  const sent = [];
  const ctx = {
    from: { first_name: 'Khoa', username: 'khoa', id: 12345 },
    reply: async (text, extra) => { sent.push({ text, extra }); }
  };

  await handleStart(ctx);

  assert.strictEqual(sent.length, 1, 'expected one reply');
  assert.match(sent[0].text, /Taikhoantenhat/);
  assert.doesNotMatch(sent[0].text, /Starizzi/i);
  assert.doesNotMatch(sent[0].text, /auto.?chan/i);

  const buttons = sent[0].extra?.reply_markup?.inline_keyboard ?? [];
  assert.strictEqual(buttons.length, 1, 'expected one keyboard row');
  assert.strictEqual(buttons[0].length, 1, 'expected one button in row');
  assert.strictEqual(buttons[0][0].text, 'Mở cửa hàng');
  assert.strictEqual(buttons[0][0].web_app.url, 'https://taikhoantenhat.example.com/');
});
