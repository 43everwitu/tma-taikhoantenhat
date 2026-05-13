# Product Detail Centered Images + Related Rails

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Center inline images inside `Thông tin sản phẩm` rich content, and append two horizontal rail sliders to the bottom of `/san-pham/[slug]`: "Sản phẩm liên quan" (same category, exclude current) and "Sản phẩm đã xem" (localStorage history, exclude current).

**Architecture:** One-line CSS change (`.rich-text img { margin-inline: auto }`). Two new `useQuery` hooks in the product detail page reuse the existing `/products?category=…&limit=10` and `/products?ids=…` endpoints. Rendering goes through the existing `ProductRail` (HScroll under the hood).

**Tech Stack:** Next 16 App Router, React 19, @tanstack/react-query, Tailwind v4.

---

### Task 1: Center rich-text inline images

**Files:**
- Modify: `web/src/app/globals.css:199`

- [ ] **Step 1: Edit the `.rich-text img` rule**

Open `web/src/app/globals.css` around line 199. Locate:

```css
  .rich-text img { display: block; max-width: 100%; height: auto; border-radius: 12px; margin: .75rem 0; }
```

Replace with:

```css
  .rich-text img { display: block; max-width: 100%; height: auto; border-radius: 12px; margin: .75rem auto; }
```

The `auto` on the inline axis centers the image inside its `<p>` / `<figure>` / `<div>` wrapper.

- [ ] **Step 2: Visual smoke**

Hard-refresh `http://localhost:3001/san-pham/<slug-with-inline-images>` (any imported WP product with body images). Confirm every inline image sits centered horizontally, not left-aligned.

- [ ] **Step 3: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/globals.css
git commit -m "style(miniapp): center inline images inside rich-text content"
```

---

### Task 2: Related products rail at bottom of product detail

**Files:**
- Modify: `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`

- [ ] **Step 1: Import ProductRail**

At the top of `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`, alongside the other miniapp component imports, add:

```tsx
import { ProductRail } from '../../components/ProductRail'
import type { ProductSummary } from '../../components/ProductCard'
```

Inspect existing imports to avoid duplicate `import type` blocks; place `type ProductSummary` on the same import line as `ProductRail` if Next's lint flags duplicate imports.

- [ ] **Step 2: Extend `ProductDetail` interface to include `categorySlug`**

Locate the `ProductDetail` interface near the top of the file. Add `categorySlug?: string` to `ProductBase`:

```tsx
interface ProductBase {
  id: string; slug: string; name: string; emoji: string; imageUrl?: string
  price: number; stock: number; contactOnly: boolean; contactUrl?: string
  promotion?: string | null
  categorySlug?: string
}
```

(The public API already returns `categorySlug` — see `src/api/routes/public.js` `/products/:slug` response. The frontend type just hasn't declared it.)

- [ ] **Step 3: Add related-products query**

Inside the `ProductDetailPage` function, after the existing `useQuery` for `product`:

```tsx
  const related = useQuery({
    queryKey: ['products', 'related', p?.categorySlug, p?.id],
    queryFn: () => apiFetch<ProductSummary[]>(`/products?category=${encodeURIComponent(p!.categorySlug!)}&limit=12`),
    enabled: !!p?.categorySlug && !!p?.id,
    select: (rows) => rows.filter((r) => r.id !== p?.id).slice(0, 10),
  })
```

(Pull 12 to comfortably cover the case where the current product is in the first 10.)

- [ ] **Step 4: Render the rail above the `<MiniAppShell>` bottombar**

Find the closing tags. Just before `<div className="miniapp-bottombar">` (the sticky bottom CTA), add two sections wrapped in a top-margin spacer:

```tsx
      {related.data && related.data.length > 0 && (
        <section className="miniapp-section mt-6">
          <div className="miniapp-section-title">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="sparkles" size={16} />
              Sản phẩm liên quan
            </span>
          </div>
          <ProductRail items={related.data} />
        </section>
      )}
```

- [ ] **Step 5: Type-check**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit
```
Expected: `TypeScript: No errors found`.

- [ ] **Step 6: Visual smoke**

Open `/san-pham/<slug>` for a product whose category has > 1 sibling. Scroll to bottom. Confirm "Sản phẩm liên quan" rail renders with HScroll arrows on desktop. Current product is not shown.

- [ ] **Step 7: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(miniapp\)/san-pham/\[slug\]/page.tsx
git commit -m "feat(miniapp): related-products rail on product detail page"
```

---

### Task 3: Recently-viewed rail at bottom of product detail

**Files:**
- Modify: `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`

- [ ] **Step 1: Read recently-viewed IDs minus current**

Inside `ProductDetailPage`, after the `related` query, add:

```tsx
  const [recentIds, setRecentIds] = useState<string[]>([])
  useEffect(() => {
    if (!p?.id) return
    // Read AFTER pushRecentlyViewed has run, so we get the full list then exclude current.
    const ids = getRecentlyViewedIds().filter((id) => id !== String(p.id))
    setRecentIds(ids)
  }, [p?.id])
```

`getRecentlyViewedIds` is already imported at the top of the file (line 9). If not, add: `import { pushRecentlyViewed, getRecentlyViewedIds } from '@/lib/recentlyViewed'`.

- [ ] **Step 2: Add recently-viewed query**

After the `useState/useEffect` from Step 1:

```tsx
  const recently = useQuery({
    queryKey: ['products', 'recently-detail', recentIds.join(',')],
    queryFn: () => apiFetch<ProductSummary[]>(`/products?ids=${recentIds.join(',')}`),
    enabled: recentIds.length > 0,
  })
```

- [ ] **Step 3: Render rail below related**

Immediately after the related-rail `</section>` (closing tag from Task 2 Step 4), append:

```tsx
      {recently.data && recently.data.length > 0 && (
        <section className="miniapp-section mt-4">
          <div className="miniapp-section-title">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="clock" size={16} />
              Sản phẩm đã xem
            </span>
          </div>
          <ProductRail items={recently.data} />
        </section>
      )}
```

- [ ] **Step 4: Type-check**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit
```
Expected: `TypeScript: No errors found`.

- [ ] **Step 5: Visual smoke**

1. Open product A → product B → product C.
2. Open product D. Scroll to bottom: "Sản phẩm đã xem" rail shows A, B, C (not D).
3. Open a fresh incognito window, open just product X: rail is hidden (no history).

- [ ] **Step 6: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(miniapp\)/san-pham/\[slug\]/page.tsx
git commit -m "feat(miniapp): recently-viewed rail on product detail page"
```

---

### Task 4: Final QA + tag

- [ ] **Step 1: Build verify**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit && npm run build
```
Expected: clean.

- [ ] **Step 2: Tag + CLAUDE.md log**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git tag -a v0.23-detail-rails -m "Center rich-text images + related/recent rails on product detail"
```

Append row to the "Sub-projects shipped" table in `CLAUDE.md`:
```
| `v0.23-detail-rails` | center rich-text inline images + related/recent product rails at bottom of `/san-pham/[slug]` |
```

Commit:
```bash
git add CLAUDE.md
git commit -m "docs: log v0.23-detail-rails"
```
