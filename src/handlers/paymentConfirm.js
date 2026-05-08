const orderService = require('../services/orderService');
const productService = require('../services/productService');
const messages = require('../utils/messages');
const { richifyText } = require('../utils/messages');
const { sendDelivery } = require('../services/notificationService');
const { postDeliveryKeyboard } = require('../utils/keyboard');

module.exports = (bot) => {
    bot.action('data_main', (ctx) => {
        ctx.answerCbQuery();
        ctx.reply('📊 Tính năng đang phát triển...');
    });

    bot.action('buy_again', (ctx) => {
        ctx.answerCbQuery();
        const products = productService.getAll();
        const { productListKeyboard } = require('../utils/keyboard');
        ctx.reply(messages.productHeader, productListKeyboard(products));
    });
};

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

module.exports.deliverOrder = deliverOrder;
