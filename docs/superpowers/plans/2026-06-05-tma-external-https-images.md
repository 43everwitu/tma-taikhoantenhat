# TMA External HTTPS Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make product and variant images from arbitrary HTTPS URLs render reliably in the Telegram Mini App without relying on Next/Image remote domain allow-lists.

**Architecture:** Add one Mini App image component that uses a plain `<img>` with `referrerPolicy="no-referrer"`, lazy loading, async decoding, URL validation, and fallback UI. Replace Mini App product-image usages of `next/image` with this component while leaving admin previews, QR panels, and rich HTML descriptions unchanged.

**Tech Stack:** Next 16 App Router, React 19, TypeScript, existing Mini App components and CSS.

---

### Task 1: Add Mini App Image Component

**Files:**
- Create: `web/src/app/(miniapp)/components/MiniAppProductImage.tsx`

- [ ] **Step 1: Write component**

Create a client component with props `{ src, alt, className?, imgClassName?, fallbackClassName?, iconSize?, priority?, loading?, sizes? }`.

Behavior:
- Accept URLs beginning with `https://` or `/`.
- Reject `http://` and malformed/empty values by showing fallback.
- Render plain `<img>` with `referrerPolicy="no-referrer"`, `decoding="async"`, and `loading={priority ? 'eager' : 'lazy'}`.
- Use existing `Icon` fallback with package icon.
- Reset error state when `src` changes.

- [ ] **Step 2: Verify syntax**

Run: `npm run build:web`

Expected: build reaches TypeScript without errors for the new component.

---

### Task 2: Replace Product Image Usage In TMA

**Files:**
- Modify: `web/src/app/(miniapp)/components/ProductCard.tsx`
- Modify: `web/src/app/(miniapp)/components/SearchBox.tsx`
- Modify: `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`
- Modify: `web/src/app/(miniapp)/gio-hang/page.tsx`

- [ ] **Step 1: Replace imports**

Remove `import Image from 'next/image'` from these files when it is only used for product images. Import `MiniAppProductImage` from the local components folder or relative path.

- [ ] **Step 2: Replace render calls**

Use `MiniAppProductImage` in:
- product cards with `priority={eager}`
- search result thumbnails
- product detail hero image with `priority`
- cart item thumbnails

Keep dimensions/layout controlled by existing parent containers.

- [ ] **Step 3: Preserve fallback**

Do not remove fallback package icon behavior. The new component owns fallback rendering so callers should be simpler.

---

### Task 3: Verify And Review

**Files:**
- Test/build only.

- [ ] **Step 1: Build web**

Run: `npm run build:web`

Expected: exit 0. If sandbox blocks Google Fonts, rerun with network approval.

- [ ] **Step 2: Search for remaining TMA product-image `next/image` usages**

Run: `grep -R "import Image from 'next/image'" -n 'web/src/app/(miniapp)'`

Expected: only non-product image usage may remain, such as QR panels if still using Next/Image. Product/card/search/detail/cart should use `MiniAppProductImage`.

- [ ] **Step 3: Manual behavior expectation**

For a product image URL like `https://tenhat.subhub.vn/wp-content/uploads/2025/04/Tong-quan-goi-Perplexity-Pro.jpg`, browser/TMA should request the original URL directly instead of `/_next/image?...`, so it no longer depends on `web/next.config.ts` `remotePatterns`.
