const productService = require('../services/productService');
const messageTemplateService = require('../services/messageTemplateService');
const { productListKeyboard } = require('../utils/keyboard');

module.exports = (bot) => {
    bot.command(['menu', 'products', 'product'], (ctx) => {
        sendProductList(ctx);
    });

    bot.hears('📦 Sản phẩm', (ctx) => sendProductList(ctx));

    bot.action('refresh_products', (ctx) => {
        ctx.answerCbQuery('🔄 Đang làm mới...');
        sendProductList(ctx, true);
    });
};

function sendProductList(ctx, edit = false) {
    const products = productService.getAll();

    if (products.length === 0) {
        const msg = messageTemplateService.render('cmd_products_empty', {});
        return edit ? ctx.editMessageText(msg, { parse_mode: 'HTML' }) : ctx.replyWithHTML(msg);
    }

    const keyboard = productListKeyboard(products);
    const text = messageTemplateService.render('cmd_products_header', {});

    if (edit) {
        ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    } else {
        ctx.replyWithHTML(text, keyboard);
    }
}
