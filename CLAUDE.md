# CLAUDE.md — Taikhoantenhat Bot

Telegram Mini App shop. Single Node process bundles bot + REST API + payment poller.

## Stack

- **Runtime**: Node 20+ (`.nvmrc` pins 20), single process via `src/index.js`
- **DB**: `better-sqlite3`, runtime file is **`data/shop.db`** (NOT `db.sqlite` — that's a stale fork artifact)
- **HTTP**: Express + `express-rate-limit`. `app.set('trust proxy', 1)` — Cloudflare Tunnel sends `X-Forwarded-For`
- **Telegram**: `telegraf` long-polling; bot is thin (`/start` + `/myid` + WebApp button). Legacy bot at `src/bot-legacy.js` (slated for deletion)
- **Web**: Next 16 App Router + Turbopack in `web/`, route groups `(miniapp)` + `(admin)`. Dev on `:3001`, rewrites `/api/*` + `/uploads/*` → `:3000`
- **Payments**: Python sidecar `mbbank-api/` (FastAPI on `:8000`), polled by `src/services/paymentPoller.js`
- **Imports**: WP dump parsed by `scripts/wp-migration/*` → `npm run migrate:wp`

## Commands

```bash
./dev.sh              # mac: 3 services in Terminal tabs
npm run dev:all       # concurrently into logs/{mbbank,api,web}.log
npm run dev           # api only (node --watch)
npm run dev:web       # web only (Next on :3001)
npm run migrate:wp    # WP SQL dump → shop.db + sharp pipeline
```

Ports: api `:3000`, web `:3001`, mbbank `:8000`.

## Key files

- `src/index.js` — Express boot, trust-proxy, `/uploads` static mount, route wiring
- `src/api/routes/` — `public.js` (catalog), `customer.js` (auth/orders), `auth.js` (Mini App initData verify), `events.js` (SSE), `admin/*`
- `src/services/orderService.js` — order lifecycle, publishes `order.status` / `order.delivered` on eventBus
- `src/services/paymentPoller.js` — long-running QR matcher; **do not** add eventbus publishes here (lives in orderService)
- `src/database/migrations/` — schema; seeds in `seeds/`
- `web/src/app/(miniapp)/components/AuthBoundary.tsx` — 1.5s timeout falls to `guest` so public pages render outside Telegram
- `web/src/app/(miniapp)/components/MiniAppShell.tsx` — sticky header + bottom nav, uses `usePathname` for active state
- `web/src/app/globals.css` — `.miniapp-*` classes; brand tokens `--brand-gold:#ffc200` + `--brand-ink:#1c222b` + Clay cream/oat

## Conventions

- **Brand**: gold `#ffc200` + ink `#1c222b` over Clay cream/oat. Don't reintroduce Tailwind default blues
- **i18n**: Vietnamese UI strings in `web/src/i18n/vi.ts`, use `t.section.key` — no hardcoded VN text in components
- **Images**: Next/Image `fill` needs **inline** `style={{ position: 'relative' }}` on parent (CSS-only `position: relative` races stylesheet load in dev)
- **Hydration**: Telegram script patches `<html>` CSS vars pre-hydrate; `<html>` + `<body>` have `suppressHydrationWarning`
- **Dev origins**: `web/next.config.ts` `allowedDevOrigins` lists `*.trycloudflare.com` + ngrok wildcards for tunnel testing
- **Auth**: Mini App POSTs `initData` to `/api/v1/auth/miniapp` → JWT in localStorage (`miniappAuth.ts`)

## Gotchas

- `data/db.sqlite` + `db.sqlite.fresh` are leftover fork files — runtime is `data/shop.db`
- WP migration auto-detects tarball at repo-root or parent `telegram-shop-bot/` dir (`scripts/wp-migration/config.js`)
- License CSV (`data/wp-imports/lmfwc-export.csv`) is optional; admin exports from WP-admin License Manager
- Bot must run on **long-polling** (no webhook in dev); only one instance can hold the lock — kill stale node procs before restarting
- Plans live in `docs/superpowers/plans/`; specs in `docs/superpowers/specs/`. Sub-projects #4/#5/#6/#8 still pending

## Pending follow-ups

- Refund route `POST /api/v1/admin/orders/:id/refund` then delete `src/handlers/adminActions.js` + `src/bot-legacy.js`
- 2 stale `paymentConfirm` comments in `src/services/notificationService.js:254,262`
- Sub-project #4 geo-block middleware, #5 custom-info order flow, #6 per-order chat, #8 legacy public web cleanup
