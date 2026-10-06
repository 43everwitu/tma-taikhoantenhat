# Stock Variant Announcement Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make stock replenishment notifications variant-aware and add Telegram-only images to admin announcements.

**Architecture:** Keep the existing notification service as the single dispatch boundary. Stock routes pass the existing `variantId` into `notifyStockReplenished`, while announcements add an optional `imageUrl` stored on the announcement row and used only by Telegram send paths.

**Tech Stack:** Node.js 22, Express, better-sqlite3 migrations, Zod validation, Telegram Telegraf API, Next 16 App Router, React Query.

---

## Files

- Modify: `src/services/notificationService.js` - stock replenished rendering, Telegram photo send support, announcement image URL resolution.
- Modify: `src/api/routes/admin/stock.js` - pass `variantId` into notification calls.
- Modify: `src/api/routes/admin/announcements.js` - accept, save, update, resend, and shape `imageUrl`.
- Create: `src/database/migrations/048_announcement_image_url.js` - add `announcements.image_url`.
- Modify: `src/database/seeds/message-templates.json` - add `productPrice` to stock replenished templates.
- Create or modify migration: `src/database/migrations/049_stock_replenished_price_template.js` - update existing DB templates to include `productPrice`.
- Modify: `web/src/app/(admin)/admin/announcements/page.tsx` - add image URL state, Media Library picker, payload, display.
- Test: `tests/services/stockReplenishedVariantNotification.test.js`.
- Test: `tests/services/announcementImageBroadcast.test.js`.
- Test: `tests/api/admin-announcements-image.test.js`.

## Task 1: Stock Notification Tests

- [ ] **Step 1: Write failing stock notification tests**

Create `tests/services/stockReplenishedVariantNotification.test.js`:

```js
const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const NotificationService = require('../../src/services/notificationService');

function createBot() {
  const sent = [];
  return {
    sent,
    botInfo: { username: 'test_shop_bot' },
    telegram: {
      async sendMessage(chatId, body, extra) {
        sent.push({ chatId, body, extra });
      },
    },
  };
}

function seedProduct() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userTg = 990_000_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)').run(userTg, `stock_user_${suffix}`, 'Stock User');
  const category = db.prepare('INSERT INTO categories (name, slug, emoji) VALUES (?, ?, ?)').run(`STOCK_CAT_${suffix}`, `stock-cat-${suffix}`, 'T');
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, emoji, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(category.lastInsertRowid, 'Tài khoản ChatGPT Plus', `chatgpt-plus-${suffix}`, 111000, '🔔');
  const variant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active)
    VALUES (?, ?, ?, 1)
  `).run(product.lastInsertRowid, 'Dùng chung 01 tháng', 222000);
  return { userTg, categoryId: category.lastInsertRowid, productId: product.lastInsertRowid, variantId: variant.lastInsertRowid };
}

function cleanup(seed) {
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(seed.userTg);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(seed.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(seed.categoryId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(seed.userTg);
}

test('notifyStockReplenished renders variant name, variant price, and variant stock count', async (t) => {
  const seed = seedProduct();
  t.after(() => cleanup(seed));
  db.prepare('INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (?, ?, ?, 0)').run(seed.productId, seed.variantId, 'key-1');
  db.prepare('INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (?, ?, ?, 0)').run(seed.productId, seed.variantId, 'key-2');
  db.prepare('INSERT INTO stock (product_id, data, is_sold) VALUES (?, ?, 0)').run(seed.productId, 'legacy-key');

  const bot = createBot();
  const service = new NotificationService(bot);
  const result = await service.notifyStockReplenished(seed.productId, seed.variantId);

  assert.strictEqual(result.sent, 1);
  assert.match(bot.sent[0].body, /Tài khoản ChatGPT Plus - Dùng chung 01 tháng/);
  assert.match(bot.sent[0].body, /222\.000đ/);
  assert.match(bot.sent[0].body, /Số lượng trong kho:\s*<b>2<\/b>/);
});

test('notifyStockReplenished without variant uses product price and legacy stock count', async (t) => {
  const seed = seedProduct();
  t.after(() => cleanup(seed));
  db.prepare('INSERT INTO stock (product_id, data, is_sold) VALUES (?, ?, 0)').run(seed.productId, 'legacy-key-1');
  db.prepare('INSERT INTO stock (product_id, data, is_sold) VALUES (?, ?, 0)').run(seed.productId, 'legacy-key-2');
  db.prepare('INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (?, ?, ?, 0)').run(seed.productId, seed.variantId, 'variant-key');

  const bot = createBot();
  const service = new NotificationService(bot);
  const result = await service.notifyStockReplenished(seed.productId);

  assert.strictEqual(result.sent, 1);
  assert.match(bot.sent[0].body, /Tài khoản ChatGPT Plus/);
  assert.doesNotMatch(bot.sent[0].body, /Dùng chung 01 tháng/);
  assert.match(bot.sent[0].body, /111\.000đ/);
  assert.match(bot.sent[0].body, /Số lượng trong kho:\s*<b>2<\/b>/);
});
```

- [ ] **Step 2: Run failing stock tests**

Run:

```bash
node --test tests/services/stockReplenishedVariantNotification.test.js
```

Expected: FAIL because `notifyStockReplenished` ignores `variantId` and templates do not include price.

## Task 2: Implement Variant-Aware Stock Notifications

- [ ] **Step 1: Update `notifyStockReplenished`**

In `src/services/notificationService.js`, change the signature to:

```js
async notifyStockReplenished(productId, variantId = null) {
```

Add variant lookup:

```js
const variant = variantId == null ? null : db.prepare(`
  SELECT id, name, price
  FROM product_variants
  WHERE id = ? AND product_id = ?
`).get(variantId, productId);
```

Resolve stock count:

```js
const stockCount = variant
  ? db.prepare('SELECT COUNT(*) as c FROM stock WHERE product_id = ? AND variant_id = ? AND is_sold = 0').get(productId, variant.id).c
  : db.prepare('SELECT COUNT(*) as c FROM stock WHERE product_id = ? AND variant_id IS NULL AND is_sold = 0').get(productId).c;
```

Resolve vars:

```js
const displayName = variant ? `${product.name} - ${variant.name}` : product.name;
const displayPrice = variant?.price ?? product.price;
const vars = {
  productEmoji: product.emoji || '📦',
  productName: displayName,
  productPrice: this.formatVnd(displayPrice),
  stockCount,
};
```

- [ ] **Step 2: Pass `variantId` from stock route**

In `src/api/routes/admin/stock.js`, update both notification calls:

```js
notifyResult = await poller.notifyStockReplenished(productId, req.validated.variantId ?? null);
```

The manual `POST /:productId/notify-followers` route has no selected variant, so leave it as `notifyStockReplenished(productId)`.

- [ ] **Step 3: Update stock replenished templates**

In `src/database/seeds/message-templates.json`, change `bot.stock_replenished.variables` to include `productPrice`, and change body to:

```json
"body": "🔔 <b>{{productName}} đã có hàng!</b>\nGiá: <b>{{productPrice}}</b>\nSố lượng trong kho: <b>{{stockCount}}</b>"
```

Change `web.stock_replenished.variables` to include `productPrice`, and body to:

```json
"body": "{{productEmoji}} {{productName}} đã có hàng trở lại. Giá: {{productPrice}}. Còn {{stockCount}} sản phẩm."
```

Create `src/database/migrations/049_stock_replenished_price_template.js`:

```js
function up(db) {
  const updates = [
    [
      'bot.stock_replenished',
      ['productEmoji', 'productName', 'productPrice', 'stockCount'],
      '🔔 <b>{{productName}} đã có hàng!</b>\nGiá: <b>{{productPrice}}</b>\nSố lượng trong kho: <b>{{stockCount}}</b>',
    ],
    [
      'web.stock_replenished',
      ['productEmoji', 'productName', 'productPrice', 'stockCount'],
      '{{productEmoji}} {{productName}} đã có hàng trở lại. Giá: {{productPrice}}. Còn {{stockCount}} sản phẩm.',
    ],
  ];

  const stmt = db.prepare(`
    UPDATE message_templates
    SET variables = ?, body = ?, default_body = ?, updated_at = CURRENT_TIMESTAMP
    WHERE key = ?
  `);
  for (const [key, variables, body] of updates) {
    stmt.run(JSON.stringify(variables), body, body, key);
  }
}

module.exports = { up };
```

- [ ] **Step 4: Run stock tests**

Run:

```bash
node --test tests/services/stockReplenishedVariantNotification.test.js
```

Expected: PASS.

## Task 3: Announcement Image Backend Tests

- [ ] **Step 1: Write service test for Telegram image broadcast**

Create `tests/services/announcementImageBroadcast.test.js`:

```js
const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const NotificationService = require('../../src/services/notificationService');

function createBot() {
  const calls = [];
  return {
    calls,
    telegram: {
      async sendMessage(chatId, body, extra) {
        calls.push({ kind: 'message', chatId, body, extra });
      },
      async sendPhoto(chatId, photo, extra) {
        calls.push({ kind: 'photo', chatId, photo, extra });
      },
    },
  };
}

test('broadcast with image sends Telegram photo and text-only web notification', async (t) => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userTg = 991_000_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)').run(userTg, `ann_user_${suffix}`, 'Ann User');
  t.after(() => {
    db.prepare('DELETE FROM announcements WHERE title = ?').run(`Ảnh ${suffix}`);
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userTg);
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(userTg);
  });

  const bot = createBot();
  const service = new NotificationService(bot);
  const result = await service.broadcast(`Ảnh ${suffix}`, '<b>Nội dung</b>', 'all', 1, undefined, {
    imageUrl: 'https://example.com/announcement.png',
  });

  assert.strictEqual(result.sent, 1);
  assert.strictEqual(bot.calls[0].kind, 'photo');
  assert.strictEqual(bot.calls[0].photo, 'https://example.com/announcement.png');
  assert.strictEqual(bot.calls[0].extra.caption, '<b>Nội dung</b>');

  const notification = db.prepare('SELECT body FROM notifications WHERE user_id = ? ORDER BY id DESC').get(userTg);
  assert.strictEqual(notification.body, '<b>Nội dung</b>');

  const announcement = db.prepare('SELECT image_url FROM announcements WHERE id = ?').get(result.announcementId);
  assert.strictEqual(announcement.image_url, 'https://example.com/announcement.png');
});
```

- [ ] **Step 2: Write API test for announcement image shape**

Create `tests/api/admin-announcements-image.test.js` using direct route execution like `tests/api/admin-products-low-stock-threshold.test.js`. Test that `POST /admin/announcements` accepts `imageUrl`, stores it, and `GET /admin/announcements` returns `imageUrl`.

- [ ] **Step 3: Run failing announcement tests**

Run:

```bash
node --test tests/services/announcementImageBroadcast.test.js tests/api/admin-announcements-image.test.js
```

Expected: FAIL because `image_url` column and image broadcast support do not exist yet.

## Task 4: Implement Announcement Image Backend

- [ ] **Step 1: Add migration**

Create `src/database/migrations/048_announcement_image_url.js`:

```js
function hasColumn(db, table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r => r.name === col);
}

function up(db) {
  if (!hasColumn(db, 'announcements', 'image_url')) {
    db.exec('ALTER TABLE announcements ADD COLUMN image_url TEXT');
  }
}

module.exports = { up };
```

- [ ] **Step 2: Update notification broadcast**

In `src/services/notificationService.js`:

Add helpers:

```js
  _telegramImageUrl(imageUrl) {
    const raw = String(imageUrl || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    const base = (config.WEB_URL || '').replace(/\/$/, '');
    if (!base || !raw.startsWith('/')) return '';
    return `${base}${raw}`;
  }
```

Change broadcast signature:

```js
async broadcast(title, body, target = 'all', adminId = null, webBody = undefined, options = {}) {
```

Save image:

```js
const imageUrl = options.imageUrl ? String(options.imageUrl).trim() : null;
const result = db.prepare(`
  INSERT INTO announcements (title, body, admin_id, target, image_url)
  VALUES (?, ?, ?, ?, ?)
`).run(title, body || effectiveWeb || '', adminId || 0, target, imageUrl);
```

Telegram send branch:

```js
const telegramImageUrl = this._telegramImageUrl(imageUrl);
if (telegramImageUrl) {
  await this.bot.telegram.sendPhoto(user.telegram_id, telegramImageUrl, { caption: body, parse_mode: 'HTML' });
} else {
  await this.bot.telegram.sendMessage(user.telegram_id, body, { parse_mode: 'HTML' });
}
```

- [ ] **Step 3: Update announcements route**

In `src/api/routes/admin/announcements.js`:

Shape:

```js
imageUrl: r.image_url || '',
```

POST schema:

```js
imageUrl: z.string().max(500).nullable().optional(),
```

Broadcast call:

```js
const imageUrl = d.imageUrl ? d.imageUrl.trim() : null;
const result = await notificationService.broadcast(d.title, cleanBody, d.target, req.admin.adminId, undefined, { imageUrl });
```

PATCH schema and update:

```js
imageUrl: z.string().max(500).nullable().optional(),
```

```js
if (req.validated.imageUrl !== undefined) {
  sets.push('image_url = ?');
  params.push(req.validated.imageUrl ? req.validated.imageUrl.trim() : null);
}
```

Resend:

```js
const result = await notificationService.broadcast(row.title, row.body, row.target || 'all', req.admin.adminId, undefined, {
  imageUrl: row.image_url || null,
});
```

- [ ] **Step 4: Run announcement backend tests**

Run:

```bash
node --test --test-concurrency=1 tests/services/announcementImageBroadcast.test.js tests/api/admin-announcements-image.test.js
```

Expected: PASS.

## Task 5: Admin Announcement UI

- [ ] **Step 1: Update UI state and payload**

In `web/src/app/(admin)/admin/announcements/page.tsx`:

- Import `MediaLibrary`.
- Add `imageUrl`, `mediaOpen`, `editImageUrl`, `editMediaOpen`.
- Include `imageUrl` in `Announcement`.
- Send `imageUrl: imageUrl || null` in create payload.
- Send `imageUrl: editImageUrl || null` in edit payload.

- [ ] **Step 2: Add create form controls**

Add a field after body:

```tsx
<div>
  <label className="block text-sm font-medium text-clay-charcoal mb-1">Ảnh Telegram</label>
  <div className="flex gap-2">
    <input
      type="text"
      value={imageUrl}
      onChange={(e) => setImageUrl(e.target.value)}
      className="clay-input flex-1"
      placeholder="https://... hoặc /uploads/..."
    />
    <button type="button" onClick={() => setMediaOpen(true)} className="clay-btn text-sm">Chọn ảnh</button>
  </div>
  <p className="text-xs text-clay-silver mt-1">Ảnh chỉ gửi qua Telegram bot, Mini App vẫn hiển thị text.</p>
</div>
```

Render `MediaLibrary` when open.

- [ ] **Step 3: Add edit controls and list display**

In `openEdit`, set `editImageUrl`.

Add same image input in edit modal/form.

In list title/body area, show a small `Ảnh Telegram` pill when `ann.imageUrl` exists.

- [ ] **Step 4: Run UI checks**

Run:

```bash
cd web && npx tsc --noEmit --pretty false
cd web && npx eslint 'src/app/(admin)/admin/announcements/page.tsx'
```

Expected: TypeScript passes. ESLint has no errors in this file.

## Task 6: Final Verification

- [ ] **Step 1: Run backend focused tests**

Run:

```bash
node --test --test-concurrency=1 tests/services/stockReplenishedVariantNotification.test.js tests/services/announcementImageBroadcast.test.js tests/api/admin-announcements-image.test.js
```

Expected: PASS.

- [ ] **Step 2: Run existing related tests**

Run:

```bash
node --test --test-concurrency=1 tests/services/lowStockThreshold.test.js tests/api/admin-products-low-stock-threshold.test.js
```

Expected: PASS.

- [ ] **Step 3: Run web build**

Run:

```bash
cd web && npm run build
```

Expected: PASS. If sandbox blocks Google Fonts, rerun with network approval.
