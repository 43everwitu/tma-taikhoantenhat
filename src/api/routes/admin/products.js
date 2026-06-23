const { Router } = require('express');
const { z } = require('zod');
const db = require('../../../database');
const productService = require('../../../services/productService');
const auditService = require('../../../services/auditService');
const eventBus = require('../../../services/eventBus');
const { slugify } = require('../../../utils/slugify');
const { validate } = require('../../middleware/validate');
const { sanitizeRich, sanitizeDescription } = require('../../../utils/richHtml');

const router = Router();

const PRODUCT_JOINS_SQL = `
  SELECT p.*,
    (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) as stock_count,
    (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 1) as sold_count,
    c.name as category_name
  FROM products p
  LEFT JOIN categories c ON p.category_id = c.id
`;

function fetchProductForResponse(id) {
  return db.prepare(`${PRODUCT_JOINS_SQL} WHERE p.id = ?`).get(id);
}

function buildUniqueProductSlug(name, excludeId = null) {
  const base = slugify(name);
  if (!base) return `product-${Date.now()}`;
  const sql = excludeId
    ? `SELECT slug FROM products WHERE slug LIKE ? || '%' AND id != ?`
    : `SELECT slug FROM products WHERE slug LIKE ? || '%'`;
  const stmt = db.prepare(sql);
  const rows = excludeId ? stmt.all(base, excludeId) : stmt.all(base);
  const taken = new Set(rows.map(r => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const s = `${base}-${i}`;
    if (!taken.has(s)) return s;
  }
  return `${base}-${Date.now()}`;
}

function buildUniqueCategorySlug(name) {
  const base = slugify(name);
  if (!base) return `cat-${Date.now()}`;
  const taken = new Set(
    db.prepare(`SELECT slug FROM categories WHERE slug LIKE ? || '%'`).all(base).map(r => r.slug)
  );
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const s = `${base}-${i}`;
    if (!taken.has(s)) return s;
  }
  return `${base}-${Date.now()}`;
}

function shapeProduct(r) {
  const stock = r.stock_count ?? 0;
  const soldStock = r.sold_count ?? 0;
  return {
    id: String(r.id),
    name: r.name,
    category: r.category_name || '',
    categoryId: r.category_id,
    price: r.price,
    stock,
    soldStock,
    totalStock: stock + soldStock,
    lowStockThreshold: r.low_stock_threshold,
    active: !!r.is_active,
    description: r.description || '',
    longDescription: r.long_description || '',
    usageInstructions: r.usage_instructions || '',
    emoji: r.emoji || '📦',
    imageUrl: r.image_url || '',
    slug: r.slug || '',
    promotion: r.promotion || '',
    isFeatured: !!r.is_featured,
    contactOnly: !!r.contact_only,
    contactUrl: r.contact_url || '',
  };
}

// GET /admin/products
router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  let where = '1=1';
  const params = [];
  if (q) {
    where += ` AND (p.name LIKE ? OR p.slug LIKE ? OR c.name LIKE ?)`;
    const wild = `%${q}%`;
    params.push(wild, wild, wild);
  }
  const rows = db.prepare(`${PRODUCT_JOINS_SQL} WHERE ${where} ORDER BY p.sort_order, p.id`).all(...params);

  const products = rows.map(shapeProduct);

  res.json({ success: true, data: products });
});

// POST /admin/products — Create product
router.post('/', validate(z.object({
  categoryId: z.number().int().positive().optional(),
  category: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(200),
  price: z.number().int().positive(),
  description: z.string().max(500).optional().nullable(),
  longDescription: z.string().max(20000).nullable().optional(),
  usageInstructions: z.string().max(20000).nullable().optional(),
  emoji: z.string().max(10).nullable().optional(),
  imageUrl: z.string().max(500).nullable().optional(),
  lowStockThreshold: z.number().int().min(0).optional().default(5),
  promotion: z.string().max(200).nullable().optional(),
  contactOnly: z.boolean().optional().default(false),
  contactUrl: z.string().max(500).nullable().optional(),
  notifyOnCreate: z.boolean().optional().default(false),
}).refine(d => d.categoryId || d.category, {
  message: 'Either categoryId or category required',
})), async (req, res) => {
  const d = req.validated;
  let categoryId = d.categoryId;
  if (!categoryId && d.category) {
    const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(d.category);
    if (existing) categoryId = existing.id;
    else {
      const r = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)')
        .run(d.category, buildUniqueCategorySlug(d.category));
      categoryId = r.lastInsertRowid;
    }
  }
  const slug = buildUniqueProductSlug(d.name);
  const result = db.prepare(`
    INSERT INTO products (category_id, name, price, description, emoji, slug, image_url, long_description, low_stock_threshold, usage_instructions, promotion, contact_only, contact_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(categoryId, d.name, d.price,
    d.description ? sanitizeDescription(d.description) : null,
    d.emoji || null, slug,
    d.imageUrl || null,
    d.longDescription ? sanitizeDescription(d.longDescription) : null,
    d.lowStockThreshold,
    d.usageInstructions ? sanitizeRich(d.usageInstructions) : null,
    d.promotion || null, d.contactOnly ? 1 : 0, d.contactUrl || null);

  auditService.log(req.admin.adminId, 'product.create', 'product', result.lastInsertRowid, { name: d.name }, req.ip);

  const product = fetchProductForResponse(result.lastInsertRowid);
  let notifyResult = null;
  if (d.notifyOnCreate) {
    const notificationService = req.app.locals.notificationService;
    if (notificationService) {
      notifyResult = await notificationService.notifyNewProduct(product, req.admin.adminId);
      auditService.log(req.admin.adminId, 'product.notify.new', 'product', result.lastInsertRowid, {
        sent: notifyResult.sent || 0,
        failed: notifyResult.failed || 0,
        total: notifyResult.total || 0,
        skipped: notifyResult.skipped || null,
        trigger: 'create_checkbox',
      }, req.ip);
    }
  }
  eventBus.publish({ type: 'product.create', productId: result.lastInsertRowid });
  res.json({ success: true, data: { ...shapeProduct(product), notify: notifyResult } });
});

// PUT /admin/products/:id — Update product
router.put('/:id', validate(z.object({
  name: z.string().min(1).max(200).optional(),
  price: z.number().int().positive().optional(),
  categoryId: z.number().int().positive().optional(),
  category: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  longDescription: z.string().max(20000).nullable().optional(),
  usageInstructions: z.string().max(20000).nullable().optional(),
  emoji: z.string().max(10).nullable().optional(),
  promotion: z.string().max(200).nullable().optional(),
  contactOnly: z.boolean().optional(),
  contactUrl: z.string().max(500).nullable().optional(),
  imageUrl: z.string().max(500).nullable().optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  sortOrder: z.number().int().optional(),
  notifyOnUpdate: z.boolean().optional().default(false),
})), async (req, res) => {
  const id = parseInt(req.params.id);
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

  const d = req.validated;
  const sets = [];
  const params = [];

  if (d.name !== undefined) { sets.push('name = ?', 'slug = ?'); params.push(d.name, buildUniqueProductSlug(d.name, id)); }
  if (d.price !== undefined) { sets.push('price = ?'); params.push(d.price); }
  if (d.categoryId !== undefined) { sets.push('category_id = ?'); params.push(d.categoryId); }
  if (!d.categoryId && d.category !== undefined) {
    const existingCat = db.prepare('SELECT id FROM categories WHERE name = ?').get(d.category);
    let catId;
    if (existingCat) catId = existingCat.id;
    else {
      const r = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)')
        .run(d.category, buildUniqueCategorySlug(d.category));
      catId = r.lastInsertRowid;
    }
    sets.push('category_id = ?'); params.push(catId);
  }
  if (d.description !== undefined) { sets.push('description = ?'); params.push(d.description == null ? null : sanitizeDescription(d.description)); }
  if (d.emoji !== undefined) { sets.push('emoji = ?'); params.push(d.emoji || null); }
  if (d.promotion !== undefined) { sets.push('promotion = ?'); params.push(d.promotion); }
  if (d.contactOnly !== undefined) { sets.push('contact_only = ?'); params.push(d.contactOnly ? 1 : 0); }
  if (d.contactUrl !== undefined) { sets.push('contact_url = ?'); params.push(d.contactUrl); }
  if (d.imageUrl !== undefined) { sets.push('image_url = ?'); params.push(d.imageUrl); }
  if (d.longDescription !== undefined) { sets.push('long_description = ?'); params.push(d.longDescription == null ? null : sanitizeDescription(d.longDescription)); }
  if (d.usageInstructions !== undefined) { sets.push('usage_instructions = ?'); params.push(d.usageInstructions == null ? null : sanitizeRich(d.usageInstructions)); }
  if (d.lowStockThreshold !== undefined) { sets.push('low_stock_threshold = ?'); params.push(d.lowStockThreshold); }
  if (d.sortOrder !== undefined) { sets.push('sort_order = ?'); params.push(d.sortOrder); }

  if (sets.length === 0) {
    const product = fetchProductForResponse(id);
    let notifyResult = null;
    if (d.notifyOnUpdate) {
      const notificationService = req.app.locals.notificationService;
      if (notificationService) {
        notifyResult = await notificationService.notifyProductUpdated(product, req.admin.adminId);
        auditService.log(req.admin.adminId, 'product.notify.update', 'product', id, {
          sent: notifyResult.sent || 0,
          failed: notifyResult.failed || 0,
          total: notifyResult.total || 0,
          skipped: notifyResult.skipped || null,
          trigger: 'update_checkbox_no_change',
        }, req.ip);
      }
    }
    return res.json({ success: true, data: { ...shapeProduct(product), notify: notifyResult } });
  }

  sets.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  auditService.log(req.admin.adminId, 'product.update', 'product', id, d, req.ip);

  const updated = fetchProductForResponse(id);
  let notifyResult = null;
  if (d.notifyOnUpdate) {
    const notificationService = req.app.locals.notificationService;
    if (notificationService) {
      notifyResult = await notificationService.notifyProductUpdated(updated, req.admin.adminId);
      auditService.log(req.admin.adminId, 'product.notify.update', 'product', id, {
        sent: notifyResult.sent || 0,
        failed: notifyResult.failed || 0,
        total: notifyResult.total || 0,
        skipped: notifyResult.skipped || null,
        trigger: 'update_checkbox',
      }, req.ip);
    }
  }
  eventBus.publish({ type: 'product.update', productId: id, slug: updated.slug });
  res.json({ success: true, data: { ...shapeProduct(updated), notify: notifyResult } });
});

router.post('/:id/notify', validate(z.object({
  kind: z.enum(['new', 'update']),
})), async (req, res) => {
  const id = parseInt(req.params.id);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

  const notificationService = req.app.locals.notificationService;
  if (!notificationService) {
    return res.status(500).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  }

  const result = req.validated.kind === 'new'
    ? await notificationService.notifyNewProduct(product, req.admin.adminId)
    : await notificationService.notifyProductUpdated(product, req.admin.adminId);

  auditService.log(req.admin.adminId, `product.notify.${req.validated.kind}`, 'product', id, {
    sent: result.sent || 0,
    failed: result.failed || 0,
    total: result.total || 0,
    skipped: result.skipped || null,
    trigger: 'manual',
  }, req.ip);

  res.json({ success: true, data: result });
});

// DELETE /admin/products/:id
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = db.prepare('SELECT id, name, slug, price FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  db.prepare('DELETE FROM stock WHERE product_id = ? AND is_sold = 0').run(id);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  auditService.log(req.admin.adminId, 'product.delete', 'product', id, {
    entityLabel: existing.name,
    slug: existing.slug,
    price: existing.price,
  }, req.ip);
  eventBus.publish({ type: 'product.delete', productId: id });
  res.json({ success: true });
});

// POST /admin/products/:id/generate-image — AI image via Pollinations
const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt';

function buildImagePrompt(name, description) {
  const subject = [name, description].filter(Boolean).join(', ');
  return `${subject}, product hero shot, clay 3D illustration, pastel matcha and lemon palette, soft shadow, cute, centered composition, no text, no watermark`;
}

router.post('/:id/generate-image', validate(z.object({
  prompt: z.string().min(1).max(500).optional(),
  width: z.number().int().min(256).max(1536).optional().default(768),
  height: z.number().int().min(256).max(1536).optional().default(768),
  seed: z.number().int().optional(),
  save: z.boolean().optional().default(true),
})), (req, res) => {
  const id = parseInt(req.params.id);
  const product = db.prepare('SELECT id, name, description FROM products WHERE id = ?').get(id);
  if (!product) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

  const d = req.validated;
  const prompt = d.prompt && d.prompt.trim()
    ? d.prompt.trim()
    : buildImagePrompt(product.name, product.description);

  const seed = d.seed ?? Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    width: String(d.width),
    height: String(d.height),
    nologo: 'true',
    enhance: 'true',
    model: 'flux',
    seed: String(seed),
  });
  const imageUrl = `${POLLINATIONS_BASE}/${encodeURIComponent(prompt)}?${params.toString()}`;

  if (d.save !== false) {
    db.prepare('UPDATE products SET image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(imageUrl, id);
    auditService.log(req.admin.adminId, 'product.image_generate', 'product', id, { prompt, seed }, req.ip);
  }

  res.json({ success: true, data: { imageUrl, prompt, seed } });
});

// PATCH /admin/products/reorder — bulk update sort_order (and optionally category_id)
// Accepts an array of { id, sortOrder, categoryId? }. When categoryId is given,
// the product is moved to that category as part of the same transaction.
router.patch('/reorder', validate(z.object({
  items: z.array(z.object({
    id: z.coerce.number().int().positive(),
    sortOrder: z.number().int().min(0).max(100000),
    categoryId: z.number().int().positive().optional(),
  })).min(1).max(500),
})), (req, res) => {
  const { items } = req.validated;
  const updSort = db.prepare('UPDATE products SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  const updBoth = db.prepare('UPDATE products SET sort_order = ?, category_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  const tx = db.transaction(() => {
    for (const it of items) {
      if (it.categoryId !== undefined) updBoth.run(it.sortOrder, it.categoryId, it.id);
      else updSort.run(it.sortOrder, it.id);
    }
  });
  tx();

  auditService.log(req.admin.adminId, 'product.reorder', 'product', null,
    { count: items.length }, req.ip);
  // Push to SSE so customer pages refetch without reload.
  eventBus.publish({ type: 'product.update', reorder: true });
  res.json({ success: true, data: { updated: items.length } });
});

// PATCH /admin/products/:id/toggle
router.patch('/:id/toggle', (req, res) => {
  const id = parseInt(req.params.id);
  const product = db.prepare('SELECT is_active FROM products WHERE id = ?').get(id);
  if (!product) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

  const newStatus = product.is_active ? 0 : 1;
  db.prepare('UPDATE products SET is_active = ? WHERE id = ?').run(newStatus, id);
  auditService.log(req.admin.adminId, 'product.toggle', 'product', id, { is_active: newStatus }, req.ip);

  eventBus.publish({ type: 'product.toggle', productId: id, active: !!newStatus });
  res.json({ success: true, data: { is_active: newStatus } });
});

// PATCH /admin/products/:id/featured — toggle homepage featured flag
router.patch('/:id/featured', (req, res) => {
  const id = parseInt(req.params.id);
  const product = db.prepare('SELECT id, name, is_featured FROM products WHERE id = ?').get(id);
  if (!product) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

  const newStatus = product.is_featured ? 0 : 1;
  db.prepare('UPDATE products SET is_featured = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newStatus, id);
  auditService.log(req.admin.adminId, 'product.featured', 'product', id, {
    entityLabel: product.name,
    is_featured: newStatus,
  }, req.ip);

  eventBus.publish({ type: 'product.update', productId: id, featured: !!newStatus });
  res.json({ success: true, data: { is_featured: newStatus } });
});

// POST /admin/products/:id/duplicate — clone a product with a fresh slug.
// Stock rows are NOT copied; the duplicate starts empty so admins can re-stock
// independently. sort_order is appended to the end so the new row doesn't
// silently displace siblings.
router.post('/:id/duplicate', (req, res) => {
  const id = parseInt(req.params.id);
  const src = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!src) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

  const newName = `${src.name} (bản sao)`;
  const newSlug = buildUniqueProductSlug(newName);
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM products').get().m;

  const result = db.prepare(`
    INSERT INTO products
      (category_id, name, price, description, emoji, slug, image_url,
       long_description, low_stock_threshold, usage_instructions,
       promotion, contact_only, contact_url, is_active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    src.category_id, newName, src.price, src.description, src.emoji, newSlug, src.image_url,
    src.long_description, src.low_stock_threshold, src.usage_instructions,
    src.promotion, src.contact_only, src.contact_url, src.is_active,
    maxSort + 10,
  );

  auditService.log(req.admin.adminId, 'product.duplicate', 'product', result.lastInsertRowid,
    { sourceId: id, name: newName }, req.ip);

  const product = fetchProductForResponse(result.lastInsertRowid);
  eventBus.publish({ type: 'product.create', productId: result.lastInsertRowid });
  res.json({ success: true, data: shapeProduct(product) });
});

module.exports = router;
