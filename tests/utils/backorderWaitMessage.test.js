const assert = require('node:assert');
const test = require('node:test');
const {
  getBackorderPaidMessage,
  isShopOffline,
} = require('../../src/utils/backorderWaitMessage');

test('backorder wait message uses online copy during shop hours', () => {
  const date = new Date('2026-07-18T04:00:00.000Z'); // 11:00 Asia/Ho_Chi_Minh

  assert.strictEqual(isShopOffline(date), false);
  assert.strictEqual(
    getBackorderPaidMessage(date),
    'Shop sẽ xử lý thủ công trong khoảng 30-60 phút, hoặc theo thời gian ghi trên sản phẩm.',
  );
});

test('backorder wait message uses offline copy after 22h30 Vietnam time', () => {
  const date = new Date('2026-07-18T15:31:00.000Z'); // 22:31 Asia/Ho_Chi_Minh

  assert.strictEqual(isShopOffline(date), true);
  assert.strictEqual(
    getBackorderPaidMessage(date),
    'Shop đang offline, đơn hàng của bạn sẽ được xử lý vào 9h30 sáng mai.',
  );
});

test('backorder wait message uses offline copy before 9h Vietnam time', () => {
  const date = new Date('2026-07-18T01:59:00.000Z'); // 08:59 Asia/Ho_Chi_Minh

  assert.strictEqual(isShopOffline(date), true);
});
