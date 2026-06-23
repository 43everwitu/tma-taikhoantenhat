# Test Data Purge And Vietnam Time Display Design

## Context

The admin orders dashboard currently shows test rows such as user `9990001 / Test`, product `R`, and `1.000đ` totals. These rows came from earlier prompt/test work and should not remain visible after the verification work is done.

The dashboard also displays order timestamps as if SQLite timestamp strings are already local time. SQLite `CURRENT_TIMESTAMP` and `datetime('now')` are UTC. API responses currently expose values like `2026-06-13 03:35:37` without a timezone marker, and the frontend parses that as local browser time. The correct Hanoi display for that UTC timestamp is `10:35:37 13/06/2026`.

## Goals

- Remove prompt/test data related to user `9990001`, product name `R`, product name `Test`, and product slugs matching `r-*`.
- Make the purge safe: print affected counts first, create a DB backup, run inside a transaction, and print post-purge counts.
- Remove related rows that would otherwise keep test artifacts around, including orders, stock, transactions matched to those orders, and orphan test products.
- Standardize frontend timestamp display so DB timestamp strings are interpreted as UTC and rendered in `Asia/Ho_Chi_Minh`.
- Apply the shared formatter to admin order timestamps and other frontend surfaces that rely on the common `formatDate` helper.
- Keep implementation surgical. Do not alter payment matching, order state transitions, or DB timestamp storage semantics.
- Always remove temporary test cases and temporary test data after verification. No temporary test case should remain committed or active in the production DB.

## Non-Goals

- Do not delete real customer/order data.
- Do not change SQLite timestamp storage from UTC.
- Do not change order expiry, recovery, stock reservation, wallet, or MBBank matching behavior.
- Do not add a permanent test product/user fixture.
- Do not rely on changing the browser, OS, or server timezone to fix frontend display.

## Test Data Purge Design

Create a script such as `scripts/purge-test-data.js` that uses the existing `src/database` connection.

The purge target is intentionally narrow:

- user: `users.telegram_id = 9990001`
- product: `products.name IN ('R', 'Test')`
- product slug: `products.slug LIKE 'r-%'`
- orders linked to either the target user or target products
- transactions where `matched_order_id` is one of the target orders
- stock where `product_id` is one of the target products

Before deleting anything, the script prints counts for:

- target users
- target products
- target orders
- target stock rows
- target transactions

Before the transaction, the script copies `data/shop.db` to a timestamped backup path under `data/`, for example `data/shop.db.bak-pre-test-purge-YYYYMMDD-HHMMSS`.

The delete order should avoid foreign key failures:

1. Delete matching transactions.
2. Delete matching orders.
3. Delete stock for target products.
4. Delete target products.
5. Delete user `9990001` if no remaining orders reference it.

The script should abort if it detects target products that are referenced by non-test users, unless those orders are also explicitly in the target set through the product rule. This keeps the rule conservative and visible.

## Time Display Design

Add or update shared frontend utilities in `web/src/lib/utils.ts`:

- Parse DB timestamp strings as UTC when they are in SQLite format (`YYYY-MM-DD HH:mm:ss`) and do not already include a timezone.
- Preserve correct parsing for ISO strings that already include `Z` or an offset.
- Format using `Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', ... })`.

The common `formatDate()` should use this parser/formatter so existing consumers such as admin orders, stock, account page, and similar surfaces become consistent.

For local page-level formatters that duplicate date logic, either replace them with the shared `formatDate()` or use the same parser behavior. The first priority is the admin orders dashboard shown in the screenshot.

## Error Handling

- Purge script must fail before deletion if the DB file is missing or backup cannot be created.
- Purge script must use a transaction so partial deletes do not leave inconsistent rows.
- Frontend formatter should return the original value if parsing fails, preserving current fallback behavior.
- Invalid, empty, or null timestamps should render as an empty string or existing fallback text at call sites.

## Testing

Temporary verification is allowed, but temporary tests must be removed before finalizing.

Required verification:

- Run the purge script once after reviewing its dry counts and backup path.
- Confirm active dashboard test rows for user `9990001` and product `R` are gone from `data/shop.db`.
- Verify the backup file exists.
- Verify `formatDate('2026-06-13 03:35:37')` renders a Hanoi time around `10:35:37 13/06/2026`.
- Run targeted frontend/type/lint checks available in the repo for changed files.
- If a temporary test is added to prove the UTC parse boundary, remove it before the final commit.

## Success Criteria

- No active admin order rows remain for user `9990001 / Test` or product `R`.
- Test products `R`/`Test` and slug `r-*` artifacts are purged according to the script's printed counts.
- A timestamped DB backup exists before purge.
- Admin order timestamps display in Hanoi time, not raw UTC.
- Shared frontend timestamp formatting is consistent and explicit about `Asia/Ho_Chi_Minh`.
- No temporary test case remains in the repo or dashboard after the work is complete.
