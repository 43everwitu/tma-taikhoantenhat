const { Router } = require('express');
const { z } = require('zod');
const db = require('../../../database');
const orderService = require('../../../services/orderService');
const auditService = require('../../../services/auditService');
const { validate } = require('../../middleware/validate');
const { deliverOrder } = require('../../../services/orderFulfillmentService');

const router = Router();

function shapeOrder(r) {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    userName: r.user_name || r.username || '',
    username: r.username || '',
    productId: r.product_id,
    productName: r.product_name || '',
    quantity: r.quantity,
    totalPrice: r.total_price,
    status: r.status,
    paymentCode: r.payment_code || '',
    bankName: r.bank_name || '',
    source: r.source || '',
    createdAt: r.created_at,
    paidAt: r.paid_at,
    deliveredAt: r.delivered_at,
    expiresAt: r.expires_at,
  };
}

// GET /admin/orders?status=pending&page=1&limit=20&from=&to=&userId=
router.get('/', (req, res) => {
  const status = req.query.status;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const { from, to, userId } = req.query;

  let where = '1=1';
  const params = [];

  if (status) { where += ' AND o.status = ?'; params.push(status); }
  if (from) { where += ' AND o.created_at >= ?'; params.push(from); }
  if (to) { where += " AND o.created_at <= (? || ' 23:59:59')"; params.push(to); }
  if (userId) { where += ' AND o.user_id = ?'; params.push(parseInt(userId)); }

  const q = (req.query.q || '').trim();
  if (q) {
    where += ` AND (
      CAST(o.id AS TEXT) LIKE ?
      OR o.payment_code LIKE ?
      OR u.full_name LIKE ?
      OR u.username LIKE ?
      OR CAST(o.user_id AS TEXT) LIKE ?
      OR p.name LIKE ?
    )`;
    const wild = `%${q}%`;
    params.push(wild, wild, wild, wild, wild, wild);
  }

  const rows = db.prepare(`
    SELECT o.*, p.name as product_name, u.full_name as user_name, u.username
    FROM orders o
    JOIN products p ON o.product_id = p.id
    LEFT JOIN users u ON o.user_id = u.telegram_id
    WHERE ${where}
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`
    SELECT COUNT(*) as c
    FROM orders o
    JOIN products p ON o.product_id = p.id
    LEFT JOIN users u ON o.user_id = u.telegram_id
    WHERE ${where}
  `).all(...params)[0].c;

  res.json({
    success: true,
    data: { orders: rows.map(shapeOrder), total, page, limit },
  });
});

// GET /admin/orders/:id
router.get('/:id', (req, res) => {
  const order = orderService.getById(parseInt(req.params.id));
  if (!order) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Đơn hàng không tồn tại' } });

  const shaped = shapeOrder(order);

  // Include delivered accounts scoped to this order's delivery window so
  // repeat purchases of the same product show the right keys per order.
  if (order.status === 'delivered' && order.delivered_at) {
    const accounts = db.prepare(`
      SELECT data FROM stock
      WHERE sold_to = ? AND product_id = ? AND sold_at <= ?
      ORDER BY sold_at DESC LIMIT ?
    `).all(order.user_id, order.product_id, order.delivered_at, order.quantity);
    shaped.accounts = accounts.map(a => a.data);
  }

  res.json({ success: true, data: shaped });
});

// POST /admin/orders/:id/confirm — Confirm and auto-deliver
router.post('/:id/confirm', async (req, res) => {
  const id = parseInt(req.params.id);
  const bot = req.app.get('bot');
  if (!bot) return res.status(500).json({ success: false, error: { code: 'BOT_UNAVAILABLE' } });
  const result = await deliverOrder(bot, id);
  if (!result.success) return res.status(400).json({ success: false, error: { code: 'DELIVERY_FAILED', message: result.error } });
  auditService.log(req.admin.adminId, 'order.confirm', 'order', id, null, req.ip);
  res.json({ success: true, data: result.order });
});

// POST /admin/orders/:id/manual-deliver
router.post('/:id/manual-deliver', validate(z.object({
  accounts: z.array(z.string().min(1)).min(1),
})), (req, res) => {
  const orderId = parseInt(req.params.id);
  const order = orderService.getById(orderId);

  if (!order) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Đơn hàng không tồn tại' } });
  if (order.status !== 'pending' && order.status !== 'paid') {
    return res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: 'Đơn đã được xử lý' } });
  }

  orderService.markPaid(orderId);
  db.prepare("UPDATE orders SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP WHERE id = ?").run(orderId);

  auditService.log(req.admin.adminId, 'order.manual_deliver', 'order', orderId, { accountCount: req.validated.accounts.length }, req.ip);

  // Send accounts to customer
  const bot = req.app.get('bot');
  if (bot) {
    const accountList = req.validated.accounts.map((a, i) => `${i + 1}. ${a}`).join('\n');
    const msg = `✅ Đơn #${orderId} đã được giao!\n\n🔑 Thông tin tài khoản:\n${accountList}`;
    bot.telegram.sendMessage(order.user_id, msg).catch(() => {});
  }

  res.json({ success: true, data: { orderId } });
});

// POST /admin/orders/:id/resend-keys — re-send delivered keys snapshot to customer
router.post('/:id/resend-keys', async (req, res) => {
  const id = parseInt(req.params.id);
  const order = orderService.getById(id);
  if (!order) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  if (order.status !== 'delivered') {
    return res.status(400).json({ success: false, error: { code: 'NOT_DELIVERED', message: `Đơn ở trạng thái ${order.status}` } });
  }

  const accounts = orderService.getDeliveredKeys(id);
  if (!accounts || accounts.length === 0) {
    return res.status(404).json({ success: false, error: { code: 'NO_KEYS_SNAPSHOT', message: 'Đơn này không có snapshot key (giao trước migration 009).' } });
  }

  const bot = req.app.get('bot');
  if (!bot) return res.status(500).json({ success: false, error: { code: 'BOT_UNAVAILABLE' } });

  const accountList = accounts.map((a, i) => `${i + 1}. ${a}`).join('\n');
  const message = `🔁 <b>GỬI LẠI KEY ĐƠN #${id}</b>\n\n` +
    `📦 ${order.product_name}\n📋 SL: ${order.quantity}\n\n` +
    `🔑 Tài khoản:\n${accountList}`;
  try {
    await bot.telegram.sendMessage(order.user_id, message, { parse_mode: 'HTML' });
  } catch (err) {
    return res.status(502).json({ success: false, error: { code: 'TELEGRAM_FAILED', message: err.message } });
  }

  orderService.markKeysResent(id);
  auditService.log(req.admin.adminId, 'order.resend_keys', 'order', id, { count: accounts.length }, req.ip);
  res.json({ success: true, data: { orderId: id, sent: accounts.length } });
});

// POST /admin/orders/:id/cancel
router.post('/:id/cancel', (req, res) => {
  const id = parseInt(req.params.id);
  const order = orderService.getById(id);
  if (!order) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  const cancelled = orderService.cancel(id);
  if (!cancelled) return res.status(409).json({ success: false, error: { code: 'INVALID_STATE', message: 'Đơn không thể hủy' } });
  auditService.log(req.admin.adminId, 'order.cancel', 'order', id, null, req.ip);
  res.json({ success: true });
});

// GET /admin/orders/export?status=&from=&to=
router.get('/export', (req, res) => {
  const { status, from, to } = req.query;
  let where = '1=1';
  const params = [];

  if (status) { where += ' AND o.status = ?'; params.push(status); }
  if (from) { where += ' AND o.created_at >= ?'; params.push(from); }
  if (to) { where += " AND o.created_at <= ? || ' 23:59:59'"; params.push(to); }

  const rows = db.prepare(`
    SELECT o.id, o.user_id, u.full_name, p.name as product, o.quantity, o.total_price, o.status, o.payment_code, o.source, o.created_at, o.delivered_at
    FROM orders o
    JOIN products p ON o.product_id = p.id
    JOIN users u ON o.user_id = u.telegram_id
    WHERE ${where}
    ORDER BY o.created_at DESC
  `).all(...params);

  // CSV
  const header = 'ID,User ID,User,Product,Qty,Price,Status,Payment Code,Source,Created,Delivered\n';
  const csv = rows.map(r =>
    `${r.id},${r.user_id},"${r.full_name}","${r.product}",${r.quantity},${r.total_price},${r.status},${r.payment_code || ''},${r.source || ''},${r.created_at || ''},${r.delivered_at || ''}`
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');
  res.send(header + csv);
});

module.exports = router;
