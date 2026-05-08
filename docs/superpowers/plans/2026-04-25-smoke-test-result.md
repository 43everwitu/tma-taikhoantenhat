# Smoke Test Results — Platform Overhaul
**Date:** 2026-04-25  
**Branch:** `feat/platform-overhaul`  
**Node:** v20.20.2

---

## 1. Static Checks

### 1a. TypeScript (`cd web && npx tsc --noEmit`)
**PASS** — TypeScript: No errors found.

### 1b. Backend Module Load
```
node -e "require('./src/services/orderService'); require('./src/services/paymentService'); require('./src/services/paymentPoller'); require('./src/handlers/paymentConfirm'); require('./src/api/routes/admin/products'); require('./src/api/routes/admin/orders'); require('./src/api/routes/customer'); console.log('OK')"
```
**PASS** — Output: `OK`

---

## 2. Migration Verification

| Check | Expected | Actual | Result |
|---|---|---|---|
| `003_usage_instructions.js` applied | present | present | PASS |
| `orders` sequence | ≥ 99999 | 99999 | PASS |
| `usage_instructions` column in `products` | exists | col 18, type TEXT | PASS |

Full migrations list applied:
```
001_initial.js
002_platform.js
003_usage_instructions.js
```

---

## 3. Stack Boot (12–18s window)

All three services launched. Log contents after 18s + kill/flush:

### Log Line Counts
```
       1 logs/mbbank.log
       1 logs/api.log
      19 logs/web.log
      21 total
```

All three logs **populated** (non-empty after kill flush). PASS for api + web.

### ANSI Escape Check
- `mbbank.log`: clean
- `api.log`: clean
- `web.log`: **1 residual sequence** — `[?25h` (cursor-show code from Next.js/Turbopack). This is a terminal cursor control code not matched by the current sed strip pattern in `dev-all.sh` (`s/\x1b\[[0-9;]*[mGKH]//g`). It does not affect log readability but is a minor issue.

### Log Tails

**mbbank.log:**
```
bash: python: command not found
```
> `python` is not in PATH on this machine — only `python3` is available. The `dev-all.sh` mbbank function calls `python -m uvicorn`. The mbbank API does not start. **This is a known issue** — fix: change `python` to `python3` in `dev-all.sh`, or add a `python → python3` alias.

**api.log:**
```
🌐 API Server running on port 3000
```
> API server started successfully.

**web.log:**
```
> web@0.1.0 dev
> next dev

⚠ Port 3000 is in use by process ..., using available port 3001 instead.
▲ Next.js 16.2.4 (Turbopack)
- Local:         http://localhost:3001
✓ Ready in 512ms
⚠ Warning: Next.js inferred your workspace root...
  (lockfile warning — non-fatal)
[?25h
```
> Next.js started successfully on port 3001 (3000 taken by API). Non-fatal warnings only.

---

## 4. Issues Found and Fixed

| # | Severity | Issue | Status |
|---|---|---|---|
| 1 | Medium | `python` not found — mbbank-api fails to start | **FIXED** in commit `19e9383`: script auto-detects `python3` |
| 2 | Low | Node 18 in calling shell breaks `next dev` + `better-sqlite3` | **FIXED** in `19e9383`: script auto-loads node 20 via nvm + prepends to PATH |
| 3 | Low | `[?25h` cursor-show code leaks into logs | **FIXED** in `19e9383`: `NO_COLOR=1` + `FORCE_COLOR=0` suppress ANSI at source |
| 4 | Low | Next.js workspace root lockfile warning | Open — add `turbopack.root` to `web/next.config.js` (cosmetic) |

## 4a. Re-run smoke test after fixes (post-`19e9383`)

```
$ ./scripts/dev-all.sh   # 18s window
Using node: /Users/peanut/.nvm/versions/node/v20.20.2/bin/node (v20.20.2)
[mbbank] Application startup complete.
[mbbank] Uvicorn running on http://127.0.0.1:8000
[api] 🌐 API Server running on port 3000
[web] ✓ Ready in 474ms — http://localhost:3001
```

Log line counts after fix:
```
       4 logs/mbbank.log
       1 logs/api.log
      18 logs/web.log
```

ANSI escape count: **0** in all three files. All three services successfully boot from a Node 18 shell via nvm auto-loading.

---

## 5. Manual Verification Checklist

The following items require a live Telegram + bank environment and cannot be verified non-interactively:

- [ ] **Place a Telegram order** → confirm QR shows transfer code `PNS<id>` where `id ≥ 100000` (first real order will be id 100001).
- [ ] **Bank transfer with content `PNS<id>`** → within ~30s the payment poller auto-detects; customer receives account credentials + `usage_instructions` message without any manual confirm step.
- [ ] **Open `/thanh-toan/<id>`** in browser → status shows as delivered; no manual-confirm button visible; status flips automatically after payment detected.
- [ ] **Admin login at `/admin/login`** → dashboard renders correctly; no Recharts `-1` height warning in browser console; all text is Vietnamese.
- [ ] **`/admin/products` — create product with usage instructions** → save → edit it → confirm `usage_instructions` field value persisted correctly.
- [ ] **`/admin/orders` confirm/cancel buttons** → click Confirm on a pending order → status changes to `delivered`; click Cancel → status changes to `cancelled`; API returns correct HTTP codes.

---

## 6. Branch Summary (git log --oneline)

```
e3a492c fix(admin): expose soldStock/totalStock; add Mã CK column to orders; ...
9673992 feat(admin): Clay tables + Vietnamese headers across all admin pages
2ee79e6 fix(web): add missing Clay shade tokens (ube-600, pomegranate-100/700...
6950f21 feat(admin): Clay redesign for sidebar + login + dashboard, fix chart...
8d68055 fix(payment): scope accounts query to order delivery window, live cou...
cdaf756 feat(web): Clay payment page with status polling, no manual confirm
9f4431f refactor(web): drop orphan Header/Footer, polish hero size + card hov...
25c9399 feat(web): Clay redesign for home + product pages, Vietnamese copy
697e013 feat(web): Clay design tokens + utility classes
1a53b14 chore(dev): unified dev:all logging via tee to logs/*.log
9c3496d fix(admin): cancel covers paid orders, returns 409 on invalid state
7e7e075 feat(admin): confirm/cancel orders from dashboard
3eb6c02 fix(admin): unique slug builder, HTML escape Telegram delivery, DELET...
702962a feat(admin): products CRUD with longDescription + usageInstructions, ...
33da008 fix(payment): tighten PNS regex, drop dead checkSingleOrder, unify pa...
75d9761 feat(payment): match PNS codes; remove user-side confirm; deliver usa...
6511ccf refactor(payment): centralize NAP top-up code generation in paymentSe...
54537fd feat(payment): use PNS<orderId> codes; insert order first to obtain id
c63d1c7 fix(db): guard sqlite_sequence existence + add header to migration 003
d290719 feat(db): add usage_instructions + reseed orders id from 100000
1d524aa chore: baseline platform scaffolding before overhaul
bd2a531 🌐 Add English README for international audience
996bb49 📞 Add contact info: Telegram @kentng & Zalo group
c4c83db ✨ Optimize README, SEO, license & repo presentation
e24e34f 🚀 Initial commit: Telegram Shop Bot with VietQR
```

---

## Summary

| Check | Result |
|---|---|
| TypeScript clean | PASS |
| Backend modules load | PASS |
| Migration 003 applied | PASS |
| Orders sequence ≥ 99999 | PASS |
| `usage_instructions` column | PASS |
| `api.log` populated | PASS |
| `web.log` populated | PASS |
| `mbbank.log` populated | PASS (4 lines, clean — after fix `19e9383`) |
| mbbank-api actually starts | PASS (after fix `19e9383`) |
| ANSI codes in logs | 0 (after fix `19e9383`) |
