# Platform Overhaul — Auto-Payment + Admin CRUD + Clay Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework payment to use `PNS<orderId>` auto-detected via MBBank API (no user-confirm), add admin CRUD for product info + post-delivery instructions, fix existing bugs, redesign frontend with Clay design system, ensure Vietnamese diacritics throughout, and add unified dev:all logging.

**Architecture:**
- Order ID seeded at 100000 → payment code `PNS<orderId>` (e.g. `PNS100123`).
- Customer never confirms — only MBBank poller (auto via API) or admin (Telegram quick action / dashboard) trigger delivery.
- Admin dashboard CRUD for full product fields including `usage_instructions` (sent to buyer post-delivery).
- Frontend repainted with Clay tokens (cream canvas, warm-cream borders, swatch palette, Roobert font, generous radii, rotation hover, hard-offset shadows).
- `npm run dev:all` writes per-service logs to `logs/<service>.log` while still streaming to console.

**Tech Stack:** Express + Telegraf (single Node process), better-sqlite3, FastAPI MBBank API, Next.js 16 App Router, Tailwind v4, TanStack Query v5, Clay design tokens, concurrently + tee for unified logs.

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `src/services/paymentService.js` | Generate `PNS<orderId>` codes + QR URLs |
| `src/services/orderService.js` | Reseed AUTOINCREMENT to 100000, generate paymentCode AFTER insert |
| `src/services/paymentPoller.js` | Detect `PNS\d{6,}` codes, auto-deliver, attach usage_instructions |
| `src/handlers/quantitySelect.js` | Drop "Đã thanh toán" path; remove user-confirm callback wiring |
| `src/handlers/paymentConfirm.js` | Delete `check_paid_*` action; keep admin actions only |
| `src/database/migrations/003_usage_instructions.js` | NEW — add `usage_instructions` column + reseed sqlite_sequence for orders |
| `src/api/routes/admin/products.js` | Accept/return camelCase + `usageInstructions`, fix POST/PUT shape |
| `src/api/routes/customer.js` | Public order status uses new `PNS` code |
| `web/src/app/globals.css` | Clay tokens (CSS custom props + @theme inline) |
| `web/src/app/layout.tsx` | Inter+JetBrains Mono fallback fonts (Roobert paid) |
| `web/src/lib/clay.ts` | NEW — exports CLAY swatches + reusable class strings |
| `web/src/components/clay/` | NEW — Button, Card, Pill, Heading, Input, Badge primitives |
| `web/src/app/page.tsx` | Cream hero + swatch tiles |
| `web/src/app/san-pham/page.tsx` | Product grid using Clay Card |
| `web/src/app/san-pham/[slug]/page.tsx` | Product detail (full Vietnamese, usage_instructions preview) |
| `web/src/app/thanh-toan/[orderId]/page.tsx` | QR + countdown, NO user-confirm button, polls status |
| `web/src/app/admin/products/page.tsx` | CRUD with usageInstructions textarea, longDescription, image |
| `web/src/app/admin/orders/page.tsx` | Admin confirm/cancel buttons, view usage_instructions |
| `web/src/app/admin/dashboard/page.tsx` | Recharts: ResponsiveContainer fix for sizing bug |
| `package.json` (root) | `dev:all` pipes through tee to `logs/*.log` |
| `scripts/dev-all.sh` | NEW — wraps concurrently with per-service tee + ANSI strip |
| `logs/` | NEW directory (gitignored) for runtime logs |

---

## Task 1: Reseed orders AUTOINCREMENT to 100000 + add usage_instructions

**Files:**
- Create: `src/database/migrations/003_usage_instructions.js`
- Modify: `src/database/migrations/runner.js` (auto-discovers, no change needed if numbered)

- [ ] **Step 1: Write the migration file**

```javascript
// src/database/migrations/003_usage_instructions.js
function hasColumn(db, table, column) {
  return db.pragma(`table_info(${table})`).some(c => c.name === column);
}

function up(db) {
  if (!hasColumn(db, 'products', 'usage_instructions')) {
    db.exec(`ALTER TABLE products ADD COLUMN usage_instructions TEXT`);
  }

  // Reseed orders id to start from 100000 if currently lower
  const row = db.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'orders'`).get();
  const current = row ? row.seq : 0;
  if (current < 100000) {
    db.prepare(`INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('orders', 99999)`).run();
  }
}

module.exports = { up };
```

- [ ] **Step 2: Run app once and verify migration applies**

Run: `node -e "require('./src/database')" 2>&1 | head -20`
Expected: migration 003 logged as applied (or silent if already), no errors.

- [ ] **Step 3: Verify next order id ≥ 100000**

Run: `sqlite3 data/shop.db "SELECT seq FROM sqlite_sequence WHERE name='orders'"`
Expected: `99999` (next insert produces 100000) — only if no orders >= 100000 yet.

- [ ] **Step 4: Commit**

```bash
git add src/database/migrations/003_usage_instructions.js
git commit -m "feat(db): add usage_instructions + reseed orders id from 100000"
```

---

## Task 2: Generate payment code from order id (PNS<id>)

**Files:**
- Modify: `src/services/paymentService.js`
- Modify: `src/services/orderService.js`

- [ ] **Step 1: Replace generatePaymentCode + generatePayment in paymentService.js**

Replace contents of `src/services/paymentService.js` with:

```javascript
const config = require('../config');

const paymentService = {
  getBanks() {
    const banks = [config.BANK];
    if (config.BANK2) banks.push(config.BANK2);
    return banks;
  },
  getBank(index) {
    if (index === 1 && config.BANK2) return config.BANK2;
    return config.BANK;
  },
  /**
   * Build payment code from order id. Format: PNS<id> (e.g. PNS100123)
   */
  buildPaymentCode(orderId) {
    return `PNS${orderId}`;
  },
  generateQRUrl(amount, content, bank = null) {
    const b = bank || config.BANK;
    return (
      `https://img.vietqr.io/image/${b.BIN}-${b.ACCOUNT}-compact2.png` +
      `?amount=${amount}` +
      `&addInfo=${encodeURIComponent(content)}` +
      `&accountName=${encodeURIComponent(b.ACCOUNT_NAME)}`
    );
  },
  buildPayment(orderId, amount, bankIndex = 0) {
    const bank = this.getBank(bankIndex);
    const paymentCode = this.buildPaymentCode(orderId);
    return {
      paymentCode,
      qrUrl: this.generateQRUrl(amount, paymentCode, bank),
      bankName: bank.NAME,
      accountNumber: bank.ACCOUNT,
      accountName: bank.ACCOUNT_NAME,
      amount,
    };
  },
};

module.exports = paymentService;
```

- [ ] **Step 2: Update orderService.create to insert first, then set payment_code**

Replace `create` method in `src/services/orderService.js`:

```javascript
create(userId, productId, quantity, totalPrice, opts = {}) {
  const source = opts.source || 'telegram';
  const bankName = opts.bankName || null;
  const expiryMinutes = opts.expiryMinutes || 5;

  const insert = db.prepare(`
    INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, source, bank_name, expires_at)
    VALUES (?, ?, ?, ?, '', 'pending', ?, ?, datetime('now', '+' || ? || ' minutes'))
  `);
  const setCode = db.prepare(`UPDATE orders SET payment_code = ? WHERE id = ?`);

  const txn = db.transaction(() => {
    const r = insert.run(userId, productId, quantity, totalPrice, source, bankName, expiryMinutes);
    const id = r.lastInsertRowid;
    const code = `PNS${id}`;
    setCode.run(code, id);
    return id;
  });

  return this.getById(txn());
},
```

- [ ] **Step 3: Update quantitySelect.js call site (signature changed: no paymentCode arg)**

In `src/handlers/quantitySelect.js`, replace the `createOrderAndPay` body:

```javascript
async function createOrderAndPay(ctx, bot, product, quantity, bankIndex) {
    userService.findOrCreate(ctx.from);

    const totalPrice = product.price * quantity;

    const order = orderService.create(
        ctx.from.id,
        product.id,
        quantity,
        totalPrice,
        { source: 'telegram', bankName: paymentService.getBank(bankIndex).NAME }
    );

    const payment = paymentService.buildPayment(order.id, totalPrice, bankIndex);

    if (bot._paymentPoller) bot._paymentPoller.ensureRunning();

    const caption =
        `⏳ <b>Đang chờ thanh toán ${formatPrice(totalPrice)}...</b>\n\n` +
        `Quét mã QR phía trên để chuyển khoản.\n\n` +
        `💰 <b>THANH TOÁN ĐƠN HÀNG #${order.id}</b>\n\n` +
        `📦 Sản phẩm: ${product.name}\n` +
        `📊 Số lượng: ${quantity}\n` +
        `💵 Tổng tiền: <b>${formatPrice(totalPrice)}</b>\n\n` +
        `━━━━━━━━━━━━━━━━━\n\n` +
        `🏦 Chuyển vào: <b>${payment.bankName}</b>\n` +
        `├ Số tiền: <b>${formatPrice(totalPrice)}</b>\n` +
        `└ Nội dung CK: <code>${payment.paymentCode}</code>\n\n` +
        `⏰ QR hiệu lực trong <b>5 phút</b>\n` +
        `🚫 <b>KHÔNG</b> thay đổi nội dung chuyển khoản\n` +
        `✅ Sau khi CK thành công, hàng sẽ được giao <b>tự động</b> trong vòng dưới 60 giây.`;

    await ctx.replyWithPhoto(payment.qrUrl, {
        caption, parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Hủy thanh toán', `cancel_order_${order.id}`)],
        ]),
    });

    // Notify admin (unchanged below — uses payment.paymentCode)
    const userName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
    const adminMsg =
        `🔔 <b>ĐƠN HÀNG MỚI #${order.id}</b>\n\n` +
        `👤 Khách: <b>${userName}</b> (<code>${ctx.from.id}</code>)\n` +
        (ctx.from.username ? `📱 @${ctx.from.username}\n` : '') + `\n` +
        `📦 Sản phẩm: <b>${product.name}</b>\n` +
        `📊 Số lượng: ${quantity}\n` +
        `💰 Tổng tiền: <b>${formatPrice(totalPrice)}</b>\n` +
        `🏦 Bank: <b>${payment.bankName}</b>\n` +
        `🔑 Mã CK: <code>${payment.paymentCode}</code>`;

    try {
        await bot.telegram.sendMessage(config.ADMIN_ID, adminMsg, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [
                    Markup.button.callback(`✅ Xác nhận #${order.id}`, `admin_confirm_${order.id}`),
                    Markup.button.callback(`❌ Hủy #${order.id}`, `admin_cancel_${order.id}`),
                ],
            ]),
        });
    } catch (err) {
        console.error('Failed to notify admin:', err.message);
    }
}
```

- [ ] **Step 4: Run app, verify paymentService.generatePaymentCode no longer exists in test**

Run: `node -e "const p=require('./src/services/paymentService'); console.log(p.buildPaymentCode(100001))"`
Expected: `PNS100001`

- [ ] **Step 5: Commit**

```bash
git add src/services/paymentService.js src/services/orderService.js src/handlers/quantitySelect.js
git commit -m "feat(payment): use PNS<orderId> codes; insert order first to obtain id"
```

---

## Task 3: Update poller regex + delete user-confirm action

**Files:**
- Modify: `src/services/paymentPoller.js` (regex + payload `description_contains`)
- Modify: `src/handlers/paymentConfirm.js` (remove `check_paid_*` handler)

- [ ] **Step 1: Update regex + API payload in paymentPoller.js**

In `src/services/paymentPoller.js`:

Replace `const PAYMENT_CODE_REGEX = /NAP PAY-[A-Z0-9]{6}/;`
with `const PAYMENT_CODE_REGEX = /PNS\d{6,}/;`

Replace `description_contains: 'NAP PAY-',` with `description_contains: 'PNS',`

- [ ] **Step 2: Remove `check_paid_*` action handler from paymentConfirm.js**

Replace the file with admin-only delivery helper:

```javascript
const orderService = require('../services/orderService');
const productService = require('../services/productService');
const messages = require('../utils/messages');
const { postDeliveryKeyboard } = require('../utils/keyboard');

module.exports = (bot) => {
    bot.action('data_main', (ctx) => {
        ctx.answerCbQuery();
        ctx.reply('📊 Tính năng đang phát triển...');
    });

    bot.action('buy_again', (ctx) => {
        ctx.answerCbQuery();
        const products = productService.getAll();
        const { productListKeyboard } = require('../utils/keyboard');
        ctx.reply(messages.productHeader, productListKeyboard(products));
    });
};

async function deliverOrder(bot, orderId) {
    const result = orderService.confirmAndDeliver(orderId);
    if (!result.success) return result;

    const order = result.order;
    const product = productService.getById(order.product_id);

    try {
        await bot.telegram.sendMessage(
            order.user_id,
            messages.orderSuccessNotify(order.quantity),
            { parse_mode: 'HTML' }
        );
        await bot.telegram.sendMessage(
            order.user_id,
            messages.orderSuccess(product, order.quantity, result.accounts),
            { parse_mode: 'HTML', ...postDeliveryKeyboard() }
        );
        if (product.usage_instructions) {
            await bot.telegram.sendMessage(
                order.user_id,
                `📘 <b>Hướng dẫn sử dụng — ${product.name}</b>\n\n${product.usage_instructions}`,
                { parse_mode: 'HTML' }
            );
        }
    } catch (err) {
        console.error(`Failed to send delivery to ${order.user_id}:`, err.message);
    }

    return result;
}

module.exports.deliverOrder = deliverOrder;
```

- [ ] **Step 3: Same usage_instructions append inside paymentPoller `_notifyCustomerDelivered`**

Replace `_notifyCustomerDelivered` in `src/services/paymentPoller.js`:

```javascript
async _notifyCustomerDelivered(order, accounts) {
    const accountList = accounts.map((a, i) => `${i + 1}. ${a}`).join('\n');
    const message = `✅ Đơn hàng #${order.id} đã được giao!\n\n` +
      `📦 Sản phẩm: ${order.product_name}\n` +
      `📋 Số lượng: ${order.quantity}\n` +
      `💰 Tổng: ${formatPrice(order.total_price)}\n\n` +
      `🔑 Thông tin tài khoản:\n${accountList}\n\n` +
      `Cảm ơn bạn đã mua hàng! 🎉`;

    await this._notifyCustomer(order.user_id, message);

    const product = this.db.prepare(
      'SELECT usage_instructions FROM products WHERE id = ?'
    ).get(order.product_id);
    if (product && product.usage_instructions) {
      await this._notifyCustomer(
        order.user_id,
        `📘 Hướng dẫn sử dụng — ${order.product_name}\n\n${product.usage_instructions}`
      );
    }
}
```

- [ ] **Step 4: Verify regex matches PNS code**

Run: `node -e "console.log(/PNS\d{6,}/.exec('Chuyen khoan PNS100123 cam on'))"`
Expected: `[ 'PNS100123', index: 13, ... ]`

- [ ] **Step 5: Commit**

```bash
git add src/services/paymentPoller.js src/handlers/paymentConfirm.js
git commit -m "feat(payment): match PNS codes; remove user-side confirm; deliver usage_instructions"
```

---

## Task 4: Admin products CRUD — accept usageInstructions, fix POST/PUT shape mismatch

**Files:**
- Modify: `src/api/routes/admin/products.js`
- Modify: `web/src/app/admin/products/page.tsx`

- [ ] **Step 1: Backend — accept categoryName fallback + return usageInstructions**

Replace `src/api/routes/admin/products.js` POST validator + handler:

```javascript
router.post('/', validate(z.object({
  categoryId: z.number().int().positive().optional(),
  category: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(200),
  price: z.number().int().positive(),
  description: z.string().max(500).optional().nullable(),
  longDescription: z.string().max(5000).nullable().optional(),
  usageInstructions: z.string().max(5000).nullable().optional(),
  emoji: z.string().max(10).optional().default('📦'),
  imageUrl: z.string().max(500).nullable().optional(),
  lowStockThreshold: z.number().int().min(0).optional().default(5),
}).refine(d => d.categoryId || d.category, {
  message: 'Either categoryId or category required',
})), (req, res) => {
  const d = req.validated;
  let categoryId = d.categoryId;
  if (!categoryId && d.category) {
    const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(d.category);
    if (existing) categoryId = existing.id;
    else {
      const r = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)')
        .run(d.category, slugify(d.category));
      categoryId = r.lastInsertRowid;
    }
  }
  const slug = slugify(d.name);
  const result = db.prepare(`
    INSERT INTO products (category_id, name, price, description, emoji, slug, image_url, long_description, low_stock_threshold, usage_instructions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(categoryId, d.name, d.price, d.description || null, d.emoji, slug,
    d.imageUrl || null, d.longDescription || null, d.lowStockThreshold,
    d.usageInstructions || null);

  auditService.log(req.admin.adminId, 'product.create', 'product', result.lastInsertRowid, { name: d.name }, req.ip);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
  res.json({ success: true, data: shapeProduct(product) });
});
```

Replace PUT validator + handler similarly (all fields optional, support `category` string or `categoryId`, include `usageInstructions`).

Add helper at top of file (after `const router = Router();`):

```javascript
function shapeProduct(r) {
  return {
    id: String(r.id),
    name: r.name,
    category: r.category_name || '',
    categoryId: r.category_id,
    price: r.price,
    stock: r.stock_count ?? 0,
    lowStockThreshold: r.low_stock_threshold,
    active: !!r.is_active,
    description: r.description || '',
    longDescription: r.long_description || '',
    usageInstructions: r.usage_instructions || '',
    emoji: r.emoji || '📦',
    imageUrl: r.image_url || '',
    slug: r.slug || '',
  };
}
```

Update GET to use `shapeProduct`:

```javascript
const products = rows.map(shapeProduct);
```

Update PUT to handle `usageInstructions` mapping:

```javascript
if (d.usageInstructions !== undefined) { sets.push('usage_instructions = ?'); params.push(d.usageInstructions); }
```

- [ ] **Step 2: Frontend — add fields to ProductForm**

Replace ProductForm interface + emptyForm in `web/src/app/admin/products/page.tsx`:

```typescript
interface Product {
  id: string
  name: string
  category: string
  categoryId?: number
  price: number
  stock: number
  lowStockThreshold: number
  active: boolean
  description?: string
  longDescription?: string
  usageInstructions?: string
  emoji?: string
  imageUrl?: string
}

interface ProductForm {
  name: string
  category: string
  price: number
  emoji: string
  description: string
  longDescription: string
  usageInstructions: string
  imageUrl: string
  lowStockThreshold: number
}

const emptyForm: ProductForm = {
  name: '',
  category: '',
  price: 0,
  emoji: '📦',
  description: '',
  longDescription: '',
  usageInstructions: '',
  imageUrl: '',
  lowStockThreshold: 5,
}
```

Update `openEdit`:

```typescript
function openEdit(product: Product) {
  setForm({
    name: product.name,
    category: product.category,
    price: product.price,
    emoji: product.emoji || '📦',
    description: product.description || '',
    longDescription: product.longDescription || '',
    usageInstructions: product.usageInstructions || '',
    imageUrl: product.imageUrl || '',
    lowStockThreshold: product.lowStockThreshold,
  })
  setEditingId(product.id)
  setShowModal(true)
}
```

- [ ] **Step 3: Add textarea inputs in modal for longDescription + usageInstructions + imageUrl**

Inside the modal `<form>` body, add (place before submit button):

```tsx
<label className="block text-sm font-medium text-clay-charcoal">Mô tả chi tiết</label>
<textarea
  rows={4}
  value={form.longDescription}
  onChange={e => setForm({ ...form, longDescription: e.target.value })}
  className="clay-input w-full"
  placeholder="Mô tả đầy đủ hiển thị trên trang sản phẩm..."
/>

<label className="block text-sm font-medium text-clay-charcoal mt-3">Hướng dẫn sử dụng (gửi sau khi giao hàng)</label>
<textarea
  rows={5}
  value={form.usageInstructions}
  onChange={e => setForm({ ...form, usageInstructions: e.target.value })}
  className="clay-input w-full"
  placeholder="Cách đăng nhập, lưu ý bảo mật, link app..."
/>

<label className="block text-sm font-medium text-clay-charcoal mt-3">Ảnh sản phẩm (URL)</label>
<input
  type="url"
  value={form.imageUrl}
  onChange={e => setForm({ ...form, imageUrl: e.target.value })}
  className="clay-input w-full"
  placeholder="https://..."
/>
```

Update mutation bodies to send full form. The frontend already sends `form` as body — the backend now accepts `category` string.

- [ ] **Step 4: Manual test**

Run: `npm run dev:all` (after Task 9). Open `/admin/products`. Create product with usage instructions. Edit it. Confirm field persists.

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/admin/products.js web/src/app/admin/products/page.tsx
git commit -m "feat(admin): products CRUD with longDescription + usageInstructions"
```

---

## Task 5: Admin orders page — confirm/cancel buttons calling API

**Files:**
- Modify: `web/src/app/admin/orders/page.tsx`
- Confirm: `src/api/routes/admin/orders.js` exposes `POST /:id/confirm` + `POST /:id/cancel`

- [ ] **Step 1: Verify backend endpoints exist**

Run: `grep -n "router\.\(post\|patch\)\|confirm\|cancel" "src/api/routes/admin/orders.js"`
Expected: routes for confirm + cancel. If missing, add them (paste below into orders.js):

```javascript
router.post('/:id/confirm', async (req, res) => {
  const id = parseInt(req.params.id);
  const { deliverOrder } = require('../../../handlers/paymentConfirm');
  const bot = req.app.get('bot');
  const result = await deliverOrder(bot, id);
  if (!result.success) return res.status(400).json({ success: false, error: { code: 'DELIVERY_FAILED', message: result.error } });
  auditService.log(req.admin.adminId, 'order.confirm', 'order', id, null, req.ip);
  res.json({ success: true, data: result.order });
});

router.post('/:id/cancel', (req, res) => {
  const id = parseInt(req.params.id);
  orderService.cancel(id);
  auditService.log(req.admin.adminId, 'order.cancel', 'order', id, null, req.ip);
  res.json({ success: true });
});
```

Add `app.set('bot', bot)` in `src/index.js` after bot construction so route can access it.

- [ ] **Step 2: Frontend — add confirm/cancel mutations**

In `web/src/app/admin/orders/page.tsx`, add inside component:

```typescript
const confirmMutation = useMutation({
  mutationFn: (id: string) => api.post(`/admin/orders/${id}/confirm`),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] }),
})
const cancelMutation = useMutation({
  mutationFn: (id: string) => api.post(`/admin/orders/${id}/cancel`),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] }),
})
```

Per row, render two buttons when status === 'pending' or 'paid':

```tsx
{(order.status === 'pending' || order.status === 'paid') && (
  <div className="flex gap-2">
    <button onClick={() => confirmMutation.mutate(order.id)} className="clay-btn clay-btn--matcha text-xs">
      ✅ Xác nhận
    </button>
    <button onClick={() => cancelMutation.mutate(order.id)} className="clay-btn clay-btn--pomegranate text-xs">
      ❌ Hủy
    </button>
  </div>
)}
```

- [ ] **Step 3: Verify**

Open `/admin/orders` → create test pending order via Telegram → click "Xác nhận" → row updates to delivered.

- [ ] **Step 4: Commit**

```bash
git add src/api/routes/admin/orders.js src/index.js web/src/app/admin/orders/page.tsx
git commit -m "feat(admin): confirm/cancel orders from dashboard"
```

---

## Task 6: dev:all unified logging

**Files:**
- Create: `scripts/dev-all.sh`
- Create: `logs/.gitkeep`
- Modify: `package.json` (`dev:all` invokes script)
- Modify: `.gitignore` (add `logs/*.log`)

- [ ] **Step 1: Write dev-all.sh**

```bash
#!/usr/bin/env bash
# Run all services concurrently, tee each stream to logs/<service>.log AND console.
set -e
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
mkdir -p logs

# Strip ANSI codes only from log files (keep colors in console)
strip='s/\x1b\[[0-9;]*[mGKH]//g'

mbbank() { (cd mbbank-api && python -m uvicorn app.main:app --port 8000 2>&1) | tee >(sed -u "$strip" >> logs/mbbank.log); }
api()    { node --watch src/index.js 2>&1 | tee >(sed -u "$strip" >> logs/api.log); }
web()    { (cd web && npm run dev 2>&1) | tee >(sed -u "$strip" >> logs/web.log); }

export -f mbbank api web

npx concurrently \
  -n mbbank,api,web \
  -c yellow,green,cyan \
  --kill-others-on-fail \
  "bash -c mbbank" "bash -c api" "bash -c web"
```

- [ ] **Step 2: Make executable**

Run: `chmod +x scripts/dev-all.sh`

- [ ] **Step 3: Update package.json dev:all**

Replace dev:all line:

```json
"dev:all": "./scripts/dev-all.sh"
```

- [ ] **Step 4: Update .gitignore**

Append:

```
logs/*.log
```

- [ ] **Step 5: Verify**

Run: `npm run dev:all` for ~5 seconds, then `Ctrl+C`. Confirm `logs/mbbank.log`, `logs/api.log`, `logs/web.log` all populated, no ANSI escape codes in files.

- [ ] **Step 6: Commit**

```bash
git add scripts/dev-all.sh package.json .gitignore logs/.gitkeep
git commit -m "chore(dev): unified dev:all logging via tee to logs/*.log"
```

---

## Task 7: Clay design tokens (CSS + Tailwind v4)

**Files:**
- Modify: `web/src/app/globals.css`
- Create: `web/src/lib/clay.ts`

- [ ] **Step 1: Replace globals.css with Clay tokens**

```css
@import "tailwindcss";

@theme inline {
  /* Clay swatches */
  --color-clay-cream: #faf9f7;
  --color-clay-oat: #dad4c8;
  --color-clay-oat-light: #eee9df;
  --color-clay-charcoal: #55534e;
  --color-clay-silver: #9f9b93;
  --color-clay-ink: #000000;

  --color-matcha-300: #84e7a5;
  --color-matcha-600: #078a52;
  --color-matcha-800: #02492a;

  --color-slushie-500: #3bd3fd;
  --color-slushie-800: #0089ad;

  --color-lemon-400: #f8cc65;
  --color-lemon-500: #fbbd41;
  --color-lemon-700: #d08a11;

  --color-ube-300: #c1b0ff;
  --color-ube-800: #43089f;

  --color-pomegranate-400: #fc7981;
  --color-blueberry-800: #01418d;
  --color-dragonfruit: #ff3ea5;

  --font-sans: 'Inter', 'Roobert', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Space Mono', ui-monospace, monospace;

  /* Clay shadow stack */
  --shadow-clay: 0 1px 1px rgba(0,0,0,0.10), 0 -1px 1px rgba(0,0,0,0.04) inset, 0 -0.5px 1px rgba(0,0,0,0.05);
  --shadow-clay-hover: -7px 7px 0 rgba(0,0,0,1);

  --radius-clay: 24px;
  --radius-clay-lg: 40px;
  --radius-clay-pill: 9999px;
}

:root {
  --background: var(--color-clay-cream);
  --foreground: var(--color-clay-ink);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  font-feature-settings: "ss03", "ss10", "ss11", "ss12";
  letter-spacing: -0.01em;
}

/* === Clay primitive utilities === */
@layer components {
  .clay-card {
    background: #fff;
    border: 1px solid var(--color-clay-oat);
    border-radius: var(--radius-clay);
    box-shadow: var(--shadow-clay);
    transition: transform .25s ease, box-shadow .25s ease;
  }
  .clay-card-dashed {
    background: #fff;
    border: 1px dashed var(--color-clay-oat);
    border-radius: var(--radius-clay);
  }
  .clay-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: .5rem;
    padding: .75rem 1.25rem;
    border-radius: var(--radius-clay-pill);
    border: 1px solid var(--color-clay-oat);
    background: #fff;
    font-weight: 500;
    box-shadow: var(--shadow-clay);
    transition: transform .25s cubic-bezier(.34,1.56,.64,1), box-shadow .25s ease, background .2s;
    cursor: pointer;
  }
  .clay-btn:hover {
    transform: rotateZ(-2deg) translateY(-2px);
    box-shadow: var(--shadow-clay-hover);
  }
  .clay-btn--matcha { background: var(--color-matcha-300); }
  .clay-btn--lemon  { background: var(--color-lemon-400); }
  .clay-btn--ube    { background: var(--color-ube-300); color: var(--color-ube-800); }
  .clay-btn--slushie{ background: var(--color-slushie-500); }
  .clay-btn--pomegranate { background: var(--color-pomegranate-400); color: #fff; }
  .clay-btn--ink    { background: var(--color-clay-ink); color: #fff; border-color: var(--color-clay-ink); }
  .clay-pill {
    display: inline-flex; align-items: center; gap: .375rem;
    padding: .25rem .75rem;
    border-radius: var(--radius-clay-pill);
    border: 1px solid var(--color-clay-oat);
    background: var(--color-clay-oat-light);
    font-size: .75rem; font-weight: 500; color: var(--color-clay-charcoal);
  }
  .clay-input {
    background: #fff;
    border: 1px solid var(--color-clay-oat);
    border-radius: 16px;
    padding: .625rem .875rem;
    box-shadow: var(--shadow-clay);
    transition: border-color .15s ease, box-shadow .15s ease;
  }
  .clay-input:focus { outline: none; border-color: var(--color-clay-ink); box-shadow: 0 0 0 2px rgba(20,110,245,.25); }
  .clay-display {
    font-weight: 600; line-height: 1; letter-spacing: -0.04em;
  }
}
```

- [ ] **Step 2: Write web/src/lib/clay.ts**

```typescript
export const SWATCHES = {
  matcha: '#84e7a5',
  slushie: '#3bd3fd',
  lemon: '#fbbd41',
  ube: '#c1b0ff',
  pomegranate: '#fc7981',
  blueberry: '#01418d',
  dragonfruit: '#ff3ea5',
} as const

export type Swatch = keyof typeof SWATCHES

export const clayBtn = (variant?: Swatch | 'ink') =>
  variant ? `clay-btn clay-btn--${variant}` : 'clay-btn'
```

- [ ] **Step 3: Verify build**

Run: `cd web && npm run build 2>&1 | tail -20`
Expected: build success, no CSS errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/globals.css web/src/lib/clay.ts
git commit -m "feat(web): Clay design tokens + utility classes"
```

---

## Task 8: Repaint home + product pages (Vietnamese, Clay)

**Files:**
- Modify: `web/src/app/layout.tsx`
- Modify: `web/src/app/page.tsx`
- Modify: `web/src/app/san-pham/page.tsx`
- Modify: `web/src/app/san-pham/[slug]/page.tsx`

- [ ] **Step 1: layout.tsx — load Inter + JetBrains Mono via next/font**

```tsx
import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

const inter = Inter({ subsets: ['latin', 'vietnamese'], variable: '--font-inter' })
const jbm = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jbm' })

export const metadata: Metadata = {
  title: 'Starizzi Shop — Cửa hàng tài khoản số',
  description: 'Mua tài khoản, key bản quyền chính hãng — giao tự động sau thanh toán.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${inter.variable} ${jbm.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

- [ ] **Step 2: page.tsx — Clay hero**

Replace body of `web/src/app/page.tsx`'s return JSX with:

```tsx
return (
  <main className="min-h-screen">
    <header className="border-b border-clay-oat bg-clay-cream/80 backdrop-blur">
      <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <Link href="/" className="text-2xl clay-display">Starizzi</Link>
        <nav className="flex gap-3">
          <Link href="/san-pham" className="clay-btn clay-btn--lemon">Sản phẩm</Link>
          <Link href="/lien-ket" className="clay-btn">Liên kết Telegram</Link>
        </nav>
      </div>
    </header>

    <section className="max-w-6xl mx-auto px-6 pt-20 pb-16">
      <span className="clay-pill">🎉 Giao tự động sau khi chuyển khoản</span>
      <h1 className="clay-display text-[64px] md:text-[80px] mt-6 max-w-4xl">
        Tài khoản số chính hãng,<br/>
        <span className="text-matcha-600">giao trong 60 giây</span>.
      </h1>
      <p className="text-lg text-clay-charcoal max-w-2xl mt-6">
        Quét VietQR — chuyển khoản — nhận tài khoản & hướng dẫn sử dụng tự động qua web hoặc Telegram. Không cần xác nhận thủ công.
      </p>
      <div className="flex gap-3 mt-8">
        <Link href="/san-pham" className="clay-btn clay-btn--ink">Xem sản phẩm →</Link>
        <a href="https://t.me/your_bot" className="clay-btn clay-btn--ube">Mở Telegram bot</a>
      </div>
    </section>

    <section className="max-w-6xl mx-auto px-6 pb-24 grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="clay-card p-6">
        <div className="text-4xl mb-3">⚡</div>
        <h3 className="text-xl font-semibold mb-2">Giao tự động</h3>
        <p className="text-clay-charcoal">Hệ thống dò giao dịch MB Bank mỗi 15 giây và giao tài khoản khi khớp mã <code className="font-mono text-sm">PNS</code>.</p>
      </div>
      <div className="clay-card p-6" style={{background: 'var(--color-lemon-400)'}}>
        <div className="text-4xl mb-3">📘</div>
        <h3 className="text-xl font-semibold mb-2">Hướng dẫn sẵn sàng</h3>
        <p>Nhận hướng dẫn sử dụng chi tiết ngay sau khi nhận tài khoản.</p>
      </div>
      <div className="clay-card p-6" style={{background: 'var(--color-matcha-300)'}}>
        <div className="text-4xl mb-3">🔒</div>
        <h3 className="text-xl font-semibold mb-2">An toàn</h3>
        <p>Thanh toán qua VietQR. Không lưu thông tin ngân hàng. Mã đơn duy nhất theo từng giao dịch.</p>
      </div>
    </section>

    {/* Existing featured products list — wrap each card in `clay-card p-5` and replace buttons */}
    {/* keep existing data fetch & map, just restyle */}
  </main>
)
```

(Keep existing data-fetch logic; replace card markup to use `clay-card`.)

- [ ] **Step 3: san-pham/page.tsx — Clay grid**

Apply same Clay card style. Replace product card outer with:

```tsx
<Link href={`/san-pham/${product.slug}`} className="clay-card p-5 block hover:rotate-[-1deg] hover:shadow-[var(--shadow-clay-hover)] transition-all">
  {product.imageUrl ? <img src={product.imageUrl} alt={product.name} className="w-full aspect-square object-cover rounded-2xl mb-3"/> : <div className="text-6xl mb-3">{product.emoji}</div>}
  <h3 className="text-lg font-semibold">{product.name}</h3>
  <p className="text-clay-charcoal text-sm mt-1 line-clamp-2">{product.description}</p>
  <div className="flex items-center justify-between mt-4">
    <span className="text-2xl clay-display">{formatPrice(product.price)}</span>
    <span className="clay-pill">{product.stock > 0 ? `Còn ${product.stock}` : 'Hết hàng'}</span>
  </div>
</Link>
```

- [ ] **Step 4: san-pham/[slug] detail page — buy button + usage preview**

Add (below product description):

```tsx
{product.usageInstructions && (
  <div className="clay-card-dashed p-5 mt-6">
    <h4 className="font-semibold mb-2">📘 Bạn sẽ nhận được hướng dẫn sử dụng</h4>
    <p className="text-clay-charcoal text-sm">Chi tiết hướng dẫn được gửi tự động qua Telegram và hiển thị tại đây sau khi thanh toán thành công.</p>
  </div>
)}
```

- [ ] **Step 5: Verify Vietnamese diacritics in browser**

Open all three pages, verify text renders with diacritics ("Sản phẩm", "Hướng dẫn sử dụng" etc).

- [ ] **Step 6: Commit**

```bash
git add web/src/app/layout.tsx web/src/app/page.tsx web/src/app/san-pham/page.tsx web/src/app/san-pham/[slug]/page.tsx
git commit -m "feat(web): Clay redesign for home + product pages, Vietnamese copy"
```

---

## Task 9: Repaint payment page — no user-confirm button, status polling

**Files:**
- Modify: `web/src/app/thanh-toan/[orderId]/page.tsx`

- [ ] **Step 1: Remove any "Đã thanh toán" / confirm button. Page only polls status.**

```tsx
'use client'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatPrice } from '@/lib/utils'
import { useParams } from 'next/navigation'

interface OrderStatus {
  id: string
  status: 'pending' | 'paid' | 'delivered' | 'expired' | 'cancelled'
  totalPrice: number
  paymentCode: string
  qrUrl: string
  bankName: string
  expiresAt: string
  productName: string
  quantity: number
  accounts?: string[]
  usageInstructions?: string
}

export default function PaymentPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const { data } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api.get<OrderStatus>(`/orders/${orderId}/status`),
    refetchInterval: (q) => {
      const s = q.state.data?.data?.status
      return s === 'pending' || s === 'paid' ? 5000 : false
    },
  })

  const order = data?.data
  if (!order) return <main className="min-h-screen flex items-center justify-center">Đang tải...</main>

  const expiresMs = new Date(order.expiresAt).getTime() - Date.now()
  const minLeft = Math.max(0, Math.floor(expiresMs / 60000))
  const secLeft = Math.max(0, Math.floor((expiresMs % 60000) / 1000))

  return (
    <main className="min-h-screen max-w-3xl mx-auto px-6 py-12">
      <div className="clay-card p-8">
        <span className="clay-pill">Đơn hàng #{order.id}</span>
        <h1 className="clay-display text-3xl mt-4">{order.productName}</h1>
        <p className="text-clay-charcoal mt-1">Số lượng: {order.quantity}</p>

        {order.status === 'pending' && (
          <>
            <div className="mt-6 flex flex-col items-center">
              <img src={order.qrUrl} alt="QR thanh toán" className="w-72 h-72 rounded-2xl border border-clay-oat" />
              <div className="text-center mt-5">
                <div className="text-clay-charcoal text-sm">Số tiền</div>
                <div className="clay-display text-4xl mt-1">{formatPrice(order.totalPrice)}</div>
                <div className="text-clay-charcoal text-sm mt-4">Nội dung CK (bắt buộc)</div>
                <div className="font-mono text-lg mt-1 px-4 py-2 bg-clay-oat-light rounded-xl inline-block">{order.paymentCode}</div>
              </div>
            </div>
            <div className="clay-card-dashed mt-6 p-4 text-sm text-clay-charcoal">
              ⏰ Còn lại <b>{minLeft}p {secLeft}s</b>. Hệ thống tự động kiểm tra mỗi 15 giây — không cần bấm xác nhận. Hàng sẽ hiện ngay tại đây sau khi nhận được tiền.
            </div>
          </>
        )}

        {order.status === 'paid' && (
          <div className="clay-card-dashed mt-6 p-5">
            ✅ Đã nhận thanh toán — admin đang chuẩn bị hàng. Vui lòng chờ.
          </div>
        )}

        {order.status === 'delivered' && order.accounts && (
          <div className="mt-6">
            <h2 className="text-xl font-semibold mb-3">🎉 Đã giao hàng</h2>
            <pre className="bg-clay-ink text-white p-5 rounded-2xl whitespace-pre-wrap text-sm font-mono">
{order.accounts.map((a, i) => `${i + 1}. ${a}`).join('\n')}
            </pre>
            {order.usageInstructions && (
              <div className="clay-card-dashed mt-5 p-5">
                <h3 className="font-semibold mb-2">📘 Hướng dẫn sử dụng</h3>
                <div className="text-sm whitespace-pre-wrap">{order.usageInstructions}</div>
              </div>
            )}
          </div>
        )}

        {(order.status === 'expired' || order.status === 'cancelled') && (
          <div className="clay-card-dashed mt-6 p-5">
            ❌ Đơn hàng đã {order.status === 'expired' ? 'hết hạn' : 'bị hủy'}. Vui lòng đặt lại.
          </div>
        )}
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Backend — extend `/orders/:id/status` to include qrUrl + usageInstructions**

In `src/api/routes/customer.js`, find order status endpoint and ensure response shape:

```javascript
router.get('/orders/:id/status', (req, res) => {
  const id = parseInt(req.params.id);
  const order = orderService.getById(id);
  if (!order) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(order.product_id);
  const payment = paymentService.buildPayment(order.id, order.total_price, 0);
  const accounts = order.status === 'delivered'
    ? db.prepare(`SELECT data FROM stock WHERE sold_to = ? AND product_id = ? ORDER BY sold_at DESC LIMIT ?`)
        .all(order.user_id, order.product_id, order.quantity).map(r => r.data)
    : undefined;

  res.json({ success: true, data: {
    id: String(order.id),
    status: order.status,
    totalPrice: order.total_price,
    paymentCode: order.payment_code,
    qrUrl: payment.qrUrl,
    bankName: order.bank_name,
    expiresAt: order.expires_at,
    productName: product.name,
    quantity: order.quantity,
    accounts,
    usageInstructions: order.status === 'delivered' ? product.usage_instructions : undefined,
  }});
});
```

- [ ] **Step 3: Verify**

Open `/thanh-toan/<id>` for an existing pending order → confirm no confirm-button visible, polling fires every 5s (Network tab).

- [ ] **Step 4: Commit**

```bash
git add web/src/app/thanh-toan/[orderId]/page.tsx src/api/routes/customer.js
git commit -m "feat(web): Clay payment page with status polling, no manual confirm"
```

---

## Task 10: Repaint admin dashboard + login + sidebar

**Files:**
- Modify: `web/src/app/admin/layout.tsx`
- Modify: `web/src/app/admin/login/page.tsx`
- Modify: `web/src/app/admin/dashboard/page.tsx`

- [ ] **Step 1: Sidebar — Vietnamese labels, Clay style**

In `web/src/app/admin/layout.tsx`, replace nav items:

```tsx
const NAV = [
  { href: '/admin/dashboard', label: 'Tổng quan', emoji: '📊' },
  { href: '/admin/orders', label: 'Đơn hàng', emoji: '🧾' },
  { href: '/admin/products', label: 'Sản phẩm', emoji: '📦' },
  { href: '/admin/stock', label: 'Kho', emoji: '🗃️' },
  { href: '/admin/announcements', label: 'Thông báo', emoji: '📣' },
  { href: '/admin/settings', label: 'Cài đặt', emoji: '⚙️' },
]
```

Wrap in:

```tsx
<aside className="w-64 bg-white border-r border-clay-oat min-h-screen p-5">
  <div className="clay-display text-2xl mb-8">Starizzi <span className="text-ube-800">Admin</span></div>
  <nav className="flex flex-col gap-1">
    {NAV.map(item => {
      const active = pathname === item.href
      return (
        <Link key={item.href} href={item.href}
          className={`px-3 py-2 rounded-xl text-sm font-medium transition ${active ? 'bg-clay-ink text-white' : 'text-clay-charcoal hover:bg-clay-oat-light'}`}>
          <span className="mr-2">{item.emoji}</span>{item.label}
        </Link>
      )
    })}
  </nav>
</aside>
```

- [ ] **Step 2: Login — Clay**

In `web/src/app/admin/login/page.tsx`:

```tsx
return (
  <main className="min-h-screen flex items-center justify-center bg-clay-cream">
    <form onSubmit={handleSubmit} className="clay-card p-8 w-full max-w-md">
      <h1 className="clay-display text-3xl mb-1">Đăng nhập Admin</h1>
      <p className="text-clay-charcoal mb-6">Quản lý cửa hàng Starizzi</p>
      <label className="block text-sm font-medium mb-1">Tên đăng nhập</label>
      <input className="clay-input w-full mb-4" value={username} onChange={e => setUsername(e.target.value)} />
      <label className="block text-sm font-medium mb-1">Mật khẩu</label>
      <input type="password" className="clay-input w-full mb-6" value={password} onChange={e => setPassword(e.target.value)} />
      {error && <div className="text-pomegranate-400 text-sm mb-4">{error}</div>}
      <button type="submit" className="clay-btn clay-btn--ink w-full">Đăng nhập</button>
    </form>
  </main>
)
```

- [ ] **Step 3: Dashboard — fix Recharts -1 width bug + Clay**

Wrap chart in fixed-height container so ResponsiveContainer reads dimensions:

```tsx
<div className="clay-card p-6">
  <h3 className="font-semibold mb-4">Doanh thu 30 ngày</h3>
  <div style={{ width: '100%', height: 300 }}>
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData}>
        {/* ...existing axes... */}
      </LineChart>
    </ResponsiveContainer>
  </div>
</div>
```

Stat cards:

```tsx
<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
  {[
    { label: 'Doanh thu hôm nay', value: formatPrice(stats.revenueToday), color: 'matcha' },
    { label: 'Đơn hôm nay', value: stats.ordersToday, color: 'lemon' },
    { label: 'Đang chờ', value: stats.pendingOrders, color: 'ube' },
    { label: 'Tồn kho', value: stats.totalStock, color: 'slushie' },
  ].map((s, i) => (
    <div key={i} className="clay-card p-5" style={{ background: `var(--color-${s.color}-${s.color === 'lemon' ? '400' : s.color === 'ube' ? '300' : s.color === 'matcha' ? '300' : '500'})` }}>
      <div className="text-sm text-clay-charcoal">{s.label}</div>
      <div className="clay-display text-3xl mt-2">{s.value}</div>
    </div>
  ))}
</div>
```

- [ ] **Step 4: Verify chart sizing fixed**

Open `/admin/dashboard` → console: no "width(-1) and height(-1)" warning.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/admin/layout.tsx web/src/app/admin/login/page.tsx web/src/app/admin/dashboard/page.tsx
git commit -m "feat(admin): Clay redesign for sidebar + login + dashboard, fix chart sizing"
```

---

## Task 11: Repaint admin products/orders/stock/announcements/settings tables

**Files:**
- Modify: `web/src/app/admin/products/page.tsx`
- Modify: `web/src/app/admin/orders/page.tsx`
- Modify: `web/src/app/admin/stock/page.tsx`
- Modify: `web/src/app/admin/announcements/page.tsx`
- Modify: `web/src/app/admin/settings/page.tsx`

- [ ] **Step 1: Apply consistent table shell**

In each file, wrap the table:

```tsx
<div className="clay-card p-0 overflow-hidden">
  <table className="w-full">
    <thead className="bg-clay-oat-light border-b border-clay-oat">
      {/* th cells: text-left text-xs uppercase tracking-wider text-clay-charcoal py-3 px-4 */}
    </thead>
    <tbody>
      {/* tr: border-b border-clay-oat-light hover:bg-clay-oat-light/40 */}
    </tbody>
  </table>
</div>
```

Replace primary action buttons with `clay-btn clay-btn--ink`, secondary with `clay-btn`, danger with `clay-btn clay-btn--pomegranate`.

- [ ] **Step 2: Vietnamese headers everywhere**

| Page | Headers |
|------|---------|
| Products | Mã / Tên / Danh mục / Giá / Tồn kho / Trạng thái / Thao tác |
| Orders | Mã đơn / Khách / Sản phẩm / SL / Tổng / Trạng thái / Mã CK / Thời gian / Thao tác |
| Stock | ID / Sản phẩm / Tài khoản / Đã bán / Người mua / Thêm lúc |
| Announcements | Tiêu đề / Nội dung / Người gửi / Đã gửi / Lỗi / Thời gian |
| Settings | Khóa / Giá trị / Cập nhật |

- [ ] **Step 3: Verify**

Click through `/admin/*` routes — confirm Vietnamese headers + Clay styling render.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/admin/products/page.tsx web/src/app/admin/orders/page.tsx web/src/app/admin/stock/page.tsx web/src/app/admin/announcements/page.tsx web/src/app/admin/settings/page.tsx
git commit -m "feat(admin): Clay tables + Vietnamese headers across all admin pages"
```

---

## Task 12: End-to-end smoke test

**Files:** none — verification only.

- [ ] **Step 1: Start full stack**

Run: `npm run dev:all`
Wait for "Starizzi Bot ready" + "ready - started server on http://localhost:3000".

- [ ] **Step 2: Place order via Telegram**

Open bot → `/product` → pick product → pick quantity → confirm bank.
Expected: QR shows code `PNS<id>` where id ≥ 100000.

- [ ] **Step 3: Verify poller detects payment**

Make small test transfer with content `PNS<id>` (or simulate via SQL insert into `transactions` if dev). Within 30s confirm:
- Order status flips to `delivered`
- Customer receives accounts message
- Customer receives usage_instructions message (if product has any)

- [ ] **Step 4: Verify web payment page**

Open `/thanh-toan/<id>` for the same order.
Expected: status flips to delivered without any user action; accounts + usage instructions visible.

- [ ] **Step 5: Verify admin dashboard**

Login at `/admin/login` → dashboard renders without Recharts errors → orders page lists order with status `delivered` → products page lists products with usage instructions field editable.

- [ ] **Step 6: Inspect logs**

Run: `wc -l logs/*.log`
Expected: each file > 0 lines, no ANSI escape codes.

- [ ] **Step 7: Final commit (if doc updates)**

```bash
git add -u
git commit -m "docs: platform overhaul plan complete" --allow-empty
```

---

## Self-Review Notes

- **Spec coverage:** Payment redesign (Tasks 1-3), no user-confirm (Tasks 3, 9), admin CRUD for usage_instructions (Tasks 1, 4), Clay design (Tasks 7-11), Vietnamese (Tasks 8, 10, 11), dev:all logging (Task 6), bug fixes (Task 4 product shape, Task 10 chart sizing).
- **Skipped on purpose (out of scope):** WebSocket real-time, multi-admin roles, AES-256-GCM stock encryption, full unit test suite — defer to follow-up plans.
- **Risk:** Existing pending orders before Task 2 still use `NAP PAY-` codes. Plan continues to match those via a transient regex update? No — current pending orders should be cancelled or expire naturally. Document this in commit body for Task 3.
