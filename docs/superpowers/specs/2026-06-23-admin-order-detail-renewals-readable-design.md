# Admin Order Detail Drawer and Readable Renewal Logs Design

## Goal

Improve admin order investigation flow by adding a full order detail drawer on `admin/orders`, making `admin/renewals` rows readable for humans, and linking orders and renewal logs both ways.

The admin should be able to answer these questions quickly:

- Who bought this order?
- Which product and variant was delivered?
- Which stock/key/value is tied to the order or renewal reminder?
- Which payment/transaction matched the order?
- Which renewal reminder logs are related to the order?

## Scope

In scope:

- Add a `Chi tiết` action on `admin/orders`.
- Open order details in a right-side drawer.
- Keep sensitive values hidden by default with `Hiện tất cả` and per-value copy controls.
- Enrich `GET /admin/orders/:id` with structured detail data while preserving existing fields.
- Enrich `GET /admin/renewals` with readable product, variant, stock, order, and user fields.
- Add stock value reveal/copy in `admin/renewals`.
- Add cross-links:
  - order drawer renewal log link → `/admin/renewals?highlight=<logId>`
  - renewal row order link → `/admin/orders?highlight=<orderId>&detail=1`

Out of scope:

- No separate `/admin/orders/[id]` page.
- No new permission model.
- No audit/admin action timeline in this iteration.
- No unrelated refactor of orders or renewals pages.

## Current Context

`admin/orders` currently renders a table with row actions and already fetches `GET /admin/orders/:id` for delivered keys/customer input in small reveal popovers and manual delivery flows.

`GET /admin/orders/:id` currently returns a shaped order plus these backward-compatible fields when available:

- `accounts`
- `inputFields`
- `inputValueText`

`admin/renewals` currently reads `GET /admin/renewals` and shows technical identifiers such as `Product #513 · Stock #1181`. This is not enough for human investigation because variant name and stock value are not visible.

## Proposed Approach

Use controlled API enrichment rather than frontend-side stitching.

Backend routes will return detail DTOs with enough data for the UI to render directly:

- `GET /admin/orders/:id` becomes the source of truth for the drawer.
- `GET /admin/renewals` returns readable row fields.

This avoids multiple frontend queries per row, keeps SQL ownership near admin routes, and makes tests straightforward.

## Admin Orders UI

### Table action

Add a `Chi tiết` button to each row action group, before status-specific operational actions such as `Xác nhận`, `Giao thủ công`, `Gửi lại`, or `Sửa key`.

Clicking `Chi tiết` opens a right-side drawer without leaving the page.

If the page loads with:

```text
/admin/orders?highlight=<orderId>&detail=1
```

the page should select that order, highlight it, and open the detail drawer automatically.

### Detail drawer layout

Drawer sections:

1. Header
   - `Đơn #<id>`
   - status pill
   - `Nhắn tin` link if Telegram contact data exists
   - close button

2. Overview
   - status
   - created/paid/delivered/expires/deleted timestamps when available
   - source
   - quantity
   - total price

3. Customer
   - full name
   - username
   - Telegram ID
   - contact link

4. Payment
   - payment code
   - bank name/source if available
   - matched transaction if available

5. Product
   - product id/name
   - variant id/name if available
   - legacy/default variant label when missing

6. Sensitive values
   - customer input
   - delivered keys
   - stock values linked to the order
   - expiry/sold metadata for stock rows

7. Related renewal logs
   - status
   - created time
   - expiry date/days before expiry
   - message preview
   - link to `/admin/renewals?highlight=<logId>`

### Sensitive value behavior

Sensitive values are hidden by default.

The drawer has:

- one `Hiện tất cả` / `Ẩn tất cả` toggle for sensitive sections;
- per-value `Hiện` / `Ẩn` controls when useful;
- copy buttons next to individual values.

The backend may return sensitive values for admins because the current admin orders UI already exposes delivered keys and decrypted customer input to authorized admins. The frontend must not auto-display them.

## Admin Renewals UI

Renewal rows should be readable without requiring admins to interpret raw ids.

Replace the current product subline:

```text
Product #513 · Stock #1181
```

with:

```text
Tài Khoản Super Grok (Grok 4)
Biến thể: Gói Super 30 ngày
Stock #1181
```

If variant data is missing:

```text
Biến thể: mặc định/legacy
```

If stock data is missing:

```text
Stock #1181 · value: —
```

Add stock value controls:

- `Hiện value`
- `Ẩn value`
- `Copy`

Values are hidden by default, matching the order drawer behavior.

If `orderId` exists, render it as a link to:

```text
/admin/orders?highlight=<orderId>&detail=1
```

If `orderId` is null for legacy/backfilled logs, do not create a fake order link. Keep the user/product/stock data visible.

## API Design

### `GET /admin/orders/:id`

Preserve existing top-level fields for backward compatibility:

- shaped order fields currently returned by `shapeOrder`
- `accounts`
- `inputFields`
- `inputValueText`

Add structured fields:

```ts
interface AdminOrderDetailDto {
  customer?: {
    telegramId: string
    fullName: string | null
    username: string | null
  }
  product?: {
    id: string
    name: string
    variantId: string | null
    variantName: string | null
    variantLabel: string
  }
  stockItems: Array<{
    id: string
    value: string
    variantId: string | null
    variantName: string | null
    soldAt: string | null
    durationDays: number | null
    expiresAt: string | null
    expired: boolean
  }>
  matchedTransaction?: {
    id: string
    amount: number
    description: string | null
    transactionDate: string | null
    bankReference: string | null
  } | null
  renewalLogs: Array<{
    id: string
    stockId: string | null
    status: 'sent' | 'sent_legacy' | 'skipped' | 'failed' | 'exhausted'
    expiryDate: string | null
    daysBeforeExpiry: number | null
    messagePreview: string
    createdAt: string
  }>
}
```

Stock rows should be tied to the order by the best available relation:

1. delivered key snapshot when available;
2. stock rows sold to the order user and product/variant around delivered time;
3. fallback existing legacy lookup behavior currently used for `accounts`.

Renewal logs should be tied by:

1. `order_id = order.id`;
2. plus stock ids found for the order;
3. fallback by same `user_id + product_id` when `order_id` is null and stock relation exists.

### `GET /admin/renewals`

Extend each row with readable fields:

```ts
interface RenewalLogRow {
  id: string
  stockId: string | null
  stockValue: string | null
  orderId: string | null
  userId: string
  userName: string | null
  username: string | null
  productId: string
  productName: string
  variantId: string | null
  variantName: string | null
  variantLabel: string
  expiryDate: string | null
  daysBeforeExpiry: number | null
  telegramSent: boolean
  webNotificationId: string | null
  status: RenewalStatus
  errorMessage: string | null
  messageBody: string
  createdAt: string
}
```

The route should join:

- `stock` by `renewal_reminder_logs.stock_id`
- `product_variants` by `stock.variant_id`
- `orders` by `renewal_reminder_logs.order_id`
- `users` by `renewal_reminder_logs.user_id`

Legacy rows must still render if joins are missing.

## Error Handling

- Missing order: keep current 404 response.
- Missing stock: render stock id if present, value `—`.
- Missing variant: render `Biến thể: mặc định/legacy`.
- Missing order id on renewal: do not render an order link.
- Decrypt customer input failure: do not crash; return no decrypted input and optionally a readable `inputError` field.
- Missing transaction: render `Chưa có giao dịch match` instead of an empty block.

## Testing

Backend tests:

- `GET /admin/orders/:id` returns customer/product/variant/stockItems/renewalLogs for a delivered order.
- Sensitive data remains returned only through admin route and does not break existing `accounts/inputFields/inputValueText`.
- `GET /admin/orders/:id` handles legacy/missing variant without crashing.
- `GET /admin/renewals` returns `variantName`, `variantLabel`, `stockValue`, `userName`, and `orderId` when available.
- `GET /admin/renewals` handles legacy/backfilled rows with no order id.

Frontend checks:

- Targeted eslint for touched admin orders and renewals pages.
- Verify hidden-by-default sensitive values in drawer and renewal rows.
- Verify `/admin/orders?highlight=<id>&detail=1` opens the drawer.
- Verify renewal order links use `/admin/orders?highlight=<id>&detail=1`.

Data hygiene:

- If tests create DB fixtures, they must clean up after themselves.
- After final verification, run:

```bash
node scripts/purge-test-data.js
node scripts/purge-test-data.js --apply
```

Do not stage or commit `data/shop.db`, DB backups, uploads, logs, or temporary visual companion files.

## Acceptance Criteria

- `admin/orders` has a `Chi tiết` action that opens a right-side drawer.
- Drawer shows full readable order context and related renewal logs.
- Sensitive values are hidden by default and can be revealed/copied.
- `admin/renewals` no longer relies on raw `Product #... · Stock #...` as the primary readable context.
- Renewal stock values can be revealed/copied.
- Orders and renewals link to each other using query params.
- Existing order actions still work.
- Targeted backend tests and frontend lint pass.
