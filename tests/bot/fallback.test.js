const test = require('node:test');
const assert = require('node:assert');

process.env.MINIAPP_URL = 'https://taikhoantenhat.example.com/';

const { handleFallback } = require('../../src/bot/fallback');

function makeCtx({ text, sentRef }) {
  return {
    from: { id: 7, first_name: 'X' },
    message: text ? { text } : undefined,
    reply: async (t, extra) => { sentRef.push({ text: t, extra }); },
  };
}

test('fallback nudges user to Mini App with a button', async () => {
  const sent = [];
  await handleFallback(makeCtx({ text: 'gì cũng được', sentRef: sent }));
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].text, /Mini App|cửa hàng/i);
  const btn = sent[0].extra.reply_markup.inline_keyboard[0][0];
  assert.strictEqual(btn.web_app.url, 'https://taikhoantenhat.example.com/');
});

test('fallback ignores its own /start and /myid (those have explicit handlers)', async () => {
  const sent = [];
  await handleFallback(makeCtx({ text: '/start', sentRef: sent }));
  assert.strictEqual(sent.length, 1);
});
