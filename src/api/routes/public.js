const { Router } = require('express');
const db = require('../../database');
const { sanitizeProductForClient } = require('../../services/productService');
const config = require('../../config');
const messageTemplateService = require('../../services/messageTemplateService');

const router = Router();

// GET /shop/info
router.get('/shop/info', (req, res) => {
  const settings = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(r => {
    settings[r.key] = r.value;
  });

  res.json({
    success: true,
    data: {
      shopName: settings.shop_name || config.SHOP_NAME,
      supportContact: settings.support_contact || config.SUPPORT_CONTACT,
    },
  });
});

// GET /categories
router.get('/categories', (req, res) => {
  const categories = db.prepare(
    "SELECT id, name, slug, emoji, description FROM categories WHERE is_active = 1 ORDER BY sort_order"
  ).all();

  res.json({ success: true, data: categories });
});

function shapePublicProduct(p) {
  const stock = (p.display_stock != null) ? p.display_stock : (p.stock_count || 0);
  const shaped = {
    id: String(p.id),
    name: p.name,
    slug: p.slug,
    emoji: p.emoji || '📦',
    imageUrl: p.image_url || '',
    price: p.price,
    stock,
    description: p.description || '',
    longDescription: p.long_description || '',
    usageInstructions: p.usage_instructions || '',
    promotion: p.promotion || null,
    contactOnly: !!p.contact_only,
    contactUrl: p.contact_url || '',
    category: p.category_name || '',
    categorySlug: p.category_slug || '',
    categoryId: p.category_id,
  };
  return sanitizeProductForClient(shaped);
}

// GET /products
router.get('/products', (req, res) => {
  const q = (req.query.q || '').trim();
  const categorySlug = (req.query.category || '').trim();
  const sort = req.query.sort || 'default';

  let where = 'p.is_active = 1';
  const params = [];

  if (q) {
    where += ` AND (p.name LIKE ? OR p.description LIKE ? OR p.slug LIKE ?)`;
    const wild = `%${q}%`;
    params.push(wild, wild, wild);
  }
  if (categorySlug) {
    where += ` AND c.slug = ?`;
    params.push(categorySlug);
  }

  let orderBy;
  switch (sort) {
    case 'price_asc': orderBy = 'p.price ASC, p.id'; break;
    case 'price_desc': orderBy = 'p.price DESC, p.id'; break;
    case 'newest': orderBy = 'p.created_at DESC, p.id DESC'; break;
    default: orderBy = 'p.sort_order, p.id';
  }

  const rows = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) as stock_count,
      CASE
        WHEN (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) > 0
        THEN (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0)
        ELSE COALESCE(p.sheet_stock, 0)
      END as display_stock,
      c.name as category_name, c.slug as category_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE ${where}
    ORDER BY ${orderBy}
  `).all(...params);

  res.json({ success: true, data: rows.map(shapePublicProduct) });
});

// GET /products/:slug
router.get('/products/:slug', (req, res) => {
  const product = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) as stock_count,
      CASE
        WHEN (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) > 0
        THEN (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0)
        ELSE COALESCE(p.sheet_stock, 0)
      END as display_stock,
      c.name as category_name, c.slug as category_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.slug = ? AND p.is_active = 1
  `).get(req.params.slug);

  if (!product) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Sản phẩm không tìm thấy' } });
  }

  res.json({ success: true, data: shapePublicProduct(product) });
});

// GET /announcements — recent public announcements (target = web | all)
router.get('/announcements', (req, res) => {
  const rows = db.prepare(`
    SELECT id, title, body, is_pinned, target, created_at
    FROM announcements
    WHERE target IN ('web', 'all')
    ORDER BY is_pinned DESC, created_at DESC
    LIMIT 10
  `).all();

  res.json({
    success: true,
    data: rows.map(r => ({
      id: String(r.id),
      title: r.title,
      body: r.body,
      pinned: !!r.is_pinned,
      target: r.target || 'all',
      createdAt: r.created_at,
    })),
  });
});

// GET /messages/public — web-channel message templates (no auth required)
router.get('/messages/public', (req, res) => {
  const all = messageTemplateService.list().filter((t) => t.channel === 'web');
  res.json({
    success: true,
    data: all.map((t) => ({ key: t.key, body: t.body, variables: t.variables })),
  });
});

module.exports = router;
