const { Markup } = require('telegraf');

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

module.exports = {
    postDeliveryKeyboard,
    formatPrice,
};
