# Variant Low Stock Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make low-stock alerts calculate, notify, and snooze per product variant instead of using total product stock.

**Architecture:** Add a small state table keyed by low-stock target (`p:<productId>` or `v:<variantId>`). `lowStockQuery` returns bucket-aware rows while preserving the existing `effectiveLowStockProducts()` interface for callers. `NotificationService.checkLowStock()` formats variant-specific messages and callback data, while `lowStockActions` snoozes only the selected bucket.

**Tech Stack:** Node.js, Express/Telegraf bot handlers, SQLite/better-sqlite3 migrations, Node built-in test runner.

---

## File Structure

- Create `src/database/migrations/052_low_stock_variant_states.js`: state table plus updated default low-stock template.
- Modify `src/services/lowStockQuery.js`: returns product or variant low-stock buckets and exposes recovery helper/count helper.
- Modify `src/services/notificationService.js`: uses bucket fields in message and callback.
- Modify `src/bot/lowStockActions.js`: handles product, variant, and legacy callbacks.
- Modify `src/services/statsService.js`: dashboard count uses bucket-aware helper.
- Modify `src/services/messageTemplateService.js`: trusts `variantLine`.
- Test `tests/services/lowStockVariantThreshold.test.js`: variant query behavior.
- Test `tests/services/lowStockVariantNotification.test.js`: Telegram message and callback data.
- Test `tests/bot/lowStockActions.test.js`: variant-specific snooze.

## Tasks

### Task 1: Variant-aware low-stock query

**Files:**
- Create: `src/database/migrations/052_low_stock_variant_states.js`
- Modify: `src/services/lowStockQuery.js`
- Create: `tests/services/lowStockVariantThreshold.test.js`

- [ ] **Step 1: Write failing query tests**

Test a product with two active variants where one variant has low stock and the product total is above threshold. Assert only that variant appears and backorder variants are excluded.

- [ ] **Step 2: Run RED**

Run: `node --test tests/services/lowStockVariantThreshold.test.js`

Expected: FAIL because `effectiveLowStockProducts()` does not return variant rows.

- [ ] **Step 3: Add migration and query logic**

Create `low_stock_alert_states`, update `effectiveLowStockProducts()` to return bucket rows with `target_key`, `target_type`, `variant_id`, and `variant_name`.

- [ ] **Step 4: Run query tests**

Run: `node --test tests/services/lowStockVariantThreshold.test.js tests/services/lowStockThreshold.test.js`

Expected: PASS.

### Task 2: Variant-specific notification message and callback

**Files:**
- Modify: `src/database/migrations/052_low_stock_variant_states.js`
- Modify: `src/services/messageTemplateService.js`
- Modify: `src/services/notificationService.js`
- Create: `tests/services/lowStockVariantNotification.test.js`

- [ ] **Step 1: Write failing notification test**

Seed a low-stock variant. Run `checkLowStock()`. Assert message contains variant name and inline keyboard contains `lowstock_done:v:<variantId>`.

- [ ] **Step 2: Run RED**

Run: `node --test tests/services/lowStockVariantNotification.test.js`

Expected: FAIL because message/callback still use product-only data.

- [ ] **Step 3: Implement notification formatting**

Add `variantLine`, `variantName`, `variantId`, `targetType`, `targetKey`; update state marker after successful send.

- [ ] **Step 4: Run notification tests**

Run: `node --test tests/services/lowStockVariantNotification.test.js tests/services/lowStockSnooze.test.js tests/services/lowStockOncePerEpisode.test.js`

Expected: PASS.

### Task 3: Variant-specific snooze action

**Files:**
- Modify: `src/bot/lowStockActions.js`
- Modify: `tests/bot/lowStockActions.test.js`

- [ ] **Step 1: Write failing action test**

Add a test for `lowstock_done:v:<variantId>` that asserts only `low_stock_alert_states.v:<variantId>.snoozed_until` is set.

- [ ] **Step 2: Run RED**

Run: `node --test tests/bot/lowStockActions.test.js`

Expected: FAIL because variant callback is not registered.

- [ ] **Step 3: Implement callback support**

Support `lowstock_done:p:<productId>`, `lowstock_done:v:<variantId>`, and legacy `lowstock_done:<productId>`.

- [ ] **Step 4: Run action tests**

Run: `node --test tests/bot/lowStockActions.test.js`

Expected: PASS.

### Task 4: Dashboard count and final verification

**Files:**
- Modify: `src/services/statsService.js`

- [ ] **Step 1: Switch dashboard count**

Use `countEffectiveLowStockBuckets()` from `lowStockQuery`.

- [ ] **Step 2: Run focused suite**

Run:

```bash
node --test tests/services/lowStockVariantThreshold.test.js tests/services/lowStockVariantNotification.test.js tests/services/lowStockSnooze.test.js tests/services/lowStockOncePerEpisode.test.js tests/services/lowStockThreshold.test.js tests/bot/lowStockActions.test.js tests/services/lowStockRouting.test.js
```

Expected: PASS.

- [ ] **Step 3: Inspect diff scope**

Run: `git diff --stat src/services/lowStockQuery.js src/services/notificationService.js src/bot/lowStockActions.js src/services/statsService.js src/database/migrations/052_low_stock_variant_states.js tests/services/lowStockVariantThreshold.test.js tests/services/lowStockVariantNotification.test.js tests/bot/lowStockActions.test.js docs/superpowers/specs/2026-06-15-variant-low-stock-alerts-design.md docs/superpowers/plans/2026-06-15-variant-low-stock-alerts.md`

Expected: diff is limited to variant low-stock behavior and docs/tests.
