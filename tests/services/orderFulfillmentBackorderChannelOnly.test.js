const assert = require('node:assert');
const test = require('node:test');

function fresh(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test('deliverOrder backorder posts to order channel without admin notify', async (t) => {
  const orderService = require('../../src/services/orderService');
  const productService = require('../../src/services/productService');
  const adminNotifyService = require('../../src/services/adminNotifyService');
  const orderChannelService = require('../../src/services/orderChannelService');

  const originalConfirmAndDeliver = orderService.confirmAndDeliver;
  const originalGetProduct = productService.getById;
  const originalNotify = adminNotifyService.notify;
  const originalPostOrderCard = orderChannelService.postOrderCard;

  const channelCalls = [];
  const adminCalls = [];

  t.after(() => {
    orderService.confirmAndDeliver = originalConfirmAndDeliver;
    productService.getById = originalGetProduct;
    adminNotifyService.notify = originalNotify;
    orderChannelService.postOrderCard = originalPostOrderCard;
  });

  orderService.confirmAndDeliver = () => ({
    success: true,
    backorder: true,
    order: {
      id: 100603,
      product_id: 55,
      variant_id: null,
      quantity: 1,
      total_price: 450260,
      user_id: 480794224,
    },
  });
  productService.getById = () => ({ id: 55, name: 'Tài Khoản Claude Pro/Claude Max' });
  adminNotifyService.notify = async (...args) => {
    adminCalls.push(args);
  };
  orderChannelService.postOrderCard = async (...args) => {
    channelCalls.push(args);
  };

  const { deliverOrder } = fresh('../../src/services/orderFulfillmentService');
  const result = await deliverOrder({}, 100603);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.backorder, true);
  assert.strictEqual(adminCalls.length, 0);
  assert.strictEqual(channelCalls.length, 1);
  assert.strictEqual(channelCalls[0][0].keys, null);
});
