# Out-of-Stock Channel Alert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send one variant-aware out-of-stock alert to the management channel when a bucket that already entered a low-stock episode reaches zero, even while low-stock snooze is active.

**Architecture:** Extend `low_stock_alert_states` with a persistent out-of-stock marker and expose a dedicated bucket query. `NotificationService.checkLowStock()` resets recovered markers, sends out-of-stock alerts before normal low-stock alerts, and marks state only after `adminNotifyService.notify()` confirms Telegram delivery. Reuse the existing management-channel routing and add a delete-only callback for out-of-stock messages.

**Tech Stack:** Node.js 22, better-sqlite3, Telegraf, Express-era service modules, editable message templates, Node built-in test runner.

---

## File Map

- Create `src/database/migrations/053_out_of_stock_alerts.js`: add persistent marker and seed the required admin template.
- Modify `src/database/seeds/message-templates.json`: define `admin.out_of_stock` for fresh databases.
- Modify `src/services/messageTemplateService.js`: make `admin.out_of_stock` required so it cannot be disabled while the monitor is active.
- Modify `src/services/lowStockQuery.js`: query eligible zero-stock buckets and reset recovered markers.
- Modify `src/services/adminNotifyService.js`: return a boolean delivery result.
- Modify `src/services/notificationService.js`: send and mark out-of-stock alerts before low-stock alerts.
- Modify `src/bot/lowStockActions.js`: register delete-only out-of-stock callbacks.
- Modify focused tests under `tests/services/` and `tests/bot/`.

### Task 1: Persistent out-of-stock state and template

**Files:**
- Create: `src/database/migrations/053_out_of_stock_alerts.js`
- Modify: `src/database/seeds/message-templates.json`
- Modify: `src/services/messageTemplateService.js`

- [ ] **Step 1: Create migration `053_out_of_stock_alerts.js`**

Implement an idempotent migration that:

```js
function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .some((row) => row.name === column);
}

function up(db) {
  if (!hasColumn(db, 'low_stock_alert_states', 'out_of_stock_alert_at')) {
    db.exec('ALTER TABLE low_stock_alert_states ADD COLUMN out_of_stock_alert_at DATETIME');
  }

  const body = "🔴 <b>Hết hàng</b>\n\n{{productEmoji}} <b>{{productName}}</b>{{variantLine}}\n🆔 ID: <code>{{productId}}</code>\n📦 Còn lại: <b>0</b>{{stockUrlBlock}}";
  const variables = JSON.stringify([
    'productEmoji', 'productName', 'productId', 'variantLine',
    'variantName', 'variantId', 'targetType', 'targetKey', 'stockUrlBlock',
  ]);
  db.prepare(`
    INSERT INTO message_templates (
      key, channel, label, variables, body, default_body, is_enabled
    ) VALUES (
      'admin.out_of_stock', 'admin', 'Admin — sản phẩm hết hàng',
      ?, ?, ?, 1
    )
    ON CONFLICT(key) DO NOTHING
  `).run(variables, body, body);
}

module.exports = { up };
```

- [ ] **Step 2: Add the same template to the JSON seed**

Add:

```json
"admin.out_of_stock": {
  "channel": "admin",
  "label": "Admin — sản phẩm hết hàng",
  "variables": [
    "productEmoji",
    "productName",
    "productId",
    "variantLine",
    "variantName",
    "variantId",
    "targetType",
    "targetKey",
    "stockUrlBlock"
  ],
  "body": "🔴 <b>Hết hàng</b>\n\n{{productEmoji}} <b>{{productName}}</b>{{variantLine}}\n🆔 ID: <code>{{productId}}</code>\n📦 Còn lại: <b>0</b>{{stockUrlBlock}}"
}
```

- [ ] **Step 3: Mark the template as required**

Add `'admin.out_of_stock'` to `CORE_TEMPLATE_KEYS` in `src/services/messageTemplateService.js`. This keeps the body editable but prevents disabling a monitor-critical template.

- [ ] **Step 4: Verify migration and template**

Run:

```bash
node -e "const db=require('./src/database'); const cols=db.prepare('PRAGMA table_info(low_stock_alert_states)').all(); const tpl=db.prepare(\"SELECT key,channel,is_enabled FROM message_templates WHERE key='admin.out_of_stock'\").get(); if(!cols.some(c=>c.name==='out_of_stock_alert_at')||!tpl) throw new Error('missing out-of-stock migration'); console.log(tpl)"
```

Expected: one `admin.out_of_stock` row with channel `admin`.

### Task 2: Query and recovery state

**Files:**
- Modify: `tests/services/lowStockVariantThreshold.test.js`
- Modify: `src/services/lowStockQuery.js`

- [ ] **Step 1: Write failing query tests**

Add tests that seed state for `v:<variantId>` with `last_alert_at`, sell all stock for that variant, and assert:

```js
const rows = freshQuery().effectiveOutOfStockProducts();
const hit = rows.find((row) => row.variant_id === seed.lowVariantId);
assert.ok(hit);
assert.strictEqual(hit.stock_count, 0);
```

Cover these cases in focused tests:

- product không có biến thể dùng bucket `p:<productId>` và được trả về khi đủ điều kiện.
- `snoozed_until = datetime('now', '+24 hours')` does not hide the zero-stock bucket.
- no `last_alert_at` means no out-of-stock row.
- existing `out_of_stock_alert_at` means no out-of-stock row.
- backorder variant never appears.
- healthy sibling variant never appears.
- after replenishing one key and running recovery, `out_of_stock_alert_at` becomes `NULL`.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
node tests/services/lowStockVariantThreshold.test.js
```

Expected: FAIL because `effectiveOutOfStockProducts()` and the new marker do not exist.

- [ ] **Step 3: Implement the out-of-stock query**

Add `effectiveOutOfStockProducts()` using the same product/variant bucket shape as `effectiveLowStockProducts()`, with final conditions:

```sql
WHERE stock_count = 0
  AND last_low_stock_alert_at IS NOT NULL
  AND out_of_stock_alert_at IS NULL
```

Do not filter on `low_stock_snoozed_until`. Keep active product/variant and non-backorder constraints identical to the low-stock query.

- [ ] **Step 4: Extend recovery**

Update `clearRecoveredLowStockStates()` in two phases:

```sql
UPDATE low_stock_alert_states
SET out_of_stock_alert_at = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE out_of_stock_alert_at IS NOT NULL
  AND <bucket stock count> > 0;
```

Then extend the existing above-threshold reset to also set:

```sql
out_of_stock_alert_at = NULL
```

- [ ] **Step 5: Export and verify GREEN**

Export `effectiveOutOfStockProducts`, then run:

```bash
node tests/services/lowStockVariantThreshold.test.js
```

Expected: all tests pass.

### Task 3: Management-channel delivery contract

**Files:**
- Modify: `tests/services/lowStockRouting.test.js`
- Modify: `src/services/adminNotifyService.js`

- [ ] **Step 1: Write failing return-value tests**

Extend routing tests:

```js
const delivered = await svc.notify('low_stock', 'body', { parse_mode: 'HTML' });
assert.strictEqual(delivered, true);
```

Add a fake bot whose `sendMessage()` throws and assert:

```js
assert.strictEqual(await svc.notify('low_stock', 'body'), false);
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
node tests/services/lowStockRouting.test.js
```

Expected: FAIL because `notify()` currently returns `undefined`.

- [ ] **Step 3: Implement boolean result**

Update `notify()`:

- Return `false` when bot is missing, target is missing, or an event is skipped.
- Return `true` immediately after `sendMessage()` succeeds.
- Catch Telegram errors, log them, and return `false`.

Do not change target resolution: event type `low_stock` must still use `low_stock_chat_id` and `low_stock_thread_id`.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
node tests/services/lowStockRouting.test.js
```

Expected: all tests pass.

### Task 4: Out-of-stock notification orchestration

**Files:**
- Modify: `tests/services/lowStockVariantNotification.test.js`
- Modify: `src/services/notificationService.js`

- [ ] **Step 1: Write failing notification tests**

Add a helper that:

1. Runs `checkLowStock()` with stock count `1` to create `last_alert_at`.
2. Sets `snoozed_until` 24 hours ahead.
3. Marks the remaining stock sold.
4. Runs `checkLowStock()` again.

Assert the second run:

```js
assert.ok(alert.message.includes('Hết hàng'));
assert.ok(alert.message.includes(seed.variantName));
assert.ok(buttons.some((b) => b.callback_data === `outstock_done:v:${seed.variantId}`));
assert.ok(buttons.some((b) => String(b.url).includes(`variantId=${seed.variantId}`)));
assert.ok(state.out_of_stock_alert_at);
```

Run `checkLowStock()` a third time and assert no second out-of-stock message.

Add a failure test where Telegram `sendMessage()` throws and assert `out_of_stock_alert_at` remains `NULL`.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
node tests/services/lowStockVariantNotification.test.js
```

Expected: FAIL because no out-of-stock notification path exists.

- [ ] **Step 3: Add shared alert formatting helpers**

Inside `checkLowStock()`, reuse one local helper for:

- stock admin URL, including `variantId`.
- `variantLine`.
- inline `📥 Thêm kho` button.

Keep the existing low-stock body and callback unchanged.

- [ ] **Step 4: Send out-of-stock alerts before low-stock alerts**

After recovery and before `effectiveLowStockProducts()`:

```js
const outOfStockProducts = effectiveOutOfStockProducts();
```

For each row:

- Render `admin.out_of_stock`.
- Build keyboard with `📥 Thêm kho` and `outstock_done:p:<id>` or `outstock_done:v:<id>`.
- Call `adminNotifyService.notify('low_stock', body, opts)`.
- Only on `true`, upsert/set `out_of_stock_alert_at = CURRENT_TIMESTAMP`.
- Do not modify `snoozed_until`.

Continue into the existing low-stock loop afterward.

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```bash
node tests/services/lowStockVariantNotification.test.js
```

Expected: low-stock and out-of-stock tests pass.

### Task 5: Delete-only out-of-stock callback

**Files:**
- Modify: `tests/bot/lowStockActions.test.js`
- Modify: `src/bot/lowStockActions.js`

- [ ] **Step 1: Write failing callback tests**

Register the bot handlers, locate `outstock_done:v:<variantId>`, invoke it, and assert:

```js
assert.strictEqual(deleted, true);
assert.strictEqual(answered, 'Đã xóa cảnh báo. Hệ thống sẽ tự nhận biết khi có stock mới.');
```

Seed an existing state row and assert `snoozed_until` and `out_of_stock_alert_at` are unchanged.

Add a context where `deleteMessage()` throws and assert the callback still answers.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
node tests/bot/lowStockActions.test.js
```

Expected: FAIL because no `outstock_done` action is registered.

- [ ] **Step 3: Implement the callback**

Register:

```js
bot.action(/^outstock_done:(p|v):(\d+)$/, async (ctx) => {
  try {
    await ctx.deleteMessage();
  } catch (err) {
    console.error('lowStockActions outstock deleteMessage failed:', err.message || err);
  }
  try {
    await ctx.answerCbQuery('Đã xóa cảnh báo. Hệ thống sẽ tự nhận biết khi có stock mới.');
  } catch {}
});
```

Do not write to the database in this handler.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
node tests/bot/lowStockActions.test.js
```

Expected: all tests pass.

### Task 6: Full verification

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run focused tests serially**

```bash
node --test --test-concurrency=1 \
  tests/services/lowStockVariantThreshold.test.js \
  tests/services/lowStockVariantNotification.test.js \
  tests/services/lowStockOncePerEpisode.test.js \
  tests/services/lowStockSnooze.test.js \
  tests/services/lowStockRouting.test.js \
  tests/bot/lowStockActions.test.js \
  tests/services/statsLowStockVariantCount.test.js
```

Expected: all suites pass.

- [ ] **Step 2: Verify templates**

```bash
node scripts/verify-message-templates.js
```

Expected: all templates render successfully, including `admin.out_of_stock`.

- [ ] **Step 3: Check syntax and whitespace**

```bash
node --check src/database/migrations/053_out_of_stock_alerts.js
node --check src/services/lowStockQuery.js
node --check src/services/adminNotifyService.js
node --check src/services/notificationService.js
node --check src/bot/lowStockActions.js
git diff --check
```

Expected: exit code `0`.

- [ ] **Step 4: Review scope**

```bash
git diff --stat -- \
  src/database/migrations/053_out_of_stock_alerts.js \
  src/database/seeds/message-templates.json \
  src/services/messageTemplateService.js \
  src/services/lowStockQuery.js \
  src/services/adminNotifyService.js \
  src/services/notificationService.js \
  src/bot/lowStockActions.js \
  tests/services/lowStockVariantThreshold.test.js \
  tests/services/lowStockVariantNotification.test.js \
  tests/services/lowStockRouting.test.js \
  tests/bot/lowStockActions.test.js
```

Expected: changes are limited to out-of-stock management-channel alerts and their regression tests.
