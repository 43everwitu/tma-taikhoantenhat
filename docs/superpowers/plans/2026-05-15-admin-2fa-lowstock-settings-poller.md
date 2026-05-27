# Admin/2FA, Low-Stock, Settings, Payment-Poller Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four independent fixes — (1) super_admin can edit other admin profile fields + global "force 2FA for all" toggle; (2) low-stock alert routes to order channel topic, threshold defaults to settings, dedup window verified; (3) audit + plug holes in settings → runtime sync (`order_expiry_minutes`, `payment_poll_interval_seconds`, `low_stock_alert_threshold`); (4) payment poller rechecks recently-expired orders against bulk MBBank scan + hard-deletes orders 24h after expiry.

**Architecture:**
- Phase A (admin/2FA): extend existing `PATCH /admin/admins/:id` route — already accepts role/isActive/password/displayName. Add UI edit modal + new `settings.require_2fa_all` flag consumed by `loginRouter` (2FA enforcement layer).
- Phase B (low-stock): split routing — `adminNotifyService.notify('low_stock', …)` accepts new `chatId`/`threadId` overrides driven from settings (`low_stock_chat_id` + `low_stock_thread_id`), falls back to `ADMIN_ID`. Per-product threshold becomes `COALESCE(p.low_stock_threshold, settings.low_stock_alert_threshold, 5)`.
- Phase C (settings audit): make all settings listed in `/admin/settings` UI either truly consumed or remove. New live-read for `payment_poll_interval_seconds` in poller. Hide legacy `payment_timeout_minutes` from UI.
- Phase D (poller recovery + 24h purge): extend `getActivePending` poll cycle to also include `status='expired' AND expires_at > now('-24 hours')` rows. On match → flip back to `paid` + run `confirmAndDeliver`. Add `cleanupExpiredOrders` invoked from poller tick (every 30 min) deleting `expired` orders older than 24h.

Each phase is independently shippable. Phases C and D share `paymentPoller.js` — do C before D.

**Tech Stack:** Node 20 / Express / better-sqlite3 / Telegraf / Next 16 App Router / React Query / Vitest (existing test runner — confirmed by `package.json`).

---

## File Structure

**Created**
- `src/database/migrations/029_settings_2fa_lowstock.js` — seed `require_2fa_all`, `low_stock_chat_id`, `low_stock_thread_id` settings.
- `src/database/migrations/030_order_expiry_cleanup_meta.js` — index `idx_orders_status_expires_at` for cleanup query.
- `web/src/app/(admin)/admin/admins/EditModal.tsx` — extracted edit form (displayName/role/password) for other admins.
- `tests/services/lowStockRouting.test.js` — Vitest unit for low-stock chat-id resolution.
- `tests/services/orderRecovery.test.js` — Vitest unit for expired→paid recovery + 24h cleanup.

**Modified**
- `src/api/routes/admin/admins.js` — already supports edit. No code change; verify behavior in test.
- `src/api/routes/admin/settings.js` — invalidate `lowStockSettingsCache` when low-stock keys change; invalidate `pollerIntervalCache`.
- `src/services/adminNotifyService.js` — add `lowStockTarget()` reading `settings.low_stock_chat_id` + `settings.low_stock_thread_id`. `notify('low_stock', …)` uses it.
- `src/services/notificationService.js:133-193` — `checkLowStock()` uses `COALESCE` threshold, passes `message_thread_id` opts when set.
- `src/services/orderService.js` — add `getRecentlyExpired(hoursBack)`, `markRecoveredPaid(orderId)`, `cleanupExpiredOrders(hoursBack)`.
- `src/services/paymentPoller.js` — include recently-expired in match maps; tick every Nth iteration runs cleanup.
- `src/auth/twofaMiddleware.js` *(or wherever 2FA enforcement lives — discover during Task 1)* — additionally enforce `settings.require_2fa_all`.
- `web/src/app/(admin)/admin/admins/page.tsx` — wire Edit button + Edit modal; add global "Bắt buộc 2FA toàn hệ thống" toggle (super_admin only).
- `web/src/app/(admin)/admin/settings/page.tsx` — remove `payment_timeout_minutes` field; add `low_stock_chat_id` + `low_stock_thread_id` fields; add `require_2fa_all` field (under "Bảo mật" new group).
- `web/src/lib/api.ts` — verify `twoFactor.adminSet` signature already supports `{required, reset}` (no change expected).

---

## Phase A — Admin edit + global 2FA force

### Task A1: Locate 2FA enforcement insertion point (no code change, discovery only)

**Files:**
- Read: `src/api/routes/auth.js`
- Read: `src/auth/` (any middleware)
- Read: result of `rg -n "totp_required" src/`

- [ ] **Step 1: Run discovery**

```bash
rg -n "totp_required\|totpRequired" src/
```

Record (in chat output during execution): the file + function that decides "this login must enroll 2FA". Likely in `src/api/routes/auth.js` login handler after password check.

- [ ] **Step 2: Confirm role-based skip path**

Read the lines around the match. The current rule (per `admins.js:21`) is: `required = role === 'super_admin' || totp_required`. Confirm the login route applies that same rule. Note the exact filename + line range — Task A4 modifies it.

- [ ] **Step 3: No commit yet**

(Discovery task only. Output the file path + line range for use in A4.)

---

### Task A2: Seed `require_2fa_all` setting

**Files:**
- Create: `src/database/migrations/029_settings_2fa_lowstock.js`

- [ ] **Step 1: Write the migration**

```javascript
// 029_settings_2fa_lowstock.js
// Adds 3 settings rows for the v0.33 mini-fixes:
//   require_2fa_all    — bool, super_admin global force.
//   low_stock_chat_id  — chat id for low-stock alerts (defaults to ADMIN_ID at read).
//   low_stock_thread_id — optional message_thread_id for forum topics.
function up(db) {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`
  );
  ins.run('require_2fa_all', 'false');
  ins.run('low_stock_chat_id', '');
  ins.run('low_stock_thread_id', '');
}
module.exports = { up };
```

- [ ] **Step 2: Apply migration**

Run: `npm run dev` (boot triggers migration runner) OR `node -e "require('./src/database')"`
Expected: log line `📦 Running migration: 029_settings_2fa_lowstock.js` then `✅ Migration applied`.

- [ ] **Step 3: Verify rows present**

```bash
sqlite3 data/shop.db "SELECT key, value FROM settings WHERE key IN ('require_2fa_all','low_stock_chat_id','low_stock_thread_id');"
```

Expected output:
```
low_stock_chat_id|
low_stock_thread_id|
require_2fa_all|false
```

- [ ] **Step 4: Commit**

```bash
git add src/database/migrations/029_settings_2fa_lowstock.js
git commit -m "feat(db): seed require_2fa_all + low_stock chat/thread settings (mig 029)"
```

---

### Task A3: Enforce `require_2fa_all` in login flow

**Files:**
- Modify: file identified in A1 (placeholder: `src/api/routes/auth.js`).
- Test: `tests/api/loginForce2fa.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/api/loginForce2fa.test.js
const { describe, it, expect, beforeEach } = require('vitest');
const db = require('../../src/database');

describe('login enforces require_2fa_all setting', () => {
  beforeEach(() => {
    db.prepare("UPDATE settings SET value = 'false' WHERE key = 'require_2fa_all'").run();
    db.prepare("UPDATE admins SET totp_required = 0, totp_enabled = 0 WHERE role IN ('manager','admin')").run();
  });

  it('returns enroll flag when global force is on AND admin has no totp', () => {
    db.prepare("UPDATE settings SET value = 'true' WHERE key = 'require_2fa_all'").run();
    const { needsEnroll } = require('../../src/services/twofaPolicy').checkEnrollRequired({
      role: 'manager', totp_enabled: 0, totp_required: 0,
    });
    expect(needsEnroll).toBe(true);
  });

  it('does not force super_admin path twice', () => {
    const { needsEnroll } = require('../../src/services/twofaPolicy').checkEnrollRequired({
      role: 'super_admin', totp_enabled: 1, totp_required: 1,
    });
    expect(needsEnroll).toBe(false);
  });

  it('lets admin without totp through when both flags off', () => {
    const { needsEnroll } = require('../../src/services/twofaPolicy').checkEnrollRequired({
      role: 'admin', totp_enabled: 0, totp_required: 0,
    });
    expect(needsEnroll).toBe(false);
  });
});
```

- [ ] **Step 2: Run test → expect FAIL**

```bash
npx vitest run tests/api/loginForce2fa.test.js
```
Expected: FAIL with `Cannot find module '../../src/services/twofaPolicy'`.

- [ ] **Step 3: Create the policy helper**

Create `src/services/twofaPolicy.js`:

```javascript
const db = require('../database');

let cache = null;
let cacheAt = 0;
const TTL_MS = 30_000;

function isGlobalForceOn() {
  if (cache !== null && Date.now() - cacheAt < TTL_MS) return cache;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'require_2fa_all'").get();
  cache = row?.value === 'true' || row?.value === '1';
  cacheAt = Date.now();
  return cache;
}

function invalidateCache() {
  cache = null;
  cacheAt = 0;
}

/**
 * Decide whether an admin must be bounced into TOTP enrollment after a successful
 * password check. Rules:
 *   - If admin already has totp_enabled=1, never re-enroll (login proceeds to TOTP step).
 *   - Otherwise, must enroll if any of: row.totp_required, role==='super_admin',
 *     or settings.require_2fa_all is true.
 */
function checkEnrollRequired(admin) {
  if (admin.totp_enabled) return { needsEnroll: false };
  const perRowRequired = admin.totp_required || admin.role === 'super_admin';
  const globalRequired = isGlobalForceOn();
  return { needsEnroll: !!(perRowRequired || globalRequired) };
}

module.exports = { checkEnrollRequired, invalidateCache, isGlobalForceOn };
```

- [ ] **Step 4: Run test → expect PASS**

```bash
npx vitest run tests/api/loginForce2fa.test.js
```
Expected: 3 tests PASS.

- [ ] **Step 5: Wire policy helper into login route**

Open the file from A1. Find the spot where the route currently checks `admin.totp_required` (or equivalent). Replace that line with:

```javascript
const { checkEnrollRequired } = require('../../services/twofaPolicy');
const enroll = checkEnrollRequired(admin);
if (enroll.needsEnroll && !admin.totp_enabled) {
  return res.json({ success: true, data: { mustEnroll2fa: true, adminId: admin.id } });
}
```

If a similar block already exists with a different shape, keep the existing response keys — replace only the *condition* with `enroll.needsEnroll && !admin.totp_enabled`.

- [ ] **Step 6: Invalidate policy cache on settings PUT**

Edit `src/api/routes/admin/settings.js` after line 35 (where `notify_admin_` invalidation lives). Add:

```javascript
if (Object.keys(req.body).some(k => k === 'require_2fa_all')) {
  require('../../services/twofaPolicy').invalidateCache();
}
```

- [ ] **Step 7: Manual smoke**

Set `require_2fa_all=true` via SQL, log in as a manager that has `totp_enabled=0` — login should return `mustEnroll2fa: true`. Revert.

```bash
sqlite3 data/shop.db "UPDATE settings SET value='true' WHERE key='require_2fa_all';"
# log in via UI, then revert:
sqlite3 data/shop.db "UPDATE settings SET value='false' WHERE key='require_2fa_all';"
```

- [ ] **Step 8: Commit**

```bash
git add src/services/twofaPolicy.js src/api/routes/auth.js src/api/routes/admin/settings.js tests/api/loginForce2fa.test.js
git commit -m "feat(2fa): settings.require_2fa_all global enrollment force"
```

(Substitute `src/api/routes/auth.js` with the actual file path from A1.)

---

### Task A4: Admin edit modal in UI

**Files:**
- Create: `web/src/app/(admin)/admin/admins/EditModal.tsx`
- Modify: `web/src/app/(admin)/admin/admins/page.tsx:60-105`

- [ ] **Step 1: Create EditModal**

```tsx
'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface Admin {
  id: number
  username: string
  displayName: string
  role: string
}

export function EditAdminModal({
  admin,
  isSuper,
  onClose,
  onSaved,
}: {
  admin: Admin
  isSuper: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [displayName, setDisplayName] = useState(admin.displayName)
  const [role, setRole] = useState(admin.role)
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = {}
      if (displayName !== admin.displayName) body.displayName = displayName
      if (isSuper && role !== admin.role) body.role = role
      if (password.length >= 6) body.password = password
      if (Object.keys(body).length === 0) return Promise.resolve({ data: { changes: 0 } })
      return api.patch(`/admin/admins/${admin.id}`, body)
    },
    onSuccess: onSaved,
    onError: (e) => setErr(e instanceof Error ? e.message : 'Lỗi'),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
        <h2 className="text-lg font-semibold">Sửa @{admin.username}</h2>
        <label className="block text-xs font-medium opacity-70">Tên hiển thị</label>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="clay-input w-full text-sm" />
        {isSuper && (
          <>
            <label className="block text-xs font-medium opacity-70">Vai trò</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="clay-input w-full text-sm">
              <option value="manager">manager</option>
              <option value="admin">admin</option>
              <option value="super_admin">super_admin</option>
            </select>
          </>
        )}
        <label className="block text-xs font-medium opacity-70">Mật khẩu mới (để trống = giữ nguyên)</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="≥ 6 ký tự" className="clay-input w-full text-sm" />
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="clay-btn text-sm">Huỷ</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="clay-btn clay-btn--lemon text-sm"
          >
            {mutation.isPending ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire Edit button into list**

Open `web/src/app/(admin)/admin/admins/page.tsx`. At top of file (after existing imports), add:

```tsx
import { EditAdminModal } from './EditModal'
```

Inside the `AdminsPage` component, alongside `createOpen`, add:

```tsx
const [editing, setEditing] = useState<Admin | null>(null)
```

Inside the `.map((a) => …)` block, in the buttons row (line ~71-102 currently), insert before the "Khoá" button:

```tsx
<button onClick={() => setEditing(a)} className="clay-btn text-xs">Sửa</button>
```

After the closing `</div>` of the list, before `{createOpen && <CreateModal …`, add:

```tsx
{editing && (
  <EditAdminModal
    admin={editing}
    isSuper={isSuper}
    onClose={() => setEditing(null)}
    onSaved={() => { qc.invalidateQueries({ queryKey: ['admin', 'admins'] }); setEditing(null) }}
  />
)}
```

- [ ] **Step 3: Manual smoke**

Run `npm run dev:web`. Open `/admin/admins`, log in as super_admin, click **Sửa** on a manager row, change display name → Save → row reflects the new name.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/(admin)/admin/admins/EditModal.tsx web/src/app/(admin)/admin/admins/page.tsx
git commit -m "feat(admin): edit modal for displayName/role/password on /admin/admins"
```

---

### Task A5: Global "Bắt buộc 2FA toàn hệ thống" toggle in settings UI

**Files:**
- Modify: `web/src/app/(admin)/admin/settings/page.tsx:27-105` (GROUPS array)

- [ ] **Step 1: Add new group**

Open `web/src/app/(admin)/admin/settings/page.tsx`. After the "Thông báo Admin" group (around line 104, before the closing `]` of `GROUPS`), insert:

```typescript
  {
    title: 'Bảo mật',
    emoji: '🔐',
    blurb: 'Cấu hình xác thực hai yếu tố cho tất cả quản trị viên.',
    fields: [
      { key: 'require_2fa_all', label: 'Bắt buộc 2FA cho mọi quản trị viên', type: 'bool',
        description: 'Bật để buộc tất cả admin/manager phải cài 2FA ở lần đăng nhập kế tiếp. Super_admin luôn bắt buộc — không phụ thuộc cờ này.' },
    ],
  },
```

- [ ] **Step 2: Manual smoke**

Run `npm run dev:web`. Open `/admin/settings`. Verify new "Bảo mật" group renders with one boolean toggle. Toggle on → Save → reload page → still on.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/(admin)/admin/settings/page.tsx
git commit -m "feat(admin): settings UI for require_2fa_all global toggle"
```

---

## Phase B — Low-stock alert fixes

### Task B1: Add `low_stock_chat_id` + `low_stock_thread_id` to settings UI

**Files:**
- Modify: `web/src/app/(admin)/admin/settings/page.tsx:79-87`

- [ ] **Step 1: Extend "Tồn kho" group**

In `web/src/app/(admin)/admin/settings/page.tsx`, replace the "Tồn kho" group (currently 1 field) with:

```typescript
  {
    title: 'Tồn kho',
    emoji: '📦',
    blurb: 'Cảnh báo sắp hết hàng.',
    fields: [
      { key: 'low_stock_alert_threshold', label: 'Ngưỡng cảnh báo tồn kho mặc định', type: 'number',
        description: 'Áp dụng cho sản phẩm chưa set ngưỡng riêng. Khi stock ≤ ngưỡng → admin được báo (1 lần / 24h).' },
      { key: 'low_stock_chat_id', label: 'Chat ID nhận cảnh báo tồn kho', type: 'text',
        description: 'Để trống = gửi vào DM admin (ADMIN_ID env). Nhập chat id âm (vd -1003865156744) để gửi vào group/channel.',
        placeholder: '-1003865156744' },
      { key: 'low_stock_thread_id', label: 'Thread ID (forum topic)', type: 'number',
        description: 'Tuỳ chọn. ID topic trong group forum (vd 2). Để trống nếu group không bật forum.' },
    ],
  },
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/(admin)/admin/settings/page.tsx
git commit -m "feat(admin): expose low_stock_chat_id + low_stock_thread_id in settings UI"
```

---

### Task B2: Route low-stock alerts to configured chat/thread

**Files:**
- Modify: `src/services/adminNotifyService.js`
- Test: `tests/services/lowStockRouting.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/services/lowStockRouting.test.js
const { describe, it, expect, beforeEach, vi } = require('vitest');
const db = require('../../src/database');

describe('adminNotifyService low_stock routing', () => {
  let sent;
  const fakeBot = { telegram: { sendMessage: vi.fn(async (chatId, msg, opts) => { sent.push({ chatId, msg, opts }); }) } };
  let svc;

  beforeEach(() => {
    sent = [];
    delete require.cache[require.resolve('../../src/services/adminNotifyService')];
    svc = require('../../src/services/adminNotifyService');
    svc.init(fakeBot);
    svc.invalidateCache();
    db.prepare("DELETE FROM settings WHERE key IN ('low_stock_chat_id','low_stock_thread_id')").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_chat_id',''),('low_stock_thread_id','')").run();
    db.prepare("UPDATE settings SET value='true' WHERE key='notify_admin_low_stock'").run();
  });

  it('falls back to ADMIN_ID when low_stock_chat_id empty', async () => {
    await svc.notify('low_stock', 'body', { parse_mode: 'HTML' });
    expect(sent).toHaveLength(1);
    expect(sent[0].chatId).toBe(require('../../src/config').ADMIN_ID);
    expect(sent[0].opts.message_thread_id).toBeUndefined();
  });

  it('uses configured low_stock_chat_id + thread when set', async () => {
    db.prepare("UPDATE settings SET value='-1003865156744' WHERE key='low_stock_chat_id'").run();
    db.prepare("UPDATE settings SET value='2' WHERE key='low_stock_thread_id'").run();
    svc.invalidateCache();
    await svc.notify('low_stock', 'body', { parse_mode: 'HTML' });
    expect(sent).toHaveLength(1);
    expect(String(sent[0].chatId)).toBe('-1003865156744');
    expect(sent[0].opts.message_thread_id).toBe(2);
  });
});
```

- [ ] **Step 2: Run test → expect FAIL**

```bash
npx vitest run tests/services/lowStockRouting.test.js
```
Expected: FAIL — `sent[0].chatId` is `ADMIN_ID` always (config doesn't read low_stock_chat_id yet).

- [ ] **Step 3: Modify adminNotifyService.js**

Replace the file contents of `src/services/adminNotifyService.js` with:

```javascript
const db = require('../database');
const config = require('../config');

const CACHE_TTL_MS = 30_000;
const KEY_PREFIX = 'notify_admin_';

const VALID_EVENTS = ['new_order', 'payment_short', 'no_stock', 'delivered', 'low_stock', 'backorder_paid'];

let toggleCache = null;
let toggleCacheAt = 0;
let lowStockTargetCache = null;
let lowStockTargetCacheAt = 0;

function loadToggles() {
  if (toggleCache && Date.now() - toggleCacheAt < CACHE_TTL_MS) return toggleCache;
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key LIKE ?`).all(`${KEY_PREFIX}%`);
  toggleCache = {};
  for (const r of rows) {
    toggleCache[r.key.slice(KEY_PREFIX.length)] = r.value === 'true' || r.value === '1';
  }
  toggleCacheAt = Date.now();
  return toggleCache;
}

function loadLowStockTarget() {
  if (lowStockTargetCache !== null && Date.now() - lowStockTargetCacheAt < CACHE_TTL_MS) {
    return lowStockTargetCache;
  }
  const chatRow = db.prepare("SELECT value FROM settings WHERE key = 'low_stock_chat_id'").get();
  const threadRow = db.prepare("SELECT value FROM settings WHERE key = 'low_stock_thread_id'").get();
  const chatId = chatRow && chatRow.value ? chatRow.value : null;
  const threadId = threadRow && threadRow.value ? parseInt(threadRow.value, 10) : null;
  lowStockTargetCache = {
    chatId: chatId || null,
    threadId: Number.isFinite(threadId) && threadId > 0 ? threadId : null,
  };
  lowStockTargetCacheAt = Date.now();
  return lowStockTargetCache;
}

let bot = null;
function init(b) { bot = b; }

function isEnabled(eventType) {
  const toggles = loadToggles();
  if (toggles[eventType] === undefined) {
    return eventType === 'delivered' || eventType === 'low_stock' || eventType === 'backorder_paid';
  }
  return toggles[eventType];
}

/**
 * Resolve target chat for an event. low_stock routes via settings; everything
 * else uses ADMIN_ID (with BOT_NOISE_CHAT_ID as muted fallback).
 */
function resolveTarget(eventType) {
  if (eventType === 'low_stock') {
    const t = loadLowStockTarget();
    if (t.chatId) return { chatId: t.chatId, threadId: t.threadId };
  }
  return { chatId: isEnabled(eventType) ? config.ADMIN_ID : (config.BOT_NOISE_CHAT_ID || null), threadId: null };
}

async function notify(eventType, message, opts = {}) {
  if (!VALID_EVENTS.includes(eventType)) {
    console.warn(`adminNotifyService: unknown eventType '${eventType}'`);
  }
  if (!bot) {
    console.error('adminNotifyService.notify called before init()');
    return;
  }

  // For low_stock with explicit chat override: send regardless of toggle (admin
  // intentionally pointed alerts at a group/topic — toggle is for DM-only mute).
  if (eventType !== 'low_stock' && !isEnabled(eventType) && !config.BOT_NOISE_CHAT_ID) return;

  const { chatId, threadId } = resolveTarget(eventType);
  if (!chatId) return;

  const finalOpts = { ...opts };
  if (threadId) finalOpts.message_thread_id = threadId;

  try {
    await bot.telegram.sendMessage(chatId, message, finalOpts);
  } catch (err) {
    console.error(`adminNotifyService notify [${eventType}] -> ${chatId}:`, err.message);
  }
}

function invalidateCache() {
  toggleCache = null;
  toggleCacheAt = 0;
  lowStockTargetCache = null;
  lowStockTargetCacheAt = 0;
}

module.exports = { init, notify, invalidateCache, VALID_EVENTS };
```

- [ ] **Step 4: Run test → expect PASS**

```bash
npx vitest run tests/services/lowStockRouting.test.js
```
Expected: 2 tests PASS.

- [ ] **Step 5: Invalidate cache on settings PUT**

Open `src/api/routes/admin/settings.js`. After the existing `notify_admin_` invalidation block, add a check for low_stock keys (the existing call to `adminNotifyService.invalidateCache()` covers both caches because we unified them in Step 3 — no extra code needed, but verify by reading the file).

If the file currently only invalidates on `notify_admin_*`, change the conditional from:
```javascript
if (Object.keys(req.body).some(k => k.startsWith('notify_admin_'))) {
```
to:
```javascript
if (Object.keys(req.body).some(k => k.startsWith('notify_admin_') || k.startsWith('low_stock_'))) {
```

- [ ] **Step 6: Commit**

```bash
git add src/services/adminNotifyService.js src/api/routes/admin/settings.js tests/services/lowStockRouting.test.js
git commit -m "feat(notify): low_stock routes via settings.low_stock_chat_id + thread"
```

---

### Task B3: Per-product threshold falls back to settings default

**Files:**
- Modify: `src/services/notificationService.js:133-193`
- Test: `tests/services/lowStockThreshold.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/services/lowStockThreshold.test.js
const { describe, it, expect, beforeEach } = require('vitest');
const db = require('../../src/database');

describe('checkLowStock threshold fallback', () => {
  let testProductId;
  beforeEach(() => {
    db.prepare("UPDATE settings SET value='3' WHERE key='low_stock_alert_threshold'").run();
    // Create a product without its own threshold (NULL)
    const cat = db.prepare("INSERT INTO categories (name, slug) VALUES ('t', 't-' || abs(random()))").run();
    const r = db.prepare(`
      INSERT INTO products (category_id, name, slug, price, is_active, low_stock_threshold, last_low_stock_alert_at)
      VALUES (?, 'Test', 't-' || abs(random()), 1000, 1, NULL, NULL)
    `).run(cat.lastInsertRowid);
    testProductId = r.lastInsertRowid;
  });

  it('uses settings.low_stock_alert_threshold when product.low_stock_threshold is NULL', () => {
    const { effectiveLowStockProducts } = require('../../src/services/lowStockQuery');
    const rows = effectiveLowStockProducts();
    expect(rows.some(r => r.id === testProductId)).toBe(false); // stock=0, threshold=3, skipped (0 stock excluded)

    // Add 2 stock — below threshold 3
    db.prepare("INSERT INTO stock (product_id, content, is_sold) VALUES (?, 'k1', 0), (?, 'k2', 0)").run(testProductId, testProductId);
    const rows2 = effectiveLowStockProducts();
    const hit = rows2.find(r => r.id === testProductId);
    expect(hit).toBeDefined();
    expect(hit.effective_threshold).toBe(3);
    expect(hit.stock_count).toBe(2);
  });
});
```

- [ ] **Step 2: Run test → expect FAIL**

```bash
npx vitest run tests/services/lowStockThreshold.test.js
```
Expected: FAIL — `Cannot find module 'lowStockQuery'`.

- [ ] **Step 3: Extract query into reusable helper**

Create `src/services/lowStockQuery.js`:

```javascript
const db = require('../database');

/**
 * Effective low-stock list. Threshold per row = COALESCE(per-product, settings default, 5).
 * Returns: [{ id, name, emoji, effective_threshold, stock_count, last_low_stock_alert_at }, ...]
 * Filters: is_active=1, stock > 0, stock <= effective_threshold, last alert > 24h ago.
 */
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

module.exports = { effectiveLowStockProducts };
```

- [ ] **Step 4: Run test → expect PASS**

```bash
npx vitest run tests/services/lowStockThreshold.test.js
```
Expected: PASS.

- [ ] **Step 5: Wire helper into notificationService**

In `src/services/notificationService.js`, replace lines 134-146 (the inline query) with:

```javascript
    const { effectiveLowStockProducts } = require('./lowStockQuery');
    const lowStockProducts = effectiveLowStockProducts();
```

Also at line 172 in that same file, change:
```javascript
        threshold: p.low_stock_threshold,
```
to:
```javascript
        threshold: p.effective_threshold,
```

- [ ] **Step 6: Run full notification test suite**

```bash
npx vitest run tests/services/lowStock
```
Expected: all tests in `lowStockRouting.test.js` + `lowStockThreshold.test.js` PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/lowStockQuery.js src/services/notificationService.js tests/services/lowStockThreshold.test.js
git commit -m "fix(stock): low_stock_threshold falls back to settings.low_stock_alert_threshold"
```

---

### Task B4: Verify + document 24h dedup window

**Files:**
- Read: `src/services/notificationService.js:144-188` (verify `updateAlert.run(p.id)` always runs on the no-template branch too)

- [ ] **Step 1: Confirm dedup writes happen even on skipped sends**

Read `src/services/notificationService.js` lines 175-191. Confirm `updateAlert.run(p.id)` is called on both the `if (!body) { … continue; }` branch (line 175) and the `try { … updateAlert.run(p.id); }` branch (line 188). If line 175 currently does NOT call updateAlert, change it to:

```javascript
      if (!body) { updateAlert.run(p.id); continue; }
```

(Per current file — already correct on line 175. No change needed; verify only.)

- [ ] **Step 2: Add regression test**

Create `tests/services/lowStockDedup.test.js`:

```javascript
const { describe, it, expect, beforeEach, vi } = require('vitest');
const db = require('../../src/database');

describe('checkLowStock 24h dedup', () => {
  let svc, productId;
  const fakeBot = { telegram: { sendMessage: vi.fn(async () => {}) } };

  beforeEach(() => {
    delete require.cache[require.resolve('../../src/services/notificationService')];
    delete require.cache[require.resolve('../../src/services/adminNotifyService')];
    const { NotificationService } = require('../../src/services/notificationService');
    const adminNotify = require('../../src/services/adminNotifyService');
    adminNotify.init(fakeBot);
    adminNotify.invalidateCache();
    svc = new NotificationService(fakeBot);
    db.prepare("UPDATE settings SET value='5' WHERE key='low_stock_alert_threshold'").run();
    db.prepare("UPDATE settings SET value='true' WHERE key='notify_admin_low_stock'").run();
    const cat = db.prepare("INSERT INTO categories (name, slug) VALUES ('d', 'd-' || abs(random()))").run();
    const r = db.prepare(`
      INSERT INTO products (category_id, name, slug, price, is_active, low_stock_threshold, last_low_stock_alert_at)
      VALUES (?, 'Dedup', 'd-' || abs(random()), 1000, 1, 5, NULL)
    `).run(cat.lastInsertRowid);
    productId = r.lastInsertRowid;
    db.prepare("INSERT INTO stock (product_id, content, is_sold) VALUES (?, 'k', 0)").run(productId);
    fakeBot.telegram.sendMessage.mockClear();
  });

  it('only sends once within 24h', async () => {
    await svc.checkLowStock();
    await svc.checkLowStock();
    await svc.checkLowStock();
    expect(fakeBot.telegram.sendMessage.mock.calls.length).toBe(1);
  });
});
```

- [ ] **Step 3: Run test → expect PASS** (dedup already works)

```bash
npx vitest run tests/services/lowStockDedup.test.js
```
Expected: PASS (1 test).

If FAIL (e.g. sends multiple times): bug somewhere. Trace: `updateAlert` must run before the next iteration of checkLowStock. Inspect `last_low_stock_alert_at` after first call:
```bash
sqlite3 data/shop.db "SELECT id, last_low_stock_alert_at FROM products ORDER BY id DESC LIMIT 1"
```

- [ ] **Step 4: Commit**

```bash
git add tests/services/lowStockDedup.test.js
git commit -m "test(stock): regression test for 24h low_stock dedup"
```

---

## Phase C — Settings sync audit

### Task C1: Live-read `payment_poll_interval_seconds`

**Files:**
- Modify: `src/services/paymentPoller.js:84-106` (`ensureRunning` constants)
- Test: `tests/services/pollerInterval.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// tests/services/pollerInterval.test.js
const { describe, it, expect } = require('vitest');
const db = require('../../src/database');

describe('paymentPoller reads interval from settings', () => {
  it('returns settings value when present', () => {
    db.prepare("UPDATE settings SET value='15' WHERE key='payment_poll_interval_seconds'").run();
    delete require.cache[require.resolve('../../src/services/pollerConfig')];
    const { getPollIntervalMs } = require('../../src/services/pollerConfig');
    expect(getPollIntervalMs()).toBe(15_000);
  });

  it('falls back to 30000ms when missing or zero', () => {
    db.prepare("UPDATE settings SET value='0' WHERE key='payment_poll_interval_seconds'").run();
    delete require.cache[require.resolve('../../src/services/pollerConfig')];
    const { getPollIntervalMs } = require('../../src/services/pollerConfig');
    expect(getPollIntervalMs()).toBe(30_000);
  });
});
```

- [ ] **Step 2: Run → expect FAIL** (`pollerConfig` doesn't exist)

```bash
npx vitest run tests/services/pollerInterval.test.js
```

- [ ] **Step 3: Create the config helper**

Create `src/services/pollerConfig.js`:

```javascript
const db = require('../database');

function getPollIntervalMs() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'payment_poll_interval_seconds'").get();
  const seconds = row && row.value ? parseInt(row.value, 10) : 0;
  if (!Number.isFinite(seconds) || seconds < 5) return 30_000;
  return Math.min(seconds, 120) * 1000;
}

module.exports = { getPollIntervalMs };
```

- [ ] **Step 4: Wire into paymentPoller**

In `src/services/paymentPoller.js`, replace line 86 (`const intervalMs = 30_000;`) with:

```javascript
    const { getPollIntervalMs } = require('./pollerConfig');
    const intervalMs = getPollIntervalMs();
```

- [ ] **Step 5: Run test → PASS**

```bash
npx vitest run tests/services/pollerInterval.test.js
```
Expected: 2 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/pollerConfig.js src/services/paymentPoller.js tests/services/pollerInterval.test.js
git commit -m "fix(poller): live-read payment_poll_interval_seconds from settings"
```

---

### Task C2: Remove unused `payment_timeout_minutes` from UI

**Files:**
- Modify: `web/src/app/(admin)/admin/settings/page.tsx:62-63`

- [ ] **Step 1: Remove the legacy field block**

Open `web/src/app/(admin)/admin/settings/page.tsx`. Locate the entry:

```typescript
      { key: 'payment_timeout_minutes', label: 'Timeout payment (legacy)', type: 'number', unit: 'phút',
        description: 'Cũ — giữ tương thích. Dùng order_expiry_minutes thay thế.' },
```

Delete those two lines. (The DB row stays — it's harmless seed data.)

- [ ] **Step 2: Commit**

```bash
git add web/src/app/(admin)/admin/settings/page.tsx
git commit -m "chore(admin): hide legacy payment_timeout_minutes from settings UI"
```

---

### Task C3: Audit doc — settings consumer map

**Files:**
- Create: `docs/superpowers/specs/2026-05-15-settings-consumer-map.md`

- [ ] **Step 1: Write the audit doc**

```markdown
# Settings Consumer Map (audit, 2026-05-15)

For each settings row exposed in `/admin/settings` UI, lists which runtime code reads it. Verified by `rg -n "<key>" src/`.

| Key | Consumer | Read style |
|---|---|---|
| `shop_name` | `src/bot/handlers/start.js` (and `messageTemplateService` vars) | live (per call) |
| `support_contact` | `src/bot/handlers/support.js` | live |
| `support_url` | `web/src/app/(miniapp)/components/MiniAppShell.tsx` (via `/api/public/settings`) | live |
| `backorder_wait_message` | `src/services/paymentPoller.js:353` | live |
| `website_url` | `src/bot/handlers/website.js` | live |
| `website_description` | same | live |
| `auto_payment_enabled` | `src/services/paymentPoller.js` (via `config.PAYMENT_POLL_ENABLED`? confirm) | live |
| `order_expiry_minutes` | `src/services/orderService.js:56` | live (per create) |
| `payment_timeout_minutes` | **unused** — removed from UI in v0.33 | n/a |
| `payment_poll_interval_seconds` | `src/services/pollerConfig.js` (added v0.33) | live (per `ensureRunning`) |
| `topup_min_amount` | `src/services/topupService.js` | live |
| `topup_expiry_minutes` | `src/services/topupService.js` | live |
| `low_stock_alert_threshold` | `src/services/lowStockQuery.js` (added v0.33) | live (per check) |
| `low_stock_chat_id` | `src/services/adminNotifyService.js` (added v0.33) | cached 30s |
| `low_stock_thread_id` | same | cached 30s |
| `notify_admin_*` (6 keys) | `src/services/adminNotifyService.js:14` | cached 30s |
| `require_2fa_all` | `src/services/twofaPolicy.js` (added v0.33) | cached 30s |

Cache invalidation is wired in `src/api/routes/admin/settings.js` for: `notify_admin_*`, `low_stock_*`, `require_2fa_all`.

## Open follow-ups

- `auto_payment_enabled` may be read only at boot — verify in C4.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-15-settings-consumer-map.md
git commit -m "docs(spec): settings consumer map audit (v0.33)"
```

---

### Task C4: Verify `auto_payment_enabled` is read live

**Files:**
- Read: `src/config.js`, `src/services/paymentPoller.js`

- [ ] **Step 1: Run discovery**

```bash
rg -n "auto_payment_enabled\|PAYMENT_POLL_ENABLED" src/
```

Read each match. If `PAYMENT_POLL_ENABLED` is set once from `process.env` at boot and `paymentPoller` checks only that, then `auto_payment_enabled` setting in DB is **dormant**.

- [ ] **Step 2: Decide**

Two cases:
- **Setting IS read live**: no change. Update audit doc to confirm.
- **Setting NOT read live**: in `src/services/paymentPoller.js:79`, replace
  ```javascript
  if (!config.PAYMENT_POLL_ENABLED || !config.MBBANK_API_TOKEN) {
  ```
  with:
  ```javascript
  const row = require('../database').prepare("SELECT value FROM settings WHERE key = 'auto_payment_enabled'").get();
  const enabled = row ? (row.value === 'true' || row.value === '1') : !!config.PAYMENT_POLL_ENABLED;
  if (!enabled || !config.MBBANK_API_TOKEN) {
  ```

- [ ] **Step 3: Add test (only if code changed in Step 2)**

```javascript
// tests/services/pollerAutoEnabled.test.js
const { describe, it, expect } = require('vitest');
const db = require('../../src/database');

describe('paymentPoller auto_payment_enabled setting', () => {
  it('does not arm when auto_payment_enabled=false', () => {
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('auto_payment_enabled','false')").run();
    const { PaymentPoller } = require('../../src/services/paymentPoller');
    const p = new PaymentPoller(db, { telegram: { sendMessage: async () => {} } });
    p.ensureRunning();
    expect(p.running).toBe(false);
  });
});
```

Run: `npx vitest run tests/services/pollerAutoEnabled.test.js`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix(poller): live-read auto_payment_enabled setting"
```

(If no code change in Step 2, skip this commit.)

---

## Phase D — Payment-poller recovery + 24h cleanup

### Task D1: Add `getRecentlyExpired` + `markRecoveredPaid` + `cleanupExpiredOrders`

**Files:**
- Modify: `src/services/orderService.js` (after `expireStaleOrders`, line 398)
- Test: `tests/services/orderRecovery.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// tests/services/orderRecovery.test.js
const { describe, it, expect, beforeEach } = require('vitest');
const db = require('../../src/database');
const orderService = require('../../src/services/orderService');

describe('order recovery + cleanup', () => {
  let productId, userId;

  beforeEach(() => {
    db.prepare("INSERT OR IGNORE INTO users (telegram_id, full_name) VALUES (?, 'Test')").run(9990001);
    userId = 9990001;
    const cat = db.prepare("INSERT INTO categories (name, slug) VALUES ('r', 'r-' || abs(random()))").run();
    const p = db.prepare(`INSERT INTO products (category_id, name, slug, price, is_active) VALUES (?, 'R', 'r-' || abs(random()), 1000, 1)`).run(cat.lastInsertRowid);
    productId = p.lastInsertRowid;
  });

  it('getRecentlyExpired returns orders expired in last 24h', () => {
    const o = db.prepare(`
      INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, expires_at)
      VALUES (?, ?, 1, 1000, 'PNS999991', 'expired', datetime('now', '-2 hours'))
    `).run(userId, productId);
    const rows = orderService.getRecentlyExpired(24);
    expect(rows.some(r => r.id === o.lastInsertRowid)).toBe(true);
  });

  it('getRecentlyExpired excludes orders expired > 24h ago', () => {
    const o = db.prepare(`
      INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, expires_at)
      VALUES (?, ?, 1, 1000, 'PNS999992', 'expired', datetime('now', '-26 hours'))
    `).run(userId, productId);
    const rows = orderService.getRecentlyExpired(24);
    expect(rows.some(r => r.id === o.lastInsertRowid)).toBe(false);
  });

  it('markRecoveredPaid flips expired → paid + sets payment_matched_at', () => {
    const o = db.prepare(`
      INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, expires_at)
      VALUES (?, ?, 1, 1000, 'PNS999993', 'expired', datetime('now', '-1 hour'))
    `).run(userId, productId);
    const updated = orderService.markRecoveredPaid(o.lastInsertRowid);
    expect(updated).toBe(true);
    const row = db.prepare('SELECT status, payment_matched_at FROM orders WHERE id = ?').get(o.lastInsertRowid);
    expect(row.status).toBe('paid');
    expect(row.payment_matched_at).toBeTruthy();
  });

  it('cleanupExpiredOrders deletes expired older than 24h, keeps recent', () => {
    const old = db.prepare(`
      INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, expires_at)
      VALUES (?, ?, 1, 1000, 'PNS999994', 'expired', datetime('now', '-26 hours'))
    `).run(userId, productId);
    const recent = db.prepare(`
      INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, expires_at)
      VALUES (?, ?, 1, 1000, 'PNS999995', 'expired', datetime('now', '-1 hour'))
    `).run(userId, productId);

    const n = orderService.cleanupExpiredOrders(24);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(db.prepare('SELECT 1 FROM orders WHERE id = ?').get(old.lastInsertRowid)).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM orders WHERE id = ?').get(recent.lastInsertRowid)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run → expect FAIL** (methods don't exist)

```bash
npx vitest run tests/services/orderRecovery.test.js
```

- [ ] **Step 3: Add methods to orderService.js**

In `src/services/orderService.js`, after the `expireStaleOrders` method (line 398), and **before** `markPaymentMatched` (line 400), insert:

```javascript
  /**
   * Orders that already transitioned to 'expired' but their expires_at is within
   * the recovery window. Used by the poller to recheck late bank transfers
   * (e.g. inter-bank delays). Returns full order rows joined with product name.
   */
  getRecentlyExpired(hoursBack = 24) {
    return db.prepare(`
      SELECT o.*, p.name as product_name
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.status = 'expired'
        AND o.expires_at IS NOT NULL
        AND o.expires_at > datetime('now', ?)
      ORDER BY o.expires_at DESC
    `).all(`-${hoursBack} hours`);
  },

  /**
   * Flip an expired order back to 'paid' because its payment was found late.
   * Idempotent: only succeeds if current status is 'expired'. Returns true on
   * successful flip, false if status was already changed (delivered/paid/etc).
   */
  markRecoveredPaid(orderId) {
    const r = db.prepare(`
      UPDATE orders
      SET status = 'paid', payment_matched_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'expired'
    `).run(orderId);
    return r.changes > 0;
  },

  /**
   * Hard-delete orders that have been in 'expired' state for more than
   * `hoursBack` hours (default 24). Stock reservations were already released
   * at expiry time, so no extra cleanup is needed beyond the row delete.
   * Returns number of deleted rows.
   */
  cleanupExpiredOrders(hoursBack = 24) {
    const r = db.prepare(`
      DELETE FROM orders
      WHERE status = 'expired'
        AND expires_at IS NOT NULL
        AND expires_at < datetime('now', ?)
    `).run(`-${hoursBack} hours`);
    return r.changes;
  },
```

- [ ] **Step 4: Run test → PASS**

```bash
npx vitest run tests/services/orderRecovery.test.js
```
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/orderService.js tests/services/orderRecovery.test.js
git commit -m "feat(orders): getRecentlyExpired + markRecoveredPaid + cleanupExpiredOrders"
```

---

### Task D2: Index for cleanup query

**Files:**
- Create: `src/database/migrations/030_orders_status_expires_index.js`

- [ ] **Step 1: Write migration**

```javascript
// 030_orders_status_expires_index.js
// Composite index for cleanupExpiredOrders + getRecentlyExpired scans —
// both filter by (status, expires_at).
function up(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_status_expires_at
      ON orders (status, expires_at)
  `);
}
module.exports = { up };
```

- [ ] **Step 2: Apply + verify**

```bash
node -e "require('./src/database')"
sqlite3 data/shop.db ".indexes orders" | grep idx_orders_status_expires_at
```
Expected output: `idx_orders_status_expires_at`.

- [ ] **Step 3: Commit**

```bash
git add src/database/migrations/030_orders_status_expires_index.js
git commit -m "perf(db): index orders(status, expires_at) for expiry cleanup"
```

---

### Task D3: Poller scans recently-expired + flips on match

**Files:**
- Modify: `src/services/paymentPoller.js:139-197`

- [ ] **Step 1: Add recently-expired source to `_poll`**

In `src/services/paymentPoller.js`, replace lines 139-146 (the `Step 1: Get all active pending` block + early-return) with:

```javascript
      // Step 1: Get pending + recently-expired orders (24h recovery window) + pending topups
      const pendingOrders = orderService.getActivePending();
      const recentlyExpired = orderService.getRecentlyExpired(24);
      const pendingTopups = topupService.getActivePending();

      if (pendingOrders.length === 0 && recentlyExpired.length === 0 && pendingTopups.length === 0) {
        // Nothing to match — go dormant
        this.stop();
        return;
      }

      this.pollCount++;
```

- [ ] **Step 2: Include recently-expired in `minAmount` calc + match map**

Right after `this.pollCount++;` (which used to be line 148), the next block calculates `orderMin`. Replace lines 151-152 with:

```javascript
      const allOrders = pendingOrders.concat(recentlyExpired);
      const orderMin = allOrders.length ? Math.min(...allOrders.map(o => o.total_price)) : Infinity;
```

Then in the lookup-maps block (was line 159-162), change:
```javascript
      const orderMap = new Map();
      for (const order of pendingOrders) {
        if (order.payment_code) orderMap.set(order.payment_code, order);
      }
```
to:
```javascript
      const orderMap = new Map();
      for (const order of allOrders) {
        if (order.payment_code) orderMap.set(order.payment_code, order);
      }
```

- [ ] **Step 3: Handle expired-order match in `_processOrderMatch`**

At the top of `_processOrderMatch` (line 275), after the `if (!order) { … }` block (line 277-280), insert a recovery branch:

```javascript
    // If the order is in our map but already expired, attempt recovery.
    // markRecoveredPaid is no-op if status changed under us → safe.
    if (order.status === 'expired') {
      const recovered = orderService.markRecoveredPaid(order.id);
      if (!recovered) {
        // Lost race — order was already deleted or transitioned. Log + skip.
        console.log(`💸 Recovery skipped for expired order ${order.id} (status changed under us)`);
        return null;
      }
      console.log(`💸 Recovered expired order ${order.id} via late bank transfer`);
      // Re-read the row with fresh status so downstream paths see 'paid'/etc.
      order = orderService.getById ? orderService.getById(order.id) || order : order;
      order.status = 'paid';
    }
```

(The `orderService.getById` check is defensive — if the method exists, use it; otherwise reuse the in-memory row with patched status.)

- [ ] **Step 4: Smoke-run existing poller tests**

```bash
npx vitest run tests/services/
```

Confirm no existing test broke.

- [ ] **Step 5: Commit**

```bash
git add src/services/paymentPoller.js
git commit -m "feat(poller): rescan recently-expired orders for late bank transfers"
```

---

### Task D4: Periodic 24h cleanup in poller tick

**Files:**
- Modify: `src/services/paymentPoller.js:93-106` (tick body)

- [ ] **Step 1: Add cleanup invocation every Nth tick**

Inside `ensureRunning()`, just before the `tick` arrow function declaration (around line 91), add:

```javascript
    // Run cleanup at most once every 30 minutes — 60 ticks at 30s, or fewer
    // ticks at a longer interval. Keeps DELETE cost negligible per tick.
    const cleanupEveryNTicks = Math.max(1, Math.round((30 * 60 * 1000) / intervalMs));
```

Inside the `tick` function body (line 93-103 in original), after `this.attempts++;` add:

```javascript
      if (this.attempts % cleanupEveryNTicks === 0) {
        try {
          const n = orderService.cleanupExpiredOrders(24);
          if (n > 0) console.log(`🧹 Cleaned ${n} expired orders older than 24h`);
        } catch (e) { console.error('cleanupExpiredOrders error:', e.message); }
      }
```

- [ ] **Step 2: Cleanup on startup too**

In `src/index.js`, after the poller is constructed and before `ensureRunning` is called (look for `paymentPoller`), add a one-shot:

```javascript
try {
  const n = require('./services/orderService').cleanupExpiredOrders(24);
  if (n > 0) console.log(`🧹 Startup: cleaned ${n} expired orders`);
} catch (e) { console.error('Startup cleanup error:', e.message); }
```

- [ ] **Step 3: Smoke**

Start the bot (`npm run dev`). Confirm startup log mentions cleanup (count may be 0 if no stale data). Manually insert a >24h-old expired order, restart, confirm it is deleted:

```bash
sqlite3 data/shop.db "INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, expires_at) SELECT u.telegram_id, 1, 1, 1000, 'PNS888881', 'expired', datetime('now','-30 hours') FROM users u LIMIT 1;"
# restart bot
sqlite3 data/shop.db "SELECT id FROM orders WHERE payment_code = 'PNS888881';"
# expected: empty
```

- [ ] **Step 4: Commit**

```bash
git add src/services/paymentPoller.js src/index.js
git commit -m "feat(poller): hard-delete expired orders older than 24h (startup + 30min)"
```

---

### Task D5: End-to-end smoke + ship note

**Files:**
- Modify: `CLAUDE.md` (append shipped-subprojects row + pending follow-up edits)

- [ ] **Step 1: Run all new tests**

```bash
npx vitest run tests/
```
Expected: all new test files pass; existing tests still pass.

- [ ] **Step 2: Verify message templates didn't break**

```bash
node scripts/verify-message-templates.js
```
Expected: clean run, no missing-variable errors.

- [ ] **Step 3: Append to CLAUDE.md**

In `/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/CLAUDE.md`, in the "Shipped sub-projects" table after the `v0.32-tma-perf` row, add:

```
| `v0.33-admin-stock-poller` | admin edit modal + global `require_2fa_all` toggle; low-stock routes via settings `low_stock_chat_id`/`thread_id` + threshold falls back to settings default; live-read `payment_poll_interval_seconds`; poller rescans recently-expired orders for late bank transfers + hard-deletes expired >24h. |
```

In "Pending follow-ups", remove "Refund route" entry if implemented in passing — otherwise leave. Add a fresh line if useful.

- [ ] **Step 4: Final commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): record v0.33-admin-stock-poller ship"
```

---

## Self-Review Notes (for the writer, not the executor)

- **Spec coverage:**
  - "super admin có thể chỉnh sửa thông tin các manager, admin khác" → Task A4 (Edit modal wires existing PATCH route).
  - "Bật tính năng bắt buộc 2fa hoặc không" → Task A2 (seed setting) + A3 (enforcement) + A5 (UI).
  - "tồn kho thấp báo về -1003865156744_2" → Task B1 (UI) + B2 (routing).
  - "Tồn kho thấp chỉ gửi 1 thông báo và không bị duplicate trong 24h" → Task B4 (regression test for existing dedup).
  - "low_stock_alert_threshold đang không đồng bộ" → Task B3 (per-product NULL falls back to settings default).
  - "kiểm tra lại các setting trong admin/settings đã được sync đúng chưa" → Task C3 (audit doc) + C1/C4 (fix the two that weren't synced) + C2 (remove unused).
  - "Các đơn thanh toán quá hạn sẽ được kiểm tra nếu có đơn mới thanh toán và gửi bulk order id qua API" → Task D3 (poller rescans expired orders in same bulk MBBank fetch — already bulk by date range).
  - "xóa order sau 24h nếu failed" → Task D1 + D4 (cleanupExpiredOrders on startup + every 30min).

- **Type/method consistency:**
  - `effectiveLowStockProducts()` returns `effective_threshold`; consumer (`notificationService.js:172`) reads `p.effective_threshold` (matched).
  - `getRecentlyExpired(hoursBack=24)`, `markRecoveredPaid(orderId)`, `cleanupExpiredOrders(hoursBack=24)` — names referenced consistently in D1/D3/D4.
  - `twofaPolicy.checkEnrollRequired({ role, totp_enabled, totp_required })` — same property names used in test and in A3 Step 5 wire-in.
  - `getPollIntervalMs()` returns ms (number); consumer treats as ms.

- **Placeholder scan:** Task A1 has the only true unknown (where 2FA enforcement lives) — it is a discovery step, not a placeholder. A3 Step 5 explicitly handles "if a similar block exists" with rewrite-in-place semantics.

- **Risk of A4 column edit:** The Edit Modal also lets a super_admin demote themselves, which would lock them out of admins.write. Acceptable risk — no different from current state. If needed, add a guard later.
