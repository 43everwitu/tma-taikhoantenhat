const orderService = require('./orderService');
const productService = require('./productService');
const { sendDelivery } = require('./notificationService');
const adminNotifyService = require('./adminNotifyService');
const { richifyText } = require('../utils/messages');
const { postDeliveryKeyboard } = require('../utils/keyboard');

async function deliverOrder(bot, orderId) {
    const result = orderService.confirmAndDeliver(orderId);
    if (!result.success) return result;

    const order = result.order;
    const product = productService.getById(order.product_id);

    if (result.backorder) {
        const inputBlock = order.input_value
            ? `\n📝 Thông tin khách: <code>${(() => {
                try { const { decryptString } = require('../utils/secrets'); return decryptString(order.input_value); } catch { return '(không giải mã được)'; }
              })()}</code>`
            : '';
        const body =
            `🛎 Đơn đặt trước cần xử lý: #${order.id}\n` +
            `📦 ${product.name} (×${order.quantity})\n` +
            `💰 ${order.total_price.toLocaleString('vi-VN')}đ${inputBlock}\n` +
            `→ /admin/orders để giao thủ công.`;
        await adminNotifyService.notify('backorder_paid', body, { order_id: order.id });
        return result;
    }

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
