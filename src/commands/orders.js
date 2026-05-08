const { Markup } = require('telegraf');
const db = require('../database');
const orderService = require('../services/orderService');
const { formatPrice } = require('../utils/keyboard');
const { escapeHtml } = require('../utils/messages');
const messageTemplateService = require('../services/messageTemplateService');

const PAGE_SIZE = 5;

const STATUS_LABEL = {
    pending:   '⏳ Chờ TT',
    paid:      '💵 Đã TT',
    delivered: '✅ Đã giao',
    cancelled: '❌ Hủy',
    expired:   '⏰ Hết hạn',
    refunded:  '↩️ Hoàn tiền',
};

const FILTERS = [
    { key: 'all',       label: 'Tất cả',  where: null },
    { key: 'pending',   label: 'Chờ TT',  where: "status = 'pending'" },
    { key: 'delivered', label: 'Đã giao', where: "status IN ('delivered', 'paid')" },
    { key: 'closed',    label: 'Đã đóng', where: "status IN ('cancelled', 'expired', 'refunded')" },
];

function fetchPage(userId, filterKey, page) {
    const filter = FILTERS.find(f => f.key === filterKey) || FILTERS[0];
    const baseWhere = `o.user_id = ?${filter.where ? ` AND o.${filter.where}` : ''}`;
    const offset = page * PAGE_SIZE;
    const rows = db.prepare(`
        SELECT o.*, p.name as product_name, p.emoji as product_emoji
        FROM orders o
        JOIN products p ON o.product_id = p.id
        WHERE ${baseWhere}
        ORDER BY o.created_at DESC
        LIMIT ? OFFSET ?
    `).all(userId, PAGE_SIZE, offset);
    const total = db.prepare(
        `SELECT COUNT(*) as c FROM orders o WHERE ${baseWhere}`
    ).get(userId).c;
    return { rows, total, filter };
}

function renderList(rows, total, filterKey, page) {
    const filter = FILTERS.find(f => f.key === filterKey) || FILTERS[0];
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    if (total === 0) {
        return {
            text: messageTemplateService.render('cmd_orders_empty', { filterLabel: filter.label }),
            keyboard: filterRow(filterKey),
        };
    }

    let text = messageTemplateService.render('cmd_orders_header', {
        filterLabel: filter.label,
        total,
        page: page + 1,
        totalPages,
    }) + '\n\n';
    for (const o of rows) {
        const emoji = o.product_emoji || '📦';
        text +=
            `${emoji} <b>#${o.id} · ${escapeHtml(o.product_name)}</b>\n` +
            `${STATUS_LABEL[o.status] || o.status} · SL ${o.quantity} · <b>${formatPrice(o.total_price)}</b>\n`;
        if (o.status === 'pending' && o.payment_code) {
            text += `📝 Mã CK: <code>${o.payment_code}</code>\n`;
        }
        text += `🕒 ${o.created_at}\n\n`;
    }

    const buttons = [];
    buttons.push(filterRowButtons(filterKey));

    // Pending rows get inline Cancel button (replaces standalone /cancel cmd)
    const pendingOnPage = rows.filter(o => o.status === 'pending');
    for (const o of pendingOnPage) {
        buttons.push([
            Markup.button.callback(`❌ Hủy #${o.id}`, `o_cancel_${o.id}_${filterKey}_${page}`),
        ]);
    }

    const navRow = [];
    if (page > 0) navRow.push(Markup.button.callback('← Trước', `o_page_${filterKey}_${page - 1}`));
    if (page < totalPages - 1) navRow.push(Markup.button.callback('Sau →', `o_page_${filterKey}_${page + 1}`));
    if (navRow.length) buttons.push(navRow);

    return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

function filterRowButtons(activeKey) {
    return FILTERS.map(f =>
        Markup.button.callback(
            f.key === activeKey ? `· ${f.label} ·` : f.label,
            `o_filter_${f.key}`
        )
    );
}

function filterRow(activeKey) {
    return Markup.inlineKeyboard([filterRowButtons(activeKey)]);
}

function renderDetail(order) {
    const emoji = order.product_emoji || '📦';
    const lines = [
        `${emoji} <b>ĐƠN #${order.id}</b>`,
        ``,
        `📦 ${escapeHtml(order.product_name)}`,
        `📋 Số lượng: ${order.quantity}`,
        `💵 Tổng: <b>${formatPrice(order.total_price)}</b>`,
        `📊 Trạng thái: ${STATUS_LABEL[order.status] || order.status}`,
        `🏦 Bank: ${order.bank_name || '—'}`,
        `📝 Mã CK: <code>${order.payment_code || '—'}</code>`,
        `🕒 Tạo: ${order.created_at}`,
    ];
    if (order.paid_at)      lines.push(`💵 Thanh toán: ${order.paid_at}`);
    if (order.delivered_at) lines.push(`✅ Giao: ${order.delivered_at}`);
    if (order.notes)        lines.push(`📌 Ghi chú: ${escapeHtml(order.notes)}`);

    const buttons = [];
    if (order.status === 'pending') {
        buttons.push([Markup.button.callback(`❌ Hủy đơn #${order.id}`, `o_cancel_${order.id}_all_0`)]);
    }
    buttons.push([Markup.button.callback('↩️ Quay lại danh sách', 'o_filter_all')]);

    return { text: lines.join('\n'), keyboard: Markup.inlineKeyboard(buttons) };
}

module.exports = (bot) => {
    bot.command('orders', (ctx) => {
        const parts = ctx.message.text.trim().split(/\s+/);
        // /orders <id> → detail view
        if (parts.length >= 2 && /^\d+$/.test(parts[1].replace(/^#/, ''))) {
            const id = parseInt(parts[1].replace(/^#/, ''));
            const order = db.prepare(`
                SELECT o.*, p.name as product_name, p.emoji as product_emoji
                FROM orders o JOIN products p ON o.product_id = p.id
                WHERE o.id = ?
            `).get(id);
            if (!order) return ctx.reply('❌ Không tìm thấy đơn này.');
            if (order.user_id !== ctx.from.id) return ctx.reply('⛔ Onii-chan ơi, đơn này không phải của onii-chan~');
            const { text, keyboard } = renderDetail(order);
            return ctx.replyWithHTML(text, keyboard);
        }

        // List view (default = all, page 0)
        const { rows, total } = fetchPage(ctx.from.id, 'all', 0);
        const { text, keyboard } = renderList(rows, total, 'all', 0);
        ctx.replyWithHTML(text, keyboard);
    });

    // Reply-keyboard button — same as /orders without args.
    bot.hears('📋 Đơn hàng', (ctx) => {
        const { rows, total } = fetchPage(ctx.from.id, 'all', 0);
        const { text, keyboard } = renderList(rows, total, 'all', 0);
        ctx.replyWithHTML(text, keyboard);
    });

    // Filter tab tap → reload page 0 of selected filter
    bot.action(/^o_filter_(\w+)$/, async (ctx) => {
        const filterKey = ctx.match[1];
        const { rows, total } = fetchPage(ctx.from.id, filterKey, 0);
        const { text, keyboard } = renderList(rows, total, filterKey, 0);
        await ctx.answerCbQuery();
        try {
            await ctx.editMessageText(text, { parse_mode: 'HTML', ...(keyboard || {}) });
        } catch {
            await ctx.replyWithHTML(text, keyboard);
        }
    });

    // Page nav
    bot.action(/^o_page_(\w+)_(\d+)$/, async (ctx) => {
        const filterKey = ctx.match[1];
        const page = parseInt(ctx.match[2]);
        const { rows, total } = fetchPage(ctx.from.id, filterKey, page);
        const { text, keyboard } = renderList(rows, total, filterKey, page);
        await ctx.answerCbQuery();
        try {
            await ctx.editMessageText(text, { parse_mode: 'HTML', ...(keyboard || {}) });
        } catch {
            await ctx.replyWithHTML(text, keyboard);
        }
    });

    // Inline cancel button — guard ownership + status, then refresh same page
    bot.action(/^o_cancel_(\d+)_(\w+)_(\d+)$/, async (ctx) => {
        const orderId = parseInt(ctx.match[1]);
        const filterKey = ctx.match[2];
        const page = parseInt(ctx.match[3]);

        const order = orderService.getById(orderId);
        if (!order) return ctx.answerCbQuery('❌ Hông tìm thấy đơn');
        if (order.user_id !== ctx.from.id) return ctx.answerCbQuery('⛔ Không phải đơn của onii-chan');
        if (order.status !== 'pending') {
            await ctx.answerCbQuery(`Hông hủy được (trạng thái: ${order.status})`);
            return;
        }

        orderService.cancel(orderId);
        await ctx.answerCbQuery(`✅ Đã hủy #${orderId} onii-chan~`);

        // Refresh the same page
        const { rows, total } = fetchPage(ctx.from.id, filterKey, page);
        const { text, keyboard } = renderList(rows, total, filterKey, page);
        try {
            await ctx.editMessageText(text, { parse_mode: 'HTML', ...(keyboard || {}) });
        } catch {
            await ctx.replyWithHTML(text, keyboard);
        }
    });
};
