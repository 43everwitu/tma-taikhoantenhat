const productService = require('../services/productService');
const orderService = require('../services/orderService');
const paymentService = require('../services/paymentService');
const userService = require('../services/userService');
const messages = require('../utils/messages');
const config = require('../config');
const adminNotifyService = require('../services/adminNotifyService');
const messageTemplateService = require('../services/messageTemplateService');
const { Markup } = require('telegraf');
const { formatPrice } = require('../utils/keyboard');

module.exports = (bot) => {
    // Handle quantity selection: qty_{productId}_{quantity}
    bot.action(/^qty_(\d+)_(\d+)$/, async (ctx) => {
        const productId = parseInt(ctx.match[1]);
        const quantity = parseInt(ctx.match[2]);
        const product = productService.getById(productId);

        if (!product) {
            return ctx.answerCbQuery('❌ Sản phẩm không tồn tại');
        }

        const availableStock = product.display_stock || product.stock_count;
        if (availableStock < quantity) {
            return ctx.answerCbQuery(`❌ Chỉ còn ${availableStock} sản phẩm`);
        }

        // Clear the quantity-prompt message so the chat stays tidy.
        await ctx.deleteMessage().catch(() => {});

        const banks = paymentService.getBanks();

        if (banks.length > 1) {
            ctx.answerCbQuery();
            const totalPrice = product.price * quantity;
            const bankButtons = banks.map((b, i) =>
                [Markup.button.callback(`🏦 ${b.NAME}`, `bank_${productId}_${quantity}_${i}`)]
            );
            bankButtons.push([
                Markup.button.callback('↩️ Quay lại', `back_to_qty_${productId}`),
                Markup.button.callback('❌ Hủy', 'cancel_order'),
            ]);

            ctx.replyWithHTML(
                `📦 <b>${product.name}</b>\n` +
                `📊 Số lượng: ${quantity}\n` +
                `💵 Tổng tiền: <b>${formatPrice(totalPrice)}</b>\n\n` +
                `🏦 Chọn ngân hàng thanh toán:`,
                Markup.inlineKeyboard(bankButtons)
            );
        } else {
            ctx.answerCbQuery('⏳ Đang tạo đơn hàng...');
            await createOrderAndPay(ctx, bot, product, quantity, 0);
        }
    });

    // Back from bank selector → re-show quantity selector for the same product.
    bot.action(/^back_to_qty_(\d+)$/, async (ctx) => {
        const productId = parseInt(ctx.match[1]);
        const product = productService.getById(productId);
        if (!product) return ctx.answerCbQuery('❌ Sản phẩm không tồn tại');
        const availableStock = product.display_stock || product.stock_count;
        if (availableStock <= 0) {
            await ctx.answerCbQuery('❌ Hết hàng');
            try { await ctx.deleteMessage(); } catch {}
            return;
        }
        await ctx.answerCbQuery();
        try { await ctx.deleteMessage(); } catch {}
        const messages = require('../utils/messages');
        const { quantityKeyboard } = require('../utils/keyboard');
        const maxQty = Math.min(availableStock, 10);
        await ctx.replyWithHTML(messages.selectQuantity(product), quantityKeyboard(productId, maxQty));
    });

    // Custom quantity entry: user clicks "✏️ Số lượng khác..." → bot prompts
    // with force_reply, then bot.on('text') below picks up the typed number.
    bot.action(/^qty_custom_(\d+)$/, async (ctx) => {
        const productId = parseInt(ctx.match[1]);
        const product = productService.getById(productId);
        if (!product) return ctx.answerCbQuery('❌ Sản phẩm không tồn tại');

        const availableStock = product.display_stock || product.stock_count;
        if (availableStock <= 0) return ctx.answerCbQuery('❌ Hết hàng');

        await ctx.answerCbQuery();
        // Send the prompt FIRST so we can store its id, then save session.
        // force_reply pops the user's keyboard onto our message; saving the
        // prompt id lets the text handler delete it once the user replies.
        const prompt = await ctx.reply(
            `✏️ Nhập số lượng muốn mua (1–${availableStock}):\n` +
            `Hoặc gõ /cancel để bỏ qua.`,
            { reply_markup: { force_reply: true, selective: true } }
        );

        ctx.session = ctx.session || {};
        ctx.session.pendingQty = {
            productId,
            maxStock: availableStock,
            // Keep the original quantity-selector message id so the user can
            // visually return to it if they back out.
            qtyPromptChatId: prompt.chat.id,
            qtyPromptMessageId: prompt.message_id,
            qtySelectorMessageId: ctx.callbackQuery.message?.message_id || null,
            expiresAt: Date.now() + 5 * 60 * 1000,
        };
    });

    // Capture the next text message after qty_custom prompt. Filtered to
    // replies to a bot message AND a non-expired session, so normal chat
    // and slash commands aren't intercepted.
    bot.on('text', async (ctx, next) => {
        const pending = ctx.session?.pendingQty;
        if (!pending) return next ? next() : undefined;
        if (Date.now() > pending.expiresAt) {
            delete ctx.session.pendingQty;
            return next ? next() : undefined;
        }
        if (!ctx.message.reply_to_message?.from?.is_bot) {
            return next ? next() : undefined;
        }
        // Reply must target THIS prompt — Telegram message_id is per-chat unique
        // so no chance of cross-chat collisions.
        if (pending.qtyPromptMessageId &&
            ctx.message.reply_to_message.message_id !== pending.qtyPromptMessageId) {
            return next ? next() : undefined;
        }
        if (ctx.message.text.startsWith('/')) {
            // /cancel mid-prompt → drop the session + clean up the prompt msg.
            delete ctx.session.pendingQty;
            if (pending.qtyPromptChatId && pending.qtyPromptMessageId) {
                try { await bot.telegram.deleteMessage(pending.qtyPromptChatId, pending.qtyPromptMessageId); } catch {}
            }
            return next ? next() : undefined;
        }

        const raw = ctx.message.text.trim().replace(/[^\d]/g, '');
        const qty = parseInt(raw);
        if (!Number.isFinite(qty) || qty < 1) {
            return ctx.reply(`❌ Số lượng không hợp lệ. Nhập số nguyên 1–${pending.maxStock}.`);
        }

        const product = productService.getById(pending.productId);
        if (!product) {
            delete ctx.session.pendingQty;
            return ctx.reply('❌ Sản phẩm không còn tồn tại.');
        }
        const liveStock = product.display_stock || product.stock_count;
        if (qty > liveStock) {
            return ctx.reply(`❌ Chỉ còn ${liveStock} sản phẩm. Nhập lại số nhỏ hơn:`,
                { reply_markup: { force_reply: true, selective: true } });
        }

        // Clean up: delete the bot's prompt + the user's reply + the original
        // quantity-selector message so the chat doesn't accumulate stale
        // prompts after a successful entry.
        if (pending.qtyPromptChatId && pending.qtyPromptMessageId) {
            try { await bot.telegram.deleteMessage(pending.qtyPromptChatId, pending.qtyPromptMessageId); } catch {}
        }
        try { await ctx.deleteMessage(); } catch {}
        if (pending.qtySelectorMessageId) {
            try { await bot.telegram.deleteMessage(ctx.chat.id, pending.qtySelectorMessageId); } catch {}
        }
        delete ctx.session.pendingQty;

        const banks = paymentService.getBanks();
        if (banks.length > 1) {
            const totalPrice = product.price * qty;
            const bankButtons = banks.map((b, i) =>
                [Markup.button.callback(`🏦 ${b.NAME}`, `bank_${product.id}_${qty}_${i}`)]
            );
            bankButtons.push([Markup.button.callback('❌ Hủy', 'cancel_order')]);
            return ctx.replyWithHTML(
                `📦 <b>${product.name}</b>\n` +
                `📊 Số lượng: ${qty}\n` +
                `💵 Tổng tiền: <b>${formatPrice(totalPrice)}</b>\n\n` +
                `🏦 Chọn ngân hàng thanh toán:`,
                Markup.inlineKeyboard(bankButtons)
            );
        }
        await createOrderAndPay(ctx, bot, product, qty, 0);
    });

    bot.action(/^bank_(\d+)_(\d+)_(\d+)$/, async (ctx) => {
        const productId = parseInt(ctx.match[1]);
        const quantity = parseInt(ctx.match[2]);
        const bankIndex = parseInt(ctx.match[3]);
        const product = productService.getById(productId);

        if (!product) {
            return ctx.answerCbQuery('❌ Sản phẩm không tồn tại');
        }

        const availableStock = product.display_stock || product.stock_count;
        if (availableStock < quantity) {
            return ctx.answerCbQuery(`❌ Chỉ còn ${availableStock} sản phẩm`);
        }

        // Clear the bank-selection message so the chat stays tidy.
        await ctx.deleteMessage().catch(() => {});

        ctx.answerCbQuery('⏳ Đang tạo đơn hàng...');
        await createOrderAndPay(ctx, bot, product, quantity, bankIndex);
    });

    // ════════════════════════════════════
    // Shared: Create order + send QR + notify admin
    // ════════════════════════════════════
    async function createOrderAndPay(ctx, bot, product, quantity, bankIndex) {
        const user = userService.findOrCreate(ctx.from);
        const totalPrice = product.price * quantity;

        let order;
        try {
            order = orderService.create(
                ctx.from.id,
                product.id,
                quantity,
                totalPrice,
                { source: 'telegram', bankName: paymentService.getBank(bankIndex).NAME }
            );
        } catch (err) {
            if (err.message === 'DUPLICATE_PENDING') {
                return ctx.replyWithHTML(
                    `⚠️ Bạn đã có đơn chờ thanh toán cho sản phẩm này (#${err.existingOrderId}).\n` +
                    `Hoàn tất hoặc huỷ đơn cũ trong /orders trước khi tạo đơn mới.`
                );
            }
            if (err.message === 'INSUFFICIENT_STOCK') {
                return ctx.reply(`❌ Không đủ hàng. Chỉ còn ${err.available} sản phẩm.`);
            }
            throw err;
        }

        const payment = paymentService.buildPayment(order.id, totalPrice, bankIndex);

        if (bot._paymentPoller) bot._paymentPoller.ensureRunning();

        // Notify admin once per new order, regardless of payment method.
        const userName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
        const adminMsg =
            `🔔 <b>ĐƠN HÀNG MỚI #${order.id}</b>\n\n` +
            `👤 Khách: <b>${userName}</b> (<code>${ctx.from.id}</code>)\n` +
            (ctx.from.username ? `📱 @${ctx.from.username}\n` : '') + `\n` +
            `📦 Sản phẩm: <b>${product.name}</b>\n` +
            `📊 Số lượng: ${quantity}\n` +
            `💰 Tổng tiền: <b>${formatPrice(totalPrice)}</b>\n` +
            `🏦 Bank: <b>${payment.bankName}</b>\n` +
            `🔑 Mã CK: <code>${payment.paymentCode}</code>`;
        adminNotifyService.notify('new_order', adminMsg, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback(`❌ Hủy #${order.id}`, `admin_cancel_${order.id}`)],
            ]),
        });

        // Decision tree: if user can pay from wallet, present a 2-button
        // chooser (wallet vs bank QR). Else, go straight to the QR flow.
        const canPayFromWallet = user.balance >= totalPrice;
        if (canPayFromWallet) {
            const expiryMinutes = parseInt(
              require('../database').prepare("SELECT value FROM settings WHERE key = 'order_expiry_minutes'").get()?.value || '5', 10
            );
            const orderText = messageTemplateService.render('order_created', {
                orderCode: order.id,
                productName: product.name,
                quantity,
                total: formatPrice(totalPrice).replace(/đ$/, ''),
                expiryMinutes,
            });
            const chooserSuffix = `\n\n💼 Số dư ví: <b>${formatPrice(user.balance)}</b>\n\nChọn phương thức thanh toán:`;
            await ctx.replyWithHTML(
                orderText + chooserSuffix,
                Markup.inlineKeyboard([
                    [Markup.button.callback(`💼 Trả ${formatPrice(totalPrice)} từ ví`, `pay_wallet_${order.id}`)],
                    [Markup.button.callback('🏦 Chuyển khoản qua VietQR', `pay_bank_${order.id}`)],
                    [Markup.button.callback('❌ Hủy đơn', `cancel_order_${order.id}`)],
                ])
            );
            return;
        }

        // No wallet balance → send QR straight away.
        await sendBankQR(ctx, bot, order, product, quantity, totalPrice, payment);
    }

    // ════════════════════════════════════
    // Send the VietQR photo for an order. Used directly when the user has no
    // wallet balance, and via the pay_bank_<id> action when they pick bank
    // from the chooser.
    // ════════════════════════════════════
    async function sendBankQR(ctx, bot, order, product, quantity, totalPrice, payment) {
        const expiryMinutes = parseInt(
          require('../database').prepare("SELECT value FROM settings WHERE key = 'order_expiry_minutes'").get()?.value || '5', 10
        );
        const caption = messageTemplateService.render('payment_pending', {
            orderCode: order.id,
            productName: product.name,
            total: formatPrice(totalPrice).replace(/đ$/, ''),
            memo: payment.paymentCode,
            expiryMinutes,
        }) + `\n\n🏦 Chuyển vào: <b>${payment.bankName}</b>\n🚫 <b>KHÔNG</b> thay đổi nội dung CK`;

        const banks = paymentService.getBanks();
        const bank = banks.find(b => b.NAME === payment.bankName) || banks[0];
        const qrMedia = await paymentService.getQRMedia(totalPrice, payment.paymentCode, bank);
        const qrMsg = await ctx.replyWithPhoto(qrMedia, {
            caption, parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ Hủy thanh toán', `cancel_order_${order.id}`)],
            ]),
        });

        try {
            require('../database').prepare(
                'UPDATE orders SET qr_chat_id = ?, qr_message_id = ? WHERE id = ?'
            ).run(qrMsg.chat.id, qrMsg.message_id, order.id);
        } catch (err) {
            console.error('Failed to persist QR message id:', err.message);
        }
    }

    // User picked "Chuyển khoản" from the wallet/bank chooser → send the QR.
    bot.action(/^pay_bank_(\d+)$/, async (ctx) => {
        const orderId = parseInt(ctx.match[1]);
        const order = orderService.getById(orderId);
        if (!order) return ctx.answerCbQuery('❌ Không tìm thấy đơn');
        if (order.user_id !== ctx.from.id) return ctx.answerCbQuery('⛔ Không phải đơn của bạn');
        if (order.status !== 'pending') {
            return ctx.answerCbQuery(`Đơn không còn ở trạng thái chờ (${order.status})`);
        }

        // Ack immediately so the Telegram client stops the spinner; the QR
        // composite + send below run in the background of the same handler.
        ctx.answerCbQuery('🏦 Đang tạo QR...').catch(() => {});
        // Fire-and-forget delete — saves ~200ms vs awaiting the round-trip.
        ctx.deleteMessage().catch(() => {});

        const product = productService.getById(order.product_id);
        // Resolve bank index by name (default 0 if not found)
        const banks = paymentService.getBanks();
        const bankIndex = Math.max(0, banks.findIndex(b => b.NAME === order.bank_name));
        const payment = paymentService.buildPayment(order.id, order.total_price, bankIndex);
        await sendBankQR(ctx, bot, order, product, order.quantity, order.total_price, payment);
    });

    // Pay from wallet: atomic deduct + deliver. Replaces the QR flow when
    // the user has enough balance.
    bot.action(/^pay_wallet_(\d+)$/, async (ctx) => {
        const orderId = parseInt(ctx.match[1]);
        const order = orderService.getById(orderId);
        if (!order) return ctx.answerCbQuery('❌ Không tìm thấy đơn');
        if (order.user_id !== ctx.from.id) return ctx.answerCbQuery('⛔ Không phải đơn của bạn');
        if (order.status !== 'pending') {
            return ctx.answerCbQuery(`Đơn không còn ở trạng thái chờ (${order.status})`);
        }

        await ctx.answerCbQuery('⏳ Đang xử lý...');
        const result = orderService.payFromBalance(orderId);

        if (!result.success) {
            return ctx.replyWithHTML(`❌ ${result.error}`);
        }

        // Edit the wallet-prompt message in place so the button becomes inert.
        try {
            await ctx.editMessageText(
                `✅ Đã thanh toán đơn #${orderId} bằng ví.\n` +
                `Số dư còn lại: <b>${formatPrice(result.newBalance)}</b>`,
                { parse_mode: 'HTML' }
            );
        } catch {
            await ctx.replyWithHTML(`✅ Đã thanh toán bằng ví. Số dư: <b>${formatPrice(result.newBalance)}</b>`);
        }

        // Delete the now-stale QR prompt
        if (order.qr_chat_id && order.qr_message_id) {
            try { await bot.telegram.deleteMessage(order.qr_chat_id, order.qr_message_id); } catch {}
        }

        // Send keys via the same notification path the poller uses
        const { NotificationService } = require('../services/notificationService');
        const notifier = new NotificationService(bot);
        await notifier.notifyOrderDelivered({ ...order, product_name: result.order.product_name }, result.accounts);

        // Notify admin only if the toggle is on (M4 mute applies)
        require('../services/adminNotifyService').notify('delivered',
            `✅ Đơn #${orderId} thanh toán bằng ví\n` +
            `KH: ${order.user_id}\nSP: ${result.order.product_name}\nSL: ${order.quantity}`);
    });

    // Admin can cancel a pending/paid order. Confirmation is API-driven only.
    bot.action(/^admin_cancel_(\d+)$/, (ctx) => {
        if (ctx.from.id !== config.ADMIN_ID) return ctx.answerCbQuery('⛔');

        const orderId = parseInt(ctx.match[1]);
        orderService.cancel(orderId);
        ctx.answerCbQuery('❌ Đã hủy');
        ctx.editMessageText(
            ctx.callbackQuery.message.text + '\n\n❌ ĐÃ HỦY ĐƠN HÀNG',
            { parse_mode: 'HTML' }
        );

        // Notify customer
        const order = orderService.getById(orderId);
        if (order) {
            bot.telegram.sendMessage(order.user_id, '❌ Đơn hàng của bạn đã bị hủy. Liên hệ hỗ trợ nếu cần.').catch(() => { });
        }
    });

    // Handle cancel order (customer side, before order is created)
    bot.action('cancel_order', async (ctx) => {
        await ctx.answerCbQuery('❌ Đã hủy');
        try { await ctx.deleteMessage(); } catch {}
    });

    // Cancel a pending order — also delete the QR photo so the chat is clean.
    bot.action(/^cancel_order_(\d+)$/, async (ctx) => {
        const orderId = parseInt(ctx.match[1]);
        const order = orderService.getById(orderId);
        const cancelled = orderService.cancel(orderId);
        await ctx.answerCbQuery(cancelled ? '❌ Đã hủy đơn hàng' : 'Đơn không thể hủy');

        // Delete the QR message (the one with the cancel button is the QR
        // itself, since createOrderAndPay attaches the button to the photo).
        if (order?.qr_chat_id && order?.qr_message_id) {
            try { await bot.telegram.deleteMessage(order.qr_chat_id, order.qr_message_id); } catch {}
        }
        // Defensive: also try deleting the message that triggered the action
        // in case it's not the QR (e.g. wallet-pay prompt or admin notify).
        try { await ctx.deleteMessage(); } catch {}

        await ctx.replyWithHTML(
            `❌ Đã hủy đơn #${orderId}.`,
            Markup.inlineKeyboard([
                [Markup.button.callback('🛍️ Xem sản phẩm khác', 'refresh_products')],
            ])
        );
    });
};
