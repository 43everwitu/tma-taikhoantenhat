const { Router } = require('express');
const db = require('../../database');
const { sanitizeProductForClient } = require('../../services/productService');
const variantService = require('../../services/variantService');
const config = require('../../config');
const messageTemplateService = require('../../services/messageTemplateService');
const paymentService = require('../../services/paymentService');
const discountService = require('../../services/discountService');
const { cacheImageUrl, cacheImageUrlsInHtml } = require('../../services/imageCacheService');
const { resolveContactOnly } = require('../../utils/contactOnly');
const { searchProductCandidates } = require('../../services/productSearchService');

const router = Router();

const shopInfoStmt = db.prepare(`
  SELECT key, value FROM settings
  WHERE key IN ('shop_name', 'support_contact', 'support_url', 'social_telegram', 'social_zalo', 'social_facebook')
`);
const productBySlugStmt = db.prepare(`
  ${productSelectSql()}
  WHERE p.slug = ? AND p.is_active = 1 AND COALESCE(p.is_archived, 0) = 0
`);
const announcementsStmt = db.prepare(`
  SELECT id, title, body, is_pinned, target, created_at
  FROM announcements
  WHERE target IN ('web', 'all')
  ORDER BY is_pinned DESC, created_at DESC
  LIMIT 10
`);

function productSelectSql() {
  return `
    SELECT p.*,
      COALESCE(stock_agg.stock_count, 0) as stock_count,
      variant_agg.variant_min,
      variant_agg.variant_max,
      COALESCE(backorder_agg.has_backorder, 0) as has_backorder,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM product_variants active_variant
          WHERE active_variant.product_id = p.id AND active_variant.is_active = 1
        )
        THEN CASE WHEN EXISTS (
          SELECT 1 FROM product_variants direct_variant
          WHERE direct_variant.product_id = p.id
            AND direct_variant.is_active = 1
            AND COALESCE(direct_variant.contact_only, p.contact_only, 0) = 0
        ) THEN 1 ELSE 0 END
        WHEN COALESCE(p.contact_only, 0) = 0 THEN 1
        ELSE 0
      END as has_direct_sale_option,
      CASE
        WHEN COALESCE(stock_agg.stock_count, 0) > 0
        THEN COALESCE(stock_agg.stock_count, 0)
        ELSE COALESCE(p.sheet_stock, 0)
      END as display_stock,
      c.name as category_name, c.slug as category_slug
    FROM products p
    LEFT JOIN (
      SELECT product_id, COUNT(*) AS stock_count
      FROM stock
      WHERE is_sold = 0
      GROUP BY product_id
    ) stock_agg ON stock_agg.product_id = p.id
    LEFT JOIN (
      SELECT product_id, MIN(price) AS variant_min, MAX(price) AS variant_max
      FROM product_variants
      WHERE is_active = 1
      GROUP BY product_id
    ) variant_agg ON variant_agg.product_id = p.id
    LEFT JOIN (
      SELECT product_id, 1 AS has_backorder
      FROM product_variants
      WHERE is_active = 1 AND is_backorder = 1
      GROUP BY product_id
    ) backorder_agg ON backorder_agg.product_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
  `;
}

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
  shopInfoStmt.all().forEach(r => {
    settings[r.key] = r.value;
  });

  res.json({
    success: true,
    data: {
      shopName: settings.shop_name || config.SHOP_NAME,
      supportContact: settings.support_contact || config.SUPPORT_CONTACT,
      supportUrl: settings.support_url || '',
      socialTelegram: settings.social_telegram || '',
      socialZalo: settings.social_zalo || '',
      socialFacebook: settings.social_facebook || '',
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
  res.json({ success: true, data: listCategories(exclude) });
});

// GET /home — composite payload for the Mini App landing page.
router.get('/home', (req, res) => {
  const globalDiscount = discountService.findActiveGlobal();
  res.json({
    success: true,
    data: {
      announcements: listAnnouncements(),
      globalDiscount: shapeGlobalDiscount(globalDiscount),
      categories: listCategories('uncategorized'),
      featured: listFeaturedProducts(8, globalDiscount),
      newest: listNewestProducts(30, globalDiscount),
    },
  });
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

function shapePublicProduct(p, globalDiscount, options = {}) {
  const stock = (p.display_stock != null) ? p.display_stock : (p.stock_count || 0);
  const hasBackorder = !!p.has_backorder;
  const priceMin = (p.variant_min != null) ? Number(p.variant_min) : Number(p.price || 0);
  const priceMax = (p.variant_max != null) ? Number(p.variant_max) : priceMin;
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
    hasBackorder,
    promotion: p.promotion || null,
    contactOnly: options.includeDetails ? !!p.contact_only : !p.has_direct_sale_option,
    contactUrl: p.contact_url || '',
    category: p.category_name || '',
    categorySlug: p.category_slug || '',
    categoryId: p.category_id,
  };
  if (options.includeDetails) {
    base.description = p.description || '';
    base.longDescription = p.long_description || '';
    base.usageInstructions = p.usage_instructions || '';
  }
  const shaped = applyGlobalPricing(base, globalDiscount);
  if (globalDiscount) {
    const discountMin = discountService.computeDiscount(globalDiscount, priceMin);
    const discountMax = discountService.computeDiscount(globalDiscount, priceMax);
    shaped.salePriceMin = Math.max(0, priceMin - discountMin);
    shaped.salePriceMax = Math.max(0, priceMax - discountMax);
  }
  return sanitizeProductForClient(shaped);
}

function shapePublicProductList(p, globalDiscount) {
  return shapePublicProduct(p, globalDiscount, { includeDetails: false });
}

function shapeAnnouncement(r) {
  return {
    id: String(r.id),
    title: normalizeAnnouncementText(r.title),
    body: normalizeAnnouncementText(r.body),
    pinned: !!r.is_pinned,
    target: r.target || 'all',
    createdAt: r.created_at,
  };
}

async function cacheProductDetailAssets(product, variants) {
  const productFields = ['description', 'long_description', 'usage_instructions'];
  try {
    const imageUrl = await cacheImageUrl(product.image_url);
    if (imageUrl && imageUrl !== product.image_url) {
      db.prepare('UPDATE products SET image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(imageUrl, product.id);
      product.image_url = imageUrl;
    }
  } catch (err) {
    console.warn('[image-cache] product image failed', { productId: product.id, error: err.message });
  }

  for (const field of productFields) {
    try {
      const rewritten = await cacheImageUrlsInHtml(product[field], {
        originalName: `product-${product.id}-${field}`,
      });
      if (rewritten.changed) {
        db.prepare(`UPDATE products SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(rewritten.html, product.id);
        product[field] = rewritten.html;
      }
    } catch (err) {
      console.warn('[image-cache] product html image failed', { productId: product.id, field, error: err.message });
    }
  }

  for (const variant of variants) {
    try {
      const imageUrl = await cacheImageUrl(variant.image_url);
      if (imageUrl && imageUrl !== variant.image_url) {
        db.prepare('UPDATE product_variants SET image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(imageUrl, variant.id);
        variant.image_url = imageUrl;
      }
    } catch (err) {
      console.warn('[image-cache] variant image failed', { variantId: variant.id, error: err.message });
    }

    try {
      const rewritten = await cacheImageUrlsInHtml(variant.description, {
        originalName: `variant-${variant.id}-description`,
      });
      if (rewritten.changed) {
        db.prepare('UPDATE product_variants SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(rewritten.html, variant.id);
        variant.description = rewritten.html;
      }
    } catch (err) {
      console.warn('[image-cache] variant html image failed', { variantId: variant.id, error: err.message });
    }
  }
}

function parseIds(idsParam, max = 50) {
  return String(idsParam || '')
    .split(',')
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, max);
}

function productListRows({ where, params = [], orderBy = 'p.sort_order, p.id', limit = 0, offset = 0 }) {
  const limitClause = limit > 0 ? ` LIMIT ${limit} OFFSET ${offset}` : '';
  return db.prepare(`
    ${productSelectSql()}
    WHERE ${where}
    ORDER BY ${orderBy}${limitClause}
  `).all(...params);
}

function shapeProductList(rows, globalDiscount) {
  return rows.map((r) => shapePublicProductList(r, globalDiscount));
}

function listFeaturedProducts(limit, globalDiscount) {
  const featured = productListRows({
    where: 'p.is_active = 1 AND COALESCE(p.is_archived, 0) = 0 AND p.is_featured = 1',
    orderBy: 'p.sort_order, p.id',
    limit,
  });
  if (featured.length >= limit) return shapeProductList(featured, globalDiscount);

  const featuredIds = new Set(featured.map((r) => r.id));
  const fillNeeded = limit - featured.length;
  const fill = productListRows({
    where: 'p.is_active = 1 AND COALESCE(p.is_archived, 0) = 0',
    orderBy: 'p.created_at DESC, p.id DESC',
    limit: fillNeeded + featured.length,
  });
  const fillFiltered = fill.filter((r) => !featuredIds.has(r.id)).slice(0, fillNeeded);
  return shapeProductList([...featured, ...fillFiltered], globalDiscount);
}

function listNewestProducts(limit, globalDiscount) {
  const rows = productListRows({
    where: 'p.is_active = 1 AND COALESCE(p.is_archived, 0) = 0',
    orderBy: 'p.created_at DESC, p.id DESC',
    limit,
  });
  return shapeProductList(rows, globalDiscount);
}

function listProductsByIds(ids, globalDiscount, { includeDetails = false } = {}) {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const caseExpr = ids.map((id, i) => `WHEN p.id = ${id} THEN ${i}`).join(' ');
  const rows = db.prepare(`
    ${productSelectSql()}
    WHERE p.id IN (${placeholders}) AND p.is_active = 1 AND COALESCE(p.is_archived, 0) = 0
    ORDER BY CASE ${caseExpr} END
  `).all(...ids);
  return rows.map((r) => shapePublicProduct(r, globalDiscount, { includeDetails }));
}

function listAnnouncements() {
  return announcementsStmt.all().map(shapeAnnouncement);
}

function listCategories(exclude = '') {
  let sql = `
    SELECT c.id, c.name, c.slug, c.emoji, c.description
    FROM categories c
    WHERE c.is_active = 1
      AND c.slug IS NOT NULL
      AND TRIM(c.slug) != ''
      AND EXISTS (
        SELECT 1
        FROM products p
        WHERE p.category_id = c.id
          AND p.is_active = 1
          AND COALESCE(p.is_archived, 0) = 0
      )
  `;
  const params = [];
  if (exclude) {
    sql += ' AND c.slug != ?';
    params.push(exclude);
  }
  sql += ' ORDER BY c.sort_order';
  return db.prepare(sql).all(...params);
}

function boundedInt(value, fallback, min, max) {
  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function loadSearchCandidates(rows) {
  if (rows.length === 0) return [];
  const productIds = rows.map((row) => row.id);
  const placeholders = productIds.map(() => '?').join(',');
  const variants = db.prepare(`
    SELECT id, product_id, name, description, is_active
    FROM product_variants
    WHERE is_active = 1 AND product_id IN (${placeholders})
    ORDER BY sort_order, id
  `).all(...productIds);
  const variantsByProduct = new Map();

  for (const variant of variants) {
    if (!variantsByProduct.has(variant.product_id)) {
      variantsByProduct.set(variant.product_id, []);
    }
    variantsByProduct.get(variant.product_id).push(variant);
  }

  return rows.map((product) => ({
    product,
    variants: variantsByProduct.get(product.id) || [],
  }));
}

function shapeSearchMatch(match, globalDiscount) {
  const product = shapePublicProductList(match.product, globalDiscount);
  if (match.matchLabel) product.matchLabel = match.matchLabel;
  return product;
}

// GET /products/search
router.get('/products/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2 || q.length > 100) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_SEARCH_QUERY',
        message: 'Từ khóa tìm kiếm phải có từ 2 đến 100 ký tự',
      },
    });
  }

  const categorySlug = String(req.query.category || '').trim();
  const sort = String(req.query.sort || 'default');
  const allowedSorts = new Set(['default', 'price_asc', 'price_desc', 'newest', 'name_asc', 'name_desc']);
  const searchSort = allowedSorts.has(sort) ? sort : 'default';
  const limit = boundedInt(req.query.limit, 100, 1, 100);
  const suggestionLimit = boundedInt(req.query.suggestionLimit, 8, 0, 20);

  let where = 'p.is_active = 1 AND COALESCE(p.is_archived, 0) = 0';
  const params = [];
  if (categorySlug) {
    where += ' AND c.slug = ?';
    params.push(categorySlug);
  }

  const priceMin = parseInt(req.query.priceMin, 10);
  const priceMax = parseInt(req.query.priceMax, 10);
  if (Number.isInteger(priceMin) && priceMin >= 0) {
    where += ' AND COALESCE((SELECT MIN(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1), p.price) >= ?';
    params.push(priceMin);
  }
  if (Number.isInteger(priceMax) && priceMax >= 0) {
    where += ' AND COALESCE((SELECT MAX(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1), p.price) <= ?';
    params.push(priceMax);
  }

  const rows = productListRows({
    where,
    params,
    orderBy: 'p.sort_order, p.id',
  });
  const matches = searchProductCandidates(loadSearchCandidates(rows), q, { sort: searchSort });
  const globalDiscount = discountService.findActiveGlobal();

  return res.json({
    success: true,
    data: {
      results: matches.results.slice(0, limit).map((match) => shapeSearchMatch(match, globalDiscount)),
      suggestions: matches.suggestions
        .slice(0, suggestionLimit)
        .map((match) => shapeSearchMatch(match, globalDiscount)),
      total: matches.total,
    },
  });
});

// GET /products
router.get('/products', (req, res) => {
  const idsParam = (req.query.ids || '').trim();
  if (idsParam) {
    const ids = parseIds(idsParam);
    if (ids.length === 0) {
      return res.json({ success: true, data: [] });
    }
    const globalDiscount = discountService.findActiveGlobal();
    const includeDetails = req.query.details === '1';
    return res.json({ success: true, data: listProductsByIds(ids, globalDiscount, { includeDetails }) });
  }

  const q = (req.query.q || '').trim();
  const categorySlug = (req.query.category || '').trim();
  const sort = req.query.sort || 'default';

  let where = 'p.is_active = 1 AND COALESCE(p.is_archived, 0) = 0';
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

  const rows = productListRows({ where, params, orderBy, limit, offset });

  const globalDiscount = discountService.findActiveGlobal();
  const response = { success: true, data: shapeProductList(rows, globalDiscount) };
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
  const globalDiscount = discountService.findActiveGlobal();
  res.json({ success: true, data: listFeaturedProducts(limit, globalDiscount) });
});

// GET /products/:slug
router.get('/products/:slug', async (req, res) => {
  const product = productBySlugStmt.get(req.params.slug);

  if (!product) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Sản phẩm không tìm thấy' } });
  }

  const globalDiscount = discountService.findActiveGlobal();
  const p = { ...product };
  const variantRows = variantService.listByProduct(db, p.id).map((v) => ({ ...v }));
  await cacheProductDetailAssets(p, variantRows);
  const stock = (p.display_stock != null) ? p.display_stock : (p.stock_count || 0);
  const hasBackorder = !!p.has_backorder;
  const variantStockCounts = variantService.countAvailableStockByProduct(db, p.id);
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
      stock: variantStockCounts.get(v.id) || 0,
      isBackorder: !!v.is_backorder,
      requiresInput: !!v.requires_input,
      inputLabel: v.input_label || null,
      inputPlaceholder: v.input_placeholder || null,
      inputType: v.input_type || 'text',
      inputFields,
      imageUrl: v.image_url || p.image_url || '',
      contactOnly: resolveContactOnly(p, v),
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
    hasBackorder,
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
  }, globalDiscount, { includeDetails: true });
  if (globalDiscount) {
    const minP = shaped.priceMin ?? shaped.price;
    const maxP = shaped.priceMax ?? shaped.price;
    const discountMin = discountService.computeDiscount(globalDiscount, minP);
    const discountMax = discountService.computeDiscount(globalDiscount, maxP);
    shaped.salePriceMin = Math.max(0, minP - discountMin);
    shaped.salePriceMax = Math.max(0, maxP - discountMax);
  }
  if (p.category_slug) {
    const relatedRows = productListRows({
      where: 'p.is_active = 1 AND COALESCE(p.is_archived, 0) = 0 AND c.slug = ? AND p.id != ?',
      params: [p.category_slug, p.id],
      orderBy: 'p.sort_order, p.id',
      limit: 10,
    });
    shaped.relatedProducts = shapeProductList(relatedRows, globalDiscount);
  } else {
    shaped.relatedProducts = [];
  }
  const recentIds = parseIds(req.query.recent || '').filter((id) => id !== p.id);
  shaped.recentlyViewedProducts = listProductsByIds(recentIds, globalDiscount);
  res.json({ success: true, data: sanitizeProductForClient(shaped) });
});

// GET /announcements — recent public announcements (target = web | all)
router.get('/announcements', (req, res) => {
  res.json({
    success: true,
    data: listAnnouncements(),
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
