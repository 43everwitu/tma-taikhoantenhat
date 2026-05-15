# Settings Consumer Map (audit, 2026-05-15)

For each settings row exposed in `/admin/settings` UI, lists which runtime code reads it. Verified by `rg -n "<key>" src/`.

| Key | Consumer (file:line) | Read style |
|---|---|---|
| shop_name | src/api/routes/public.js:20 | live |
| support_contact | src/commands/start.js:24, src/services/keyExpiryReminderService.js:20 | live |
| support_url | src/api/routes/public.js:22 | live |
| backorder_wait_message | src/services/paymentPoller.js:354 | live |
| website_url | src/database/migrations/011_website_setting.js:10 (seed only) | boot |
| website_description | src/database/migrations/011_website_setting.js:12 (seed only) | boot |
| auto_payment_enabled | src/database/migrations/002_platform.js:180 (seed only) | **not read at runtime** |
| order_expiry_minutes | src/services/orderService.js:56 | live (fallback from settings) |
| payment_poll_interval_seconds | src/services/pollerConfig.js:9 | live (called each poll cycle) |
| topup_min_amount | src/services/topupService.js:147 | live |
| topup_expiry_minutes | src/services/topupService.js:28 | live |
| low_stock_alert_threshold | src/services/lowStockQuery.js:12 | live |
| low_stock_chat_id | src/services/adminNotifyService.js:29 | cached (30s TTL) |
| low_stock_thread_id | src/services/adminNotifyService.js:30 | cached (30s TTL) |
| notify_admin_new_order | src/services/adminNotifyService.js:16 | cached (30s TTL) |
| notify_admin_payment_short | src/services/adminNotifyService.js:16 | cached (30s TTL) |
| notify_admin_no_stock | src/services/adminNotifyService.js:16 | cached (30s TTL) |
| notify_admin_delivered | src/services/adminNotifyService.js:16 | cached (30s TTL) |
| notify_admin_low_stock | src/services/adminNotifyService.js:16 | cached (30s TTL) |
| require_2fa_all | src/services/twofaPolicy.js:9 | cached (30s TTL) |

## Cache invalidation

`src/api/routes/admin/settings.js` (PUT endpoint) invalidates the following caches on write:
- `adminNotifyService.invalidateCache()` when any key starts with `notify_admin_` or `low_stock_`
- `twofaPolicy.invalidateCache()` when `require_2fa_all` is in the request body

Cache TTLs:
- `adminNotifyService`: 30 seconds (toggleCache, lowStockTargetCache)
- `twofaPolicy`: 30 seconds (isGlobalForceOn cache)
- `pollerConfig.getPollIntervalMs()`: no cache — computed fresh each call (every 15–30s)
- `paymentPoller`, `orderService`, `lowStockQuery`, `topupService`: read fresh per operation

## Open follow-ups

- `website_url` and `website_description` are seeded at migration time but never read at runtime. Consider: (1) add consumer in a future feature that uses them (e.g., `/website` command handler), or (2) drop if not needed.
- `auto_payment_enabled` is seeded but never read at runtime. No code toggles payment automation. Check if payment matching in `paymentPoller.js` should be gated by this flag; if so, add a consumer at `paymentPoller.js:~300` (in `tryAutoDeliver`).
- `support_contact` read twice: once in `/start` command (line 24) and in `keyExpiryReminderService.js` (line 20). Both are live (not cached); consider consolidating if performance matters.
