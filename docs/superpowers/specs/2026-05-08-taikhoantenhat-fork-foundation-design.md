# Sub-project #1 — Fork Foundation (Design Spec)

**Date:** 2026-05-08
**Status:** Draft — pending user review
**Parent:** `2026-05-08-taikhoantenhat-platform-design.md`

## Purpose

Produce an empty-but-runnable `taikhoantenhat-bot` repository, forked from `starizzi-shop-bot`, with all branding stripped, fresh database, fresh Telegram bot, and fresh environment. After this sub-project lands, the codebase boots, the bot answers `/start`, the Mini App route group renders an empty placeholder page, and the admin dashboard renders an empty placeholder page. No products, no orders, no real flows yet — those come in subsequent sub-projects.

This sub-project is the dependency root for everything else.

## Scope

### In scope

- Create a new repo `taikhoantenhat-bot`, sibling of `starizzi-shop-bot` (or in a chosen location). Initialize from a clean copy, NOT a shared remote.
- Strip Starizzi/Auto-chan branding from code, copy, and assets.
- Provide a fresh empty SQLite database wired to existing migrations 001 through 014 (they create the schema; data import comes in sub-project #2).
- Register a new Telegram bot via BotFather; record token in `.env.example` placeholder and the user's local `.env`.
- Update environment scaffolding so a new developer can clone, copy `.env.example`, fill in the bot token, run `npm install`, and start the dev server.
- Update dev scripts (`scripts/dev-all.sh`, root `dev.sh`) for the new project name.
- Replace project-name references in `package.json`, `README.md`, `README_EN.md`, and any other top-level docs.
- Create empty placeholder pages for `app/(miniapp)/page.tsx` and `app/(admin)/page.tsx` so the route groups exist.
- Confirm the `mbbank-api/` Python sidecar still works against the new repo (no code changes; verify path references).
- Set up a fresh git history. Either start from a single squashed commit ("Initial fork from starizzi-shop-bot") or preserve history with a clear marker.

### Out of scope (handled in later sub-projects)

- WordPress data migration (sub-project #2).
- Real Mini App pages (sub-project #3).
- Geo-block middleware (sub-project #4).
- Schema additions for custom-info orders or order_messages (sub-projects #5 and #6).
- Bot handler removal (sub-project #7) — for now, existing handlers stay but point at empty state; smoke tests just need `/start` to not crash.
- Public web route deletion (sub-project #8).

## What "stripped branding" means

| Where | What changes |
|-------|--------------|
| `package.json` `name` | `starizzi-shop-bot` → `taikhoantenhat-bot` |
| `web/package.json` `name` | `starizzi-web` (or current) → `taikhoantenhat-web` |
| `README.md`, `README_EN.md` | Project name, intro, screenshots replaced with placeholders or removed |
| Bot greeting templates (`messageTemplateService` content) | Auto-chan greeting → "Chào mừng đến Taikhoantenhat" placeholder |
| `web/src/app/layout.tsx` `<title>`, metadata | Brand string updated |
| `web/public/` favicon, logo, OG image | Replaced with Taikhoantenhat placeholders or removed |
| `web/DESIGN.md` | Drop Auto-chan / Starizzi-specific copy; keep Clay design tokens (they're useful) |
| `notificationService` strings, admin label strings | Brand-name occurrences replaced |
| Sakura color palette (Auto-chan rebrand) | Decision needed: keep palette but rename tokens, or replace with neutral palette. Default: keep palette, rename tokens to brand-neutral (`primary`, `accent`) |

A grep sweep for `starizzi`, `Starizzi`, `Auto-chan`, `auto-chan`, `autochan`, `sakura`, plus any other brand-coupled identifiers, confirms completeness.

## Database

- Start with an empty `data/db.sqlite` (gitignored).
- The runner at `src/database/migrations/runner.js` applies migrations 001 through 014 on startup.
- No data seeded yet. Sub-project #2 produces seed via the migration script.
- Backup the empty post-migration DB to `data/db.sqlite.fresh` for fast reset during development.

## Telegram bot

- New bot from BotFather, name `Taikhoantenhat Shop Bot` (or user's preference).
- New Mini App registration via `/newapp`, URL placeholder `https://taikhoantenhat.example.com/` (real domain decided at deploy time; placeholder until then). Route group `(miniapp)/page.tsx` owns the root path.
- Token goes into local `.env`, never committed. `.env.example` lists the variable with a stub value.
- The bot starts but only `/start` works — it sends a brand-neutral Vietnamese greeting and a button that opens the Mini App URL. All other handlers are left in place from starizzi for now (they'll be culled in sub-project #7), but they should not crash if invoked against the empty DB.

## Environment scaffolding

`.env.example` keys, brand-stripped and grouped:

```
# Telegram
BOT_TOKEN=
MINIAPP_URL=https://taikhoantenhat.example.com/

# Database
DATABASE_PATH=./data/db.sqlite

# Auth
JWT_SECRET=
ENCRYPTION_KEY=  # 32-byte hex, generate with: openssl rand -hex 32

# MBBank sidecar
MBBANK_API_URL=http://localhost:8001
MBBANK_USERNAME=
MBBANK_PASSWORD=

# Server
PORT=3000
NODE_ENV=development
```

`ENCRYPTION_KEY` is added now so subsequent sub-projects can rely on it being present.

## Dev scripts

- `dev.sh` (root) → starts Node + Python sidecar + Next.js, name updated to "Taikhoantenhat dev".
- `scripts/dev-all.sh` → same, used by tmux/concurrently flow if applicable.
- `package.json` scripts: `dev`, `start`, `migrate`, `test` work unchanged.

## Smoke test (definition of done)

After this sub-project lands, the following checks pass on a clean clone:

1. `cp .env.example .env` and fill in `BOT_TOKEN`, `JWT_SECRET`, `ENCRYPTION_KEY`.
2. `npm install` (root) and `npm install` (web).
3. `npm run migrate` creates a fresh DB with 14 migrations applied.
4. `./dev.sh` starts the Node process, Next.js, and mbbank-api sidecar without errors.
5. Visiting `http://localhost:3000/` renders the empty Mini App placeholder with a Vietnamese greeting (route group `(miniapp)` owns the root).
6. Visiting `http://localhost:3000/admin` renders an empty admin placeholder (login redirect is fine).
7. Sending `/start` to the bot returns a Vietnamese greeting + "Mở cửa hàng" button pointing at `MINIAPP_URL`.
8. `grep -ri "starizzi\|auto-chan\|autochan" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git` returns zero matches.

## Risks and notes

- **History preservation vs squash:** squash is cleaner for a brand reset, but loses commit messages that may be useful when borrowing fixes from starizzi later. Recommend squash + keep starizzi as a separate read-only reference repo.
- **Sakura palette decision:** if the Taikhoantenhat brand has a defined color, replace tokens. If undecided, default to keeping the palette and renaming tokens to brand-neutral names; finalize during the Mini App MVP sub-project.
- **mbbank-api state:** the Python sidecar contains pickled session state. After fork, ensure the working dir is fresh (no leaked starizzi sessions). Add a setup note to README.
- **Existing untracked changes:** the current starizzi branch has many untracked files (wallet routes, events SSE, migrations 007–011, services). Before forking, decide whether the fork starts from `main` or from `feat/platform-overhaul`. Recommend forking from `feat/platform-overhaul` after a clean commit, since those features are baseline expectations for the new platform.
- **Mini App route group placeholder:** Next.js route groups don't affect URLs. Decide on the public entry path: `/` could redirect to `/miniapp`, or `(miniapp)/page.tsx` could own `/`. Recommend `(miniapp)/page.tsx` owns `/` and `(admin)/page.tsx` owns `/admin/*`. Public-web pages are deleted in sub-project #8 — until then, they coexist (and are unreachable in production thanks to the geo-block sub-project).

## Approval gate

This spec is the foundation for the implementation plan in sub-project #1. Approval here unblocks `superpowers:writing-plans` for the same sub-project.
