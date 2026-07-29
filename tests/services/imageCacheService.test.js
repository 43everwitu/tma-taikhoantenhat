const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAA' +
  'AAC0lEQVR42mP8/x8AAwMCAO2n8sQAAAAASUVORK5CYII=',
  'base64',
);

function stubFetchImage(buffer = PNG_1X1, contentType = 'image/png', onFetch = null) {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (onFetch) onFetch(String(url));
    return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? contentType : null;
      },
    },
    async arrayBuffer() {
      return buffer;
    },
  };
  };
  return () => {
    global.fetch = originalFetch;
  };
}

function createImageCacheDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      image_url TEXT,
      description TEXT,
      long_description TEXT,
      usage_instructions TEXT,
      updated_at TEXT
    );
    CREATE TABLE product_variants (
      id INTEGER PRIMARY KEY,
      product_id INTEGER,
      image_url TEXT,
      description TEXT,
      updated_at TEXT
    );
  `);
  return db;
}

test('importImageUrl caches a remote image into /uploads/products-inline', async (t) => {
  const restoreFetch = stubFetchImage();
  t.after(() => restoreFetch());

  const { importImageUrl } = require('../../src/services/imageCacheService');
  const cached = await importImageUrl('https://example.com/image.png');

  assert.match(cached.url, /^\/uploads\/products-inline\/[a-f0-9]{16}-original\.webp$/);
  const diskPath = path.resolve(__dirname, '..', '..', 'data', cached.url.slice(1));
  assert.ok(fs.existsSync(diskPath), `expected cached file on disk: ${diskPath}`);
  t.after(() => {
    for (const suffix of ['-original.webp', '-original.avif', '-thumb.webp', '-thumb.avif']) {
      const file = diskPath.replace('-original.webp', suffix);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });
});

test('cacheProductAndVariantImageUrls rewrites external product and variant image URLs', async (t) => {
  const restoreFetch = stubFetchImage();
  t.after(() => restoreFetch());
  const db = createImageCacheDb();
  t.after(() => db.close());

  const suffix = Date.now();
  const product = db.prepare(`
    INSERT INTO products (image_url)
    VALUES (?)
  `).run('https://example.com/product.png');
  const variant = db.prepare(`
    INSERT INTO product_variants (product_id, image_url)
    VALUES (?, ?)
  `).run(product.lastInsertRowid, 'https://example.com/variant.png');

  const { cacheProductAndVariantImageUrls } = require('../../src/services/imageCacheService');
  const summary = await cacheProductAndVariantImageUrls(db);

  assert.ok(summary.productsUpdated >= 1, 'product image should be rewritten');
  assert.ok(summary.variantsUpdated >= 1, 'variant image should be rewritten');

  const productRow = db.prepare('SELECT image_url FROM products WHERE id = ?').get(product.lastInsertRowid);
  const variantRow = db.prepare('SELECT image_url FROM product_variants WHERE id = ?').get(variant.lastInsertRowid);
  assert.match(productRow.image_url, /^\/uploads\/products-inline\//);
  assert.match(variantRow.image_url, /^\/uploads\/products-inline\//);
  t.after(() => {
    const files = new Set();
    for (const urlValue of [productRow.image_url, variantRow.image_url]) {
      const rel = urlValue.slice('/uploads/'.length);
      const base = path.resolve(__dirname, '..', '..', 'data', 'uploads', rel.replace('-original.webp', ''));
      for (const suffix of ['-original.webp', '-original.avif', '-thumb.webp', '-thumb.avif']) {
        files.add(base + suffix);
      }
    }
    for (const file of files) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });
});

test('cacheProductAndVariantImageUrls rewrites external images inside product HTML fields', async (t) => {
  const restoreFetch = stubFetchImage();
  t.after(() => restoreFetch());
  const db = createImageCacheDb();
  t.after(() => db.close());

  const suffix = Date.now();
  const html = [
    '<p>Intro</p>',
    '<img loading="lazy" src="https://example.com/intro.png" alt="Intro" />',
    '<img srcset="https://example.com/small.png 400w, https://example.com/large.png 800w" src="https://example.com/fallback.png" />',
  ].join('');
  const product = db.prepare(`
    INSERT INTO products (long_description)
    VALUES (?)
  `).run(html);

  const { cacheProductAndVariantImageUrls } = require('../../src/services/imageCacheService');
  const summary = await cacheProductAndVariantImageUrls(db);

  assert.ok(summary.htmlFieldsUpdated >= 1, 'HTML field should be rewritten');

  const row = db.prepare('SELECT long_description FROM products WHERE id = ?').get(product.lastInsertRowid);
  assert.doesNotMatch(row.long_description, /https:\/\/example\.com\//);
  assert.match(row.long_description, /src="\/uploads\/products-inline\//);
  assert.match(row.long_description, /srcset="\/uploads\/products-inline\/[^"]+ 400w, \/uploads\/products-inline\/[^"]+ 800w"/);
});

test('cacheImageUrlsInHtml decodes escaped query separators before fetching', async (t) => {
  const fetched = [];
  const restoreFetch = stubFetchImage(PNG_1X1, 'image/png', (url) => fetched.push(url));
  t.after(() => restoreFetch());

  const { cacheImageUrlsInHtml } = require('../../src/services/imageCacheService');
  const result = await cacheImageUrlsInHtml(
    '<img src="https://example.com/image?width=768&amp;quality=100" />',
    { originalName: 'escaped-query' },
  );

  assert.strictEqual(fetched[0], 'https://example.com/image?width=768&quality=100');
  assert.match(result.html, /src="\/uploads\/products-inline\//);
});
