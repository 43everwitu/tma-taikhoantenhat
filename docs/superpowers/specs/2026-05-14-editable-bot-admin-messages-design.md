# Editable bot/admin/group messages — design

**Date**: 2026-05-14
**Status**: Spec
**Subsystem**: A (deferred from earlier roadmap)

## Goal

Move every hardcoded user-facing string in the bot, admin-notify channel, and
group order channel into the existing `message_templates` table so admins can
edit them at `/admin/messages` without code changes.

## Existing infrastructure (reuse, do not rebuild)

- Table `message_templates(key, channel, label, variables, body, default_body, updated_at)` — migration `012_message_templates.js`.
- `src/services/messageTemplateService.js` — `render(key, vars)`, `list()`, `get(key)`, `update(key, body)`, `reset(key)`, 30 s cache.
- Substitution: `{{name}}` is HTML-escaped at render time **unless** in `TRUSTED_VARS` (`keysBlock`, `usageInstructions`).
- Admin API `src/api/routes/admin/messages.js` (GET list, GET one, PUT body, POST reset, POST preview). Body is sanitized through `toTelegramHtml` for bot channel; passed through for web.
- Admin UI `/admin/messages` page already wired.
- Seed file `src/database/seeds/message-templates.json` is read by migration 012 at install.

## Gap — hardcoded strings still in code

| Key                            | Channel | Current location                                                | Variables                                                                |
| ------------------------------ | ------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `admin.backorder_paid`         | admin   | `paymentPoller.js:337`, `orderFulfillmentService.js:30`         | orderCode, productName, quantity, total, userMention                     |
| `admin.delivered`              | admin   | `paymentPoller.js:365`                                          | orderCode, productName, quantity, userMention                            |
| `admin.no_stock`               | admin   | `paymentPoller.js:385`                                          | orderCode, productName, quantity, userMention                            |
| `admin.payment_short`          | admin   | `paymentPoller.js:298,449,457,486,571`                          | orderCode, total, received, memo, userMention                            |
| `admin.low_stock`              | admin   | `notificationService.js:153`                                    | productName, productEmoji, productId, stockCount, threshold, stockUrl    |
| `group.order_card`             | group   | `orderChannelService.js:37+`                                    | orderCode, productName, variantName, quantity, totalSpoiler, userSpoiler |
| `bot.expiry_reminder`          | bot     | `keyExpiryReminderService.js:62`                                | productName, orderCode, daysLeft, expiresAt                              |
| `bot.backorder_wait`           | bot     | (new — currently inline in `paymentPoller.js` backorder branch) | orderCode, productName, etaText                                          |
| `bot.order_expired`            | bot     | `notificationService.js:67` (`notifyOrderExpired`)              | orderCode                                                                |
| `bot.order_cancelled_short`    | bot     | `notificationService.js:73` (`notifyOrderCancelled`)            | orderCode                                                                |
| `bot.stock_replenished`        | bot     | `notificationService.js:104`                                    | productEmoji, productName, stockCount                                    |

Total new rows: **11**.

## Changes

### 1. Migration `src/database/migrations/025_admin_group_templates.js`

Inserts the 11 rows with `ON CONFLICT(key) DO NOTHING` so reruns are no-ops.
Each row's `body` and `default_body` start identical to the current hardcoded
text (verbatim copy), preserving behavior on first deploy.

### 2. Seed file update — `src/database/seeds/message-templates.json`

Append the same 11 entries so fresh installs (migration 012 path) get them too.
Channel values `admin` and `group` are new.

### 3. `messageTemplateService.TRUSTED_VARS`

Add: `userMention`, `userSpoiler`, `totalSpoiler`. Callers pass these
pre-formatted (e.g. `<tg-spoiler>123,000đ</tg-spoiler>`, `<a href="tg://user?id=...">@x</a>`)
so the renderer must not escape the angle brackets.

### 4. Call-site refactors

For each row in the table above, replace the inline string construction with:

```js
const messageTemplateService = require('../services/messageTemplateService');
const body = messageTemplateService.render('<key>', { ... vars ... });
await adminNotifyService.notify('<type>', body, opts); // or bot.telegram.sendMessage / orderChannelService
```

Pre-formatted vars (spoiler, mention) are built next to the call site, then
passed in. Plain strings (orderCode, productName) go through normal escape.

Affected files:

- `src/services/paymentPoller.js` — 7 call sites (5 × payment_short, 1 × backorder_paid, 1 × delivered, 1 × no_stock, plus new `bot.backorder_wait` ctx.reply).
- `src/services/orderFulfillmentService.js` — 1 call site.
- `src/services/notificationService.js` — `checkLowStock`, `notifyOrderExpired`, `notifyOrderCancelled`, `notifyStockReplenished`.
- `src/services/orderChannelService.js` — `buildCard()` → render `group.order_card`.
- `src/services/keyExpiryReminderService.js` — `runOnce()` per-order body.

### 5. Admin API & UI

No new endpoints. Verify `/admin/messages` page groups templates by `channel`
and shows new groups `admin` and `group`. If page hard-codes `bot|web` only,
add the new groups to the tab list. (Single small frontend change.)

### 6. Sanitisation

`PUT /admin/messages/:key` already routes by channel:
- `channel === 'bot'` → `toTelegramHtml(body)`
- otherwise → passthrough (web/admin/group).

For `admin` and `group` channels, route them through `toTelegramHtml` too —
they are also sent via `bot.telegram.sendMessage` with `parse_mode: 'HTML'`.
One-line tweak in `admin/messages.js:31`:

```js
const sanitized = (channel === 'web') ? req.body.body : toTelegramHtml(req.body.body);
```

## Testing

- Unit: render each new key with the sample-vars block; assert no `{{` survives.
- Smoke (manual): in dev,
  1. Trigger backorder → admin DM uses templated body.
  2. Trigger insufficient payment → admin DM uses templated body.
  3. Reduce a product stock below threshold → admin low-stock alert templated.
  4. Wait for expired order → user gets `bot.order_expired` template.
  5. Edit `admin.delivered` in `/admin/messages`, trigger a delivery, verify
     bot sends new body.
- Snapshot: `messageTemplateService.list().length === 29` after migration.

## Out of scope (YAGNI)

- Per-locale / multi-language variants.
- Version history beyond existing `auditService.log` rows.
- Scheduled / time-bounded template variants.
- Editing command response strings beyond `/start` + `/myid` (already
  templated).
- Embedding inline images inside templates (text-only render).

## Risk & rollback

- Each call site has a `try/catch` around `notify`/`sendMessage`; a malformed
  template body that fails `parse_mode: 'HTML'` will be logged and skipped, not
  crash the worker.
- Per-template **Reset** button (`POST /admin/messages/:key/reset`) restores
  `default_body` if an admin breaks a template.
- Migration is additive only — rollback is `DROP` of the 11 inserted rows by
  key.

## Tag

Ship as `v0.27-editable-messages`.
