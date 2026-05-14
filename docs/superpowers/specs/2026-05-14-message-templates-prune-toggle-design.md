# Message templates — prune, tone, toggle

**Date**: 2026-05-14
**Status**: Spec
**Tag on ship**: `v0.29-templates-prune`

## Goals

1. **Prune** 14 seeded-but-unused templates so `/admin/messages` shows only what the system actually sends.
2. **Tone** rewrite — drop anime persona (Onii-chan / Gomen / "~" / "nhé!") from the bodies that still ship. Brand voice: brief, neutral Vietnamese, "Bạn" or no subject.
3. **Toggle** — admin can disable optional templates. Core (transactional) templates stay locked on.

After this work, `message_templates` has 16 rows: 10 core (locked) + 6 optional (toggleable).

## Why these 14 are safe to delete

A grep across `src/` for `messageTemplateService.render('<key>'`) shows zero call sites for:

- Customer-side duplicates of TMA flows (`payment_pending`, `order_created`, `payment_failed`, `order_cancelled`) — TMA shows the QR, order summary, and status; the bot DMs were never wired.
- Promotional / nudge messages without a publisher (`low_stock_user`, `balance_low`, `refund`).
- Bot short variants whose helper methods (`notifyOrderExpired`, `notifyOrderCancelled`) are defined in `NotificationService` but never called (`bot.order_expired_short`, `bot.order_cancelled_short`).
- Web-channel notifications (`web.new_stock`, `web.restock_email`, `web.order_success`, `web.payment_failed`, `web.payment_expired`) — the `notifications` table is queryable but no publisher inserts rows of these types.

Migration deletes them by primary key, so existing admin edits to those rows are wiped (acceptable — admins never used them).

## Tone rewrite — changed rows

Three customer-facing actives ship with anime softeners. New strings (replace both `body` and `default_body`; for rows where admin already customized, only update `default_body`):

| Key | New default body |
|---|---|
| `welcome` | `Xin chào {{name}}.\n\nChào mừng đến với Taikhoantenhat — cửa hàng tài khoản số.\n\nBấm "Mở cửa hàng" bên dưới để bắt đầu.\n\nHỗ trợ: {{supportContact}}` |
| `payment_short` | `Shop nhận được <b>{{received}}đ</b> cho đơn <b>{{orderCode}}</b> nhưng cần <b>{{total}}đ</b>.\n\nVui lòng chuyển bù phần còn lại với nội dung <code>{{memo}}</code>.` |
| `payment_expired` | `Đơn <b>{{orderCode}}</b> ({{productName}}) đã hết hạn. Shop đã trả lại hàng. Vui lòng đặt lại nếu vẫn muốn mua.` |

Light polish (drop celebratory emoji storms, keep meaning):

| Key | New default body |
|---|---|
| `payment_success` | `Shop đã nhận thanh toán cho đơn <b>{{orderCode}}</b>.\n\n📦 {{productName}} × {{quantity}}\n💰 {{total}}đ\n\nĐang xử lý giao hàng.` |
| `topup_success` | `Shop đã cộng <b>{{amount}}đ</b> vào ví của bạn (mã: <code>{{memo}}</code>).\n\nSố dư mới: <b>{{newBalance}}đ</b>.` |

Other actives (`delivery_keys`, `bot.expiry_reminder`, `bot.stock_replenished`, `bot.backorder_wait`, all `admin.*`, `group.order_card`, `cmd_myid`) are already neutral.

## Toggle — schema + service + admin route

**Schema**: migration `027_template_enabled.js` adds:
```sql
ALTER TABLE message_templates ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1;
```

**Service** (`src/services/messageTemplateService.js`):
- New `CORE_TEMPLATE_KEYS = new Set([...])` with the 10 core keys.
- `loadAll()` includes `is_enabled` flag per row.
- New `isEnabled(key) → boolean` (core keys return `true` regardless of DB value).
- New `setEnabled(key, bool)` — throws `Error('CORE_TEMPLATE')` if `CORE_TEMPLATE_KEYS.has(key)`; otherwise `UPDATE … SET is_enabled = ?` and `invalidate()`.
- `list()` returns `{...row, enabled: !!r.is_enabled, core: CORE_TEMPLATE_KEYS.has(r.key)}`.
- `renderIfEnabled(key, vars) → string | null` — returns `null` when disabled, otherwise behaves like `render`.

**Admin API** (`src/api/routes/admin/messages.js`):
- New `PUT /:key/toggle` body `{enabled: boolean}` → `200` on success, `400 { code: 'CORE_TEMPLATE' }` for core keys.
- `GET /` and `GET /:key` already return raw rows; shape includes `enabled` + `core` after service update.

## Call-site updates — wrap optional sends in `renderIfEnabled`

Locations that render an **optional** key today must check `isEnabled` (or use `renderIfEnabled` + null check) before sending. Core call sites are unchanged.

| Optional key | Call site | New pattern |
|---|---|---|
| `welcome` | `src/commands/start.js:27`, `src/utils/messages.js:7` | `const body = messageTemplateService.renderIfEnabled('welcome', {...}); if (!body) return;` |
| `payment_expired` | `src/services/paymentPoller.js:564` (`_notifyExpired`) | same pattern |
| `bot.expiry_reminder` | `src/services/keyExpiryReminderService.js:58` | same |
| `bot.stock_replenished` | `src/services/notificationService.js:108` (`notifyStockReplenished`) | same |
| `admin.delivered` | `src/services/paymentPoller.js:380` | same |
| `admin.low_stock` | `src/services/notificationService.js:166` (`checkLowStock`) | same |

Core call sites (`delivery_keys`, `payment_short`, `payment_success`, `topup_success`, `bot.backorder_wait`, `admin.payment_short` × 5, `admin.backorder_paid` × 2, `admin.no_stock`, `group.order_card`, `cmd_myid`) keep using `render()`.

## Admin UI

`web/src/app/(admin)/admin/messages/page.tsx` — list rows.

Add to each row:
- For `core: true`: pill **"Bắt buộc"** + locked switch (always on, visually disabled).
- For `core: false`: Tailwind-style toggle switch → calls `PUT /admin/messages/<key>/toggle` with new value; on success update React Query cache.

## Migrations / seed updates

| File | Purpose |
|---|---|
| `src/database/migrations/026_template_prune_tone.js` (new) | DELETE 14 dead rows; UPDATE `default_body` for 5 rewritten rows; UPDATE `body` for the same 5 rows only where `body = default_body` at migration time (no admin edit). |
| `src/database/migrations/027_template_enabled.js` (new) | ADD COLUMN `is_enabled`. |
| `src/database/seeds/message-templates.json` | Remove the 14 dead entries; replace 5 bodies with the rewritten versions. |
| `scripts/verify-message-templates.js` | No code change — still iterates seed keys; now reports `All 16 templates render cleanly.` |

## Out of scope

- Versioned history of edits beyond audit log.
- Per-locale variants.
- Restoring deleted templates via UI (admin can re-create via API if a use case appears).
- Reviving the `web.*` channel — feature stays disabled until a publisher exists.

## Risk + rollback

- Pruning is destructive but only of unused rows. Pre-deploy snapshot: `sqlite3 data/shop.db .dump > backup.sql`. Restore via `sqlite3 data/shop.db < backup.sql` if any team has legacy expectations.
- Toggle defaults to enabled — no behaviour change on first deploy; admin opt-out only.
- Tone rewrite respects admin customizations via the `body = default_body` guard.

## Acceptance

- `node scripts/verify-message-templates.js` → `All 16 templates render cleanly.`
- `GET /admin/messages` returns 16 rows, each with `enabled` + `core` fields.
- `PUT /admin/messages/welcome/toggle` body `{enabled:false}` → 200; `/start` to bot then sends nothing; flip back → bot sends welcome again.
- `PUT /admin/messages/delivery_keys/toggle` body `{enabled:false}` → 400 `CORE_TEMPLATE`.
- Bodies in DB for `welcome`, `payment_short`, `payment_expired`, `payment_success`, `topup_success` show the new wording (where no admin edit had been applied).
