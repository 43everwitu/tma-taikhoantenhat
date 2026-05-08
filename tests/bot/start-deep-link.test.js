const test = require('node:test');
const assert = require('node:assert');

process.env.MINIAPP_URL = 'https://taikhoantenhat.example.com/';

// Stub userService to avoid touching the DB.
const userServicePath = require.resolve('../../src/services/userService');
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

delete require.cache[require.resolve('../../src/commands/start')];
const { handleStart } = require('../../src/commands/start');

function makeCtx({ payload, from = { id: 1, first_name: 'Khoa' }, sentRef }) {
  return {
    from,
    startPayload: payload || '',
    reply: async (text, extra) => { sentRef.push({ text, extra }); },
    replyWithHTML: async (text, extra) => { sentRef.push({ text, extra, html: true }); },
  };
}

test('/start with no payload renders default welcome + root Mini App button', async () => {
  const sent = [];
  await handleStart(makeCtx({ sentRef: sent }));
  assert.strictEqual(sent.length, 1);
  const button = sent[0].extra.reply_markup.inline_keyboard[0][0];
  assert.strictEqual(button.web_app.url, 'https://taikhoantenhat.example.com/');
});

test('/start order_42 renders a button to the order page', async () => {
  const sent = [];
  await handleStart(makeCtx({ payload: 'order_42', sentRef: sent }));
  const button = sent[0].extra.reply_markup.inline_keyboard[0][0];
  assert.match(button.web_app.url, /\/don-hang\/42$/);
});

test('/start with malformed payload falls back to default', async () => {
  const sent = [];
  await handleStart(makeCtx({ payload: '../../etc/passwd', sentRef: sent }));
  const button = sent[0].extra.reply_markup.inline_keyboard[0][0];
  assert.strictEqual(button.web_app.url, 'https://taikhoantenhat.example.com/');
});
