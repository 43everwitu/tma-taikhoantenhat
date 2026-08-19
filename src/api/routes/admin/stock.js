const { Router } = require('express');
const { z } = require('zod');
const db = require('../../../database');
const productService = require('../../../services/productService');
const auditService = require('../../../services/auditService');
const eventBus = require('../../../services/eventBus');
const { validate } = require('../../middleware/validate');

const router = Router();

function parsePositiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function makePlaceholders(count) {
  return Array.from({ length: count }, () => '?').join(',');
}

function publishStockChanges(rows, action) {
  const counts = new Map();
  for (const row of rows) {
    counts.set(row.product_id, (counts.get(row.product_id) || 0) + 1);
  }
  for (const [productId, count] of counts) {
    eventBus.publish({ type: 'stock.change', productId, action, count });
  }
}

// GET /admin/stock?page=1&limit=50&q=&productId=&variantId=&sold=false
router.get('/', (req, res) => {
  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(parsePositiveInt(req.query.limit, 50), 200);
  const offset = (page - 1) * limit;
  const q = String(req.query.q || '').trim();
  const sold = req.query.sold;

  const where = ['1=1'];
  const params = [];

  if (q) {
    where.push('(s.data LIKE ? OR CAST(s.id AS TEXT) LIKE ? OR p.name LIKE ?)');
    const wild = `%${q}%`;
    params.push(wild, wild, wild);
  }

  const productId = parseInt(req.query.productId, 10);
  if (Number.isFinite(productId) && productId > 0) {
    where.push('s.product_id = ?');
    params.push(productId);
  }

  const variantIdParam = req.query.variantId;
  let variantFilterApplied = false;
  if (variantIdParam !== undefined && String(variantIdParam) !== '') {
    const n = parseInt(variantIdParam, 10);
    if (n === 0) {
      where.push('s.variant_id IS NULL');
      variantFilterApplied = true;
    } else if (n > 0) {
      where.push('s.variant_id = ?');
      params.push(n);
      variantFilterApplied = true;
    }
  }

  if (sold === 'true') {
    where.push('s.is_sold = 1');
  } else if (sold === 'false') {
    where.push('s.is_sold = 0');
  }

  // Priority order (drag-to-reorder) only makes sense once the list is
  // narrowed to a single product+variant group AND showing unsold stock —
  // that's the exact grouping the sale-order queries scope by.
  const priorityMode = Number.isFinite(productId) && productId > 0 && variantFilterApplied && sold === 'false';

  const whereSql = where.join(' AND ');
  const rows = db.prepare(`
    SELECT
      s.id,
      s.data,
      s.is_sold,
      s.sold_to,
      s.sold_at,
      s.added_at,
      s.product_id,
      s.variant_id,
      s.duration_days,
      s.sort_order,
      p.name AS product_name,
      v.name AS variant_name,
      u.telegram_id AS sold_customer_telegram_id,
      u.username AS sold_customer_username,
      u.full_name AS sold_customer_full_name,
      so.id AS sold_order_id,
      so.payment_code AS sold_order_payment_code,
      so.status AS sold_order_status,
      so.delivered_at AS sold_order_delivered_at
    FROM stock s
    JOIN products p ON p.id = s.product_id
    LEFT JOIN product_variants v ON v.id = s.variant_id
    LEFT JOIN users u ON u.telegram_id = s.sold_to
    LEFT JOIN orders so ON so.id = (
      SELECT o.id
      FROM orders o
      WHERE o.user_id = s.sold_to
        AND o.product_id = s.product_id
        AND o.status = 'delivered'
        AND (
          (o.variant_id IS NULL AND s.variant_id IS NULL)
          OR o.variant_id = s.variant_id
        )
        AND json_valid(o.delivered_keys_json) = 1
        AND EXISTS (
          SELECT 1
          FROM json_each(o.delivered_keys_json) delivered_key
          WHERE CAST(delivered_key.value AS TEXT) = s.data
        )
      ORDER BY o.delivered_at DESC, o.id DESC
      LIMIT 1
    )
    WHERE ${whereSql}
    ORDER BY ${priorityMode ? 's.sort_order ASC, s.id ASC' : 's.id DESC'}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  const total = db.prepare(`
    SELECT COUNT(*) AS c
    FROM stock s
    JOIN products p ON p.id = s.product_id
    LEFT JOIN product_variants v ON v.id = s.variant_id
    WHERE ${whereSql}
  `).get(...params).c;

  res.json({
    success: true,
    data: {
      items: rows.map(r => ({
        id: String(r.id),
        productId: String(r.product_id),
        productName: r.product_name,
        variantId: r.variant_id === null ? null : String(r.variant_id),
        variantName: r.variant_name || null,
        content: r.data,
        sold: !!r.is_sold,
        soldTo: r.sold_to || null,
        createdAt: r.added_at || null,
        soldAt: r.sold_at || null,
        durationDays: r.duration_days ?? null,
        sortOrder: priorityMode ? r.sort_order : undefined,
        soldOrder: r.sold_order_id ? {
          id: String(r.sold_order_id),
          paymentCode: r.sold_order_payment_code,
          status: r.sold_order_status,
          deliveredAt: r.sold_order_delivered_at || null,
        } : null,
        soldCustomer: r.sold_customer_telegram_id ? {
          telegramId: r.sold_customer_telegram_id,
          username: r.sold_customer_username || null,
          fullName: r.sold_customer_full_name || null,
        } : null,
      })),
      total,
      page,
      limit,
      priorityMode,
    },
  });
});

router.post('/_bulk/delete', validate(z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
})), (req, res) => {
  const ids = [...new Set(req.validated.ids)];
  const placeholders = makePlaceholders(ids.length);
  const rows = db.prepare(`SELECT id, product_id, data FROM stock WHERE id IN (${placeholders}) AND is_sold = 0`)
    .all(...ids);
  if (rows.length === 0) {
    return res.json({ success: true, data: { deleted: 0 } });
  }

  const result = db.prepare(`DELETE FROM stock WHERE id IN (${placeholders}) AND is_sold = 0`).run(...ids);
  auditService.log(req.admin.adminId, 'stock.bulk_delete', 'stock', null, {
    requested: ids.length,
    deleted: result.changes,
    ids: rows.map(r => r.id),
  }, req.ip);
  publishStockChanges(rows, 'bulk_delete');
  res.json({ success: true, data: { deleted: result.changes } });
});

router.patch('/_bulk', validate(z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
  variantId: z.number().int().positive().nullable().optional(),
  durationDays: z.number().int().min(1).max(36500).nullable().optional(),
})), (req, res) => {
  const ids = [...new Set(req.validated.ids)];
  const wantsVariant = Object.prototype.hasOwnProperty.call(req.validated, 'variantId');
  const wantsDuration = Object.prototype.hasOwnProperty.call(req.validated, 'durationDays');
  if (!wantsVariant && !wantsDuration) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Không có trường cần cập nhật' } });
  }

  const placeholders = makePlaceholders(ids.length);
  const rows = db.prepare(`SELECT id, product_id FROM stock WHERE id IN (${placeholders}) AND is_sold = 0`)
    .all(...ids);
  if (rows.length === 0) {
    return res.json({ success: true, data: { updated: 0 } });
  }

  if (wantsVariant && req.validated.variantId !== null) {
    const variant = db.prepare('SELECT id, product_id FROM product_variants WHERE id = ?').get(req.validated.variantId);
    if (!variant) return res.status(404).json({ success: false, error: { code: 'VARIANT_NOT_FOUND' } });
    if (rows.some(r => r.product_id !== variant.product_id)) {
      return res.status(409).json({
        success: false,
        error: { code: 'INVALID_STATE', message: 'Chỉ đổi biến thể cho key cùng một sản phẩm' },
      });
    }
  }

  const assignments = [];
  const params = [];
  if (wantsVariant) {
    assignments.push('variant_id = ?');
    params.push(req.validated.variantId ?? null);
  }
  if (wantsDuration) {
    assignments.push('duration_days = ?');
    params.push(req.validated.durationDays ?? null);
  }

  const result = db.prepare(`UPDATE stock SET ${assignments.join(', ')} WHERE id IN (${placeholders}) AND is_sold = 0`)
    .run(...params, ...ids);
  auditService.log(req.admin.adminId, 'stock.bulk_edit', 'stock', null, {
    requested: ids.length,
    updated: result.changes,
    variant_id: wantsVariant ? req.validated.variantId ?? null : undefined,
    duration_days: wantsDuration ? req.validated.durationDays ?? null : undefined,
    ids: rows.map(r => r.id),
  }, req.ip);
  publishStockChanges(rows, 'bulk_edit');
  res.json({ success: true, data: { updated: result.changes } });
});

// PATCH /admin/stock/_reorder — drag-to-reorder sell priority within one
// product+variant group. `ids` are the dragged rows (display order at their
// new position); `beforeId`/`afterId` are the rows adjacent to the drop slot
// on the current page, or null at a page edge. New sort_order values are
// interpolated between the neighbors so only the moved rows change.
router.patch('/_reorder', validate(z.object({
  ids: z.array(z.number().int().positive()).min(1).max(200),
  beforeId: z.number().int().positive().nullable().optional(),
  afterId: z.number().int().positive().nullable().optional(),
})), (req, res) => {
  const ids = [...new Set(req.validated.ids)];
  const beforeId = req.validated.beforeId ?? null;
  const afterId = req.validated.afterId ?? null;

  const placeholders = makePlaceholders(ids.length);
  const movedRows = db.prepare(
    `SELECT id, product_id, variant_id, is_sold, sort_order FROM stock WHERE id IN (${placeholders})`
  ).all(...ids);
  if (movedRows.length !== ids.length || movedRows.some(r => r.is_sold)) {
    return res.status(409).json({ success: false, error: { code: 'INVALID_STATE', message: 'Key không hợp lệ để sắp xếp' } });
  }
  const [{ product_id: productId, variant_id: variantId }] = movedRows;
  const sameGroup = (r) => r.product_id === productId && r.variant_id === variantId;
  if (!movedRows.every(sameGroup)) {
    return res.status(409).json({ success: false, error: { code: 'INVALID_STATE', message: 'Chỉ sắp xếp key cùng sản phẩm/biến thể' } });
  }

  const idsSet = new Set(ids);
  if (beforeId !== null && idsSet.has(beforeId)) {
    return res.status(409).json({ success: false, error: { code: 'INVALID_STATE', message: 'Vị trí thả không hợp lệ' } });
  }
  if (afterId !== null && idsSet.has(afterId)) {
    return res.status(409).json({ success: false, error: { code: 'INVALID_STATE', message: 'Vị trí thả không hợp lệ' } });
  }
  let beforeRow = null;
  if (beforeId !== null) {
    beforeRow = db.prepare('SELECT id, product_id, variant_id, is_sold, sort_order FROM stock WHERE id = ?').get(beforeId);
    if (!beforeRow || beforeRow.is_sold || !sameGroup(beforeRow)) {
      return res.status(409).json({ success: false, error: { code: 'INVALID_STATE', message: 'Vị trí thả không hợp lệ' } });
    }
  }
  let afterRow = null;
  if (afterId !== null) {
    afterRow = db.prepare('SELECT id, product_id, variant_id, is_sold, sort_order FROM stock WHERE id = ?').get(afterId);
    if (!afterRow || afterRow.is_sold || !sameGroup(afterRow)) {
      return res.status(409).json({ success: false, error: { code: 'INVALID_STATE', message: 'Vị trí thả không hợp lệ' } });
    }
  }

  const GAP = 1;
  const beforeSort = beforeRow ? beforeRow.sort_order : null;
  const afterSort = afterRow ? afterRow.sort_order : null;
  const newSortOrders = ids.map((id, i) => {
    if (beforeSort !== null && afterSort !== null) {
      const step = (afterSort - beforeSort) / (ids.length + 1);
      return beforeSort + step * (i + 1);
    }
    if (afterSort !== null) {
      return afterSort - GAP * (ids.length - i);
    }
    if (beforeSort !== null) {
      return beforeSort + GAP * (i + 1);
    }
    return i;
  });

  const update = db.prepare('UPDATE stock SET sort_order = ? WHERE id = ?');
  const tx = db.transaction(() => {
    ids.forEach((id, i) => update.run(newSortOrders[i], id));
  });
  tx();

  auditService.log(req.admin.adminId, 'stock.reorder', 'stock', null, {
    product_id: productId,
    variant_id: variantId,
    ids,
    beforeId,
    afterId,
  }, req.ip);
  eventBus.publish({ type: 'stock.change', productId, action: 'reorder', count: ids.length });
  res.json({ success: true, data: { updated: ids.length } });
});

router.patch('/items/:itemId', validate(z.object({
  content: z.string().trim().min(1).max(2000),
  productId: z.number().int().positive(),
  variantId: z.number().int().positive().nullable().optional(),
  durationDays: z.number().int().min(1).max(36500).nullable().optional(),
})), (req, res) => {
  const itemId = parseInt(req.params.itemId, 10);
  const item = db.prepare(`
    SELECT id, product_id, variant_id, data, duration_days, is_sold, sold_to, sold_at
    FROM stock
    WHERE id = ?
  `).get(itemId);
  if (!item) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(req.validated.productId);
  if (!product) return res.status(404).json({ success: false, error: { code: 'PRODUCT_NOT_FOUND' } });

  const wantsVariant = Object.prototype.hasOwnProperty.call(req.validated, 'variantId');
  const nextVariantId = wantsVariant ? req.validated.variantId : item.variant_id;
  if (nextVariantId !== null && nextVariantId !== undefined) {
    const variant = db.prepare('SELECT id, product_id FROM product_variants WHERE id = ?').get(nextVariantId);
    if (!variant) return res.status(404).json({ success: false, error: { code: 'VARIANT_NOT_FOUND' } });
    if (variant.product_id !== req.validated.productId) {
      return res.status(409).json({
        success: false,
        error: { code: 'INVALID_STATE', message: 'Biến thể không thuộc sản phẩm đã chọn' },
      });
    }
  }

  const wantsDuration = Object.prototype.hasOwnProperty.call(req.validated, 'durationDays');
  const nextDurationDays = wantsDuration ? req.validated.durationDays : item.duration_days;
  db.prepare(`
    UPDATE stock
    SET data = ?, product_id = ?, variant_id = ?, duration_days = ?
    WHERE id = ?
  `).run(
    req.validated.content,
    req.validated.productId,
    nextVariantId ?? null,
    nextDurationDays ?? null,
    itemId,
  );

  auditService.log(req.admin.adminId, 'stock.item_edit', 'stock', itemId, {
    before: {
      product_id: item.product_id,
      variant_id: item.variant_id ?? null,
      duration_days: item.duration_days ?? null,
      data_preview: item.data ? (item.data.length > 60 ? item.data.slice(0, 60) + '…' : item.data) : null,
    },
    after: {
      product_id: req.validated.productId,
      variant_id: nextVariantId ?? null,
      duration_days: nextDurationDays ?? null,
      data_preview: req.validated.content.length > 60 ? req.validated.content.slice(0, 60) + '…' : req.validated.content,
    },
    was_sold: !!item.is_sold,
    sold_to: item.sold_to || null,
    sold_at: item.sold_at || null,
  }, req.ip);

  const changedRows = [{ product_id: item.product_id }];
  if (item.product_id !== req.validated.productId) changedRows.push({ product_id: req.validated.productId });
  publishStockChanges(changedRows, 'item_edit');
  res.json({ success: true });
});

router.delete('/items/:itemId', (req, res) => {
  const itemId = parseInt(req.params.itemId, 10);
  const item = db.prepare(`
    SELECT id, product_id, variant_id, data, duration_days, is_sold, sold_to, sold_at
    FROM stock
    WHERE id = ?
  `).get(itemId);
  if (!item) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

  db.prepare('DELETE FROM stock WHERE id = ?').run(itemId);
  const dataPreview = item.data
    ? (item.data.length > 60 ? item.data.slice(0, 60) + '…' : item.data)
    : null;
  auditService.log(req.admin.adminId, 'stock.item_delete', 'stock', itemId, {
    entityLabel: dataPreview,
    product_id: item.product_id,
    variant_id: item.variant_id ?? null,
    duration_days: item.duration_days ?? null,
    was_sold: !!item.is_sold,
    sold_to: item.sold_to || null,
    sold_at: item.sold_at || null,
  }, req.ip);
  eventBus.publish({ type: 'stock.change', productId: item.product_id, action: 'item_delete' });
  res.json({ success: true });
});

// GET /admin/stock/:productId?page=1&limit=20&sold=false
router.get('/:productId', (req, res) => {
  const productId = parseInt(req.params.productId);
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const sold = req.query.sold;

  const product = db.prepare('SELECT id, name FROM products WHERE id = ?').get(productId);
  if (!product) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

  const q = (req.query.q || '').trim();
  let where = 's.product_id = ?';
  const params = [productId];
  if (sold === 'true') { where += ' AND s.is_sold = 1'; }
  else if (sold === 'false') { where += ' AND s.is_sold = 0'; }
  if (q) {
    where += ' AND (s.data LIKE ? OR CAST(s.id AS TEXT) LIKE ?)';
    const wild = `%${q}%`;
    params.push(wild, wild);
  }

  // Variant filter: undefined = no filter; 0 = NULL-only; >0 = exact match
  const variantIdParam = req.query.variantId;
  if (variantIdParam !== undefined) {
    const n = parseInt(variantIdParam);
    if (n === 0) {
      where += ' AND s.variant_id IS NULL';
    } else if (n > 0) {
      where += ' AND s.variant_id = ?';
      params.push(n);
    }
  }

  const rows = db.prepare(`
    SELECT s.*, v.name AS variant_name
    FROM stock s
    LEFT JOIN product_variants v ON v.id = s.variant_id
    WHERE ${where}
    ORDER BY s.id DESC
    LIMIT ? OFFSET ?
  `)
    .all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) as c FROM stock s WHERE ${where}`).all(...params)[0].c;

  const items = rows.map(r => ({
    id: String(r.id),
    productId: String(r.product_id),
    content: r.data,
    sold: !!r.is_sold,
    soldTo: r.sold_to || null,
    variantId: r.variant_id === null ? null : String(r.variant_id),
    variantName: r.variant_name || null,
    durationDays: r.duration_days ?? null,
    createdAt: r.added_at || r.created_at || null,
    soldAt: r.sold_at || null,
  }));

  res.json({
    success: true,
    data: { items, total, page, limit, productName: product.name },
  });
});

// POST /admin/stock/:productId — Bulk add stock
router.post('/:productId', validate(z.object({
  items: z.array(z.string().min(1)).min(1).max(1000),
  variantId: z.number().int().positive().nullable().optional(),
  durationDays: z.number().int().min(1).max(36500).nullable().optional(),
  notifyFollowers: z.boolean().optional().default(false),
})), async (req, res) => {
  const productId = parseInt(req.params.productId);
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!product) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

  productService.addStock(productId, req.validated.items, req.validated.variantId ?? null, req.validated.durationDays ?? null);
  auditService.log(req.admin.adminId, 'stock.add', 'product', productId, { count: req.validated.items.length, variant_id: req.validated.variantId ?? null }, req.ip);

  // Notify followers (opt-in)
  let notifyResult = null;
  const poller = req.app.locals.notificationService;
  if (poller && req.validated.notifyFollowers) {
    notifyResult = await poller.notifyStockReplenished(productId, req.validated.variantId ?? null);
    auditService.log(req.admin.adminId, 'stock.notify.followers', 'product', productId, {
      sent: notifyResult.sent || 0,
      failed: notifyResult.failed || 0,
      total: notifyResult.total || 0,
      skipped: notifyResult.skipped || null,
      trigger: 'add_stock_checkbox',
    }, req.ip);
  }

  const stockCount = db.prepare('SELECT COUNT(*) as c FROM stock WHERE product_id = ? AND is_sold = 0').get(productId).c;
  eventBus.publish({ type: 'stock.change', productId, action: 'add', count: req.validated.items.length, totalAvailable: stockCount });
  res.json({ success: true, data: { added: req.validated.items.length, totalAvailable: stockCount, notify: notifyResult } });
});

router.post('/:productId/notify-followers', async (req, res) => {
  const productId = parseInt(req.params.productId);
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!product) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

  const notificationService = req.app.locals.notificationService;
  if (!notificationService) {
    return res.status(500).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  }

  const result = await notificationService.notifyStockReplenished(productId);
  auditService.log(req.admin.adminId, 'stock.notify.followers', 'product', productId, {
    sent: result.sent || 0,
    failed: result.failed || 0,
    total: result.total || 0,
    skipped: result.skipped || null,
    trigger: 'manual',
  }, req.ip);

  res.json({ success: true, data: result });
});

// DELETE /admin/stock/:productId/unsold — Clear unsold stock
router.delete('/:productId/unsold', (req, res) => {
  const productId = parseInt(req.params.productId);
  const result = db.prepare('DELETE FROM stock WHERE product_id = ? AND is_sold = 0').run(productId);
  auditService.log(req.admin.adminId, 'stock.clear', 'product', productId, { deleted: result.changes }, req.ip);
  eventBus.publish({ type: 'stock.change', productId, action: 'clear', count: result.changes });
  res.json({ success: true, data: { deleted: result.changes } });
});

// PATCH /admin/stock/:productId/:itemId — Edit a single stock item (only if not sold)
router.patch('/:productId/:itemId', validate(z.object({
  content: z.string().min(1).max(2000),
})), (req, res) => {
  const productId = parseInt(req.params.productId);
  const itemId = parseInt(req.params.itemId);
  const item = db.prepare('SELECT id, is_sold FROM stock WHERE id = ? AND product_id = ?').get(itemId, productId);
  if (!item) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  if (item.is_sold) return res.status(409).json({ success: false, error: { code: 'INVALID_STATE', message: 'Hàng đã bán, không thể sửa' } });

  db.prepare('UPDATE stock SET data = ? WHERE id = ?').run(req.validated.content, itemId);
  auditService.log(req.admin.adminId, 'stock.edit', 'stock', itemId, { product_id: productId }, req.ip);
  eventBus.publish({ type: 'stock.change', productId, action: 'edit' });
  res.json({ success: true });
});

// DELETE /admin/stock/:productId/:itemId — Delete a single stock item (only if not sold)
router.delete('/:productId/:itemId', (req, res) => {
  const productId = parseInt(req.params.productId);
  const itemId = parseInt(req.params.itemId);
  const item = db.prepare('SELECT id, is_sold, data, variant_id FROM stock WHERE id = ? AND product_id = ?').get(itemId, productId);
  if (!item) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  if (item.is_sold) return res.status(409).json({ success: false, error: { code: 'INVALID_STATE', message: 'Hàng đã bán, không thể xoá' } });

  db.prepare('DELETE FROM stock WHERE id = ?').run(itemId);
  const dataPreview = item.data
    ? (item.data.length > 60 ? item.data.slice(0, 60) + '…' : item.data)
    : null;
  auditService.log(req.admin.adminId, 'stock.delete', 'stock', itemId, {
    entityLabel: dataPreview,
    product_id: productId,
    variant_id: item.variant_id ?? null,
    was_sold: !!item.is_sold,
  }, req.ip);
  eventBus.publish({ type: 'stock.change', productId, action: 'delete' });
  res.json({ success: true });
});

module.exports = router;
