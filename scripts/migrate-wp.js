#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { extractCategories } = require('./wp-migration/extract-categories');
const { extractProductsAndMeta } = require('./wp-migration/extract-products');
const { extractLicenses } = require('./wp-migration/extract-licenses');
const { resolveProductImagePaths } = require('./wp-migration/extract-images');
const { buildCategoryRows, buildProductRows, buildLicenseStockRows } = require('./wp-migration/transform');
const { processAll } = require('./wp-migration/images');
const { open, resetPreviousImport, loadCategories, loadProducts, loadStock, updateProductImages } = require('./wp-migration/load');
const { makeReport, writeReport, printSummary } = require('./wp-migration/report');
const cfg = require('./wp-migration/config');

async function runInlineImages() {
  const Database = require('better-sqlite3');
  const path = require('node:path');
  const dbPath = path.resolve(__dirname, '..', 'data', 'shop.db');
  console.log(`Running inline-image migration pass-2 against ${dbPath} …`);
  const db = new Database(dbPath);
  const { migrateInlineImages } = require('./wp-migration/inline-images');
  const summary = await migrateInlineImages(db);
  console.log('Done:', summary);
}

async function main() {
  if (process.argv.includes('--inline-images')) {
    return runInlineImages();
  }
  const report = makeReport();
  console.log('1/6 extracting categories…');
  const { terms, taxonomy } = await extractCategories();
  const categoryRows = buildCategoryRows({ terms, taxonomy });

  console.log('2/6 extracting products + meta + relationships…');
  const { posts, meta, termRel } = await extractProductsAndMeta();

  console.log('3/6 opening DB and resetting any previous import…');
  const db = open();
  resetPreviousImport(db);

  const wpTermIdToCategoryId = loadCategories(db, categoryRows);
  report.counts.categoriesImported = categoryRows.length;

  const productRows = buildProductRows({
    posts: posts.filter(p => p.post_type === 'product'),
    meta,
    termRel,
    taxonomy,
    wpTermIdToCategoryId,
  });
  for (const p of posts) {
    if (p.post_type !== 'product' || p.post_status !== 'publish') continue;
    if (!productRows.some(r => r.wp_post_id === Number(p.ID))) {
      const m = meta.find(x => Number(x.post_id) === Number(p.ID) && x.meta_key === '_price');
      if (!m || !m.meta_value || Number(m.meta_value) <= 0) {
        report.counts.productsSkippedNoPrice++;
      } else {
        report.counts.productsSkippedNoCategory++;
      }
    }
  }

  const wpPostIdToProductId = loadProducts(db, productRows);
  report.counts.productsImported = productRows.length;

  console.log('4/6 importing license keys (CSV)…');
  let csvRows = [];
  try {
    csvRows = extractLicenses();
  } catch (err) {
    report.errors.push(`license CSV: ${err.message}`);
  }
  const stockRows = buildLicenseStockRows({ csvRows, wpProductIdToFork: wpPostIdToProductId });
  for (const r of csvRows) {
    if (String(r.status) !== '1') report.counts.stockKeysSkippedSold++;
    else if (!wpPostIdToProductId.has(Number(r.wp_product_id))) {
      report.counts.stockKeysSkippedUnknownProduct++;
    }
  }
  report.counts.stockKeysImported = loadStock(db, stockRows);

  console.log('5/6 processing product images…');
  const productImagePathRel = resolveProductImagePaths({
    productRows,
    meta: meta.filter(m => m.meta_key === '_wp_attached_file'),
  });
  const items = [];
  for (const p of productRows) {
    const rel = productImagePathRel.get(p.wp_post_id);
    if (!rel) continue;
    const srcPath = path.join(cfg.WP_UPLOADS_ROOT, rel);
    if (!fs.existsSync(srcPath)) {
      report.counts.imagesMissingSource++;
      report.errors.push(`image missing for product wp_post_id=${p.wp_post_id}: ${rel}`);
      continue;
    }
    items.push({
      productId: wpPostIdToProductId.get(p.wp_post_id),
      slug: p.slug,
      srcPath,
    });
  }
  const results = await processAll({
    items,
    outDir: cfg.PRODUCT_IMAGES_OUT,
    variants: cfg.IMAGE_VARIANTS,
    concurrency: 4,
  });
  const idToUrl = new Map();
  for (const [productId, val] of results) {
    if (typeof val === 'string') {
      idToUrl.set(productId, val);
      report.counts.imagesOptimized++;
    } else {
      report.counts.imageErrors++;
      report.errors.push(`image error for product ${productId}: ${val.error}`);
    }
  }
  updateProductImages(db, idToUrl);

  console.log('6/6 writing report…');
  writeReport(report);
  printSummary(report);
}

main().catch((err) => {
  console.error('FATAL:', err.stack || err.message);
  process.exit(1);
});
