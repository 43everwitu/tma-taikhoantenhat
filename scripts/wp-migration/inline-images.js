const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const WP_HOST_RE = /https:\/\/taikhoantenhat\.com\/wp-content\/uploads\/[^\s"'<>)]+/g;

function extractWpImageUrls(html) {
  if (!html) return [];
  const matches = String(html).match(WP_HOST_RE) || [];
  return Array.from(new Set(matches));
}

function rewriteImageSrcs(html, urlMap) {
  if (!html) return '';
  return String(html).replace(/src=("|')(https:\/\/taikhoantenhat\.com\/wp-content\/uploads\/[^"']+)\1/g,
    (full, q, url) => {
      const replacement = urlMap.get(url);
      return replacement ? `src=${q}${replacement}${q}` : full;
    });
}

const cfg = require('./config');
const { stripWpShortcodes } = require('../../src/utils/wpShortcodes');

function resolveLocalBackup(wpUrl) {
  const m = wpUrl.match(/\/wp-content\/uploads\/(.+)$/);
  if (!m) return null;
  const rel = decodeURIComponent(m[1]);
  const full = path.join(cfg.WP_UPLOADS_ROOT, rel);
  return fs.existsSync(full) ? full : null;
}

async function processSourceFile(srcPath, outDir) {
  const buf = fs.readFileSync(srcPath);
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
  fs.mkdirSync(outDir, { recursive: true });

  const targets = [
    { fmt: 'webp', file: path.join(outDir, `${hash}-original.webp`), width: 800, quality: 80 },
    { fmt: 'avif', file: path.join(outDir, `${hash}-original.avif`), width: 800, quality: 60 },
    { fmt: 'webp', file: path.join(outDir, `${hash}-thumb.webp`),    width: 400, quality: 80 },
    { fmt: 'avif', file: path.join(outDir, `${hash}-thumb.avif`),    width: 400, quality: 60 },
  ];

  for (const t of targets) {
    if (fs.existsSync(t.file)) continue;
    const pipeline = sharp(buf).resize({ width: t.width, withoutEnlargement: true });
    if (t.fmt === 'avif') pipeline.avif({ quality: t.quality });
    else pipeline.webp({ quality: t.quality });
    await pipeline.toFile(t.file);
  }

  return `/uploads/products-inline/${hash}-original.webp`;
}

async function migrateInlineImages(db) {
  const outDir = cfg.PRODUCT_INLINE_IMAGES_OUT;
  const rows = db.prepare('SELECT id, description, long_description FROM products').all();

  const stripped = rows.map(r => ({
    id: r.id,
    description: stripWpShortcodes(r.description || ''),
    long_description: stripWpShortcodes(r.long_description || ''),
  }));

  const allUrls = new Set();
  for (const r of stripped) {
    for (const u of extractWpImageUrls(r.description)) allUrls.add(u);
    for (const u of extractWpImageUrls(r.long_description)) allUrls.add(u);
  }

  console.log(`  → ${allUrls.size} unique WP image URLs across ${rows.length} products`);

  const urlMap = new Map();
  let urlsFetched = 0;
  let urlsMissing = 0;
  for (const url of allUrls) {
    const localSrc = resolveLocalBackup(url);
    if (!localSrc) {
      urlsMissing++;
      console.warn(`  ! missing in backup: ${url}`);
      continue;
    }
    try {
      const finalUrl = await processSourceFile(localSrc, outDir);
      urlMap.set(url, finalUrl);
      urlsFetched++;
    } catch (err) {
      urlsMissing++;
      console.error(`  ! processing failed for ${url}: ${err.message}`);
    }
  }

  const update = db.prepare('UPDATE products SET description = ?, long_description = ? WHERE id = ?');
  let rowsUpdated = 0;
  for (const r of stripped) {
    const newDesc = rewriteImageSrcs(r.description, urlMap);
    const newLong = rewriteImageSrcs(r.long_description, urlMap);
    update.run(newDesc, newLong, r.id);
    rowsUpdated++;
  }

  return { rowsUpdated, urlsTotal: allUrls.size, urlsFetched, urlsMissing };
}

module.exports = { extractWpImageUrls, rewriteImageSrcs, migrateInlineImages, processSourceFile, resolveLocalBackup };
