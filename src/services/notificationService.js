const db = require('../database');
const config = require('../config');
const adminNotifyService = require('./adminNotifyService');
const messageTemplateService = require('./messageTemplateService');
const telegramApiClient = require('./telegramApiClient');
const userNotificationPreferenceService = require('./userNotificationPreferenceService');
const userReachabilityService = require('./userReachabilityService');
const variantStockSubscriptionService = require('./variantStockSubscriptionService');
const { openShopButton } = require('../utils/miniAppButton');
const { toTelegramHtml } = require('../utils/richHtml');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const MARKETING_NOTIFICATION_TYPES = new Set([
  'announcement',
  'stock_alert',
  'product_new',
  'product_updated',
  'discount',
]);

function shouldRespectTelegramMarketingPreference(type, options = {}) {
  if (options.respectTelegramMarketingPreference === true) return true;
  if (options.respectTelegramMarketingPreference === false) return false;
  return MARKETING_NOTIFICATION_TYPES.has(type);
}

class NotificationService {
  /**
   * @param {object} [options]
   * @param {number} [options.pacingMs=34] Delay between Telegram sends in bulk loops
   *   (Telegram allows ~30 msg/sec). Tests pass 0.
   */
  constructor(bot, { pacingMs = 34 } = {}) {
    this.bot = bot;
    this.pacingMs = pacingMs;
  }

  _pace() {
    return this.pacingMs > 0 ? sleep(this.pacingMs) : undefined;
  }

  // ============================================================
  // Core dispatch
  // ============================================================

  /**
   * Send notification to a user on specified channels.
   *
   * @param {string} body   - Telegram (bot) body, HTML-formatted.
   * @param {string} [webBody] - Separate body stored for the in-app (Mini App)
   *   notification. `undefined` ⇒ reuse `body` (back-compat). `null`/'' ⇒ skip
   *   the web insert entirely (web template disabled).
   */
  async notify(userId, type, title, body, data = {}, channel = 'all', webBody = undefined, extra = {}) {
    let sentTelegram = 0;
    let sentWeb = 0;
    let skippedByPreference = 0;
    const effectiveWeb = webBody === undefined ? body : webBody;
    const { respectTelegramMarketingPreference, ...sendExtra } = extra || {};
    const shouldSendTelegram = (channel === 'all' || channel === 'telegram') && body;
    const telegramAllowed = !shouldSendTelegram
      || !shouldRespectTelegramMarketingPreference(type, { respectTelegramMarketingPreference })
      || userNotificationPreferenceService.isTelegramMarketingEnabled(userId);

    // Telegram
    if (shouldSendTelegram && telegramAllowed) {
      try {
        await telegramApiClient.sendMessage(userId, body, { parse_mode: 'HTML', ...sendExtra });
        sentTelegram = 1;
        userReachabilityService.markReachable(userId);
      } catch (err) {
        console.error(`❌ Notify telegram ${userId}:`, err.message);
        if (userReachabilityService.isPermanentFailure(err)) userReachabilityService.markUnreachable(userId);
      }
    } else if (shouldSendTelegram && !telegramAllowed) {
      skippedByPreference = 1;
    }

    // Web (insert into notifications table)
    if ((channel === 'all' || channel === 'web') && effectiveWeb) {
      db.prepare(`
        INSERT INTO notifications (user_id, type, title, body, data, channel, sent_telegram, sent_web)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `).run(userId, type, title, effectiveWeb, JSON.stringify(data), channel, sentTelegram);
      sentWeb = 1;
    }

    return { sentTelegram, sentWeb, skippedByPreference };
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
   * Notify all bot users when stock is replenished for a product.
   * Targets everyone in the `users` table (anyone who has started the bot) —
   * not just per-product followers — per shop owner's request.
   * Also resets the low-stock alert marker so a fresh alert can fire when
   * the product hits low stock again (next episode).
   *
   * Telegram goes to everyone (users who turned notifications off with
   * /thongbao are skipped by notify()). The in-app (Mini App home) notification
   * is created only for followers of this product/variant — an in-app row per
   * user (~2k per restock) filled the notifications table with unread rows.
   *   - bot.stock_replenished  → Telegram chat message (everyone)
   *   - web.stock_replenished  → Mini App notification body (followers only)
   */
  async notifyStockReplenished(productId, variantId = null) {
    db.prepare('UPDATE products SET last_low_stock_alert_at = NULL WHERE id = ?').run(productId);
    db.prepare(`
      UPDATE low_stock_alert_states
      SET last_alert_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE target_key = ?
    `).run(variantId == null ? `p:${productId}` : `v:${variantId}`);

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) return { sent: 0, failed: 0, total: 0, skipped: 'product_not_found' };

    const variant = variantId == null ? null : db.prepare(`
      SELECT id, name, price
      FROM product_variants
      WHERE id = ? AND product_id = ?
    `).get(variantId, productId);

    const stockCount = variant
      ? db.prepare('SELECT COUNT(*) as c FROM stock WHERE product_id = ? AND variant_id = ? AND is_sold = 0').get(productId, variant.id).c
      : db.prepare('SELECT COUNT(*) as c FROM stock WHERE product_id = ? AND variant_id IS NULL AND is_sold = 0').get(productId).c;

    const recipients = db.prepare('SELECT telegram_id FROM users WHERE telegram_unreachable_at IS NULL').all();

    if (recipients.length === 0) return { sent: 0, failed: 0, total: 0, skipped: 'no_users' };

    const { botBody, webBody, extra } = this._stockReplenishedMessage(product, variant, stockCount);
    if (!botBody && !webBody) {
      return { sent: 0, failed: 0, total: recipients.length, skipped: 'template_disabled' };
    }

    const followerIds = new Set(variantStockSubscriptionService.listFollowerIds({ productId, variantId: variant ? variant.id : null }));
    const recipientIds = new Set(recipients.map((r) => r.telegram_id));
    // Followers that cannot be reached on Telegram still get their in-app row.
    const targetIds = [...recipientIds, ...[...followerIds].filter((id) => !recipientIds.has(id))];
    const data = { product_id: productId, variant_id: variant ? variant.id : null, product_slug: product.slug };

    let sent = 0;
    let failed = 0;
    for (const userId of targetIds) {
      const isFollower = followerIds.has(userId);
      const reachable = recipientIds.has(userId);
      if (!isFollower && !botBody) continue;
      const channel = !reachable ? 'web' : (isFollower ? 'all' : 'telegram');
      try {
        await this.notify(userId, 'stock_alert', 'Sản phẩm có hàng', botBody,
          data, channel, isFollower ? webBody : undefined, extra);
        sent++;
      } catch {
        failed++;
      }
      // Telegram rate limit: ~30 msg/sec — pace individual sends instead of
      // bursting 25 at once then pausing.
      if (reachable && botBody) await this._pace();
    }

    return { sent, failed, total: targetIds.length };
  }

  /**
   * Notify users who tapped "Thông báo khi có hàng" on this variant (Telegram +
   * in-app), then mark their subscription as notified (kept for demand stats).
   * It stays waiting when the Telegram send failed so a transient error does not
   * lose the request. A follower who turned Telegram off (/thongbao) still gets
   * the in-app row and counts as notified.
   */
  async notifySubscribers(variantId) {
    const variant = db.prepare('SELECT id, product_id, name, price FROM product_variants WHERE id = ?').get(variantId);
    if (!variant) return { sent: 0, failed: 0, total: 0, skipped: 'variant_not_found' };
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(variant.product_id);
    if (!product) return { sent: 0, failed: 0, total: 0, skipped: 'product_not_found' };

    const subscriberIds = variantStockSubscriptionService.listSubscriberIds(variantId);
    if (subscriberIds.length === 0) return { sent: 0, failed: 0, total: 0, skipped: 'no_subscribers' };

    const stockCount = db.prepare('SELECT COUNT(*) as c FROM stock WHERE product_id = ? AND variant_id = ? AND is_sold = 0').get(product.id, variant.id).c;
    const { botBody, webBody, extra } = this._stockReplenishedMessage(product, variant, stockCount);
    if (!botBody && !webBody) {
      return { sent: 0, failed: 0, total: subscriberIds.length, skipped: 'template_disabled' };
    }

    let sent = 0;
    let failed = 0;
    for (const userId of subscriberIds) {
      try {
        const result = await this.notify(userId, 'stock_alert', 'Sản phẩm có hàng', botBody,
          { product_id: product.id, variant_id: variant.id, product_slug: product.slug }, 'all', webBody, extra);
        // notify() swallows Telegram errors — only mark the subscription notified
        // once the chat message went out, or the follower opted out of Telegram
        // and got the in-app row instead (in-app only when the chat template is off).
        const delivered = botBody
          ? (result.sentTelegram || (result.skippedByPreference && result.sentWeb))
          : result.sentWeb;
        if (delivered) {
          variantStockSubscriptionService.markNotified(userId, variantId);
          sent++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
      if (botBody) await this._pace();
    }
    return { sent, failed, total: subscriberIds.length };
  }

  _stockReplenishedMessage(product, variant, stockCount) {
    const vars = {
      productEmoji: product.emoji || '📦',
      productName: variant ? `${product.name} - ${variant.name}` : product.name,
      productPrice: this.formatVnd(variant?.price ?? product.price),
      stockCount,
    };
    return {
      botBody: messageTemplateService.renderIfEnabled('bot.stock_replenished', vars),
      webBody: messageTemplateService.renderIfEnabled('web.stock_replenished', vars),
      // "Mở cửa hàng" button → opens the Mini App straight to this product
      // (t.me deeplink; no BotFather domain registration needed, same pattern
      // as /start).
      extra: this._openShopExtra({ payload: `product_${product.slug}` }),
    };
  }

  /**
   * Inline keyboard options that open the Mini App store. Returns {} when no
   * usable link can be built (so the message still sends, just without a button).
   */
  _openShopExtra(options = {}) {
    const button = openShopButton('🛒 Mở cửa hàng', { botUsername: this.bot?.botInfo?.username, payload: options.payload });
    if (!button.web_app && !button.url) return {};
    return {
      reply_markup: {
        inline_keyboard: [[button]],
      },
    };
  }

  _telegramImageUrl(imageUrl) {
    const raw = String(imageUrl || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    const base = (config.WEB_URL || '').replace(/\/$/, '');
    if (!base || !raw.startsWith('/')) return '';
    return `${base}${raw}`;
  }

  formatVnd(amount) {
    const n = Number(amount || 0);
    return `${n.toLocaleString('vi-VN')}đ`;
  }

  async notifyNewProduct(product, adminId = null) {
    const vars = {
      productEmoji: product.emoji || '📦',
      productName: product.name,
      productPrice: this.formatVnd(product.price),
    };
    const botBody = messageTemplateService.renderIfEnabled('bot.product_new', vars);
    const webBody = messageTemplateService.renderIfEnabled('web.product_new', vars);
    if (!botBody && !webBody) return { sent: 0, failed: 0, total: 0, skipped: 'template_disabled' };
    const { reply_markup: replyMarkup } = this._openShopExtra({ payload: `product_${product.slug}` });
    return this.broadcast('Sản phẩm mới', botBody, 'all', adminId, webBody, { notificationType: 'product_new', replyMarkup });
  }

  async notifyProductUpdated(product, adminId = null) {
    const vars = {
      productEmoji: product.emoji || '📦',
      productName: product.name,
      productPrice: this.formatVnd(product.price),
    };
    const botBody = messageTemplateService.renderIfEnabled('bot.product_updated', vars);
    const webBody = messageTemplateService.renderIfEnabled('web.product_updated', vars);
    if (!botBody && !webBody) return { sent: 0, failed: 0, total: 0, skipped: 'template_disabled' };
    const { reply_markup: replyMarkup } = this._openShopExtra({ payload: `product_${product.slug}` });
    return this.broadcast('Cập nhật sản phẩm', botBody, 'all', adminId, webBody, { notificationType: 'product_updated', replyMarkup });
  }

  /**
   * Check and alert admins about low stock products.
   * Called periodically (every 5 minutes). Throttled per product to once
   * per low-stock episode via products.last_low_stock_alert_at — marker
   * cleared on replenish (notifyStockReplenished) or self-heal (this method's
   * opening UPDATE when stock returns above threshold).
  */
  async checkLowStock() {
    const {
      effectiveLowStockProducts,
      effectiveOutOfStockProducts,
      getDefaultLowStockThreshold,
      clearRecoveredLowStockStates,
    } = require('./lowStockQuery');
    const defaultLowStockThreshold = getDefaultLowStockThreshold();

    // Tự phục hồi: xóa marker cảnh báo khi tồn kho đã vượt ngưỡng hiệu lực.
    // Bao phủ các luồng không đi qua notifyStockReplenished như hủy đơn trả key,
    // sửa DB thủ công hoặc restore dữ liệu.
    db.prepare(`
      UPDATE products
      SET last_low_stock_alert_at = NULL
      WHERE last_low_stock_alert_at IS NOT NULL
        AND (
          SELECT COUNT(*) FROM stock s
          WHERE s.product_id = products.id AND s.is_sold = 0
        ) > COALESCE(low_stock_threshold, ?)
    `).run(defaultLowStockThreshold);
    clearRecoveredLowStockStates();

    const outOfStockProducts = effectiveOutOfStockProducts();
    const lowStockProducts = effectiveLowStockProducts();

    if (outOfStockProducts.length === 0 && lowStockProducts.length === 0) return;

    const rawUrl = (config.WEB_URL || '').replace(/\/$/, '');
    // Telegram rejects inline-button URLs that are not publicly resolvable
    // (localhost, private IPs, http on a private host). Detect → drop the
    // button and put the URL inline in the text instead.
    const isPublicUrl = /^https?:\/\/(?!(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.))/.test(rawUrl);
    const alertMeta = (p) => {
      const stockUrl = rawUrl
        ? `${rawUrl}/admin/stock/${p.id}${p.variant_id ? `?variantId=${p.variant_id}` : ''}`
        : '';
      const stockUrlBlock = (stockUrl && !isPublicUrl)
        ? `\n\n🔗 <a href="${stockUrl}">Thêm kho qua dashboard</a>`
        : '';
      const variantLine = p.variant_id
        ? `\n🔖 Biến thể: <b>${messageTemplateService.escapeHtml(p.variant_name || '')}</b>\n🧩 Variant ID: <code>${p.variant_id}</code>`
        : '';
      const buttons = [];
      if (stockUrl && isPublicUrl) {
        buttons.push({ text: `📥 Thêm kho cho #${p.id}`, url: stockUrl });
      }
      return { stockUrlBlock, variantLine, buttons };
    };
    const updateProductAlert = db.prepare(
      'UPDATE products SET last_low_stock_alert_at = CURRENT_TIMESTAMP WHERE id = ?'
    );
    const upsertAlertState = db.prepare(`
      INSERT INTO low_stock_alert_states (
        target_key, target_type, product_id, variant_id, last_alert_at, snoozed_until, updated_at
      )
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP)
      ON CONFLICT(target_key) DO UPDATE SET
        last_alert_at = CURRENT_TIMESTAMP,
        snoozed_until = NULL,
        updated_at = CURRENT_TIMESTAMP
    `);
    const markAlertSent = (p) => {
      if (p.target_key) {
        upsertAlertState.run(p.target_key, p.target_type || 'product', p.id, p.variant_id || null);
      }
      if (p.target_type !== 'variant') {
        updateProductAlert.run(p.id);
      }
    };

    const markOutOfStockAlertSent = db.prepare(`
      UPDATE low_stock_alert_states
      SET out_of_stock_alert_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE target_key = ?
    `);

    for (const p of outOfStockProducts) {
      const { stockUrlBlock, variantLine, buttons } = alertMeta(p);
      const body = messageTemplateService.renderIfEnabled('admin.out_of_stock', {
        productEmoji: p.emoji || '📦',
        productName: p.name,
        productId: p.id,
        variantLine,
        variantName: p.variant_name || '',
        variantId: p.variant_id || '',
        targetType: p.target_type || 'product',
        targetKey: p.target_key || `p:${p.id}`,
        stockUrlBlock,
      });
      if (!body) continue;

      const doneCallback = p.target_type === 'variant'
        ? `outstock_done:v:${p.variant_id}`
        : `outstock_done:p:${p.id}`;
      buttons.push({ text: '✅ Đã up Stock', callback_data: doneCallback });
      const delivered = await adminNotifyService.notify('low_stock', body, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [buttons] },
      });
      if (delivered) markOutOfStockAlertSent.run(p.target_key);
    }

    for (const p of lowStockProducts) {
      const { stockUrlBlock, variantLine, buttons } = alertMeta(p);

      const body = messageTemplateService.renderIfEnabled('admin.low_stock', {
        productEmoji: p.emoji || '📦',
        productName: p.name,
        productId: p.id,
        variantLine,
        variantName: p.variant_name || '',
        variantId: p.variant_id || '',
        targetType: p.target_type || 'product',
        targetKey: p.target_key || `p:${p.id}`,
        stockCount: p.stock_count,
        threshold: p.effective_threshold,
        stockUrlBlock,
      });
      if (!body) { markAlertSent(p); continue; }

      const opts = { parse_mode: 'HTML' };
      const doneCallback = p.target_type === 'variant'
        ? `lowstock_done:v:${p.variant_id}`
        : `lowstock_done:p:${p.id}`;
      buttons.push({ text: '✅ Đã up Stock', callback_data: doneCallback });
      opts.reply_markup = { inline_keyboard: [buttons] };

      try {
        await adminNotifyService.notify('low_stock', body, opts);
        markAlertSent(p);
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
   *
   * The announcement is stored once in `announcements` (the Mini App home
   * carousel reads it). No per-user `notifications` row is created: that was one
   * row per user per broadcast (and per resend) that no screen displayed.
   *
   * @param {string} [webBody] - Fallback text for the stored announcement when
   *   `body` is empty (e.g. a Telegram-disabled template).
   */
  async broadcast(title, body, target = 'all', adminId = null, webBody = undefined, options = {}) {
    const effectiveWeb = (webBody === undefined || webBody === null) ? body : webBody;
    const imageUrl = options.imageUrl ? String(options.imageUrl).trim() : null;
    const telegramImageUrl = this._telegramImageUrl(imageUrl);
    const telegramBody = body ? toTelegramHtml(body) : '';

    // Save announcement
    const result = db.prepare(`
      INSERT INTO announcements (title, body, admin_id, target, image_url)
      VALUES (?, ?, ?, ?, ?)
    `).run(title, body || effectiveWeb || '', adminId || 0, target, imageUrl);

    const announcementId = result.lastInsertRowid;
    const users = db.prepare('SELECT telegram_id, username, notification_prefs FROM users WHERE telegram_unreachable_at IS NULL').all();

    let sent = 0;
    let failed = 0;
    let skippedByPreference = 0;
    const errors = [];

    for (const user of users) {
      // Telegram
      if ((target === 'all' || target === 'telegram') && body) {
        if (!userNotificationPreferenceService.isTelegramMarketingEnabled(user)) {
          skippedByPreference++;
        } else {
          try {
            if (telegramImageUrl) {
              await this.bot.telegram.sendPhoto(user.telegram_id, telegramImageUrl, { caption: telegramBody, parse_mode: 'HTML', ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}) });
            } else {
              await telegramApiClient.sendMessage(user.telegram_id, telegramBody, { parse_mode: 'HTML', ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}) });
            }
            sent++;
            userReachabilityService.markReachable(user.telegram_id);
          } catch (err) {
            failed++;
            if (userReachabilityService.isPermanentFailure(err)) userReachabilityService.markUnreachable(user.telegram_id);
            const msg = (err && (err.description || err.message)) || String(err);
            errors.push({
              userId: user.telegram_id,
              username: user.username || null,
              error: String(msg).slice(0, 300),
              at: new Date().toISOString(),
            });
          }
          // Telegram rate limit: ~30 msg/sec — pace individual sends instead of
          // bursting 25 at once then pausing.
          await this._pace();
        }
      }
    }

    // Update announcement stats + error log
    db.prepare('UPDATE announcements SET sent_count = ?, failed_count = ?, error_details = ? WHERE id = ?')
      .run(sent, failed, errors.length > 0 ? JSON.stringify(errors) : null, announcementId);

    return { announcementId, sent, failed, skippedByPreference, total: users.length, errors };
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
  const telegramApiClient = require('./telegramApiClient');
  const { escapeHtml, richifyText, formatKeysForTelegram, shouldSendAsFile } = require('../utils/messages');
  const dbModule = require('../database');

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
    const finalCaption = fullCaption.length <= 1024 ? fullCaption : minimalCaption;

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
        await telegramApiClient.sendMessage(
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
    });
    try {
      await telegramApiClient.sendMessage(order.user_id, body, sendOpts);
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
