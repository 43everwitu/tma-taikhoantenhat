const { Markup } = require('telegraf');

/**
 * Build product list keyboard
 */
function productListKeyboard(products) {
    const buttons = products.map((p) => {
        const stock = p.display_stock || p.stock_count;
        const isContact = p.contact_only && stock === 0;
        const isOutOfStock = !isContact && stock === 0;
        // Out-of-stock products get a ❌ prefix as a visual marker — Telegram
        // inline buttons can't be colored, so emoji is the only signal.
        const prefix = isOutOfStock ? '❌ ' : '';
        let label = `${prefix}${p.name} - ${formatPrice(p.price)}`;

        if (isContact) {
            label += ` — 📬 Liên hệ`;
        } else if (isOutOfStock) {
            label += ` — Hết hàng`;
        } else {
            label += ` (Còn: ${stock})`;
        }

        if (p.promotion) {
            label += ` ${p.promotion}`;
        }

        return [Markup.button.callback(label, `product_${p.id}`)];
    });

    buttons.push([Markup.button.callback('🔄 Làm mới', 'refresh_products')]);

    return Markup.inlineKeyboard(buttons);
}

/**
 * Build quantity selection keyboard. Quick-pick buttons cap at 10 to keep
 * the inline-keyboard compact; for larger quantities the user clicks
 * "Số lượng khác" → bot prompts via force_reply (handled in productSelect).
 */
function quantityKeyboard(productId, maxQty = 10) {
    const max = Math.min(maxQty, 10);
    const rows = [];
    let row = [];

    for (let i = 1; i <= max; i++) {
        row.push(Markup.button.callback(`${i}`, `qty_${productId}_${i}`));
        if (row.length === 5) {
            rows.push(row);
            row = [];
        }
    }
    if (row.length > 0) rows.push(row);

    // Custom quantity entry — useful when stock > 10 or buyer wants 11+.
    rows.push([Markup.button.callback('✏️ Số lượng khác...', `qty_custom_${productId}`)]);
    rows.push([
        Markup.button.callback('↩️ Quay lại', 'refresh_products'),
        Markup.button.callback('❌ Hủy', 'cancel_order'),
    ]);

    return Markup.inlineKeyboard(rows);
}

/**
 * Build order confirmation keyboard
 */
function orderConfirmKeyboard(orderId) {
    return Markup.inlineKeyboard([
        [Markup.button.callback('❌ Hủy đơn', `cancel_order_${orderId}`)],
    ]);
}

/**
 * Build post-delivery keyboard
 */
function postDeliveryKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('📊 Data chính', 'data_main'),
            Markup.button.callback('🔄 Mua lại', 'buy_again'),
        ],
        [Markup.button.callback('📋 Quay lại danh sách', 'refresh_products')],
    ]);
}

/**
 * Format price in VND
 */
function formatPrice(amount) {
    return new Intl.NumberFormat('vi-VN').format(amount) + 'đ';
}

/**
 * Main menu keyboard (reply keyboard)
 */
function mainMenuKeyboard() {
    return Markup.keyboard([
        ['📦 Sản phẩm', '💰 Nạp tiền'],
        ['📋 Đơn hàng', '🆘 Hỗ trợ'],
    ]).resize().persistent();
}

module.exports = {
    productListKeyboard,
    quantityKeyboard,
    orderConfirmKeyboard,
    postDeliveryKeyboard,
    formatPrice,
    mainMenuKeyboard,
};
