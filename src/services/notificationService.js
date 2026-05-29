const db = require('../database');
const adminNotifyService = require('./adminNotifyService');
const messageTemplateService = require('./messageTemplateService');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class NotificationService {
  constructor(bot) {
    this.bot = bot;
  }

  // ============================================================
  // Core dispatch
  // ============================================================

  /**
   * Send notification to a user on specified channels.
   */
  async notify(userId, type, title, body, data = {}, channel = 'all') {
    let sentTelegram = 0;
    let sentWeb = 0;

    // Telegram
    if (channel === 'all' || channel === 'telegram') {
      try {
        await this.bot.telegram.sendMessage(userId, body, { parse_mode: 'HTML' });
        sentTelegram = 1;
      } catch (err) {
        console.error(`❌ Notify telegram ${userId}:`, err.message);
      }
    }

    // Web (insert into notifications table)
    if (channel === 'all' || channel === 'web') {
      db.prepare(`
        INSERT INTO notifications (user_id, type, title, body, data, channel, sent_telegram, sent_web)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `).run(userId, type, title, body, JSON.stringify(data), channel, sentTelegram);
      sentWeb = 1;
    }

    return { sentTelegram, sentWeb };
  }

  // ============================================================
  // Order notifications
  // ============================================================

  async notifyOrderDelivered(order, accounts) {
    const accountList = accounts.map((a, i) => `${i + 1}. <code>${a}</code>`).join('\n');
    const product = db.prepare('SELECT usage_instructions FROM products WHERE id = ?').get(order.product_id);
    const { richifyText } = require('../utils/messages');
    const instructionsBlock = product?.usage_instructions
      ? `\n\n━━━━━━━━━━━━━━━━━\n📘 <b>Hướng dẫn sử dụng:</b>\n${richifyText(product.usage_instructions)}`
      : '';

    const body = `✅ Đơn hàng #${order.id} đã được giao!\n\n` +
      `📦 ${order.product_name}\n📋 SL: ${order.quantity}\n\n` +
      `🔑 Tài khoản:\n${accountList}` +
      instructionsBlock;

    return this.notify(order.user_id, 'order_update', 'Đơn hàng đã giao', body,
      { order_id: order.id });
  }

  async notifyOrderExpired(order) {
    const body = messageTemplateService.render('bot.order_expired_short', {
      orderCode: order.id,
    });
    return this.notify(order.user_id, 'order_update', 'Đơn hàng hết hạn', body,
      { order_id: order.id });
  }

  async notifyOrderCancelled(order) {
    const body = messageTemplateService.render('bot.order_cancelled_short', {
      orderCode: order.id,
    });
    return this.notify(order.user_id, 'order_update', 'Đơn hàng bị hủy', body,
      { order_id: order.id });
  }

  // ============================================================
  // Stock alerts
  // ============================================================

  /**
   * Notify followers when stock is replenished for a product.
   * Also resets the low-stock alert marker so a fresh alert can fire when
   * the product hits low stock again (next episode).
   */
  async notifyStockReplenished(productId) {
    db.prepare('UPDATE products SET last_low_stock_alert_at = NULL WHERE id = ?').run(productId);

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) return { sent: 0, failed: 0, total: 0, skipped: 'product_not_found' };

    const stockCount = db.prepare(
      'SELECT COUNT(*) as c FROM stock WHERE product_id = ? AND is_sold = 0'
    ).get(productId).c;

    const followers = db.prepare(
      'SELECT user_id FROM product_follows WHERE product_id = ?'
    ).all(productId);

    if (followers.length === 0) return { sent: 0, failed: 0, total: 0, skipped: 'no_followers' };

    const body = messageTemplateService.renderIfEnabled('bot.stock_replenished', {
      productEmoji: product.emoji || '📦',
      productName: product.name,
      stockCount,
    });
    if (!body) return { sent: 0, failed: 0, total: followers.length, skipped: 'template_disabled' };

    let sent = 0;
    let failed = 0;
    for (const { user_id } of followers) {
      try {
        await this.notify(user_id, 'stock_alert', 'Sản phẩm có hàng', body,
          { product_id: productId });
        sent++;
      } catch {
        failed++;
      }
      // Telegram rate limit: 25/sec
      if (sent % 25 === 0) await sleep(1000);
    }

    return { sent, failed, total: followers.length };
  }

  formatVnd(amount) {
    const n = Number(amount || 0);
    return `${n.toLocaleString('vi-VN')}đ`;
  }

  async notifyNewProduct(product, adminId = null) {
    const body = messageTemplateService.renderIfEnabled('bot.product_new', {
      productEmoji: product.emoji || '📦',
      productName: product.name,
      productPrice: this.formatVnd(product.price),
    });
    if (!body) return { sent: 0, failed: 0, total: 0, skipped: 'template_disabled' };
    return this.broadcast('Sản phẩm mới', body, 'all', adminId);
  }

  async notifyProductUpdated(product, adminId = null) {
    const body = messageTemplateService.renderIfEnabled('bot.product_updated', {
      productEmoji: product.emoji || '📦',
      productName: product.name,
      productPrice: this.formatVnd(product.price),
    });
    if (!body) return { sent: 0, failed: 0, total: 0, skipped: 'template_disabled' };
    return this.broadcast('Cập nhật sản phẩm', body, 'all', adminId);
  }

  /**
   * Check and alert admins about low stock products.
   * Called periodically (every 5 minutes). Throttled per product to once
   * per low-stock episode via products.last_low_stock_alert_at — marker
   * cleared on replenish (notifyStockReplenished) or self-heal (this method's
   * opening UPDATE when stock returns above threshold).
   */
  async checkLowStock() {
    const { effectiveLowStockProducts } = require('./lowStockQuery');

    // Self-heal: clear the alert marker for any product whose stock is back
    // above its effective threshold. Covers paths that don't go through
    // notifyStockReplenished (order cancel returning reserved keys, manual
    // DB edits, restored deletions). Keeps the "once per episode" guarantee
    // honest: a new episode can only fire after this pass NULLs the marker.
    db.prepare(`
      UPDATE products
      SET last_low_stock_alert_at = NULL
      WHERE last_low_stock_alert_at IS NOT NULL
        AND (
          SELECT COUNT(*) FROM stock s
          WHERE s.product_id = products.id AND s.is_sold = 0
        ) > COALESCE(
          NULLIF(low_stock_threshold, 0),
          (SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'low_stock_alert_threshold'),
          5
        )
    `).run();

    const lowStockProducts = effectiveLowStockProducts();

    if (lowStockProducts.length === 0) return;

    const rawUrl = (config.WEB_URL || '').replace(/\/$/, '');
    // Telegram rejects inline-button URLs that are not publicly resolvable
    // (localhost, private IPs, http on a private host). Detect → drop the
    // button and put the URL inline in the text instead.
    const isPublicUrl = /^https?:\/\/(?!(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.))/.test(rawUrl);
    const updateAlert = db.prepare(
      'UPDATE products SET last_low_stock_alert_at = CURRENT_TIMESTAMP WHERE id = ?'
    );

    for (const p of lowStockProducts) {
      const stockUrl = rawUrl ? `${rawUrl}/admin/stock/${p.id}` : '';
      // stockUrlBlock is trusted-as-HTML — empty when we'll use an inline
      // button (public URL) so the body stays clean.
      const stockUrlBlock = (stockUrl && !isPublicUrl)
        ? `\n\n🔗 <a href="${stockUrl}">Thêm kho qua dashboard</a>`
        : '';

      const body = messageTemplateService.renderIfEnabled('admin.low_stock', {
        productEmoji: p.emoji || '📦',
        productName: p.name,
        productId: p.id,
        stockCount: p.stock_count,
        threshold: p.effective_threshold,
        stockUrlBlock,
      });
      if (!body) { updateAlert.run(p.id); continue; }

      const opts = { parse_mode: 'HTML' };
      if (stockUrl && isPublicUrl) {
        opts.reply_markup = {
          inline_keyboard: [[
            { text: `📥 Thêm kho cho #${p.id}`, url: stockUrl },
          ]],
        };
      }

      try {
        await adminNotifyService.notify('low_stock', body, opts);
        updateAlert.run(p.id);
      } catch (err) {
        console.error(`❌ Low stock alert for product ${p.id}:`, err.message);
      }
    }
  }

  // ============================================================
  // Announcements / Broadcast
  // ============================================================

  /**
   * Broadcast announcement to all users.
   * Respects Telegram rate limit (~25 msg/sec).
   */
  async broadcast(title, body, target = 'all', adminId = null) {
    // Save announcement
    const result = db.prepare(`
      INSERT INTO announcements (title, body, admin_id, target)
      VALUES (?, ?, ?, ?)
    `).run(title, body, adminId || 0, target);

    const announcementId = result.lastInsertRowid;
    const users = db.prepare('SELECT telegram_id, username FROM users').all();

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const user of users) {
      // Telegram
      if (target === 'all' || target === 'telegram') {
        try {
          await this.bot.telegram.sendMessage(user.telegram_id, body, { parse_mode: 'HTML' });
          sent++;
        } catch (err) {
          failed++;
          const msg = (err && (err.description || err.message)) || String(err);
          errors.push({
            userId: user.telegram_id,
            username: user.username || null,
            error: String(msg).slice(0, 300),
            at: new Date().toISOString(),
          });
        }
        // Rate limit
        if ((sent + failed) % 25 === 0) await sleep(1000);
      }

      // Web notification
      if (target === 'all' || target === 'web') {
        db.prepare(`
          INSERT INTO notifications (user_id, type, title, body, channel)
          VALUES (?, 'announcement', ?, ?, ?)
        `).run(user.telegram_id, title, body, target);
      }
    }

    // Update announcement stats + error log
    db.prepare('UPDATE announcements SET sent_count = ?, failed_count = ?, error_details = ? WHERE id = ?')
      .run(sent, failed, errors.length > 0 ? JSON.stringify(errors) : null, announcementId);

    return { announcementId, sent, failed, total: users.length, errors };
  }

  // ============================================================
  // Periodic tasks
  // ============================================================

  /**
   * Start periodic low stock check (every 5 minutes).
   */
  startLowStockMonitor() {
    // Initial check after 1 minute
    setTimeout(() => this.checkLowStock(), 60000);
    // Then every 5 minutes
    setInterval(() => this.checkLowStock(), 5 * 60 * 1000);
    console.log('📊 Low stock monitor started (5 min interval)');
  }
}

module.exports = { NotificationService };

/**
 * Send delivery keys to a customer.
 *
 * Consolidated from paymentPoller._notifyCustomerDelivered and
 * paymentConfirm.deliverOrder — both had near-identical ~50-line blocks.
 *
 * @param {object} bot - Telegraf bot instance
 * @param {object} order - DB row: id, user_id, product_id, product_name, quantity
 * @param {string[]} accounts - Array of key strings
 * @param {object} opts
 * @param {number} [opts.qrChatId]           - Delete QR message before send (poller path)
 * @param {number} [opts.qrMessageId]
 * @param {object} [opts.postDeliveryKeyboard] - Extra Telegraf keyboard opts (paymentConfirm path)
 * @param {string} [opts.usageInstructions]  - Pre-formatted instructions (undefined = fetch from DB)
 */
async function sendDelivery(bot, order, accounts, opts = {}) {
  const messageTemplateService = require('./messageTemplateService');
  const { escapeHtml, richifyText, formatKeysForTelegram, shouldSendAsFile } = require('../utils/messages');
  const dbModule = require('../database');

  // Build input fields block from encrypted order.input_value (JSON map).
  // Hide values for password-ish labels.
  let inputBlock = '';
  if (order.input_value) {
    try {
      const { decryptString } = require('../utils/secrets');
      const raw = decryptString(order.input_value);
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        const lines = [];
        for (const [label, value] of Object.entries(parsed)) {
          if (!value) continue;
          const isSecret = /password|pass|mật khẩu|m[aậ]t kh[aẩ]u/i.test(label);
          lines.push(`<b>${escapeHtml(label)}:</b> ${isSecret ? '••••••' : escapeHtml(String(value))}`);
        }
        if (lines.length > 0) inputBlock = '\n\n📋 <b>Thông tin bạn đã nhập:</b>\n' + lines.join('\n');
      }
    } catch {}
  }

  if (opts.qrChatId && opts.qrMessageId) {
    try {
      await bot.telegram.deleteMessage(opts.qrChatId, opts.qrMessageId);
    } catch {
      // Older than 48h or already deleted — ignore.
    }
  }

  let usageInstructions = opts.usageInstructions;
  if (usageInstructions === undefined) {
    const product = dbModule.prepare(
      'SELECT usage_instructions FROM products WHERE id = ?'
    ).get(order.product_id);
    usageInstructions = product && product.usage_instructions
      ? richifyText(product.usage_instructions)
      : '';
  }
  // Treat legacy "(không có)" string from upstream callers as empty.
  if (usageInstructions === '(không có)') usageInstructions = '';
  const usageBlock = usageInstructions
    ? `\n\n📘 <b>Hướng dẫn:</b>\n${usageInstructions}`
    : '';

  const sendOpts = {
    parse_mode: 'HTML',
    ...(opts.postDeliveryKeyboard || {}),
  };

  let sentTelegram = 0;

  if (shouldSendAsFile(accounts)) {
    const buf = Buffer.from(accounts.join('\n'), 'utf-8');
    const fileMarker = `📄 <i>Key dài, đã đính kèm file <code>order_${order.id}_keys.txt</code> phía dưới.</i>`;
    const fullCaption = messageTemplateService.render('delivery_keys', {
      orderCode: order.id,
      productName: order.product_name,
      quantity: order.quantity,
      keysBlock: fileMarker,
      usageBlock,
    });
    const minimalCaption = messageTemplateService.render('delivery_keys', {
      orderCode: order.id,
      productName: order.product_name,
      quantity: order.quantity,
      keysBlock: fileMarker,
      usageBlock: '\n\n📘 (xem ở tin nhắn dưới)',
    });
    const captionWithInput = fullCaption + inputBlock;
    const finalCaption = captionWithInput.length <= 1024 ? captionWithInput : minimalCaption;

    try {
      await bot.telegram.sendDocument(
        order.user_id,
        { source: buf, filename: `order_${order.id}_keys.txt` },
        { caption: finalCaption, ...sendOpts }
      );
      sentTelegram = 1;
    } catch (err) {
      console.error(`❌ Send keys file ${order.user_id}:`, err.message);
    }

    if (sentTelegram && finalCaption === minimalCaption && usageInstructions !== '(không có)' && usageInstructions !== '(xem ở tin nhắn dưới)') {
      try {
        await bot.telegram.sendMessage(
          order.user_id,
          `📘 <b>Hướng dẫn sử dụng — ${escapeHtml(order.product_name)}</b>\n\n${usageInstructions}`,
          { parse_mode: 'HTML' }
        );
      } catch {}
    }

    dbModule.prepare(`
      INSERT INTO notifications (user_id, type, title, body, channel, sent_telegram)
      VALUES (?, 'order_update', 'Cập nhật đơn hàng', ?, 'all', ?)
    `).run(order.user_id, fullCaption, sentTelegram);
  } else {
    const body = messageTemplateService.render('delivery_keys', {
      orderCode: order.id,
      productName: order.product_name,
      quantity: order.quantity,
      keysBlock: formatKeysForTelegram(accounts),
      usageBlock,
    }) + inputBlock;
    try {
      await bot.telegram.sendMessage(order.user_id, body, sendOpts);
      sentTelegram = 1;
    } catch (err) {
      console.error(`❌ Send delivery ${order.user_id}:`, err.message);
    }
    dbModule.prepare(`
      INSERT INTO notifications (user_id, type, title, body, channel, sent_telegram)
      VALUES (?, 'order_update', 'Cập nhật đơn hàng', ?, 'all', ?)
    `).run(order.user_id, body, sentTelegram);
  }
}

module.exports.sendDelivery = sendDelivery;
