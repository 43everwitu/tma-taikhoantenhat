const orderService = require('./orderService');
const productService = require('./productService');
const { sendDelivery } = require('./notificationService');
const adminNotifyService = require('./adminNotifyService');
const { richifyText } = require('../utils/messages');
const messageTemplateService = require('./messageTemplateService');
const { postDeliveryKeyboard } = require('../utils/keyboard');

async function deliverOrder(bot, orderId) {
    const result = orderService.confirmAndDeliver(orderId);
    if (!result.success) return result;

    const order = result.order;
    const product = productService.getById(order.product_id);
    const variantService = require('./variantService');
    const db = require('../database');
    const variant = order.variant_id ? variantService.getById(db, order.variant_id) : null;
    const orderChannelService = require('./orderChannelService');

    if (result.backorder) {
        const inputBlock = order.input_value
            ? `\n📝 Thông tin khách: <code>${(() => {
                try { const { decryptString } = require('../utils/secrets'); return decryptString(order.input_value); } catch { return '(không giải mã được)'; }
              })()}</code>`
            : '';
        const body = messageTemplateService.render('admin.backorder_paid', {
            orderCode: order.id,
            productName: product.name,
            quantity: order.quantity,
            total: order.total_price.toLocaleString('vi-VN'),
            userMention: String(order.user_id),
            inputBlock,
        });
        await adminNotifyService.notify('backorder_paid', body, { order_id: order.id });
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
