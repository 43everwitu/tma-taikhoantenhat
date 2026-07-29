const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');
const db = require('../src/database');
const { slugify } = require('../src/utils/slugify');

const HOST = 'https://tenhat.subhub.vn';
const OUT_DIR = path.resolve(__dirname, '../data/uploads/products-inline');
const BACKUP_PATH = path.resolve('/tmp', `shop-before-subhub-import-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);

const PRODUCT_URLS = [
  'https://tenhat.subhub.vn/san-pham/turnitin/',
  'https://tenhat.subhub.vn/san-pham/nang-cap-turboscribe-unlimited-gia-re/',
  'https://tenhat.subhub.vn/san-pham/tai-khoan-meitu-svip-cap-san/',
  'https://tenhat.subhub.vn/san-pham/tai-khoan-iqiyi-cao-cap-gia-re/',
  'https://tenhat.subhub.vn/san-pham/tai-khoan-medium-premium-ga-re/',
  'https://tenhat.subhub.vn/san-pham/goi-nang-cap-figma-education-chinh-chu/',
  'https://tenhat.subhub.vn/san-pham/goi-nang-cap-jetbrains-student-pack/',
  'https://tenhat.subhub.vn/san-pham/tool-semrush-guru-package-trends/',
  'https://tenhat.subhub.vn/san-pham/tai-khoan-blinkist-premium-gia-re/',
  'https://tenhat.subhub.vn/san-pham/tai-khoan-gauth-ai-plus-gia-re/',
  'https://tenhat.subhub.vn/san-pham/mua-khoa-hoc-udemy-gift-course-gia-re/',
  'https://tenhat.subhub.vn/san-pham/goi-nang-cap-kahoot-plus-chinh-chu/',
  'https://tenhat.subhub.vn/san-pham/tai-khoan-originality-kiem-tra-ai/',
  'https://tenhat.subhub.vn/san-pham/tai-khoa-hoc-udemy-coursera-linkedin/',
  'https://tenhat.subhub.vn/san-pham/tai-khoan-oreilly-online-learning/',
  'https://tenhat.subhub.vn/san-pham/tai-khoan-hma-vpn-hide-my-ass/',
  'https://tenhat.subhub.vn/san-pham/tai-khoan-github-copilot-pro-tro-ly-lap-trinh-ai/',
  'https://tenhat.subhub.vn/san-pham/tai-khoan-chatgpt-go-gpt5-gia-re/',
  'https://tenhat.subhub.vn/san-pham/tai-khoan-beautiful-ai-tao-slide/',
  'https://tenhat.subhub.vn/san-pham/nang-cap-tai-khoan-quizlet-plus/',
  'https://tenhat.subhub.vn/san-pham/tai-tai-lieu-bao-cao-kinh-te/',
];

const INPUT_FIELD = [{
  label: 'Thông tin xử lý đơn',
  placeholder: 'Nhập email tài khoản, mật khẩu, link hoặc yêu cầu cần xử lý nếu có.',
  type: 'textarea',
  required: true,
}];

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '-')
    .replace(/&hellip;/g, '...')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"');
}

function stripTags(html) {
  return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function shortDescription(html, maxLength = 500) {
  const text = stripTags(html);
  if (text.length <= maxLength) return text;
  const trimmed = text.slice(0, maxLength - 3).replace(/\s+\S*$/, '').trim();
  return `${trimmed || text.slice(0, maxLength - 3)}...`;
}

function productSlug(url) {
  return new URL(url).pathname.split('/').filter(Boolean).pop();
}

function curlText(url) {
  return execFileSync('curl', ['-L', '-sS', '--max-time', '45', url], {
    maxBuffer: 50 * 1024 * 1024,
  }).toString('utf8');
}

function curlBuffer(url) {
  const buf = execFileSync('curl', ['-L', '-sS', '--max-time', '60', url], {
    maxBuffer: 80 * 1024 * 1024,
  });
  if (buf.length > 0) return buf;
  return execFileSync('curl', ['-L', '-sS', '--max-time', '60', encodeURI(url)], {
    maxBuffer: 80 * 1024 * 1024,
  });
}

function getStoreProduct(slug) {
  const raw = curlText(`${HOST}/wp-json/wc/store/v1/products?slug=${encodeURIComponent(slug)}`);
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`Không tìm thấy Store API product: ${slug}`);
  return rows[0];
}

function getWpProduct(slug) {
  const raw = curlText(`${HOST}/wp-json/wp/v2/product?slug=${encodeURIComponent(slug)}&_embed=1`);
  const rows = JSON.parse(raw);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

function extractVariationJson(html) {
  const match = html.match(/data-product_variations="([^"]*)"/);
  if (!match) return [];
  const decoded = decodeEntities(match[1]);
  if (!decoded || decoded === 'false') return [];
  try {
    const rows = JSON.parse(decoded);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function variationName(row) {
  const attrs = row.attributes || {};
  const values = Object.values(attrs).map(decodeEntities).filter(Boolean);
  return values.length ? values.join(' - ') : `Gói ${row.variation_id || ''}`.trim();
}

function parsePrice(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

function extractFallbackVariants(product, html) {
  const variants = [];
  const seen = new Set();
  const decoded = decodeEntities(html);
  const strongPriceRe = /<strong>\s*(?:[-–]\s*)?([^<]{3,140}?)\s*<\/strong>[\s\S]{0,90}?(?:có giá là|giá là|giá)\s*<strong>\s*([\d.]{2,})\s*(?:đ|vnđ|vnd)?/gi;
  let match;
  while ((match = strongPriceRe.exec(decoded))) {
    const name = stripTags(match[1]).replace(/^[-–]\s*/, '');
    const price = parsePrice(match[2]);
    const key = `${name}:${price}`;
    if (name && price > 0 && !seen.has(key)) {
      seen.add(key);
      variants.push({ name, price, description: '', imageUrl: product.images?.[0]?.src || '' });
    }
  }

  if (variants.length > 0) return variants;

  const terms = (product.attributes || [])
    .filter(a => a.has_variations)
    .flatMap(a => (a.terms || []).map(t => t.name))
    .filter(Boolean);
  const price = parsePrice(product.prices?.price);
  if (terms.length > 0 && price > 0) {
    return terms.map(name => ({ name: decodeEntities(name), price, description: '', imageUrl: product.images?.[0]?.src || '' }));
  }

  return [{
    name: decodeEntities(product.name),
    price: price || 0,
    description: '',
    imageUrl: product.images?.[0]?.src || '',
  }];
}

function shouldRequireInput(slug, name, description, variants) {
  const text = `${slug} ${name} ${stripTags(description)}`.toLowerCase();
  const variantText = variants.map(v => `${v.name} ${stripTags(v.description)}`).join(' ').toLowerCase();
  if (/turnitin|mua-khoa-hoc|tai-khoa-hoc|tai-tai-lieu/.test(slug)) return true;
  if (/^goi-nang-cap-|^nang-cap-/.test(slug)) return true;
  if (/cấp sẵn|cap san|dùng chung|dung chung|dùng riêng|dung rieng|link được cấp|link duoc cap|tool sử dụng trên hệ thống|không nâng cấp trên tài khoản cá nhân/.test(variantText)) {
    return false;
  }
  if (/vui lòng điền|điền thông tin|dien thong tin|tài khoản cần nâng cấp|tai khoan can nang cap|email cần|link khóa học|link khoa hoc|nâng cấp trên tài khoản/.test(variantText)) {
    return true;
  }
  return /nâng cấp|chính chủ|chinh chu|gift|course|khóa học|khoa-hoc|quizlet|kahoot|figma|jetbrains|turboscribe/.test(text);
}

async function cacheImage(url) {
  if (!url || !/^https?:\/\//.test(url)) return '';
  const cleanUrl = decodeEntities(url);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  try {
    const buf = curlBuffer(cleanUrl);
    const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
    const original = path.join(OUT_DIR, `${hash}-original.webp`);
    const thumb = path.join(OUT_DIR, `${hash}-thumb.webp`);
    if (!fs.existsSync(original)) {
      await sharp(buf).resize({ width: 900, withoutEnlargement: true }).webp({ quality: 82 }).toFile(original);
    }
    if (!fs.existsSync(thumb)) {
      await sharp(buf).resize({ width: 420, withoutEnlargement: true }).webp({ quality: 82 }).toFile(thumb);
    }
    return `/uploads/products-inline/${hash}-original.webp`;
  } catch (err) {
    console.warn(`  ! Không cache được ảnh: ${cleanUrl} (${err.message})`);
    return cleanUrl;
  }
}

function extractImageUrls(html) {
  const urls = new Set();
  const re = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = re.exec(String(html || '')))) {
    urls.add(decodeEntities(match[1]));
  }
  return Array.from(urls);
}

async function rewriteImages(html, urlMap) {
  let out = String(html || '');
  for (const [source, local] of urlMap.entries()) {
    out = out.split(source).join(local);
    out = out.split(source.replace(/&/g, '&amp;')).join(local);
  }
  out = out.replace(/\s+srcset=["'][^"']*["']/gi, '');
  out = out.replace(/\s+sizes=["'][^"']*["']/gi, '');
  out = out.replace(/\s+loading=["'][^"']*["']/gi, '');
  out = out.replace(/\s+decoding=["'][^"']*["']/gi, '');
  return out;
}

function categoryFrom(product, wpProduct) {
  const fromStore = product.categories?.[0];
  const fromWp = wpProduct?._embedded?.['wp:term']?.flat()?.find(t => t.taxonomy === 'product_cat');
  const name = decodeEntities(fromStore?.name || fromWp?.name || 'Tiện ích');
  const slug = fromStore?.slug || fromWp?.slug || slugify(name);
  return { name, slug };
}

function ensureCategory(cat) {
  const bySlug = db.prepare('SELECT id FROM categories WHERE slug = ?').get(cat.slug);
  if (bySlug) return bySlug.id;
  const byName = db.prepare('SELECT id FROM categories WHERE lower(name) = lower(?) AND name <> ? ORDER BY id LIMIT 1').get(cat.name, 'r');
  if (byName) return byName.id;
  const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM categories').get().n;
  const result = db.prepare(`
    INSERT INTO categories (name, slug, emoji, sort_order, is_active, description)
    VALUES (?, ?, ?, ?, 1, '')
  `).run(cat.name, cat.slug || slugify(cat.name), '📦', nextOrder);
  return Number(result.lastInsertRowid);
}

function upsertProduct(row) {
  const existing = db.prepare('SELECT id FROM products WHERE slug = ?').get(row.slug);
  if (existing) {
    db.prepare(`
      UPDATE products
      SET category_id = ?, name = ?, price = ?, description = ?, long_description = ?,
          usage_instructions = ?, emoji = ?, promotion = NULL, contact_only = 0,
          contact_url = NULL, sheet_stock = 0, is_active = 1, image_url = ?,
          low_stock_threshold = NULL, is_featured = 1, is_archived = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      row.categoryId, row.name, row.price, row.description, row.longDescription,
      row.usageInstructions, row.emoji, row.imageUrl, existing.id,
    );
    return existing.id;
  }
  const result = db.prepare(`
    INSERT INTO products (
      category_id, name, slug, price, description, long_description, usage_instructions,
      emoji, promotion, contact_only, contact_url, sheet_stock, is_active, image_url,
      low_stock_threshold, sort_order, is_featured, is_archived
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, 0, 1, ?, NULL, ?, 1, 0)
  `).run(
    row.categoryId, row.name, row.slug, row.price, row.description, row.longDescription,
    row.usageInstructions, row.emoji, row.imageUrl, row.sortOrder,
  );
  return Number(result.lastInsertRowid);
}

function replaceVariants(productId, variants, requiresInput) {
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(productId);
  const insert = db.prepare(`
    INSERT INTO product_variants (
      product_id, name, description, price, sort_order, is_active, requires_input,
      input_label, input_placeholder, input_type, input_fields_json, image_url,
      is_backorder, default_duration_days
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 1, NULL)
  `);
  variants.forEach((variant, index) => {
    insert.run(
      productId,
      variant.name.slice(0, 80),
      variant.description || '',
      variant.price,
      index,
      requiresInput ? 1 : 0,
      requiresInput ? 'Thông tin xử lý đơn' : null,
      requiresInput ? 'Nhập thông tin cần xử lý đơn' : null,
      requiresInput ? 'textarea' : 'text',
      requiresInput ? JSON.stringify(INPUT_FIELD) : null,
      variant.imageUrl || null,
    );
  });
}

async function importOne(url, sortOrder) {
  const slug = productSlug(url);
  const product = getStoreProduct(slug);
  const wpProduct = getWpProduct(slug);
  const html = curlText(url);

  const imageUrls = new Set(extractImageUrls(product.description || ''));
  extractImageUrls(wpProduct?.content?.rendered || '').forEach(u => imageUrls.add(u));
  if (product.images?.[0]?.src) imageUrls.add(product.images[0].src);

  const urlMap = new Map();
  for (const imageUrl of imageUrls) {
    urlMap.set(imageUrl, await cacheImage(imageUrl));
  }

  const productImage = product.images?.[0]?.src ? urlMap.get(product.images[0].src) : '';
  const description = shortDescription(product.short_description || wpProduct?.excerpt?.rendered || '');
  const longDescription = await rewriteImages(product.description || wpProduct?.content?.rendered || '', urlMap);
  const categoryId = ensureCategory(categoryFrom(product, wpProduct));

  const rawVariations = extractVariationJson(html);
  let variants = rawVariations.map(v => ({
    name: variationName(v),
    price: Number(v.display_price || v.display_regular_price || 0),
    description: decodeEntities(v.variation_description || ''),
    imageUrl: v.image?.full_src || v.image?.src || product.images?.[0]?.src || '',
  })).filter(v => v.name && v.price > 0);

  if (variants.length === 0) {
    variants = extractFallbackVariants(product, html);
  }

  for (const variant of variants) {
    if (variant.imageUrl) variant.imageUrl = await cacheImage(variant.imageUrl);
  }

  const price = Math.min(...variants.map(v => v.price).filter(Boolean));
  const requiresInput = shouldRequireInput(slug, product.name, longDescription, variants);
  const productId = upsertProduct({
    categoryId,
    name: decodeEntities(product.name),
    slug,
    price: Number.isFinite(price) ? price : parsePrice(product.prices?.price),
    description,
    longDescription,
    usageInstructions: '',
    emoji: '📦',
    imageUrl: productImage,
    sortOrder,
  });
  replaceVariants(productId, variants, requiresInput);
  return { id: productId, slug, name: decodeEntities(product.name), variants: variants.length, price };
}

async function main() {
  const dbPath = path.resolve(__dirname, '../data/shop.db');
  fs.copyFileSync(dbPath, BACKUP_PATH);
  const results = [];
  for (let i = 0; i < PRODUCT_URLS.length; i++) {
    const result = await importOne(PRODUCT_URLS[i], 1000 + i);
    results.push(result);
    console.log(`${i + 1}/${PRODUCT_URLS.length} #${result.id} ${result.slug}: ${result.variants} biến thể`);
  }
  console.log(`Backup DB: ${BACKUP_PATH}`);
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
