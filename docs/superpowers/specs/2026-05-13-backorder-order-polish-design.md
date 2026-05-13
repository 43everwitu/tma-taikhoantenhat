# Back-order Variants + Order/Bot/UI Polish — Design

**Date:** 2026-05-13

## Scope

Six bundled features around order lifecycle:

1. **A** Variant back-order flag: variant.is_backorder=1 → no stock keys required; admin handles each order manually.
2. **B** Bot delivery message reformat: compact card; keys > 3500 chars sent as `.txt` attachment.
3. **C** Admin `/admin/orders` can CRUD delivered keys post-delivery.
4. **D** Customer order page: clickable URLs inside keys + per-key "Sao chép" button.
5. **E** Navbar support button driven by new `settings.support_url`.
6. **F** `/start` welcome cleanup: drop balance, append support contact.

## Schema

Migration 021 adds:
- `product_variants.is_backorder INTEGER DEFAULT 0`

No new columns on `orders`. Existing `auto_confirmed` already 0 for manually-delivered orders. We reuse `status='paid'` for the in-between state (paid but undelivered) and the admin UI distinguishes via `is_backorder` lookup through `variant_id`.

## Flow

```
customer pays backorder variant
  → poller matches QR
  → orderService.confirmAndDeliver detects variant.is_backorder=1
  → marks paid + paid_at, SKIPS stock reservation, SKIPS deliver step
  → fires adminNotifyService.notify('backorder_paid', payload)
admin sees /admin/orders → "Cần xử lý thủ công" badge → "Giao thủ công"
  → modal: paste keys (textarea, 1 per line) → POST /admin/orders/:id/manual-deliver
  → server stores keys in delivered_keys_json, marks delivered_at, status=delivered
  → notificationService.notifyOrderDelivered(order, keys) fires same Telegram message
```

## Components

- **`src/services/orderService.js`** — `confirmAndDeliver` branches on `variant.is_backorder`. Pre-existing `manual-deliver` admin route already mostly does the right thing; we route the customer notification through it.
- **`src/services/notificationService.js`** — `notifyOrderDelivered` reformatted; switches to `.txt` attachment when message length > 3500.
- **`src/api/routes/admin/orders.js`** — new `PATCH /:id/keys` for editing delivered key list; existing `manual-deliver` reused as the back-order completion route.
- **`web/src/app/(admin)/admin/orders/page.tsx`** — new "Giao thủ công" + "Sửa key" actions with modals.
- **`web/src/app/(miniapp)/don-hang/[id]/page.tsx`** — autoLink + copy button.
- **`web/src/app/(miniapp)/components/MiniAppShell.tsx`** — render support icon when `supportUrl` present.
- **`src/api/routes/public.js`** — `/shop/info` returns `supportUrl`.
- **`src/api/routes/admin/settings.js`** — accept + return `support_url`.
- **`src/seeds/messageTemplates.js`** + DB seed — welcome template loses `{balance}`, gains support line.

## Non-goals

- Per-shipment tracking, multi-step fulfilment workflow, refunds. Out of scope.
- Telegram channel target for admin notification (we reuse the existing single admin chat target via `adminNotifyService`).

## Testing

Smoke matrix in plan. No unit tests added because all hot paths exercise SQLite + Express + Telegraf which are awkward to mock and the existing test suite has no coverage for these flows; manual smoke covers acceptance.
