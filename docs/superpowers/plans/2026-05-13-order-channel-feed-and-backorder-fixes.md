# Order Channel Feed + Backorder UX Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Mirror every paid order to a Telegram group/topic with a structured "Order Notification" card (key-bearing → censored keys; no-key → "cần xử lý thủ công"). (2) Bot DMs customer on every delivery completion (auto + manual after admin adds key). (3) Backorder variants show ∞ instead of 9999, and customers can actually buy them despite having no stock.

**Architecture:** New `orderChannelService` sends a structured HTML card to `process.env.ORDER_CHANNEL_CHAT_ID` (optional `ORDER_CHANNEL_THREAD_ID`). Triggered from `orderFulfillmentService.deliverOrder` (auto path) and the admin `/manual-deliver` route (manual path). `notifyOrderDelivered` is already called for the customer in both paths — verify no regression. Customer create-order path branches on variant.is_backorder before stock reservation so insufficient stock is no longer raised. Mini app UI shows `∞` when `isBackorder=true`.

**Tech Stack:** Node 20, Telegraf, better-sqlite3, Next 16, React 19.

---

### Task 1: Backorder stock bypass at order create

**Files:**
- Modify: `src/services/orderService.js`

- [ ] **Step 1: Skip reservation when variant is backorder**

Open `src/services/orderService.js`. Locate the `txn` block inside `create` (around line 76-100). Before the reservation step, look up backorder:

Replace:
```js
      // Reservation: if order has a variant_id, only pull keys with that variant_id.
      // Otherwise pull product-level keys (variant_id IS NULL) to preserve legacy
      // single-SKU semantics.
      const reserved = variantId
        ? reserveStockBatchByVariant.run(id, productId, variantId, quantity)
        : reserveStockBatchNoVariant.run(id, productId, quantity);
      if (reserved.changes < quantity) {
        // Partial reserve happened — explicit release before throw, defensive
        // (transaction rollback should also handle, but explicit is safer).
        releaseReservationsForOrder.run(id);
        const err = new Error('INSUFFICIENT_STOCK');
        err.requested = quantity;
        err.available = reserved.changes;
        throw err;
      }
```

With:
```js
      // Backorder variants have no key inventory — admin fulfils each order
      // manually. Skip the reservation step (and the stock check) entirely.
      let isBackorder = false;
      if (variantId) {
        const v = db.prepare('SELECT is_backorder FROM product_variants WHERE id = ?').get(variantId);
        isBackorder = !!(v && v.is_backorder);
      }

      if (!isBackorder) {
        const reserved = variantId
          ? reserveStockBatchByVariant.run(id, productId, variantId, quantity)
          : reserveStockBatchNoVariant.run(id, productId, quantity);
        if (reserved.changes < quantity) {
          releaseReservationsForOrder.run(id);
          const err = new Error('INSUFFICIENT_STOCK');
          err.requested = quantity;
          err.available = reserved.changes;
          throw err;
        }
      }
```

- [ ] **Step 2: Restart api**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
lsof -ti :3000 | xargs kill -9 2>/dev/null
sleep 3
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
nohup npm run dev > logs/api.log 2>&1 &
sleep 6
```

- [ ] **Step 3: Smoke**

In mini app: pick a product with a backorder variant, fill required fields, add to cart, place order. Expected: order goes to pending status; no INSUFFICIENT_STOCK error.

- [ ] **Step 4: Commit**

```bash
git add src/services/orderService.js
git commit -m "fix(orders): skip stock reservation for backorder variants on create"
```

---

### Task 2: Show ∞ for backorder variant stock

**Files:**
- Modify: `web/src/app/(miniapp)/components/VariantPicker.tsx`
- Modify: `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`

- [ ] **Step 1: VariantPicker tile renders ∞ for backorder**

Find the variant tile render block. Locate:
```tsx
                <span className={`v-stock ${out ? 'v-stock--out' : 'v-stock--in'}`}>
                  {out ? 'Hết' : `Còn ${v.stock}`}
                </span>
```

Replace with:
```tsx
                <span className={`v-stock ${out && !v.isBackorder ? 'v-stock--out' : 'v-stock--in'}`}>
                  {v.isBackorder ? 'Có sẵn' : (out ? 'Hết' : `Còn ${v.stock}`)}
                </span>
```

Also update the disabled logic so backorder is never disabled:
```tsx
        {variants.map((v) => {
          const out = v.stock <= 0 && !v.isBackorder
```

(Locate `const out = v.stock <= 0` and add the `&& !v.isBackorder` guard.)

- [ ] **Step 2: Product detail effectiveStock display ∞**

Open `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`. Locate the in-stock pill:
```tsx
                {effectiveStock > 0
                  ? <span style={{ color: '#16a34a' }}>● {t.product.inStock.replace('{n}', String(effectiveStock))}</span>
                  : <span style={{ color: '#dc2626' }}>● {t.product.outOfStock}</span>}
```

Replace with:
```tsx
                {selected?.isBackorder
                  ? <span style={{ color: '#16a34a' }}>● Có sẵn (đặt trước)</span>
                  : effectiveStock > 0
                    ? <span style={{ color: '#16a34a' }}>● {t.product.inStock.replace('{n}', String(effectiveStock))}</span>
                    : <span style={{ color: '#dc2626' }}>● {t.product.outOfStock}</span>}
```

The `effectiveStock` ternary checking the qty stepper should also stop showing 9999 — find:
```tsx
                <button
                  ...
                  onClick={() => setQty((q) => Math.min(effectiveStock || 99, q + 1))}
```
and replace with:
```tsx
                <button
                  ...
                  onClick={() => setQty((q) => Math.min(selected?.isBackorder ? 99 : (effectiveStock || 99), q + 1))}
```

- [ ] **Step 3: Type-check + smoke**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit
```
Open a product with a backorder variant. Tile shows "Có sẵn"; detail pill shows "● Có sẵn (đặt trước)" instead of "Còn 9999".

- [ ] **Step 4: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(miniapp\)/components/VariantPicker.tsx web/src/app/\(miniapp\)/san-pham/\[slug\]/page.tsx
git commit -m "feat(miniapp): backorder variants show 'Có sẵn' instead of fake 9999 stock"
```

---

### Task 3: Order channel feed service

**Files:**
- Create: `src/services/orderChannelService.js`
- Modify: `.env` (operator action — document only)

- [ ] **Step 1: Create orderChannelService**

Create `src/services/orderChannelService.js`:

```js
// Posts a structured order-paid notification to a Telegram group/topic.
// Reads channel + topic from env at module load. No-op if ORDER_CHANNEL_CHAT_ID
// is unset.
//
// Env:
//   ORDER_CHANNEL_CHAT_ID    - chat id (negative for groups, e.g. -1003865156744)
//   ORDER_CHANNEL_THREAD_ID  - optional message_thread_id for forum topics (e.g. 2)

let bot = null;

function init(b) { bot = b; }

function censor(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 4) return '••••';
  return s.slice(0, 2) + '•'.repeat(Math.max(4, s.length - 4)) + s.slice(-2);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function decryptInput(encrypted) {
  if (!encrypted) return null;
  try {
    const { decryptString } = require('../utils/secrets');
    return decryptString(encrypted);
  } catch {
    return null;
  }
}

function buildCard({ order, product, variant, keys, customerEmail }) {
  const lines = [];
  lines.push(`<b>Order #${order.id} Notification</b>`);
  lines.push('');
  lines.push(`💰 <b>Thanh toán</b>: ${order.total_price.toLocaleString('vi-VN')}đ`);
  lines.push(`🧾 <b>Mã đơn</b>: <code>${order.payment_code || order.id}</code>`);
  if (customerEmail) lines.push(`📧 <b>Email</b>: ${escapeHtml(customerEmail)}`);
  lines.push('');
  lines.push(`📦 <b>Sản phẩm</b>: ${escapeHtml(product.name)}${variant ? ` — ${escapeHtml(variant.name)}` : ''} ×${order.quantity}`);
  if (keys && keys.length > 0) {
    lines.push('');
    lines.push(`🔑 <b>License Keys (${keys.length})</b>:`);
    for (const k of keys) lines.push(`<code>${escapeHtml(censor(k))}</code>`);
  } else {
    lines.push('');
    lines.push('⚠️ <i>Đơn cần xử lý thủ công — chưa có key.</i>');
  }
  return lines.join('\n');
}

async function postOrderCard({ order, product, variant, keys }) {
  if (!bot) return;
  const chatId = process.env.ORDER_CHANNEL_CHAT_ID;
  if (!chatId) return;
  const threadId = process.env.ORDER_CHANNEL_THREAD_ID
    ? parseInt(process.env.ORDER_CHANNEL_THREAD_ID, 10)
    : undefined;

  const customerEmail = decryptInput(order.input_value);
  const text = buildCard({ order, product, variant, keys, customerEmail });

  try {
    await bot.telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      message_thread_id: threadId,
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error(`orderChannelService failed:`, err.message || err);
  }
}

module.exports = { init, postOrderCard };
```

- [ ] **Step 2: Init on bot launch**

Open `src/index.js`. Find the existing service init block (look for `adminNotifyService.init(bot)`) and add right after:

```js
  require('./services/orderChannelService').init(bot);
```

- [ ] **Step 3: Document env**

Append to `.env` (gitignored, operator action — show what to add):
```
# Order channel feed: paid orders are mirrored as cards here.
# Chat id is negative for groups (supergroups start with -100…). Thread id is
# optional for forum topics.
ORDER_CHANNEL_CHAT_ID=-1003865156744
ORDER_CHANNEL_THREAD_ID=2
```

- [ ] **Step 4: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add src/services/orderChannelService.js src/index.js
git commit -m "feat(channel): orderChannelService posts paid-order cards to a Telegram group/topic"
```

---

### Task 4: Trigger channel card on auto + manual deliver

**Files:**
- Modify: `src/services/orderFulfillmentService.js`
- Modify: `src/services/paymentPoller.js`
- Modify: `src/api/routes/admin/orders.js`

- [ ] **Step 1: Auto-deliver path**

In `src/services/orderFulfillmentService.js`, after the successful `sendDelivery`/`backorder admin notify`, post the card. Replace the function with:

```js
async function deliverOrder(bot, orderId) {
    const result = orderService.confirmAndDeliver(orderId);
    if (!result.success) return result;

    const order = result.order;
    const product = productService.getById(order.product_id);
    const variantService = require('./variantService');
    const db = require('../database');
    const variant = order.variant_id ? variantService.getById(db, order.variant_id) : null;
    const orderChannelService = require('./orderChannelService');

    if (result.backorder) {
        const inputBlock = order.input_value
            ? `\n📝 Thông tin khách: <code>${(() => {
                try { const { decryptString } = require('../utils/secrets'); return decryptString(order.input_value); } catch { return '(không giải mã được)'; }
              })()}</code>`
            : '';
        const body =
            `🛎 Đơn đặt trước cần xử lý: #${order.id}\n` +
            `📦 ${product.name} (×${order.quantity})\n` +
            `💰 ${order.total_price.toLocaleString('vi-VN')}đ${inputBlock}\n` +
            `→ /admin/orders để giao thủ công.`;
        await adminNotifyService.notify('backorder_paid', body, { order_id: order.id });
        await orderChannelService.postOrderCard({ order, product, variant, keys: null });
        return result;
    }

    const usageInstructions = product.usage_instructions
        ? richifyText(product.usage_instructions)
        : '(không có)';

    await sendDelivery(bot, { ...order, product_name: product.name }, result.accounts, {
        usageInstructions,
        postDeliveryKeyboard: postDeliveryKeyboard(),
    });
    await orderChannelService.postOrderCard({ order, product, variant, keys: result.accounts });

    return result;
}
```

- [ ] **Step 2: Payment poller manual paths**

Open `src/services/paymentPoller.js`. The poller already calls `confirmAndDeliver` and routes results. Two branches need the channel card.

Find the backorder branch (search for `'backorder_paid'` adminNotifyService call) and append:
```js
      try {
        const orderChannelService = require('./orderChannelService');
        const variantService = require('./variantService');
        const dbMod = require('../database');
        const variant = order.variant_id ? variantService.getById(dbMod, order.variant_id) : null;
        const product = require('./productService').getById(order.product_id);
        await orderChannelService.postOrderCard({ order, product, variant, keys: null });
      } catch (e) { console.error('orderChannelService backorder post failed:', e.message); }
```

Find the auto-deliver success branch (`this.matchCount++; await this._notifyCustomerDelivered`) and append, after the existing `adminNotifyService.notify('delivered', ...)`:
```js
      try {
        const orderChannelService = require('./orderChannelService');
        const variantService = require('./variantService');
        const dbMod = require('../database');
        const variant = result.order.variant_id ? variantService.getById(dbMod, result.order.variant_id) : null;
        const product = require('./productService').getById(result.order.product_id);
        await orderChannelService.postOrderCard({ order: result.order, product, variant, keys: result.accounts });
      } catch (e) { console.error('orderChannelService auto post failed:', e.message); }
```

Find the `no_stock` branch (`'💳 Đã nhận thanh toán đơn ... nhưng hết hàng'`) and append:
```js
      try {
        const orderChannelService = require('./orderChannelService');
        const product = require('./productService').getById(order.product_id);
        await orderChannelService.postOrderCard({ order, product, variant: null, keys: null });
      } catch (e) { console.error('orderChannelService no-stock post failed:', e.message); }
```

- [ ] **Step 3: Admin manual-deliver path**

Open `src/api/routes/admin/orders.js`. Inside `POST /:id/manual-deliver`, after the `sendDelivery` call succeeds, also post a card. Find:

```js
      await sendDelivery(bot, { ...order, product_name: product?.name }, req.validated.accounts, { usageInstructions });
```

Append immediately after:
```js
      try {
        const orderChannelService = require('../../../services/orderChannelService');
        const variantService = require('../../../services/variantService');
        const variant = order.variant_id ? variantService.getById(db, order.variant_id) : null;
        await orderChannelService.postOrderCard({ order, product, variant, keys: req.validated.accounts });
      } catch (channelErr) {
        console.error('orderChannelService manual-deliver post failed:', channelErr.message);
      }
```

- [ ] **Step 4: Restart api + smoke**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
lsof -ti :3000 | xargs kill -9 2>/dev/null
sleep 3
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
nohup npm run dev > logs/api.log 2>&1 &
sleep 6
```

Trigger an order auto-confirm via payment poller → expect a card to appear in the configured channel + topic.
Trigger an admin manual-deliver from `/admin/orders` → expect a card too.

(If `ORDER_CHANNEL_CHAT_ID` is not set in `.env`, the service is a no-op — set it before testing.)

- [ ] **Step 5: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add src/services/orderFulfillmentService.js src/services/paymentPoller.js src/api/routes/admin/orders.js
git commit -m "feat(channel): post order card on auto-deliver + backorder + no-stock + manual-deliver"
```

---

### Task 5: Verify customer bot DM on every delivery completion

**Files:**
- (verification only — no code change expected)

- [ ] **Step 1: Audit the four delivery paths**

Confirm `notifyOrderDelivered` (the customer DM) fires from each of:
1. `paymentPoller._notifyCustomerDelivered` — exists, called on auto success
2. `orderFulfillmentService.deliverOrder` non-backorder branch — calls `sendDelivery` directly (sendDelivery = customer DM via `bot.telegram.sendMessage` + .txt fallback). Confirmed.
3. `orderFulfillmentService.deliverOrder` backorder branch — does NOT DM customer (only admin). Customer DM should fire AFTER admin completes the manual-deliver. Confirmed.
4. `admin/orders.js` `manual-deliver` route — calls `sendDelivery` → customer DM. Confirmed.

If any path is missing the customer DM, add a `sendDelivery` call there.

- [ ] **Step 2: Manual smoke**

End-to-end: customer buys a backorder variant → pay → channel card appears with "cần xử lý thủ công" + customer gets a "đã nhận thanh toán, shop xử lý thủ công" DM from poller (existing `this._notifyCustomer` call). Then admin opens `/admin/orders` → manual-deliver with keys → customer gets the normal delivery DM with keys + channel card with censored keys.

---

### Task 6: Final build verify + tag

- [ ] **Step 1: Build**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit && npm run build
```
Expected: clean.
