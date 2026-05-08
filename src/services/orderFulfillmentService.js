const orderService = require('./orderService');
const productService = require('./productService');
const { sendDelivery } = require('./notificationService');
const { richifyText } = require('../utils/messages');
const { postDeliveryKeyboard } = require('../utils/keyboard');

async function deliverOrder(bot, orderId) {
    const result = orderService.confirmAndDeliver(orderId);
    if (!result.success) return result;

    const order = result.order;
    const product = productService.getById(order.product_id);
    const usageInstructions = product.usage_instructions
        ? richifyText(product.usage_instructions)
        : '(không có)';

    await sendDelivery(bot, { ...order, product_name: product.name }, result.accounts, {
        usageInstructions,
        postDeliveryKeyboard: postDeliveryKeyboard(),
    });

    return result;
}

module.exports = { deliverOrder };
