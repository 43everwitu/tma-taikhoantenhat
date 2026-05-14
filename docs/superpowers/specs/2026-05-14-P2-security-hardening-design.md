# P2 — Security hardening

**Date**: 2026-05-14
**Status**: Spec
**Tag on ship**: `v0.31-security`

## Goal

Close the open attack surface flagged in the audit: no rate-limiting, missing security headers, weak bcrypt cost, missing JWT expiry, and possible upload spoofing. Keep developer experience unchanged.

## Findings being addressed

1. **No rate-limit applied anywhere**. `express-rate-limit` is imported in `src/index.js` / `src/api/server.js` but `rateLimit(...)` is never called. `/auth/login`, `/auth/miniapp`, admin endpoints are open to brute force.
2. **bcrypt cost = 10** in `src/services/authService.js:SALT_ROUNDS` and inline calls in `src/api/routes/admin/admins.js`. OWASP 2026 baseline is 12.
3. **JWT `expiresIn` not visible in grep** — confirm before merging that all `jwt.sign` calls set a finite TTL (refuse otherwise).
4. **No Helmet / CSP / HSTS headers** — Cloudflare Tunnel terminates TLS but content-headers protect against XSS, clickjacking, MIME-sniffing.
5. **Upload filter is extension-based** in `src/api/routes/admin/upload.js`. Easy spoof — caller can name `foo.png` and ship a PHP / SVG-with-script payload. Need magic-byte sniff.
6. **Template-string SQL** in admin routes (`stock.js`, `categories.js`, `transactions.js`, `products.js`, etc.). Need to confirm each `where` / `sets` literal is assembled from a validated allow-list of column names (zod), not user-controlled keys.

## Changes

### Rate-limit

Three buckets via `express-rate-limit`:

| Mount | Window | Max | Skipped headers |
|---|---|---|---|
| `POST /api/v1/auth/login` | 15 min | 5 | none |
| `POST /api/v1/auth/miniapp` | 1 min | 30 | none |
| `/api/v1/admin/*` | 1 min | 120 | `RateLimit-*` exposed |
| `/api/v1/*` (customer) | 1 min | 180 | `RateLimit-*` exposed |

Mounted in `src/api/server.js`. Trust-proxy already set, so X-Forwarded-For is honored under Cloudflare Tunnel.

### Helmet

`npm i helmet`. Mount in `src/index.js` before the API. CSP set to allow:
- `'self'` for default
- `https://telegram.org` for the WebApp SDK script
- `data:` for inline images
- `'unsafe-inline'` for styles (Tailwind generates inline-ish; revisit later)
- `frame-ancestors 'self' https://web.telegram.org https://t.me` so TMA still works

### JWT expiry

Audit all `jwt.sign` sites. Default TTL: admin **24h**, miniapp **7d**. Persist via `JWT_ADMIN_TTL` / `JWT_MINIAPP_TTL` env (with defaults). If a call site lacks `expiresIn`, add it.

### bcrypt 10 → 12

Single constant move (`SALT_ROUNDS = 12`). Inline `bcrypt.hash(p, 10)` in `admins.js` switched to use the shared constant. Existing hashes work as-is (bcrypt embeds cost in the hash); only new password set/changes hit 12.

### Upload magic-byte check

Add `file-type` (or inline buffer header sniff) in `src/api/routes/admin/upload.js`. Whitelist: PNG (`89 50 4E 47`), JPEG (`FF D8 FF`), WebP (`52 49 46 46 ... 57 45 42 50`), AVIF (`66 74 79 70 61 76 69 66`). Reject otherwise with 415.

### SQL whitelist audit

For each file with `db.prepare(\`... ${literal} ...\`)`:
- Confirm the literal is built from zod-validated input mapped via a fixed dictionary (e.g. sort key → column name).
- Where not, refactor to switch/case mapping.

Files: `src/api/routes/admin/categories.js`, `transactions.js`, `stock.js`, `products.js`. Also migrations that pass `table` from caller code — those are static strings, safe.

### Out of scope

- CSRF: admin uses Authorization header (not cookies); inherently safe.
- 2FA / WebAuthn — own project.
- Audit-log retention / GDPR exports.
- Encryption key rotation procedure — document only, no code.

## Acceptance

- `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' -d '{"username":"x","password":"y"}'` returns 401 the first 5 times, then 429 for 15 minutes.
- `curl -I http://localhost:3000/` includes `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security`.
- New admin login emits a JWT whose `exp` claim resolves to ~now+24h. Mini App JWT `exp` ~now+7d.
- `bcrypt.hash(...)` calls in src/ all use `SALT_ROUNDS = 12`.
- Upload of `evil.png` whose first bytes are `<?php` → 415 with `INVALID_FILE_TYPE`.
- All `${where}`/`${sets}` SQL assemblers are documented in the spec follow-up — each backed by an inline whitelist or zod enum.

## Risk

- Rate-limit blocks legitimate burst during admin work — mitigate via 120/min admin bucket.
- Helmet CSP could break TMA if Telegram SDK domain changes — verify in dev before tagging.
- bcrypt cost-12 adds ~100 ms latency to logins — acceptable.
- Magic-byte rejection too strict on AVIF variations — accept both `avif` and `avis` brand codes.

## Rollback

- Each change is a separate commit; revert individually.
- Helmet behind an env flag `SECURITY_HEADERS_ENABLED=true` for canary deploys.
