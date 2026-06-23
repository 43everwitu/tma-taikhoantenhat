# Low-Stock Alert: Once Per Episode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send exactly one low-stock alert per low-stock "episode" — fire on the transition into low-stock, suppress while still low (even past 24h), reset only when stock rises back above threshold. Persists across restart.

**Architecture:** Repurpose the existing `products.last_low_stock_alert_at` column as a stateful "alerted since last clear" marker instead of a time-based throttle. Drop the `< datetime('now','-24 hours')` clause from `lowStockQuery.js`. Add a self-healing reset pass in `checkLowStock` that NULLs the column whenever current stock is above threshold (covers refund/cancel return-to-stock paths that bypass `notifyStockReplenished`). State lives in the DB so restart is a no-op.

**Tech Stack:** Node 22, better-sqlite3 (synchronous), node:test, existing `notificationService.checkLowStock` + `lowStockQuery.effectiveLowStockProducts` + `notifyStockReplenished`.

---

## Behavior Spec

| Stock state | Marker (`last_low_stock_alert_at`) | Cycle action |
|---|---|---|
| `count > threshold` | NULL | no-op (healthy) |
| `count > threshold` | NOT NULL | **reset to NULL** (self-heal) |
| `0 < count <= threshold` | NULL | **fire alert**, set marker to NOW |
| `0 < count <= threshold` | NOT NULL | no-op (still alerted, suppress) |
| `count == 0` | (any) | no-op (filter already drops zero-stock — out of scope) |

Restart preserves marker because column is on-disk. Existing `notifyStockReplenished(productId)` keeps clearing the marker when admin uploads new stock; the new self-heal pass covers paths that don't call it (order cancel/refund returning reserved keys, manual DB edits).

## File Structure

- **Modify:** `src/services/lowStockQuery.js` — drop the time-based OR clause so `last_low_stock_alert_at IS NULL` is the only gate.
- **Modify:** `src/services/notificationService.js` — add self-heal reset pass at the start of `checkLowStock`.
- **Modify (test, new file):** `tests/services/lowStockOncePerEpisode.test.js` — new tests for the episode/restart/self-heal semantics.

No migration needed — column already exists; semantics change is in the query + service.

---

## Task 1: Failing test — no re-alert after 24h while still low

**Files:**
- Create: `tests/services/lowStockOncePerEpisode.test.js`

- [ ] **Step 1: Write the failing test**

Add to a new file `tests/services/lowStockOncePerEpisode.test.js`:

```js
const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

function makeFakeBot(sent) {
  return { telegram: { sendMessage: async (...args) => { sent.push(args); } } };
}

function seedLowStockProduct() {
  const slug = 'ep-' + Math.floor(Math.random() * 1e9);
  const cat = db.prepare("INSERT INTO categories (name, slug) VALUES ('ep', ?)").run(slug);
  const p = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active, low_stock_threshold, last_low_stock_alert_at)
    VALUES (?, 'Episode', ?, 1000, 1, 5, NULL)
  `).run(cat.lastInsertRowid, slug);
  db.prepare("INSERT INTO stock (product_id, data, is_sold) VALUES (?, 'k', 0)").run(p.lastInsertRowid);
  return { productId: p.lastInsertRowid, categoryId: cat.lastInsertRowid };
}

function cleanup({ productId, categoryId }) {
  db.prepare("DELETE FROM stock WHERE product_id = ?").run(productId);
  db.prepare("DELETE FROM products WHERE id = ?").run(productId);
  db.prepare("DELETE FROM categories WHERE id = ?").run(categoryId);
}

function loadServiceFresh(fakeBot) {
  delete require.cache[require.resolve('../../src/services/adminNotifyService')];
  delete require.cache[require.resolve('../../src/services/notificationService')];
  delete require.cache[require.resolve('../../src/services/lowStockQuery')];
  const adminNotify = require('../../src/services/adminNotifyService');
  const { NotificationService } = require('../../src/services/notificationService');
  db.prepare("INSERT INTO settings (key, value) VALUES ('notify_admin_low_stock','true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_chat_id','') ON CONFLICT(key) DO UPDATE SET value=''").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_thread_id','') ON CONFLICT(key) DO UPDATE SET value=''").run();
  adminNotify.init(fakeBot);
  adminNotify.invalidateCache();
  return new NotificationService(fakeBot);
}

function sentForProduct(sent, productId) {
  const marker = `<code>${productId}</code>`;
  return sent.filter(args => String(args[1] || '').includes(marker));
}

test('no re-alert after 24h while stock still low', async () => {
  const seeded = seedLowStockProduct();
  const sent = [];
  const svc = loadServiceFresh(makeFakeBot(sent));
  try {
    // First tick — alerts (transition NULL → NOW).
    await svc.checkLowStock();
    assert.strictEqual(sentForProduct(sent, seeded.productId).length, 1);

    // Backdate marker to 25h ago (past the old 24h throttle window) — stock is still low.
    db.prepare(
      "UPDATE products SET last_low_stock_alert_at = datetime('now','-25 hours') WHERE id = ?"
    ).run(seeded.productId);

    // Second tick — must NOT re-alert. Old behavior would have re-alerted here.
    await svc.checkLowStock();
    assert.strictEqual(
      sentForProduct(sent, seeded.productId).length,
      1,
      'Re-alerted after 24h while still low — should suppress until stock replenished'
    );
  } finally {
    cleanup(seeded);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/services/lowStockOncePerEpisode.test.js`
Expected: FAIL on the second assertion — `Re-alerted after 24h while still low` (current `lowStockQuery.js` permits re-alert because `last_low_stock_alert_at < datetime('now','-24 hours')` is true).

- [ ] **Step 3: Implement the fix in `lowStockQuery.js`**

Replace the body of `effectiveLowStockProducts()` so the throttle gate is `last_low_stock_alert_at IS NULL` only — drop the OR-time clause.

Current (`src/services/lowStockQuery.js:11-28`):

```js
function effectiveLowStockProducts() {
  const def = db.prepare("SELECT value FROM settings WHERE key = 'low_stock_alert_threshold'").get();
  const defaultThreshold = def && def.value ? parseInt(def.value, 10) : 5;
  return db.prepare(`
    SELECT * FROM (
      SELECT p.id, p.name, p.emoji,
        COALESCE(NULLIF(p.low_stock_threshold, 0), ?) AS effective_threshold,
        p.last_low_stock_alert_at,
        (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) AS stock_count
      FROM products p
      WHERE p.is_active = 1
    )
    WHERE stock_count > 0
      AND stock_count <= effective_threshold
      AND (last_low_stock_alert_at IS NULL
           OR last_low_stock_alert_at < datetime('now', '-24 hours'))
  `).all(defaultThreshold);
}
```

Replace with:

```js
function effectiveLowStockProducts() {
  const def = db.prepare("SELECT value FROM settings WHERE key = 'low_stock_alert_threshold'").get();
  const defaultThreshold = def && def.value ? parseInt(def.value, 10) : 5;
  // Alert only on transition into low-stock state. The marker stays set until
  // either notifyStockReplenished() clears it (admin uploaded keys) or the
  // self-heal pass in checkLowStock() clears it (stock rose back above
  // threshold via any other path — refund, cancel, manual edit). This makes
  // the alert "once per episode" instead of "once per 24h" — restart-safe
  // because the marker lives in the products table.
  return db.prepare(`
    SELECT * FROM (
      SELECT p.id, p.name, p.emoji,
        COALESCE(NULLIF(p.low_stock_threshold, 0), ?) AS effective_threshold,
        p.last_low_stock_alert_at,
        (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) AS stock_count
      FROM products p
      WHERE p.is_active = 1
    )
    WHERE stock_count > 0
      AND stock_count <= effective_threshold
      AND last_low_stock_alert_at IS NULL
  `).all(defaultThreshold);
}
```

Also update the JSDoc comment block above the function (lines 3-10) — change `last_low_stock_alert_at NULL or older than 24h` to `last_low_stock_alert_at NULL (cleared on replenish or self-heal)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/services/lowStockOncePerEpisode.test.js`
Expected: PASS — the 25h-backdated row no longer matches.

- [ ] **Step 5: Commit**

```bash
git add src/services/lowStockQuery.js tests/services/lowStockOncePerEpisode.test.js
git commit -m "fix(low-stock): alert once per episode, not once per 24h

Drop the time-based OR clause from effectiveLowStockProducts so the gate
is purely last_low_stock_alert_at IS NULL. Previously, a product that
stayed in low-stock state past 24h would re-trigger; admins want one
alert per episode (drop into low stock → suppress until replenished)."
```

---

## Task 2: Failing test — self-heal reset when stock rises without notifyStockReplenished

**Files:**
- Modify: `tests/services/lowStockOncePerEpisode.test.js` — append
- Modify: `src/services/notificationService.js:133-182` (`checkLowStock` method)

- [ ] **Step 1: Write the failing test**

Append to `tests/services/lowStockOncePerEpisode.test.js`:

```js
test('self-heal resets marker when stock rises above threshold without notifyStockReplenished', async () => {
  const seeded = seedLowStockProduct();
  const sent = [];
  const svc = loadServiceFresh(makeFakeBot(sent));
  try {
    // First tick — alerts and stamps marker.
    await svc.checkLowStock();
    assert.strictEqual(sentForProduct(sent, seeded.productId).length, 1);
    const stamped = db.prepare(
      'SELECT last_low_stock_alert_at FROM products WHERE id = ?'
    ).get(seeded.productId).last_low_stock_alert_at;
    assert.ok(stamped, 'marker should be set after first alert');

    // Simulate stock rising above threshold via a code path that does NOT call
    // notifyStockReplenished — e.g., an order cancel returning reserved keys,
    // or a manual SQL insert. We just bulk-insert 10 more stock rows.
    for (let i = 0; i < 10; i++) {
      db.prepare("INSERT INTO stock (product_id, data, is_sold) VALUES (?, ?, 0)")
        .run(seeded.productId, `k${i}`);
    }

    // Next tick — self-heal should NULL the marker (stock now > threshold).
    await svc.checkLowStock();
    const cleared = db.prepare(
      'SELECT last_low_stock_alert_at FROM products WHERE id = ?'
    ).get(seeded.productId).last_low_stock_alert_at;
    assert.strictEqual(
      cleared,
      null,
      'self-heal pass should NULL the marker once stock is above threshold'
    );

    // Now drop back to low stock — should alert again (new episode).
    db.prepare("DELETE FROM stock WHERE product_id = ? AND data LIKE 'k%'")
      .run(seeded.productId);
    await svc.checkLowStock();
    assert.strictEqual(
      sentForProduct(sent, seeded.productId).length,
      2,
      'second episode should re-alert after self-heal cleared the marker'
    );
  } finally {
    cleanup(seeded);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/services/lowStockOncePerEpisode.test.js`
Expected: FAIL on `self-heal pass should NULL the marker` — current `checkLowStock` only writes the marker on alert, never clears it.

- [ ] **Step 3: Implement the self-heal pass in `checkLowStock`**

In `src/services/notificationService.js`, modify the `checkLowStock()` method. Add a self-heal block at the very top of the method (before `effectiveLowStockProducts()` is called).

Replace lines 133-137 (the opening of `checkLowStock`):

```js
  async checkLowStock() {
    const { effectiveLowStockProducts } = require('./lowStockQuery');
    const lowStockProducts = effectiveLowStockProducts();

    if (lowStockProducts.length === 0) return;
```

With:

```js
  async checkLowStock() {
    const { effectiveLowStockProducts } = require('./lowStockQuery');

    // Self-heal: clear the alert marker for any product whose stock is back
    // above its effective threshold. Covers paths that don't go through
    // notifyStockReplenished (order cancel returning reserved keys, manual
    // DB edits, restored deletions). Keeps the "once per episode" guarantee
    // honest: a new episode can only fire after this pass NULLs the marker.
    db.prepare(`
      UPDATE products
      SET last_low_stock_alert_at = NULL
      WHERE last_low_stock_alert_at IS NOT NULL
        AND (
          SELECT COUNT(*) FROM stock s
          WHERE s.product_id = products.id AND s.is_sold = 0
        ) > COALESCE(
          NULLIF(low_stock_threshold, 0),
          (SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'low_stock_alert_threshold'),
          5
        )
    `).run();

    const lowStockProducts = effectiveLowStockProducts();

    if (lowStockProducts.length === 0) return;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/services/lowStockOncePerEpisode.test.js`
Expected: PASS — marker is cleared once stock rises above threshold, allowing the next episode to alert.

- [ ] **Step 5: Commit**

```bash
git add src/services/notificationService.js tests/services/lowStockOncePerEpisode.test.js
git commit -m "fix(low-stock): self-heal alert marker when stock returns above threshold

checkLowStock now opens with an UPDATE that NULLs last_low_stock_alert_at
for any product whose current stock_count is above its effective threshold.
Catches paths that bypass notifyStockReplenished — order cancel returning
reserved keys, manual edits — and lets the next low-stock episode alert."
```

---

## Task 3: Restart-survival regression test

**Files:**
- Modify: `tests/services/lowStockOncePerEpisode.test.js` — append

This is purely additive insurance — the column-based design already survives restart. The test rebuilds the service fresh after an alert to prove the marker is honored on cold-start.

- [ ] **Step 1: Write the test**

Append to `tests/services/lowStockOncePerEpisode.test.js`:

```js
test('marker survives a process restart (fresh service load)', async () => {
  const seeded = seedLowStockProduct();
  const sentBefore = [];
  let svc = loadServiceFresh(makeFakeBot(sentBefore));
  try {
    await svc.checkLowStock();
    assert.strictEqual(sentForProduct(sentBefore, seeded.productId).length, 1);

    // Simulate restart: drop the require cache and rebuild the service.
    const sentAfter = [];
    svc = loadServiceFresh(makeFakeBot(sentAfter));

    // Stock still low, marker still set in DB — must NOT re-alert.
    await svc.checkLowStock();
    assert.strictEqual(
      sentForProduct(sentAfter, seeded.productId).length,
      0,
      'fresh service after restart must honor the persisted marker'
    );
  } finally {
    cleanup(seeded);
  }
});
```

- [ ] **Step 2: Run the test**

Run: `node --test tests/services/lowStockOncePerEpisode.test.js`
Expected: PASS on all three tests.

- [ ] **Step 3: Run the existing dedup test to confirm no regression**

Run: `node --test tests/services/lowStockDedup.test.js`
Expected: PASS — the existing `sends only once per product within 24h` test still holds (our change makes it stricter, not looser).

- [ ] **Step 4: Run the full service test suite for safety**

Run: `node --test tests/services/`
Expected: PASS on `lowStockOncePerEpisode`, `lowStockDedup`, `lowStockThreshold`, `lowStockRouting`. Pre-existing flaky failures elsewhere (`variantService`, `messageTemplate`, `bot-start`) are tracked separately and unrelated.

- [ ] **Step 5: Commit**

```bash
git add tests/services/lowStockOncePerEpisode.test.js
git commit -m "test(low-stock): restart-survival test for once-per-episode marker"
```

---

## Self-Review Checklist

- [x] Spec coverage: "1 lần mỗi 24h" (drop time clause) + "không báo trùng kể cả khi restart" (DB-backed marker + self-heal) + "hôm sau vẫn ko có stock thì không báo lại" (Task 1 test backdates marker 25h and asserts no re-alert).
- [x] No placeholders — every step has full file paths, full code blocks, exact commands, expected outputs.
- [x] Type/signature consistency: `effectiveLowStockProducts()` signature unchanged (still returns the same row shape — only the WHERE clause tightened). `checkLowStock` keeps its async no-arg signature; just prepends an UPDATE.
- [x] Idempotence: re-running the self-heal UPDATE is safe (NULL → NULL is a no-op). Re-running the alert query post-fix returns empty when marker is set.
- [x] Backward compat: existing rows where `last_low_stock_alert_at` is already set from old-throttle behavior are honored correctly under new semantics (treated as "alerted, suppress until stock rises"). No migration needed.
