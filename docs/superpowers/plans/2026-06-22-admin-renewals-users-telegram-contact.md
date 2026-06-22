# Admin Renewals Users Telegram Contact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make renewal reminder logs reliable, make `/admin/users` show complete paginated user/buyer data, and add Telegram direct-contact buttons to admin orders/users.

**Architecture:** Keep renewal reminder ownership in `keyExpiryReminderService`, but extract log/backfill helpers into a focused service so sweep, manual API, and script share the same rules. Keep admin users/orders APIs as Express routes backed by SQLite queries; frontend changes stay inside existing Next admin pages with one small Telegram-link helper.

**Tech Stack:** Node.js 22, Express, better-sqlite3, Node built-in test runner, Next 16 App Router, React 19, TanStack Query.

---

## File map

- Create: `src/services/renewalReminderLogService.js` — failed-count, exhausted detection, sent_legacy backfill helper, and shared log insert helpers.
- Modify: `src/services/keyExpiryReminderService.js` — use shared log helper, retry failed attempts up to 3, return richer sweep summary.
- Create: `scripts/backfill-renewal-logs.js` — dry-run/apply script with DB backup and transaction.
- Modify: `src/api/routes/admin/renewals.js` — add statuses and `POST /sweep`.
- Modify: `web/src/app/(admin)/admin/renewals/page.tsx` — fix markup, render new statuses, add manual sweep button/summary.
- Modify: `src/api/routes/admin/users.js` — return `{ users, stats } + meta`, include virtual users, virtual detail read-only path.
- Modify: `web/src/app/(admin)/admin/users/page.tsx` — pagination, stats, warning, virtual badge, contact button.
- Modify: `src/api/routes/admin/orders.js` — ensure order shape exposes `username` and `userId` consistently.
- Modify: `web/src/app/(admin)/admin/orders/page.tsx` — contact button in “Thao tác”.
- Create: `web/src/lib/telegramContact.ts` — frontend helper to build `https://t.me/...` or `tg://user?id=...`.
- Test: `tests/services/keyExpiryReminderService.test.js`
- Test: `tests/services/renewalReminderLogService.test.js`
- Test: `tests/scripts/backfillRenewalLogs.test.js`
- Test: `tests/api/admin-renewals.test.js`
- Test: `tests/api/admin-users.test.js`
- Optional frontend check: `cd web && npm run lint`

Do not stage or commit `data/shop.db`, DB backups, `.superpowers/`, or unrelated dirty files.

---

## Task 1: Renewal log helper service

**Files:**
- Create: `src/services/renewalReminderLogService.js`
- Test: `tests/services/renewalReminderLogService.test.js`

- [ ] **Step 1: Write failing helper tests**

Create `tests/services/renewalReminderLogService.test.js` with tests for failed counts, exhausted detection, and backfill candidate selection.

```js
const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

function freshService() {
  delete require.cache[require.resolve('../../src/services/renewalReminderLogService')];
  return require('../../src/services/renewalReminderLogService');
}

function seedLogFixture(status = 'failed') {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 898_000_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(userId, `Renewal helper ${suffix}`);
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(`helper-cat-${suffix}`, `helper-cat-${suffix}`);
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(category.lastInsertRowid, `Helper product ${suffix}`, `helper-product-${suffix}`);
  const stock = db.prepare(`
    INSERT INTO stock (product_id, data, duration_days, is_sold, sold_to, sold_at, reminder_sent_at)
    VALUES (?, ?, 30, 1, ?, datetime('now', '-27 days'), '2026-06-20 02:00:00')
  `).run(product.lastInsertRowid, `key-${suffix}`, userId);
  const log = db.prepare(`
    INSERT INTO renewal_reminder_logs
      (stock_id, user_id, product_id, product_name, status, telegram_sent)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(stock.lastInsertRowid, userId, product.lastInsertRowid, `Helper product ${suffix}`, status);

  return { userId, categoryId: category.lastInsertRowid, productId: product.lastInsertRowid, stockId: stock.lastInsertRowid, logId: log.lastInsertRowid };
}

function cleanupFixture(seed) {
  db.prepare('DELETE FROM renewal_reminder_logs WHERE stock_id = ?').run(seed.stockId);
  db.prepare('DELETE FROM stock WHERE id = ?').run(seed.stockId);
  db.prepare('DELETE FROM products WHERE id = ?').run(seed.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(seed.categoryId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(seed.userId);
}

test('counts failed renewal attempts by stock id', (t) => {
  const { countFailedAttempts } = freshService();
  const first = seedLogFixture('failed');
  const second = seedLogFixture('failed');
  const sent = seedLogFixture('sent');
  t.after(() => [first, second, sent].forEach(cleanupFixture));

  db.prepare('UPDATE renewal_reminder_logs SET stock_id = ? WHERE id = ?').run(first.stockId, second.logId);
  db.prepare('UPDATE renewal_reminder_logs SET stock_id = ? WHERE id = ?').run(first.stockId, sent.logId);

  assert.strictEqual(countFailedAttempts(first.stockId), 2);
});

test('detects exhausted renewal reminder stocks', (t) => {
  const { hasExhausted } = freshService();
  const seed = seedLogFixture('exhausted');
  t.after(() => cleanupFixture(seed));

  assert.strictEqual(hasExhausted(seed.stockId), true);
});

test('finds reminder-sent stock rows missing audit logs', (t) => {
  const { findMissingLegacyLogs } = freshService();
  const seed = seedLogFixture('sent');
  t.after(() => cleanupFixture(seed));
  db.prepare('DELETE FROM renewal_reminder_logs WHERE stock_id = ?').run(seed.stockId);

  const rows = findMissingLegacyLogs({ limit: 1000 });
  const row = rows.find(item => item.stock_id === seed.stockId);

  assert.ok(row);
  assert.strictEqual(row.reminder_sent_at, '2026-06-20 02:00:00');
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
node --test tests/services/renewalReminderLogService.test.js
```

Expected: FAIL because `src/services/renewalReminderLogService.js` does not exist.

- [ ] **Step 3: Implement helper service**

Create `src/services/renewalReminderLogService.js`:

```js
const db = require('../database');

const MAX_FAILED_ATTEMPTS = 3;

function countFailedAttempts(stockId) {
  return db.prepare(`
    SELECT COUNT(*) AS c
    FROM renewal_reminder_logs
    WHERE stock_id = ? AND status = 'failed'
  `).get(stockId).c;
}

function hasExhausted(stockId) {
  return !!db.prepare(`
    SELECT 1
    FROM renewal_reminder_logs
    WHERE stock_id = ? AND status = 'exhausted'
    LIMIT 1
  `).get(stockId);
}

function insertLog({
  stockId,
  orderId = null,
  userId,
  productId,
  productName,
  expiryDate = null,
  daysBeforeExpiry = null,
  telegramSent = 0,
  webNotificationId = null,
  status,
  errorMessage = null,
  messageBody = null,
  createdAt = null,
}) {
  const sql = createdAt
    ? `INSERT INTO renewal_reminder_logs (
         stock_id, order_id, user_id, product_id, product_name, expiry_date,
         days_before_expiry, telegram_sent, web_notification_id, status,
         error_message, message_body, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    : `INSERT INTO renewal_reminder_logs (
         stock_id, order_id, user_id, product_id, product_name, expiry_date,
         days_before_expiry, telegram_sent, web_notification_id, status,
         error_message, message_body
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const args = [
    stockId, orderId, userId, productId, productName, expiryDate,
    daysBeforeExpiry, telegramSent ? 1 : 0, webNotificationId,
    status, errorMessage, messageBody,
  ];
  if (createdAt) args.push(createdAt);
  return db.prepare(sql).run(...args);
}

function findMissingLegacyLogs({ limit = 500 } = {}) {
  return db.prepare(`
    SELECT
      s.id AS stock_id,
      s.sold_to AS user_id,
      s.product_id,
      p.name AS product_name,
      s.sold_at,
      s.duration_days,
      s.reminder_sent_at
    FROM stock s
    JOIN products p ON p.id = s.product_id
    JOIN users u ON u.telegram_id = s.sold_to
    LEFT JOIN renewal_reminder_logs l ON l.stock_id = s.id
    WHERE s.reminder_sent_at IS NOT NULL
      AND l.id IS NULL
    ORDER BY s.reminder_sent_at ASC, s.id ASC
    LIMIT ?
  `).all(limit);
}

module.exports = {
  MAX_FAILED_ATTEMPTS,
  countFailedAttempts,
  hasExhausted,
  insertLog,
  findMissingLegacyLogs,
};
```

- [ ] **Step 4: Run helper tests and confirm GREEN**

Run:

```bash
node --test tests/services/renewalReminderLogService.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/services/renewalReminderLogService.js tests/services/renewalReminderLogService.test.js
git commit -m "feat: add renewal reminder log helpers"
```

---

## Task 2: Renewal sweep retry and exhausted behavior

**Files:**
- Modify: `src/services/keyExpiryReminderService.js`
- Modify: `tests/services/keyExpiryReminderService.test.js`

- [ ] **Step 1: Write failing tests for failed retry policy**

Append tests to `tests/services/keyExpiryReminderService.test.js`:

```js
test('sweep logs failed Telegram attempts without setting reminder_sent_at', async (t) => {
  const seed = seedDueReminder();
  t.after(() => cleanup(seed));
  const service = freshService();
  service.init({
    telegram: {
      async sendMessage() {
        throw new Error('telegram down');
      },
    },
  });

  const result = await service.sweep();

  assert.strictEqual(result.failed, 1);
  const log = db.prepare('SELECT * FROM renewal_reminder_logs WHERE stock_id = ? ORDER BY id DESC LIMIT 1').get(seed.stockId);
  assert.strictEqual(log.status, 'failed');
  assert.match(log.error_message, /telegram down/);
  const stock = db.prepare('SELECT reminder_sent_at FROM stock WHERE id = ?').get(seed.stockId);
  assert.strictEqual(stock.reminder_sent_at, null);
});

test('sweep marks stock exhausted after three failed attempts and skips later auto runs', async (t) => {
  const seed = seedDueReminder();
  t.after(() => cleanup(seed));
  const service = freshService();
  service.init({
    telegram: {
      async sendMessage() {
        throw new Error('telegram down');
      },
    },
  });

  await service.sweep();
  await service.sweep();
  await service.sweep();
  const third = await service.sweep();

  const statuses = db.prepare('SELECT status FROM renewal_reminder_logs WHERE stock_id = ? ORDER BY id').all(seed.stockId).map(r => r.status);
  assert.deepStrictEqual(statuses, ['failed', 'failed', 'failed', 'exhausted']);
  assert.strictEqual(third.exhausted, 1);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
node --test tests/services/keyExpiryReminderService.test.js
```

Expected: FAIL because current `sweep()` returns only `sent/scanned`, has no failed/exhausted policy.

- [ ] **Step 3: Update `keyExpiryReminderService.sweep()`**

Modify `src/services/keyExpiryReminderService.js`:

- Import helper:

```js
const renewalLogService = require('./renewalReminderLogService');
```

- Add `AND NOT EXISTS` exhausted guard to stock query:

```sql
AND NOT EXISTS (
  SELECT 1 FROM renewal_reminder_logs l
  WHERE l.stock_id = s.id AND l.status = 'exhausted'
)
```

- Track summary:

```js
const summary = { scanned: rows.length, sent: 0, skipped: 0, failed: 0, exhausted: 0 };
```

- Before sending each row, if failed count is already at the max, insert exhausted once and continue:

```js
if (renewalLogService.countFailedAttempts(r.id) >= renewalLogService.MAX_FAILED_ATTEMPTS) {
  if (!renewalLogService.hasExhausted(r.id)) {
    renewalLogService.insertLog({
      stockId: r.id,
      orderId: null,
      userId: r.sold_to,
      productId: r.product_id,
      productName: r.product_name,
      status: 'exhausted',
      telegramSent: 0,
      errorMessage: 'Reached 3 failed reminder attempts',
    });
  }
  summary.exhausted++;
  continue;
}
```

- Replace direct `insertLog.run(...)` calls with `renewalLogService.insertLog(...)`.
- On success increment `summary.sent`.
- On template disabled increment `summary.skipped`.
- In catch:

```js
renewalLogService.insertLog({
  stockId: r.id,
  orderId: order?.id ?? null,
  userId: r.sold_to,
  productId: r.product_id,
  productName: r.product_name,
  expiryDate: lifecycle?.expiryDate ?? null,
  daysBeforeExpiry: lifecycle?.remainingDays ?? null,
  telegramSent: 0,
  status: 'failed',
  errorMessage: err.message,
  messageBody: body,
});
summary.failed++;
```

- Return `summary`.

- [ ] **Step 4: Run service tests and confirm GREEN**

Run:

```bash
node --test tests/services/keyExpiryReminderService.test.js tests/services/renewalReminderLogService.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/services/keyExpiryReminderService.js tests/services/keyExpiryReminderService.test.js
git commit -m "fix: retry failed renewal reminders safely"
```

---

## Task 3: Renewal log backfill script

**Files:**
- Modify: `src/services/renewalReminderLogService.js`
- Create: `scripts/backfill-renewal-logs.js`
- Create: `tests/scripts/backfillRenewalLogs.test.js`

- [ ] **Step 1: Write failing backfill tests**

Create `tests/scripts/backfillRenewalLogs.test.js` using real DB fixtures:

```js
const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const renewalLogService = require('../../src/services/renewalReminderLogService');

test('backfill creates sent_legacy logs with created_at from reminder_sent_at and is idempotent', () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 897_000_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(userId, `Backfill ${suffix}`);
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(`backfill-cat-${suffix}`, `backfill-cat-${suffix}`);
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(category.lastInsertRowid, `Backfill product ${suffix}`, `backfill-product-${suffix}`);
  const stock = db.prepare(`
    INSERT INTO stock (product_id, data, duration_days, is_sold, sold_to, sold_at, reminder_sent_at)
    VALUES (?, ?, 30, 1, ?, datetime('now', '-27 days'), '2026-06-20 02:00:00')
  `).run(product.lastInsertRowid, `key-${suffix}`, userId);

  const first = renewalLogService.backfillMissingLegacyLogs({ apply: true });
  const second = renewalLogService.backfillMissingLegacyLogs({ apply: true });

  const log = db.prepare('SELECT * FROM renewal_reminder_logs WHERE stock_id = ?').get(stock.lastInsertRowid);
  assert.strictEqual(first.created > 0, true);
  assert.strictEqual(second.created, 0);
  assert.strictEqual(log.status, 'sent_legacy');
  assert.strictEqual(log.created_at, '2026-06-20 02:00:00');

  db.prepare('DELETE FROM renewal_reminder_logs WHERE stock_id = ?').run(stock.lastInsertRowid);
  db.prepare('DELETE FROM stock WHERE id = ?').run(stock.lastInsertRowid);
  db.prepare('DELETE FROM products WHERE id = ?').run(product.lastInsertRowid);
  db.prepare('DELETE FROM categories WHERE id = ?').run(category.lastInsertRowid);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(userId);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
node --test tests/scripts/backfillRenewalLogs.test.js
```

Expected: FAIL because `backfillMissingLegacyLogs` and script do not exist.

- [ ] **Step 3: Implement backfill helper**

Add to `src/services/renewalReminderLogService.js`:

```js
function backfillMissingLegacyLogs({ apply = false, limit = 1000 } = {}) {
  const rows = findMissingLegacyLogs({ limit });
  if (!apply) return { scanned: rows.length, created: 0, rows };

  const tx = db.transaction(() => {
    let created = 0;
    for (const row of rows) {
      const exists = db.prepare('SELECT 1 FROM renewal_reminder_logs WHERE stock_id = ? LIMIT 1').get(row.stock_id);
      if (exists) continue;
      const expiry = row.duration_days
        ? db.prepare(`SELECT DATE(?, '+' || ? || ' days') AS d`).get(row.sold_at, row.duration_days).d
        : null;
      insertLog({
        stockId: row.stock_id,
        userId: row.user_id,
        productId: row.product_id,
        productName: row.product_name,
        expiryDate: expiry,
        telegramSent: 1,
        status: 'sent_legacy',
        errorMessage: null,
        messageBody: null,
        createdAt: row.reminder_sent_at,
      });
      created++;
    }
    return created;
  });

  return { scanned: rows.length, created: tx() };
}

module.exports = {
  MAX_FAILED_ATTEMPTS,
  countFailedAttempts,
  hasExhausted,
  insertLog,
  findMissingLegacyLogs,
  backfillMissingLegacyLogs,
};
```

- [ ] **Step 4: Implement dry-run/apply script**

Create `scripts/backfill-renewal-logs.js`:

```js
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const renewalLogService = require('../src/services/renewalReminderLogService');

const APPLY = process.argv.includes('--apply');
const repoRoot = path.join(__dirname, '..');
const dbPath = path.join(repoRoot, 'data', 'shop.db');

function stamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function backup() {
  const backupPath = path.join(repoRoot, 'data', `shop.db.bak-pre-renewal-log-backfill-${stamp()}`);
  fs.copyFileSync(dbPath, backupPath, fs.constants.COPYFILE_EXCL);
  return backupPath;
}

const dry = renewalLogService.backfillMissingLegacyLogs({ apply: false });
console.log(`Missing renewal logs: ${dry.scanned}`);
if (!APPLY) {
  console.log('Dry run only. Re-run with --apply to create a backup and backfill logs.');
  process.exit(0);
}

console.log(`Backup created: ${backup()}`);
const result = renewalLogService.backfillMissingLegacyLogs({ apply: true });
console.log(`Created sent_legacy logs: ${result.created}`);
```

- [ ] **Step 5: Run tests and script dry-run**

Run:

```bash
node --test tests/scripts/backfillRenewalLogs.test.js tests/services/renewalReminderLogService.test.js
node scripts/backfill-renewal-logs.js
```

Expected: tests PASS; script prints dry-run count and does not create backup without `--apply`.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/services/renewalReminderLogService.js scripts/backfill-renewal-logs.js tests/scripts/backfillRenewalLogs.test.js
git commit -m "feat: backfill renewal reminder logs"
```

---

## Task 4: Admin renewals API manual sweep and status support

**Files:**
- Modify: `src/api/routes/admin/renewals.js`
- Modify: `tests/api/admin-renewals.test.js`

- [ ] **Step 1: Write failing API tests**

Extend `tests/api/admin-renewals.test.js`:

```js
test('GET /admin/renewals supports sent_legacy and exhausted status filters', async (t) => {
  const seed = seedRenewalLog();
  t.after(() => cleanup(seed));
  db.prepare("UPDATE renewal_reminder_logs SET status = 'sent_legacy' WHERE id = ?").run(seed.logId);

  const res = await requestJson(makeApp(), 'GET', '/admin/renewals?status=sent_legacy');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.success, true);
  assert.strictEqual(res.json.data.items[0].status, 'sent_legacy');
});

test('POST /admin/renewals/sweep returns BOT_UNAVAILABLE without bot', async () => {
  const res = await requestJson(makeApp(), 'POST', '/admin/renewals/sweep');

  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.json.error.code, 'BOT_UNAVAILABLE');
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
node --test tests/api/admin-renewals.test.js
```

Expected: FAIL because `POST /admin/renewals/sweep` does not exist.

- [ ] **Step 3: Implement route**

Modify `src/api/routes/admin/renewals.js`:

```js
const { requirePermission } = require('../../middleware/auth');
const keyExpiryReminderService = require('../../../services/keyExpiryReminderService');
```

Add status validation near the top:

```js
const VALID_STATUS = new Set(['sent', 'sent_legacy', 'skipped', 'failed', 'exhausted']);
```

For `GET`, only apply status filter when valid:

```js
if (req.query.status && VALID_STATUS.has(String(req.query.status))) {
  where += ' AND status = ?';
  params.push(String(req.query.status));
}
```

Add route:

```js
router.post('/sweep', requirePermission('orders.write'), async (req, res) => {
  const bot = req.app.get('bot');
  if (!bot) {
    return res.status(500).json({
      success: false,
      error: { code: 'BOT_UNAVAILABLE', message: 'Bot chưa sẵn sàng để quét gia hạn.' },
    });
  }
  keyExpiryReminderService.init(bot);
  const summary = await keyExpiryReminderService.sweep();
  res.json({ success: true, data: summary });
});
```

- [ ] **Step 4: Run tests and confirm GREEN**

Run:

```bash
node --test tests/api/admin-renewals.test.js tests/services/keyExpiryReminderService.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/api/routes/admin/renewals.js tests/api/admin-renewals.test.js
git commit -m "feat: add admin renewal sweep endpoint"
```

---

## Task 5: Admin users API pagination, stats, and virtual users

**Files:**
- Modify: `src/api/routes/admin/users.js`
- Create: `tests/api/admin-users.test.js`

- [ ] **Step 1: Write failing users API tests**

Create `tests/api/admin-users.test.js` with request helper equivalent to `tests/api/admin-renewals.test.js`, then add:

```js
test('GET /admin/users returns users with meta and stats', async (t) => {
  const fixture = seedUserWithOrder();
  t.after(() => cleanupUserFixture(fixture));

  const res = await requestJson(makeApp(), 'GET', '/admin/users?page=1&limit=20');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.success, true);
  assert.ok(Array.isArray(res.json.data.users));
  assert.ok(res.json.data.stats.totalUsers >= 1);
  assert.ok(res.json.data.stats.buyers >= 1);
  assert.strictEqual(typeof res.json.meta.totalPages, 'number');
});

test('GET /admin/users includes virtual users for order user ids missing profiles', async (t) => {
  const fixture = seedOrderWithoutUser();
  t.after(() => cleanupOrderOnlyFixture(fixture));

  const res = await requestJson(makeApp(), 'GET', `/admin/users?search=${fixture.userId}`);
  const user = res.json.data.users.find(row => String(row.telegram_id) === String(fixture.userId));

  assert.ok(user);
  assert.strictEqual(user.is_virtual, true);
  assert.strictEqual(user.order_count, 1);
  assert.strictEqual(res.json.data.stats.missingProfiles >= 1, true);
});
```

Seed helpers must insert category/product/order directly. `seedOrderWithoutUser()` must create a legacy orphan-order fixture by disabling `PRAGMA foreign_keys` only around the insert/cleanup, then restore `PRAGMA foreign_keys = ON`. Do not insert into `users` for that fixture.

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
node --test tests/api/admin-users.test.js
```

Expected: FAIL because current `/admin/users` returns array response and no virtual users.

- [ ] **Step 3: Implement list query**

Modify `src/api/routes/admin/users.js`:

- Parse `page`, `limit`, `search`.
- Build real-user rows from `users`.
- Build virtual rows from:

```sql
SELECT
  o.user_id AS telegram_id,
  NULL AS username,
  'ID ' || o.user_id AS full_name,
  0 AS balance,
  MAX(o.created_at) AS created_at,
  COUNT(*) AS order_count,
  1 AS is_virtual
FROM orders o
LEFT JOIN users u ON u.telegram_id = o.user_id
WHERE u.telegram_id IS NULL
GROUP BY o.user_id
```

- Combine with `UNION ALL`, apply search and pagination over combined rows.
- Stats:

```sql
SELECT COUNT(*) AS c FROM users;
SELECT COUNT(DISTINCT user_id) AS c FROM orders;
SELECT COUNT(DISTINCT o.user_id) AS c
FROM orders o LEFT JOIN users u ON u.telegram_id = o.user_id
WHERE u.telegram_id IS NULL;
```

- Response:

```js
res.json({
  success: true,
  data: { users: rows, stats },
  meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
});
```

- [ ] **Step 4: Implement virtual detail path**

Modify `GET /admin/users/:telegramId`:

```js
const user = db.prepare('SELECT *, 0 AS is_virtual FROM users WHERE telegram_id = ?').get(telegramId);
const hasOrders = db.prepare('SELECT 1 FROM orders WHERE user_id = ? LIMIT 1').get(telegramId);
if (!user && !hasOrders) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
const shapedUser = user || {
  telegram_id: telegramId,
  username: null,
  full_name: `ID ${telegramId}`,
  balance: 0,
  created_at: null,
  is_virtual: 1,
};
```

Use `shapedUser` in response. Keep orders and topups queries.

- [ ] **Step 5: Run tests and confirm GREEN**

Run:

```bash
node --test --test-concurrency=1 tests/api/admin-users.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/api/routes/admin/users.js tests/api/admin-users.test.js
git commit -m "feat: paginate admin users with buyer stats"
```

---

## Task 6: Telegram contact helper and admin orders/users UI

**Files:**
- Create: `web/src/lib/telegramContact.ts`
- Modify: `web/src/app/(admin)/admin/orders/page.tsx`
- Modify: `web/src/app/(admin)/admin/users/page.tsx`

- [ ] **Step 1: Create helper**

Create `web/src/lib/telegramContact.ts`:

```ts
export function buildTelegramContactUrl(input: { username?: string | null; telegramId: string | number }) {
  const username = input.username?.trim().replace(/^@+/, '')
  if (username) return `https://t.me/${encodeURIComponent(username)}`
  return `tg://user?id=${encodeURIComponent(String(input.telegramId))}`
}

export function telegramContactTitle(input: { username?: string | null; telegramId: string | number }) {
  const username = input.username?.trim().replace(/^@+/, '')
  if (username) return `Mở Telegram @${username}`
  return `Mở Telegram bằng ID ${input.telegramId} — có thể không hoạt động nếu Telegram không cho`
}
```

- [ ] **Step 2: Add order contact button**

Modify order interface in `web/src/app/(admin)/admin/orders/page.tsx`:

```ts
username?: string
```

Import helper and add a reusable link inside `rowActions(order)` before status-specific buttons:

```tsx
const contactButton = (
  <a
    href={buildTelegramContactUrl({ username: order.username, telegramId: order.userId })}
    target="_blank"
    rel="noreferrer"
    title={telegramContactTitle({ username: order.username, telegramId: order.userId })}
    className="clay-btn text-xs py-1 px-2"
  >
    Nhắn tin
  </a>
)
```

Return `contactButton` in all active/deleted branches where `order.userId` exists.

- [ ] **Step 3: Add users page contact button, stats, and pagination UI**

Modify `web/src/app/(admin)/admin/users/page.tsx`:

- Update response type:

```ts
interface UsersResponse {
  users: UserRow[]
  stats: { totalUsers: number; buyers: number; missingProfiles: number }
}
```

- Add `is_virtual?: boolean` to `UserRow`.
- Add state:

```ts
const [page, setPage] = useState(1)
const [limit, setLimit] = useState(20)
```

- Fetch:

```ts
params.set('page', String(page))
params.set('limit', String(limit))
```

- Use:

```ts
const users = data?.data.users ?? []
const stats = data?.data.stats
const meta = data?.meta
```

- Add a “Thao tác” column with contact button:

```tsx
{
  header: 'Thao tác',
  className: 'text-center',
  cell: (u) => (
    <a
      href={buildTelegramContactUrl({ username: u.username, telegramId: u.telegram_id })}
      target="_blank"
      rel="noreferrer"
      title={telegramContactTitle({ username: u.username, telegramId: u.telegram_id })}
      className="clay-btn text-xs py-1 px-2"
    >
      Nhắn tin
    </a>
  ),
}
```

- Hide wallet adjust when `detailData.data.user.is_virtual` is true.

- [ ] **Step 4: Run type/lint checks**

Run:

```bash
cd web && npm run lint
```

Expected: PASS or existing unrelated lint failures documented. If lint command is too broad and fails on unrelated files, run:

```bash
cd web && npx eslint src/lib/telegramContact.ts 'src/app/(admin)/admin/orders/page.tsx' 'src/app/(admin)/admin/users/page.tsx'
```

Expected: no errors in touched files.

- [ ] **Step 5: Commit Task 6**

```bash
git add web/src/lib/telegramContact.ts web/src/app/\(admin\)/admin/orders/page.tsx web/src/app/\(admin\)/admin/users/page.tsx
git commit -m "feat: add admin telegram contact links"
```

---

## Task 7: Admin renewals UI manual sweep

**Files:**
- Modify: `web/src/app/(admin)/admin/renewals/page.tsx`

- [ ] **Step 1: Update types and fix existing markup bug**

Modify status type:

```ts
type RenewalStatus = 'sent' | 'sent_legacy' | 'skipped' | 'failed' | 'exhausted'
```

Remove the duplicate `<input` line in the search box.

- [ ] **Step 2: Add manual sweep mutation**

Add:

```ts
interface RenewalSweepSummary {
  scanned: number
  sent: number
  skipped: number
  failed: number
  exhausted: number
}

const [sweepResult, setSweepResult] = useState<RenewalSweepSummary | null>(null)

const sweepMutation = useMutation({
  mutationFn: () => api.post<RenewalSweepSummary>('/admin/renewals/sweep', {}),
  onSuccess: (res) => {
    setSweepResult(res.data)
    queryClient.invalidateQueries({ queryKey: ['admin', 'renewals'] })
  },
})
```

Import `useMutation`, `useQueryClient`.

- [ ] **Step 3: Render status labels and sweep button**

Update maps:

```ts
const STATUS_LABEL: Record<RenewalStatus, string> = {
  sent: 'Đã gửi',
  sent_legacy: 'Đã gửi (khôi phục)',
  skipped: 'Bỏ qua',
  failed: 'Lỗi',
  exhausted: 'Dừng retry',
}
```

Add button near filters:

```tsx
<button
  onClick={() => sweepMutation.mutate()}
  disabled={sweepMutation.isPending}
  className="clay-btn clay-btn--lemon text-sm"
>
  {sweepMutation.isPending ? 'Đang quét...' : 'Quét gia hạn ngay'}
</button>
```

Add summary card:

```tsx
{sweepResult && (
  <div className="clay-card p-3 text-sm">
    Đã quét {sweepResult.scanned} key · Gửi {sweepResult.sent} · Bỏ qua {sweepResult.skipped} · Lỗi {sweepResult.failed} · Dừng retry {sweepResult.exhausted}
  </div>
)}
```

- [ ] **Step 4: Run lint on renewals page**

Run:

```bash
cd web && npx eslint 'src/app/(admin)/admin/renewals/page.tsx'
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

```bash
git add web/src/app/\(admin\)/admin/renewals/page.tsx
git commit -m "feat: add admin renewal manual sweep"
```

---

## Task 8: Final verification and runtime backfill runbook

**Files:**
- No new feature files unless tests reveal a defect.

- [ ] **Step 1: Run backend verification serially**

Run:

```bash
node --check src/services/keyExpiryReminderService.js
node --check src/services/renewalReminderLogService.js
node --check src/api/routes/admin/renewals.js
node --check src/api/routes/admin/users.js
node --check scripts/backfill-renewal-logs.js
node --test --test-concurrency=1 \
  tests/services/keyExpiryReminderService.test.js \
  tests/services/renewalReminderLogService.test.js \
  tests/scripts/backfillRenewalLogs.test.js \
  tests/api/admin-renewals.test.js \
  tests/api/admin-users.test.js
```

Expected: PASS. Use `--test-concurrency=1` because this repo’s tests share `data/shop.db`.

- [ ] **Step 2: Run frontend verification**

Run:

```bash
cd web && npm run lint
```

Expected: PASS or unrelated existing failures explicitly listed. Touched files must be clean.

- [ ] **Step 3: Run DB scripts dry-run only**

Run:

```bash
node scripts/backfill-renewal-logs.js
node scripts/purge-test-data.js
```

Expected: both print dry-run output; neither creates a DB backup without `--apply`.

- [ ] **Step 4: Check git hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected:

- No whitespace errors.
- `data/shop.db`, backup DB files, `.superpowers/`, and unrelated dirty files are not staged.

- [ ] **Step 5: Commit final verification notes if any docs changed**

If no docs changed in this task, do not create an empty commit. If a runbook note was added, commit only that file:

```bash
git add docs/superpowers/plans/2026-06-22-admin-renewals-users-telegram-contact.md
git commit -m "docs: update admin renewal verification notes"
```
