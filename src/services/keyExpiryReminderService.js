// Daily sweep: DM customers when their delivered key is N days from expiry.
// N = settings.key_expiry_reminder_days (default 3). Uses stock.duration_days +
// stock.sold_at. Dedupes via stock.reminder_sent_at.

const db = require('../database');

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
    SELECT s.id, s.sold_to, s.product_id, s.sold_at, s.duration_days, p.name AS product_name
    FROM stock s
    JOIN products p ON s.product_id = p.id
    WHERE s.is_sold = 1
      AND s.duration_days IS NOT NULL
      AND s.duration_days > 0
      AND s.reminder_sent_at IS NULL
      AND DATE(s.sold_at, '+' || (s.duration_days - ?) || ' days') <= DATE('now')
      AND DATE(s.sold_at, '+' || s.duration_days || ' days') >= DATE('now')
  `).all(reminderDays);

  const markSent = db.prepare(`UPDATE stock SET reminder_sent_at = CURRENT_TIMESTAMP WHERE id = ?`);

  let sent = 0;
  for (const r of rows) {
    try {
      // Lookup order id for the user/product window (best-effort; one user
      // may have several orders of the same product).
      const order = db.prepare(`
        SELECT id FROM orders
        WHERE user_id = ? AND product_id = ? AND status = 'delivered'
        ORDER BY delivered_at DESC LIMIT 1
      `).get(r.sold_to, r.product_id);
      const expiryDate = db.prepare(
        `SELECT DATE(?, '+' || ? || ' days') AS d`
      ).get(r.sold_at, r.duration_days).d;
      const orderRef = order ? `#${order.id}` : '';
      const body =
        `⏰ <b>Đơn ${orderRef}</b> sắp hết hạn.\n` +
        `📦 ${r.product_name}\n` +
        `📅 Hết hạn: <b>${expiryDate}</b>\n\n` +
        `Gia hạn vui lòng liên hệ ${support}.`;
      await bot.telegram.sendMessage(r.sold_to, body, { parse_mode: 'HTML' });
      markSent.run(r.id);
      sent++;
    } catch (err) {
      console.error(`keyExpiryReminder failed for stock #${r.id}:`, err.message);
    }
  }
  return { sent, scanned: rows.length };
}

function start(b) {
  init(b);
  // Run once at startup (catches missed runs), then every 24h.
  setTimeout(() => sweep().catch(() => {}), 10_000);
  if (timer) clearInterval(timer);
  timer = setInterval(() => sweep().catch(() => {}), 24 * 60 * 60 * 1000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { init, start, stop, sweep };
