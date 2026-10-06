# Low Stock Done Snooze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm nút `Đã up Stock` cho cảnh báo low-stock trên Telegram channel để xóa message và không báo lại sản phẩm đó trong 24 giờ.

**Architecture:** Lưu trạng thái snooze riêng trên `products.low_stock_snoozed_until`, để không phá cơ chế once-per-episode bằng `last_low_stock_alert_at`. Low-stock query bỏ qua sản phẩm đang snooze; Telegram callback set snooze và xóa message hiện tại.

**Tech Stack:** Node.js CommonJS, better-sqlite3, Telegraf 4, Telegram inline keyboard, `node:test`.

---

## File Structure

- Create: `src/database/migrations/050_low_stock_snooze.js`
  - Thêm cột `products.low_stock_snoozed_until DATETIME` nếu chưa tồn tại.

- Modify: `src/services/lowStockQuery.js`
  - Loại sản phẩm có `low_stock_snoozed_until > CURRENT_TIMESTAMP`.

- Modify: `src/services/notificationService.js`
  - Thêm nút callback `✅ Đã up Stock` vào inline keyboard low-stock.

- Create: `src/bot/lowStockActions.js`
  - Register `bot.action(/^lowstock_done:(\d+)$/)` để set snooze 24h và xóa message.

- Modify: `src/bot/index.js`
  - Require low-stock action trước fallback callback handler.

- Create: `tests/services/lowStockSnooze.test.js`
  - Test query bỏ qua snooze và hết hạn snooze được báo lại.
  - Test keyboard có callback button.

- Create: `tests/bot/lowStockActions.test.js`
  - Test callback set snooze và xóa message.

## Task 1: DB Column And Low-Stock Query Snooze

**Files:**
- Create: `src/database/migrations/050_low_stock_snooze.js`
- Create: `tests/services/lowStockSnooze.test.js`
- Modify: `src/services/lowStockQuery.js`

- [ ] **Step 1: Write failing low-stock snooze query test**

Create `tests/services/lowStockSnooze.test.js`:

```js
const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

function ensureSnoozeColumn() {
  const has = db.prepare('PRAGMA table_info(products)').all()
    .some((col) => col.name === 'low_stock_snoozed_until');
  if (!has) db.exec('ALTER TABLE products ADD COLUMN low_stock_snoozed_until DATETIME');
}

function seedLowStockProduct(name = 'Snooze Low') {
  ensureSnoozeColumn();
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const cat = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(`snooze-cat-${suffix}`, `snooze-cat-${suffix}`);
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active, low_stock_threshold, last_low_stock_alert_at, low_stock_snoozed_until)
    VALUES (?, ?, ?, 1000, 1, 5, NULL, NULL)
  `).run(cat.lastInsertRowid, name, `snooze-product-${suffix}`);
  db.prepare("INSERT INTO stock (product_id, data, is_sold) VALUES (?, 'k', 0)").run(product.lastInsertRowid);
  db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_alert_threshold','5') ON CONFLICT(key) DO UPDATE SET value='5'").run();
  return { productId: product.lastInsertRowid, categoryId: cat.lastInsertRowid };
}

function cleanup(seed) {
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(seed.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(seed.categoryId);
}

function freshQuery() {
  delete require.cache[require.resolve('../../src/services/lowStockQuery')];
  return require('../../src/services/lowStockQuery');
}

test('effectiveLowStockProducts skips products snoozed for the next 24 hours', () => {
  const seed = seedLowStockProduct();
  try {
    db.prepare("UPDATE products SET low_stock_snoozed_until = datetime('now', '+24 hours') WHERE id = ?").run(seed.productId);
    const { effectiveLowStockProducts } = freshQuery();
    const rows = effectiveLowStockProducts();
    assert.strictEqual(rows.some((row) => row.id === seed.productId), false);
  } finally {
    cleanup(seed);
  }
});

test('effectiveLowStockProducts includes low stock products after snooze expires', () => {
  const seed = seedLowStockProduct();
  try {
    db.prepare("UPDATE products SET low_stock_snoozed_until = datetime('now', '-1 minute') WHERE id = ?").run(seed.productId);
    const { effectiveLowStockProducts } = freshQuery();
    const rows = effectiveLowStockProducts();
    assert.strictEqual(rows.some((row) => row.id === seed.productId), true);
  } finally {
    cleanup(seed);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/services/lowStockSnooze.test.js
```

Expected: first test FAILS because `effectiveLowStockProducts()` still includes snoozed products.

- [ ] **Step 3: Add migration**

Create `src/database/migrations/050_low_stock_snooze.js`:

```js
function hasColumn(db, table, column) {
  return db.pragma(`table_info(${table})`).some(c => c.name === column);
}

function up(db) {
  if (!hasColumn(db, 'products', 'low_stock_snoozed_until')) {
    db.exec(`ALTER TABLE products ADD COLUMN low_stock_snoozed_until DATETIME`);
  }
}

module.exports = { up };
```

- [ ] **Step 4: Update low stock query**

In `src/services/lowStockQuery.js`, include `p.low_stock_snoozed_until` in the inner SELECT and add this condition to the outer WHERE:

```sql
AND (low_stock_snoozed_until IS NULL OR low_stock_snoozed_until <= CURRENT_TIMESTAMP)
```

Update the JSDoc return shape to include `low_stock_snoozed_until`.

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
node --test tests/services/lowStockSnooze.test.js
```

Expected: PASS.

## Task 2: Low-Stock Message Keyboard Has Done Button

**Files:**
- Modify: `tests/services/lowStockSnooze.test.js`
- Modify: `src/services/notificationService.js`

- [ ] **Step 1: Add failing keyboard test**

Append to `tests/services/lowStockSnooze.test.js`:

```js
function makeFakeBot(sent) {
  return {
    telegram: {
      async sendMessage(chatId, message, opts) {
        sent.push({ chatId, message, opts });
      },
    },
  };
}

function loadNotificationService(fakeBot) {
  delete require.cache[require.resolve('../../src/services/adminNotifyService')];
  delete require.cache[require.resolve('../../src/services/notificationService')];
  delete require.cache[require.resolve('../../src/services/lowStockQuery')];
  const adminNotifyService = require('../../src/services/adminNotifyService');
  const { NotificationService } = require('../../src/services/notificationService');
  db.prepare("INSERT INTO settings (key, value) VALUES ('notify_admin_low_stock','true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_chat_id','') ON CONFLICT(key) DO UPDATE SET value=''").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_thread_id','') ON CONFLICT(key) DO UPDATE SET value=''").run();
  adminNotifyService.init(fakeBot);
  adminNotifyService.invalidateCache();
  return new NotificationService(fakeBot);
}

test('checkLowStock adds done stock callback button to Telegram alert', async () => {
  const seed = seedLowStockProduct('Button Low');
  const sent = [];
  const originalWebUrl = process.env.WEB_URL;
  process.env.WEB_URL = 'https://tenhatshop.taikhoantenhat.me';
  try {
    const svc = loadNotificationService(makeFakeBot(sent));
    await svc.checkLowStock();
    const alert = sent.find((item) => String(item.message || '').includes(`<code>${seed.productId}</code>`));
    assert.ok(alert, 'expected low-stock alert for seeded product');
    const keyboard = alert.opts.reply_markup.inline_keyboard.flat();
    assert.ok(keyboard.some((button) => button.text === `📥 Thêm kho cho #${seed.productId}` && button.url));
    assert.ok(keyboard.some((button) => button.text === '✅ Đã up Stock' && button.callback_data === `lowstock_done:${seed.productId}`));
  } finally {
    if (originalWebUrl === undefined) delete process.env.WEB_URL;
    else process.env.WEB_URL = originalWebUrl;
    cleanup(seed);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/services/lowStockSnooze.test.js
```

Expected: keyboard test FAILS because `callback_data` button does not exist.

- [ ] **Step 3: Add callback button**

In `src/services/notificationService.js`, in `checkLowStock()`, replace inline keyboard construction with a `buttons` array:

```js
const buttons = [];
if (stockUrl && isPublicUrl) {
  buttons.push({ text: `📥 Thêm kho cho #${p.id}`, url: stockUrl });
}
buttons.push({ text: '✅ Đã up Stock', callback_data: `lowstock_done:${p.id}` });
opts.reply_markup = { inline_keyboard: [buttons] };
```

Keep `stockUrlBlock` fallback behavior unchanged for non-public URL.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/services/lowStockSnooze.test.js
```

Expected: PASS.

## Task 3: Telegram Callback Snoozes And Deletes Message

**Files:**
- Create: `tests/bot/lowStockActions.test.js`
- Create: `src/bot/lowStockActions.js`
- Modify: `src/bot/index.js`

- [ ] **Step 1: Write failing callback handler test**

Create `tests/bot/lowStockActions.test.js`:

```js
const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

function ensureSnoozeColumn() {
  const has = db.prepare('PRAGMA table_info(products)').all()
    .some((col) => col.name === 'low_stock_snoozed_until');
  if (!has) db.exec('ALTER TABLE products ADD COLUMN low_stock_snoozed_until DATETIME');
}

function seedProduct() {
  ensureSnoozeColumn();
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const cat = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(`action-cat-${suffix}`, `action-cat-${suffix}`);
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active, low_stock_threshold, low_stock_snoozed_until)
    VALUES (?, 'Action Low', ?, 1000, 1, 5, NULL)
  `).run(cat.lastInsertRowid, `action-product-${suffix}`);
  return { productId: product.lastInsertRowid, categoryId: cat.lastInsertRowid };
}

function cleanup(seed) {
  db.prepare('DELETE FROM products WHERE id = ?').run(seed.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(seed.categoryId);
}

test('low stock done callback snoozes product for 24h and deletes message', async () => {
  const seed = seedProduct();
  const actions = [];
  const fakeBot = {
    action(pattern, handler) {
      actions.push({ pattern, handler });
    },
  };
  try {
    require('../../src/bot/lowStockActions')(fakeBot);
    const registered = actions.find((item) => item.pattern.test(`lowstock_done:${seed.productId}`));
    assert.ok(registered, 'expected lowstock_done action registration');

    let answered = null;
    let deleted = false;
    const ctx = {
      match: [`lowstock_done:${seed.productId}`, String(seed.productId)],
      answerCbQuery: async (message) => { answered = message; },
      deleteMessage: async () => { deleted = true; },
    };

    await registered.handler(ctx);

    const row = db.prepare('SELECT low_stock_snoozed_until FROM products WHERE id = ?').get(seed.productId);
    assert.ok(row.low_stock_snoozed_until, 'expected snooze timestamp');
    assert.ok(new Date(`${row.low_stock_snoozed_until}Z`).getTime() > Date.now() + 23 * 60 * 60 * 1000);
    assert.strictEqual(deleted, true);
    assert.strictEqual(answered, 'Đã ẩn cảnh báo tồn kho 24h');
  } finally {
    cleanup(seed);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/bot/lowStockActions.test.js
```

Expected: FAIL because `src/bot/lowStockActions.js` does not exist.

- [ ] **Step 3: Implement low-stock callback**

Create `src/bot/lowStockActions.js`:

```js
const db = require('../database');

module.exports = (bot) => {
  bot.action(/^lowstock_done:(\d+)$/, async (ctx) => {
    const productId = Number(ctx.match?.[1]);
    if (Number.isInteger(productId) && productId > 0) {
      db.prepare(`
        UPDATE products
        SET low_stock_snoozed_until = datetime('now', '+24 hours')
        WHERE id = ?
      `).run(productId);
    }

    try {
      await ctx.deleteMessage();
    } catch (err) {
      console.error('lowStockActions deleteMessage failed:', err.message || err);
    }

    try {
      await ctx.answerCbQuery('Đã ẩn cảnh báo tồn kho 24h');
    } catch {}
  });
};
```

- [ ] **Step 4: Register handler before fallback**

In `src/bot/index.js`, add before `require('./fallback')(bot);`:

```js
  require('./lowStockActions')(bot);
```

- [ ] **Step 5: Run callback test**

Run:

```bash
node --test tests/bot/lowStockActions.test.js
```

Expected: PASS.

## Task 4: Final Verification

**Files:**
- Verify backend tests and import smoke.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test --test-concurrency=1 tests/services/lowStockSnooze.test.js tests/bot/lowStockActions.test.js tests/services/lowStockOncePerEpisode.test.js tests/services/lowStockDedup.test.js tests/services/lowStockRouting.test.js tests/services/lowStockThreshold.test.js
```

Expected: all tests pass.

- [ ] **Step 2: Run import smoke**

Run:

```bash
node -e "require('./src/database/migrations/050_low_stock_snooze'); require('./src/services/lowStockQuery'); require('./src/services/notificationService'); require('./src/bot/lowStockActions'); require('./src/bot'); console.log('imports ok')"
```

Expected: prints `imports ok`.

- [ ] **Step 3: Scan callback and notify wiring**

Run:

```bash
rg -n "lowstock_done|low_stock_snoozed_until|Đã up Stock" src tests
```

Expected: matches only migration, query, notification keyboard, bot action, and tests.
