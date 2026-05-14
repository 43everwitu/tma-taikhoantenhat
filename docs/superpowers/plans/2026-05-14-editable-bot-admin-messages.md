# Editable bot/admin/group messages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move 11 currently-hardcoded user/admin/group strings into the existing `message_templates` table so admins can edit them at `/admin/messages` without redeploys.

**Architecture:** Reuse the existing `message_templates` table + `messageTemplateService` + `/admin/messages` admin route/page. Add new rows for `admin` and `group` channels via a single migration + seed entries. Refactor each hardcoded `bot.telegram.sendMessage` / `adminNotifyService.notify` call site to render through `messageTemplateService.render(key, vars)`. Extend `TRUSTED_VARS` for spoiler/mention HTML that callers pre-format. Route the new channels through `toTelegramHtml` in the admin save handler. Surface the two new channels in the admin UI tab list.

**Tech Stack:** Node 20 · better-sqlite3 · Telegraf · sanitize-html (via `toTelegramHtml`) · Next 16 App Router (admin UI). No test framework wired — verification via the existing `POST /admin/messages/:key/preview` endpoint, boot smoke (API start), and a render assertion script run with `node -e`.

**Spec:** `docs/superpowers/specs/2026-05-14-editable-bot-admin-messages-design.md`

**Tag on ship:** `v0.27-editable-messages`

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/database/migrations/025_admin_group_templates.js` | Create | Insert 11 new template rows; idempotent via `ON CONFLICT(key) DO NOTHING`. |
| `src/database/seeds/message-templates.json` | Modify | Append 11 entries (admin × 5, group × 1, bot × 5) so fresh installs get them via migration 012. |
| `src/services/messageTemplateService.js` | Modify | Add `userMention`, `userSpoiler`, `totalSpoiler` to `TRUSTED_VARS`. |
| `src/api/routes/admin/messages.js` | Modify | Sanitise all channels except `web` through `toTelegramHtml`. |
| `src/services/notificationService.js` | Modify | `notifyOrderExpired`, `notifyOrderCancelled`, `notifyStockReplenished`, `checkLowStock` render via templates. |
| `src/services/orderChannelService.js` | Modify | `buildCard()` renders `group.order_card` template. |
| `src/services/keyExpiryReminderService.js` | Modify | `sweep()` renders `bot.expiry_reminder` template. |
| `src/services/orderFulfillmentService.js` | Modify | Replace inline `backorder_paid` body with template render. |
| `src/services/paymentPoller.js` | Modify | 7 call sites (5× `admin.payment_short`, 1× `admin.backorder_paid`, 1× `admin.delivered`, 1× `admin.no_stock`, 1× `bot.backorder_wait`). |
| `web/src/app/(admin)/admin/messages/page.tsx` | Modify | Extend tab list from `['bot','web']` → `['bot','admin','group','web']`. |
| `scripts/verify-message-templates.js` | Create | One-shot render test: iterate every key in seed JSON, run `messageTemplateService.render` with sample vars, fail loudly on missing key or unsubstituted `{{var}}`. |

---

## Task 1: Add seed entries for 11 new templates

**Files:**
- Modify: `src/database/seeds/message-templates.json`

This task only touches the seed file. Migration 025 (Task 2) and the service change (Task 3) come next. The seed is the source-of-truth; migration 025 reads from this file too.

- [ ] **Step 1: Add `admin.backorder_paid`**

Open `src/database/seeds/message-templates.json`. Append before the closing `}`:

```json
,
  "admin.backorder_paid": {
    "channel": "admin",
    "label": "Admin — đơn backorder đã thanh toán",
    "variables": ["orderCode", "productName", "quantity", "total", "userMention", "inputBlock"],
    "body": "🛎 Đơn đặt trước cần xử lý: #{{orderCode}}\n📦 {{productName}} (×{{quantity}})\n💰 {{total}}đ\nKH: {{userMention}}{{inputBlock}}\n→ /admin/orders để giao thủ công."
  }
```

- [ ] **Step 2: Add `admin.delivered`**

```json
,
  "admin.delivered": {
    "channel": "admin",
    "label": "Admin — đã tự động giao hàng",
    "variables": ["orderCode", "productName", "quantity", "userMention", "overpayBlock"],
    "body": "✅ Tự động giao hàng đơn #{{orderCode}}\nKH: {{userMention}}\nSP: {{productName}}\nSL: {{quantity}}{{overpayBlock}}"
  }
```

- [ ] **Step 3: Add `admin.no_stock`**

```json
,
  "admin.no_stock": {
    "channel": "admin",
    "label": "Admin — đã thanh toán nhưng hết hàng",
    "variables": ["orderCode", "productName", "quantity", "userMention"],
    "body": "💳 Đã nhận thanh toán đơn #{{orderCode}} nhưng hết hàng!\nKH: {{userMention}}\nSP: {{productName}}\nSL: {{quantity}}\nCần giao thủ công."
  }
```

- [ ] **Step 4: Add `admin.payment_short`**

```json
,
  "admin.payment_short": {
    "channel": "admin",
    "label": "Admin — thanh toán thiếu / lệch",
    "variables": ["orderCode", "total", "received", "memo", "userMention", "note"],
    "body": "⚠️ Thanh toán thiếu cho đơn #{{orderCode}}\nKH: {{userMention}}\nMã: {{memo}}\nChuyển: {{received}}đ\nCần: {{total}}đ\n\n<i>{{note}}</i>"
  }
```

- [ ] **Step 5: Add `admin.low_stock`**

```json
,
  "admin.low_stock": {
    "channel": "admin",
    "label": "Admin — sản phẩm sắp hết kho",
    "variables": ["productEmoji", "productName", "productId", "stockCount", "threshold", "stockUrlBlock"],
    "body": "⚠️ <b>Tồn kho thấp</b>\n\n{{productEmoji}} <b>{{productName}}</b>\n🆔 ID: <code>{{productId}}</code>\n📦 Còn lại: <b>{{stockCount}}</b> / ngưỡng {{threshold}}{{stockUrlBlock}}"
  }
```

- [ ] **Step 6: Add `group.order_card`**

```json
,
  "group.order_card": {
    "channel": "group",
    "label": "Kênh đơn hàng — thẻ đơn",
    "variables": ["orderCode", "paymentCode", "productLine", "quantity", "totalSpoiler", "customerLine", "keysBlock"],
    "body": "📥 <b>Order #{{orderCode}} Notification</b>\n─────────────\n💰 <b>Thanh toán</b>: {{totalSpoiler}}\n🧾 <b>Mã đơn</b>: <code>{{paymentCode}}</code>{{customerLine}}\n📦 <b>Sản phẩm</b>: {{productLine}} ×{{quantity}}\n─────────────\n{{keysBlock}}"
  }
```

- [ ] **Step 7: Add `bot.expiry_reminder`**

```json
,
  "bot.expiry_reminder": {
    "channel": "bot",
    "label": "Bot — nhắc key sắp hết hạn",
    "variables": ["orderRef", "productName", "expiryDate", "supportContact"],
    "body": "⏰ <b>Đơn {{orderRef}}</b> sắp hết hạn.\n📦 {{productName}}\n📅 Hết hạn: <b>{{expiryDate}}</b>\n\nGia hạn vui lòng liên hệ {{supportContact}}."
  }
```

- [ ] **Step 8: Add `bot.backorder_wait`**

```json
,
  "bot.backorder_wait": {
    "channel": "bot",
    "label": "Bot — chờ giao thủ công (backorder)",
    "variables": ["orderCode", "waitMsg"],
    "body": "💳 Đã nhận thanh toán đơn #{{orderCode}}.\n{{waitMsg}}"
  }
```

- [ ] **Step 9: Add `bot.order_expired_short`, `bot.order_cancelled_short`, `bot.stock_replenished`**

```json
,
  "bot.order_expired_short": {
    "channel": "bot",
    "label": "Bot — đơn hết hạn (rút gọn)",
    "variables": ["orderCode"],
    "body": "⏰ Đơn #{{orderCode}} hết hạn thanh toán.\nGõ /menu để đặt lại."
  },
  "bot.order_cancelled_short": {
    "channel": "bot",
    "label": "Bot — đơn bị huỷ (rút gọn)",
    "variables": ["orderCode"],
    "body": "❌ Đơn #{{orderCode}} đã bị hủy.\nLiên hệ hỗ trợ nếu cần."
  },
  "bot.stock_replenished": {
    "channel": "bot",
    "label": "Bot — báo có hàng lại (followers)",
    "variables": ["productEmoji", "productName", "stockCount"],
    "body": "🔔 <b>{{productEmoji}} {{productName}}</b> đã có hàng!\nCòn {{stockCount}} sản phẩm. Mua ngay: /menu"
  }
```

- [ ] **Step 10: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/database/seeds/message-templates.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 11: Commit**

```bash
git add src/database/seeds/message-templates.json
git commit -m "feat(templates): seed 11 admin/group/bot template entries"
```

---

## Task 2: Migration 025 — insert new template rows on existing DBs

**Files:**
- Create: `src/database/migrations/025_admin_group_templates.js`

- [ ] **Step 1: Write the migration**

```js
// 025_admin_group_templates.js
// Adds 11 admin/group/bot template rows from seeds/message-templates.json.
// Idempotent: ON CONFLICT(key) DO NOTHING — existing rows are untouched so a
// re-run after an admin edits a body won't clobber their changes.

const fs = require('fs');
const path = require('path');

const KEYS = [
  'admin.backorder_paid',
  'admin.delivered',
  'admin.no_stock',
  'admin.payment_short',
  'admin.low_stock',
  'group.order_card',
  'bot.expiry_reminder',
  'bot.backorder_wait',
  'bot.order_expired_short',
  'bot.order_cancelled_short',
  'bot.stock_replenished',
];

function up(db) {
  const seedPath = path.join(__dirname, '..', 'seeds', 'message-templates.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const insert = db.prepare(`
    INSERT INTO message_templates (key, channel, label, variables, body, default_body)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO NOTHING
  `);
  for (const key of KEYS) {
    const t = seed[key];
    if (!t) throw new Error(`migration 025: missing seed entry for ${key}`);
    insert.run(key, t.channel, t.label, JSON.stringify(t.variables), t.body, t.body);
  }
}

module.exports = { up };
```

- [ ] **Step 2: Run migrations against dev DB to verify**

Run: `node -e "const db=require('./src/database'); console.log(db.prepare(\"SELECT key,channel FROM message_templates WHERE channel IN ('admin','group') OR key LIKE 'bot.%' ORDER BY key\").all())"`
Expected: list including all 11 new keys with correct channels (`admin`, `group`, `bot`).

- [ ] **Step 3: Idempotency check — run migration runner again**

Run: `node -e "const db=require('./src/database'); require('./src/database/migrations/025_admin_group_templates').up(db); console.log('rerun ok'); console.log('count:', db.prepare(\"SELECT COUNT(*) as c FROM message_templates\").get())"`
Expected: `rerun ok` and same row count as after first run (no duplicates).

- [ ] **Step 4: Commit**

```bash
git add src/database/migrations/025_admin_group_templates.js
git commit -m "feat(templates): migration 025 — insert admin/group/bot rows"
```

---

## Task 3: Trust spoiler/mention HTML in renderer

**Files:**
- Modify: `src/services/messageTemplateService.js:11`

- [ ] **Step 1: Extend TRUSTED_VARS**

Replace the existing `TRUSTED_VARS` declaration:

```js
// Variables whose values are already HTML-safe — pre-formatted by callers.
// Everything NOT in this set is escaped at substitution time.
const TRUSTED_VARS = new Set([
  'keysBlock',
  'usageInstructions',
  // Spoiler/mention HTML built by callers (orderChannelService, paymentPoller).
  'userMention',
  'userSpoiler',
  'totalSpoiler',
  // Pre-rendered sub-blocks (multi-line HTML stitched up by callers).
  'inputBlock',
  'overpayBlock',
  'stockUrlBlock',
  'customerLine',
  'productLine',
]);
```

- [ ] **Step 2: Smoke-test render still works**

Run: `node -e "const m=require('./src/services/messageTemplateService'); console.log(m.render('welcome', {name: 'A', username: 'x', supportContact: '@y'}))"`
Expected: prints the welcome body with `Xin chào A!`. No throw.

- [ ] **Step 3: Commit**

```bash
git add src/services/messageTemplateService.js
git commit -m "feat(templates): trust spoiler/mention/block vars in renderer"
```

---

## Task 4: Sanitise admin + group channels through toTelegramHtml

**Files:**
- Modify: `src/api/routes/admin/messages.js:31`

- [ ] **Step 1: Flip the channel branch**

Find:

```js
const sanitized = channel === 'bot' ? toTelegramHtml(req.body.body) : req.body.body;
```

Replace with:

```js
// admin and group bodies are also sent via bot.telegram.sendMessage with
// parse_mode: 'HTML' — they need the same Telegram-HTML allowlist as 'bot'.
// Only 'web' channel skips sanitisation here (passes through unchanged).
const sanitized = channel === 'web' ? req.body.body : toTelegramHtml(req.body.body);
```

- [ ] **Step 2: Verify with a preview call**

Boot API in another terminal (`npm run dev`). Then:

Run: `curl -s -X POST http://localhost:3000/api/v1/admin/messages/admin.delivered/preview -H 'Authorization: Bearer <admin-jwt>' -H 'Content-Type: application/json' -d '{"vars":{"orderCode":"123","productName":"Test","quantity":"1","userMention":"@x","overpayBlock":""}}'`
Expected: `{"success":true,"data":{"text":"✅ Tự động giao hàng đơn #123\nKH: @x\nSP: Test\nSL: 1"}}`.

If no admin JWT handy, skip the curl and rely on Task 11's render-all script instead.

- [ ] **Step 3: Commit**

```bash
git add src/api/routes/admin/messages.js
git commit -m "feat(templates): sanitise admin/group channels via toTelegramHtml"
```

---

## Task 5: Frontend — surface admin + group tabs

**Files:**
- Modify: `web/src/app/(admin)/admin/messages/page.tsx:70`

- [ ] **Step 1: Extend channel tab list**

Find:

```tsx
{(['bot', 'web'] as const).map((ch) => {
  const items = list.filter((t) => t.channel === ch)
```

Replace with:

```tsx
{(['bot', 'admin', 'group', 'web'] as const).map((ch) => {
  const items = list.filter((t) => t.channel === ch)
```

- [ ] **Step 2: Verify in browser**

With the API + web running, visit `http://localhost:3001/admin/messages` after admin login. Confirm four tabs render: bot, admin, group, web. Admin tab should list five rows (`admin.backorder_paid` … `admin.low_stock`). Group tab should list `group.order_card`.

If the UI uses a fixed-label tab list elsewhere in the file, search for the second `['bot','web']` occurrence and apply the same change.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/\(admin\)/admin/messages/page.tsx
git commit -m "feat(admin-ui): show admin + group tabs in /admin/messages"
```

---

## Task 6: Refactor notificationService.js call sites

**Files:**
- Modify: `src/services/notificationService.js:67-77` (`notifyOrderExpired`, `notifyOrderCancelled`)
- Modify: `src/services/notificationService.js:104-105` (`notifyStockReplenished`)
- Modify: `src/services/notificationService.js:151-179` (`checkLowStock`)

- [ ] **Step 1: Import the service at the top of the file**

After line 3 (`const adminNotifyService = require('./adminNotifyService');`) add:

```js
const messageTemplateService = require('./messageTemplateService');
```

- [ ] **Step 2: Replace `notifyOrderExpired`**

Find:

```js
async notifyOrderExpired(order) {
    const body = `⏰ Đơn #${order.id} hết hạn thanh toán.\n` +
      `Gõ /menu để đặt lại.`;
    return this.notify(order.user_id, 'order_update', 'Đơn hàng hết hạn', body,
      { order_id: order.id });
  }
```

Replace with:

```js
async notifyOrderExpired(order) {
    const body = messageTemplateService.render('bot.order_expired_short', {
      orderCode: order.id,
    });
    return this.notify(order.user_id, 'order_update', 'Đơn hàng hết hạn', body,
      { order_id: order.id });
  }
```

- [ ] **Step 3: Replace `notifyOrderCancelled`**

Find:

```js
async notifyOrderCancelled(order) {
    const body = `❌ Đơn #${order.id} đã bị hủy.\nLiên hệ hỗ trợ nếu cần.`;
    return this.notify(order.user_id, 'order_update', 'Đơn hàng bị hủy', body,
      { order_id: order.id });
  }
```

Replace with:

```js
async notifyOrderCancelled(order) {
    const body = messageTemplateService.render('bot.order_cancelled_short', {
      orderCode: order.id,
    });
    return this.notify(order.user_id, 'order_update', 'Đơn hàng bị hủy', body,
      { order_id: order.id });
  }
```

- [ ] **Step 4: Replace `notifyStockReplenished` body**

Find:

```js
const body = `🔔 <b>${product.emoji} ${product.name}</b> đã có hàng!\n` +
      `Còn ${stockCount} sản phẩm. Mua ngay: /menu`;
```

Replace with:

```js
const body = messageTemplateService.render('bot.stock_replenished', {
      productEmoji: product.emoji || '📦',
      productName: product.name,
      stockCount,
    });
```

- [ ] **Step 5: Replace `checkLowStock` admin body**

Find the block that builds `lines` (≈ lines 153–162) and the `adminNotifyService.notify` call. Replace the whole inline body construction with a template render. Keep the inline-button branch as-is — the template only fills the text.

Find:

```js
for (const p of lowStockProducts) {
      const stockUrl = rawUrl ? `${rawUrl}/admin/stock/${p.id}` : '';
      const lines = [
        `⚠️ <b>Tồn kho thấp</b>`,
        ``,
        `${p.emoji || '📦'} <b>${p.name}</b>`,
        `🆔 ID: <code>${p.id}</code>`,
        `📦 Còn lại: <b>${p.stock_count}</b> / ngưỡng ${p.low_stock_threshold}`,
      ];
      if (stockUrl && !isPublicUrl) {
        lines.push('', `🔗 <a href="${stockUrl}">Thêm kho qua dashboard</a>`);
      }

      const opts = { parse_mode: 'HTML' };
      if (stockUrl && isPublicUrl) {
        opts.reply_markup = {
          inline_keyboard: [[
            { text: `📥 Thêm kho cho #${p.id}`, url: stockUrl },
          ]],
        };
      }

      try {
        await adminNotifyService.notify('low_stock', lines.join('\n'), opts);
        updateAlert.run(p.id);
      } catch (err) {
        console.error(`❌ Low stock alert for product ${p.id}:`, err.message);
      }
    }
```

Replace with:

```js
for (const p of lowStockProducts) {
      const stockUrl = rawUrl ? `${rawUrl}/admin/stock/${p.id}` : '';
      // stockUrlBlock is trusted-as-HTML — empty when we'll use an inline
      // button (public URL) so the body stays clean.
      const stockUrlBlock = (stockUrl && !isPublicUrl)
        ? `\n\n🔗 <a href="${stockUrl}">Thêm kho qua dashboard</a>`
        : '';

      const body = messageTemplateService.render('admin.low_stock', {
        productEmoji: p.emoji || '📦',
        productName: p.name,
        productId: p.id,
        stockCount: p.stock_count,
        threshold: p.low_stock_threshold,
        stockUrlBlock,
      });

      const opts = { parse_mode: 'HTML' };
      if (stockUrl && isPublicUrl) {
        opts.reply_markup = {
          inline_keyboard: [[
            { text: `📥 Thêm kho cho #${p.id}`, url: stockUrl },
          ]],
        };
      }

      try {
        await adminNotifyService.notify('low_stock', body, opts);
        updateAlert.run(p.id);
      } catch (err) {
        console.error(`❌ Low stock alert for product ${p.id}:`, err.message);
      }
    }
```

- [ ] **Step 6: Boot smoke test**

Kill any running dev API (`lsof -ti :3000 | xargs kill -9 2>/dev/null; sleep 1`). Then:

Run: `node -e "require('./src/index.js')"` and wait ~3s, then Ctrl-C.
Expected: no `Unknown message template:` error in stderr; logs show normal startup.

- [ ] **Step 7: Commit**

```bash
git add src/services/notificationService.js
git commit -m "refactor(notifications): render bot/admin bodies via templates"
```

---

## Task 7: Refactor orderChannelService.js (group.order_card)

**Files:**
- Modify: `src/services/orderChannelService.js:31-52`

- [ ] **Step 1: Import the service**

Add at the top (after the existing imports / `let bot = null;`):

```js
const messageTemplateService = require('./messageTemplateService');
```

- [ ] **Step 2: Rewrite `buildCard`**

Replace the whole function (lines 31–52):

```js
function buildCard({ order, product, variant, keys, customerInfo }) {
  const totalSpoiler = `<tg-spoiler>${escapeHtml(order.total_price.toLocaleString('vi-VN') + 'đ')}</tg-spoiler>`;
  const paymentCode = order.payment_code || String(order.id);

  // Customer-supplied input is potentially sensitive (emails, etc.) — wrap
  // in spoiler so it's tap-to-reveal. Empty line when no input.
  const customerLine = customerInfo
    ? `\n📧 <b>Thông tin KH</b>: <tg-spoiler>${escapeHtml(customerInfo)}</tg-spoiler>`
    : '';

  // productLine includes optional variant suffix; trusted-as-HTML because the
  // template var is marked trusted (productLine is in TRUSTED_VARS).
  const productLine = `${escapeHtml(product.name)}${variant ? ` — ${escapeHtml(variant.name)}` : ''}`;

  let keysBlock;
  if (keys && keys.length > 0) {
    const spoilered = keys.map((k) => `<tg-spoiler>${escapeHtml(k)}</tg-spoiler>`).join('\n');
    keysBlock = `🔑 <b>License Keys (${keys.length})</b> — tap để xem:\n${spoilered}`;
  } else {
    keysBlock = '⚠️ <i>Đơn cần xử lý thủ công — chưa có key.</i>';
  }

  return messageTemplateService.render('group.order_card', {
    orderCode: order.id,
    paymentCode,
    productLine,
    quantity: order.quantity,
    totalSpoiler,
    customerLine,
    keysBlock,
  });
}
```

- [ ] **Step 3: Smoke-render the card**

Run:

```bash
node -e "
const m=require('./src/services/messageTemplateService');
const text = m.render('group.order_card', {
  orderCode: 99, paymentCode: 'PNS99',
  productLine: 'Test SP', quantity: 1,
  totalSpoiler: '<tg-spoiler>123đ</tg-spoiler>',
  customerLine: '',
  keysBlock: '🔑 <b>License Keys (1)</b>:\n<tg-spoiler>abc</tg-spoiler>',
});
console.log(text);
"
```
Expected: card renders with header, spoiler in total, key spoiler block; no `{{` left.

- [ ] **Step 4: Commit**

```bash
git add src/services/orderChannelService.js
git commit -m "refactor(group-card): render via group.order_card template"
```

---

## Task 8: Refactor keyExpiryReminderService.js

**Files:**
- Modify: `src/services/keyExpiryReminderService.js:57-62`

- [ ] **Step 1: Import the service**

After the existing `const db = require('../database');` add:

```js
const messageTemplateService = require('./messageTemplateService');
```

- [ ] **Step 2: Replace the inline body**

Find:

```js
const body =
        `⏰ <b>Đơn ${orderRef}</b> sắp hết hạn.\n` +
        `📦 ${r.product_name}\n` +
        `📅 Hết hạn: <b>${expiryDate}</b>\n\n` +
        `Gia hạn vui lòng liên hệ ${support}.`;
      await bot.telegram.sendMessage(r.sold_to, body, { parse_mode: 'HTML' });
```

Replace with:

```js
const body = messageTemplateService.render('bot.expiry_reminder', {
        orderRef,
        productName: r.product_name,
        expiryDate,
        supportContact: support,
      });
      await bot.telegram.sendMessage(r.sold_to, body, { parse_mode: 'HTML' });
```

- [ ] **Step 3: Smoke-test render**

Run:

```bash
node -e "
const m=require('./src/services/messageTemplateService');
console.log(m.render('bot.expiry_reminder', {
  orderRef: '#42', productName: 'Netflix 1m', expiryDate: '2026-05-17', supportContact: '@admin'
}));
"
```
Expected: full body, no `{{`.

- [ ] **Step 4: Commit**

```bash
git add src/services/keyExpiryReminderService.js
git commit -m "refactor(reminder): render bot.expiry_reminder template"
```

---

## Task 9: Refactor orderFulfillmentService.js admin notify

**Files:**
- Modify: `src/services/orderFulfillmentService.js:30`

- [ ] **Step 1: Inspect the current body**

Read the surrounding 20 lines (around line 30) to confirm what local vars are already in scope (order, product/variant lookups). Note: this file mirrors the `backorder_paid` branch in `paymentPoller.js` — Task 10 covers the poller-side identical change, so keep the variable names symmetric (`orderCode`, `productName`, `quantity`, `total`, `userMention`, `inputBlock`).

- [ ] **Step 2: Import the service if not already imported**

At top of file add (skip if already present):

```js
const messageTemplateService = require('./messageTemplateService');
```

- [ ] **Step 3: Build vars and render**

Replace the existing `adminNotifyService.notify('backorder_paid', '<...inline body...>', opts)` call with:

```js
const { formatPrice } = require('../utils/keyboard');
const inputBlock = order.input_value
  ? (() => {
      try {
        const { decryptString } = require('../utils/secrets');
        return `\n📝 Thông tin: <code>${decryptString(order.input_value)}</code>`;
      } catch { return '\n📝 Thông tin: <code>(decode err)</code>'; }
    })()
  : '';
const body = messageTemplateService.render('admin.backorder_paid', {
  orderCode: order.id,
  productName: order.product_name,
  quantity: order.quantity,
  total: formatPrice(order.total_price).replace(/đ$/, ''),
  userMention: String(order.user_id),
  inputBlock,
});
await adminNotifyService.notify('backorder_paid', body, { parse_mode: 'HTML', order_id: order.id });
```

If `order.product_name` is not in scope at this point, use the variable the file already pulls (likely `result.order.product_name` or `product.name` — match the existing code).

- [ ] **Step 4: Boot smoke test**

Run: `node -e "require('./src/index.js')"` for ~3s then Ctrl-C.
Expected: no template-missing error.

- [ ] **Step 5: Commit**

```bash
git add src/services/orderFulfillmentService.js
git commit -m "refactor(fulfillment): render admin.backorder_paid template"
```

---

## Task 10: Refactor paymentPoller.js (7 call sites)

**Files:**
- Modify: `src/services/paymentPoller.js`

This is the largest refactor — eight discrete sub-edits inside one file. Do them as one task with one commit at the end. Keep behaviour identical; only the body construction changes.

- [ ] **Step 1: Confirm `messageTemplateService` is already imported**

Line 5 already imports it. No change.

- [ ] **Step 2: Replace `payment_short` (short-pay branch, ~line 298)**

Find:

```js
adminNotifyService.notify('payment_short',
        `⚠️ Thanh toán thiếu cho đơn #${order.id}\n` +
        `KH: ${order.user_id}\n` +
        `Mã: ${paymentCode}\nChuyển: ${formatPrice(tx.amount)}\nCần: ${formatPrice(order.total_price)}\n\n` +
        `<i>Bot không tự cộng. Vào /admin/users để cộng thủ công nếu cần.</i>`,
        { parse_mode: 'HTML' });
```

Replace with:

```js
adminNotifyService.notify('payment_short',
        messageTemplateService.render('admin.payment_short', {
          orderCode: order.id,
          total: formatPrice(order.total_price).replace(/đ$/, ''),
          received: formatPrice(tx.amount).replace(/đ$/, ''),
          memo: paymentCode,
          userMention: String(order.user_id),
          note: 'Bot không tự cộng. Vào /admin/users để cộng thủ công nếu cần.',
        }),
        { parse_mode: 'HTML' });
```

- [ ] **Step 3: Replace `backorder_paid` (~line 337)**

Find:

```js
adminNotifyService.notify('backorder_paid',
        `🛎 Đơn đặt trước cần xử lý: #${order.id}\n` +
        `📦 ${result.order.product_name} (×${order.quantity})\n` +
        `💰 ${formatPrice(order.total_price)}${inputBlock}\n` +
        `→ /admin/orders để giao thủ công.`,
        { parse_mode: 'HTML', order_id: order.id });
```

Replace with:

```js
adminNotifyService.notify('backorder_paid',
        messageTemplateService.render('admin.backorder_paid', {
          orderCode: order.id,
          productName: result.order.product_name,
          quantity: order.quantity,
          total: formatPrice(order.total_price).replace(/đ$/, ''),
          userMention: String(order.user_id),
          inputBlock,
        }),
        { parse_mode: 'HTML', order_id: order.id });
```

Leave the existing `inputBlock` build above unchanged — it produces the HTML-trusted snippet already.

- [ ] **Step 4: Replace inline `backorder_wait` body (~line 346)**

Find:

```js
const dbForSetting = require('../database');
      const settingRow = dbForSetting.prepare("SELECT value FROM settings WHERE key = 'backorder_wait_message'").get();
      const waitMsg = settingRow?.value || 'Đơn này được giao thủ công, shop sẽ xử lý trong ít phút.';
      this._notifyCustomer(order.user_id,
        `💳 Đã nhận thanh toán đơn #${order.id}.\n${waitMsg}`,
        'HTML');
```

Replace with:

```js
const dbForSetting = require('../database');
      const settingRow = dbForSetting.prepare("SELECT value FROM settings WHERE key = 'backorder_wait_message'").get();
      const waitMsg = settingRow?.value || 'Đơn này được giao thủ công, shop sẽ xử lý trong ít phút.';
      this._notifyCustomer(order.user_id,
        messageTemplateService.render('bot.backorder_wait', {
          orderCode: order.id,
          waitMsg,
        }),
        'HTML');
```

`waitMsg` is plain text (admin setting) — renderer will escape it. If admins want HTML in the wait message, they can edit the `bot.backorder_wait` body itself.

- [ ] **Step 5: Replace `delivered` admin notify (~line 365)**

Find:

```js
adminNotifyService.notify('delivered',
        `✅ Tự động giao hàng đơn #${order.id}\n` +
        `KH: ${order.user_id}\nSP: ${result.order.product_name}\nSL: ${order.quantity}` +
        (overpayAmount > 0
          ? `\n\n⚠️ <b>Khách chuyển dư ${formatPrice(overpayAmount)}</b>\nVào /admin/users/${order.user_id}/adjust nếu muốn cộng vào ví.`
          : ''),
        { parse_mode: 'HTML' });
```

Replace with:

```js
const overpayBlock = overpayAmount > 0
        ? `\n\n⚠️ <b>Khách chuyển dư ${formatPrice(overpayAmount)}</b>\nVào /admin/users/${order.user_id}/adjust nếu muốn cộng vào ví.`
        : '';
      adminNotifyService.notify('delivered',
        messageTemplateService.render('admin.delivered', {
          orderCode: order.id,
          productName: result.order.product_name,
          quantity: order.quantity,
          userMention: String(order.user_id),
          overpayBlock,
        }),
        { parse_mode: 'HTML' });
```

- [ ] **Step 6: Replace `no_stock` admin notify (~line 385)**

Find:

```js
adminNotifyService.notify('no_stock',
      `💳 Đã nhận thanh toán đơn #${order.id} nhưng hết hàng!\n` +
      `KH: ${order.user_id}\nSP: ${order.product_name}\nCần giao thủ công.`);
```

Replace with:

```js
adminNotifyService.notify('no_stock',
      messageTemplateService.render('admin.no_stock', {
        orderCode: order.id,
        productName: order.product_name,
        quantity: order.quantity,
        userMention: String(order.user_id),
      }),
      { parse_mode: 'HTML' });
```

- [ ] **Step 7: Replace `_handleOrphanedOrderTx` payment_short notify (~line 449)**

Find:

```js
adminNotifyService.notify('payment_short',
        `⚠️ <b>Khách chuyển khoản cho đơn ${order.status}</b>\n\n` +
        `Đơn #${order.id} (status: ${order.status})\n` +
        `KH: ${order.user_id}\n` +
        `Số tiền: ${formatPrice(tx.amount)} · Mã: ${paymentCode}\n\n` +
        `<i>Vào /admin/users/${order.user_id}/adjust để cộng thủ công nếu cần.</i>`,
        { parse_mode: 'HTML' });
```

Replace with:

```js
adminNotifyService.notify('payment_short',
        messageTemplateService.render('admin.payment_short', {
          orderCode: `${order.id} (status: ${order.status})`,
          total: '—',
          received: formatPrice(tx.amount).replace(/đ$/, ''),
          memo: paymentCode,
          userMention: String(order.user_id),
          note: `Vào /admin/users/${order.user_id}/adjust để cộng thủ công nếu cần.`,
        }),
        { parse_mode: 'HTML' });
```

- [ ] **Step 8: Replace `_handleOrphanedOrderTx` no-order branch (~line 457)**

Find:

```js
adminNotifyService.notify('payment_short',
        `⚠️ <b>Chuyển khoản không khớp đơn nào</b>\n\n` +
        `Mã: ${paymentCode}\nSố tiền: ${formatPrice(tx.amount)}\n\n` +
        `<i>Không tìm thấy đơn hàng tương ứng.</i>`,
        { parse_mode: 'HTML' });
```

Replace with:

```js
adminNotifyService.notify('payment_short',
        messageTemplateService.render('admin.payment_short', {
          orderCode: '—',
          total: '—',
          received: formatPrice(tx.amount).replace(/đ$/, ''),
          memo: paymentCode,
          userMention: '—',
          note: 'Không tìm thấy đơn hàng tương ứng.',
        }),
        { parse_mode: 'HTML' });
```

- [ ] **Step 9: Replace `_handleOrphanedTopupTx` notify (~line 486)**

Find:

```js
adminNotifyService.notify('payment_short',
      `⚠️ <b>Nạp ví ngoài /nap (memo ${memo})</b>\n\n` +
      `Số tiền: ${formatPrice(tx.amount)}\n` +
      (userId ? `KH: ${userId}\n` : 'KH: <i>không xác định</i>\n') +
      `\n<i>Bot không tự cộng. Vào /admin/users để xử lý thủ công.</i>`,
      { parse_mode: 'HTML' });
```

Replace with:

```js
adminNotifyService.notify('payment_short',
      messageTemplateService.render('admin.payment_short', {
        orderCode: `topup memo ${memo}`,
        total: '—',
        received: formatPrice(tx.amount).replace(/đ$/, ''),
        memo,
        userMention: userId ? String(userId) : '—',
        note: 'Bot không tự cộng. Vào /admin/users để xử lý thủ công.',
      }),
      { parse_mode: 'HTML' });
```

- [ ] **Step 10: Replace `_processTopupMatch` admin notify (~line 571)**

Find:

```js
adminNotifyService.notify('payment_short',
      `💵 <b>Yêu cầu nạp ví chờ duyệt</b>\n\n` +
      `Topup #${topup.id} · KH ${topup.user_id}\n` +
      `Số tiền: ${formatPrice(tx.amount)}\n` +
      `Memo: ${memo}\n\n` +
      `Vào /admin/topups → tab "Chờ duyệt" → nhấn "Cộng".`,
      { parse_mode: 'HTML' });
```

Replace with:

```js
adminNotifyService.notify('payment_short',
      messageTemplateService.render('admin.payment_short', {
        orderCode: `topup #${topup.id}`,
        total: '—',
        received: formatPrice(tx.amount).replace(/đ$/, ''),
        memo,
        userMention: String(topup.user_id),
        note: 'Vào /admin/topups → tab "Chờ duyệt" → nhấn "Cộng".',
      }),
      { parse_mode: 'HTML' });
```

- [ ] **Step 11: Boot smoke test**

Run: `lsof -ti :3000 | xargs kill -9 2>/dev/null; sleep 1; node -e "require('./src/index.js')"` for ~5s, then Ctrl-C.
Expected: no `Unknown message template:` error in stderr. Log shows poller armed message.

- [ ] **Step 12: Commit**

```bash
git add src/services/paymentPoller.js
git commit -m "refactor(poller): render all admin/customer payment notifies via templates"
```

---

## Task 11: Verification script — render every template

**Files:**
- Create: `scripts/verify-message-templates.js`

- [ ] **Step 1: Write the script**

```js
// scripts/verify-message-templates.js
// One-shot render check: iterate every key in seeds/message-templates.json,
// render it with placeholder vars, and fail if any {{var}} remains
// unsubstituted or any key is unknown to the service.

const fs = require('fs');
const path = require('path');
const seed = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'src', 'database', 'seeds', 'message-templates.json'),
  'utf8',
));
const m = require('../src/services/messageTemplateService');

let failed = 0;
for (const [key, t] of Object.entries(seed)) {
  const vars = {};
  for (const v of t.variables) vars[v] = `[${v}]`;
  let out;
  try { out = m.render(key, vars); }
  catch (e) { console.error(`✗ ${key}: ${e.message}`); failed++; continue; }
  const leftover = out.match(/\{\{[^}]+\}\}/);
  if (leftover) {
    console.error(`✗ ${key}: unsubstituted ${leftover[0]}`);
    failed++;
  } else {
    console.log(`✓ ${key}`);
  }
}
if (failed > 0) {
  console.error(`\n${failed} template(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${Object.keys(seed).length} templates render cleanly.`);
```

- [ ] **Step 2: Run the script**

Run: `node scripts/verify-message-templates.js`
Expected: every key prints `✓ key`. Last line: `All 29 templates render cleanly.` (18 original + 11 new = 29).

If a key fails, fix the seed entry's `variables` array or the template body. Re-run.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-message-templates.js
git commit -m "test(templates): render-all verification script"
```

---

## Task 12: End-to-end manual smoke + tag

**No code changes.** This task validates the live system before tagging.

- [ ] **Step 1: Boot all services**

Run: `./dev.sh` (or `npm run dev:all`). Wait for `:3000`, `:3001`, `:8000` to be ready.

- [ ] **Step 2: Edit a template via admin UI**

In browser at `http://localhost:3001/admin/messages`:
1. Switch to **admin** tab.
2. Open `admin.delivered`, change `Tự động giao hàng` to `[TEST] Tự động giao hàng`, save.
3. Click **Preview** with sample vars to confirm save took effect.

Expected: preview text starts with `[TEST]`.

- [ ] **Step 3: Trigger a real `admin.delivered` notification**

Place a small in-stock test order in the mini-app, pay via the dev MBBank flow (or use admin manual deliver at `/admin/orders/:id`). Watch the admin notify chat.

Expected: the admin DM body begins with `[TEST]`.

- [ ] **Step 4: Reset the template**

Back in `/admin/messages`, click **Reset** on `admin.delivered`. Confirm body matches `default_body`.

- [ ] **Step 5: Run the render check one more time**

Run: `node scripts/verify-message-templates.js`
Expected: `All 29 templates render cleanly.`

- [ ] **Step 6: Tag**

```bash
git tag v0.27-editable-messages
git log --oneline v0.26-backorder-order-polish..HEAD
```

Expected: 11 commits (one per task), all under the tag.

- [ ] **Step 7: Update CLAUDE.md `Sub-projects shipped` table**

Edit `CLAUDE.md`. Append a row to the table under `## Sub-projects shipped (today)`:

```
| `v0.27-editable-messages` | A — admin/group/bot message templates (29 total), `/admin/messages` covers all 4 channels |
```

Commit:

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): record v0.27 sub-project shipped"
```

---

## Self-review notes

- **Spec coverage:** All 11 keys in the spec table map to seed entries (Task 1) + migration (Task 2) + refactored call sites (Tasks 6–10). Frontend tab change (Task 5) covers the "admin opens /admin/messages → sees new groups" line in the spec. Sanitiser route change (Task 4) covers the channel-routing tweak. Render verification (Task 11) covers the "no `{{` survives" testing requirement.
- **Type / name consistency:** Variable names are stable across tasks — `orderCode`, `productName`, `quantity`, `total`, `userMention`, `inputBlock`, `overpayBlock`, `stockUrlBlock`, `customerLine`, `productLine`, `totalSpoiler`, `keysBlock`, `waitMsg`, `expiryDate`, `supportContact`, `productEmoji`, `productId`, `stockCount`, `threshold`. `TRUSTED_VARS` (Task 3) lists every trusted-as-HTML var the call sites pass.
- **No placeholders:** every step contains the literal new code or the exact run command + expected output.
- **Edge case noted:** Task 10 reuses `admin.payment_short` across 5 different scenarios by passing different `orderCode`/`note` strings — keeps the template count low (1 vs 5) while still letting admins edit one body.
