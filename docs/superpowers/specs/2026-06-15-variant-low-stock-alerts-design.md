# Variant Low Stock Alerts Design

## Goal

Low-stock alerts must be calculated per sellable stock bucket instead of using total product stock when a product has variants.

## Scope

- Product without active non-backorder variants: keep product-level low-stock behavior.
- Product with active non-backorder variants: calculate low stock per variant.
- Backorder variants are excluded because they do not depend on key stock.
- Telegram/channel low-stock messages must show the variant name and variant id when the alert is variant-specific.
- `Đã up Stock` snoozes only the alerted target:
  - product target: product snooze
  - variant target: variant snooze
- Keep legacy `lowstock_done:<productId>` callback working for old Telegram messages.

## Data Model

Add `low_stock_alert_states`:

- `target_key` primary key: `p:<productId>` or `v:<variantId>`
- `target_type`: `product` or `variant`
- `product_id`
- `variant_id`
- `last_alert_at`
- `snoozed_until`
- `created_at`
- `updated_at`

Existing product columns `last_low_stock_alert_at` and `low_stock_snoozed_until` remain for backward compatibility and product-level alerts.

## Alert Query

`effectiveLowStockProducts()` becomes bucket-aware:

- Product bucket:
  - product active
  - no active non-backorder variants
  - count available stock where `variant_id IS NULL`
- Variant bucket:
  - variant active
  - `is_backorder = 0`
  - count available stock where `variant_id = variant.id`

Available stock means `is_sold = 0` and `reserved_for_order_id IS NULL`.

Threshold stays product-level for this iteration:

```text
COALESCE(products.low_stock_threshold, settings.low_stock_alert_threshold, 5)
```

No variant-specific threshold is added.

## Telegram Message

The low-stock template receives new variables:

- `variantLine`
- `variantName`
- `variantId`
- `targetType`
- `targetKey`

Default message includes a variant line only for variant alerts:

```text
🔖 Biến thể: <b>{{variantName}}</b>
🧩 Variant ID: <code>{{variantId}}</code>
```

The visible product id remains the product id, so managers can still navigate by product.

## Callback Behavior

New callback formats:

- `lowstock_done:p:<productId>`
- `lowstock_done:v:<variantId>`

Legacy callback:

- `lowstock_done:<productId>`

Callback effects:

- product callback sets `products.low_stock_snoozed_until` and upserts state `p:<productId>`
- variant callback upserts state `v:<variantId>` only
- callback deletes the Telegram message and answers `Đã ẩn cảnh báo tồn kho 24h`

## Self-Heal

When a bucket rises above threshold, clear that bucket's `last_alert_at` and `snoozed_until`.

For product-level buckets, also clear `products.last_low_stock_alert_at` and `products.low_stock_snoozed_until` when recovered.

## Dashboard Count

Dashboard low-stock count should count low-stock buckets, not products. If one product has two variants low, count is `2`.

## Non-Goals

- No variant-specific low-stock threshold.
- No manual UI for editing per-variant low-stock threshold.
- No change to stock replenished notifications.
