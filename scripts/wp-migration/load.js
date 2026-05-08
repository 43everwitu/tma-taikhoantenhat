const path = require('node:path');
const Database = require('better-sqlite3');

// The fork's runtime DB lives at data/shop.db (see src/database/index.js).
// The migration writes here directly so the bot/web see the imported rows.
const DB_PATH = path.resolve(__dirname, '../../data/shop.db');

function open() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS wp_term_map (
      wp_term_id INTEGER PRIMARY KEY,
      category_id INTEGER NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS wp_post_map (
      wp_post_id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL UNIQUE
    );
  `);
  return db;
}

/**
 * Wipe rows previously imported by this script. Categories and products
 * outside the maps (e.g. the seed rows from migration 001) are left alone.
 * Stock rows imported in a prior run are also wiped. Orders that reference
 * imported products/stock are an error condition — the tables should be
 * empty before #2 runs (no real customers yet).
 */
function resetPreviousImport(db) {
  const stockDel = db.prepare(`
    DELETE FROM stock
    WHERE product_id IN (SELECT product_id FROM wp_post_map)
  `);
  const productDel = db.prepare(`
    DELETE FROM products
    WHERE id IN (SELECT product_id FROM wp_post_map)
  `);
  const categoryDel = db.prepare(`
    DELETE FROM categories
    WHERE id IN (SELECT category_id FROM wp_term_map)
  `);
  db.transaction(() => {
    stockDel.run();
    productDel.run();
    categoryDel.run();
    db.exec('DELETE FROM wp_post_map; DELETE FROM wp_term_map;');
  })();
}

function loadCategories(db, rows) {
  const insertCat = db.prepare(`
    INSERT INTO categories (name, slug, emoji, sort_order, is_active, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMap = db.prepare(`
    INSERT INTO wp_term_map (wp_term_id, category_id) VALUES (?, ?)
  `);
  const wpTermIdToCategoryId = new Map();
  db.transaction(() => {
    let order = 0;
    for (const r of rows) {
      const result = insertCat.run(r.name, r.slug, r.emoji, order++, r.is_active, '');
      const id = Number(result.lastInsertRowid);
      insertMap.run(r.wp_term_id, id);
      wpTermIdToCategoryId.set(r.wp_term_id, id);
    }
  })();
  return wpTermIdToCategoryId;
}

function loadProducts(db, rows) {
  const insertProd = db.prepare(`
    INSERT INTO products (
      category_id, name, slug, price, description, long_description,
      emoji, promotion, contact_only, contact_url, sheet_stock, is_active, image_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMap = db.prepare(`
    INSERT INTO wp_post_map (wp_post_id, product_id) VALUES (?, ?)
  `);
  const wpPostIdToProductId = new Map();
  db.transaction(() => {
    for (const r of rows) {
      const result = insertProd.run(
        r.category_id, r.name, r.slug, r.price, r.description, r.long_description,
        r.emoji, r.promotion, r.contact_only, r.contact_url, r.sheet_stock, r.is_active, r.image_url
      );
      const id = Number(result.lastInsertRowid);
      insertMap.run(r.wp_post_id, id);
      wpPostIdToProductId.set(r.wp_post_id, id);
    }
  })();
  return wpPostIdToProductId;
}

function loadStock(db, rows) {
  const insert = db.prepare(`INSERT INTO stock (product_id, data) VALUES (?, ?)`);
  let inserted = 0;
  db.transaction(() => {
    for (const r of rows) {
      insert.run(r.product_id, r.data);
      inserted++;
    }
  })();
  return inserted;
}

function updateProductImages(db, idToUrl) {
  const upd = db.prepare(`UPDATE products SET image_url = ? WHERE id = ?`);
  db.transaction(() => {
    for (const [productId, url] of idToUrl) {
      upd.run(url, productId);
    }
  })();
}

module.exports = {
  open,
  resetPreviousImport,
  loadCategories,
  loadProducts,
  loadStock,
  updateProductImages,
};
