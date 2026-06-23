// Daily sweep: DM customers when their delivered key is N days from expiry.
// N = settings.key_expiry_reminder_days (default 3). Uses stock.duration_days +
// stock.sold_at. Dedupes via stock.reminder_sent_at.

const db = require('../database');
const messageTemplateService = require('./messageTemplateService');
const orderExpiryService = require('./orderExpiryService');
const renewalReminderLogService = require('./renewalReminderLogService');

let bot = null;
let timer = null;
let inFlightSweep = null;
const confirmedSentStockIds = new Set();
const MAX_PERSIST_ATTEMPTS = 3;

function init(b) { bot = b; }

function emptySummary() {
  return { scanned: 0, sent: 0, skipped: 0, failed: 0, exhausted: 0 };
}

function getReminderDays() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'key_expiry_reminder_days'").get();
  const n = parseInt(row?.value, 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

function getSupportContact() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'support_contact'").get();
  return row?.value || '@admin';
}

async function runSweep() {
  if (!bot) return emptySummary();
  const reminderDays = getReminderDays();
  const support = getSupportContact();

  // Pick rows whose computed expiry hits today + reminderDays.
  const rows = db.prepare(`
    SELECT
      s.id,
      s.sold_to,
      s.product_id,
      s.variant_id,
      s.data,
      s.sold_at,
      s.duration_days,
      p.name AS product_name
    FROM stock s
    JOIN products p ON s.product_id = p.id
    WHERE s.is_sold = 1
      AND s.duration_days IS NOT NULL
      AND s.duration_days > 0
      AND s.reminder_sent_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM renewal_reminder_logs r
        WHERE r.stock_id = s.id
          AND r.status IN ('sent', 'sent_legacy', 'skipped', 'exhausted')
      )
      AND DATE(s.sold_at, '+' || (s.duration_days - ?) || ' days') <= DATE('now')
      AND DATE(s.sold_at, '+' || s.duration_days || ' days') >= DATE('now')
  `).all(reminderDays);

  const markSent = db.prepare(`UPDATE stock SET reminder_sent_at = CURRENT_TIMESTAMP WHERE id = ?`);
  const insertNotification = db.prepare(`
    INSERT INTO notifications (user_id, type, title, body, data, channel, sent_telegram, sent_web)
    VALUES (?, 'renewal_reminder', ?, ?, ?, 'all', ?, 1)
  `);
  const getExpiryDate = db.prepare(
    `SELECT DATE(?, '+' || ? || ' days') AS d`
  );
  const persistSkipped = db.transaction((r, order, lifecycle, expiryDate) => {
    renewalReminderLogService.insertLog({
      stockId: r.id,
      orderId: order?.id ?? null,
      userId: r.sold_to,
      productId: r.product_id,
      productName: r.product_name,
      expiryDate,
      daysBeforeExpiry: lifecycle?.remainingDays ?? null,
      status: 'skipped',
      errorMessage: 'Template bot.expiry_reminder disabled',
    });
    markSent.run(r.id);
  });
  const persistSuccessfulSend = db.transaction((r, order, lifecycle, expiryDate, body) => {
    let notificationId = null;
    if (order && lifecycle?.renewUrl) {
      const notificationBody = `Đơn #${order.id} còn ${Math.max(0, lifecycle.remainingDays)} ngày sử dụng. Gia hạn trước ${lifecycle.expiryDate} để tránh gián đoạn.`;
      const notification = insertNotification.run(
        r.sold_to,
        `${r.product_name} sắp hết hạn`,
        notificationBody,
        JSON.stringify({
          orderId: String(order.id),
          productId: String(r.product_id),
          productSlug: lifecycle.productSlug,
          expiryDate: lifecycle.expiryDate,
          remainingDays: lifecycle.remainingDays,
          renewUrl: lifecycle.renewUrl,
          orderUrl: lifecycle.orderUrl,
        }),
        1,
      );
      notificationId = notification.lastInsertRowid;
    }
    renewalReminderLogService.insertLog({
      stockId: r.id,
      orderId: order?.id ?? null,
      userId: r.sold_to,
      productId: r.product_id,
      productName: r.product_name,
      expiryDate: lifecycle?.expiryDate ?? expiryDate,
      daysBeforeExpiry: lifecycle?.remainingDays ?? null,
      telegramSent: 1,
      webNotificationId: notificationId,
      status: 'sent',
      messageBody: body,
    });
  });
  const retryPersistence = (operation, description, stockId) => {
    let lastError;
    for (let attempt = 1; attempt <= MAX_PERSIST_ATTEMPTS; attempt++) {
      try {
        return operation();
      } catch (err) {
        lastError = err;
        console.error(
          `keyExpiryReminder ${description} failed for stock #${stockId} (attempt ${attempt}/${MAX_PERSIST_ATTEMPTS}):`,
          err.message,
        );
      }
    }
    throw lastError;
  };

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let exhausted = 0;
  for (const r of rows) {
    let order = null;
    let lifecycle = null;
    let body = null;
    let expiryDate = null;

    if (confirmedSentStockIds.has(r.id)) {
      console.error(
        `keyExpiryReminder skipped stock #${r.id}: Telegram send was confirmed but database recovery is still pending`,
      );
      continue;
    }

    try {
      expiryDate = getExpiryDate.get(r.sold_at, r.duration_days).d;
      if (
        renewalReminderLogService.countFailedAttempts(r.id)
        >= renewalReminderLogService.MAX_FAILED_ATTEMPTS
      ) {
        if (!renewalReminderLogService.hasExhausted(r.id)) {
          renewalReminderLogService.insertLog({
            stockId: r.id,
            userId: r.sold_to,
            productId: r.product_id,
            productName: r.product_name,
            expiryDate,
            status: 'exhausted',
            errorMessage: `Reached ${renewalReminderLogService.MAX_FAILED_ATTEMPTS} failed reminder attempts`,
          });
        }
        exhausted++;
        continue;
      }

      // Lookup order id for the user/product window (best-effort; one user
      // may have several orders of the same product).
      order = orderExpiryService.findDeliveredOrderForStock(r);
      lifecycle = orderExpiryService.getKeyLifecycleForStock(r, order);
      const orderRef = order ? `#${order.id}` : '';
      body = messageTemplateService.renderIfEnabled('bot.expiry_reminder', {
        orderRef,
        productName: r.product_name,
        expiryDate,
        supportContact: support,
      });
      if (!body) {
        persistSkipped(r, order, lifecycle, expiryDate);
        skipped++;
        continue;
      }
    } catch (err) {
      console.error(`keyExpiryReminder preflight failed for stock #${r.id}:`, err.message);
      failed++;
      continue;
    }

    try {
      await bot.telegram.sendMessage(r.sold_to, body, { parse_mode: 'HTML' });
    } catch (err) {
      failed++;
      try {
        renewalReminderLogService.insertLog({
          stockId: r.id,
          orderId: order?.id ?? null,
          userId: r.sold_to,
          productId: r.product_id,
          productName: r.product_name,
          expiryDate: lifecycle?.expiryDate ?? expiryDate,
          daysBeforeExpiry: lifecycle?.remainingDays ?? null,
          status: 'failed',
          errorMessage: err.message,
          messageBody: body,
        });
      } catch (logError) {
        console.error(
          `keyExpiryReminder Telegram failure log could not be persisted for stock #${r.id}:`,
          logError.message,
        );
        continue;
      }
      console.error(`keyExpiryReminder Telegram send failed for stock #${r.id}:`, err.message);
      continue;
    }

    confirmedSentStockIds.add(r.id);
    let auditPersisted = false;
    try {
      retryPersistence(
        () => persistSuccessfulSend(r, order, lifecycle, expiryDate, body),
        'Telegram sent but persistence',
        r.id,
      );
      auditPersisted = true;
      confirmedSentStockIds.delete(r.id);
    } catch (err) {
      console.error(
        `keyExpiryReminder Telegram sent but notification/log persistence failed after ${MAX_PERSIST_ATTEMPTS} attempts for stock #${r.id}; falling back to sent marker:`,
        err.message,
      );
    }

    try {
      retryPersistence(
        () => markSent.run(r.id),
        'sent-marker persistence',
        r.id,
      );
      confirmedSentStockIds.delete(r.id);
    } catch (err) {
      const durability = auditPersisted
        ? 'sent log remains durable'
        : 'no durable database dedupe; in-memory guard retained';
      console.error(
        `keyExpiryReminder Telegram sent but could not persist sent marker after ${MAX_PERSIST_ATTEMPTS} attempts for stock #${r.id}; ${durability}:`,
        err.message,
      );
    }
    sent++;
  }
  return { scanned: rows.length, sent, skipped, failed, exhausted };
}

function sweep() {
  if (inFlightSweep) return inFlightSweep;
  inFlightSweep = runSweep().finally(() => {
    inFlightSweep = null;
  });
  return inFlightSweep;
}

// Compute ms until next 09:00 Asia/Ho_Chi_Minh (UTC+7, no DST).
function msUntilNext9amICT() {
  const now = Date.now();
  // 09:00 ICT = 02:00 UTC.
  const utcNow = new Date(now);
  const target = new Date(Date.UTC(
    utcNow.getUTCFullYear(),
    utcNow.getUTCMonth(),
    utcNow.getUTCDate(),
    2, 0, 0, 0, // 02:00 UTC = 09:00 ICT
  ));
  if (target.getTime() <= now) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() - now;
}

function start(b) {
  init(b);
  // First catch-up sweep 10s after boot for missed-while-down orders.
  setTimeout(() => sweep().catch(() => {}), 10_000);
  if (timer) clearTimeout(timer);
  const armDaily = () => {
    timer = setTimeout(async () => {
      await sweep().catch(() => {});
      armDaily();
    }, msUntilNext9amICT());
  };
  armDaily();
}

function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = { init, start, stop, sweep };
