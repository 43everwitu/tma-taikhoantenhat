const { Router } = require('express');
const { z } = require('zod');
const db = require('../../../database');
const orderService = require('../../../services/orderService');
const orderNoteService = require('../../../services/orderNoteService');
const auditService = require('../../../services/auditService');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/auth');
const { deliverOrder } = require('../../../services/orderFulfillmentService');
const { getKeyLifecycleForOrder } = require('../../../services/orderExpiryService');
const telegramApiClient = require('../../../services/telegramApiClient');
const { scheduleTwofaBindingSync } = require('../../../services/twofaBindingService');

const router = Router();

function shapeOrder(r) {
  let keyExpiresAt = null;
  let keyExpired = false;
  if (r.status === 'delivered') {
    const lifecycle = getKeyLifecycleForOrder(r);
    if (lifecycle) {
      keyExpiresAt = lifecycle.expiryDate;
      keyExpired = lifecycle.status === 'expired';
    }
  }
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
    deletedAt: r.deleted_at,
    deletedBy: r.deleted_by,
    keyExpiresAt,
    keyExpired,
    hasCustomerInput: !!r.input_value,
    noteCount: Number(r.note_count || 0),
    latestNoteAt: r.latest_note_at || null,
  };
}

function variantLabel(name) {
  return name?.trim() || 'mặc định/legacy';
}

function getOrderCustomer(order) {
  const customer = db.prepare(`
    SELECT telegram_id, full_name, username
    FROM users
    WHERE telegram_id = ?
  `).get(order.user_id);

  return {
    telegramId: String(customer?.telegram_id ?? order.user_id),
    fullName: customer?.full_name ?? null,
    username: customer?.username ?? null,
  };
}

function getOrderProduct(order) {
  const product = db.prepare(`
    SELECT p.id, p.name, v.id AS variant_id, v.name AS variant_name
    FROM products p
    LEFT JOIN product_variants v
      ON v.id = ? AND v.product_id = p.id
    WHERE p.id = ?
  `).get(order.variant_id ?? null, order.product_id);

  if (!product) return null;
  return {
    id: String(product.id),
    name: product.name,
    variantId: order.variant_id == null ? null : String(order.variant_id),
    variantName: product.variant_name || null,
    variantLabel: variantLabel(product.variant_name),
  };
}

function getOrderStockItems(order, accounts) {
  let snapshot = [];
  try {
    const parsed = JSON.parse(order.delivered_keys_json || '[]');
    if (Array.isArray(parsed)) snapshot = parsed.filter(value => typeof value === 'string');
  } catch {}

  const stockSelect = `
    SELECT
      s.id,
      s.data,
      s.variant_id,
      v.name AS variant_name,
      s.sold_at,
      s.duration_days,
      CASE
        WHEN s.sold_at IS NOT NULL AND s.duration_days IS NOT NULL
        THEN DATE(s.sold_at, '+' || s.duration_days || ' days')
        ELSE NULL
      END AS expires_at,
      CASE
        WHEN s.sold_at IS NOT NULL AND s.duration_days IS NOT NULL
        THEN DATE(s.sold_at, '+' || s.duration_days || ' days') < DATE('now')
        ELSE 0
      END AS expired
    FROM stock s
    LEFT JOIN product_variants v ON v.id = s.variant_id
  `;
  let rows;
  if (snapshot.length > 0 && accounts?.length > 0) {
    const placeholders = accounts.map(() => '?').join(', ');
    rows = db.prepare(`
      ${stockSelect}
      WHERE s.sold_to = ?
        AND s.product_id = ?
        AND s.data IN (${placeholders})
      ORDER BY
        CASE
          WHEN ? IS NOT NULL AND s.sold_at <= ? THEN 0
          ELSE 1
        END,
        CASE
          WHEN ? IS NOT NULL
          THEN ABS(strftime('%s', s.sold_at) - strftime('%s', ?))
          ELSE 0
        END,
        s.id DESC
      LIMIT ?
    `).all(
      order.user_id,
      order.product_id,
      ...accounts,
      order.delivered_at,
      order.delivered_at,
      order.delivered_at,
      order.delivered_at,
      order.quantity,
    );
  } else {
    const variantWhere = order.variant_id == null
      ? 's.variant_id IS NULL'
      : 's.variant_id = ?';
    const variantParams = order.variant_id == null ? [] : [order.variant_id];
    const deliveredWhere = order.delivered_at ? 'AND s.sold_at <= ?' : '';
    const deliveredParams = order.delivered_at ? [order.delivered_at] : [];
    rows = db.prepare(`
      ${stockSelect}
      WHERE s.sold_to = ?
        AND s.product_id = ?
        AND s.is_sold = 1
        AND ${variantWhere}
        ${deliveredWhere}
      ORDER BY s.sold_at DESC, s.id DESC
      LIMIT ?
    `).all(
      order.user_id,
      order.product_id,
      ...variantParams,
      ...deliveredParams,
      order.quantity,
    );
  }

  return rows.map(row => ({
    id: String(row.id),
    value: row.data,
    variantId: row.variant_id == null ? null : String(row.variant_id),
    variantName: row.variant_name || null,
    soldAt: row.sold_at,
    durationDays: row.duration_days,
    expiresAt: row.expires_at,
    expired: !!row.expired,
  }));
}

function getMatchedTransaction(orderId) {
  const hasBankTransactionAt = db.prepare('PRAGMA table_info(transactions)').all()
    .some(column => column.name === 'bank_transaction_at');
  const bankTransactionSelect = hasBankTransactionAt
    ? 'bank_transaction_at'
    : 'NULL AS bank_transaction_at';
  const transaction = db.prepare(`
    SELECT
      id,
      amount,
      description,
      mb_transaction_number,
      detected_at,
      ${bankTransactionSelect}
    FROM transactions
    WHERE matched_order_id = ?
      AND match_status = 'matched'
    ORDER BY detected_at DESC, id DESC
    LIMIT 1
  `).get(orderId);

  if (!transaction) return null;
  return {
    id: String(transaction.id),
    amount: transaction.amount,
    description: transaction.description ?? null,
    transactionDate: transaction.bank_transaction_at ?? transaction.detected_at ?? null,
    bankReference: transaction.mb_transaction_number ?? null,
  };
}

function getRenewalLogs(orderId, stockItems) {
  const stockIds = stockItems.map(item => Number(item.id));
  const stockWhere = stockIds.length > 0
    ? ` OR stock_id IN (${stockIds.map(() => '?').join(', ')})`
    : '';
  const rows = db.prepare(`
    SELECT
      id,
      stock_id,
      status,
      expiry_date,
      days_before_expiry,
      message_body,
      created_at
    FROM renewal_reminder_logs
    WHERE order_id = ?${stockWhere}
    ORDER BY created_at DESC, id DESC
  `).all(orderId, ...stockIds);

  return rows.map(row => ({
    id: String(row.id),
    stockId: row.stock_id == null ? null : String(row.stock_id),
    status: row.status,
    expiryDate: row.expiry_date,
    daysBeforeExpiry: row.days_before_expiry,
    messagePreview: (row.message_body || '').slice(0, 180),
    createdAt: row.created_at,
  }));
}

// GET /admin/orders?status=pending&page=1&limit=20&from=&to=&userId=
router.get('/', requirePermission('orders.read'), (req, res) => {
  const status = req.query.status;
  const view = req.query.view === 'deleted' ? 'deleted' : 'active';
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const { from, to, userId } = req.query;

  let where = view === 'deleted' ? 'o.deleted_at IS NOT NULL' : 'o.deleted_at IS NULL';
  const params = [];

  if (status === 'expired_key') {
    where += ` AND o.status = 'delivered' AND EXISTS (
      SELECT 1 FROM stock s
      WHERE s.sold_to = o.user_id AND s.product_id = o.product_id AND s.is_sold = 1
        AND s.duration_days IS NOT NULL
        AND (
          (o.variant_id IS NULL AND s.variant_id IS NULL)
          OR s.variant_id = o.variant_id
        )
        AND (
          o.delivered_keys_json IS NULL
          OR json_valid(o.delivered_keys_json) = 0
          OR json_array_length(o.delivered_keys_json) = 0
          OR EXISTS (
            SELECT 1
            FROM json_each(o.delivered_keys_json) delivered_key
            WHERE CAST(delivered_key.value AS TEXT) = s.data
          )
        )
        AND DATE(s.sold_at, '+' || s.duration_days || ' days') < DATE('now')
    )`;
  } else if (status) {
    where += ' AND o.status = ?'; params.push(status);
  }
  if (from) { where += ' AND o.created_at >= ?'; params.push(from); }
  if (to) { where += " AND o.created_at <= (? || ' 23:59:59')"; params.push(to); }
  if (userId) { where += ' AND o.user_id = ?'; params.push(parseInt(userId)); }

  const qRaw = (req.query.q || '').trim();
  // Strip leading '@' so '@peanut1010' matches username 'peanut1010'.
  const q = qRaw.startsWith('@') ? qRaw.slice(1) : qRaw;
  if (q) {
    where += ` AND (
      CAST(o.id AS TEXT) LIKE ?
      OR o.payment_code LIKE ?
      OR u.full_name LIKE ?
      OR u.username LIKE ?
      OR CAST(o.user_id AS TEXT) LIKE ?
      OR p.name LIKE ?
      OR o.delivered_keys_json LIKE ?
      OR EXISTS (
        SELECT 1 FROM stock s
        WHERE s.sold_to = o.user_id AND s.product_id = o.product_id AND s.is_sold = 1
          AND s.data LIKE ?
      )
    )`;
    const wild = `%${q}%`;
    params.push(wild, wild, wild, wild, wild, wild, wild, wild);
  }

  const rows = db.prepare(`
    SELECT
      o.*,
      p.name as product_name,
      u.full_name as user_name,
      u.username,
      (
        SELECT COUNT(*)
        FROM order_notes n
        WHERE n.order_id = o.id
      ) AS note_count,
      (
        SELECT MAX(updated_at)
        FROM order_notes n
        WHERE n.order_id = o.id
      ) AS latest_note_at
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

const bulkOrderIdsSchema = z.object({
  ids: z.array(z.union([z.string(), z.number()])).min(1).max(500),
});

const orderNoteSchema = z.object({
  content: z.string().transform(value => value.trim()).pipe(z.string().min(1).max(2000)),
});

// POST /admin/orders/bulk-delete — soft-delete orders for 30-day recovery
router.post('/bulk-delete', validate(bulkOrderIdsSchema), (req, res) => {
  const result = orderService.softDeleteOrders(req.validated.ids, req.admin.adminId);
  auditService.log(req.admin.adminId, 'order.bulk_delete', 'order', null, {
    ids: req.validated.ids.map(String),
    requested: result.requested,
    affected: result.affected,
  }, req.ip);
  res.json({ success: true, data: result });
});

// POST /admin/orders/bulk-restore — restore soft-deleted orders within 30 days
router.post('/bulk-restore', validate(bulkOrderIdsSchema), (req, res) => {
  const result = orderService.restoreDeletedOrders(req.validated.ids);
  auditService.log(req.admin.adminId, 'order.bulk_restore', 'order', null, {
    ids: req.validated.ids.map(String),
    requested: result.requested,
    affected: result.affected,
  }, req.ip);
  res.json({ success: true, data: result });
});

// POST /admin/orders/:id/notes
router.post('/:id/notes', requirePermission('orders.write'), validate(orderNoteSchema), (req, res) => {
  const orderId = parseInt(req.params.id);
  const order = orderService.getById(orderId);
  if (!order) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Đơn hàng không tồn tại' } });

  const note = orderNoteService.create(orderId, req.admin.adminId, req.validated.content);
  auditService.log(req.admin.adminId, 'order.note_create', 'order', orderId, {
    noteId: note.id,
    preview: orderNoteService.previewContent(note.content),
  }, req.ip);
  res.json({ success: true, data: note });
});

// PATCH /admin/orders/:id/notes/:noteId
router.patch('/:id/notes/:noteId', requirePermission('orders.write'), validate(orderNoteSchema), (req, res) => {
  const orderId = parseInt(req.params.id);
  const noteId = parseInt(req.params.noteId);
  const order = orderService.getById(orderId);
  if (!order) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Đơn hàng không tồn tại' } });

  const note = orderNoteService.update(orderId, noteId, req.admin.adminId, req.validated.content);
  if (!note) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ghi chú không tồn tại' } });

  auditService.log(req.admin.adminId, 'order.note_update', 'order', orderId, {
    noteId: note.id,
    preview: orderNoteService.previewContent(note.content),
  }, req.ip);
  res.json({ success: true, data: note });
});

// DELETE /admin/orders/:id/notes/:noteId
router.delete('/:id/notes/:noteId', requirePermission('orders.write'), (req, res) => {
  const orderId = parseInt(req.params.id);
  const noteId = parseInt(req.params.noteId);
  const order = orderService.getById(orderId);
  if (!order) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Đơn hàng không tồn tại' } });

  const note = orderNoteService.delete(orderId, noteId);
  if (!note) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ghi chú không tồn tại' } });

  auditService.log(req.admin.adminId, 'order.note_delete', 'order', orderId, {
    noteId: note.id,
    preview: orderNoteService.previewContent(note.content),
  }, req.ip);
  res.json({ success: true, data: { orderId: String(orderId), noteId: String(noteId) } });
});

// GET /admin/orders/export?status=&from=&to=
router.get('/export', requirePermission('orders.read'), (req, res) => {
  const { status, from, to } = req.query;
  const view = req.query.view === 'deleted' ? 'deleted' : 'active';
  let where = view === 'deleted' ? 'o.deleted_at IS NOT NULL' : 'o.deleted_at IS NULL';
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

// GET /admin/orders/:id
router.get('/:id', requirePermission('orders.read'), (req, res) => {
  const order = orderService.getById(parseInt(req.params.id));
  if (!order) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Đơn hàng không tồn tại' } });

  const shaped = shapeOrder(order);

  // Decrypted customer input fields. Admin (any role with orders.read) sees
  // plaintext including password fields — DB-equivalent visibility for fulfilment.
  if (order.input_value) {
    try {
      const { decryptString } = require('../../../utils/secrets');
      const raw = decryptString(order.input_value);
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') shaped.inputFields = parsed;
        else shaped.inputValueText = String(raw);
      } catch {
        shaped.inputValueText = String(raw);
      }
    } catch {}
  }

  // Include delivered accounts. Prefer the per-order snapshot in
  // delivered_keys_json (admin edits + manual-deliver write here), fall back
  // to scanning stock for legacy orders missing the snapshot.
  if (order.status === 'delivered') {
    const snapshot = orderService.getDeliveredKeys(order.id);
    if (snapshot && snapshot.length > 0) {
      shaped.accounts = snapshot;
    } else if (order.delivered_at) {
      const accounts = db.prepare(`
        SELECT data FROM stock
        WHERE sold_to = ? AND product_id = ? AND is_sold = 1 AND sold_at <= ?
          AND (
            (? IS NULL AND variant_id IS NULL)
            OR variant_id = ?
          )
        ORDER BY sold_at DESC LIMIT ?
      `).all(
        order.user_id,
        order.product_id,
        order.delivered_at,
        order.variant_id ?? null,
        order.variant_id ?? null,
        order.quantity,
      );
      shaped.accounts = accounts.map(a => a.data);
    }
  }

  shaped.customer = getOrderCustomer(order);
  shaped.product = getOrderProduct(order);
  shaped.stockItems = getOrderStockItems(order, shaped.accounts);
  shaped.matchedTransaction = getMatchedTransaction(order.id);
  shaped.renewalLogs = getRenewalLogs(order.id, shaped.stockItems);
  shaped.notes = orderNoteService.listForOrder(order.id);

  res.json({ success: true, data: shaped });
});

// POST /admin/orders/:id/confirm — Confirm and auto-deliver
router.post('/:id/confirm', async (req, res) => {
  const id = parseInt(req.params.id);
  const bot = req.app.get('bot');
  if (!bot) return res.status(500).json({ success: false, error: { code: 'BOT_UNAVAILABLE' } });
  const order = orderService.getById(id);
  if (!order) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Đơn hàng không tồn tại' } });
  if (order.status === 'expired') {
    orderService.markRecoveredPaid(id);
  }
  const result = await deliverOrder(bot, id);
  if (!result.success) return res.status(400).json({ success: false, error: { code: 'DELIVERY_FAILED', message: result.error } });
  auditService.log(req.admin.adminId, 'order.confirm', 'order', id, null, req.ip);
  res.json({ success: true, data: result.order });
});

// POST /admin/orders/:id/restore — khôi phục đơn đã hủy về trạng thái đang xử lý
router.post('/:id/restore', requirePermission('orders.write'), validate(z.object({
  status: z.literal('paid'),
})), (req, res) => {
  const orderId = parseInt(req.params.id);
  const result = orderService.restoreCancelledToPaid(orderId);

  if (!result.success) {
    const status = result.code === 'NOT_FOUND' ? 404 : 409;
    return res.status(status).json({
      success: false,
      error: { code: result.code, message: result.error },
    });
  }

  auditService.log(req.admin.adminId, 'order.restore_status', 'order', orderId, {
    from: 'cancelled',
    to: req.validated.status,
  }, req.ip);
  res.json({ success: true, data: result.order });
});

// POST /admin/orders/:id/manual-deliver
router.post('/:id/manual-deliver', validate(z.object({
  accounts: z.array(z.string().min(1)).min(1),
  durationDays: z.number().int().min(1).max(36500).nullable().optional(),
})), async (req, res) => {
  const orderId = parseInt(req.params.id);
  const order = orderService.getById(orderId);

  if (!order) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Đơn hàng không tồn tại' } });
  if (order.status !== 'pending' && order.status !== 'paid' && order.status !== 'expired' && order.status !== 'cancelled') {
    return res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: 'Đơn đã được xử lý' } });
  }

  if (order.status === 'expired') orderService.markRecoveredPaid(orderId);
  else if (order.status === 'cancelled') {
    const restored = orderService.restoreCancelledToPaid(orderId);
    if (!restored.success) {
      return res.status(409).json({
        success: false,
        error: { code: restored.code, message: restored.error },
      });
    }
  } else if (order.status === 'pending') {
    orderService.markPaid(orderId);
  }
  // Resolve duration: explicit override > variant default > null
  let durationDays = req.validated.durationDays ?? null;
  if (durationDays == null && order.variant_id) {
    const v = db.prepare('SELECT default_duration_days FROM product_variants WHERE id = ?').get(order.variant_id);
    durationDays = v?.default_duration_days ?? null;
  }
  orderService.deliverWithAccounts(orderId, req.validated.accounts, durationDays);
  scheduleTwofaBindingSync(orderId);

  auditService.log(req.admin.adminId, 'order.manual_deliver', 'order', orderId, { accountCount: req.validated.accounts.length, durationDays }, req.ip);

  // Fire normal Telegram delivery message via notificationService (compact + usage instructions + txt fallback)
  const bot = req.app.get('bot');
  if (bot) {
    try {
      const productService = require('../../../services/productService');
      const product = productService.getById(order.product_id);
      const { sendDelivery } = require('../../../services/notificationService');
      const { richifyText } = require('../../../utils/messages');
      const usageInstructions = product?.usage_instructions ? richifyText(product.usage_instructions) : '(không có)';
      await sendDelivery(bot, { ...order, product_name: product?.name }, req.validated.accounts, { usageInstructions });
      try {
        const orderChannelService = require('../../../services/orderChannelService');
        const variantService = require('../../../services/variantService');
        const variant = order.variant_id ? variantService.getById(db, order.variant_id) : null;
        await orderChannelService.postOrderCard({ order, product, variant, keys: req.validated.accounts });
      } catch (channelErr) {
        console.error('orderChannelService manual-deliver post failed:', channelErr.message);
      }
    } catch (err) {
      console.error('manual-deliver notify failed:', err.message || err);
    }
  }

  res.json({ success: true, data: { orderId } });
});

// PATCH /admin/orders/:id/keys — replace delivered keys (already delivered orders)
router.patch('/:id/keys', validate(z.object({
  accounts: z.array(z.string().min(1)).min(1),
})), (req, res) => {
  const orderId = parseInt(req.params.id);
  const order = orderService.getById(orderId);
  if (!order) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  db.prepare(`UPDATE orders SET delivered_keys_json = ? WHERE id = ?`).run(JSON.stringify(req.validated.accounts), orderId);
  scheduleTwofaBindingSync(orderId);
  auditService.log(req.admin.adminId, 'order.keys_edit', 'order', orderId, { count: req.validated.accounts.length }, req.ip);
  res.json({ success: true, data: { orderId } });
});

// POST /admin/orders/:id/change-product — reassign a pending/paid order to a
// different product/variant (admin correction, e.g. customer paid extra
// outside the system to upgrade). Releases old stock reservation, best-effort
// reserves new stock, clears discount + stale channel-card linkage.
router.post('/:id/change-product', requirePermission('orders.write'), validate(z.object({
  productId: z.number().int().positive(),
  variantId: z.number().int().positive().nullable().optional(),
  totalPrice: z.number().int().nonnegative().optional(),
})), (req, res) => {
  const orderId = parseInt(req.params.id);
  const before = orderService.getById(orderId);
  if (!before) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Đơn hàng không tồn tại' } });

  const { productId, variantId = null, totalPrice } = req.validated;
  const result = orderService.changeProduct(orderId, { productId, variantId, totalPrice: totalPrice ?? null });
  if (!result.success) {
    return res.status(400).json({ success: false, error: { code: result.code, message: result.error } });
  }

  auditService.log(req.admin.adminId, 'order.change_product', 'order', orderId, {
    fromProductId: before.product_id,
    fromVariantId: before.variant_id,
    fromPrice: before.total_price,
    toProductId: result.order.product_id,
    toVariantId: result.order.variant_id,
    toPrice: result.order.total_price,
  }, req.ip);

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
    await telegramApiClient.sendMessage(order.user_id, message, { parse_mode: 'HTML' });
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
  auditService.log(req.admin.adminId, 'order.cancel', 'order', id, {
    entityLabel: order.payment_code,
    total_price: order.total_price,
    user_id: order.user_id,
  }, req.ip);
  res.json({ success: true });
});

module.exports = router;
