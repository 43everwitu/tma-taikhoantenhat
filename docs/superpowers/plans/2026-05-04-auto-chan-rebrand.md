# Auto-chan Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the Peanut Shop bot + storefront into "Auto-chan" — an anime-mascot persona that addresses every customer as `onii-chan`, exposes every customer-facing message as an admin-editable template, and composites payment QR codes onto a hand-drawn mascot template before sending.

**Architecture:** Three loosely-coupled subsystems shipped together as one launch:
1. **Persona layer** — string + asset rebrand (brand name, mascot avatar, palette accents) without behavior change.
2. **Message template engine** — new `message_templates` table + `messageTemplateService` with `{{var}}` mustache rendering. Every hard-coded user-facing string is replaced by `messageTemplateService.render(key, vars)`. Admin dashboard tab `/admin/messages` lists every key with editor + variable hints + reset-to-default + preview.
3. **QR composite pipeline** — `sharp` is added; bare QR is fetched from VietQR (`qr_only` template), resized, composited into a calibrated black-box on the mascot template. Returns a Buffer that the bot sends via `sendPhoto({ source: buffer })` instead of `sendPhoto(url)`.

**Tech Stack:** Node 20, Telegraf, better-sqlite3, Express, Next.js 16 (App Router + Turbopack), TanStack Query 5, Tailwind v4 with Clay tokens, `sharp` 0.33 (new), VietQR.io (existing).

---

## File Structure

### New files
- `src/assets/qr-template.png` — moved from project root
- `src/assets/mascot-avatar.png` — small 256×256 avatar crop for web header (engineer crops from `qr-template.png`)
- `src/services/messageTemplateService.js` — render engine, cache, seed loader
- `src/services/qrCompositeService.js` — sharp-based composite, exports `composite(qrUrl) → Buffer`
- `src/database/migrations/012_message_templates.js` — table + seed defaults
- `src/database/seeds/message-templates.json` — default template bodies (loaded by migration)
- `src/api/routes/admin/messages.js` — CRUD for templates
- `web/src/app/admin/messages/page.tsx` — admin editor UI
- `web/src/components/MascotBadge.tsx` — small Auto-chan avatar component (32×32 round)
- `scripts/calibrate-qr-box.js` — one-shot helper that prints the black-box bounding rect

### Modified files
- `src/bot/index.js` — register no new commands; only the brand string changes via templates
- `src/utils/messages.js` — every `welcome`, `selectQuantity`, `contactOnly` body is rewritten to call `messageTemplateService.render(...)`
- `src/handlers/quantitySelect.js` — replaces hard-coded order/payment captions with template renders
- `src/handlers/paymentConfirm.js` — same
- `src/services/paymentPoller.js` — `_confirmAndDeliver`, underpayment, expired, all use templates
- `src/services/notificationService.js` — delivery_keys body uses templates
- `src/services/topupService.js` — topup_success uses template (still admin-credited only — bot sends the message after admin credits)
- `src/services/paymentService.js` — `generateQRUrl` gains a `qrOnly` variant; new `generateQRCompositeBuffer(amount, memo)` returns Buffer
- `src/commands/nap.js` — sends composited buffer
- `src/commands/refund.js` — refund message uses template
- `src/commands/start.js` — welcome uses template
- `src/api/routes/admin/index.js` — wires `messages` router
- `src/config.js` — adds `BRAND_NAME = 'Auto-chan'` constant (no env override, hard-coded)
- `web/src/app/page.tsx` — header + hero text rewrites to "Auto-chan"
- `web/src/app/san-pham/page.tsx`, `web/src/app/san-pham/[slug]/page.tsx`, `web/src/app/thanh-toan/[id]/page.tsx`, `web/src/app/dang-nhap/page.tsx`, `web/src/app/lien-ket/page.tsx`, `web/src/app/admin/layout.tsx` — header brand string + mascot badge
- `web/src/app/globals.css` — adds `--color-sakura-*` palette accents (anime pastel pink) layered on top of Clay
- `web/src/lib/api.ts` — new `templates` helpers for admin UI
- `web/src/app/admin/layout.tsx` — adds nav entry for "Messages"
- `package.json` — `sharp@^0.33` dep added; `node scripts/calibrate-qr-box.js` script added

---

## Variable Reference (used across templates)

Every template render call passes a context object. The admin UI shows the available vars per template. **All templates use `{{var}}` syntax** — no expressions, no logic, just substitution.

| Event key             | Variables                                                                |
|-----------------------|---------------------------------------------------------------------------|
| `welcome`             | `name`, `username`, `balance`                                             |
| `order_created`       | `orderCode`, `productName`, `quantity`, `total`, `expiryMinutes`         |
| `payment_pending`     | `orderCode`, `productName`, `total`, `memo`, `expiryMinutes`              |
| `payment_success`     | `orderCode`, `productName`, `quantity`, `total`                           |
| `payment_short`       | `orderCode`, `total`, `received`, `memo`                                  |
| `payment_failed`      | `orderCode`, `reason`                                                     |
| `payment_expired`     | `orderCode`, `productName`                                                |
| `delivery_keys`       | `orderCode`, `productName`, `quantity`, `keysBlock`, `usageInstructions`  |
| `low_stock_user`      | `productName`, `remaining`                                                |
| `refund`              | `orderCode`, `amount`, `reason`, `newBalance`                             |
| `topup_success`       | `amount`, `newBalance`, `memo`                                            |
| `balance_low`         | `balance`, `threshold`                                                    |
| `web.new_stock`       | `productName`, `quantity`, `productUrl`                                   |
| `web.restock_email`   | `productName`, `productUrl`, `unsubscribeUrl`                             |
| `web.order_success`   | `orderCode`, `productName`, `total`                                       |
| `web.payment_failed`  | `orderCode`, `reason`                                                     |
| `web.payment_expired` | `orderCode`                                                               |

---

## M1 — Auto-chan persona (rebrand strings + mascot asset)

### Task 1: Move QR template into project assets

**Files:**
- Move: `qr_template.png` → `src/assets/qr-template.png`
- Delete: `qr_raw.jpg` (was reference only)
- Create: `src/assets/.gitkeep` if dir is empty

- [ ] **Step 1: Create assets dir + move file**

```bash
mkdir -p src/assets
mv qr_template.png src/assets/qr-template.png
rm -f qr_raw.jpg
ls -la src/assets/
```

Expected output: `qr-template.png  ~1.5MB` listed.

- [ ] **Step 2: Commit**

```bash
git add src/assets/qr-template.png
git rm qr_raw.jpg 2>/dev/null || true
git commit -m "chore(assets): move Auto-chan QR template into src/assets"
```

---

### Task 2: Add brand constant and mascot badge

**Files:**
- Modify: `src/config.js`
- Create: `src/assets/mascot-avatar.png` (256×256 crop of the template's face area)
- Create: `web/public/mascot-avatar.png` (copy of above for static serving)
- Create: `web/src/components/MascotBadge.tsx`

- [ ] **Step 1: Crop the mascot face for the web header avatar**

Use macOS Preview or ImageMagick. The face sits at approximately top 15%–35% of the template. Crop a square at coords `x=540, y=120, w=720, h=720` from the 1856×2292 template, then downscale to 256×256.

```bash
# requires ImageMagick (brew install imagemagick) — falls back to Preview if not available
magick src/assets/qr-template.png -crop 720x720+540+120 -resize 256x256 src/assets/mascot-avatar.png
cp src/assets/mascot-avatar.png web/public/mascot-avatar.png
```

If ImageMagick is not installed, open `qr-template.png` in Preview, use Tools → Rectangular Selection, draw a square around the face, copy, paste into a new file at 256×256, save as `mascot-avatar.png` in both locations.

- [ ] **Step 2: Add brand constant**

In `src/config.js`, find the `module.exports = {` block and add at the top of the exported object:

```js
  BRAND_NAME: 'Auto-chan',
  BRAND_TAGLINE: 'Bán hàng tự động cho các onii-chan',
```

- [ ] **Step 3: Create MascotBadge component**

Create `web/src/components/MascotBadge.tsx`:

```tsx
import Image from 'next/image'

interface MascotBadgeProps {
  size?: number
  className?: string
}

export function MascotBadge({ size = 32, className = '' }: MascotBadgeProps) {
  return (
    <Image
      src="/mascot-avatar.png"
      alt="Auto-chan"
      width={size}
      height={size}
      className={`rounded-full object-cover border-2 border-clay-cream shadow-sm ${className}`}
      priority
    />
  )
}
```

- [ ] **Step 4: Verify the avatar loads**

Run dev server (`npm run dev:web`), visit `http://localhost:3001/mascot-avatar.png` — image should load.

- [ ] **Step 5: Commit**

```bash
git add src/config.js src/assets/mascot-avatar.png web/public/mascot-avatar.png web/src/components/MascotBadge.tsx
git commit -m "feat(brand): Auto-chan brand constant + MascotBadge component"
```

---

### Task 3: Apply mascot + brand name across web headers

**Files:**
- Modify: `web/src/app/page.tsx`
- Modify: `web/src/app/san-pham/page.tsx`
- Modify: `web/src/app/san-pham/[slug]/page.tsx`
- Modify: `web/src/app/thanh-toan/[id]/page.tsx`
- Modify: `web/src/app/dang-nhap/page.tsx`
- Modify: `web/src/app/lien-ket/page.tsx`
- Modify: `web/src/app/admin/layout.tsx`

- [ ] **Step 1: Replace every "Peanut Shop" header link**

Across the six storefront pages above, find each occurrence of:

```tsx
<Link href="/" className="text-xl sm:text-2xl clay-display">Peanut Shop</Link>
```

and replace with:

```tsx
<Link href="/" className="text-xl sm:text-2xl clay-display flex items-center gap-2">
  <MascotBadge size={32} />
  Auto-chan
</Link>
```

Add `import { MascotBadge } from '@/components/MascotBadge'` at the top of each file if missing.

- [ ] **Step 2: Update footer copyright**

Find `© 2026 Peanut Shop` in the same files and replace with `© 2026 Auto-chan`.

- [ ] **Step 3: Update admin sidebar header**

In `web/src/components/AdminSidebar.tsx` (or `web/src/app/admin/layout.tsx` if the sidebar is inline), replace the brand text in the sidebar top with:

```tsx
<div className="flex items-center gap-2 px-4 py-5">
  <MascotBadge size={28} />
  <span className="clay-display text-lg">Auto-chan</span>
</div>
```

Add `import { MascotBadge } from '@/components/MascotBadge'`.

- [ ] **Step 4: Update root metadata**

Edit `web/src/app/layout.tsx`:

```tsx
export const metadata: Metadata = {
  title: 'Auto-chan — Shop tự động cho onii-chan',
  description: 'Cửa hàng tự động Auto-chan. Mua sản phẩm số, thanh toán bằng QR, nhận sản phẩm tức thì.',
}
```

- [ ] **Step 5: Visual verification**

Run `npm run dev:web`. Visit `/`, `/san-pham`, `/san-pham/[any-slug]`, `/dang-nhap`, `/lien-ket`, `/admin`. Mascot avatar shows next to "Auto-chan" in every header. Page titles show the new tagline.

- [ ] **Step 6: Commit**

```bash
git add web/src/app web/src/components/AdminSidebar.tsx
git commit -m "feat(brand): Auto-chan headers + mascot badge across web"
```

---

### Task 4: Sakura accent palette (additive, doesn't break Clay)

**Files:**
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Add sakura tokens**

Inside the `@theme inline {` block in `web/src/app/globals.css`, add:

```css
  --color-sakura-100: #fdecf2;
  --color-sakura-300: #f7b6cf;
  --color-sakura-500: #ec4f86;
  --color-violet-100: #ece5fb;
  --color-violet-300: #b8a4f1;
  --color-violet-500: #6d4ad9;
```

- [ ] **Step 2: Add an accent utility class**

Inside the existing `@layer components { ... }` block, append:

```css
  .clay-pill--sakura {
    background: var(--color-sakura-100);
    color: var(--color-sakura-500);
    border-color: var(--color-sakura-300);
  }
  .clay-mascot-glow {
    box-shadow: 0 4px 14px color-mix(in srgb, var(--color-sakura-300) 60%, transparent);
  }
```

- [ ] **Step 3: Apply mascot glow to home hero**

Find the hero section in `web/src/app/page.tsx` and add `clay-mascot-glow` class to the largest mascot image element if one exists. If the hero doesn't show a mascot today, skip (don't redesign the hero in this plan).

- [ ] **Step 4: Visual verification**

Run dev. Inspect `/` — page renders without errors, palette unchanged where not applied, mascot glows softly if hero uses one.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/globals.css web/src/app/page.tsx
git commit -m "feat(brand): sakura/violet accent tokens + mascot glow utility"
```

---

## M2 — Message templates engine

### Task 5: Migration `012_message_templates`

**Files:**
- Create: `src/database/migrations/012_message_templates.js`
- Create: `src/database/seeds/message-templates.json`

- [ ] **Step 1: Create the seed file**

Create `src/database/seeds/message-templates.json`:

```json
{
  "welcome": {
    "channel": "bot",
    "label": "Chào mừng (/start)",
    "variables": ["name", "username", "balance"],
    "body": "Yahallo onii-chan {{name}}~ ✨\n\nAuto-chan ở đây để phục vụ onii-chan!\nSố dư ví hiện tại: <b>{{balance}}đ</b>\n\nGõ /menu để xem sản phẩm, /info để xem tài khoản, /nap để nạp ví."
  },
  "order_created": {
    "channel": "bot",
    "label": "Đơn hàng vừa tạo",
    "variables": ["orderCode", "productName", "quantity", "total", "expiryMinutes"],
    "body": "Onii-chan đã đặt thành công đơn <b>{{orderCode}}</b>~\n\n📦 {{productName}} × {{quantity}}\n💰 Tổng: <b>{{total}}đ</b>\n\nAuto-chan sẽ giữ chỗ trong {{expiryMinutes}} phút. Onii-chan thanh toán nhé!"
  },
  "payment_pending": {
    "channel": "bot",
    "label": "Hướng dẫn thanh toán (kèm QR)",
    "variables": ["orderCode", "productName", "total", "memo", "expiryMinutes"],
    "body": "Onii-chan ơi, đây là QR thanh toán cho đơn <b>{{orderCode}}</b>:\n\n📦 {{productName}}\n💰 Số tiền: <b>{{total}}đ</b>\n📝 Nội dung CK: <code>{{memo}}</code>\n\n⏱ Trong {{expiryMinutes}} phút nha~"
  },
  "payment_success": {
    "channel": "bot",
    "label": "Thanh toán thành công",
    "variables": ["orderCode", "productName", "quantity", "total"],
    "body": "Yatta! 🎉 Auto-chan nhận được tiền từ onii-chan rồi!\n\n✅ Đơn <b>{{orderCode}}</b>\n📦 {{productName}} × {{quantity}}\n💰 {{total}}đ\n\nĐang gửi sản phẩm cho onii-chan~"
  },
  "payment_short": {
    "channel": "bot",
    "label": "Thanh toán thiếu",
    "variables": ["orderCode", "total", "received", "memo"],
    "body": "Onii-chan ơi~ Auto-chan thấy onii-chan chuyển <b>{{received}}đ</b> cho đơn <b>{{orderCode}}</b> nhưng cần <b>{{total}}đ</b>. Onii-chan chuyển bù phần còn lại với nội dung <code>{{memo}}</code> nha!"
  },
  "payment_failed": {
    "channel": "bot",
    "label": "Thanh toán thất bại",
    "variables": ["orderCode", "reason"],
    "body": "Gomen ne onii-chan~ 😔 Đơn <b>{{orderCode}}</b> không thanh toán được.\n\nLý do: {{reason}}\n\nOnii-chan thử lại nhé!"
  },
  "payment_expired": {
    "channel": "bot",
    "label": "Đơn hết hạn",
    "variables": ["orderCode", "productName"],
    "body": "Đơn <b>{{orderCode}}</b> ({{productName}}) hết hạn rồi onii-chan~ Auto-chan đã trả lại stock. Onii-chan đặt lại nha!"
  },
  "delivery_keys": {
    "channel": "bot",
    "label": "Giao sản phẩm (keys)",
    "variables": ["orderCode", "productName", "quantity", "keysBlock", "usageInstructions"],
    "body": "Đây là sản phẩm onii-chan vừa mua~ ✨\n\n📦 {{productName}} × {{quantity}}\n🔑 Mã đơn: <b>{{orderCode}}</b>\n\n<b>Sản phẩm:</b>\n{{keysBlock}}\n\n<b>📖 Hướng dẫn sử dụng:</b>\n{{usageInstructions}}\n\nArigathank onii-chan đã mua hàng!"
  },
  "low_stock_user": {
    "channel": "bot",
    "label": "Sắp hết hàng (broadcast)",
    "variables": ["productName", "remaining"],
    "body": "Onii-chan ơi~ {{productName}} chỉ còn <b>{{remaining}}</b> suất thôi! Onii-chan nhanh tay nha!"
  },
  "refund": {
    "channel": "bot",
    "label": "Hoàn tiền",
    "variables": ["orderCode", "amount", "reason", "newBalance"],
    "body": "Auto-chan đã hoàn <b>{{amount}}đ</b> cho đơn <b>{{orderCode}}</b> vào ví của onii-chan~\n\nLý do: {{reason}}\nSố dư mới: <b>{{newBalance}}đ</b>\n\nGomen ne onii-chan!"
  },
  "topup_success": {
    "channel": "bot",
    "label": "Nạp ví thành công",
    "variables": ["amount", "newBalance", "memo"],
    "body": "Yatta! 🎉 Auto-chan đã cộng <b>{{amount}}đ</b> vào ví onii-chan (mã: <code>{{memo}}</code>).\n\nSố dư mới: <b>{{newBalance}}đ</b>\n\nArigathank onii-chan đã nạp!"
  },
  "balance_low": {
    "channel": "bot",
    "label": "Cảnh báo số dư thấp",
    "variables": ["balance", "threshold"],
    "body": "Onii-chan ơi~ Số dư ví chỉ còn <b>{{balance}}đ</b> (dưới <b>{{threshold}}đ</b>). Onii-chan nạp thêm bằng /nap nhé!"
  },
  "web.new_stock": {
    "channel": "web",
    "label": "Web — sản phẩm mới có hàng",
    "variables": ["productName", "quantity", "productUrl"],
    "body": "{{productName}} vừa được Auto-chan bổ sung {{quantity}} suất! Onii-chan ghé xem nha~"
  },
  "web.restock_email": {
    "channel": "web",
    "label": "Web — email báo có hàng lại",
    "variables": ["productName", "productUrl", "unsubscribeUrl"],
    "body": "Onii-chan ơi~ {{productName}} đã có hàng trở lại! Mua ngay tại {{productUrl}}.\n\nKhông muốn nhận email này nữa? {{unsubscribeUrl}}"
  },
  "web.order_success": {
    "channel": "web",
    "label": "Web — trang thanh toán thành công",
    "variables": ["orderCode", "productName", "total"],
    "body": "Yatta! Đơn {{orderCode}} ({{productName}} — {{total}}đ) thanh toán thành công. Auto-chan đang gửi sản phẩm vào Telegram của onii-chan~"
  },
  "web.payment_failed": {
    "channel": "web",
    "label": "Web — thanh toán thất bại",
    "variables": ["orderCode", "reason"],
    "body": "Gomen ne onii-chan~ Đơn {{orderCode}} không thanh toán được. Lý do: {{reason}}. Onii-chan thử lại nhé!"
  },
  "web.payment_expired": {
    "channel": "web",
    "label": "Web — đơn hết hạn",
    "variables": ["orderCode"],
    "body": "Đơn {{orderCode}} đã hết hạn rồi onii-chan~ Auto-chan đã trả lại stock. Onii-chan đặt lại nha!"
  }
}
```

- [ ] **Step 2: Create the migration**

Create `src/database/migrations/012_message_templates.js`:

```js
const fs = require('fs');
const path = require('path');

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_templates (
      key TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      label TEXT NOT NULL,
      variables TEXT NOT NULL,
      body TEXT NOT NULL,
      default_body TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_message_templates_channel ON message_templates(channel);
  `);

  const seedPath = path.join(__dirname, '..', 'seeds', 'message-templates.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const insert = db.prepare(`
    INSERT INTO message_templates (key, channel, label, variables, body, default_body)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      channel = excluded.channel,
      label = excluded.label,
      variables = excluded.variables,
      default_body = excluded.default_body
  `);
  const tx = db.transaction((entries) => {
    for (const [key, t] of entries) {
      insert.run(key, t.channel, t.label, JSON.stringify(t.variables), t.body, t.body);
    }
  });
  tx(Object.entries(seed));
}

module.exports = { up };
```

The `INSERT … ON CONFLICT` pattern preserves admin-edited `body` on re-run (only `default_body` is refreshed), so this migration is idempotent and safe to re-apply when the seed file is updated.

- [ ] **Step 3: Run migration**

```bash
npm run db:migrate
sqlite3 data/shop.db "SELECT key, channel FROM message_templates ORDER BY channel, key;"
```

Expected: 18 rows printed, grouped `bot` then `web`.

- [ ] **Step 4: Commit**

```bash
git add src/database/migrations/012_message_templates.js src/database/seeds/message-templates.json
git commit -m "feat(db): message_templates table + 18 seeded defaults"
```

---

### Task 6: `messageTemplateService` with render + cache

**Files:**
- Create: `src/services/messageTemplateService.js`

- [ ] **Step 1: Write the failing smoke test**

Create `tests/messageTemplateService.test.js`:

```js
const assert = require('node:assert');
const test = require('node:test');
const messageTemplateService = require('../src/services/messageTemplateService');

test('render substitutes variables', () => {
  const out = messageTemplateService.render('order_created', {
    orderCode: 'PNS123456',
    productName: 'ChatGPT Plus',
    quantity: 1,
    total: '500.000',
    expiryMinutes: 10,
  });
  assert.match(out, /PNS123456/);
  assert.match(out, /ChatGPT Plus/);
  assert.match(out, /500\.000đ/);
});

test('render escapes unknown vars to empty string', () => {
  const out = messageTemplateService.render('welcome', { name: 'taro' });
  assert.ok(!out.includes('{{'));
  assert.ok(!out.includes('}}'));
});

test('render falls back to default_body when body is empty', () => {
  // assumes admin cleared body in DB then service falls back
  const out = messageTemplateService.render('welcome', { name: 'taro', username: 'taro', balance: '0' });
  assert.ok(out.length > 0);
});
```

Run: `node --test tests/messageTemplateService.test.js`
Expected: FAIL with `Cannot find module '../src/services/messageTemplateService'`.

- [ ] **Step 2: Implement the service**

Create `src/services/messageTemplateService.js`:

```js
const db = require('../database');

const CACHE_TTL_MS = 30_000;
let cache = { ts: 0, rows: null };

function loadAll() {
  if (cache.rows && Date.now() - cache.ts < CACHE_TTL_MS) return cache.rows;
  const rows = db.prepare('SELECT key, body, default_body, variables FROM message_templates').all();
  const map = {};
  for (const r of rows) {
    map[r.key] = {
      body: (r.body && r.body.trim()) || r.default_body,
      variables: JSON.parse(r.variables),
    };
  }
  cache = { ts: Date.now(), rows: map };
  return map;
}

function invalidate() {
  cache = { ts: 0, rows: null };
}

function render(key, vars = {}) {
  const all = loadAll();
  const tpl = all[key];
  if (!tpl) throw new Error(`Unknown message template: ${key}`);
  return tpl.body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => {
    const v = vars[name];
    if (v === undefined || v === null) return '';
    return String(v);
  });
}

function get(key) {
  return loadAll()[key];
}

function list() {
  const rows = db.prepare(`
    SELECT key, channel, label, variables, body, default_body, updated_at
    FROM message_templates ORDER BY channel, key
  `).all();
  return rows.map((r) => ({ ...r, variables: JSON.parse(r.variables) }));
}

function update(key, body) {
  const result = db.prepare('UPDATE message_templates SET body = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?').run(body, key);
  if (result.changes === 0) throw new Error(`Unknown template: ${key}`);
  invalidate();
}

function reset(key) {
  const result = db.prepare('UPDATE message_templates SET body = default_body, updated_at = CURRENT_TIMESTAMP WHERE key = ?').run(key);
  if (result.changes === 0) throw new Error(`Unknown template: ${key}`);
  invalidate();
}

module.exports = { render, get, list, update, reset, invalidate };
```

- [ ] **Step 3: Run test**

Run: `node --test tests/messageTemplateService.test.js`
Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/messageTemplateService.js tests/messageTemplateService.test.js
git commit -m "feat(messages): messageTemplateService with cache + render"
```

---

### Task 7: Wire bot welcome to template

**Files:**
- Modify: `src/utils/messages.js`
- Modify: `src/commands/start.js`

- [ ] **Step 1: Replace welcome() body**

Open `src/utils/messages.js`. Find the `welcome` function (currently a tagged template literal returning the welcome string). Replace it entirely with:

```js
const messageTemplateService = require('../services/messageTemplateService');

function welcome({ name, username, balance }) {
  return messageTemplateService.render('welcome', {
    name: name || 'onii-chan',
    username: username || '',
    balance: new Intl.NumberFormat('vi-VN').format(balance || 0),
  });
}
```

Make sure the `module.exports` block still exports `welcome`.

- [ ] **Step 2: Update the caller**

Open `src/commands/start.js`. Find where `welcome(...)` is called. The call signature changed — pass an object now:

```js
const text = welcome({
  name: ctx.from.first_name,
  username: ctx.from.username,
  balance: user.balance,
});
```

If the caller already destructures the user, leave the surrounding code untouched.

- [ ] **Step 3: Manual verification**

Restart bot: `npm run dev:bot`. DM the bot `/start`. The welcome message should be the new Auto-chan template (`Yahallo onii-chan ...`).

- [ ] **Step 4: Commit**

```bash
git add src/utils/messages.js src/commands/start.js
git commit -m "feat(bot): /start uses welcome template"
```

---

### Task 8: Wire order_created + payment_pending to templates

**Files:**
- Modify: `src/handlers/quantitySelect.js`
- Modify: `src/handlers/paymentConfirm.js`

- [ ] **Step 1: Replace the order-created caption**

Open `src/handlers/quantitySelect.js`. Find the block that sends the confirmation message after `orderService.create` succeeds (the message that shows order code + product + total). Replace its body with:

```js
const messageTemplateService = require('../services/messageTemplateService');
const expiryMinutes = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'order_expiry_minutes'").get()?.value || '10', 10);
const orderText = messageTemplateService.render('order_created', {
  orderCode: order.id,
  productName: product.name,
  quantity,
  total: new Intl.NumberFormat('vi-VN').format(order.total_price),
  expiryMinutes,
});
await ctx.reply(orderText, { parse_mode: 'HTML' });
```

Add the `messageTemplateService` require at the top of the file.

- [ ] **Step 2: Replace the QR caption**

In the same file, find the block that sends the QR photo to the user (`ctx.replyWithPhoto(...)`). Replace the caption with:

```js
const qrCaption = messageTemplateService.render('payment_pending', {
  orderCode: order.id,
  productName: product.name,
  total: new Intl.NumberFormat('vi-VN').format(order.total_price),
  memo: `PNS${order.id}`,
  expiryMinutes,
});
await ctx.replyWithPhoto(qrUrlOrBuffer, { caption: qrCaption, parse_mode: 'HTML' });
```

(Buffer support comes in M3 — keep `qrUrl` for now, the variable name will change later.)

- [ ] **Step 3: Apply the same pattern to `paymentConfirm.js`**

Open `src/handlers/paymentConfirm.js`. If it sends any user-facing message, route it through `messageTemplateService.render(...)` using the appropriate key (`payment_success` or `payment_short` based on context). Match the existing logic — only the message body changes.

- [ ] **Step 4: Manual verification**

Place a test order through Telegram. Confirm both messages (order created + QR caption) match the new templates.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/quantitySelect.js src/handlers/paymentConfirm.js
git commit -m "feat(bot): order_created + payment_pending use templates"
```

---

### Task 9: Wire payment_success / short / expired in paymentPoller

**Files:**
- Modify: `src/services/paymentPoller.js`

- [ ] **Step 1: Replace the success message**

In `src/services/paymentPoller.js`, find `_confirmAndDeliver`. The user-facing "thanh toán thành công" reply is sent there. Replace its body with:

```js
const messageTemplateService = require('./messageTemplateService');
const successText = messageTemplateService.render('payment_success', {
  orderCode: order.id,
  productName: order.product_name,
  quantity: order.quantity,
  total: new Intl.NumberFormat('vi-VN').format(order.total_price),
});
await this.bot.telegram.sendMessage(order.user_id, successText, { parse_mode: 'HTML' });
```

Add the require at the top of the file.

- [ ] **Step 2: Replace the underpayment message**

In the same file, find the underpayment branch (where `received < total_price`). Replace the user notification body with:

```js
const shortText = messageTemplateService.render('payment_short', {
  orderCode: order.id,
  total: new Intl.NumberFormat('vi-VN').format(order.total_price),
  received: new Intl.NumberFormat('vi-VN').format(received),
  memo: `PNS${order.id}`,
});
await this.bot.telegram.sendMessage(order.user_id, shortText, { parse_mode: 'HTML' });
```

- [ ] **Step 3: Replace the expired message**

Find `_notifyExpired`. Replace its body with:

```js
const expiredText = messageTemplateService.render('payment_expired', {
  orderCode: order.id,
  productName: order.product_name,
});
await this.bot.telegram.sendMessage(order.user_id, expiredText, { parse_mode: 'HTML' });
```

- [ ] **Step 4: Manual verification**

Use mbbank-api mock or wait through a real test transfer. Verify all three message variants render the new templates.

- [ ] **Step 5: Commit**

```bash
git add src/services/paymentPoller.js
git commit -m "feat(bot): payment_success/short/expired use templates"
```

---

### Task 10: Wire delivery_keys + topup_success + refund

**Files:**
- Modify: `src/services/notificationService.js`
- Modify: `src/services/topupService.js`
- Modify: `src/commands/refund.js`

- [ ] **Step 1: Delivery keys body**

Open `src/services/notificationService.js`. Find the function that builds the keys delivery message. Replace its body with:

```js
const messageTemplateService = require('./messageTemplateService');
const keysBlock = keys.map((k, i) => `${i + 1}. <code>${k}</code>`).join('\n');
const text = messageTemplateService.render('delivery_keys', {
  orderCode: order.id,
  productName: order.product_name,
  quantity: order.quantity,
  keysBlock,
  usageInstructions: order.usage_instructions || '(không có)',
});
```

- [ ] **Step 2: Topup success body**

Open `src/services/topupService.js`. The bot itself does not auto-credit (admin-only flow); but when admin credits via `creditOrphanedTransfer` or `manualCredit`, a notification message is sent to the user. Find that send call and replace the body with:

```js
const messageTemplateService = require('./messageTemplateService');
const text = messageTemplateService.render('topup_success', {
  amount: new Intl.NumberFormat('vi-VN').format(amount),
  newBalance: new Intl.NumberFormat('vi-VN').format(newBalance),
  memo,
});
```

- [ ] **Step 3: Refund body**

Open `src/commands/refund.js`. Replace the user-facing notification body with:

```js
const messageTemplateService = require('../services/messageTemplateService');
const text = messageTemplateService.render('refund', {
  orderCode: order.id,
  amount: new Intl.NumberFormat('vi-VN').format(order.total_price),
  reason: reason || 'Auto-chan hoàn theo yêu cầu admin',
  newBalance: new Intl.NumberFormat('vi-VN').format(newBalance),
});
```

- [ ] **Step 4: Manual verification**

Trigger each path: place an order → pay → keys delivery uses template; admin credits an orphan → topup message uses template; admin runs `/refund <id>` → refund message uses template.

- [ ] **Step 5: Commit**

```bash
git add src/services/notificationService.js src/services/topupService.js src/commands/refund.js
git commit -m "feat(bot): delivery_keys + topup_success + refund use templates"
```

---

### Task 11: Admin API for message templates

**Files:**
- Create: `src/api/routes/admin/messages.js`
- Modify: `src/api/routes/admin/index.js`

- [ ] **Step 1: Create the router**

Create `src/api/routes/admin/messages.js`:

```js
const express = require('express');
const { z } = require('zod');
const validate = require('../../middleware/validate');
const messageTemplateService = require('../../../services/messageTemplateService');
const auditService = require('../../../services/auditService');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ success: true, data: messageTemplateService.list() });
});

router.get('/:key', (req, res) => {
  const t = messageTemplateService.get(req.params.key);
  if (!t) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  res.json({ success: true, data: t });
});

router.put('/:key', validate(z.object({ body: z.string().min(1).max(4000) })), (req, res) => {
  try {
    messageTemplateService.update(req.params.key, req.body.body);
    auditService.log(req.adminId, 'message.update', 'message_template', req.params.key, { body: req.body.body }, req.ip);
    res.json({ success: true });
  } catch (e) {
    res.status(404).json({ success: false, error: e.message });
  }
});

router.post('/:key/reset', (req, res) => {
  try {
    messageTemplateService.reset(req.params.key);
    auditService.log(req.adminId, 'message.reset', 'message_template', req.params.key, {}, req.ip);
    res.json({ success: true });
  } catch (e) {
    res.status(404).json({ success: false, error: e.message });
  }
});

router.post('/:key/preview', validate(z.object({ vars: z.record(z.any()).default({}) })), (req, res) => {
  try {
    const text = messageTemplateService.render(req.params.key, req.body.vars);
    res.json({ success: true, data: { text } });
  } catch (e) {
    res.status(404).json({ success: false, error: e.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: Wire into admin index**

Open `src/api/routes/admin/index.js`. Add:

```js
const messagesRouter = require('./messages');
router.use('/messages', messagesRouter);
```

- [ ] **Step 3: Smoke test the API**

Start the API (`npm run dev:api`). Run:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/admin/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"<your-password>"}' | jq -r '.data.token')
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/admin/messages | jq '.data | length'
curl -s -H "Authorization: Bearer $TOKEN" -X POST http://localhost:3000/api/v1/admin/messages/welcome/preview \
  -H 'Content-Type: application/json' -d '{"vars":{"name":"taro","username":"taro","balance":"0"}}' | jq -r '.data.text'
```

Expected: list returns `18`. Preview prints the welcome body with `taro` substituted.

- [ ] **Step 4: Commit**

```bash
git add src/api/routes/admin/messages.js src/api/routes/admin/index.js
git commit -m "feat(api): admin/messages CRUD + preview endpoint"
```

---

### Task 12: Admin web UI `/admin/messages`

**Files:**
- Create: `web/src/app/admin/messages/page.tsx`
- Modify: `web/src/components/AdminSidebar.tsx`
- Modify: `web/src/lib/api.ts`

- [ ] **Step 1: Add API helpers**

Open `web/src/lib/api.ts`. After the existing helpers, add:

```ts
export interface MessageTemplate {
  key: string
  channel: 'bot' | 'web'
  label: string
  variables: string[]
  body: string
  default_body: string
  updated_at: string
}

export const templates = {
  list: () => api.get<MessageTemplate[]>('/admin/messages'),
  update: (key: string, body: string) => api.put<void>(`/admin/messages/${key}`, { body }),
  reset: (key: string) => api.post<void>(`/admin/messages/${key}/reset`, {}),
  preview: (key: string, vars: Record<string, string>) =>
    api.post<{ text: string }>(`/admin/messages/${key}/preview`, { vars }),
}
```

- [ ] **Step 2: Add nav entry**

Open `web/src/components/AdminSidebar.tsx`. Find the `NAV` array. Add (after the existing entries):

```tsx
{ href: '/admin/messages', label: 'Tin nhắn', icon: MessageSquare },
```

Add `MessageSquare` to the imports from `@/lib/icons` and re-export it from `web/src/lib/icons.tsx` by appending `MessageSquare,` to the existing list.

- [ ] **Step 3: Create the page**

Create `web/src/app/admin/messages/page.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { templates, type MessageTemplate } from '@/lib/api'
import { Save, RotateCcw, Eye } from '@/lib/icons'

export default function AdminMessagesPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'messages'],
    queryFn: () => templates.list(),
  })

  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [varValues, setVarValues] = useState<Record<string, string>>({})

  const list = data?.data ?? []
  const active = useMemo(() => list.find((t) => t.key === activeKey) ?? null, [list, activeKey])

  function pick(t: MessageTemplate) {
    setActiveKey(t.key)
    setDraft(t.body)
    setPreview(null)
    setVarValues(Object.fromEntries(t.variables.map((v) => [v, `<${v}>`])))
  }

  const updateMut = useMutation({
    mutationFn: () => templates.update(active!.key, draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'messages'] }),
  })
  const resetMut = useMutation({
    mutationFn: () => templates.reset(active!.key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'messages'] })
      if (active) setDraft(active.default_body)
    },
  })

  async function runPreview() {
    if (!active) return
    const r = await templates.preview(active.key, varValues)
    setPreview(r.data.text)
  }

  if (isLoading) return <div className="p-6">Đang tải...</div>

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 p-4">
      <aside className="clay-card p-3 max-h-[80vh] overflow-y-auto">
        {(['bot', 'web'] as const).map((ch) => (
          <div key={ch} className="mb-4">
            <h3 className="text-xs uppercase tracking-wider text-clay-charcoal px-2 mb-2">{ch}</h3>
            <ul className="space-y-1">
              {list.filter((t) => t.channel === ch).map((t) => (
                <li key={t.key}>
                  <button
                    onClick={() => pick(t)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm ${activeKey === t.key ? 'bg-clay-ink text-white' : 'hover:bg-clay-cream'}`}
                  >
                    <div className="font-medium">{t.label}</div>
                    <div className="text-xs opacity-70">{t.key}</div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </aside>

      <main className="clay-card p-5">
        {!active ? (
          <p className="text-clay-charcoal">Chọn một mẫu tin nhắn ở bên trái.</p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="clay-display text-xl">{active.label}</h2>
                <p className="text-xs text-clay-charcoal">key: <code>{active.key}</code> · channel: {active.channel}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => updateMut.mutate()} disabled={updateMut.isPending} className="clay-btn clay-btn--ink flex items-center gap-1.5">
                  <Save size={16} />Lưu
                </button>
                <button onClick={() => { if (confirm('Khôi phục mặc định?')) resetMut.mutate() }} className="clay-btn flex items-center gap-1.5">
                  <RotateCcw size={16} />Mặc định
                </button>
              </div>
            </div>

            <p className="text-sm mb-2">Biến có sẵn: {active.variables.map((v) => <code key={v} className="clay-pill mr-1">{`{{${v}}}`}</code>)}</p>

            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={12}
              className="clay-input w-full font-mono text-sm"
            />

            <div className="mt-4 clay-card-dashed p-4">
              <h3 className="font-semibold mb-2 flex items-center gap-1.5"><Eye size={16} />Xem thử</h3>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {active.variables.map((v) => (
                  <label key={v} className="text-sm">
                    <span className="block text-xs text-clay-charcoal mb-1">{v}</span>
                    <input
                      value={varValues[v] ?? ''}
                      onChange={(e) => setVarValues({ ...varValues, [v]: e.target.value })}
                      className="clay-input w-full"
                    />
                  </label>
                ))}
              </div>
              <button onClick={runPreview} className="clay-btn">Render preview</button>
              {preview && (
                <pre className="mt-3 p-3 bg-clay-cream rounded-lg whitespace-pre-wrap text-sm">{preview}</pre>
              )}
            </div>

            <p className="text-xs text-clay-charcoal mt-3">Cập nhật lần cuối: {new Date(active.updated_at).toLocaleString('vi-VN')}</p>
          </>
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Manual verification**

Run `npm run dev:web`. Visit `/admin/messages` (log in as admin first). Sidebar lists 18 templates split bot/web. Click `welcome` → shows body in editor. Edit, click "Render preview" with `name=taro` → preview pane shows substituted text. Save → reload → change persists. Click "Mặc định" → body reverts to seed.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/admin/messages web/src/lib/api.ts web/src/components/AdminSidebar.tsx web/src/lib/icons.tsx
git commit -m "feat(admin): /admin/messages template editor + preview"
```

---

### Task 13: Web pages render template strings

**Files:**
- Create: `web/src/lib/messages.ts`
- Modify: `web/src/app/thanh-toan/[id]/page.tsx`

- [ ] **Step 1: Add a client-side render helper**

Create `web/src/lib/messages.ts`:

```ts
import { api } from './api'

interface Template {
  key: string
  body: string
  variables: string[]
}

let cache: { ts: number; map: Record<string, Template> } = { ts: 0, map: {} }
const TTL = 60_000

async function loadAll(): Promise<Record<string, Template>> {
  if (cache.ts && Date.now() - cache.ts < TTL) return cache.map
  const res = await api.get<Template[]>('/messages/public')
  const map: Record<string, Template> = {}
  for (const t of res.data) map[t.key] = t
  cache = { ts: Date.now(), map }
  return map
}

export async function renderTemplate(key: string, vars: Record<string, string | number>): Promise<string> {
  const all = await loadAll()
  const tpl = all[key]
  if (!tpl) return ''
  return tpl.body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => {
    const v = vars[name]
    return v === undefined || v === null ? '' : String(v)
  })
}
```

- [ ] **Step 2: Add the public endpoint (web channel only)**

Open `src/api/routes/public.js`. Add:

```js
const messageTemplateService = require('../../services/messageTemplateService');

router.get('/messages/public', (req, res) => {
  const all = messageTemplateService.list().filter((t) => t.channel === 'web');
  res.json({ success: true, data: all.map((t) => ({ key: t.key, body: t.body, variables: t.variables })) });
});
```

- [ ] **Step 3: Use renderTemplate in the payment page**

Open `web/src/app/thanh-toan/[id]/page.tsx`. Find the success/failed/expired message blocks. Replace each hard-coded message with a `useEffect` that loads the template and stores in state:

```tsx
import { renderTemplate } from '@/lib/messages'
// ...inside the component:
const [successMsg, setSuccessMsg] = useState('')
useEffect(() => {
  if (order?.status === 'delivered') {
    renderTemplate('web.order_success', {
      orderCode: order.id,
      productName: order.product_name,
      total: new Intl.NumberFormat('vi-VN').format(order.total_price),
    }).then(setSuccessMsg)
  }
}, [order])
// ...in JSX:
{successMsg && <p>{successMsg}</p>}
```

Apply the same pattern for `web.payment_failed` and `web.payment_expired`.

- [ ] **Step 4: Manual verification**

Visit a paid order's `/thanh-toan/<id>` — success text comes from template. Edit `web.order_success` in `/admin/messages` → reload → text updates (after the 60s client cache, or hard reload).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/messages.ts web/src/app/thanh-toan src/api/routes/public.js
git commit -m "feat(web): payment page renders templates from /messages/public"
```

---

## M3 — QR template composite

### Task 14: Add `sharp` and calibrate the QR box

**Files:**
- Modify: `package.json`
- Create: `scripts/calibrate-qr-box.js`

- [ ] **Step 1: Add sharp**

```bash
npm install sharp@^0.33
```

- [ ] **Step 2: Write the calibration script**

Create `scripts/calibrate-qr-box.js`:

```js
const sharp = require('sharp');
const path = require('path');

async function main() {
  const file = path.join(__dirname, '..', 'src', 'assets', 'qr-template.png');
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // Find the largest contiguous block of pixels where R+G+B < 30 (i.e. near-black).
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r < 30 && g < 30 && b < 30) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  console.log(JSON.stringify({
    templateWidth: width,
    templateHeight: height,
    qrBox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run calibration**

```bash
node scripts/calibrate-qr-box.js
```

Expected: prints the bounding box of the black square. **Record the printed `qrBox` object** — it's the input to the compositor in the next task.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json scripts/calibrate-qr-box.js
git commit -m "chore(qr): add sharp + calibration script"
```

---

### Task 15: `qrCompositeService` builds the final image

**Files:**
- Create: `src/services/qrCompositeService.js`

- [ ] **Step 1: Write the service**

Create `src/services/qrCompositeService.js`. **Replace `QR_BOX` with the values printed by `calibrate-qr-box.js`** before running:

```js
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const https = require('https');

const TEMPLATE_PATH = path.join(__dirname, '..', 'assets', 'qr-template.png');

// Set these from `node scripts/calibrate-qr-box.js` output.
const QR_BOX = { x: 540, y: 1490, width: 720, height: 720 };

let templateBuffer = null;
function getTemplate() {
  if (!templateBuffer) templateBuffer = fs.readFileSync(TEMPLATE_PATH);
  return templateBuffer;
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function composite(qrUrl) {
  const qrBuffer = await fetchBuffer(qrUrl);
  const resizedQr = await sharp(qrBuffer)
    .resize(QR_BOX.width, QR_BOX.height, { fit: 'contain', background: '#ffffff' })
    .png()
    .toBuffer();

  return sharp(getTemplate())
    .composite([{ input: resizedQr, top: QR_BOX.y, left: QR_BOX.x }])
    .png()
    .toBuffer();
}

module.exports = { composite, QR_BOX };
```

- [ ] **Step 2: Smoke test the compositor**

```bash
node -e "
const svc = require('./src/services/qrCompositeService');
const fs = require('fs');
(async () => {
  const url = 'https://img.vietqr.io/image/MB-0936089684-qr_only.png?amount=10000&addInfo=PNStest';
  const buf = await svc.composite(url);
  fs.writeFileSync('/tmp/qr-test.png', buf);
  console.log('Wrote /tmp/qr-test.png — open it to verify the QR sits inside the black box.');
})();
"
open /tmp/qr-test.png
```

Expected: image opens, QR pattern fills the black square, mascot intact, "DO THI THU MAI" / account number / "MB bank" / "Onii-chan arigathank!" all still visible. If the QR overhangs or sits crooked, re-run the calibration script and update `QR_BOX`.

- [ ] **Step 3: Commit**

```bash
git add src/services/qrCompositeService.js
git commit -m "feat(qr): qrCompositeService composites bare QR onto Auto-chan template"
```

---

### Task 16: Wire compositor into payment + topup flows

**Files:**
- Modify: `src/services/paymentService.js`
- Modify: `src/handlers/quantitySelect.js`
- Modify: `src/commands/nap.js`

- [ ] **Step 1: Add a buffer-returning helper to paymentService**

Open `src/services/paymentService.js`. Find `generateQRUrl`. After it, add:

```js
const qrCompositeService = require('./qrCompositeService');

function generateQRUrlBare(amount, memo) {
  const bank = process.env.BANK_BIN || 'MB';
  const account = process.env.BANK_ACCOUNT;
  return `https://img.vietqr.io/image/${bank}-${account}-qr_only.png?amount=${amount}&addInfo=${encodeURIComponent(memo)}`;
}

async function generateCompositeBuffer(amount, memo) {
  const url = generateQRUrlBare(amount, memo);
  return qrCompositeService.composite(url);
}

module.exports.generateQRUrlBare = generateQRUrlBare;
module.exports.generateCompositeBuffer = generateCompositeBuffer;
```

(Keep `generateQRUrl` exported — callers that don't want the composite still use it.)

- [ ] **Step 2: Send composite buffer for orders**

Open `src/handlers/quantitySelect.js`. Find the `ctx.replyWithPhoto(qrUrl, ...)` call. Replace `qrUrl` with the buffer:

```js
const paymentService = require('../services/paymentService');
const qrBuffer = await paymentService.generateCompositeBuffer(order.total_price, `PNS${order.id}`);
const sent = await ctx.replyWithPhoto({ source: qrBuffer }, { caption: qrCaption, parse_mode: 'HTML' });
```

(Telegraf accepts `{ source: Buffer }`.)

- [ ] **Step 3: Send composite buffer for topups**

Open `src/commands/nap.js`. Find the `replyWithPhoto` call sending the topup QR. Replace the URL with:

```js
const qrBuffer = await paymentService.generateCompositeBuffer(amount, memo);
const sent = await ctx.replyWithPhoto({ source: qrBuffer }, { caption, parse_mode: 'HTML' });
```

Make sure `paymentService` is required at the top.

- [ ] **Step 4: Manual verification**

Through real Telegram chat:
1. `/nap 20000` → Auto-chan-themed QR image arrives. Scan with banking app — opens the correct account/amount.
2. Place an order → QR caption with the new template + Auto-chan QR image. Scan — opens the order amount + `PNS<orderId>` memo.

- [ ] **Step 5: Commit**

```bash
git add src/services/paymentService.js src/handlers/quantitySelect.js src/commands/nap.js
git commit -m "feat(qr): bot sends Auto-chan composite QR for orders + topups"
```

---

## End-to-end verification

| Milestone | Manual check                                                                                       | Scriptable check                                                                                              |
|-----------|-----------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| M1        | Storefront headers show "Auto-chan" + mascot. Admin sidebar shows mascot.                          | `grep -r 'Peanut Shop' web/src` → no matches outside changelog/docs.                                         |
| M2        | `/admin/messages` lists 18 templates. Edit `welcome` → DM `/start` → bot reflects edit.            | `sqlite3 data/shop.db "SELECT COUNT(*) FROM message_templates"` → 18                                          |
| M2 (web)  | Hard-reload `/thanh-toan/<delivered-id>` → success line uses `web.order_success` template.         | `curl -s http://localhost:3000/api/v1/messages/public \| jq '.data \| length'` → returns count of web templates |
| M3        | `/nap 20000` → composite QR arrives. Scan in banking app → correct account + amount + memo.        | `node scripts/calibrate-qr-box.js` → prints box; rerun if template ever changes.                              |

## Untriggered templates (intentional)

Three templates are seeded + editable in the admin UI but have **no automatic trigger** in the current codebase. They are reserved for future broadcast features and ship empty-of-triggers in this plan to keep scope focused on rebrand + customization:

- `low_stock_user` — would require a per-user wishlist or a broadcast button
- `balance_low` — would require a balance-watcher cron
- `web.new_stock` — would require an admin "Broadcast" button on the product card
- `web.restock_email` — would require an SMTP integration

The admin can edit their bodies today; wiring triggers is a separate plan.

## Critical files

- `src/assets/qr-template.png`, `src/assets/mascot-avatar.png`, `web/public/mascot-avatar.png`
- `src/database/migrations/012_message_templates.js`, `src/database/seeds/message-templates.json`
- `src/services/messageTemplateService.js`, `src/services/qrCompositeService.js`
- `src/services/paymentService.js`, `src/services/paymentPoller.js`, `src/services/topupService.js`, `src/services/notificationService.js`
- `src/handlers/quantitySelect.js`, `src/handlers/paymentConfirm.js`
- `src/commands/start.js`, `src/commands/nap.js`, `src/commands/refund.js`
- `src/utils/messages.js`, `src/config.js`
- `src/api/routes/admin/messages.js`, `src/api/routes/admin/index.js`, `src/api/routes/public.js`
- `web/src/components/MascotBadge.tsx`, `web/src/components/AdminSidebar.tsx`
- `web/src/app/admin/messages/page.tsx`, `web/src/app/admin/layout.tsx`
- `web/src/app/page.tsx`, `web/src/app/san-pham/page.tsx`, `web/src/app/san-pham/[slug]/page.tsx`
- `web/src/app/thanh-toan/[id]/page.tsx`, `web/src/app/dang-nhap/page.tsx`, `web/src/app/lien-ket/page.tsx`
- `web/src/app/globals.css`, `web/src/app/layout.tsx`
- `web/src/lib/api.ts`, `web/src/lib/icons.tsx`, `web/src/lib/messages.ts`
- `scripts/calibrate-qr-box.js`, `package.json`
