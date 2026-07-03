const test = require('node:test');
const assert = require('node:assert');

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

const templatePath = require.resolve('../src/services/messageTemplateService');
require.cache[templatePath] = {
  id: templatePath,
  filename: templatePath,
  loaded: true,
  exports: {
    renderIfEnabled: () => 'Xin chào Taikhoantenhat',
  },
};

const dbPath = require.resolve('../src/database');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    prepare: () => ({
      get: () => ({ value: '@admin' }),
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
  assert.strictEqual(buttons.length, 2, 'expected two keyboard rows');
  assert.strictEqual(buttons[0].length, 1, 'expected one button in row 1');
  assert.strictEqual(buttons[1].length, 1, 'expected one button in row 2');
  assert.strictEqual(buttons[0][0].text, 'Mở cửa hàng');
  assert.strictEqual(buttons[0][0].web_app.url, 'https://taikhoantenhat.example.com/');
  assert.strictEqual(buttons[1][0].text, 'Quản lý thông báo');
  assert.strictEqual(buttons[1][0].callback_data, 'notify_pref:show');
});
