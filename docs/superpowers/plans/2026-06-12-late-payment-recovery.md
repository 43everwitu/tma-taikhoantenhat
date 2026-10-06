# Late Payment Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Don het han nhung khach da chuyen dung tien va dung memo trong 24 gio van duoc xu ly nhu thanh toan dung han.

**Architecture:** `orderService` cung cap lookup rieng cho expired order con trong cua so recovery. `PaymentPoller` dung lai `_processOrderMatch()` cho late payment, ke ca transaction da bi log `matched` trong khi order van `expired`. Poller khong tu ngu khi con expired order recoverable.

**Tech Stack:** Node.js, better-sqlite3, node:test, Express/Telegram bot service code hien co.

---

### Task 1: Test Late Payment Recovery

**Files:**
- Create: `tests/services/paymentPollerLateRecovery.test.js`

- [ ] **Step 1: Write failing tests**

Them fixture tao user, category, product, expired order va transaction bank. Test 1 tao transaction da `matched`, order van `expired`, stub `_fetchTransactions()` tra ve transaction do, goi `_poll()`, ky vong order thanh `paid`. Test 2 tao only recently expired order, `_fetchTransactions()` tra rong, `poller.running = true`, goi `_poll()`, ky vong poller van running.

- [ ] **Step 2: Verify red**

Run: `node --test tests/services/paymentPollerLateRecovery.test.js`

Expected: FAIL. Test 1 fail vi matched transaction bi skip. Test 2 fail vi poller stop khi khong con pending/topup.

### Task 2: Implement Recovery Helpers

**Files:**
- Modify: `src/services/orderService.js`
- Modify: `src/services/paymentPoller.js`
- Modify: `src/index.js`

- [ ] **Step 1: Add order lookup**

Trong `orderService`, them `getRecoverableExpiredByPaymentCode(paymentCode, hoursBack = 24)` tra ve order `expired`, dung `payment_code`, `expires_at > datetime('now', -hoursBack hours)`.

- [ ] **Step 2: Recover matched expired transaction**

Trong `PaymentPoller`, truoc khi skip transaction da `matched`, parse memo. Neu memo la order code va order expired con recoverable, goi `_processOrderMatch(tx, paymentCode, order)`.

- [ ] **Step 3: Route orphan expired order through normal match**

Trong `_handleOrphanedOrderTx()`, neu lookup thay order recoverable expired thi return `_processOrderMatch(tx, paymentCode, order)` thay vi chi log matched va bao admin.

- [ ] **Step 4: Keep poller awake for recovery window**

Cuoi `_poll()`, tinh remaining bang pending orders + pending topups + recently expired orders. Startup trong `src/index.js` cung khoi dong poller neu co pending hoac recently expired.

### Task 3: Verify and Recover PNS100443

**Files:**
- No code file required.

- [ ] **Step 1: Run tests**

Run:
`node --test tests/services/paymentPollerLateRecovery.test.js tests/services/orderRecovery.test.js`

Expected: PASS.

- [ ] **Step 2: Check current failed order**

Run:
`sqlite3 data/shop.db "select id,status,total_price,payment_code from orders where id=100443; select mb_transaction_number,amount,matched_order_id,matched_payment_code,match_status from transactions where mb_transaction_number='FT26163117643460';"`

Expected before recovery: order may still be `expired`, transaction is `matched`.

- [ ] **Step 3: Run controlled local recovery**

Use `PaymentPoller._recoverMatchedExpiredOrderTx()` with transaction `FT26163117643460`. Expected: order `100443` changes from `expired` to the normal post-payment status for its product type.
