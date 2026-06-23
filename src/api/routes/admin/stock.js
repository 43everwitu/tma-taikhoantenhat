const { Router } = require('express');
const { z } = require('zod');
const db = require('../../../database');
const productService = require('../../../services/productService');
const auditService = require('../../../services/auditService');
const eventBus = require('../../../services/eventBus');
const { validate } = require('../../middleware/validate');

const router = Router();

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
  let where = 'product_id = ?';
  const params = [productId];
  if (sold === 'true') { where += ' AND is_sold = 1'; }
  else if (sold === 'false') { where += ' AND is_sold = 0'; }
  if (q) {
    where += ' AND (data LIKE ? OR CAST(id AS TEXT) LIKE ?)';
    const wild = `%${q}%`;
    params.push(wild, wild);
  }

  // Variant filter: undefined = no filter; 0 = NULL-only; >0 = exact match
  const variantIdParam = req.query.variantId;
  if (variantIdParam !== undefined) {
    const n = parseInt(variantIdParam);
    if (n === 0) {
      where += ' AND variant_id IS NULL';
    } else if (n > 0) {
      where += ' AND variant_id = ?';
      params.push(n);
    }
  }

  const rows = db.prepare(`SELECT * FROM stock WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) as c FROM stock WHERE ${where}`).all(...params)[0].c;

  const items = rows.map(r => ({
    id: String(r.id),
    content: r.data,
    sold: !!r.is_sold,
    soldTo: r.sold_to || null,
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
    notifyResult = await poller.notifyStockReplenished(productId);
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
