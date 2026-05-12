# Admin Overhaul — Decomposition Design

**Date:** 2026-05-12
**Status:** Master decomposition. Each sub-project gets its own implementation plan after this spec is approved.
**Goal:** Bring `/admin/*` to production-ready quality (stock UX parity, RBAC, brand refresh, feature gating) + fix content-rendering bugs in mini app + upgrade the product edit flow with WYSIWYG and media library.

## Scope at a Glance

| # | Sub-project | Order | Risk | Size |
|---|---|---|---|---|
| F | Content render + WP image migration pass-2 | 1 | M (DB migration) | M |
| C | Brand refresh (favicon, name, copy) | 2 | L | S |
| A | /stock search + filter + quick actions | 3 | L | M |
| G | Admin product modal: TipTap + media library | 4 | M | L |
| D | Feature gating (hide wallet/topups, broadcast) | 5 | L | S |
| B | RBAC: roles + manager creation | 6 | H (auth) | L |
| E | CLAUDE.md architecture notes | 7 | L | S |

Each row will produce one plan in `docs/superpowers/plans/`, executed sub-project by sub-project. Branches feature-named per sub-project. F is first because it unblocks visible content bugs; B is last because it depends on D's hidden routes being already removed from the sidebar.

---

## F. Content Render + WP Image Migration Pass-2

### Problem
- Mini app product detail (`web/src/app/(miniapp)/san-pham/[slug]/page.tsx`) renders `{p.description}` and `{p.longDescription}` as plain text. WP-imported rows contain HTML (`<p>`, `<b>`, `<h3>`) plus `[caption ...]` shortcodes — viewer sees literal tags.
- Image `src` attributes inside the body still point at the old WP domain (`https://taikhoantenhat.com/wp-content/uploads/...`). Migration pass-1 only downloaded the featured image referenced via `_thumbnail_id` meta — body images were never extracted.

### Approach (chosen)
- **Migration pass-2** parses `description` + `long_description` HTML; for every `<img src>` matching the legacy WP host, download the original file, run it through the existing Sharp AVIF+WebP pipeline (800w + 400w thumb), store under `data/uploads/products-inline/<hash>.{avif,webp}`, and rewrite the `src` to the new local URL. Same dedup-by-content-hash strategy as `scripts/wp-migration/images.js`.
- **`[caption …]…[/caption]` shortcodes** are stripped; the inner `<img>` survives the rewrite step. WP `[gallery]` shortcodes converted to a flat sequence of `<img>` tags then rewritten.
- **Sanitization at API layer** (`src/services/productService.js`): use existing `sanitize-html` dep with an allow-list (`p, b, strong, i, em, h2, h3, h4, ul, ol, li, a[href], img[src|alt|width|height], code, pre, br, span[class]`). Strip everything else. Returns sanitized HTML to clients.
- **Rendering**: mini-app product detail switches from `{p.description}` to `<div dangerouslySetInnerHTML={{ __html: p.description }} className="rich-text">`. CSS `.rich-text` already exists in `globals.css`.

### Tasks
1. New `scripts/wp-migration/inline-images.js` — streaming HTML walker, image download, sharp transform, src rewrite. Idempotent (skip if hashed file exists).
2. New `scripts/wp-migration/strip-shortcodes.js` — small util converting `[caption]<img …>[/caption]` → `<img …>` and `[gallery ids=…]` → no-op (drop, since we don't have a flat ID→URL map for inline galleries). Tested.
3. Migration orchestrator (`migrate-wp.js`) gains an `--inline-images` flag invoking pass-2. Re-runnable.
4. `productService.js`: introduce `sanitizeDescription(html)` helper applied on every read of description/long_description in public routes.
5. `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`: switch text rendering to `dangerouslySetInnerHTML`. Keep existing `.rich-text` styles; extend as needed for `h3` and `caption`.
6. `web/src/app/globals.css`: add `.rich-text img { max-width: 100%; border-radius: 12px; margin: 0.75rem 0; }` + heading scale.
7. Manual verify with the Grammarly product slug (the one in the user screenshot).

### Risks
- HTML in DB may contain malformed tags from WP — `sanitize-html` should be tolerant, but worth logging warnings.
- Image hosts may rate-limit; pass-2 should respect concurrency cap (8 parallel, same as pass-1) and retry on 5xx.

---

## C. Brand Refresh

### Problem
Mixed naming ("Taikhoantenhat" / "taikhoantenhat.com" / hard-coded copy). Favicon currently Next default; user provided `favicon.png` (cat-with-sunglasses icon).

### Approach
- Copy `favicon.png` from repo root to `web/public/favicon.png` AND `web/src/app/icon.png` (Next 16 file-based metadata). Replace `web/src/app/favicon.ico` with derived `.ico`. Use `web/src/app/icon.svg` if Next 16 supports it; otherwise stick to `icon.png`.
- Centralize shop name into one constant: `web/src/i18n/vi.ts` `t.appName = 'Taikhoantenhat'`. Grep + replace any inline `'Taikhoantenhat'` literals.
- Metadata: `web/src/app/layout.tsx` `export const metadata` with `title`, `description`, `openGraph.images: ['/icon.png']`, `themeColor: '#ffc200'` (brand gold).
- Bot start-message copy: `src/bot/handlers.js` (or wherever `/start` lives) — confirm copy uses shop name var and matches mini-app voice.
- Audit `src/services/notificationService.js` order DM templates: replace any "Shop" / "Cửa hàng" with `t.appName`.

### Tasks
1. Place favicon assets, drop Next default.
2. Add `metadata` export.
3. Grep + replace shop-name literals across `web/src/` and `src/`.
4. Verify favicon shows in browser tab + Telegram inline preview (mini app).

---

## A. /stock Search + Filter + Quick Actions

### Problem
`/admin/stock` is read-only table, no search, no filter, no in-place actions. Productivity gap vs `/admin/products`.

### Approach (Q2a selections 1-5)
1. **Search box** filters product list by name (debounced, 200 ms). Match against `name` + `category`.
2. **Status chip row**: `Tất cả | Còn hàng | Hết hàng | Sắp hết (≤ low_stock_threshold)`. Filter applied client-side on the page's data.
3. **Drawer for keys**: clicking the `Đã bán/Tổng` cell opens a right-side drawer showing per-key list (data from `/admin/stock/:productId`). Re-uses the existing detail page logic but as a drawer for fast scanning; "Mở trang chi tiết" link inside.
4. **Quick add keys popup** at list level: button "+ Thêm key". Opens modal: product picker (autocomplete by name) + textarea (one key per line) → POST batch via `POST /admin/stock/:productId` per line (or new bulk endpoint).
5. **Bulk select rows + "Xoá key chưa bán"** action: ResponsiveTable already has selection in /products; replicate. Confirmation modal before delete.

Sort dropdown deferred (#6 in original list) since the search/filter combo covers most use cases.

### Tasks
1. Refactor `web/src/app/(admin)/admin/stock/page.tsx`: add state for `q`, `statusFilter`, `selectedIds`, drawer/modal open.
2. New component `StockKeysDrawer.tsx` reading `/admin/stock/:productId`.
3. New component `QuickAddKeysModal.tsx`.
4. Backend: add `POST /admin/stock/:productId/bulk` accepting `{ keys: string[] }`. Atomic transaction; returns per-key result so duplicates/errors are visible.
5. Backend: `DELETE /admin/stock/:productId/unsold` already exists per `src/api/routes/admin/stock.js:73`. Reuse for bulk-by-product. For multi-product bulk delete-unsold, call sequentially client-side.
6. Tests for the new bulk endpoint (`tests/api/admin-stock-bulk.test.js`).

---

## G. Admin Product Modal Upgrade

### Problem
Product edit modal currently has plain `<textarea>` for description/long_description. No image upload — admin must paste a URL. Modal layout is desktop-only center modal; cramped on phones.

### Approach (Q2b = B, Q3b = A, Q3c = C)
- **Layout**: side-drawer slide-from-right on desktop (≥ md), full-screen sheet on mobile. New shared `<EditDrawer>` reusable for orders/users later.
- **WYSIWYG**: TipTap (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-underline` already installed). Toolbar: `bold | italic | strike | h2 h3 | bullet ordered | link | image | code | clear`. Output: HTML matching sanitize-html allow-list from sub-project F. Avoid raw HTML edit mode.
- **Image upload (drag-drop + Media Library, both)**:
  - Drag-and-drop zone in editor + paste-from-clipboard: posts to new `POST /admin/upload` endpoint accepting `multipart/form-data` `file`; backend runs the same Sharp AVIF+WebP pipeline as the WP migration (800w + 400w), stores under `data/uploads/products-inline/`, returns `{ url, avifUrl, webpUrl, alt? }`. Inserts the `<img>` at cursor.
  - "Media Library" button (top-right of editor) opens a modal listing every file under `data/uploads/` grouped by folder (products, products-inline, etc). Click to insert. Has its own upload button. Re-usable from any TipTap editor instance.
- **Featured image field**: same upload component (mounted standalone, not inside editor), one image only.

### Tasks
1. New `POST /admin/upload` route + `multer` (or `formidable`) dep; or roll a minimal busboy handler. Sharp pipeline shared with migration code.
2. `web/src/components/admin/EditDrawer.tsx` — generic drawer wrapper.
3. `web/src/components/admin/RichTextEditor.tsx` — TipTap with toolbar + image-handler hook.
4. `web/src/components/admin/MediaLibrary.tsx` — modal with grid + search + upload.
5. Refactor `web/src/app/(admin)/admin/products/page.tsx` modal into `EditDrawer` + `RichTextEditor` for description fields. Featured image becomes a small picker tile.
6. Test: paste keyboard-shortcut image, drag-drop image, pick from library — all three must insert the same `<img>` shape consumed by the public renderer.

### Risks
- TipTap bundle size — currently installed but not used by miniapp. Ensure tree-shaken on admin route only (it already is since admin is a separate route group).
- `multer` adds a dep; or stay dep-free with Node 20 native `req.parts()` … keep it simple, accept `multer`.

---

## D. Feature Gating

### Problem
Sidebar shows features the shop doesn't use right now: wallet top-ups, Telegram broadcast notifications. They're not wrong, just noisy.

### Approach
- New env var block in `.env.example`:
  ```
  FEATURE_TOPUPS=false
  FEATURE_BROADCAST=false
  FEATURE_TELEGRAM_NOTIFY=order_only   # one of: order_only | full
  ```
- Backend exposes `GET /api/v1/admin/features` returning the resolved feature map. Admin shell fetches once on login and caches in React Query.
- `AdminSidebar.tsx` filters its nav array against the feature map.
- Routes themselves stay live (so re-enabling is one env flip), but the admin layout returns 404 client-side if a hidden route is visited via direct URL.
- Bot: `src/services/notificationService.js` already supports per-event toggle; gate broadcast-style notifications behind `FEATURE_TELEGRAM_NOTIFY=full`. Order DMs always fire.

### Tasks
1. Add env vars to `config.js` + `.env.example`.
2. `GET /api/v1/admin/features` route + service.
3. Sidebar filter + 404 client guard.
4. Notification service gating.

---

## B. RBAC: Roles + Manager Creation

### Problem
Only one admin role exists today (`role` column already has `super_admin` value but no app-side check uses it meaningfully). Need to grant trusted staff a limited "shop manager" view.

### Approach
- **Schema**: admins table already has `role TEXT NOT NULL DEFAULT 'admin'`. Define a fixed enum: `super_admin | manager`. Migration adds a CHECK constraint and a `permissions JSON` column (TEXT, JSON-encoded) for per-row overrides. Default permissions resolved from role.
- **Permission catalog** (string keys, used by both UI gates and route middleware):
  - `dashboard.read` (revenue, top products)
  - `products.read`, `products.write`
  - `orders.read`, `orders.write`
  - `stock.read`, `stock.write`
  - `users.read`, `users.write` (customer rows)
  - `admins.read`, `admins.write` (manage other admins — super_admin only)
  - `settings.read`, `settings.write`
  - `topups.read`, `topups.write` (gated by FEATURE_TOPUPS)
  - `messages.read`, `messages.write`
- **Default permission maps**:
  - `super_admin` → all
  - `manager` → `products.*`, `orders.*`, `stock.*`, `users.read`, `messages.read`, `announcements.*`. Excludes dashboard (revenue), settings, admins, topups.
- **Middleware**: `requirePermission('orders.write')` wraps relevant routes. Existing `requireAdmin` keeps a baseline check. New middleware looks up admin row, resolves `permissions || rolePermissions[role]`, returns 403 if missing.
- **Admin management UI**: new tab in `/admin/users` OR new sibling page `/admin/admins`. Lists admin rows, supports create (super_admin only), edit role + per-row permission overrides, deactivate. New admin gets username + temp password emailed/displayed once.
- **JWT payload** keeps `role`; permissions resolved server-side at each request (not stuffed into JWT — easier rotation).
- **Sidebar + page guards**: AdminShell fetches `GET /api/v1/admin/me` which returns `{ id, username, role, permissions: string[] }`. Sidebar filters by perm; page-level guard redirects 403 → dashboard with a toast.

### Tasks
1. Migration `00XX_admins_permissions.sql` adding constraint + column.
2. `src/services/permissionService.js` with role → perms resolver.
3. `requirePermission` middleware + wire into existing admin routes.
4. `GET /api/v1/admin/me` route.
5. `POST/PUT/PATCH/DELETE /api/v1/admin/admins/*` routes (super_admin only).
6. `web/src/app/(admin)/admin/admins/page.tsx` — new page.
7. AdminSidebar perm filter + page-level guards.
8. Tests for the middleware + admin-creation route.

### Risks
- Big-bang permission rollout — easy to lock out super_admin if migration wrong. Mitigate: migration runs in transaction, seeds the existing row's permissions to "all" before constraint takes effect.
- Browser JWT contains role only; UI must not trust it for permission checks (always defer to `/admin/me` response).

---

## E. CLAUDE.md Update

After A-D-F-G-B ship, append a section to root `CLAUDE.md`:

```markdown
## Admin

- Routes under `web/src/app/(admin)/admin/*`. Sidebar config: `web/src/components/AdminSidebar.tsx`.
- Auth flow: `POST /api/v1/auth/login` → JWT in localStorage → every admin route requires `Bearer` token. Reset password: `npm run admin:reset-password`.
- RBAC: `permissionService.js` resolves role → permission strings. Middleware `requirePermission` gates routes. `/admin/me` returns resolved perms for UI.
- Feature flags: `FEATURE_TOPUPS`, `FEATURE_BROADCAST`, `FEATURE_TELEGRAM_NOTIFY`. Hidden routes return 404 in admin layout if flag is off.
- Media upload: `POST /admin/upload` (multipart) → Sharp AVIF+WebP under `data/uploads/products-inline/`. Used by both featured image + TipTap inline images.
```

Also update the gotchas section with the dotenv `#` parsing trap (`.env` values containing `#` must be quoted).

---

## Self-Review

- **Placeholders:** none — each sub-project has concrete tasks, file paths, endpoints.
- **Internal consistency:** Sub-projects F + G share the same Sharp pipeline (good). Sub-projects D + B both touch sidebar — D ships first so B builds on a cleaner list (consistent).
- **Scope check:** Master spec is decomposition. Each sub-project will get its own implementation plan via `writing-plans` skill.
- **Ambiguity:** "Hide manager from revenue" resolved by permission catalog (`dashboard.read` excluded from manager defaults).

Next step after user approval of this spec: invoke `writing-plans` skill, starting with sub-project F (it unblocks visible content bugs in production).
