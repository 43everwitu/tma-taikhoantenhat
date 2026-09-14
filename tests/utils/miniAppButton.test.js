const assert = require('node:assert');
const test = require('node:test');

test('buildMiniAppUrl routes order_<id> payload to /don-hang/<id>', () => {
  process.env.MINIAPP_URL = 'https://shop.example.com';
  delete require.cache[require.resolve('../../src/utils/miniAppButton')];
  const { buildMiniAppUrl } = require('../../src/utils/miniAppButton');
  assert.strictEqual(buildMiniAppUrl('order_42'), 'https://shop.example.com/don-hang/42');
});

test('buildMiniAppUrl routes product_<slug> payload to /san-pham/<slug>', () => {
  process.env.MINIAPP_URL = 'https://shop.example.com';
  delete require.cache[require.resolve('../../src/utils/miniAppButton')];
  const { buildMiniAppUrl } = require('../../src/utils/miniAppButton');
  assert.strictEqual(buildMiniAppUrl('product_chatgpt-plus'), 'https://shop.example.com/san-pham/chatgpt-plus');
});

test('buildMiniAppUrl falls back to base URL for unrecognized payload', () => {
  process.env.MINIAPP_URL = 'https://shop.example.com';
  delete require.cache[require.resolve('../../src/utils/miniAppButton')];
  const { buildMiniAppUrl } = require('../../src/utils/miniAppButton');
  assert.strictEqual(buildMiniAppUrl('garbage'), 'https://shop.example.com');
  assert.strictEqual(buildMiniAppUrl(''), 'https://shop.example.com');
});

test('buildStartLink encodes product_<slug> as startapp param', () => {
  process.env.MINIAPP_URL = 'https://shop.example.com';
  delete require.cache[require.resolve('../../src/utils/miniAppButton')];
  const { buildStartLink } = require('../../src/utils/miniAppButton');
  assert.strictEqual(buildStartLink('test_shop_bot', 'product_chatgpt-plus'), 'https://t.me/test_shop_bot?startapp=product_chatgpt-plus');
});

test('openShopButton uses product payload when MINIAPP_URL configured', () => {
  process.env.MINIAPP_URL = 'https://shop.example.com';
  delete require.cache[require.resolve('../../src/utils/miniAppButton')];
  const { openShopButton } = require('../../src/utils/miniAppButton');
  const button = openShopButton('🛒 Mở cửa hàng', { botUsername: 'test_shop_bot', payload: 'product_chatgpt-plus' });
  assert.deepStrictEqual(button, { text: '🛒 Mở cửa hàng', web_app: { url: 'https://shop.example.com/san-pham/chatgpt-plus' } });
});
