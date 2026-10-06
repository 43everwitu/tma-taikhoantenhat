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

test('fallback replies with the support contact message', async () => {
  const sent = [];
  await handleFallback(makeCtx({ text: 'gì cũng được', sentRef: sent }));
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].text, /@taikhoantenhat|zalo\.me/i);
});

test('fallback ignores its own /start and /myid (those have explicit handlers)', async () => {
  const sent = [];
  await handleFallback(makeCtx({ text: '/start', sentRef: sent }));
  assert.strictEqual(sent.length, 1);
});
