# Payment Poller Vietnam Timezone Design

## Context

Order `100479` exposed a date boundary bug in automatic MBBank matching. The order was created late on `2026-06-12` in server/DB time, while the actual bank credit appeared in MBBank under `2026-06-13` Vietnam banking day. The shop poller queried `/transactions/credit` using:

```js
new Date().toISOString().split('T')[0]
```

`toISOString()` is always UTC, so changing only the host timezone does not fix this code path. Around midnight in Vietnam, the poller can ask MBBank for the previous UTC date and miss real payments.

Order `100479` has already been confirmed manually. This change must prevent future misses; it must not reprocess that order.

## Goals

- Query MBBank using the Vietnam calendar date, `Asia/Ho_Chi_Minh`.
- Set the Node/PM2 runtime timezone to `Asia/Ho_Chi_Minh` so logs, process-local date behavior, and SQLite localtime modifiers use the Vietnam timezone.
- Keep the existing payment matching policy unchanged: pending orders, recently expired orders, topups, amount checks, and delivery behavior stay as-is.
- Verify the boundary case where UTC date is still `2026-06-12` but Vietnam date is already `2026-06-13`.
- Per operator request, any temporary test case added only for this verification should be removed after the fix is validated.

## Non-Goals

- Do not auto-confirm or reprocess order `100479`.
- Do not change MBBank API behavior in `/home/peanut/telegram-shop-bot/mbbank-api`; it already returns the correct transaction when asked for the correct date.
- Do not change order expiry windows, recovery windows, stock reservation behavior, or wallet/topup policy.
- Do not change the machine OS timezone as part of the repo change.

## Approach

Use both code-level and runtime-level timezone fixes.

1. Add a small local date formatting helper for `Asia/Ho_Chi_Minh`.
2. Replace the UTC-derived poller date in `PaymentPoller._fetchTransactions()` with that helper.
3. Set `TZ=Asia/Ho_Chi_Minh` in PM2 configuration.
4. Document the expected `TZ` value in `.env.example` if that file already carries deployment/runtime env hints.

The code-level fix is the critical path because `toISOString()` ignores process timezone. The runtime `TZ` setting is still useful for logs, process-local date behavior, and SQLite localtime modifiers. SQLite `datetime('now')` and `CURRENT_TIMESTAMP` remain UTC.

## Data Flow

Current flow:

1. `PaymentPoller._poll()` collects active pending orders, recently expired orders, and pending topups.
2. `_fetchTransactions(minAmount)` computes one date and sends it as both `from_date` and `to_date`.
3. `mbbank-api` filters credit transactions by date, description containing `PNS`, and minimum amount.
4. Poller extracts `PNS<id>` from transaction descriptions and calls `_processOrderMatch()`.

Updated flow:

1. Steps before `_fetchTransactions()` remain unchanged.
2. `_fetchTransactions()` computes the banking query date in `Asia/Ho_Chi_Minh`.
3. The API request uses the Vietnam date for both `from_date` and `to_date`.
4. Matching, late recovery, short-pay handling, over-pay handling, stock delivery, and admin notifications remain unchanged.

## Error Handling

- If MBBank API request fails, the existing `null` return and poll retry behavior stays unchanged.
- If the helper cannot format a date, it should fail loudly in tests rather than silently falling back to UTC.
- No new customer-facing error path is introduced.

## Testing

Verification should cover the exact boundary that caused the issue:

- Simulate a UTC evening timestamp that is already the next calendar day in Vietnam.
- Assert the poller request body uses `from_date: "2026-06-13"` and `to_date: "2026-06-13"`.
- Run existing payment poller recovery tests to make sure late-expired matching behavior still works.

Because the operator requested not to keep the one-off test case, the implementation may add a focused temporary test during development, run it to prove the fix, then delete that temporary test before finalizing. Existing tests must still pass after the temporary test is removed.

## Deployment Notes

- PM2 should run the API process with `TZ=Asia/Ho_Chi_Minh`.
- After deploy/restart, future MBBank polling should use the Vietnam banking date even near midnight.
- Existing manually confirmed orders should not be touched by the deploy.

## Success Criteria

- Poller no longer uses `toISOString()` to choose the MBBank transaction date.
- PM2 config includes `TZ=Asia/Ho_Chi_Minh` for the relevant app process.
- Boundary verification proves a UTC evening timestamp maps to the next Vietnam date.
- Existing payment-related tests pass after the temporary boundary test is removed.
