const test = require('node:test');
const assert = require('node:assert');

process.env.MINIAPP_URL = 'https://taikhoantenhat.example.com/';

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
      notification_prefs: from?.notification_prefs || '{}',
      balance: 0,
    }),
  },
};

const templatePath = require.resolve('../../src/services/messageTemplateService');
const templateStub = { renderIfEnabled: () => 'Xin chào Khoa' };
require.cache[templatePath] = {
  id: templatePath,
  filename: templatePath,
  loaded: true,
  exports: templateStub,
};

delete require.cache[require.resolve('../../src/commands/start')];
const { handleStart } = require('../../src/commands/start');

function makeCtx({ payload, from = { id: 1, first_name: 'Khoa' }, sentRef }) {
  return {
    from,
    startPayload: payload || '',
    botInfo: { username: 'shop_bot' },
    reply: async (text, extra) => { sentRef.push({ text, extra }); },
  };
}

function flattenButtons(sent) {
  return sent.extra.reply_markup.inline_keyboard.flat();
}

test('/start with no payload renders welcome + root Mini App button', async () => {
  templateStub.renderIfEnabled = () => 'Xin chào Khoa';
  const sent = [];
  await handleStart(makeCtx({ sentRef: sent }));
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].text, /Xin chào Khoa/);
  assert.match(sent[0].text, /Thông báo bot: đang bật/);
  const button = flattenButtons(sent[0]).find((item) => item.text === 'Mở cửa hàng');
  assert.strictEqual(button.url, 'https://t.me/shop_bot?startapp');
});

test('/start order_42 renders a button to the order page', async () => {
  templateStub.renderIfEnabled = () => 'Xin chào Khoa';
  const sent = [];
  await handleStart(makeCtx({ payload: 'order_42', sentRef: sent }));
  const button = flattenButtons(sent[0]).find((item) => item.text === 'Mở cửa hàng');
  assert.strictEqual(button.url, 'https://t.me/shop_bot?startapp=order_42');
});

test('/start order_42 falls back to Mini App order URL when bot username is missing', async () => {
  templateStub.renderIfEnabled = () => 'Xin chào Khoa';
  const sent = [];
  const ctx = makeCtx({ payload: 'order_42', sentRef: sent });
  ctx.botInfo = {};
  await handleStart(ctx);
  const button = flattenButtons(sent[0]).find((item) => item.text === 'Mở cửa hàng');
  assert.match(button.web_app.url, /\/don-hang\/42$/);
});

test('/start with malformed payload falls back to default', async () => {
  templateStub.renderIfEnabled = () => 'Xin chào Khoa';
  const sent = [];
  await handleStart(makeCtx({ payload: '../../etc/passwd', sentRef: sent }));
  const button = flattenButtons(sent[0]).find((item) => item.text === 'Mở cửa hàng');
  assert.strictEqual(button.url, 'https://t.me/shop_bot?startapp');
});

test('/start replies with fallback text when welcome template is disabled', async () => {
  templateStub.renderIfEnabled = () => null;
  const sent = [];
  await handleStart(makeCtx({ sentRef: sent }));

  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].text, /Mở cửa hàng/);
  assert.match(sent[0].text, /Thông báo bot: đang bật/);
});

test('/start escapes fallback name when welcome template is disabled', async () => {
  templateStub.renderIfEnabled = () => null;
  const sent = [];
  await handleStart(makeCtx({
    from: { id: 1, first_name: 'A <B> & C' },
    sentRef: sent,
  }));

  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].text, /A &lt;B&gt; &amp; C/);
  assert.doesNotMatch(sent[0].text, /A <B> & C/);
});

test('/start includes manage notification callback button', async () => {
  templateStub.renderIfEnabled = () => 'Xin chào Khoa';
  const sent = [];
  await handleStart(makeCtx({ sentRef: sent }));

  const button = flattenButtons(sent[0]).find((item) => item.text === 'Quản lý thông báo');
  assert.strictEqual(button.callback_data, 'notify_pref:show');
});
