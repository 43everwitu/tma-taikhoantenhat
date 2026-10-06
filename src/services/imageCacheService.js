const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const config = require('../config');

const OUT_DIR = path.resolve(__dirname, '../../data/uploads/products-inline');
const PUBLIC_PREFIX = '/uploads/products-inline';
const HTML_IMAGE_ATTR_RE = /\s(src|srcset)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function detectImageKind(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
      && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
      && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = buf.slice(8, 12).toString('ascii');
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }
  return null;
}

function getShopHostnames() {
  const hosts = new Set(['localhost', '127.0.0.1']);
  try {
    hosts.add(new URL(config.WEB_URL).hostname);
  } catch {
    // Ignore invalid WEB_URL; fallback hostnames still cover local dev.
  }
  return hosts;
}

function isLocalUploadUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (raw.startsWith('/uploads/')) return true;

  try {
    const url = new URL(raw);
    return getShopHostnames().has(url.hostname) && url.pathname.startsWith('/uploads/');
  } catch {
    return false;
  }
}

function normalizeImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.startsWith('/uploads/')) return raw;

  try {
    const url = new URL(raw);
    if (getShopHostnames().has(url.hostname) && url.pathname.startsWith('/uploads/')) {
      return url.pathname;
    }
  } catch {
    return raw;
  }

  return raw;
}

function isRemoteImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || isLocalUploadUrl(raw)) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function decodeHtmlUrl(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/g, '&')
    .replace(/&#x26;/gi, '&');
}

function replaceAttrValue(attrText, attrRawValue, nextValue) {
  const valueOffset = attrText.indexOf(attrRawValue);
  const first = attrRawValue[0];
  const quoted = first === '"' || first === "'";
  const quote = quoted ? first : '';
  return [
    attrText.slice(0, valueOffset),
    quote,
    nextValue,
    quote,
    attrText.slice(valueOffset + attrRawValue.length),
  ].join('');
}

async function cacheSrcset(value, options = {}) {
  let changed = false;
  const next = [];
  const candidates = String(value || '').split(',');

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) {
      next.push(candidate);
      continue;
    }
    const parts = trimmed.split(/\s+/);
    const url = decodeHtmlUrl(parts.shift());
    if (!isRemoteImageUrl(url)) {
      next.push(trimmed);
      continue;
    }
    const cached = await cacheImageUrl(url, options);
    if (cached && cached !== url) changed = true;
    next.push([cached || url, ...parts].join(' '));
  }

  return { value: next.join(', '), changed };
}

async function cacheImgTagUrls(tag, { originalName, onError } = {}) {
  let nextTag = '';
  let lastIndex = 0;
  let changed = false;
  let imagesUpdated = 0;
  HTML_IMAGE_ATTR_RE.lastIndex = 0;

  for (const match of tag.matchAll(HTML_IMAGE_ATTR_RE)) {
    const [attrText, attrName, attrRawValue] = match;
    const quote = attrRawValue[0];
    const attrValue = quote === '"' || quote === "'"
      ? attrRawValue.slice(1, -1)
      : attrRawValue;
    let nextValue = attrValue;

    try {
      if (attrName.toLowerCase() === 'src') {
        const srcUrl = decodeHtmlUrl(attrValue);
        if (isRemoteImageUrl(srcUrl)) {
          nextValue = await cacheImageUrl(srcUrl, { originalName });
        }
      } else {
        const srcset = await cacheSrcset(attrValue, { originalName });
        nextValue = srcset.value;
      }
    } catch (err) {
      if (onError) onError(attrValue, err);
    }

    if (nextValue && nextValue !== attrValue) {
      changed = true;
      imagesUpdated++;
    }

    nextTag += tag.slice(lastIndex, match.index);
    nextTag += replaceAttrValue(attrText, attrRawValue, nextValue || attrValue);
    lastIndex = match.index + attrText.length;
  }

  nextTag += tag.slice(lastIndex);
  return { tag: nextTag, changed, imagesUpdated };
}

async function cacheImageUrlsInHtml(html, { originalName, onError } = {}) {
  const raw = String(html || '');
  if (!raw || !/<img\b/i.test(raw) || !/https?:\/\//i.test(raw)) {
    return { html: raw, changed: false, imagesUpdated: 0 };
  }

  const imgRe = /<img\b[^>]*>/gi;
  let output = '';
  let lastIndex = 0;
  let changed = false;
  let imagesUpdated = 0;

  for (const match of raw.matchAll(imgRe)) {
    const tag = match[0];
    const rewritten = await cacheImgTagUrls(tag, { originalName, onError });
    output += raw.slice(lastIndex, match.index);
    output += rewritten.tag;
    lastIndex = match.index + tag.length;
    if (rewritten.changed) {
      changed = true;
      imagesUpdated += rewritten.imagesUpdated;
    }
  }

  output += raw.slice(lastIndex);
  return { html: output, changed, imagesUpdated };
}

async function cacheImageBuffer(buffer, { originalName = 'image' } = {}) {
  const kind = detectImageKind(buffer);
  if (!kind) {
    const err = new Error('File phải là PNG, JPEG, WebP hoặc AVIF.');
    err.status = 415;
    err.code = 'INVALID_FILE_TYPE';
    throw err;
  }

  ensureOutDir();
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const targets = [
    { file: path.join(OUT_DIR, `${hash}-original.webp`), width: 800, fmt: 'webp', q: 80 },
    { file: path.join(OUT_DIR, `${hash}-original.avif`), width: 800, fmt: 'avif', q: 60 },
    { file: path.join(OUT_DIR, `${hash}-thumb.webp`), width: 400, fmt: 'webp', q: 80 },
    { file: path.join(OUT_DIR, `${hash}-thumb.avif`), width: 400, fmt: 'avif', q: 60 },
  ];

  for (const t of targets) {
    if (fs.existsSync(t.file)) continue;
    const pipeline = sharp(buffer).resize({ width: t.width, withoutEnlargement: true });
    if (t.fmt === 'avif') pipeline.avif({ quality: t.q });
    else pipeline.webp({ quality: t.q });
    await pipeline.toFile(t.file);
  }

  return {
    url: `${PUBLIC_PREFIX}/${hash}-original.webp`,
    avifUrl: `${PUBLIC_PREFIX}/${hash}-original.avif`,
    thumbUrl: `${PUBLIC_PREFIX}/${hash}-thumb.webp`,
    originalName,
    hash,
  };
}

async function importImageUrl(sourceUrl, { originalName = null } = {}) {
  const normalized = normalizeImageUrl(sourceUrl);
  if (!normalized) return null;
  if (isLocalUploadUrl(normalized)) {
    return {
      url: normalized.startsWith('/uploads/') ? normalized : new URL(normalized).pathname,
      avifUrl: null,
      thumbUrl: null,
      originalName,
      hash: null,
      cached: false,
    };
  }

  const res = await fetch(normalized, {
    redirect: 'follow',
    headers: {
      accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      'user-agent': 'Mozilla/5.0 (compatible; TaikhoantenhatImageCache/1.0)',
    },
  });

  if (!res.ok) {
    const err = new Error(`Không tải được ảnh (${res.status})`);
    err.status = 502;
    err.code = 'IMAGE_FETCH_FAILED';
    throw err;
  }

  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  const buffer = Buffer.from(await res.arrayBuffer());
  const kind = detectImageKind(buffer);
  if (!kind && !contentType.startsWith('image/')) {
    const err = new Error('URL không trả về ảnh hợp lệ');
    err.status = 415;
    err.code = 'INVALID_REMOTE_IMAGE';
    throw err;
  }

  const cached = await cacheImageBuffer(buffer, {
    originalName: originalName || path.basename(new URL(normalized).pathname) || 'image',
  });
  return {
    ...cached,
    sourceUrl: normalized,
    cached: true,
  };
}

async function cacheImageUrl(value, options = {}) {
  const normalized = normalizeImageUrl(value);
  if (!normalized) return null;
  if (isLocalUploadUrl(normalized)) return normalized.startsWith('/uploads/') ? normalized : new URL(normalized).pathname;
  const cached = await importImageUrl(normalized, options);
  return cached?.url || null;
}

async function cacheImageUrlsInTable(db, {
  table,
  idColumn = 'id',
  urlColumn = 'image_url',
  where = `${urlColumn} IS NOT NULL AND TRIM(${urlColumn}) != ''`,
  updateSql,
  label,
}) {
  const rows = db.prepare(`SELECT ${idColumn} AS id, ${urlColumn} AS image_url FROM ${table} WHERE ${where}`).all();
  const summary = {
    scanned: rows.length,
    updated: 0,
    skippedLocal: 0,
    failed: 0,
    errors: [],
  };
  const stmt = db.prepare(updateSql || `UPDATE ${table} SET ${urlColumn} = ?, updated_at = CURRENT_TIMESTAMP WHERE ${idColumn} = ?`);

  for (const row of rows) {
    const current = String(row.image_url || '').trim();
    if (!current) continue;
    if (isLocalUploadUrl(current)) {
      summary.skippedLocal++;
      continue;
    }
    try {
      const cached = await importImageUrl(current, { originalName: `${label || table}-${row.id}` });
      if (cached?.url && cached.url !== current) {
        stmt.run(cached.url, row.id);
        summary.updated++;
      }
    } catch (err) {
      summary.failed++;
      summary.errors.push({ id: row.id, url: current, error: err.message });
    }
  }

  return summary;
}

async function cacheImageHtmlFieldsInTable(db, {
  table,
  fields,
  idColumn = 'id',
  label,
}) {
  const where = fields
    .map((field) => `(${field} IS NOT NULL AND ${field} LIKE '%<img%' AND ${field} LIKE '%http%')`)
    .join(' OR ');
  const rows = db.prepare(`SELECT ${idColumn} AS id, ${fields.join(', ')} FROM ${table} WHERE ${where}`).all();
  const summary = {
    scanned: rows.length,
    fieldsUpdated: 0,
    imagesUpdated: 0,
    failed: 0,
    errors: [],
  };

  for (const row of rows) {
    for (const field of fields) {
      const current = row[field];
      if (!current) continue;
      const errors = [];
      const rewritten = await cacheImageUrlsInHtml(current, {
        originalName: `${label || table}-${row.id}-${field}`,
        onError: (url, err) => errors.push({ id: row.id, field, url, error: err.message }),
      });
      if (errors.length) {
        summary.failed += errors.length;
        summary.errors.push(...errors);
      }
      if (rewritten.changed) {
        db.prepare(`UPDATE ${table} SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE ${idColumn} = ?`)
          .run(rewritten.html, row.id);
        summary.fieldsUpdated++;
        summary.imagesUpdated += rewritten.imagesUpdated;
      }
    }
  }

  return summary;
}

async function cacheProductAndVariantImageUrls(db) {
  const products = await cacheImageUrlsInTable(db, { table: 'products', label: 'product' });
  const variants = await cacheImageUrlsInTable(db, { table: 'product_variants', label: 'variant' });
  const productHtml = await cacheImageHtmlFieldsInTable(db, {
    table: 'products',
    fields: ['description', 'long_description', 'usage_instructions'],
    label: 'product-html',
  });
  const variantHtml = await cacheImageHtmlFieldsInTable(db, {
    table: 'product_variants',
    fields: ['description'],
    label: 'variant-html',
  });
  return {
    productsUpdated: products.updated,
    productsSkippedLocal: products.skippedLocal,
    productsFailed: products.failed,
    variantsUpdated: variants.updated,
    variantsSkippedLocal: variants.skippedLocal,
    variantsFailed: variants.failed,
    htmlFieldsUpdated: productHtml.fieldsUpdated + variantHtml.fieldsUpdated,
    htmlImagesUpdated: productHtml.imagesUpdated + variantHtml.imagesUpdated,
    htmlImagesFailed: productHtml.failed + variantHtml.failed,
    errors: [...products.errors, ...variants.errors, ...productHtml.errors, ...variantHtml.errors],
  };
}

module.exports = {
  cacheImageBuffer,
  cacheImageUrl,
  cacheImageUrlsInHtml,
  cacheImageUrlsInTable,
  cacheProductAndVariantImageUrls,
  detectImageKind,
  importImageUrl,
  isLocalUploadUrl,
  normalizeImageUrl,
};
