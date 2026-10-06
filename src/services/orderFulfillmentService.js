const orderService = require('./orderService');
const productService = require('./productService');
const { sendDelivery } = require('./notificationService');
const { richifyText } = require('../utils/messages');
const { postDeliveryKeyboard } = require('../utils/keyboard');
const { scheduleTwofaBindingSync } = require('./twofaBindingService');

async function deliverOrder(bot, orderId) {
    const result = orderService.confirmAndDeliver(orderId);
    if (!result.success) return result;

    const order = result.order;
    if (!result.backorder) scheduleTwofaBindingSync(orderId);
    const product = productService.getById(order.product_id);
    const variantService = require('./variantService');
    const db = require('../database');
    const variant = order.variant_id ? variantService.getById(db, order.variant_id) : null;
    const orderChannelService = require('./orderChannelService');

    if (result.backorder) {
        // nfshop variants are fulfilled automatically; the card is posted only if that fails.
        if (!order.requires_manual_review && require('./nfshopFulfillmentService').isNfshopOrder(order)) return result;
        await orderChannelService.postOrderCard({ order, product, variant, keys: null });
        return result;
    }

    const usageInstructions = product.usage_instructions
        ? richifyText(product.usage_instructions)
        : '(không có)';

    await sendDelivery(bot, { ...order, product_name: product.name }, result.accounts, {
        usageInstructions,
        postDeliveryKeyboard: postDeliveryKeyboard(),
    });
    await orderChannelService.postOrderCard({ order, product, variant, keys: result.accounts });

    return result;
}

module.exports = { deliverOrder };
