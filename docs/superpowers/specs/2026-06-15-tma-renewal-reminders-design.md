# TMA Renewal Reminders Design

## Goal

Show delivered account/key expiry status inside TMA, create TMA-visible notifications when renewal reminders are sent, and add an admin "Gia hạn" page that audits reminder delivery.

## Scope

- Applies to delivered orders whose sold stock rows have `duration_days > 0`.
- Covers both ready-stock delivery and backorder manual delivery, because both paths end up with sold `stock` rows when a duration is present.
- Does not change payment expiry behavior, payment reminders, order checkout, or the actual renewal purchase flow beyond linking the customer back to the product page.

## Customer Experience

### Order detail

On TMA order detail, delivered orders with expiry metadata show a compact progress block:

- purchase/start date from the earliest sold stock row used for the order
- expiry date from `sold_at + duration_days`
- remaining days
- progress bar matching the existing TMA visual language
- status label:
  - `Đang hoạt động` when more than the reminder window remains
  - `Sắp hết hạn` when remaining days are between 0 and the reminder window
  - `Đã hết hạn` when expiry date is before today

Orders without duration metadata show no progress block.

### Order list

The TMA order list keeps the normal payment/delivery status but, for delivered orders with expiry metadata, replaces the customer-facing label with renewal status:

- `Đang hoạt động`
- `Sắp hết hạn`
- `Đã hết hạn`

This makes the purchased account lifecycle visible without changing the underlying order `status`.

### Notification

When the existing daily Telegram renewal reminder sends successfully, the same sweep also creates a web notification for TMA:

- title: `<productName> sắp hết hạn`
- body: `Đơn #<orderId> còn <N> ngày sử dụng. Gia hạn trước <expiryDate> để tránh gián đoạn.`
- action data:
  - `orderId`
  - `productId`
  - `productSlug`
  - `renewUrl`: `/san-pham/<productSlug>?renewFromOrderId=<orderId>`
  - `orderUrl`: `/don-hang/<orderId>`

The TMA notification uses CTA `Gia hạn ngay` for `renewUrl` and `Xem đơn` for `orderUrl`.

TMA home reads `GET /notifications/my`, filters `renewal_reminder`, and shows the latest renewal cards above announcements. If customer auth is unavailable, the section stays hidden instead of blocking the storefront.

## Admin Experience

Add an admin sidebar entry `Gia hạn` and page `/admin/renewals`.

The page lists reminder attempts with:

- sent/attempted time
- order id
- customer id
- product name
- expiry date
- days before expiry
- channels: Telegram and TMA
- status: sent, skipped, or failed
- error message when present
- rendered message body

The first version is read-only. It is an audit/log page, not a manual resend console.

## Data Model

Create `renewal_reminder_logs`:

- `id`
- `stock_id`
- `order_id`
- `user_id`
- `product_id`
- `product_name`
- `expiry_date`
- `days_before_expiry`
- `telegram_sent`
- `web_notification_id`
- `status`
- `error_message`
- `message_body`
- `created_at`

Keep `stock.reminder_sent_at` as the existing dedupe marker. The log is for auditability and TMA notification traceability.

## Backend Design

Add a focused helper in `orderExpiryService`:

- compute expiry metadata for one order
- compute expiry metadata for recent orders
- locate the best delivered order for a sold stock row
- shape lifecycle status and URLs

The helper should prefer order-specific data as much as the current schema allows. Existing data does not link sold stock rows to exact order ids, so this implementation keeps the current best-effort match by `user_id + product_id`, ordered by delivered time, and centralizes that limitation in one service.

Update `keyExpiryReminderService.sweep()`:

- render the existing `bot.expiry_reminder`
- send Telegram DM when the template is enabled
- insert a TMA notification after successful Telegram send
- write a `renewal_reminder_logs` row for sent, skipped, and failed attempts
- set `stock.reminder_sent_at` for sent and template-skipped rows, preserving current dedupe behavior

## API Design

Customer APIs:

- `GET /orders/my` includes optional `keyLifecycle` for delivered orders.
- `GET /orders/:id/status` includes optional `keyLifecycle` for delivered orders.

Admin APIs:

- `GET /admin/renewals?page=1&limit=50&status=&q=` returns paginated reminder logs.

## Testing

Add focused Node tests for:

- expiry metadata calculation and status mapping
- `GET /orders/my` and `GET /orders/:id/status` returning lifecycle metadata
- reminder sweep creating web notification and log rows
- admin renewals route returning log rows

Frontend verification:

- TypeScript compile for changed TMA/admin pages.
- Lint the changed web files.

## Non-Goals

- No manual resend in this iteration.
- No new purchase API.
- No automatic renewal payment.
- No schema rewrite to attach sold stock rows to order ids.
