# Taikhoantenhat Platform — Design Spec (Umbrella)

**Date:** 2026-05-08
**Status:** Approved (brainstorming session 2026-05-08)
**Type:** Umbrella spec — references 8 sub-project specs

## Purpose

Build a Telegram-native commerce platform for the **Taikhoantenhat** brand by forking the existing `starizzi-shop-bot` codebase. Customers access the storefront exclusively through a Telegram Mini App; admins manage everything through a private dashboard. There is no public website. Vietnamese-only UI.

The existing WordPress site (`taikhoantenhat.com`, WooCommerce + License Manager for WC) is being decommissioned. Its product catalog, categories, and unsold license keys migrate into the new platform; customer accounts and historical orders are dropped (Telegram identity replaces them).

## Goals

- Mobile-first storefront that feels native inside the Telegram client.
- Block direct browser access from Vietnamese IPs while letting Vietnamese users shop normally through the Telegram Mini App.
- Auto-deliver license keys on payment confirmation (existing flow), and add a manual fulfillment flow for products that require customer-supplied information (e.g., email/password for service products).
- Per-order chat thread bridging Mini App, admin dashboard, and Telegram bot DM.
- Reuse existing services where they fit (paymentPoller, notificationService, messageTemplateService, eventBus, qrCompositeService, MBBank API sidecar).

## Non-goals

- No public storefront, SEO, or marketing pages.
- No customer or order migration from WordPress.
- No multi-language UI. Vietnamese only.
- No multi-tenant support. This is a fork; if more brands are needed later, fork again.
- No bot-side shopping flow. Bot is a thin wrapper around the Mini App.

## High-level architecture

```
[Telegram client]
  ├─ Bot (thin: /start → Mini App button, notifications, DM bridge)
  └─ Mini App webview
        │ HTTPS
        ▼
[Cloudflare] (cf-ipcountry header, edge geo, TLS)
        │
        ▼
[Next.js single app on Node]
  ├─ middleware.ts → initData verify | VN block
  ├─ app/(miniapp)/* — customer surface (owns `/`, Vietnamese, mobile-first)
  ├─ app/(admin)/*   — dashboard (owns `/admin/*`, JWT auth)
  └─ app/api/v1/*    — REST + SSE /events
        │
        ▼
[Node process] Express + Telegraf + paymentPoller + eventBus + notificationService
        │
        ▼
[SQLite WAL]  +  [mbbank-api Python sidecar]  +  [data/uploads/products/]
```

The single Node process model from `starizzi-shop-bot` is preserved unchanged.

## Confirmed decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Fork model — separate repo, DB, bot token, deployment | Clean isolation; brand and audience differ enough that shared code would create coupling without benefit |
| 2 | Single Next.js with `(miniapp)` + `(admin)` route groups | Shared types, components, services, single deploy; no perf benefit to splitting into a Vite SPA |
| 3 | Migrate products + categories + unsold license keys only | Customer/order history has no value when identity model changes to Telegram-id |
| 4 | Copy product images, sharp pipeline (AVIF + WebP, 800w + 400w thumb) | Bandwidth-conscious mobile delivery; uploads dir has 1 GB / 16k files but most is WP cruft — filter aggressively |
| 5 | Geo-block via Cloudflare `cf-ipcountry` + Next.js middleware | initData HMAC bypass is the natural differentiator; CF country header is free and accurate |
| 6 | Thin bot — only entry point and notifications | Mini App is primary surface; bot UX would duplicate work |
| 7 | Custom-info orders collected pre-payment, encrypted at rest | Avoids abandoned-after-pay limbo; admin gets all needed info immediately |
| 8 | Per-order chat thread, SSE eventBus reuse | Existing pubsub already handles this pattern; thread-per-order keeps context tight |

## Sub-project decomposition

Each sub-project gets its own design spec, plan, and implementation cycle.

| # | Sub-project | Spec file | Depends on |
|---|-------------|-----------|------------|
| 1 | Fork foundation | `2026-05-08-taikhoantenhat-fork-foundation-design.md` | — |
| 2 | WordPress data migration | `2026-05-09-taikhoantenhat-wp-migration-design.md` (TBD) | 1 |
| 3 | Mini App MVP | `2026-05-09-taikhoantenhat-miniapp-mvp-design.md` (TBD) | 1 |
| 4 | Geo-block middleware | `2026-05-10-taikhoantenhat-geoblock-design.md` (TBD) | 3 |
| 5 | Custom-info order flow | `2026-05-10-taikhoantenhat-custom-info-orders-design.md` (TBD) | 2, 3 |
| 6 | Per-order chat + sync | `2026-05-11-taikhoantenhat-order-chat-design.md` (TBD) | 3 |
| 7 | Thin bot rewrite | `2026-05-11-taikhoantenhat-thin-bot-design.md` (TBD) | 1 |
| 8 | Cleanup + polish | `2026-05-12-taikhoantenhat-cleanup-design.md` (TBD) | 3, 4, 5, 6, 7 |

### Dependency graph

```
1 (fork) ─┬─► 2 (migrate) ─┐
          ├─► 3 (mini app) ─┴─► 5 (custom-info) ─┐
          │                ├─► 4 (geo)           ├─► 8 (cleanup)
          │                └─► 6 (chat)          │
          └─► 7 (bot thin) ─────────────────────┘
```

After #1 lands, sub-projects 2 / 3 / 7 can run in parallel sessions or worktrees.

## Cross-cutting concerns

### Language and locale

- All user-facing strings (Mini App, bot DMs, notifications, admin dashboard labels) in Vietnamese (vi-VN).
- Currency: VND, no minor units, formatted `1.234.567 ₫` (Vietnamese locale).
- Dates: `DD/MM/YYYY HH:mm`.
- Use `messageTemplateService` for any string a customer sees, so admins can edit copy without redeploys.
- Telegram `language_code` from `initDataUnsafe.user.language_code` is ignored; the app forces Vietnamese.

### Security

- **initData verification** on every Mini App API request: HMAC-SHA-256 with bot token's secret-key. Reject if older than 24h.
- **AES-256-GCM** for `orders.customer_inputs` (customer-supplied credentials). Key from `ENCRYPTION_KEY` env var, 32 bytes hex; loss of key = loss of unfulfilled order data. Document key backup procedure.
- **Auto-purge** customer inputs N days (default 7) after order delivery. Keep `fulfillment_result` longer for support.
- **Rate limit** all `/api/v1/*` and Mini App routes by Telegram user-id (initData) and by IP for non-Mini-App callers. Reuse existing rate-limit middleware where present.
- **Origin lock**: Cloudflare in front of origin; firewall accepts only Cloudflare IP ranges, otherwise `cf-ipcountry` is spoofable.

### Observability

- Reuse existing logger setup (Pino) and log levels.
- Migration script must produce a structured report: counts of products imported, categories imported, keys imported, images optimized, files skipped, errors.
- Add a `/health` route that includes DB version, last paymentPoller run, eventBus subscriber count.

### Image storage

- `data/uploads/products/` (gitignored). Backed up out-of-band with the SQLite file.
- Filenames: `{product_id}-{slug}-{variant}.{webp|avif}` where variant is `original` or `thumb`.
- Next.js `<Image>` with `loader` configured to serve from `/uploads/products/...`.
- Originals deleted after derivatives are generated; if regeneration is ever needed, repeat from the source backup tarball.

### Real-time channels (eventBus / SSE)

Channel names are stable strings used by both publishers and subscribers:

| Channel | Publisher | Subscriber |
|---------|-----------|------------|
| `order:{id}:status` | paymentPoller, fulfillment service | Mini App order page, admin dashboard |
| `order:{id}:messages` | order chat service | Mini App chat panel, admin chat panel, bot DM bridge |
| `admin:new-order` | order service | admin dashboard |
| `admin:low-stock` | stock service | admin dashboard |
| `user:{tg_id}:wallet` | wallet service | Mini App wallet page |

SSE responses must set `Cache-Control: no-transform` and `X-Accel-Buffering: no` to keep Cloudflare from buffering.

### Telegram registration

- New bot via BotFather `/newbot`. Token goes into `BOT_TOKEN` env.
- Mini App registered via `/newapp`, pointed at `https://<domain>/miniapp` (the public entrypoint that loads the `(miniapp)` group's home page).
- Bot menu button set to "Mở cửa hàng" launching the Mini App.
- Optional: branded launch image, short description, what-this-app-does — defer to sub-project #1 or #8.

## Risks and open questions

- **WP variable products (variants):** WooCommerce supports variations with different prices and SKUs. The migration spec must check whether the dump contains any and either collapse them to a single product or extend the schema. Tentative: collapse to parent product in MVP, log skipped variations.
- **License key product mapping:** lmfwc keys reference WP `post_id` of products. The migration must build a mapping table from WP `post_id` → new `products.id` and apply it before inserting keys.
- **Encryption key rotation:** v1 has a single static key. If rotation is ever needed, plan an envelope-encryption refactor. Out of scope for v1.
- **Cloudflare CF Tunnel vs direct origin:** simplest deploy is CF Tunnel (no public origin IP, no firewall rules to maintain). If CF Tunnel is unacceptable, manual firewall rules required.
- **Bot DM bridge for support:** when a customer DMs the bot without an active order, where does the message go? Tentative: a generic "support inbox" in the admin dashboard. Detail pinned to sub-project #6.

## Approval

This umbrella spec is approved as the basis for sub-project specs. Each sub-project will be brainstormed and approved on its own before implementation.
