const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, price INTEGER);
    CREATE TABLE product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      requires_input INTEGER DEFAULT 0,
      input_label TEXT,
      input_placeholder TEXT,
      input_type TEXT DEFAULT 'text',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      image_url TEXT
    );
    CREATE TABLE stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      variant_id INTEGER,
      data TEXT NOT NULL,
      is_sold INTEGER DEFAULT 0,
      reserved_for_order_id INTEGER
    );
  `);
  db.prepare('INSERT INTO products (id, name, price) VALUES (1, ?, ?)').run('Test', 100);
  return db;
}

const variantService = require('../../src/services/variantService');

test('create + listByProduct returns active variants sorted', () => {
  const db = makeDb();
  variantService.create(db, { productId: 1, name: '3 tháng', price: 200, sortOrder: 2 });
  variantService.create(db, { productId: 1, name: '1 tháng', price: 100, sortOrder: 1 });
  const rows = variantService.listByProduct(db, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, '1 tháng');
  assert.equal(rows[1].name, '3 tháng');
});

test('softDelete sets is_active=0 and listByProduct hides it', () => {
  const db = makeDb();
  const v = variantService.create(db, { productId: 1, name: 'X', price: 100 });
  variantService.softDelete(db, 1, v.id);
  assert.equal(variantService.listByProduct(db, 1).length, 0);
  assert.equal(variantService.listByProduct(db, 1, { includeInactive: true }).length, 1);
});

test('update changes the given fields and bumps updated_at', () => {
  const db = makeDb();
  const v = variantService.create(db, { productId: 1, name: 'X', price: 100 });
  variantService.update(db, 1, v.id, { name: 'Y', price: 150 });
  const out = variantService.listByProduct(db, 1)[0];
  assert.equal(out.name, 'Y');
  assert.equal(out.price, 150);
});

test('countAvailableStock returns 0 with no stock', () => {
  const db = makeDb();
  const v = variantService.create(db, { productId: 1, name: 'X', price: 100 });
  assert.equal(variantService.countAvailableStock(db, 1, v.id), 0);
});

test('countAvailableStock counts only matching variant_id', () => {
  const db = makeDb();
  const v1 = variantService.create(db, { productId: 1, name: 'A', price: 100 });
  const v2 = variantService.create(db, { productId: 1, name: 'B', price: 200 });
  db.prepare("INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (1, ?, 'k1', 0)").run(v1.id);
  db.prepare("INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (1, ?, 'k2', 0)").run(v1.id);
  db.prepare("INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (1, ?, 'k3', 0)").run(v2.id);
  db.prepare("INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (1, NULL, 'k4', 0)").run();
  assert.equal(variantService.countAvailableStock(db, 1, v1.id), 2);
  assert.equal(variantService.countAvailableStock(db, 1, v2.id), 1);
});

test('create with inputType email persists it', () => {
  const db = makeDb();
  const v = variantService.create(db, { productId: 1, name: 'X', price: 100, requiresInput: true, inputLabel: 'Email', inputType: 'email' });
  const row = variantService.getById(db, v.id);
  assert.equal(row.input_type, 'email');
});

test('create with imageUrl persists; listByProduct surfaces it', () => {
  const db = makeDb();
  variantService.create(db, { productId: 1, name: 'Z', price: 100, imageUrl: '/uploads/x.webp' });
  const row = variantService.listByProduct(db, 1)[0];
  assert.equal(row.image_url, '/uploads/x.webp');
});

test('reorder sets sort_order in one transaction', () => {
  const db = makeDb();
  const a = variantService.create(db, { productId: 1, name: 'A', price: 100, sortOrder: 0 });
  const b = variantService.create(db, { productId: 1, name: 'B', price: 100, sortOrder: 1 });
  const c = variantService.create(db, { productId: 1, name: 'C', price: 100, sortOrder: 2 });
  variantService.reorder(db, 1, [{ id: c.id, sortOrder: 0 }, { id: a.id, sortOrder: 1 }, { id: b.id, sortOrder: 2 }]);
  const names = variantService.listByProduct(db, 1).map(r => r.name);
  assert.deepEqual(names, ['C', 'A', 'B']);
});
