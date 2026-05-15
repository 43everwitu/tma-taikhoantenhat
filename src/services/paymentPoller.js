const config = require('../config');
const orderService = require('./orderService');
const topupService = require('./topupService');
const adminNotifyService = require('./adminNotifyService');
const messageTemplateService = require('./messageTemplateService');
const { formatPrice } = require('../utils/keyboard');
const { escapeHtml, richifyText, formatKeysForTelegram, shouldSendAsFile } = require('../utils/messages');

// Three disjoint regexes — order first (most common), then topup variants.
// Tolerance: case-insensitive (some banks uppercase descriptions, some don't),
// optional single space between prefix and code (banks occasionally insert
// formatting whitespace), 4+ digits min for orders (real ids are 6+ but bank
// truncation has been observed — false positives are still negligible because
// the matcher requires a live order with that payment_code).
//
// - Order code: PNS + pure digits (order ids start at 100000).
// - Topup wallet username: PNS + letter-led username (5–32 chars per Telegram
//   spec). The leading-letter constraint disjoints it from ORDER_CODE_REGEX.
// - Topup wallet fallback: PNSU + telegram_id (5+ digits). Distinct prefix.
const ORDER_CODE_REGEX = /PNS\s?(\d{4,})\b/i;
const TOPUP_USERNAME_REGEX = /PNS\s?([A-Za-z][A-Za-z0-9_]{4,31})\b/i;
const TOPUP_TGID_REGEX = /PNSU\s?(\d{5,})\b/i;

function normalizeCode(raw) {
  // Strip space + uppercase. Order ids are pure digits → no info loss.
  // Topup memos are case-insensitive (Telegram usernames are unique
  // case-insensitively) so uppercasing is safe and lets exact-string
  // comparison work after storing memos uppercased too.
  return raw.replace(/\s+/g, '').toUpperCase();
}

class PaymentPoller {
  constructor(db, bot) {
    this.db = db;
    this.bot = bot;
    this.interval = null;
    this.running = false;
    this.pollCount = 0;
    this.matchCount = 0;

    // Prepared statements for transaction log
    this.insertTransaction = db.prepare(`
      INSERT OR IGNORE INTO transactions
        (mb_transaction_number, amount, description, matched_order_id, matched_payment_code, match_status, raw_data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // Skip a transaction only when it has already been MATCHED. Previously
    // unmatched rows are retried each poll — early polls can store an
    // unmatched row before the corresponding order or its payment_code is
    // visible (race), and we don't want one bad first look to permanently
    // freeze a real payment.
    this.checkTransaction = db.prepare(
      "SELECT id FROM transactions WHERE mb_transaction_number = ? AND match_status = 'matched'"
    );

    // Update an existing unmatched row to matched once it does match.
    this.updateTransactionMatched = db.prepare(`
      UPDATE transactions
      SET matched_order_id = ?, matched_payment_code = ?, match_status = 'matched',
          raw_data = ?
      WHERE mb_transaction_number = ?
    `);
  }

  /**
   * Start the poller if not already running.
   *
   * Behavior: 30s grace before the first MBBank API call (customer needs
   * time to scan + bank-app round-trip), then poll every 30s up to 30
   * attempts (15-minute window — covers the full order_expiry_minutes
   * default of 10 plus headroom). Goes dormant on hit cap or no pending.
   *
   * Called when an order/topup is created and on startup if there are
   * pre-existing pending rows.
   */
  ensureRunning() {
    if (this.running) return;
    const { isAutoPaymentEnabled } = require('./pollerConfig');
    if (!isAutoPaymentEnabled(config.PAYMENT_POLL_ENABLED) || !config.MBBANK_API_TOKEN) {
      return;
    }

    this.running = true;
    this.attempts = 0;
    const initialDelayMs = 30_000;
    const { getPollIntervalMs } = require('./pollerConfig');
    const intervalMs = getPollIntervalMs();
    // 60 × 30s = 30min — covers topup_expiry default (30min) and the longest
    // realistic order_expiry. Earlier 30-cap (15min) silently skipped slow
    // inter-bank topup transfers that settled after 15min.
    const maxAttempts = 60;
    console.log(`💳 Payment poller armed (first check in ${initialDelayMs / 1000}s, then every ${intervalMs / 1000}s up to ${maxAttempts}×)`);

    const tick = async () => {
      if (!this.running) return;
      this.attempts++;
      try { await this._poll(); } catch (e) { console.error('Poll tick error:', e.message); }
      if (this.running && this.attempts >= maxAttempts) {
        console.log(`💳 Payment poller hit ${maxAttempts}-attempt cap; going dormant`);
        this.stop();
        return;
      }
      if (this.running) this.interval = setTimeout(tick, intervalMs);
    };

    this.interval = setTimeout(tick, initialDelayMs);
  }

  /**
   * Stop the poller (go dormant).
   */
  stop() {
    if (!this.running) return;
    if (this.interval) clearTimeout(this.interval);
    this.interval = null;
    this.running = false;
    console.log(`💳 Payment poller stopped (${this.pollCount} polls, ${this.matchCount} matches)`);
  }

  /**
   * Get poller status (for admin dashboard).
   */
  getStatus() {
    return {
      running: this.running,
      pollCount: this.pollCount,
      matchCount: this.matchCount,
      attempts: this.attempts || 0,
      interval: config.PAYMENT_POLL_INTERVAL,
    };
  }

  // ============================================================
  // Internal methods
  // ============================================================

  async _poll() {
    try {
      // Step 1: Get pending + recently-expired orders (24h recovery window) + pending topups
      const pendingOrders = orderService.getActivePending();
      const recentlyExpired = orderService.getRecentlyExpired(24);
      const pendingTopups = topupService.getActivePending();

      if (pendingOrders.length === 0 && recentlyExpired.length === 0 && pendingTopups.length === 0) {
        // Nothing to match — go dormant
        this.stop();
        return;
      }

      this.pollCount++;

      // Step 2: Fetch transactions from MBBank API
      const allOrders = pendingOrders.concat(recentlyExpired);
      const orderMin = allOrders.length ? Math.min(...allOrders.map(o => o.total_price)) : Infinity;
      const topupMin = pendingTopups.length ? Math.min(...pendingTopups.map(t => t.amount)) : Infinity;
      const minAmount = Math.min(orderMin, topupMin);
      const transactions = await this._fetchTransactions(minAmount);

      if (!transactions) return;

      // Step 3: Build lookup maps
      const orderMap = new Map();
      for (const order of allOrders) {
        if (order.payment_code) orderMap.set(order.payment_code, order);
      }
      const topupMap = new Map();
      for (const topup of pendingTopups) {
        topupMap.set(topup.memo, topup);
      }

      // Step 4: Match transactions
      for (const tx of transactions) {
        if (this.checkTransaction.get(tx.transactionNumber)) continue;

        const parsed = this._extractPaymentCode(tx.description);
        if (!parsed) {
          this._logTransaction(tx, null, null, 'unmatched');
          continue;
        }

        if (parsed.kind === 'order') {
          const order = orderMap.get(parsed.value);
          if (order) {
            await this._processOrderMatch(tx, parsed.value, order);
            orderMap.delete(parsed.value);
          } else {
            // Fallback: order is expired/cancelled/already-delivered.
            // Notify admin — bot does NOT auto-credit anymore.
            await this._handleOrphanedOrderTx(tx, parsed.value);
          }
        } else {
          const topup = topupMap.get(parsed.value);
          if (topup) {
            await this._processTopupMatch(tx, parsed.value, topup);
            topupMap.delete(parsed.value);
          } else {
            await this._handleOrphanedTopupTx(tx, parsed.value);
          }
        }
      }

      // Step 5: Expire stale orders + topups
      const expiredOrders = orderService.expireStaleOrders();
      for (const stale of expiredOrders) await this._notifyExpired(stale);
      const expiredTopups = topupService.expireStale();
      for (const stale of expiredTopups) await this._notifyTopupExpired(stale);

      // Step 6: Check if any pending remain
      const remaining = orderService.getActivePending().length + topupService.getActivePending().length;
      if (remaining === 0) this.stop();

    } catch (err) {
      console.error('❌ Payment poll error:', err.message);
    }
  }

  async _fetchTransactions(minAmount) {
    const today = new Date().toISOString().split('T')[0];

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${config.MBBANK_API_URL}/transactions/credit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.MBBANK_API_TOKEN}`,
        },
        body: JSON.stringify({
          from_date: today,
          to_date: today,
          description_contains: 'PNS',
          min_amount: minAmount || 0,
          limit: 100,
          sort_order: 'desc',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        console.error(`❌ MBBank API error: ${response.status}`);
        return null;
      }

      const data = await response.json();
      if (!data.success) {
        console.error('❌ MBBank API returned error:', data);
        return null;
      }

      return data.results || [];
    } catch (err) {
      console.error('❌ MBBank API fetch error:', err.message);
      return null;
    }
  }

  /**
   * Extract payment code from a description, classifying as order|topup.
   * Returns { kind: 'order'|'topup', value: string } or null. Values are
   * normalized (whitespace-stripped, uppercased for orders) so they match
   * the canonical persisted form.
   */
  _extractPaymentCode(description) {
    if (!description) return null;
    const orderMatch = description.match(ORDER_CODE_REGEX);
    if (orderMatch) return { kind: 'order', value: normalizeCode(orderMatch[0]) };
    const tgidMatch = description.match(TOPUP_TGID_REGEX);
    if (tgidMatch) return { kind: 'topup', value: normalizeCode(tgidMatch[0]) };
    const usernameMatch = description.match(TOPUP_USERNAME_REGEX);
    if (usernameMatch) return { kind: 'topup', value: normalizeCode(usernameMatch[0]) };
    return null;
  }

  async _processOrderMatch(tx, paymentCode, order) {
    // If order not provided, look it up
    if (!order) {
      order = orderService.getByPaymentCode(paymentCode);
      if (!order || (order.status !== 'pending' && order.status !== 'expired')) return null;
    }

    // Late-payment recovery: matched order is already expired. Flip it back to
    // 'paid' and continue down the normal deliver path. markRecoveredPaid is
    // a no-op if the status changed under us → safe.
    if (order.status === 'expired') {
      const recovered = orderService.markRecoveredPaid(order.id);
      if (!recovered) {
        console.log(`💸 Recovery skipped for expired order ${order.id} (status changed under us)`);
        return null;
      }
      console.log(`💸 Recovered expired order ${order.id} via late bank transfer`);
      // Patch the in-memory row so downstream short-pay + delivery branches
      // see the correct status (DB write already happened above).
      order.status = 'paid';
    }

    // Short pay — DO NOT auto-credit. Bot policy: only admin may add wallet
    // balance, via /admin/users/<id>/adjust or /admin/topups manual-credit.
    // Log as 'matched' so the poller stops retrying this row, and notify
    // admin so they can decide whether to credit the partial amount.
    if (tx.amount < order.total_price) {
      console.warn(`⚠️ Short payment for ${paymentCode}: ${tx.amount} < ${order.total_price}`);
      const existing = this.db.prepare(
        'SELECT match_status FROM transactions WHERE mb_transaction_number = ?'
      ).get(tx.transactionNumber);
      if (existing) {
        if (existing.match_status !== 'matched') {
          this._markAlreadyProcessed(tx, order.id, paymentCode);
        }
      } else {
        this._logTransaction(tx, order.id, paymentCode, 'matched');
      }
      adminNotifyService.notify('payment_short',
        messageTemplateService.render('admin.payment_short', {
          orderCode: order.id,
          total: formatPrice(order.total_price).replace(/đ$/, ''),
          received: formatPrice(tx.amount).replace(/đ$/, ''),
          memo: paymentCode,
          userMention: String(order.user_id),
          note: 'Bot không tự cộng. Vào /admin/users để cộng thủ công nếu cần.',
        }),
        { parse_mode: 'HTML' });
      await this._notifyCustomer(order.user_id,
        messageTemplateService.render('payment_short', {
          orderCode: order.id,
          total: formatPrice(order.total_price).replace(/đ$/, ''),
          received: formatPrice(tx.amount).replace(/đ$/, ''),
          memo: paymentCode,
        }),
        'HTML');
      return null;
    }

    // Log/upgrade transaction to matched. INSERT OR IGNORE leaves an old
    // unmatched row alone, so explicitly UPDATE it to matched after.
    this._logTransaction(tx, order.id, paymentCode, 'matched');
    this.updateTransactionMatched.run(
      order.id, paymentCode, JSON.stringify(tx), tx.transactionNumber
    );
    orderService.markPaymentMatched(order.id);

    // Over-pay — record the difference but DO NOT auto-credit. Admin sees
    // it in the delivered notification and can manually credit if desired.
    const overpayAmount = tx.amount - order.total_price;

    // Try auto-deliver
    const result = orderService.confirmAndDeliver(order.id, 1);

    if (result.success && result.backorder) {
      this.matchCount++;
      const inputBlock = order.input_value
        ? `\n📝 Thông tin: <code>${(() => {
            try { const { decryptString } = require('../utils/secrets'); return decryptString(order.input_value); } catch { return '(decode err)'; }
          })()}</code>`
        : '';
      adminNotifyService.notify('backorder_paid',
        messageTemplateService.render('admin.backorder_paid', {
          orderCode: order.id,
          productName: result.order.product_name,
          quantity: order.quantity,
          total: formatPrice(order.total_price).replace(/đ$/, ''),
          userMention: String(order.user_id),
          inputBlock,
        }),
        { parse_mode: 'HTML', order_id: order.id });
      // Backorder wait message — admin-configurable via settings.backorder_wait_message
      const dbForSetting = require('../database');
      const settingRow = dbForSetting.prepare("SELECT value FROM settings WHERE key = 'backorder_wait_message'").get();
      const waitMsg = settingRow?.value || 'Đơn này được giao thủ công, shop sẽ xử lý trong ít phút.';
      this._notifyCustomer(order.user_id,
        messageTemplateService.render('bot.backorder_wait', {
          orderCode: order.id,
          waitMsg,
        }),
        'HTML');
      try {
        const orderChannelService = require('./orderChannelService');
        const variantService = require('./variantService');
        const dbMod = require('../database');
        const variant = result.order.variant_id ? variantService.getById(dbMod, result.order.variant_id) : null;
        const productSvc = require('./productService').getById(result.order.product_id);
        await orderChannelService.postOrderCard({ order: result.order, product: productSvc, variant, keys: null });
      } catch (e) { console.error('orderChannelService backorder post failed:', e.message); }
      return result;
    }

    if (result.success) {
      this.matchCount++;
      await this._notifyCustomerDelivered(order, result.accounts);

      const overpayBlock = overpayAmount > 0
        ? `\n\n⚠️ <b>Khách chuyển dư ${formatPrice(overpayAmount)}</b>\nVào /admin/users/${order.user_id}/adjust nếu muốn cộng vào ví.`
        : '';
      const deliveredBody = messageTemplateService.renderIfEnabled('admin.delivered', {
        orderCode: order.id,
        productName: result.order.product_name,
        quantity: order.quantity,
        userMention: String(order.user_id),
        overpayBlock,
      });
      if (deliveredBody) {
        adminNotifyService.notify('delivered', deliveredBody, { parse_mode: 'HTML' });
      }
      try {
        const orderChannelService = require('./orderChannelService');
        const variantService = require('./variantService');
        const dbMod = require('../database');
        const variant = result.order.variant_id ? variantService.getById(dbMod, result.order.variant_id) : null;
        const productSvc = require('./productService').getById(result.order.product_id);
        await orderChannelService.postOrderCard({ order: result.order, product: productSvc, variant, keys: result.accounts });
      } catch (e) { console.error('orderChannelService auto post failed:', e.message); }
      return result;
    }

    // Auto-deliver failed (no stock) — mark as paid, notify admin for manual delivery
    orderService.markPaid(order.id);
    adminNotifyService.notify('no_stock',
      messageTemplateService.render('admin.no_stock', {
        orderCode: order.id,
        productName: order.product_name,
        quantity: order.quantity,
        userMention: String(order.user_id),
      }),
      { parse_mode: 'HTML' });
    this._notifyCustomer(order.user_id,
      messageTemplateService.render('payment_success', {
        orderCode: order.id,
        productName: order.product_name,
        quantity: order.quantity,
        total: formatPrice(order.total_price).replace(/đ$/, ''),
      }) + `\n\n⏳ <i>Hết hàng tạm thời — admin sẽ giao thủ công sớm nhất.</i>`,
      'HTML');
    try {
      const orderChannelService = require('./orderChannelService');
      const productSvc = require('./productService').getById(order.product_id);
      await orderChannelService.postOrderCard({ order, product: productSvc, variant: null, keys: null });
    } catch (e) { console.error('orderChannelService no-stock post failed:', e.message); }

    return null;
  }

  /**
   * Bank transfer references an order code that is no longer pending
   * (expired / cancelled / already delivered). Credit the full amount to
   * the order owner's wallet so their money isn't lost.
   *
   * Idempotency: any row already at status 'matched' for this tx number is
   * treated as already-credited and skipped. If a row exists at status
   * 'unmatched' (e.g. logged on a previous poll before we found the order),
   * we upgrade it via updateTransactionMatched instead of relying on the
   * INSERT OR IGNORE in _logTransaction (which is a no-op for existing rows
   * and would silently leave the status stale, causing repeated credits).
   */
  /**
   * Strict idempotency: ANY existing row for this tx_number means we've
   * already touched this transaction in a prior poll. Even if it was logged
   * 'unmatched' (e.g. by an old version of this code that double-credited),
   * we must NOT credit again — money already moved. We do flip the status
   * to 'matched' so the top-of-loop skip works cleanly going forward.
   */
  _markAlreadyProcessed(tx, refOrderId, refCode) {
    this.updateTransactionMatched.run(refOrderId || null, refCode, JSON.stringify(tx), tx.transactionNumber);
  }

  /**
   * Bank transfer references an order code that is no longer pending
   * (expired / cancelled / already delivered). DO NOT auto-credit. Notify
   * admin and let them adjust the user's balance manually if appropriate.
   */
  async _handleOrphanedOrderTx(tx, paymentCode) {
    const existing = this.db.prepare(
      'SELECT match_status FROM transactions WHERE mb_transaction_number = ?'
    ).get(tx.transactionNumber);
    const order = orderService.getByPaymentCode(paymentCode);

    if (existing) {
      if (existing.match_status !== 'matched') {
        this._markAlreadyProcessed(tx, order?.id, paymentCode);
      }
      return;
    }

    this._logTransaction(tx, order?.id || null, paymentCode, 'matched');

    if (order) {
      adminNotifyService.notify('payment_short',
        messageTemplateService.render('admin.payment_short', {
          orderCode: `${order.id} (status: ${order.status})`,
          total: '—',
          received: formatPrice(tx.amount).replace(/đ$/, ''),
          memo: paymentCode,
          userMention: String(order.user_id),
          note: `Vào /admin/users/${order.user_id}/adjust để cộng thủ công nếu cần.`,
        }),
        { parse_mode: 'HTML' });
    } else {
      adminNotifyService.notify('payment_short',
        messageTemplateService.render('admin.payment_short', {
          orderCode: '—',
          total: '—',
          received: formatPrice(tx.amount).replace(/đ$/, ''),
          memo: paymentCode,
          userMention: '—',
          note: 'Không tìm thấy đơn hàng tương ứng.',
        }),
        { parse_mode: 'HTML' });
    }
  }

  /**
   * Bank transfer references a topup memo with no active pending topup.
   * DO NOT auto-credit. Notify admin only.
   */
  async _handleOrphanedTopupTx(tx, memo) {
    const existing = this.db.prepare(
      'SELECT match_status FROM transactions WHERE mb_transaction_number = ?'
    ).get(tx.transactionNumber);

    if (existing) {
      if (existing.match_status !== 'matched') {
        this._markAlreadyProcessed(tx, null, memo);
      }
      return;
    }

    this._logTransaction(tx, null, memo, 'matched');

    // Try to resolve the user from the memo so the admin notification
    // includes their telegram_id (one-tap link to the adjust page).
    const userId = topupService.resolveUserFromMemo(memo);
    adminNotifyService.notify('payment_short',
      messageTemplateService.render('admin.payment_short', {
        orderCode: `topup memo ${memo}`,
        total: '—',
        received: formatPrice(tx.amount).replace(/đ$/, ''),
        memo,
        userMention: userId ? String(userId) : '—',
        note: 'Bot không tự cộng. Vào /admin/users để xử lý thủ công.',
      }),
      { parse_mode: 'HTML' });
  }

  _logTransaction(tx, orderId, paymentCode, status) {
    this.insertTransaction.run(
      tx.transactionNumber,
      tx.amount,
      tx.description,
      orderId,
      paymentCode,
      status,
      JSON.stringify(tx)
    );
  }

  async _notifyCustomerDelivered(order, accounts) {
    const { sendDelivery } = require('./notificationService');
    await sendDelivery(this.bot, order, accounts, {
      qrChatId: order.qr_chat_id,
      qrMessageId: order.qr_message_id,
    });
  }

  async _notifyCustomer(userId, message, parseMode) {
    const opts = parseMode ? { parse_mode: parseMode } : undefined;
    let sentTelegram = 0;
    try {
      await this.bot.telegram.sendMessage(userId, message, opts);
      sentTelegram = 1;
    } catch (err) {
      console.error(`❌ Cannot notify customer ${userId}:`, err.message);
    }
    this.db.prepare(`
      INSERT INTO notifications (user_id, type, title, body, channel, sent_telegram)
      VALUES (?, 'order_update', 'Cập nhật đơn hàng', ?, 'all', ?)
    `).run(userId, message, sentTelegram);
  }

  async _notifyExpired(order) {
    const body = messageTemplateService.renderIfEnabled('payment_expired', {
      orderCode: order.id,
      productName: order.product_name,
    });
    if (!body) return;
    await this._notifyCustomer(order.user_id, body, 'HTML');
  }

  async _processTopupMatch(tx, memo, topup) {
    // Idempotency
    const existing = this.db.prepare(
      'SELECT match_status FROM transactions WHERE mb_transaction_number = ?'
    ).get(tx.transactionNumber);
    if (existing) {
      if (existing.match_status !== 'matched') {
        this._markAlreadyProcessed(tx, null, memo);
      }
      return null;
    }

    // Bot policy: NO auto-credit. Mark the topup as awaiting admin approval
    // (status 'awaiting_credit'), persist the bank tx for the admin record,
    // notify admin to manually approve via /admin/topups dashboard.
    const ok = topupService.markAwaitingCredit(topup.id, tx.transactionNumber, tx.amount);
    if (!ok) return null;

    this._logTransaction(tx, null, memo, 'matched');
    this.matchCount++;

    // Clean up the QR prompt so the chat stays tidy
    if (topup.qr_chat_id && topup.qr_message_id) {
      try { await this.bot.telegram.deleteMessage(topup.qr_chat_id, topup.qr_message_id); } catch {}
    }

    await this._notifyCustomer(topup.user_id,
      `🏦 <b>Đã nhận chuyển khoản</b>\n\n` +
      `💵 Số tiền: <b>${formatPrice(tx.amount)}</b>\n` +
      `📝 Memo: <code>${memo}</code>\n\n` +
      `Yêu cầu nạp đang chờ admin duyệt. Số dư sẽ được cộng vào ví sau khi admin xác nhận.`,
      'HTML');

    adminNotifyService.notify('payment_short',
      messageTemplateService.render('admin.payment_short', {
        orderCode: `topup #${topup.id}`,
        total: '—',
        received: formatPrice(tx.amount).replace(/đ$/, ''),
        memo,
        userMention: String(topup.user_id),
        note: 'Vào /admin/topups → tab "Chờ duyệt" → nhấn "Cộng".',
      }),
      { parse_mode: 'HTML' });

    return { ok: true };
  }

  async _notifyTopupExpired(topup) {
    await this._notifyCustomer(topup.user_id,
      `⏰ Yêu cầu nạp #${topup.id} (${formatPrice(topup.amount)}) đã hết hạn.\n` +
      `Vui lòng tạo lại bằng <code>/nap ${topup.amount}</code> nếu vẫn muốn nạp.`,
      'HTML');
  }

  async _notifyAdmin(message) {
    try {
      await this.bot.telegram.sendMessage(config.ADMIN_ID, message);
    } catch (err) {
      console.error('❌ Cannot notify admin:', err.message);
    }
  }
}

module.exports = { PaymentPoller };
