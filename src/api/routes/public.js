const { Router } = require('express');
const db = require('../../database');
const { sanitizeProductForClient } = require('../../services/productService');
const variantService = require('../../services/variantService');
const config = require('../../config');
const messageTemplateService = require('../../services/messageTemplateService');
const paymentService = require('../../services/paymentService');
const discountService = require('../../services/discountService');

const router = Router();

async function fetchQrPngBuffer(qrUrl) {
  const resp = await fetch(qrUrl, {
    headers: {
      'Accept': 'image/png,image/*;q=0.9,*/*;q=0.1',
      'User-Agent': 'taikhoantenhat-bot/qr-download',
    },
  });
  if (!resp.ok) throw new Error(`QR_FETCH_${resp.status}`);
  const arr = await resp.arrayBuffer();
  return Buffer.from(arr);
}

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
      supportUrl: settings.support_url || '',
    },
  });
});

function discountLabel(code) {
  if (!code) return '';
  if (code.type === 'percent') return `Giảm ${code.amount}%`;
  return `Giảm ${Number(code.amount || 0).toLocaleString('vi-VN')}đ`;
}

function shapeGlobalDiscount(code, basePrice = null) {
  if (!code) return null;
  const out = {
    code: code.code,
    type: code.type,
    amount: code.amount,
    maxDiscount: code.max_discount,
    minOrder: code.min_order,
    label: discountLabel(code),
    title: code.notify_title || '',
    appMetaMode: code.app_meta_mode || 'auto',
    appMetaText: code.app_meta_text || '',
    appMessage: code.app_message || '',
  };
  if (basePrice != null) {
    out.discountAmount = discountService.computeDiscount(code, basePrice);
    out.salePrice = Math.max(0, basePrice - out.discountAmount);
  }
  return out;
}

function normalizeAnnouncementText(raw) {
  if (!raw) return '';
  let text = String(raw);
  // Keep anchor text but strip href links.
  text = text.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');
  // Never show raw URLs in the miniapp announcement rail.
  text = text.replace(/\bhttps?:\/\/[^\s<]+/gi, '');
  text = text.replace(/\bwww\.[^\s<]+/gi, '');
  // Product/update announcements should stay compact and neutral.
  text = text.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '');
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

function applyGlobalPricing(item, globalDiscount) {
  if (!globalDiscount) return item;
  const discountAmount = discountService.computeDiscount(globalDiscount, item.price);
  if (discountAmount <= 0) return item;
  return {
    ...item,
    originalPrice: item.price,
    salePrice: Math.max(0, item.price - discountAmount),
    discountAmount,
    discountCode: globalDiscount.code,
    discountLabel: discountLabel(globalDiscount),
  };
}

// GET /discounts/global — active store-wide discount for public display.
router.get('/discounts/global', (req, res) => {
  const global = discountService.findActiveGlobal();
  res.json({ success: true, data: shapeGlobalDiscount(global) });
});

// GET /categories
router.get('/categories', (req, res) => {
  const exclude = (req.query.exclude || '').trim();
  let sql = "SELECT id, name, slug, emoji, description FROM categories WHERE is_active = 1";
  const params = [];
  if (exclude) {
    sql += ' AND slug != ?';
    params.push(exclude);
  }
  sql += ' ORDER BY sort_order';
  const rows = db.prepare(sql).all(...params);
  res.json({ success: true, data: rows });
});

// GET /orders/:id/qr-download — Telegram Mini Apps downloadFile() requires an
// HTTPS URL that returns attachment headers. Keep this public: the QR contains
// only payment amount + memo, and Telegram downloads it outside fetch auth.
router.get('/orders/:id/qr-download', async (req, res) => {
  const id = parseInt(req.params.id);
  const order = db.prepare('SELECT id, total_price, payment_code, bank_name FROM orders WHERE id = ?').get(id);
  if (!order) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

  const banks = paymentService.getBanks();
  const bank = banks.find((b) => b.NAME === order.bank_name) || banks[0];
  const qrUrl = paymentService.generateQRUrl(order.total_price, order.payment_code, bank);

  try {
    const buf = await fetchQrPngBuffer(qrUrl);
    const safeCode = String(order.payment_code || `order-${id}`).replace(/[^\w-]/g, '');
    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="QR-${safeCode}.png"`,
      'Access-Control-Allow-Origin': 'https://web.telegram.org',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': 'private, max-age=60',
    });
    return res.send(buf);
  } catch (e) {
    return res.status(502).json({
      success: false,
      error: { code: 'QR_FETCH_FAILED', message: e?.message || 'Không tải được ảnh QR' },
    });
  }
});

function shapePublicProduct(p) {
  const stock = (p.display_stock != null) ? p.display_stock : (p.stock_count || 0);
  const priceMin = (p.variant_min != null) ? Number(p.variant_min) : Number(p.price || 0);
  const priceMax = (p.variant_max != null) ? Number(p.variant_max) : priceMin;
  const globalDiscount = discountService.findActiveGlobal();
  const base = {
    id: String(p.id),
    name: p.name,
    slug: p.slug,
    emoji: p.emoji || '📦',
    imageUrl: p.image_url || '',
    price: p.price,
    priceMin,
    priceMax,
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
  const shaped = applyGlobalPricing(base, globalDiscount);
  if (globalDiscount) {
    const discountMin = discountService.computeDiscount(globalDiscount, priceMin);
    const discountMax = discountService.computeDiscount(globalDiscount, priceMax);
    shaped.salePriceMin = Math.max(0, priceMin - discountMin);
    shaped.salePriceMax = Math.max(0, priceMax - discountMax);
  }
  return sanitizeProductForClient(shaped);
}

// GET /products
router.get('/products', (req, res) => {
  const idsParam = (req.query.ids || '').trim();
  if (idsParam) {
    const ids = idsParam.split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50);
    if (ids.length === 0) {
      return res.json({ success: true, data: [] });
    }
    const placeholders = ids.map(() => '?').join(',');
    const caseExpr = ids.map((id, i) => `WHEN p.id = ${id} THEN ${i}`).join(' ');
    const rows = db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) as stock_count,
        (SELECT MIN(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) as variant_min,
        (SELECT MAX(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) as variant_max,
        CASE
          WHEN (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) > 0
          THEN (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0)
          ELSE COALESCE(p.sheet_stock, 0)
        END as display_stock,
        c.name as category_name, c.slug as category_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id IN (${placeholders}) AND p.is_active = 1
      ORDER BY CASE ${caseExpr} END
    `).all(...ids);
    return res.json({ success: true, data: rows.map(shapePublicProduct) });
  }

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

  const priceMin = parseInt(req.query.priceMin);
  const priceMax = parseInt(req.query.priceMax);
  if (Number.isInteger(priceMin) && priceMin >= 0) {
    where += ' AND COALESCE((SELECT MIN(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1), p.price) >= ?';
    params.push(priceMin);
  }
  if (Number.isInteger(priceMax) && priceMax >= 0) {
    where += ' AND COALESCE((SELECT MAX(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1), p.price) <= ?';
    params.push(priceMax);
  }

  let orderBy;
  switch (sort) {
    case 'price_asc':
      orderBy = 'COALESCE((SELECT MIN(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1), p.price) ASC, p.id';
      break;
    case 'price_desc':
      orderBy = 'COALESCE((SELECT MAX(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1), p.price) DESC, p.id';
      break;
    case 'newest': orderBy = 'p.created_at DESC, p.id DESC'; break;
    case 'name_asc': orderBy = 'p.name COLLATE NOCASE ASC, p.id'; break;
    case 'name_desc': orderBy = 'p.name COLLATE NOCASE DESC, p.id'; break;
    default: orderBy = 'p.sort_order, p.id';
  }

  const limit = Math.min(parseInt(req.query.limit) || 0, 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const limitClause = limit > 0 ? ` LIMIT ${limit} OFFSET ${offset}` : '';

  const rows = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) as stock_count,
      (SELECT MIN(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) as variant_min,
      (SELECT MAX(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) as variant_max,
      CASE
        WHEN (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) > 0
        THEN (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0)
        ELSE COALESCE(p.sheet_stock, 0)
      END as display_stock,
      c.name as category_name, c.slug as category_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE ${where}
    ORDER BY ${orderBy}${limitClause}
  `).all(...params);

  const response = { success: true, data: rows.map(shapePublicProduct) };
  if (limit > 0) {
    const total = db.prepare(`
      SELECT COUNT(*) AS c FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE ${where}
    `).get(...params).c;
    response.total = total;
  }
  res.json(response);
});

// GET /products/featured — featured products, padded with newest if needed
router.get('/products/featured', (req, res) => {
  const limit = 8;
  const featured = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) as stock_count,
      (SELECT MIN(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) as variant_min,
      (SELECT MAX(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) as variant_max,
      CASE
        WHEN (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) > 0
        THEN (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0)
        ELSE COALESCE(p.sheet_stock, 0)
      END as display_stock,
      c.name as category_name, c.slug as category_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.is_active = 1 AND p.is_featured = 1
    ORDER BY p.sort_order, p.id
    LIMIT ?
  `).all(limit);

  if (featured.length >= limit) {
    return res.json({ success: true, data: featured.map(shapePublicProduct) });
  }
  const featuredIds = new Set(featured.map((r) => r.id));
  const fillNeeded = limit - featured.length;
  const fill = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) as stock_count,
      (SELECT MIN(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) as variant_min,
      (SELECT MAX(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) as variant_max,
      CASE
        WHEN (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) > 0
        THEN (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0)
        ELSE COALESCE(p.sheet_stock, 0)
      END as display_stock,
      c.name as category_name, c.slug as category_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.is_active = 1
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ?
  `).all(fillNeeded + featured.length);
  const fillFiltered = fill.filter((r) => !featuredIds.has(r.id)).slice(0, fillNeeded);

  res.json({ success: true, data: [...featured, ...fillFiltered].map(shapePublicProduct) });
});

// GET /products/:slug
router.get('/products/:slug', (req, res) => {
  const product = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) as stock_count,
      (SELECT MIN(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) as variant_min,
      (SELECT MAX(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) as variant_max,
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

  const p = product;
  const stock = (p.display_stock != null) ? p.display_stock : (p.stock_count || 0);
  const globalDiscount = discountService.findActiveGlobal();
  const variantRows = variantService.listByProduct(db, p.id);
  const variants = variantRows.map(v => {
    let inputFields = null;
    if (v.input_fields_json) {
      try { inputFields = JSON.parse(v.input_fields_json); } catch { inputFields = null; }
    }
    return applyGlobalPricing({
      id: String(v.id),
      name: v.name,
      description: v.description || '',
      price: v.price,
      sortOrder: v.sort_order,
      stock: v.is_backorder ? 9999 : variantService.countAvailableStock(db, p.id, v.id),
      isBackorder: !!v.is_backorder,
      requiresInput: !!v.requires_input,
      inputLabel: v.input_label || null,
      inputPlaceholder: v.input_placeholder || null,
      inputType: v.input_type || 'text',
      inputFields,
      imageUrl: v.image_url || p.image_url || '',
    }, globalDiscount);
  });

  const shaped = applyGlobalPricing({
    id: String(p.id),
    name: p.name,
    slug: p.slug,
    emoji: p.emoji || '📦',
    imageUrl: p.image_url || '',
    price: p.price,
    priceMin: p.variant_min != null ? Number(p.variant_min) : Number(p.price || 0),
    priceMax: p.variant_max != null ? Number(p.variant_max) : Number(p.price || 0),
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
    variants,
    globalDiscount: shapeGlobalDiscount(globalDiscount, p.price),
  }, globalDiscount);
  if (globalDiscount) {
    const minP = shaped.priceMin ?? shaped.price;
    const maxP = shaped.priceMax ?? shaped.price;
    const discountMin = discountService.computeDiscount(globalDiscount, minP);
    const discountMax = discountService.computeDiscount(globalDiscount, maxP);
    shaped.salePriceMin = Math.max(0, minP - discountMin);
    shaped.salePriceMax = Math.max(0, maxP - discountMax);
  }
  res.json({ success: true, data: sanitizeProductForClient(shaped) });
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
      title: normalizeAnnouncementText(r.title),
      body: normalizeAnnouncementText(r.body),
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
