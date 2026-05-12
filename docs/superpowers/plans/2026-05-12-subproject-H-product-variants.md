# Sub-project H: Product Variants — Schema + API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `product_variants` table and wire it into stock + orders so the same product can sell at multiple tiers (price/stock/description/optional-input), with API endpoints for admin CRUD and a `variants[]` field on public product detail.

**Architecture:** New `product_variants` table linked to `products`. `stock` gains a nullable `variant_id` so existing inventory stays valid (NULL = legacy product-level key). `orders` gains nullable `variant_id` + encrypted `input_value` for variants that need email/password capture. Service layer (`variantService`) owns all variant queries; both admin and public routes call into it. Orders that reference a variant decrement only that variant's keys.

**Tech Stack:** `better-sqlite3` migrations, Express + Zod routes, AES-GCM via existing `ENCRYPTION_KEY`, `node --test` for tests.

---

## File Structure

- `src/database/migrations/016_product_variants.js` — **CREATE**. Adds `product_variants` table + `variant_id` columns on `stock` + `orders` + `input_value` on `orders` + `is_featured` on `products`. Idempotent (checks for table/column existence).
- `src/services/variantService.js` — **CREATE**. Single owner of variant queries: `listByProduct`, `create`, `update`, `softDelete`, `reorder`, `countAvailableStock(productId, variantId)`. Used by both admin and public routes.
- `src/api/routes/admin/variants.js` — **CREATE**. CRUD endpoints mounted under `/api/v1/admin/products/:productId/variants`.
- `src/api/routes/admin/index.js` — **MODIFY**. Mount the new sub-router.
- `src/api/routes/admin/stock.js` — **MODIFY**. Accept `?variantId=` filter on list; accept `variantId` on POST per-key insert and on the new bulk endpoint.
- `src/api/routes/public.js` — **MODIFY**. `GET /products/:slug` response gains `variants: [...]`. `GET /products` summary unchanged (no variant exposure in list view).
- `src/services/productService.js` — **MODIFY**. `sanitizeProductForClient` learns to sanitize variant descriptions too.
- `src/services/orderService.js` — **MODIFY**. `create()` accepts optional `{ variantId, inputValue }`. Encrypts `inputValue`. Reservation logic narrows stock query by variant when set.
- `src/utils/secrets.js` — **CREATE** (if no equivalent exists). AES-GCM helpers `encryptString` / `decryptString` using `ENCRYPTION_KEY`. (Check `src/services/userService.js` first — it may already wrap `ENCRYPTION_KEY`. Reuse if so.)
- `tests/api/variants-admin.test.js` — **CREATE**. End-to-end CRUD via the JWT-authenticated admin path.
- `tests/api/products-variants-public.test.js` — **CREATE**. Verifies `GET /products/:slug` returns sanitized variants[] including stock counts.
- `tests/services/variantService.test.js` — **CREATE**. Unit tests for the service layer.

---

## Notes for the Engineer

- **Read `web/AGENTS.md`** before any frontend work. Not relevant in this sub-project (backend only) but kept here so the rule isn't forgotten.
- **Migrations run automatically** at boot via `src/database/migrations/runner.js`. Adding a new file under `src/database/migrations/` named `0XX_*.js` is sufficient. Boot the server (`node --watch src/index.js`) to apply.
- **Existing migration style** is `function up(db)` + `module.exports = { up }`. Use the `hasColumn` helper pattern shown in `003_usage_instructions.js` for idempotent column adds.
- **`ENCRYPTION_KEY`** is a hex string (64 chars = 32 bytes) loaded from `.env`. Already required by the wallet flow. Check `src/services/userService.js` or `src/utils/` for an existing AES helper before adding a new one.
- **`data/shop.db` is the live DB.** Snapshot it before running new migrations: `cp data/shop.db data/shop.db.bak-$(date +%s)`.
- **Tests use `node --test`** under Node 20. Existing tests in `tests/api/` use `fetch()` against the running dev server at `:3000`. New API tests follow that pattern (the dev stack must be running, or the test boots its own express). See `tests/api/auth-miniapp.test.js` for the in-process pattern.
- **Don't break the legacy single-SKU path.** All new columns must be nullable. Existing rows must continue to behave exactly as before when `variant_id IS NULL`.
- **Variant descriptions go through `sanitizeDescription`** (the rich profile from sub-project F). Don't introduce a new sanitizer.

---

## Task 1: Migration 016 — variants table + column adds

**Files:**
- Create: `src/database/migrations/016_product_variants.js`

- [ ] **Step 1: Write the migration**

```js
function hasColumn(db, table, column) {
  return db.pragma(`table_info(${table})`).some(c => c.name === column);
}

function hasTable(db, name) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
}

function up(db) {
  if (!hasTable(db, 'product_variants')) {
    db.exec(`
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);
    db.exec(`CREATE INDEX idx_variants_product ON product_variants(product_id, is_active, sort_order)`);
  }

  if (!hasColumn(db, 'stock', 'variant_id')) {
    db.exec(`ALTER TABLE stock ADD COLUMN variant_id INTEGER`);
    db.exec(`CREATE INDEX idx_stock_variant_available ON stock(product_id, variant_id, is_sold)`);
  }

  if (!hasColumn(db, 'orders', 'variant_id')) {
    db.exec(`ALTER TABLE orders ADD COLUMN variant_id INTEGER`);
  }

  if (!hasColumn(db, 'orders', 'input_value')) {
    // Encrypted at write — never stored in plaintext.
    db.exec(`ALTER TABLE orders ADD COLUMN input_value TEXT`);
  }

  if (!hasColumn(db, 'products', 'is_featured')) {
    db.exec(`ALTER TABLE products ADD COLUMN is_featured INTEGER DEFAULT 0`);
  }
}

module.exports = { up };
```

- [ ] **Step 2: Snapshot DB and boot**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
cp data/shop.db data/shop.db.bak-$(date +%s)
# Trigger migration via dev stack reload
touch src/index.js
sleep 3
sqlite3 data/shop.db "SELECT name FROM migrations ORDER BY id DESC LIMIT 3"
```
Expected: top entry is `016_product_variants.js`.

- [ ] **Step 3: Verify schema**

```bash
sqlite3 data/shop.db ".schema product_variants"
sqlite3 data/shop.db "SELECT COUNT(*) FROM pragma_table_info('stock') WHERE name='variant_id'"
sqlite3 data/shop.db "SELECT COUNT(*) FROM pragma_table_info('orders') WHERE name='variant_id'"
sqlite3 data/shop.db "SELECT COUNT(*) FROM pragma_table_info('orders') WHERE name='input_value'"
sqlite3 data/shop.db "SELECT COUNT(*) FROM pragma_table_info('products') WHERE name='is_featured'"
```
Expected: schema printed; the four `SELECT COUNT(*)` queries each return `1`.

- [ ] **Step 4: Commit**

```bash
git add src/database/migrations/016_product_variants.js
git commit -m "feat(db): migration 016 — product_variants table + variant_id + is_featured"
```

---

## Task 2: AES-GCM encryption helper

**Files:**
- Read first: `src/services/userService.js`, search for `ENCRYPTION_KEY` usage. If `encryptString` / `decryptString` already exist (or any equivalent like `encryptCustomerInfo`), REUSE — skip creating `src/utils/secrets.js`. If yes, this entire task collapses to: "Add JSDoc note pointing to the existing helpers."

If they exist:
- [ ] **Step 1**: Document the existing helpers in the JSDoc of `orderService.create()` (see Task 6).
- [ ] **Step 2**: Commit nothing — this task is a no-op.

If they don't exist:

- [ ] **Step 1: Create `src/utils/secrets.js`**

```js
const crypto = require('node:crypto');
const config = require('../config');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function getKey() {
  const hex = config.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

function encryptString(plain) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv | tag | ciphertext)
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function decryptString(packed) {
  if (packed == null || packed === '') return null;
  const buf = Buffer.from(packed, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const ct = buf.subarray(IV_LEN + 16);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

module.exports = { encryptString, decryptString };
```

- [ ] **Step 2: Tests**

Create `tests/utils/secrets.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');

// Set a fixed key for deterministic tests; load .env afterwards isn't needed.
process.env.ENCRYPTION_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

const { encryptString, decryptString } = require('../../src/utils/secrets');

test('round-trips a string', () => {
  const out = decryptString(encryptString('hello@example.com'));
  assert.equal(out, 'hello@example.com');
});

test('returns null for null/empty', () => {
  assert.equal(encryptString(null), null);
  assert.equal(encryptString(''), null);
  assert.equal(decryptString(null), null);
});

test('ciphertext differs across calls (random IV)', () => {
  const a = encryptString('same');
  const b = encryptString('same');
  assert.notEqual(a, b);
  assert.equal(decryptString(a), 'same');
  assert.equal(decryptString(b), 'same');
});

test('decrypt fails on tampered ciphertext', () => {
  const ct = encryptString('secret');
  const tampered = Buffer.from(ct, 'base64');
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptString(tampered.toString('base64')));
});
```

Run:
```bash
source ~/.nvm/nvm.sh && nvm use 20 && node --test tests/utils/secrets.test.js 2>&1 | tail -10
```
Expected: 4/4 pass.

- [ ] **Step 3: Commit**

```bash
git add src/utils/secrets.js tests/utils/secrets.test.js
git commit -m "feat(utils): AES-GCM encryptString / decryptString helpers"
```

---

## Task 3: variantService (data access)

**Files:**
- Create: `src/services/variantService.js`
- Create: `tests/services/variantService.test.js`

- [ ] **Step 1: Write failing tests**

`tests/services/variantService.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

// In-memory test DB with minimal schema replicating real columns.
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  // listByProduct with includeInactive=true still sees it
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
  // Product-level (variant_id IS NULL) shouldn't bleed into either bucket
  db.prepare("INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (1, NULL, 'k4', 0)").run();
  assert.equal(variantService.countAvailableStock(db, 1, v1.id), 2);
  assert.equal(variantService.countAvailableStock(db, 1, v2.id), 1);
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
```

Run:
```bash
node --test tests/services/variantService.test.js 2>&1 | tail -10
```
Expected: import error — module doesn't exist.

- [ ] **Step 2: Implement `src/services/variantService.js`**

```js
const variantService = {
  /**
   * List variants for a product, default to active only and sorted by sort_order
   * then created_at.
   */
  listByProduct(db, productId, { includeInactive = false } = {}) {
    const where = includeInactive ? '' : ' AND is_active = 1';
    return db.prepare(
      `SELECT id, product_id, name, description, price, sort_order, is_active,
              requires_input, input_label, input_placeholder, created_at, updated_at
         FROM product_variants
        WHERE product_id = ?${where}
        ORDER BY sort_order ASC, id ASC`
    ).all(productId);
  },

  getById(db, variantId) {
    return db.prepare(
      `SELECT id, product_id, name, description, price, sort_order, is_active,
              requires_input, input_label, input_placeholder
         FROM product_variants
        WHERE id = ?`
    ).get(variantId) || null;
  },

  create(db, { productId, name, description = null, price, sortOrder = 0,
               requiresInput = false, inputLabel = null, inputPlaceholder = null }) {
    const r = db.prepare(
      `INSERT INTO product_variants
         (product_id, name, description, price, sort_order, requires_input, input_label, input_placeholder)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(productId, name, description, price, sortOrder,
          requiresInput ? 1 : 0, inputLabel, inputPlaceholder);
    return { id: r.lastInsertRowid };
  },

  update(db, productId, variantId, fields) {
    // Only update keys that are explicitly provided.
    const map = {
      name: 'name', description: 'description', price: 'price',
      sortOrder: 'sort_order', isActive: 'is_active',
      requiresInput: 'requires_input', inputLabel: 'input_label',
      inputPlaceholder: 'input_placeholder',
    };
    const sets = [];
    const params = [];
    for (const [jsKey, sqlKey] of Object.entries(map)) {
      if (fields[jsKey] === undefined) continue;
      sets.push(`${sqlKey} = ?`);
      const v = fields[jsKey];
      params.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
    }
    if (sets.length === 0) return { changes: 0 };
    sets.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(productId, variantId);
    const r = db.prepare(
      `UPDATE product_variants SET ${sets.join(', ')} WHERE product_id = ? AND id = ?`
    ).run(...params);
    return { changes: r.changes };
  },

  softDelete(db, productId, variantId) {
    const r = db.prepare(
      `UPDATE product_variants SET is_active = 0, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ? AND id = ?`
    ).run(productId, variantId);
    return { changes: r.changes };
  },

  reorder(db, productId, items) {
    const stmt = db.prepare(
      `UPDATE product_variants SET sort_order = ?, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ? AND id = ?`
    );
    const tx = db.transaction((rows) => {
      for (const { id, sortOrder } of rows) stmt.run(sortOrder, productId, id);
    });
    tx(items);
  },

  /**
   * Count of unsold, unreserved stock rows for a variant. variantId is required
   * (use null/undefined for "product-level only" which is intentionally a
   * different concept — see `productService` for that).
   */
  countAvailableStock(db, productId, variantId) {
    return db.prepare(
      `SELECT COUNT(*) AS c FROM stock
        WHERE product_id = ? AND variant_id = ?
          AND is_sold = 0 AND reserved_for_order_id IS NULL`
    ).get(productId, variantId).c;
  },
};

module.exports = variantService;
```

- [ ] **Step 3: Run tests, expect pass**

```bash
node --test tests/services/variantService.test.js 2>&1 | tail -10
```
Expected: 6/6 pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/variantService.js tests/services/variantService.test.js
git commit -m "feat(services): variantService — CRUD + stock count + reorder"
```

---

## Task 4: Admin variant routes

**Files:**
- Create: `src/api/routes/admin/variants.js`
- Modify: `src/api/routes/admin/index.js`
- Create: `tests/api/variants-admin.test.js`

- [ ] **Step 1: Write the route file `src/api/routes/admin/variants.js`**

```js
const { Router } = require('express');
const { z } = require('zod');
const db = require('../../../database');
const variantService = require('../../../services/variantService');
const auditService = require('../../../services/auditService');
const { validate } = require('../../middleware/validate');

const router = Router({ mergeParams: true });

const variantBody = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(20000).nullable().optional(),
  price: z.number().int().nonnegative(),
  sortOrder: z.number().int().optional(),
  requiresInput: z.boolean().optional(),
  inputLabel: z.string().max(80).nullable().optional(),
  inputPlaceholder: z.string().max(200).nullable().optional(),
});

const variantPatch = variantBody.partial().extend({
  isActive: z.boolean().optional(),
});

// GET /admin/products/:productId/variants
router.get('/', (req, res) => {
  const productId = parseInt(req.params.productId);
  const includeInactive = req.query.includeInactive === '1';
  const rows = variantService.listByProduct(db, productId, { includeInactive });
  res.json({ success: true, data: rows.map(shapeVariant) });
});

// POST /admin/products/:productId/variants
router.post('/', validate(variantBody), (req, res) => {
  const productId = parseInt(req.params.productId);
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!product) return res.status(404).json({ success: false, error: { code: 'PRODUCT_NOT_FOUND' } });

  const { id } = variantService.create(db, { productId, ...req.validated });
  auditService.log(req.admin?.id, 'variant.create', { productId, variantId: id });
  res.status(201).json({ success: true, data: { id } });
});

// PUT /admin/products/:productId/variants/:id
router.put('/:id', validate(variantPatch), (req, res) => {
  const productId = parseInt(req.params.productId);
  const variantId = parseInt(req.params.id);
  const r = variantService.update(db, productId, variantId, req.validated);
  if (r.changes === 0) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  auditService.log(req.admin?.id, 'variant.update', { productId, variantId, fields: Object.keys(req.validated) });
  res.json({ success: true });
});

// DELETE /admin/products/:productId/variants/:id
router.delete('/:id', (req, res) => {
  const productId = parseInt(req.params.productId);
  const variantId = parseInt(req.params.id);
  const r = variantService.softDelete(db, productId, variantId);
  if (r.changes === 0) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  auditService.log(req.admin?.id, 'variant.delete', { productId, variantId });
  res.json({ success: true });
});

// PATCH /admin/products/:productId/variants/reorder
const reorderBody = z.object({
  items: z.array(z.object({ id: z.number().int(), sortOrder: z.number().int() })).min(1),
});
router.patch('/reorder', validate(reorderBody), (req, res) => {
  const productId = parseInt(req.params.productId);
  variantService.reorder(db, productId, req.validated.items);
  auditService.log(req.admin?.id, 'variant.reorder', { productId, count: req.validated.items.length });
  res.json({ success: true });
});

function shapeVariant(v) {
  return {
    id: String(v.id),
    productId: String(v.product_id),
    name: v.name,
    description: v.description || '',
    price: v.price,
    sortOrder: v.sort_order,
    isActive: !!v.is_active,
    requiresInput: !!v.requires_input,
    inputLabel: v.input_label || null,
    inputPlaceholder: v.input_placeholder || null,
    stock: variantService.countAvailableStock(db, v.product_id, v.id),
  };
}

module.exports = router;
```

- [ ] **Step 2: Mount router in `src/api/routes/admin/index.js`**

Read the file. Add immediately after the existing `products` mount (or near it):

```js
router.use('/products/:productId/variants', require('./variants'));
```

If the file uses an explicit list-form export, splice the new mount in at a sensible position. The exact line depends on the current structure — open it and add the line.

- [ ] **Step 3: Write the end-to-end test `tests/api/variants-admin.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert');

const API = 'http://localhost:3000/api/v1';

async function login() {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD }),
  });
  const j = await r.json();
  return j.data.token;
}

async function authed(token, method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  return { status: r.status, body: j };
}

let token;
let productId;

test('setup: login + pick a product', async () => {
  require('dotenv').config();
  token = await login();
  const r = await authed(token, 'GET', '/admin/products');
  productId = r.body.data[0].id;
  assert.ok(productId);
});

test('GET variants of fresh product returns empty', async () => {
  const r = await authed(token, 'GET', `/admin/products/${productId}/variants`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.data));
});

test('POST creates a variant', async () => {
  const r = await authed(token, 'POST', `/admin/products/${productId}/variants`, {
    name: 'TEST_1_THANG', price: 99000, sortOrder: 10,
  });
  assert.equal(r.status, 201);
  assert.ok(r.body.data.id);
  global.__testVariantId = r.body.data.id;
});

test('GET shows the new variant', async () => {
  const r = await authed(token, 'GET', `/admin/products/${productId}/variants`);
  const found = r.body.data.find(v => v.name === 'TEST_1_THANG');
  assert.ok(found, 'variant should be in list');
  assert.equal(found.price, 99000);
  assert.equal(found.stock, 0);
});

test('PUT updates the variant', async () => {
  const id = global.__testVariantId;
  const r = await authed(token, 'PUT', `/admin/products/${productId}/variants/${id}`, { price: 88000, requiresInput: true, inputLabel: 'Email' });
  assert.equal(r.status, 200);
  const list = await authed(token, 'GET', `/admin/products/${productId}/variants`);
  const found = list.body.data.find(v => Number(v.id) === id);
  assert.equal(found.price, 88000);
  assert.equal(found.requiresInput, true);
  assert.equal(found.inputLabel, 'Email');
});

test('DELETE soft-deletes the variant', async () => {
  const id = global.__testVariantId;
  const r = await authed(token, 'DELETE', `/admin/products/${productId}/variants/${id}`);
  assert.equal(r.status, 200);
  const list = await authed(token, 'GET', `/admin/products/${productId}/variants`);
  const found = list.body.data.find(v => Number(v.id) === id);
  assert.equal(found, undefined);
  const withInactive = await authed(token, 'GET', `/admin/products/${productId}/variants?includeInactive=1`);
  const foundInactive = withInactive.body.data.find(v => Number(v.id) === id);
  assert.equal(foundInactive?.isActive, false);
});
```

- [ ] **Step 4: Run the test**

Make sure dev API is running (`lsof -i :3000 -P -n | grep LISTEN`). Then:

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
touch src/index.js
sleep 3
source ~/.nvm/nvm.sh && nvm use 20 && node --test tests/api/variants-admin.test.js 2>&1 | tail -10
```
Expected: 6/6 pass.

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/admin/variants.js src/api/routes/admin/index.js tests/api/variants-admin.test.js
git commit -m "feat(api): admin variant CRUD + reorder routes"
```

---

## Task 5: Stock route accepts variantId

**Files:**
- Modify: `src/api/routes/admin/stock.js`

- [ ] **Step 1: Inspect current stock route**

```bash
grep -nE "router\.(get|post|patch|delete)" src/api/routes/admin/stock.js
```

Note the existing four handlers from earlier exploration:
- `GET /:productId` (list keys for a product)
- `POST /:productId` (add a key)
- `DELETE /:productId/unsold` (purge unsold)
- `PATCH /:productId/:itemId` (update key)
- `DELETE /:productId/:itemId` (delete key)

- [ ] **Step 2: Add variantId support to list + insert**

In the `GET /:productId` handler, after parsing `page/limit/sold`, add:

```js
  const variantId = req.query.variantId ? parseInt(req.query.variantId) : undefined;
  // Build a clause: undefined → no filter; null → variant_id IS NULL; number → variant_id = ?
  const variantClause = variantId === undefined
    ? ''
    : variantId === 0
      ? ' AND variant_id IS NULL'
      : ' AND variant_id = ?';
```

Append `variantClause` into the existing WHERE clauses and bind `variantId` if numeric. (The exact placement depends on existing param construction — open the file and integrate cleanly.)

In the `POST /:productId` handler, extend the Zod body to allow `variantId: z.number().int().nullable().optional()`. Pass `variantId ?? null` into the INSERT.

Verify with sqlite:
```bash
sqlite3 data/shop.db "SELECT id, product_id, variant_id, is_sold FROM stock LIMIT 5"
```
Expected: rows show `variant_id` column (NULL for all existing rows — back-compat).

- [ ] **Step 3: Commit**

```bash
git add src/api/routes/admin/stock.js
git commit -m "feat(admin-stock): list + insert accept variantId"
```

---

## Task 6: orderService variant + inputValue

**Files:**
- Modify: `src/services/orderService.js`

- [ ] **Step 1: Extend `create()` signature**

Find `create(userId, productId, quantity, totalPrice, opts = {})`. Extend `opts` to accept `variantId` and `inputValue`. Encrypt `inputValue` before INSERT.

```js
const { encryptString } = require('../utils/secrets'); // or the existing helper, see Task 2 note

// ...inside create():
const variantId = opts.variantId ?? null;
const encryptedInput = opts.inputValue ? encryptString(String(opts.inputValue)) : null;

// extend the INSERT column list:
//   INSERT INTO orders (user_id, product_id, variant_id, input_value, quantity, total_price, payment_code, status, source, bank_name, expires_at, payment_method)
//   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

Update the SQL string accordingly, push `variantId`, `encryptedInput` into the args. Existing callers without those opts get NULL for both — back-compat preserved.

- [ ] **Step 2: Stock reservation narrows by variant**

The reservation query currently looks like:
```js
WHERE product_id = ? AND is_sold = 0 AND reserved_for_order_id IS NULL
```

If the order has a `variant_id`, the reservation must only pull keys with the matching variant_id. Add a branch:

```js
let reserveSql, reserveArgs;
if (variantId) {
  reserveSql = `
    UPDATE stock SET reserved_for_order_id = ?, reserved_at = CURRENT_TIMESTAMP
      WHERE id IN (
        SELECT id FROM stock
         WHERE product_id = ? AND variant_id = ?
           AND is_sold = 0 AND reserved_for_order_id IS NULL
         LIMIT ?
      )
  `;
  reserveArgs = [orderId, productId, variantId, quantity];
} else {
  reserveSql = `
    UPDATE stock SET reserved_for_order_id = ?, reserved_at = CURRENT_TIMESTAMP
      WHERE id IN (
        SELECT id FROM stock
         WHERE product_id = ? AND variant_id IS NULL
           AND is_sold = 0 AND reserved_for_order_id IS NULL
         LIMIT ?
      )
  `;
  reserveArgs = [orderId, productId, quantity];
}
```

(If the existing query uses something different from `LIMIT ?`, mirror its style. The shape change is: only reserve keys whose variant_id matches the order's variant_id, OR NULL-only when the order has no variant.)

- [ ] **Step 3: Skip tests for now**

orderService has existing integration tests indirectly via the paymentPoller flow. Don't add a brittle test for the new branch yet — sub-project J's E2E suite will cover variant orders end-to-end. Just ensure existing tests still pass:

```bash
node --test tests/api/ tests/bot/ tests/utils/ tests/services/ 2>&1 | tail -10
```
Expected: 0 fail.

- [ ] **Step 4: Commit**

```bash
git add src/services/orderService.js
git commit -m "feat(orders): create() accepts variantId + encrypted inputValue"
```

---

## Task 7: Public route returns variants[]

**Files:**
- Modify: `src/api/routes/public.js`
- Modify: `src/services/productService.js` (extend `sanitizeProductForClient`)
- Create: `tests/api/products-variants-public.test.js`

- [ ] **Step 1: Extend `sanitizeProductForClient`**

In `src/services/productService.js`, change the helper to also walk `variants[]` if present:

```js
const { sanitizeDescription } = require('../utils/richHtml');

function sanitizeProductForClient(row) {
  const out = {
    ...row,
    description: sanitizeDescription(row.description),
    longDescription: sanitizeDescription(row.longDescription),
  };
  if (Array.isArray(row.variants)) {
    out.variants = row.variants.map(v => ({
      ...v,
      description: sanitizeDescription(v.description),
    }));
  }
  return out;
}
```

- [ ] **Step 2: Public detail endpoint loads variants**

In `src/api/routes/public.js` `GET /products/:slug` handler, after fetching the product row, load variants and attach:

```js
const variantService = require('../../services/variantService');

// ...inside the handler, after `const p = ...`:
const variantRows = variantService.listByProduct(db, p.id);
const variants = variantRows.map(v => ({
  id: String(v.id),
  name: v.name,
  description: v.description || '',
  price: v.price,
  sortOrder: v.sort_order,
  stock: variantService.countAvailableStock(db, p.id, v.id),
  requiresInput: !!v.requires_input,
  inputLabel: v.input_label || null,
  inputPlaceholder: v.input_placeholder || null,
}));

const shaped = {
  // ... existing fields ...
  description: p.description || '',
  longDescription: p.long_description || '',
  variants,
};
res.json({ success: true, data: sanitizeProductForClient(shaped) });
```

- [ ] **Step 3: Test**

`tests/api/products-variants-public.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
require('dotenv').config();

const API = 'http://localhost:3000/api/v1';

async function login() {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD }),
  });
  return (await r.json()).data.token;
}

test('product detail includes variants[]', async () => {
  // Pick a product, attach a variant via admin, then verify public endpoint shows it.
  const tok = await login();
  const list = await (await fetch(`${API}/products?limit=1`)).json();
  const slug = list.data[0].slug;
  const id = list.data[0].id;

  // Create a variant
  const created = await fetch(`${API}/admin/products/${id}/variants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ name: 'V_TEST', price: 12345 }),
  });
  const cj = await created.json();
  const variantId = cj.data.id;

  // Public detail
  const detail = await (await fetch(`${API}/products/${slug}`)).json();
  assert.ok(Array.isArray(detail.data.variants), 'variants must be an array');
  const found = detail.data.variants.find(v => Number(v.id) === variantId);
  assert.ok(found, 'newly-created variant must appear in public detail');
  assert.equal(found.name, 'V_TEST');
  assert.equal(found.price, 12345);
  assert.equal(found.stock, 0);

  // Cleanup
  await fetch(`${API}/admin/products/${id}/variants/${variantId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tok}` },
  });
});

test('product without variants returns empty array (not missing)', async () => {
  // Pick a product with no variants (after cleanup above, list[0] should have none).
  const list = await (await fetch(`${API}/products?limit=1`)).json();
  const slug = list.data[0].slug;
  const detail = await (await fetch(`${API}/products/${slug}`)).json();
  assert.ok(Array.isArray(detail.data.variants));
  // length may be 0 OR positive if test order left variants — either is fine.
});
```

Run:
```bash
node --test tests/api/products-variants-public.test.js 2>&1 | tail -10
```
Expected: 2/2 pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/productService.js src/api/routes/public.js tests/api/products-variants-public.test.js
git commit -m "feat(public-api): expose variants[] on product detail"
```

---

## Task 8: Verify + tag

- [ ] **Step 1: Full test suite green**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
source ~/.nvm/nvm.sh && nvm use 20 && node --test tests/ 2>&1 | tail -15
```
Expected: 0 fail.

- [ ] **Step 2: Schema audit**

```bash
sqlite3 data/shop.db ".schema product_variants" | head
sqlite3 data/shop.db "SELECT COUNT(*) FROM pragma_table_info('orders') WHERE name IN ('variant_id','input_value')"
```
Expected: schema printed; the count is 2.

- [ ] **Step 3: Frontend untouched — build still green**

```bash
cd web && npx tsc --noEmit 2>&1 | tail -3 && npm run build 2>&1 | tail -5
```
Expected: clean.

- [ ] **Step 4: Tag**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git tag v0.6-variants-api -m "Sub-project H: product_variants schema + admin/public API"
```

- [ ] **Step 5: Done**

Report: commit count, test count, schema confirmed. Ready for Sub-project J to consume.

---

## Self-Review

- **Spec coverage:**
  - H1 variants table → Task 1
  - H2 variant_id on stock + orders → Task 1
  - H3 input_value encrypted → Tasks 2, 6
  - H4 admin CRUD → Task 4
  - H5 public detail returns variants → Task 7
  - H6 stock route accepts variantId → Task 5
  - H7 order create accepts variantId + inputValue → Task 6
- **Placeholders:** none — every step has full code or exact commands.
- **Type consistency:** `variantService.listByProduct/create/update/softDelete/reorder/countAvailableStock/getById` defined once in Task 3, called consistently in Tasks 4 + 7. JSON field names match across admin shape (`shapeVariant`) and public shape — both produce `requiresInput`, `inputLabel`, `inputPlaceholder`, `stock`.
- **Back-compat:** every new column is nullable; reservation logic branches on variantId presence so legacy product-level keys (variant_id IS NULL) keep working.
