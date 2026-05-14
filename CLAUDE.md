# CLAUDE.md — Taikhoantenhat Bot

Telegram Mini App shop. Single Node process bundles bot + REST API + payment poller. Frontend is Next 16 App Router (TMA + admin) on a separate port. Payment matching delegates to a Python FastAPI sidecar.

## Stack

- **Runtime**: Node 20+ (`.nvmrc` pins 20), single process via `src/index.js`
- **DB**: `better-sqlite3`, runtime file is `data/shop.db` (NOT `db.sqlite` — stale fork artifact)
- **HTTP**: Express + `express-rate-limit`. `app.set('trust proxy', 1)` — Cloudflare Tunnel sends `X-Forwarded-For`
- **Telegram**: `telegraf` long-polling; thin bot — `/start` + `/myid` + WebApp button. Legacy `src/bot-legacy.js` + `src/handlers/adminActions.js` slated for deletion
- **Web**: Next 16 App Router + Turbopack in `web/`, route groups `(miniapp)` + `(admin)`. Dev on `:3001`, rewrites `/api/*` + `/uploads/*` → `:3000`
- **Payments**: Python sidecar `mbbank-api/` (FastAPI on `:8000`), polled by `src/services/paymentPoller.js`
- **Imports**: WP dump parsed by `scripts/wp-migration/*` → `npm run migrate:wp`
- **Validation**: zod v4 — single-arg `z.record(valueType)` is NOT supported, use `z.record(z.string(), z.any())`

## Commands

```bash
./dev.sh              # mac: 3 services in Terminal tabs
npm run dev:all       # concurrently into logs/{mbbank,api,web}.log
npm run dev           # api only (node --watch)
npm run dev:web       # web only (Next on :3001)
npm run migrate:wp    # WP SQL dump → shop.db + sharp pipeline
node scripts/verify-message-templates.js   # render every template
npm run admin:reset-password [<user> [<pw>]]
```

Ports: api `:3000`, web `:3001`, mbbank `:8000`.

## Key files

- `src/index.js` — Express boot, trust-proxy, `/uploads` static mount, route wiring
- `src/api/routes/` — `public.js` (catalog), `customer.js` (auth/orders), `auth.js` (Mini App initData verify), `events.js` (SSE), `admin/*`
- `src/services/orderService.js` — order lifecycle, publishes `order.status` / `order.delivered` on eventBus
- `src/services/paymentPoller.js` — long-running QR matcher; **do not** add eventBus publishes here (lives in orderService)
- `src/services/messageTemplateService.js` — template render + cache + `is_enabled` toggle gate (see Message templates below)
- `src/database/migrations/` — schema; seeds in `seeds/`
- `web/src/app/(miniapp)/components/MiniAppShell.tsx` — sticky header, bottom nav, TMA BackButton via `useTelegramBackButton`, SearchModal trigger
- `web/src/app/(miniapp)/components/AuthBoundary.tsx` — 1.5 s timeout falls to `guest` so public pages render outside Telegram
- `web/src/app/globals.css` — `.miniapp-*` classes; brand tokens `--brand-gold:#ffc200`, `--brand-ink:#1c222b`, Clay cream/oat
- `web/src/lib/useTelegramBackButton.ts` — wires `window.Telegram?.WebApp?.BackButton` to router back

## Conventions

- **Brand**: gold `#ffc200` + ink `#1c222b` over Clay cream/oat. Don't reintroduce Tailwind default blues.
- **i18n**: Vietnamese UI strings in `web/src/i18n/vi.ts`, use `t.section.key` — no hardcoded VN text in components.
- **Images**: Next/Image `fill` parents need **inline** `style={{ position: 'relative' }}` (CSS-only races stylesheet load in dev).
- **Hydration**: Telegram script loads via plain async `<script>` in `<head>` (Next 16 `<Script beforeInteractive>` causes a polyfill-shim hydration mismatch under Turbopack). `<html>` + `<body>` have `suppressHydrationWarning`.
- **Dev origins**: `web/next.config.ts` `allowedDevOrigins` lists `*.trycloudflare.com` + ngrok wildcards for tunnel testing.
- **Auth**: Mini App POSTs `initData` to `/api/v1/auth/miniapp` → JWT in localStorage (`miniappAuth.ts`).
- **Tone**: bot/web bodies use neutral professional Vietnamese ("Bạn"), no anime softeners (Onii-chan / "nhé!" / "~"). Enforced at template level (`v0.29-templates-prune`).

## Admin

- Routes under `web/src/app/(admin)/admin/*`. Sidebar config: `web/src/components/AdminSidebar.tsx`.
- Auth: `POST /api/v1/auth/login` → JWT in `localStorage` (admin slot, separate from customer). Reset password: `npm run admin:reset-password [<user> [<pw>]]`.
- **RBAC** (`v0.14-rbac`): `permissionService.js` resolves `permissions || rolePermissions[role]`. Catalog: `dashboard.read`, `products.{read,write}`, `orders.{read,write}`, `stock.{read,write}`, `users.{read,write}`, `admins.{read,write}`, `settings.{read,write}`, `topups.{read,write}`, `messages.{read,write}`, `announcements.{read,write}`, `categories.{read,write}`. Roles: `super_admin` (`['*']`), `manager` (no dashboard/settings/admins/topups), `admin` (full minus admins).
- Middleware: `requireAdmin` → `loadAdminPermissions` (populates `req.admin.perms`) → route-level `requirePermission('x.y')`. `/admin/me` returns `{adminId, role, username, permissions}` for UI filtering.
- **Feature flags** (`v0.12-feature-gating`): `FEATURE_TOPUPS`, `FEATURE_BROADCAST`, `FEATURE_TELEGRAM_NOTIFY={order_only|full}` in `.env`. `GET /admin/features` returns the map. Sidebar hides items per flag. `/admin/messages` is NOT flag-gated — template editor is core (`v0.29-templates-prune`).
- **Media upload** (`v0.13-admin-modal`): `POST /admin/upload` (multer + sharp) writes to `data/uploads/products-inline/{hash}-{original|thumb}.{webp|avif}`. `GET /admin/uploads` lists files. Used by `RichEditorRich` TipTap inline image + Media Library picker.

## Message templates

- Table `message_templates(key, channel, label, variables, body, default_body, is_enabled, updated_at)`. 16 rows after `v0.29` prune.
- Channels: `bot` / `admin` / `group` / `web`. Each channel maps to a different delivery surface.
- Render via `messageTemplateService.render(key, vars)` (always renders) or `renderIfEnabled(key, vars)` (returns `null` when admin has disabled). Core templates always render regardless of `is_enabled`.
- Core list = `CORE_TEMPLATE_KEYS` in `messageTemplateService.js` (10 keys: `cmd_myid`, `delivery_keys`, `payment_short`, `payment_success`, `topup_success`, `bot.backorder_wait`, `admin.payment_short`, `admin.backorder_paid`, `admin.no_stock`, `group.order_card`). Toggle API rejects writes against these with `{code:'CORE_TEMPLATE'}`.
- Optional list (6 keys): `welcome`, `payment_expired`, `bot.expiry_reminder`, `bot.stock_replenished`, `admin.delivered`, `admin.low_stock`. Admin toggles via UI ON/OFF pill (`PUT /admin/messages/:key/toggle`).
- HTML safety: `escapeHtml` is the default at substitution time. Pre-rendered HTML vars (`keysBlock`, `userMention`, `inputBlock`, `customerLine`, `productLine`, `totalSpoiler`, `overpayBlock`, `stockUrlBlock`, `usageInstructions`, `waitMsg`) live in `TRUSTED_VARS` and pass through unescaped.
- `admin` and `group` channel bodies are routed through `toTelegramHtml` on save (`PUT /admin/messages/:key`) because both ship via `bot.telegram.sendMessage` with `parse_mode: 'HTML'`.

## Content + variants

- Product description sanitisation: `sanitizeDescription` in `src/utils/richHtml.js` allows `p, h2-4, ul/ol/li, table family, img, a, code, pre, blockquote, b/i/u/s, span[class], div[class]`. Distinct from `sanitizeRich` which is Telegram-narrow (`b/i/u/s/a/code/pre/br/tg-spoiler`).
- Frontend renders sanitised HTML via `dangerouslySetInnerHTML` into `.rich-text` containers — styling in `web/src/app/globals.css`.
- **WP migration** (`scripts/migrate-wp.js`): full migration is default; pass-2 `--inline-images` downloads body images from local backup → sharp pipeline; pass-3 `--normalize-tables` strips wpautop empty `<p>` and wraps orphan `<tr>` runs.
- **Product variants** (`v0.6-variants-api`): `product_variants` table linked to `products`. `stock.variant_id` / `orders.variant_id` nullable (NULL = legacy product-level). `orders.input_value` is AES-GCM encrypted via `src/utils/secrets.js`. `variantService` owns CRUD + per-variant `countAvailableStock`. Public `/products/:slug` returns `variants[]`. Order reservation branches by `variant_id`.

## Encryption

- AES-256-GCM helpers in `src/utils/secrets.js`: `encryptString` / `decryptString`. Reads `ENCRYPTION_KEY` (64 hex chars / 32 bytes) from `.env`. Output: base64 `iv|tag|ct`.
- Customer `inputValue` (variant email/password capture) round-trips through these helpers. Never logged.

## Gotchas

- `data/db.sqlite` + `db.sqlite.fresh` are leftover fork files — runtime is `data/shop.db`.
- **`.env` values containing `#`** are truncated by `dotenv` as inline comments. Always quote: `KEY='value#with#hash'`. This bit us once on `ADMIN_INITIAL_PASSWORD=Ljn...#` losing the trailing `#`. `npm run admin:reset-password` exists to fix the resulting hash mismatch.
- `seedAdmin()` is no-op when admins exist — changing `ADMIN_INITIAL_PASSWORD` later requires `npm run admin:reset-password`.
- Bot must run on long-polling (no webhook in dev); only one instance can hold the lock — kill stale node procs before restarting (`lsof -ti :3000 | xargs kill -9`).
- WP migration auto-detects tarball at repo-root or parent `telegram-shop-bot/` dir. License CSV (`data/wp-imports/lmfwc-export.csv`) is optional.
- Inline images for product descriptions resolve to `/uploads/products-inline/<hash>-original.webp` after migration pass-2.
- Next/Image `fill` parents need **inline** `style={{ position: 'relative' }}` (CSS-only races stylesheet load in dev).
- Next 16 `<Script strategy="beforeInteractive">` causes a hydration mismatch under Turbopack (server emits `type="text/javascript"` on the polyfill shim, client doesn't). Telegram WebApp script loads via plain `<script async>` in `<head>` instead.
- zod v4 dropped single-arg `z.record(valueType)`. Use `z.record(z.string(), z.any())`.
- Plans live in `docs/superpowers/plans/`; specs in `docs/superpowers/specs/`.

## Shipped sub-projects

| Tag | Scope |
|---|---|
| `v0.5-content-render` | F — sanitised HTML render + WP image migration pass-2 |
| `v0.6-variants-api` | H — `product_variants` table + admin/public API |
| `v0.7-content-tables` | I — table allow-list + normalize + auto-show "Thông tin sản phẩm" |
| `v0.8-home-overhaul` | K — categories above hero, recently-viewed, new, `/san-pham` page |
| `v0.9-variant-picker` | J — variant picker UI + email/pass input |
| `v0.10-brand` | C — favicon + metadata + audit `t.appName` |
| `v0.11-stock-ux` | A — `/admin/stock` search/filter/sort/quick-add |
| `v0.12-feature-gating` | D — `FEATURE_TOPUPS`/`FEATURE_BROADCAST` env flags |
| `v0.13-admin-modal` | G — TipTap rich + Media Library + multer upload |
| `v0.14-rbac` | B — RBAC: roles, permissions, `/admin/admins` |
| `v0.18-variants-stock-images` | variants stock breakdown + per-variant images + WP variation migration + UI polish |
| `v0.19-rail-slider-filter` | UX — horizontal rail sliders, category strip, compact filter dropdown, search-shake fix |
| `v0.20-search-position-variant-ux` | SearchBox below categories, variant grid on detail, fix variant-delete visibility, /stock requires variant when present |
| `v0.21-modal-refetch-fix` | Turbopack CSS delivery for variant grid + staleTime/refetchOnWindowFocus on admin queries to stop modal-open refetch storm |
| `v0.22-stock-variant-delete-fix` | /admin/stock/[id] variant select on add-stock + optimistic variant delete with rollback + idempotent backend variant delete |
| `v0.23-detail-rails` | center rich-text inline images + related-products + recently-viewed rails at bottom of `/san-pham/[slug]` |
| `v0.24-admin-toast` | minimal Toast provider + success/error toasts for variant/product/stock CRUD; soft-deleted variants get red bg + strikethrough + "Đã xoá" badge |
| `v0.25-variants-overhaul` | variants hard-delete (isActive = hide/show only), multi-input fields per variant, drag-and-drop reorder via @dnd-kit, longDescription max 5000→20000 |
| `v0.26-backorder-order-polish` | variant `is_backorder` flag + admin manual-deliver flow w/ admin notify, compact bot delivery message + .txt fallback, /admin/orders edit-keys CRUD, customer order page linkify + copy buttons, navbar support button (`settings.support_url`), `/start` welcome drops balance + adds support contact |
| `v0.27-editable-messages` | A — admin/group/bot message templates, `/admin/messages` covers all 4 channels (bot/admin/group/web), `scripts/verify-message-templates.js` smoke (was 29 templates pre-prune) |
| `v0.28-miniapp-ux` | UX — /san-pham caps 5 cols PC, quick-buy moved into product-info with zap icon, TMA BackButton via `useTelegramBackButton`, Lọc inline with chip row, variant input highlighted card, search button → popup modal in navbar |
| `v0.29-templates-prune` | templates — drop 14 unused seed rows (TMA covers payment/order flows), neutral pro tone (no Onii-chan / nhé / ~), per-template ON/OFF via `is_enabled` + `CORE_TEMPLATE_KEYS`, `renderIfEnabled` skips disabled sends, `/admin/messages` shows ON/OFF + "Bắt buộc" badge. 16 templates total. |

## Pending follow-ups

- Refund route `POST /api/v1/admin/orders/:id/refund` then delete `src/handlers/adminActions.js` + `src/bot-legacy.js`.
- 2 stale `paymentConfirm` comments in `src/services/notificationService.js` (search for `paymentConfirm`).
- Sub-project #4 geo-block middleware, #5 custom-info order flow, #6 per-order chat, #8 legacy public web cleanup.
- Order detail page (`/don-hang/[id]`) doesn't yet show variant name to customer — requires `orderService.getById` to JOIN `product_variants`.
- `confirmAndDeliver` fallback `getFreeStock` in `orderService.js` ignores `variant_id` — latent if reservations get lost.
- `notifyOrderExpired` / `notifyOrderCancelled` methods in `NotificationService` have no caller — either wire them or delete (their templates were already pruned in `v0.29`).
- Deprecated env vars `SEPAY_API_KEY`, `WEBHOOK_PORT`, `GOOGLE_SHEET_ID`, `SHEET_SYNC_INTERVAL` live in `src/config.js` but are only read by legacy modules — drop when legacy bot is removed.
