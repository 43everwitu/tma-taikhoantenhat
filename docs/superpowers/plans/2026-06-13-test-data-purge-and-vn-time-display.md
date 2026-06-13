# Test Data Purge And Vietnam Time Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove leftover prompt/test order data and make frontend DB timestamps display in Hanoi time consistently.

**Architecture:** Add one explicit maintenance script for the one-time purge, with dry-run counts, backup, and transactional deletes. Update the shared frontend date utilities so SQLite timestamp strings are parsed as UTC and rendered with `Asia/Ho_Chi_Minh`, then reuse the shared formatter in duplicated miniapp order date rendering.

**Tech Stack:** Node.js 22, better-sqlite3, SQLite, Next.js/TypeScript, built-in `Intl.DateTimeFormat`, Node built-in test runner for temporary verification.

---

## File Structure

- Create `scripts/purge-test-data.js`: one-time maintenance script for dry-run/apply purge.
- Modify `web/src/lib/utils.ts`: add DB timestamp parsing and Hanoi date formatting in shared helpers.
- Modify `web/src/app/(miniapp)/don-hang/page.tsx`: remove duplicated local formatter and use shared `formatDate`.
- Temporary only: `tests/tmp-format-date-vn.test.js` may be created during TDD and must be deleted before final commit.

## Task 1: Build Safe Test Data Purge Script

**Files:**
- Create: `scripts/purge-test-data.js`

- [ ] **Step 1: Create the purge script**

Create `scripts/purge-test-data.js`:

```js
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const db = require('../src/database');

const APPLY = process.argv.includes('--apply');
const repoRoot = path.join(__dirname, '..');
const dbPath = path.join(repoRoot, 'data', 'shop.db');
const TEST_USER_ID = 9990001;

function allIds(rows) {
  return rows.map(r => r.id);
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    '-',
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join('');
}

function collectTargets() {
  const products = db.prepare(`
    SELECT DISTINCT p.id, p.name, p.slug
    FROM products p
    LEFT JOIN orders o ON o.product_id = p.id
    WHERE p.name IN ('R', 'Test')
       OR p.slug LIKE 'r-%'
       OR o.user_id = ?
  `).all(TEST_USER_ID);
  const productIds = allIds(products);

  const orderWhere = productIds.length
    ? `user_id = ? OR product_id IN (${placeholders(productIds)})`
    : 'user_id = ?';
  const orderParams = productIds.length ? [TEST_USER_ID, ...productIds] : [TEST_USER_ID];
  const orders = db.prepare(`SELECT id, user_id, product_id FROM orders WHERE ${orderWhere}`).all(...orderParams);
  const orderIds = allIds(orders);

  const nonTestUserOrders = orders.filter(o => o.user_id !== TEST_USER_ID);
  const stockRows = productIds.length
    ? db.prepare(`SELECT id FROM stock WHERE product_id IN (${placeholders(productIds)})`).all(...productIds)
    : [];
  const transactions = orderIds.length
    ? db.prepare(`SELECT id FROM transactions WHERE matched_order_id IN (${placeholders(orderIds)})`).all(...orderIds)
    : [];
  const targetUser = db.prepare('SELECT telegram_id FROM users WHERE telegram_id = ?').get(TEST_USER_ID);

  return { products, productIds, orders, orderIds, nonTestUserOrders, stockRows, transactions, targetUser };
}

function printCounts(label, targets) {
  console.log(`\\n${label}`);
  console.log(`target user: ${targets.targetUser ? 1 : 0}`);
  console.log(`target products: ${targets.products.length}`);
  console.log(`target orders: ${targets.orders.length}`);
  console.log(`non-test-user orders via product rule: ${targets.nonTestUserOrders.length}`);
  console.log(`target stock rows: ${targets.stockRows.length}`);
  console.log(`target transactions: ${targets.transactions.length}`);
}

function createBackup() {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`DB file not found: ${dbPath}`);
  }
  const backupPath = path.join(repoRoot, 'data', `shop.db.bak-pre-test-purge-${nowStamp()}`);
  fs.copyFileSync(dbPath, backupPath, fs.constants.COPYFILE_EXCL);
  return backupPath;
}

function runDelete(targets) {
  const tx = db.transaction(() => {
    if (targets.orderIds.length) {
      db.prepare(`DELETE FROM transactions WHERE matched_order_id IN (${placeholders(targets.orderIds)})`).run(...targets.orderIds);
    }
    if (targets.orderIds.length) {
      db.prepare(`DELETE FROM orders WHERE id IN (${placeholders(targets.orderIds)})`).run(...targets.orderIds);
    }
    if (targets.productIds.length) {
      db.prepare(`DELETE FROM stock WHERE product_id IN (${placeholders(targets.productIds)})`).run(...targets.productIds);
      db.prepare(`DELETE FROM product_variants WHERE product_id IN (${placeholders(targets.productIds)})`).run(...targets.productIds);
      db.prepare(`DELETE FROM product_follows WHERE product_id IN (${placeholders(targets.productIds)})`).run(...targets.productIds);
      db.prepare(`DELETE FROM products WHERE id IN (${placeholders(targets.productIds)})`).run(...targets.productIds);
    }
    const remaining = db.prepare('SELECT COUNT(*) AS c FROM orders WHERE user_id = ?').get(TEST_USER_ID).c;
    if (remaining === 0) db.prepare('DELETE FROM users WHERE telegram_id = ?').run(TEST_USER_ID);
  });
  tx();
}

const before = collectTargets();
printCounts('Before purge', before);

if (!APPLY) {
  console.log('\\nDry run only. Re-run with --apply to create a backup and delete these rows.');
  process.exit(0);
}

const backupPath = createBackup();
console.log(`\\nBackup created: ${backupPath}`);
runDelete(before);
const after = collectTargets();
printCounts('After purge', after);
```

- [ ] **Step 2: Run dry-run counts**

Run:

```bash
node scripts/purge-test-data.js
```

Expected: prints counts and says dry run only. No DB rows are deleted.

- [ ] **Step 3: Commit the script**

Run:

```bash
git add scripts/purge-test-data.js
git commit -m "chore: add safe test data purge script"
```

Expected: commit contains only `scripts/purge-test-data.js`.

## Task 2: Format DB Timestamps As Hanoi Time

**Files:**
- Modify: `web/src/lib/utils.ts`
- Modify: `web/src/app/(miniapp)/don-hang/page.tsx`
- Temporary only: `tests/tmp-format-date-vn.test.js`

- [ ] **Step 1: Add temporary failing test against production helper**

Create `tests/tmp-format-date-vn.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');

test('temporary: shared formatDate renders SQLite UTC timestamp as Hanoi time', async () => {
  const { formatDate } = await import('../web/src/lib/utils.ts');
  assert.match(formatDate('2026-06-13 03:35:37'), /10:35:37/);
});
```

Run:

```bash
node --experimental-strip-types --test tests/tmp-format-date-vn.test.js
```

Expected: FAIL because current `formatDate()` renders `03:35:37`, not Hanoi `10:35:37`.

- [ ] **Step 2: Update shared frontend date utilities**

In `web/src/lib/utils.ts`, replace the current `formatDate` and `formatRelativeTime` date parsing with:

```ts
const HANOI_TIME_ZONE = 'Asia/Ho_Chi_Minh'
const SQLITE_TIMESTAMP_RE = /^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$/

export function parseDbDate(date: string | null | undefined): Date | null {
  if (!date) return null
  const normalized = SQLITE_TIMESTAMP_RE.test(date) ? `${date.replace(' ', 'T')}Z` : date
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatDate(date: string | null | undefined): string {
  const parsed = parseDbDate(date)
  if (!parsed) return date || ''
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: HANOI_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(parsed)
}

export function formatRelativeTime(date: string): string {
  const parsed = parseDbDate(date)
  if (!parsed) return ''
  const diffSec = Math.floor((Date.now() - parsed.getTime()) / 1000)
  if (diffSec < 60) return 'Vừa xong'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} phút trước`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} giờ trước`
  if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)} ngày trước`
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: HANOI_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed)
}
```

Keep existing `cn`, `formatPrice`, and `formatPriceShort`.

- [ ] **Step 3: Replace duplicated miniapp order formatter**

In `web/src/app/(miniapp)/don-hang/page.tsx`:

Change:

```ts
import { formatPrice } from '@/lib/utils'
```

to:

```ts
import { formatDate, formatPrice } from '@/lib/utils'
```

Delete the local `function formatDate(iso: string) { ... }` block.

- [ ] **Step 4: Verify date behavior and remove temporary test**

Run:

```bash
node --experimental-strip-types --test tests/tmp-format-date-vn.test.js
```

Expected: PASS. This is a temporary verification file.

Then delete:

```bash
rm tests/tmp-format-date-vn.test.js
```

Run:

```bash
test ! -e tests/tmp-format-date-vn.test.js
```

Expected: exit code `0`.

- [ ] **Step 5: Run frontend verification**

Run:

```bash
cd web && npm run lint
```

Expected: lint completes without new errors from changed files.

- [ ] **Step 6: Commit frontend timestamp fix**

Run:

```bash
git add web/src/lib/utils.ts web/src/app/'(miniapp)'/don-hang/page.tsx
git commit -m "fix: render db timestamps in hanoi time"
```

Expected: commit contains only the two frontend files. The temporary test file is not committed.

## Task 3: Purge Test Data And Verify No Test Artifacts Remain

**Files/Data:**
- Run: `scripts/purge-test-data.js`
- Modify data: `data/shop.db`
- Create backup: `data/shop.db.bak-pre-test-purge-*`

- [ ] **Step 1: Run dry-run immediately before apply**

Run:

```bash
node scripts/purge-test-data.js
```

Expected: prints non-zero counts for target test rows before purge.

- [ ] **Step 2: Apply purge**

Run:

```bash
node scripts/purge-test-data.js --apply
```

Expected:
- Prints backup path under `data/shop.db.bak-pre-test-purge-*`.
- Prints after-purge counts with zero target orders/products/transactions/stock rows.

- [ ] **Step 3: Verify dashboard test data is gone**

Run:

```bash
sqlite3 -header -column data/shop.db "
SELECT COUNT(*) AS active_test_orders
FROM orders o
LEFT JOIN users u ON u.telegram_id=o.user_id
LEFT JOIN products p ON p.id=o.product_id
WHERE o.deleted_at IS NULL
  AND (o.user_id=9990001 OR u.full_name='Test' OR p.name IN ('R','Test') OR p.slug LIKE 'r-%');
SELECT COUNT(*) AS remaining_test_products
FROM products
WHERE name IN ('R','Test') OR slug LIKE 'r-%';
"
```

Expected:

```text
active_test_orders = 0
remaining_test_products = 0
```

- [ ] **Step 4: Verify backup exists**

Run:

```bash
ls -1t data/shop.db.bak-pre-test-purge-* | head -1
```

Expected: prints the backup file path created by Step 2.

- [ ] **Step 5: Final temporary-test cleanup check**

Run:

```bash
rg -n "tmp-format-date-vn|temporary desired behavior|9990001.*Test fixture" tests scripts web docs/superpowers/plans/2026-06-13-test-data-purge-and-vn-time-display.md
```

Expected: no matches except the plan file itself may contain this cleanup instruction. No temporary test file should exist.

- [ ] **Step 6: Final verification**

Run:

```bash
node --test tests/services/paymentPollerLateRecovery.test.js tests/services/orderRecovery.test.js tests/services/pollerInterval.test.js
cd web && npm run lint
```

Expected: commands complete without failures from this change.

- [ ] **Step 7: Commit no DB data**

Do not commit `data/shop.db` or backup files. Only code/docs commits are expected for this task set.

Run:

```bash
git status --short data scripts/purge-test-data.js web/src/lib/utils.ts web/src/app/'(miniapp)'/don-hang/page.tsx tests/tmp-format-date-vn.test.js
```

Expected:
- `data/shop.db` may be modified locally and backup may be untracked.
- `tests/tmp-format-date-vn.test.js` must not exist.
- No staged DB files.
