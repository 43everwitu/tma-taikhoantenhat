# Admin Order Detail Drawer and Readable Renewal Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full right-side order detail drawer to `admin/orders`, make `admin/renewals` rows human-readable with hidden stock value reveal/copy, and link orders and renewal logs both ways.

**Architecture:** Enrich existing admin APIs rather than stitching data in the frontend. `GET /admin/orders/:id` remains backward-compatible while adding structured detail fields for the drawer; `GET /admin/renewals` joins stock, variant, user, and order data for readable rows. Frontend changes stay inside existing admin pages and reuse current reveal/copy patterns.

**Tech Stack:** Node.js 22, Express, better-sqlite3, Node built-in test runner, Next 16 App Router, React 19, TanStack Query.

---

## Source spec

- `docs/superpowers/specs/2026-06-23-admin-order-detail-renewals-readable-design.md`

## File map

- Modify: `src/api/routes/admin/orders.js` — enrich order detail response for drawer.
- Modify: `src/api/routes/admin/renewals.js` — return readable product/variant/stock/user/order fields.
- Create: `tests/api/admin-orders-detail-readable.test.js` — backend coverage for order detail drawer DTO.
- Modify: `tests/api/admin-renewals.test.js` — coverage for readable renewal rows.
- Modify: `web/src/app/(admin)/admin/orders/page.tsx` — `Chi tiết` action, drawer, sensitive reveal/copy, auto-open via query.
- Modify: `web/src/app/(admin)/admin/renewals/page.tsx` — readable product/variant/stock rows, stock value reveal/copy, order links, highlight.

Do not stage or commit `data/shop.db`, DB backups, `.superpowers/`, uploads, logs, or unrelated dirty files.

---

## Task 1: Backend order detail DTO tests

**Files:**
- Create: `tests/api/admin-orders-detail-readable.test.js`

- [ ] **Step 1: Write failing tests for enriched order detail**

Create `tests/api/admin-orders-detail-readable.test.js`:

```js
const assert = require('node:assert');
const test = require('node:test');
const express = require('express');
const { PassThrough, Readable, Writable } = require('node:stream');
const db = require('../../src/database');

async function requestJson(app, method, path) {
  return await new Promise((resolve, reject) => {
    const req = new Readable({
      read() {
        this.push(null);
      },
    });
    req.method = method;
    req.url = path;
    req.headers = {};
    const socket = new PassThrough();
    socket.remoteAddress = '127.0.0.1';
    req.socket = socket;

    const chunks = [];
    const res = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    res.statusCode = 200;
    res.headers = {};
    res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; };
    res.getHeader = (key) => res.headers[key.toLowerCase()];
    res.removeHeader = (key) => { delete res.headers[key.toLowerCase()]; };
    res.writeHead = (status, headers) => {
      res.statusCode = status;
      if (headers) {
        for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
      }
      return res;
    };
    const end = res.end.bind(res);
    res.end = (chunk, enc, cb) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === 'string' ? enc : undefined));
      end(cb);
      try {
        resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString() || '{}') });
      } catch (err) {
        reject(err);
      }
    };
    app.handle(req, res, reject);
  });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = {
      adminId: 1,
      role: 'super_admin',
      username: 'admin-order-detail-test',
      permissions: JSON.stringify(['orders.read', 'orders.write']),
    };
    next();
  });
  app.use('/admin/orders', require('../../src/api/routes/admin/orders'));
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  });
  app.use((err, _req, res, _next) => {
    res.status(500).json({ success: false, error: { code: 'TEST_ERROR', message: err.message } });
  });
  return app;
}

function seedReadableOrderDetail() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 892_000_000 + Math.floor(Math.random() * 100000);
  return db.transaction(() => {
    db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)').run(
      userId,
      `detail_${suffix}`,
      `Readable Detail ${suffix}`,
    );
    const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
      `detail-cat-${suffix}`,
      `detail-cat-${suffix}`,
    );
    const product = db.prepare(`
      INSERT INTO products (category_id, name, slug, price, is_active)
      VALUES (?, ?, ?, 1000, 1)
    `).run(category.lastInsertRowid, `Readable product ${suffix}`, `readable-product-${suffix}`);
    const variant = db.prepare(`
      INSERT INTO product_variants (product_id, name, price, default_duration_days)
      VALUES (?, ?, 1000, 30)
    `).run(product.lastInsertRowid, `Gói readable ${suffix}`);
    const keyValue = `readable-key-${suffix}`;
    const paymentCode = `PNS_READABLE_DETAIL_${suffix}`;
    const order = db.prepare(`
      INSERT INTO orders (
        user_id, product_id, variant_id, quantity, total_price, payment_code,
        status, source, paid_at, delivered_at, delivered_keys_json
      ) VALUES (?, ?, ?, 1, 1000, ?, 'delivered', 'web', '2099-02-01 01:02:03', '2099-02-01 01:03:04', ?)
    `).run(userId, product.lastInsertRowid, variant.lastInsertRowid, paymentCode, JSON.stringify([keyValue]));
    const stock = db.prepare(`
      INSERT INTO stock (product_id, variant_id, data, duration_days, is_sold, sold_to, sold_at)
      VALUES (?, ?, ?, 30, 1, ?, '2099-02-01 01:03:04')
    `).run(product.lastInsertRowid, variant.lastInsertRowid, keyValue, userId);
    const renewal = db.prepare(`
      INSERT INTO renewal_reminder_logs (
        stock_id, order_id, user_id, product_id, product_name, expiry_date,
        days_before_expiry, telegram_sent, status, message_body, created_at
      ) VALUES (?, ?, ?, ?, ?, '2099-03-03', 3, 1, 'sent', ?, '2099-02-28 00:00:00')
    `).run(
      stock.lastInsertRowid,
      order.lastInsertRowid,
      userId,
      product.lastInsertRowid,
      `Readable product ${suffix}`,
      `Gia hạn readable ${suffix}`,
    );
    const txn = db.prepare(`
      INSERT INTO transactions (
        mb_transaction_number, amount, description, matched_order_id,
        matched_payment_code, match_status, detected_at
      ) VALUES (?, 1000, ?, ?, ?, 'matched', '2099-02-01 01:02:30')
    `).run(`MB_READABLE_${suffix}`, `Thanh toán ${paymentCode}`, order.lastInsertRowid, paymentCode);

    return {
      suffix,
      userId,
      categoryId: category.lastInsertRowid,
      productId: product.lastInsertRowid,
      variantId: variant.lastInsertRowid,
      orderId: order.lastInsertRowid,
      stockId: stock.lastInsertRowid,
      renewalId: renewal.lastInsertRowid,
      transactionId: txn.lastInsertRowid,
      keyValue,
      paymentCode,
    };
  })();
}

function cleanupReadableOrderDetail(seed) {
  db.transaction(() => {
    db.prepare('DELETE FROM transactions WHERE id = ?').run(seed.transactionId);
    db.prepare('DELETE FROM renewal_reminder_logs WHERE id = ?').run(seed.renewalId);
    db.prepare('DELETE FROM stock WHERE id = ?').run(seed.stockId);
    db.prepare('DELETE FROM orders WHERE id = ?').run(seed.orderId);
    db.prepare('DELETE FROM product_variants WHERE id = ?').run(seed.variantId);
    db.prepare('DELETE FROM products WHERE id = ?').run(seed.productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(seed.categoryId);
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(seed.userId);
  })();
}

test('GET /admin/orders/:id returns readable customer product stock transaction and renewal details', async (t) => {
  const seed = seedReadableOrderDetail();
  t.after(() => cleanupReadableOrderDetail(seed));

  const res = await requestJson(makeApp(), 'GET', `/admin/orders/${seed.orderId}`);

  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.success, true);
  assert.strictEqual(res.json.data.id, String(seed.orderId));
  assert.deepStrictEqual(res.json.data.customer, {
    telegramId: String(seed.userId),
    fullName: `Readable Detail ${seed.suffix}`,
    username: `detail_${seed.suffix}`,
  });
  assert.strictEqual(res.json.data.product.id, String(seed.productId));
  assert.strictEqual(res.json.data.product.variantId, String(seed.variantId));
  assert.strictEqual(res.json.data.product.variantName, `Gói readable ${seed.suffix}`);
  assert.strictEqual(res.json.data.product.variantLabel, `Gói readable ${seed.suffix}`);
  assert.strictEqual(res.json.data.stockItems.length, 1);
  assert.strictEqual(res.json.data.stockItems[0].id, String(seed.stockId));
  assert.strictEqual(res.json.data.stockItems[0].value, seed.keyValue);
  assert.strictEqual(res.json.data.stockItems[0].variantName, `Gói readable ${seed.suffix}`);
  assert.strictEqual(res.json.data.accounts[0], seed.keyValue);
  assert.strictEqual(res.json.data.matchedTransaction.id, String(seed.transactionId));
  assert.strictEqual(res.json.data.matchedTransaction.bankReference, `MB_READABLE_${seed.suffix}`);
  assert.strictEqual(res.json.data.renewalLogs.length, 1);
  assert.strictEqual(res.json.data.renewalLogs[0].id, String(seed.renewalId));
  assert.strictEqual(res.json.data.renewalLogs[0].messagePreview, `Gia hạn readable ${seed.suffix}`);
});

test('GET /admin/orders/:id uses legacy variant label when variant is missing', async (t) => {
  const seed = seedReadableOrderDetail();
  t.after(() => cleanupReadableOrderDetail(seed));
  db.prepare('UPDATE orders SET variant_id = NULL WHERE id = ?').run(seed.orderId);
  db.prepare('UPDATE stock SET variant_id = NULL WHERE id = ?').run(seed.stockId);
  db.prepare('DELETE FROM product_variants WHERE id = ?').run(seed.variantId);

  const res = await requestJson(makeApp(), 'GET', `/admin/orders/${seed.orderId}`);

  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.data.product.variantId, null);
  assert.strictEqual(res.json.data.product.variantName, null);
  assert.strictEqual(res.json.data.product.variantLabel, 'mặc định/legacy');
  assert.strictEqual(res.json.data.stockItems[0].variantName, null);
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
node --test --test-concurrency=1 tests/api/admin-orders-detail-readable.test.js
```

Expected: FAIL because `customer`, `product`, `stockItems`, `matchedTransaction`, and `renewalLogs` are not present on `GET /admin/orders/:id`.

- [ ] **Step 3: Commit failing test**

Do not commit the failing test alone. Keep it unstaged until Task 2 implementation makes it pass.

---

## Task 2: Backend order detail DTO implementation

**Files:**
- Modify: `src/api/routes/admin/orders.js`
- Test: `tests/api/admin-orders-detail-readable.test.js`

- [ ] **Step 1: Add helper functions near `shapeOrder`**

Modify `src/api/routes/admin/orders.js` near `shapeOrder`:

```js
function variantLabel(name) {
  return name || 'mặc định/legacy';
}

function hasColumn(table, column) {
  return db.pragma(`table_info(${table})`).some(c => c.name === column);
}

function getCustomer(userId) {
  const row = db.prepare(`
    SELECT telegram_id, full_name, username
    FROM users
    WHERE telegram_id = ?
  `).get(userId);
  if (!row) return { telegramId: String(userId), fullName: null, username: null };
  return {
    telegramId: String(row.telegram_id),
    fullName: row.full_name || null,
    username: row.username || null,
  };
}

function getProductDetail(order) {
  const row = db.prepare(`
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      v.id AS variant_id,
      v.name AS variant_name
    FROM products p
    LEFT JOIN product_variants v ON v.id = ?
    WHERE p.id = ?
  `).get(order.variant_id ?? null, order.product_id);
  if (!row) return null;
  return {
    id: String(row.product_id),
    name: row.product_name,
    variantId: row.variant_id ? String(row.variant_id) : null,
    variantName: row.variant_name || null,
    variantLabel: variantLabel(row.variant_name),
  };
}
```

- [ ] **Step 2: Add stock detail helper**

Add this helper below `getProductDetail`:

```js
function getOrderStockItems(order, accounts = []) {
  const snapshotValues = Array.isArray(accounts) ? accounts : [];
  const rows = snapshotValues.length > 0
    ? db.prepare(`
        SELECT
          s.id,
          s.data,
          s.variant_id,
          v.name AS variant_name,
          s.sold_at,
          s.duration_days,
          CASE
            WHEN s.sold_at IS NOT NULL AND s.duration_days IS NOT NULL
            THEN DATE(s.sold_at, '+' || s.duration_days || ' days')
            ELSE NULL
          END AS expires_at
        FROM stock s
        LEFT JOIN product_variants v ON v.id = s.variant_id
        WHERE s.sold_to = ?
          AND s.product_id = ?
          AND s.data IN (${snapshotValues.map(() => '?').join(',')})
        ORDER BY s.sold_at DESC, s.id DESC
      `).all(order.user_id, order.product_id, ...snapshotValues)
    : db.prepare(`
        SELECT
          s.id,
          s.data,
          s.variant_id,
          v.name AS variant_name,
          s.sold_at,
          s.duration_days,
          CASE
            WHEN s.sold_at IS NOT NULL AND s.duration_days IS NOT NULL
            THEN DATE(s.sold_at, '+' || s.duration_days || ' days')
            ELSE NULL
          END AS expires_at
        FROM stock s
        LEFT JOIN product_variants v ON v.id = s.variant_id
        WHERE s.sold_to = ?
          AND s.product_id = ?
          AND s.is_sold = 1
          AND (
            (? IS NULL AND s.variant_id IS NULL)
            OR s.variant_id = ?
          )
        ORDER BY s.sold_at DESC, s.id DESC
        LIMIT ?
      `).all(order.user_id, order.product_id, order.variant_id ?? null, order.variant_id ?? null, order.quantity || 50);

  const today = db.prepare("SELECT DATE('now') AS d").get().d;
  return rows.map(row => ({
    id: String(row.id),
    value: row.data,
    variantId: row.variant_id ? String(row.variant_id) : null,
    variantName: row.variant_name || null,
    soldAt: row.sold_at || null,
    durationDays: row.duration_days ?? null,
    expiresAt: row.expires_at || null,
    expired: !!(row.expires_at && row.expires_at < today),
  }));
}
```

- [ ] **Step 3: Add transaction and renewal helper functions**

Add below `getOrderStockItems`:

```js
function getMatchedTransaction(orderId) {
  const hasBankTransactionAt = hasColumn('transactions', 'bank_transaction_at');
  const row = db.prepare(`
    SELECT
      id,
      mb_transaction_number,
      amount,
      description,
      detected_at,
      ${hasBankTransactionAt ? 'bank_transaction_at' : 'NULL'} AS bank_transaction_at
    FROM transactions
    WHERE matched_order_id = ?
    ORDER BY detected_at DESC, id DESC
    LIMIT 1
  `).get(orderId);
  if (!row) return null;
  return {
    id: String(row.id),
    amount: row.amount,
    description: row.description || null,
    transactionDate: row.bank_transaction_at || row.detected_at || null,
    bankReference: row.mb_transaction_number || null,
  };
}

function getRelatedRenewalLogs(order, stockItems) {
  const stockIds = stockItems.map(item => Number(item.id)).filter(Number.isFinite);
  const params = [order.id];
  let stockClause = '';
  if (stockIds.length > 0) {
    stockClause = ` OR stock_id IN (${stockIds.map(() => '?').join(',')})`;
    params.push(...stockIds);
  }
  const rows = db.prepare(`
    SELECT id, stock_id, status, expiry_date, days_before_expiry, message_body, created_at
    FROM renewal_reminder_logs
    WHERE order_id = ?${stockClause}
    ORDER BY created_at DESC, id DESC
  `).all(...params);

  return rows.map(row => ({
    id: String(row.id),
    stockId: row.stock_id ? String(row.stock_id) : null,
    status: row.status,
    expiryDate: row.expiry_date || null,
    daysBeforeExpiry: row.days_before_expiry ?? null,
    messagePreview: row.message_body ? String(row.message_body).slice(0, 180) : '',
    createdAt: row.created_at,
  }));
}
```

- [ ] **Step 4: Enrich `GET /admin/orders/:id` response**

In the existing `router.get('/:id', ...)`, after existing `accounts/inputFields/inputValueText` logic and before `res.json`, add:

```js
  const accounts = shaped.accounts || [];
  const stockItems = getOrderStockItems(order, accounts);
  shaped.customer = getCustomer(order.user_id);
  shaped.product = getProductDetail(order);
  shaped.stockItems = stockItems;
  shaped.matchedTransaction = getMatchedTransaction(order.id);
  shaped.renewalLogs = getRelatedRenewalLogs(order, stockItems);
```

Keep the existing `res.json({ success: true, data: shaped });`.

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```bash
node --test --test-concurrency=1 tests/api/admin-orders-detail-readable.test.js
```

Expected: PASS.

- [ ] **Step 6: Run existing order route test that uses order detail**

Run:

```bash
node --test --test-concurrency=1 tests/api/admin-orders-soft-delete.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1-2 together**

```bash
git add src/api/routes/admin/orders.js tests/api/admin-orders-detail-readable.test.js
git commit -m "feat: enrich admin order detail"
```

---

## Task 3: Readable renewal API tests

**Files:**
- Modify: `tests/api/admin-renewals.test.js`

- [ ] **Step 1: Add variant + stock value assertions to renewal fixture**

Modify `seedRenewalLog()` in `tests/api/admin-renewals.test.js` to create a variant and attach it to both order and stock:

```js
    const variant = db.prepare(`
      INSERT INTO product_variants (product_id, name, price, default_duration_days)
      VALUES (?, ?, 1000, 30)
    `).run(product.lastInsertRowid, `Renewal variant ${suffix}`);
    const order = db.prepare(`
      INSERT INTO orders (user_id, product_id, variant_id, quantity, total_price, payment_code, status, source)
      VALUES (?, ?, ?, 1, 1000, ?, 'delivered', 'telegram')
    `).run(userId, product.lastInsertRowid, variant.lastInsertRowid, `PNS_RENEWAL_ADMIN_${suffix}`);
    const stock = db.prepare(`
      INSERT INTO stock (product_id, variant_id, data, duration_days, is_sold, sold_to, sold_at)
      VALUES (?, ?, ?, 30, 1, ?, datetime('now', '-27 days'))
    `).run(product.lastInsertRowid, variant.lastInsertRowid, `key-${suffix}`, userId);
```

Add `variantId: variant.lastInsertRowid` and `stockValue: key-${suffix}` to the returned seed object. In `cleanup(seed)`, delete the variant before deleting product:

```js
    db.prepare('DELETE FROM product_variants WHERE id = ?').run(seed.variantId);
```

- [ ] **Step 2: Add assertions to existing paginated log test**

In `GET /admin/renewals returns paginated renewal reminder logs`, after current assertions, add:

```js
  assert.strictEqual(res.json.data.items[0].stockValue, seed.stockValue);
  assert.strictEqual(res.json.data.items[0].variantId, String(seed.variantId));
  assert.strictEqual(res.json.data.items[0].variantName, `Renewal variant ${seed.suffix}`);
  assert.strictEqual(res.json.data.items[0].variantLabel, `Renewal variant ${seed.suffix}`);
  assert.strictEqual(res.json.data.items[0].userName, `Renewal Admin ${seed.suffix}`);
```

- [ ] **Step 3: Add legacy no-order readable test**

Append:

```js
test('GET /admin/renewals returns readable stock value for legacy logs without order id', async (t) => {
  const seed = seedRenewalLog();
  t.after(() => cleanup(seed));
  db.prepare('UPDATE renewal_reminder_logs SET order_id = NULL WHERE id = ?').run(seed.logId);

  const res = await requestJson(makeApp(), 'GET', `/admin/renewals?q=${encodeURIComponent(seed.productName)}`);

  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.success, true);
  assert.strictEqual(res.json.data.total, 1);
  assert.strictEqual(res.json.data.items[0].orderId, null);
  assert.strictEqual(res.json.data.items[0].stockId, String(seed.stockId));
  assert.strictEqual(res.json.data.items[0].stockValue, seed.stockValue);
  assert.strictEqual(res.json.data.items[0].variantLabel, `Renewal variant ${seed.suffix}`);
});
```

- [ ] **Step 4: Run tests to verify RED**

Run:

```bash
node --test --test-concurrency=1 tests/api/admin-renewals.test.js
```

Expected: FAIL because `stockValue`, `variantId`, `variantName`, `variantLabel`, and `userName` are not returned yet.

---

## Task 4: Readable renewal API implementation

**Files:**
- Modify: `src/api/routes/admin/renewals.js`
- Modify: `tests/api/admin-renewals.test.js`

- [ ] **Step 1: Update renewal row `shape`**

Modify `shape(row)` in `src/api/routes/admin/renewals.js`:

```js
function variantLabel(name) {
  return name || 'mặc định/legacy';
}

function shape(row) {
  return {
    id: String(row.id),
    stockId: row.stock_id ? String(row.stock_id) : null,
    stockValue: row.stock_value || null,
    orderId: row.order_id ? String(row.order_id) : null,
    userId: String(row.user_id),
    userName: row.user_name || null,
    username: row.username || null,
    productId: String(row.product_id),
    productName: row.product_name,
    variantId: row.variant_id ? String(row.variant_id) : null,
    variantName: row.variant_name || null,
    variantLabel: variantLabel(row.variant_name),
    expiryDate: row.expiry_date,
    daysBeforeExpiry: row.days_before_expiry,
    telegramSent: !!row.telegram_sent,
    webNotificationId: row.web_notification_id ? String(row.web_notification_id) : null,
    status: row.status,
    errorMessage: row.error_message || null,
    messageBody: row.message_body || '',
    createdAt: row.created_at,
  };
}
```

- [ ] **Step 2: Update renewal list SQL**

Replace the `SELECT * FROM renewal_reminder_logs` list query with:

```js
  const rows = db.prepare(`
    SELECT
      l.*,
      s.data AS stock_value,
      s.variant_id AS variant_id,
      v.name AS variant_name,
      u.full_name AS user_name,
      u.username AS username
    FROM renewal_reminder_logs l
    LEFT JOIN stock s ON s.id = l.stock_id
    LEFT JOIN product_variants v ON v.id = s.variant_id
    LEFT JOIN users u ON u.telegram_id = l.user_id
    WHERE ${where}
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
```

Replace unqualified filter columns with `l.` aliases:

```js
where += ' AND l.status = ?';
```

and:

```js
where += ` AND (
  l.product_name LIKE ?
  OR CAST(l.order_id AS TEXT) LIKE ?
  OR CAST(l.user_id AS TEXT) LIKE ?
  OR l.message_body LIKE ?
  OR s.data LIKE ?
  OR v.name LIKE ?
  OR u.full_name LIKE ?
  OR u.username LIKE ?
)`;
params.push(like, like, like, like, like, like, like, like);
```

Update total query to include the same joins:

```js
  const total = db.prepare(`
    SELECT COUNT(*) AS c
    FROM renewal_reminder_logs l
    LEFT JOIN stock s ON s.id = l.stock_id
    LEFT JOIN product_variants v ON v.id = s.variant_id
    LEFT JOIN users u ON u.telegram_id = l.user_id
    WHERE ${where}
  `).get(...params).c;
```

- [ ] **Step 3: Run tests to verify GREEN**

Run:

```bash
node --test --test-concurrency=1 tests/api/admin-renewals.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit Task 3-4 together**

```bash
git add src/api/routes/admin/renewals.js tests/api/admin-renewals.test.js
git commit -m "feat: enrich admin renewal rows"
```

---

## Task 5: Admin orders detail drawer UI

**Files:**
- Modify: `web/src/app/(admin)/admin/orders/page.tsx`

- [ ] **Step 1: Read Next local guidance before editing**

Run:

```bash
sed -n '1,220p' web/AGENTS.md
sed -n '1,220p' web/node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
```

Expected: confirms this is a client component and imports remain client-safe.

- [ ] **Step 2: Update TypeScript interfaces**

In `web/src/app/(admin)/admin/orders/page.tsx`, extend `OrderDetail`:

```ts
interface OrderDetail extends Order {
  accounts?: string[]
  inputFields?: Record<string, string>
  inputValueText?: string
  customer?: { telegramId: string; fullName: string | null; username: string | null }
  product?: { id: string; name: string; variantId: string | null; variantName: string | null; variantLabel: string }
  stockItems?: Array<{
    id: string
    value: string
    variantId: string | null
    variantName: string | null
    soldAt: string | null
    durationDays: number | null
    expiresAt: string | null
    expired: boolean
  }>
  matchedTransaction?: {
    id: string
    amount: number
    description: string | null
    transactionDate: string | null
    bankReference: string | null
  } | null
  renewalLogs?: Array<{
    id: string
    stockId: string | null
    status: string
    expiryDate: string | null
    daysBeforeExpiry: number | null
    messagePreview: string
    createdAt: string
  }>
}
```

- [ ] **Step 3: Add drawer state and query param auto-open**

Add state near existing modal state:

```ts
const [detailOrderId, setDetailOrderId] = useState<string | null>(null)
const [showSensitive, setShowSensitive] = useState(false)
```

Import `useSearchParams` from `next/navigation` and add:

```ts
const searchParams = useSearchParams()

useEffect(() => {
  const highlighted = searchParams.get('highlight')
  const openDetail = searchParams.get('detail') === '1'
  if (highlighted && openDetail) {
    setDetailOrderId(highlighted)
    setShowSensitive(false)
  }
}, [searchParams])
```

- [ ] **Step 4: Add detail query**

Add:

```ts
const { data: detailData, isLoading: detailLoading } = useQuery({
  queryKey: ['admin', 'order', detailOrderId, 'drawer'],
  queryFn: () => api.get<OrderDetail>(`/admin/orders/${detailOrderId}`),
  enabled: !!detailOrderId,
})
```

- [ ] **Step 5: Add copy and sensitive display helpers**

Add above `columns`:

```ts
function copyText(value: string) {
  navigator.clipboard.writeText(value)
}

function SensitiveValue({ value, revealed }: { value: string; revealed: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <code className="font-mono text-xs bg-clay-oat-light px-2 py-0.5 rounded">
        {revealed ? value : '••••••••••••'}
      </code>
      <button type="button" onClick={() => copyText(value)} className="clay-btn text-xs py-0.5 px-2">
        Copy
      </button>
    </span>
  )
}
```

- [ ] **Step 6: Add `Chi tiết` button to row actions**

In `rowActions(order)`, create:

```tsx
const detailButton = (
  <button
    type="button"
    onClick={() => {
      setDetailOrderId(order.id)
      setShowSensitive(false)
    }}
    className="clay-btn text-xs py-1 px-2"
  >
    Chi tiết
  </button>
)
```

Render `{detailButton}` before status-specific buttons in every branch, including deleted branch if present in current working tree.

- [ ] **Step 7: Add drawer JSX near existing modals**

Add before manual delivery modal:

```tsx
{detailOrderId && (
  <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={() => setDetailOrderId(null)}>
    <aside
      className="bg-white w-full sm:max-w-2xl h-full overflow-y-auto p-4 sm:p-6 space-y-5"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="clay-display text-2xl">Đơn #{detailOrderId}</h2>
          {detailData?.data && <StatusPill status={detailData.data.status} />}
        </div>
        <button onClick={() => setDetailOrderId(null)} className="clay-btn p-2">×</button>
      </div>

      {detailLoading || !detailData ? (
        <p className="text-clay-charcoal">Đang tải chi tiết...</p>
      ) : (
        <div className="space-y-4">
          <section className="clay-card p-4 text-sm space-y-1">
            <h3 className="font-semibold">Tổng quan</h3>
            <div>Trạng thái: <StatusPill status={detailData.data.status} /></div>
            <div>Tạo: {formatDate(detailData.data.createdAt)}</div>
            <div>Đã trả: {detailData.data.paidAt ? formatDate(detailData.data.paidAt) : '—'}</div>
            <div>Đã giao: {detailData.data.deliveredAt ? formatDate(detailData.data.deliveredAt) : '—'}</div>
            <div>Số lượng: {detailData.data.quantity}</div>
            <div>Tổng tiền: {formatPrice(detailData.data.totalPrice)}</div>
          </section>

          <section className="clay-card p-4 text-sm space-y-1">
            <h3 className="font-semibold">Khách hàng</h3>
            <div>{detailData.data.customer?.fullName || detailData.data.userName || '—'}</div>
            <div>{detailData.data.customer?.username ? `@${detailData.data.customer.username}` : 'Không có username'}</div>
            <div className="font-mono text-xs">ID {detailData.data.customer?.telegramId || detailData.data.userId}</div>
            <a
              href={buildTelegramContactUrl({ username: detailData.data.customer?.username, telegramId: detailData.data.customer?.telegramId || detailData.data.userId })}
              target="_blank"
              rel="noreferrer"
              title={telegramContactTitle({ username: detailData.data.customer?.username, telegramId: detailData.data.customer?.telegramId || detailData.data.userId })}
              className="clay-btn text-xs py-1 px-2 inline-flex mt-2"
            >
              Nhắn tin
            </a>
          </section>

          <section className="clay-card p-4 text-sm space-y-1">
            <h3 className="font-semibold">Thanh toán</h3>
            <div>Mã CK: <code>{detailData.data.paymentCode || '—'}</code></div>
            <div>Giao dịch: {detailData.data.matchedTransaction?.bankReference || 'Chưa có giao dịch match'}</div>
            <div>Số tiền match: {detailData.data.matchedTransaction ? formatPrice(detailData.data.matchedTransaction.amount) : '—'}</div>
          </section>

          <section className="clay-card p-4 text-sm space-y-1">
            <h3 className="font-semibold">Sản phẩm</h3>
            <div>{detailData.data.product?.name || detailData.data.productName}</div>
            <div>Biến thể: {detailData.data.product?.variantLabel || 'mặc định/legacy'}</div>
          </section>

          <section className="clay-card p-4 text-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Dữ liệu nhạy cảm</h3>
              <button type="button" onClick={() => setShowSensitive(v => !v)} className="clay-btn text-xs py-1 px-2">
                {showSensitive ? 'Ẩn tất cả' : 'Hiện tất cả'}
              </button>
            </div>
            {(detailData.data.stockItems || []).map(item => (
              <div key={item.id} className="rounded-lg border border-clay-oat-light p-2 space-y-1">
                <div className="text-xs text-clay-silver">Stock #{item.id} · {item.variantName || 'mặc định/legacy'}</div>
                <SensitiveValue value={item.value} revealed={showSensitive} />
                <div className="text-xs text-clay-charcoal">Hết hạn: {item.expiresAt || '—'}{item.expired ? ' · đã hết hạn' : ''}</div>
              </div>
            ))}
            {detailData.data.inputFields && <CustomerInputBlock inputFields={detailData.data.inputFields} />}
            {detailData.data.inputValueText && <SensitiveValue value={detailData.data.inputValueText} revealed={showSensitive} />}
          </section>

          <section className="clay-card p-4 text-sm space-y-2">
            <h3 className="font-semibold">Gia hạn liên quan</h3>
            {(detailData.data.renewalLogs || []).length === 0 ? (
              <p className="text-clay-silver">Chưa có log gia hạn.</p>
            ) : detailData.data.renewalLogs?.map(log => (
              <Link
                key={log.id}
                href={`/admin/renewals?highlight=${log.id}`}
                className="block rounded-lg border border-clay-oat-light p-2 hover:bg-clay-oat-light/50"
              >
                <div className="font-medium">#{log.id} · {log.status}</div>
                <div className="text-xs text-clay-charcoal">{formatDate(log.createdAt)} · Hết hạn {log.expiryDate || '—'}</div>
                {log.messagePreview && <div className="text-xs text-clay-silver truncate">{log.messagePreview}</div>}
              </Link>
            ))}
          </section>
        </div>
      )}
    </aside>
  </div>
)}
```

- [ ] **Step 8: Run targeted lint**

Run:

```bash
cd web && npx eslint 'src/app/(admin)/admin/orders/page.tsx'
```

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

```bash
git add web/src/app/\(admin\)/admin/orders/page.tsx
git commit -m "feat: add admin order detail drawer"
```

---

## Task 6: Admin renewals readable UI

**Files:**
- Modify: `web/src/app/(admin)/admin/renewals/page.tsx`

- [ ] **Step 1: Update RenewalLog interface**

In `web/src/app/(admin)/admin/renewals/page.tsx`, extend `RenewalLog`:

```ts
interface RenewalLog {
  id: string
  stockId: string | null
  stockValue?: string | null
  orderId: string | null
  userId: string
  userName?: string | null
  username?: string | null
  productId: string
  productName: string
  variantId?: string | null
  variantName?: string | null
  variantLabel?: string
  expiryDate: string | null
  daysBeforeExpiry: number | null
  telegramSent: boolean
  webNotificationId: string | null
  status: RenewalStatus
  errorMessage: string | null
  messageBody: string
  createdAt: string
}
```

- [ ] **Step 2: Add highlight and reveal state**

Import `useSearchParams` from `next/navigation` and add:

```ts
const searchParams = useSearchParams()
const highlightId = searchParams.get('highlight')
const [revealedStockIds, setRevealedStockIds] = useState<Set<string>>(new Set())

function toggleStockValue(id: string) {
  setRevealedStockIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
}

function copyText(value: string) {
  navigator.clipboard.writeText(value)
}
```

- [ ] **Step 3: Update order link in `Đơn` column**

Replace existing order link href:

```tsx
<Link href={`/admin/orders?highlight=${r.orderId}&detail=1`} className="font-mono text-sm underline underline-offset-2">
  #{r.orderId}
</Link>
```

Keep the `—` fallback when `orderId` is null.

- [ ] **Step 4: Replace product cell with readable variant/stock/value UI**

Replace the product cell body with:

```tsx
cell: (r) => {
  const stockKey = r.stockId || r.id
  const revealed = revealedStockIds.has(stockKey)
  return (
    <div className="space-y-1">
      <div className="font-medium">{r.productName}</div>
      <div className="text-xs text-clay-charcoal">
        Biến thể: {r.variantLabel || r.variantName || 'mặc định/legacy'}
      </div>
      <div className="text-xs text-clay-silver">
        {r.stockId ? `Stock #${r.stockId}` : 'Stock —'}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <code className="font-mono bg-clay-oat-light px-2 py-0.5 rounded">
          {r.stockValue ? (revealed ? r.stockValue : '••••••••••••') : '—'}
        </code>
        {r.stockValue && (
          <>
            <button type="button" onClick={() => toggleStockValue(stockKey)} className="clay-btn text-xs py-0.5 px-2">
              {revealed ? 'Ẩn value' : 'Hiện value'}
            </button>
            <button type="button" onClick={() => copyText(r.stockValue || '')} className="clay-btn text-xs py-0.5 px-2">
              Copy
            </button>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Add row highlight styling**

If `ResponsiveTable` cannot style rows directly, add a visible marker in the first column:

```tsx
{header: '#', cell: (r) => (
  <span className={`font-mono text-xs ${highlightId === r.id ? 'text-amber-700 font-bold' : ''}`}>
    #{r.id}{highlightId === r.id ? ' · đang chọn' : ''}
  </span>
)}
```

- [ ] **Step 6: Run targeted lint**

Run:

```bash
cd web && npx eslint 'src/app/(admin)/admin/renewals/page.tsx'
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add web/src/app/\(admin\)/admin/renewals/page.tsx
git commit -m "feat: improve admin renewal readability"
```

---

## Task 7: Cross-link verification and integration tests

**Files:**
- Test: `tests/api/admin-orders-detail-readable.test.js`
- Test: `tests/api/admin-renewals.test.js`
- Modify only if failures expose a real integration gap.

- [ ] **Step 1: Run backend integration tests together**

Run:

```bash
node --test --test-concurrency=1 tests/api/admin-orders-detail-readable.test.js tests/api/admin-renewals.test.js tests/api/admin-orders-soft-delete.test.js
```

Expected: PASS.

- [ ] **Step 2: Run frontend targeted lint together**

Run:

```bash
cd web && npx eslint 'src/app/(admin)/admin/orders/page.tsx' 'src/app/(admin)/admin/renewals/page.tsx'
```

Expected: PASS.

- [ ] **Step 3: Verify no temporary visual files are staged**

Run:

```bash
git diff --cached --name-only
git status --short .superpowers data
```

Expected:

- cached files are only intended source/test files;
- `.superpowers/` may be untracked but must not be staged;
- `data/shop.db` and DB backups must not be staged.

- [ ] **Step 4: Commit integration fix only if Step 1 or Step 2 required a code fix**

If a code fix was required in this task, stage only the file that was fixed from this exact list:

- `src/api/routes/admin/orders.js`
- `src/api/routes/admin/renewals.js`
- `tests/api/admin-orders-detail-readable.test.js`
- `tests/api/admin-renewals.test.js`
- `web/src/app/(admin)/admin/orders/page.tsx`
- `web/src/app/(admin)/admin/renewals/page.tsx`

Then commit:

```bash
git commit -m "fix: stabilize admin order renewal links"
```

If no code fix was required, skip this commit step.

---

## Task 8: Final verification and data hygiene

**Files:**
- No source edits expected.

- [ ] **Step 1: Run syntax checks**

Run:

```bash
node --check src/api/routes/admin/orders.js
node --check src/api/routes/admin/renewals.js
```

Expected: both exit 0.

- [ ] **Step 2: Run backend tests**

Run:

```bash
node --test --test-concurrency=1 tests/api/admin-orders-detail-readable.test.js tests/api/admin-renewals.test.js tests/api/admin-orders-soft-delete.test.js
```

Expected: PASS.

- [ ] **Step 3: Run targeted frontend lint**

Run:

```bash
cd web && npx eslint 'src/app/(admin)/admin/orders/page.tsx' 'src/app/(admin)/admin/renewals/page.tsx'
```

Expected: PASS.

- [ ] **Step 4: Run broad lint for awareness**

Run:

```bash
cd web && npm run lint
```

Expected: PASS if unrelated existing lint errors have been fixed. If it fails only in files outside this plan, record exact filenames and continue with targeted lint evidence.

- [ ] **Step 5: Purge test data dry-run**

Run:

```bash
node scripts/purge-test-data.js
```

Expected: counts are either all 0 or show test fixtures matching the purge script.

- [ ] **Step 6: Purge test data apply**

Run:

```bash
node scripts/purge-test-data.js --apply
```

Expected: backup is created, and after counts are 0.

- [ ] **Step 7: Verify purge remains clean**

Run:

```bash
node scripts/purge-test-data.js
```

Expected: all target counts are 0.

- [ ] **Step 8: Verify git hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected:

- `git diff --check` exits 0;
- source/test/docs changes are committed;
- `data/shop.db`, DB backups, `.superpowers/`, uploads, logs, and temp files are not staged.

---

## Review checklist for implementer

- `Chi tiết` opens a right drawer, not a modal or new page.
- Sensitive values are hidden by default.
- `Hiện tất cả` reveals stock values and customer input in the drawer.
- Renewal rows show product name, variant label, stock id, and hidden stock value.
- Renewal order links use `/admin/orders?highlight=<orderId>&detail=1`.
- Order drawer renewal links use `/admin/renewals?highlight=<logId>`.
- Existing order actions still render and work.
- Backend keeps `accounts`, `inputFields`, and `inputValueText` for backward compatibility.
