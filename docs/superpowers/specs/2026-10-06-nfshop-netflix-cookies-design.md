# Netflix Cookies product via nfshop API — Design

Date: 2026-10-06. Status: design approved in chat; spec self-reviewed.

## Goal

Sell "Gói Netflix Cookies" on the Mini App. After payment the order is fulfilled
automatically by calling the nfshop integration API (`https://nfshop.godstudy.me`,
repo `43everwitu/nfshop`, Python) and the customer receives an nfshop order link
`/o/{public_id}`. Delivery mode is backorder: customer pays, API result is delivered
without admin action.

## Product

Product "Gói Netflix Cookies" with 4 variants, all `is_backorder = 1`:

| Variant | Price | nfshop package | Validity | Quota |
|---|---|---|---|---|
| Cookies Premium | 50k | tier `premium`, monthly | 30 days | 10 links/day |
| Cookies Standard | 30k | tier `standard`, monthly | 30 days | 5 links/day |
| 1 link Premium | 5k | tier `premium`, `lifetime_mode` | 7 days | `quantity` links total |
| 1 link Standard | 3k | tier `standard`, `lifetime_mode` | 7 days | `quantity` links total |

Product + variants are created through the existing admin UI; `nfshop_package_id` is
attached afterwards. Not seeded by migration.

## Rules (agreed)

- Quantity N on a link variant => ONE nfshop order with N lifetime link uses (not N links).
- Monthly renewal: same Telegram `user_id` + same nfshop package, existing non-revoked
  nfshop order => extend that order (+30 days, additive from `max(now, expires_at)`) and
  resend the same link. Revoked order => create a new one. Different tier => new order.
- Link variant repeat purchase => always a new order (7 days from purchase).
- Link `/o/{public_id}` is a credential: never logged.

## Part A — nfshop changes (separate repo, own branch + pytest)

1. Packages: new boolean `lifetime_mode` (default 0). Create/update accept it.
2. Orders: new nullable column `lifetime_generation_limit`.
   `POST /api/v1/orders` accepts `link_quota` (int 1..100). Required semantics: allowed only
   when package is `lifetime_mode`; sets `lifetime_generation_limit`. For `lifetime_mode`
   orders the daily quota is not applied; generate is rejected with 429 (distinct message)
   when `generation_count >= lifetime_generation_limit`.
3. `POST /api/v1/orders` with an `external_reference` that already exists returns the
   existing order (HTTP 200) instead of creating another.
4. New `POST /api/v1/orders/{id}/extend` body `{days?, add_links?, reference}`:
   - `days` (1..365): new expiry = `max(now, expires_at) + days`.
   - `add_links` (1..100): only for orders with `lifetime_generation_limit`; adds to it.
   - atomic (`BEGIN IMMEDIATE`); revoked order => 400.
   - idempotent on `reference`: stored in `order_events`; a repeated reference returns the
     current order unchanged.
5. API doc `docs/api.md` updated. Four packages created via the API after deploy.

## Part B — this repo

- Migration 069: `product_variants.nfshop_package_id INTEGER NULL`,
  `nfshop_kind TEXT NULL` (`monthly` | `links`), `nfshop_valid_days INTEGER NULL`.
- Migration 070: `nfshop_orders(id, tma_order_id UNIQUE, user_id, variant_id,
  nfshop_package_id, nfshop_order_id, public_id, kind, created_at)`. Ledger used for
  renewal lookup and idempotency.
- `src/services/nfshopClient.js`: `createOrder`, `extendOrder`, `getOrder`, `revokeOrder`.
  Header `X-API-Key`, timeout, bounded retry on network/5xx, typed errors
  (`NfshopConflict` 409, `NfshopTransient` 5xx/network, `NfshopRejected` other 4xx).
  Config `NFSHOP_API_URL`, `NFSHOP_API_KEY` in `src/config.js` / `.env` (quoted).
- `src/services/orderService.js`: extract the "mark delivered + write
  `delivered_keys_json` + sold stock rows" block from the `manual-deliver` route into a
  shared `deliverWithAccounts(orderId, accounts, durationDays)`; route calls it
  (behaviour unchanged).
- `src/services/nfshopFulfillmentService.js`: subscribes to `order.backorder_paid`.
  For variants with `nfshop_package_id`:
  - `kind=monthly` + prior ledger row (same user, same package, not revoked) => `extendOrder`
    (`reference = tma-<orderId>`, `days = nfshop_valid_days`), deliver same link + renewal text.
  - `kind=monthly` otherwise => `createOrder`.
  - `kind=links` => `createOrder` with `link_quota = quantity`, `valid_days = nfshop_valid_days`.
  - Insert ledger row, deliver via `deliverWithAccounts` with `["<NFSHOP_API_URL>/o/<public_id>"]`,
    then `sendDelivery` + `postOrderCard` (same as `deliverOrder`).
- Failure: `NfshopTransient`/`NfshopConflict` => order stays backorder; sweep in the payment
  poller retries every 3 minutes; after 5 failed attempts send `admin.no_stock` once. Admin can
  still use `manual-deliver`. `NfshopRejected` => admin alert immediately, no retry.
- Retry safety: nfshop `external_reference` / `reference` idempotency + ledger `UNIQUE
  tma_order_id` guarantee at-most-once side effects per TMA order.

## Testing and safety

- `node --test`; nfshop HTTP mocked via injectable `fetch`. Bot and `telegramApiClient`
  mocked — never send real Telegram. No real nfshop calls.
- Every fixture cleans up in `t.after`; run `scripts/purge-test-data.js` dry-run then
  `--apply` and the GLOB sweep from CLAUDE.md at the end of each testing stage.
- nfshop: pytest with temp DB.
- No commits (user rule). Deploy of nfshop (git push + ssh pull + restart) and `.env` key
  entry are done only after explicit confirmation.

## Out of scope

`/admin/nfshop` management page, refunds/auto-revoke on refund, automatic renewal charging.
