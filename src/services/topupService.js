const db = require('../database');
const userService = require('./userService');

function readSettingInt(key, fallback) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!r) return fallback;
  const n = parseInt(r.value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const topupService = {
  /**
   * Build memo from telegram user. Stable for the lifetime of the topup.
   * Stored UPPERCASE so case-insensitive bank descriptions still match
   * (Telegram usernames are unique case-insensitively, so no info loss).
   */
  buildMemo({ telegram_id, username }) {
    return username && username.length >= 5
      ? `PNS${username}`.toUpperCase()
      : `PNSU${telegram_id}`;
  },

  /**
   * Create a pending topup. Returns { id, memo, expiresAt }.
   */
  create({ telegram_id, username, amount, expiryMinutes }) {
    const memo = this.buildMemo({ telegram_id, username });
    const minutes = expiryMinutes ?? readSettingInt('topup_expiry_minutes', 30);

    const result = db.prepare(`
      INSERT INTO wallet_topups (user_id, amount, memo, expires_at)
      VALUES (?, ?, ?, datetime('now', '+' || ? || ' minutes'))
    `).run(telegram_id, amount, memo, minutes);

    const row = db.prepare('SELECT * FROM wallet_topups WHERE id = ?').get(result.lastInsertRowid);
    return { id: row.id, memo: row.memo, expiresAt: row.expires_at, raw: row };
  },

  /**
   * Persist QR message coords so the bot can clean up the prompt later.
   */
  setQrMessage(id, chatId, messageId) {
    db.prepare(
      'UPDATE wallet_topups SET qr_chat_id = ?, qr_message_id = ? WHERE id = ?'
    ).run(chatId, messageId, id);
  },

  getById(id) {
    return db.prepare('SELECT * FROM wallet_topups WHERE id = ?').get(id);
  },

  /**
   * For the poller: pending topups not yet expired.
   */
  getActivePending() {
    return db.prepare(`
      SELECT * FROM wallet_topups
      WHERE status = 'pending'
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY requested_at ASC
    `).all();
  },

  /**
   * Look up the active pending topup matching the memo (case-insensitive).
   */
  getByMemo(memo) {
    return db.prepare(`
      SELECT * FROM wallet_topups
      WHERE UPPER(memo) = UPPER(?) AND status = 'pending'
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY requested_at DESC
      LIMIT 1
    `).get(memo);
  },

  /**
   * Look up the most recent topup for a memo regardless of status — used by
   * the poller to discover the user_id when a transfer arrives after the
   * topup expired/cancelled, so we can still credit their wallet.
   */
  getAnyByMemo(memo) {
    return db.prepare(`
      SELECT * FROM wallet_topups
      WHERE UPPER(memo) = UPPER(?)
      ORDER BY requested_at DESC
      LIMIT 1
    `).get(memo);
  },

  /**
   * Resolve user_id from a memo when there's no topup row at all (e.g. user
   * reuses their old QR after we cleaned up). Decodes PNSU<digits> directly
   * and falls back to looking up by username for PNS<username>.
   */
  resolveUserFromMemo(memo) {
    const upper = memo.toUpperCase();
    const tgidMatch = upper.match(/^PNSU(\d+)$/);
    if (tgidMatch) return parseInt(tgidMatch[1]);
    const usernameMatch = upper.match(/^PNS([A-Z0-9_]+)$/);
    if (usernameMatch) {
      const username = usernameMatch[1];
      const u = db.prepare(
        'SELECT telegram_id FROM users WHERE UPPER(username) = UPPER(?)'
      ).get(username);
      return u ? u.telegram_id : null;
    }
    return null;
  },

  /**
   * Credit a user's wallet from a bank transfer that landed outside any
   * active topup window (memo matched an expired/cancelled topup, no topup
   * row, or matched an order that's no longer pending). Atomic: addBalance
   * + audit notification.
   * @param {object} opts - { memo, amount, txNumber, userId? }
   *   userId optional — if known (e.g. caller already resolved via order
   *   payment_code), passed directly. Otherwise resolved from memo.
   * Returns { newBalance, userId } or null if user couldn't be resolved.
   */
  creditOrphanedTransfer({ memo, amount, txNumber, userId }) {
    if (!userId) {
      const existing = this.getAnyByMemo(memo);
      if (existing) userId = existing.user_id;
    }
    if (!userId) userId = this.resolveUserFromMemo(memo);
    if (!userId) return null;

    const tx = db.transaction(() => {
      userService.addBalance(userId, amount);
      const newBalance = db.prepare(
        'SELECT balance FROM users WHERE telegram_id = ?'
      ).get(userId).balance;

      db.prepare(`
        INSERT INTO notifications (user_id, type, title, body, channel, sent_telegram, sent_web)
        VALUES (?, 'wallet_credit', 'Đã cộng vào ví', ?, 'all', 0, 1)
      `).run(userId,
        `💰 Đã cộng ${amount.toLocaleString('vi')}đ vào ví (chuyển khoản ${txNumber}). Số dư mới: ${newBalance.toLocaleString('vi')}đ.`);

      return { userId, newBalance };
    });
    return tx();
  },

  getMinAmount() {
    return readSettingInt('topup_min_amount', 10000);
  },

  /**
   * Bot saw the bank transfer for this topup but does NOT auto-credit.
   * Move the row to 'awaiting_credit' and stash the bank tx + actual amount
   * so the admin dashboard can show + manually credit it.
   */
  markAwaitingCredit(id, txNumber, actualAmount) {
    const r = db.prepare(`
      UPDATE wallet_topups
      SET status = 'awaiting_credit',
          mb_transaction_number = ?,
          actual_amount = ?
      WHERE id = ? AND status = 'pending'
    `).run(txNumber, actualAmount, id);
    return r.changes > 0;
  },

  /**
   * Atomically mark matched + credit balance + persist notification. Used by
   * admin manual-credit and by legacy auto-credit paths.
   * Allows source status of 'pending' OR 'awaiting_credit' (bot-detected).
   */
  markMatched(id, txNumber, actualAmount) {
    const tx = db.transaction(() => {
      const row = db.prepare(
        "SELECT * FROM wallet_topups WHERE id = ? AND status IN ('pending', 'awaiting_credit')"
      ).get(id);
      if (!row) return null;

      db.prepare(`
        UPDATE wallet_topups
        SET status = 'matched',
            matched_at = CURRENT_TIMESTAMP,
            mb_transaction_number = ?,
            actual_amount = ?
        WHERE id = ?
      `).run(txNumber, actualAmount, id);

      userService.addBalance(row.user_id, actualAmount);

      const newBalance = db.prepare(
        'SELECT balance FROM users WHERE telegram_id = ?'
      ).get(row.user_id).balance;

      return { ...row, actualAmount, newBalance };
    });
    return tx();
  },

  /**
   * Mark expired (called by poller for stale rows).
   */
  expireStale() {
    const stale = db.prepare(`
      SELECT * FROM wallet_topups
      WHERE status = 'pending'
        AND expires_at IS NOT NULL
        AND expires_at <= datetime('now')
    `).all();

    if (stale.length > 0) {
      const expire = db.prepare("UPDATE wallet_topups SET status = 'expired' WHERE id = ?");
      const expireAll = db.transaction(() => {
        for (const row of stale) expire.run(row.id);
      });
      expireAll();
    }
    return stale;
  },

  cancel(id, reason) {
    const r = db.prepare(
      "UPDATE wallet_topups SET status = 'cancelled', cancel_reason = ? WHERE id = ? AND status = 'pending'"
    ).run(reason || null, id);
    return r.changes > 0;
  },

  /**
   * Admin-side manual credit for a stuck topup (uses sentinel tx number).
   */
  manualCredit(id, adminId) {
    const sentinel = `MANUAL-${adminId}-${Date.now()}`;
    const result = this.markMatched(id, sentinel, this.getById(id)?.amount || 0);
    if (!result) return null;
    // Return amount = credited (bank-side) amount for the topup_success template,
    // plus requestedAmount for audit. For manualCredit the two are equal.
    return { amount: result.actualAmount, requestedAmount: result.amount, newBalance: result.newBalance };
  },
};

module.exports = topupService;
