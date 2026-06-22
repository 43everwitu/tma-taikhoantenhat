// Daily sweep: DM customers when their delivered key is N days from expiry.
// N = settings.key_expiry_reminder_days (default 3). Uses stock.duration_days +
// stock.sold_at. Dedupes via stock.reminder_sent_at.

const db = require('../database');
const messageTemplateService = require('./messageTemplateService');
const orderExpiryService = require('./orderExpiryService');
const renewalReminderLogService = require('./renewalReminderLogService');

let bot = null;
let timer = null;

function init(b) { bot = b; }

function getReminderDays() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'key_expiry_reminder_days'").get();
  const n = parseInt(row?.value, 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

function getSupportContact() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'support_contact'").get();
  return row?.value || '@admin';
}

async function sweep() {
  if (!bot) return { sent: 0 };
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
          AND r.status = 'exhausted'
      )
      AND DATE(s.sold_at, '+' || (s.duration_days - ?) || ' days') <= DATE('now')
      AND DATE(s.sold_at, '+' || s.duration_days || ' days') >= DATE('now')
  `).all(reminderDays);

  const markSent = db.prepare(`UPDATE stock SET reminder_sent_at = CURRENT_TIMESTAMP WHERE id = ?`);
  const insertNotification = db.prepare(`
    INSERT INTO notifications (user_id, type, title, body, data, channel, sent_telegram, sent_web)
    VALUES (?, 'renewal_reminder', ?, ?, ?, 'all', ?, 1)
  `);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let exhausted = 0;
  for (const r of rows) {
    let order = null;
    let lifecycle = null;
    let body = null;
    const expiryDate = db.prepare(
      `SELECT DATE(?, '+' || ? || ' days') AS d`
    ).get(r.sold_at, r.duration_days).d;

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

    try {
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
        skipped++;
        continue;
      }
      await bot.telegram.sendMessage(r.sold_to, body, { parse_mode: 'HTML' });
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
      markSent.run(r.id);
      sent++;
    } catch (err) {
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
      } catch {}
      failed++;
      console.error(`keyExpiryReminder failed for stock #${r.id}:`, err.message);
    }
  }
  return { scanned: rows.length, sent, skipped, failed, exhausted };
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
