# Mini App Responsive + Icon System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Mini App work fluidly across mobile + tablet + desktop (2-column on phones, scaling to 7-column on ultra-wide), replace every UI emoji with a `lucide-react` icon, and apply the Clay design tokens from `web/DESIGN.md` consistently — keeping the existing gold/ink brand layer.

**Architecture:** No new dependencies (`lucide-react@1.11.0` already in `web/package.json`). One central icon module (`miniappIcons.ts`) maps semantic names → Lucide components so swap/refactor is single-file. Responsive grid is pure CSS (`.miniapp-product-grid` + media queries in `globals.css`). Desktop layout reuses `MiniAppShell` — same component, breakpoint-driven changes: bottom nav hides ≥ `md`, sticky top nav grows actions, content gets a centered `max-width` container. No JS layout switches — CSS-only so SSR/HMR stays clean.

**Tech Stack:** Next 16 App Router + Turbopack, Tailwind v4 (`@theme inline`), `lucide-react`, existing TanStack Query, existing Clay tokens.

---

## File Structure

- `web/src/app/(miniapp)/components/Icon.tsx` — **CREATE**. Thin wrapper enforcing default size (`20`) + `strokeWidth` (`1.75`) + currentColor. Re-exports a typed `Icon` component + named `icons` map.
- `web/src/lib/miniappIcons.ts` — **CREATE**. Semantic-name → Lucide component map. Single edit point.
- `web/src/app/globals.css` — **MODIFY**. Responsive grid + container + desktop nav rules in the existing `@layer components` block.
- `web/src/app/(miniapp)/components/MiniAppShell.tsx` — **REPLACE**. Container max-width, desktop top-nav variant, bottom-nav hidden ≥ `md`, icon-based nav items.
- `web/src/app/(miniapp)/components/ProductCard.tsx` — **MODIFY**. `Package` icon fallback, Clay hover treatment.
- `web/src/app/(miniapp)/page.tsx` — **MODIFY**. Icons replace emojis (categories, announcements, featured, hero CTA).
- `web/src/app/(miniapp)/danh-muc/[slug]/page.tsx` — **MODIFY**. `Search` icon, empty-state icon.
- `web/src/app/(miniapp)/san-pham/[slug]/page.tsx` — **MODIFY**. `ShoppingCart` + `Zap` icons on CTAs, `Package` fallback, desktop two-column hero layout.
- `web/src/app/(miniapp)/gio-hang/page.tsx` — **MODIFY**. `ShoppingCart` empty-state, `Package` item fallback, `Minus/Plus/Trash2` controls.
- `web/src/app/(miniapp)/don-hang/page.tsx` — **MODIFY**. `Inbox` empty-state.
- `web/src/app/(miniapp)/don-hang/[id]/page.tsx` — **MODIFY**. `Clock`/`CheckCircle2`/`XCircle` status badges.
- `web/src/app/(miniapp)/components/StatusBadge.tsx` — **CREATE**. Pulls icon from `miniappIcons` for each status.

---

## Notes for the Engineer

- **Read `web/AGENTS.md` first.** Next 16 has breaking changes from training-data Next.js. If anything in this plan looks wrong against the actual `node_modules/next/dist/docs/`, trust the docs.
- **Tailwind v4 (`@theme inline`)** is in `globals.css`. Custom CSS goes in `@layer components { ... }`. Don't reach for `tailwind.config.js` — it doesn't exist.
- **Brand layer overrides Clay swatches** for accents (`--brand-gold`, `--brand-ink`). Keep the brand layer; Clay tokens are for surfaces/borders/shadows.
- **No emoji in JSX after this plan.** Only place emojis still live: `productSummary.emoji` (DB-backed product attribute) — but the **renderer** always falls back to `<Package />` if no `imageUrl`; we never paint the raw `emoji` glyph. If you see a stray emoji during testing, treat it as a bug.
- **`lucide-react` 1.11.0** is old but importable as named exports: `import { Package, Search } from 'lucide-react'`. Bundle size is the only risk; tree-shaking handles it.
- **Hard requirement on `<Image fill>`:** parents need **inline** `style={{ position: 'relative' }}` (CSS-only races dev stylesheet load). Don't remove the existing inline styles.
- **Commit cadence:** one commit per task. Use `feat(miniapp):` or `refactor(miniapp):` prefix to match recent history (`git log --oneline -10`).

---

## Task 1: Icon module (single source of truth)

**Files:**
- Create: `web/src/lib/miniappIcons.ts`
- Create: `web/src/app/(miniapp)/components/Icon.tsx`

- [ ] **Step 1: Create the icon map**

`web/src/lib/miniappIcons.ts`:

```ts
import {
  Home, ShoppingCart, ClipboardList, Search, Package, Megaphone, Sparkles,
  BookOpen, Film, Wrench, Zap, Plus, Minus, Trash2, Inbox, Clock, CheckCircle2,
  XCircle, AlertCircle, Copy, ArrowRight, ChevronRight, Menu, X, type LucideIcon,
} from 'lucide-react'

export const miniappIcons = {
  home: Home,
  cart: ShoppingCart,
  orders: ClipboardList,
  search: Search,
  package: Package,
  megaphone: Megaphone,
  sparkles: Sparkles,
  bookOpen: BookOpen,
  film: Film,
  wrench: Wrench,
  zap: Zap,
  plus: Plus,
  minus: Minus,
  trash: Trash2,
  inbox: Inbox,
  clock: Clock,
  check: CheckCircle2,
  cross: XCircle,
  alert: AlertCircle,
  copy: Copy,
  arrowRight: ArrowRight,
  chevronRight: ChevronRight,
  menu: Menu,
  close: X,
} satisfies Record<string, LucideIcon>

export type MiniappIconName = keyof typeof miniappIcons

// Slug → category icon. Add new categories here as the catalog grows.
export const categoryIcons: Record<string, MiniappIconName> = {
  'hoc-tap': 'bookOpen',
  'giai-tri': 'film',
  'tien-ich': 'wrench',
  'uncategorized': 'package',
}
```

- [ ] **Step 2: Create the wrapper component**

`web/src/app/(miniapp)/components/Icon.tsx`:

```tsx
import { miniappIcons, type MiniappIconName } from '@/lib/miniappIcons'

type Props = {
  name: MiniappIconName
  size?: number
  strokeWidth?: number
  className?: string
  'aria-hidden'?: boolean
}

export function Icon({ name, size = 20, strokeWidth = 1.75, className, ...rest }: Props) {
  const Cmp = miniappIcons[name]
  return <Cmp size={size} strokeWidth={strokeWidth} className={className} aria-hidden {...rest} />
}
```

- [ ] **Step 3: Verify build resolves the imports**

Run: `cd web && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no errors mentioning `miniappIcons` or `Icon`. (Unrelated pre-existing errors are fine; this step only checks our two new files.)

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/miniappIcons.ts web/src/app/\(miniapp\)/components/Icon.tsx
git commit -m "feat(miniapp): add Icon wrapper + lucide icon map"
```

---

## Task 2: Responsive grid + container CSS

**Files:**
- Modify: `web/src/app/globals.css` (existing `@layer components` block)

The current `.miniapp-product-grid` is fixed `grid-template-columns: repeat(2, 1fr)`. We replace it with a responsive ladder and add a centered content container so desktop doesn't sprawl. Bottom nav hides at `md` and a desktop top-nav rule scopes by viewport.

- [ ] **Step 1: Add responsive grid + container utilities**

Append inside the existing `@layer components { ... }` block in `web/src/app/globals.css` (just before the closing `}` of `@layer components`):

```css
  /* Centered content container: stays narrow on mobile, widens with breakpoints */
  .miniapp-container {
    width: 100%;
    margin-inline: auto;
    max-width: 100%;
  }
  @media (min-width: 768px) { .miniapp-container { max-width: 920px; } }
  @media (min-width: 1024px) { .miniapp-container { max-width: 1120px; } }
  @media (min-width: 1280px) { .miniapp-container { max-width: 1280px; } }
  @media (min-width: 1536px) { .miniapp-container { max-width: 1440px; } }

  /* Product grid: 2 → 3 → 4 → 5 → 6 → 7 columns. "4-7 on desktop" lives at ≥768px. */
  .miniapp-product-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: .75rem;
  }
  @media (min-width: 480px) { .miniapp-product-grid { grid-template-columns: repeat(3, 1fr); } }
  @media (min-width: 768px) { .miniapp-product-grid { grid-template-columns: repeat(4, 1fr); gap: 1rem; } }
  @media (min-width: 1024px) { .miniapp-product-grid { grid-template-columns: repeat(5, 1fr); } }
  @media (min-width: 1280px) { .miniapp-product-grid { grid-template-columns: repeat(6, 1fr); } }
  @media (min-width: 1536px) { .miniapp-product-grid { grid-template-columns: repeat(7, 1fr); } }

  /* Category grid scales the same way but caps at 6 — categories are coarse */
  .miniapp-cat-grid {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: .75rem;
  }
  @media (min-width: 640px) { .miniapp-cat-grid { grid-template-columns: repeat(3, 1fr); } }
  @media (min-width: 1024px) { .miniapp-cat-grid { grid-template-columns: repeat(4, 1fr); } }
  @media (min-width: 1280px) { .miniapp-cat-grid { grid-template-columns: repeat(6, 1fr); } }

  /* Desktop: hide bottom nav, show top-bar nav actions */
  @media (min-width: 768px) {
    .miniapp-bottomnav { display: none; }
    .miniapp-bottombar { position: sticky; bottom: 1rem; max-width: 920px; margin-inline: auto; border-radius: 16px; border: 1px solid color-mix(in srgb, var(--brand-ink) 8%, transparent); box-shadow: var(--shadow-clay); }
    .miniapp-topnav-actions { display: inline-flex; align-items: center; gap: .5rem; }
  }
  @media (max-width: 767.98px) {
    .miniapp-topnav-actions { display: none; }
  }

  /* Desktop hero: side-by-side text + visual */
  @media (min-width: 768px) {
    .miniapp-hero { padding: 2.5rem 2.5rem 2.75rem; border-radius: 28px; }
    .miniapp-hero h1 { font-size: 2.25rem; line-height: 1.1; }
    .miniapp-hero p { font-size: 1rem; max-width: 38ch; }
  }

  /* Clay hover on product card — desktop only, mobile keeps tap feedback */
  @media (hover: hover) and (min-width: 768px) {
    .miniapp-product-card {
      transition: transform .25s cubic-bezier(.34,1.56,.64,1), box-shadow .25s ease;
    }
    .miniapp-product-card:hover {
      transform: rotateZ(-1.5deg) translateY(-4px);
      box-shadow: var(--shadow-clay-hover);
    }
  }

  /* Icon-bearing nav link — replaces emoji span inside .miniapp-bottomnav */
  .miniapp-bottomnav a > svg { width: 22px; height: 22px; }

  /* Top-nav (desktop) link styling */
  .miniapp-topnav-link {
    display: inline-flex; align-items: center; gap: .375rem;
    padding: .5rem .875rem;
    border-radius: 10px;
    font-size: .9375rem; font-weight: 500;
    color: color-mix(in srgb, var(--brand-ink) 75%, transparent);
    transition: background .15s, color .15s;
  }
  .miniapp-topnav-link:hover { background: color-mix(in srgb, var(--brand-ink) 6%, transparent); color: var(--brand-ink); }
  .miniapp-topnav-link[aria-current="page"] { color: var(--brand-gold-deep); background: var(--brand-gold-soft); }
```

- [ ] **Step 2: Verify the dev server picks up the CSS**

Dev stack is already running (`npm run dev:all` in background — check `lsof -i :3001 -P -n | grep LISTEN`). Reload http://localhost:3001/ in a browser and resize: at <480px expect 2-column grid; at ≥1280px expect 6-column. Bottom nav vanishes at ≥768px.

If the dev server isn't running, start it: `cd /Users/peanut/Users/peanut/Project\ Local/taikhoantenhat-bot && npm run dev:all` (uses `scripts/dev-all.sh`).

- [ ] **Step 3: Commit**

```bash
git add web/src/app/globals.css
git commit -m "feat(miniapp): responsive product grid 2→7 cols + desktop container"
```

---

## Task 3: Rewrite MiniAppShell with icons + desktop top-nav

**Files:**
- Replace: `web/src/app/(miniapp)/components/MiniAppShell.tsx`

The shell currently emits 🏠/🛒/📋 emojis in both the bottom nav and the header's cart link. Bottom nav stays for mobile (hidden ≥ `md` via CSS from Task 2); the header gains a desktop-only top-nav action row.

- [ ] **Step 1: Replace the file**

`web/src/app/(miniapp)/components/MiniAppShell.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Icon } from './Icon'
import type { MiniappIconName } from '@/lib/miniappIcons'
import { t } from '@/i18n/vi'

type NavItem = { href: string; label: string; icon: MiniappIconName; match: (p: string) => boolean }

const NAV: NavItem[] = [
  { href: '/',         label: t.nav.home,   icon: 'home',   match: (p) => p === '/' },
  { href: '/gio-hang', label: t.nav.cart,   icon: 'cart',   match: (p) => p.startsWith('/gio-hang') },
  { href: '/don-hang', label: t.nav.orders, icon: 'orders', match: (p) => p.startsWith('/don-hang') },
]

export function MiniAppShell({
  children,
  title,
  subtitle,
  showHeader = true,
  hasBottombar = false,
}: {
  children: ReactNode
  title?: string
  subtitle?: string
  showHeader?: boolean
  hasBottombar?: boolean
}) {
  const pathname = usePathname()
  return (
    <div className="miniapp-root">
      {showHeader && (
        <header className="miniapp-header">
          <div className="miniapp-container px-4 py-3 flex items-center justify-between">
            <Link href="/" className="miniapp-brand">
              <span className="miniapp-brand-mark">T</span>
              <span>{title ?? t.appName}</span>
            </Link>

            <nav className="miniapp-topnav-actions">
              {NAV.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  className="miniapp-topnav-link"
                  aria-current={it.match(pathname) ? 'page' : undefined}
                >
                  <Icon name={it.icon} size={18} />
                  {it.label}
                </Link>
              ))}
            </nav>

            <Link
              href="/gio-hang"
              aria-label={t.nav.cart}
              className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-full"
              style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-ink)' }}
            >
              <Icon name="cart" size={18} />
            </Link>
          </div>
          {subtitle && (
            <div className="miniapp-container px-4">
              <p className="text-xs opacity-60 mt-0.5 ml-10">{subtitle}</p>
            </div>
          )}
        </header>
      )}

      <main className={`miniapp-container px-4 pt-3 ${hasBottombar ? 'pb-32' : 'pb-24'} md:pb-12`}>
        {children}
      </main>

      <nav className="miniapp-bottomnav">
        {NAV.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            aria-current={it.match(pathname) ? 'page' : undefined}
          >
            <Icon name={it.icon} size={22} />
            {it.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
```

- [ ] **Step 2: Visual check**

Reload http://localhost:3001/. Mobile width: bottom nav with three Lucide icons, header shows brand + a circular cart pill on the right. Desktop ≥768px: bottom nav gone, three top-nav links visible with icon + label, active route highlighted gold.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/\(miniapp\)/components/MiniAppShell.tsx
git commit -m "feat(miniapp): icon-based shell with desktop top-nav"
```

---

## Task 4: ProductCard — icon fallback + Clay surface

**Files:**
- Modify: `web/src/app/(miniapp)/components/ProductCard.tsx`

- [ ] **Step 1: Rewrite**

`web/src/app/(miniapp)/components/ProductCard.tsx`:

```tsx
'use client'

import Link from 'next/link'
import Image from 'next/image'
import { Icon } from './Icon'
import { formatPrice } from '@/lib/utils'

export interface ProductSummary {
  id: string
  slug: string
  name: string
  emoji: string
  imageUrl?: string
  price: number
  stock: number
  promotion?: string | null
}

export function ProductCard({ p }: { p: ProductSummary }) {
  const inStock = p.stock > 0
  return (
    <Link href={`/san-pham/${p.slug}`} className="miniapp-product-card">
      <div className="miniapp-product-img" style={{ position: 'relative' }}>
        {p.promotion && <span className="miniapp-product-badge">{p.promotion}</span>}
        {p.imageUrl ? (
          <Image
            src={p.imageUrl}
            alt={p.name}
            fill
            sizes="(min-width: 1536px) 14vw, (min-width: 1280px) 17vw, (min-width: 1024px) 20vw, (min-width: 768px) 25vw, (min-width: 480px) 33vw, 50vw"
            style={{ objectFit: 'cover' }}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center" style={{ color: 'var(--brand-gold-deep)' }}>
            <Icon name="package" size={44} strokeWidth={1.25} />
          </div>
        )}
      </div>
      <div className="miniapp-product-info">
        <p className="miniapp-product-name">{p.name}</p>
        <p className="miniapp-product-price">{formatPrice(p.price)}</p>
        <p className={`miniapp-product-stock ${inStock ? 'in' : 'out'}`}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor', display: 'inline-block' }} />
          {inStock ? `Còn ${p.stock}` : 'Hết hàng'}
        </p>
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: Visual check**

Reload home page. Cards without `imageUrl` show a gold Package icon (not 📦). `sizes` attribute is correct per breakpoint — open devtools network tab and verify the `srcset` image picked at each viewport (50vw mobile → ~14vw at 1536px).

- [ ] **Step 3: Commit**

```bash
git add web/src/app/\(miniapp\)/components/ProductCard.tsx
git commit -m "feat(miniapp): ProductCard icon fallback + responsive sizes"
```

---

## Task 5: Home page — icons replace emojis

**Files:**
- Modify: `web/src/app/(miniapp)/page.tsx`

- [ ] **Step 1: Rewrite**

`web/src/app/(miniapp)/page.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from './components/MiniAppShell'
import { ProductCard, ProductSummary } from './components/ProductCard'
import { Icon } from './components/Icon'
import { categoryIcons } from '@/lib/miniappIcons'
import { t } from '@/i18n/vi'

interface Announcement { id: string; title: string; body: string; pinned: boolean }
interface Category { id: number; name: string; slug: string; emoji: string }

export default function MiniAppHome() {
  const ann = useQuery({
    queryKey: ['announcements'],
    queryFn: () => apiFetch<Announcement[]>('/announcements'),
  })
  const cats = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<Category[]>('/categories'),
  })
  const featured = useQuery({
    queryKey: ['products', 'featured'],
    queryFn: () => apiFetch<ProductSummary[]>('/products?sort=newest'),
    select: (rows) => rows.slice(0, 14), // covers up to 7-col grid × 2 rows on ultrawide
  })

  return (
    <MiniAppShell>
      <section className="miniapp-hero">
        <p className="text-xs uppercase tracking-wider opacity-70 mb-2">Taikhoantenhat</p>
        <h1>Tài khoản số chính chủ</h1>
        <p>Mua trong Telegram. Giao key tự động. Bảo hành dài hạn.</p>
        <Link href="/danh-muc/hoc-tap" className="miniapp-hero-cta">
          Khám phá ngay
          <Icon name="arrowRight" size={16} />
        </Link>
      </section>

      {ann.data && ann.data.length > 0 && (
        <section className="miniapp-section">
          <div className="miniapp-section-title">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="megaphone" size={16} />
              {t.home.announcementsTitle}
            </span>
          </div>
          <ul className="space-y-2">
            {ann.data.slice(0, 3).map((a) => (
              <li key={a.id} className="miniapp-ann">
                <p className="miniapp-ann-title">{a.title}</p>
                <p className="miniapp-ann-body">{a.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="miniapp-section">
        <div className="miniapp-section-title">
          <span>{t.home.categoriesTitle}</span>
        </div>
        {cats.isLoading && <p className="opacity-60 text-sm">Đang tải…</p>}
        {cats.data && cats.data.length === 0 && (
          <p className="opacity-60 text-sm">{t.home.emptyCategories}</p>
        )}
        {cats.data && cats.data.length > 0 && (
          <ul className="miniapp-cat-grid">
            {cats.data.map((c) => (
              <li key={c.id}>
                <Link href={`/danh-muc/${c.slug}`} className="miniapp-cat-tile">
                  <span className="miniapp-cat-emoji">
                    <Icon name={categoryIcons[c.slug] ?? 'package'} size={22} strokeWidth={1.75} />
                  </span>
                  <p className="miniapp-cat-name">{c.name}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {featured.data && featured.data.length > 0 && (
        <section className="miniapp-section">
          <div className="miniapp-section-title">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="sparkles" size={16} />
              Sản phẩm nổi bật
            </span>
            <Link href="/danh-muc/hoc-tap" className="inline-flex items-center gap-1">
              Tất cả <Icon name="arrowRight" size={14} />
            </Link>
          </div>
          <ul className="miniapp-product-grid">
            {featured.data.map((p) => (
              <li key={p.id}><ProductCard p={p} /></li>
            ))}
          </ul>
        </section>
      )}
    </MiniAppShell>
  )
}
```

Note: `.miniapp-cat-emoji` (CSS class name kept for backward compatibility) is a gold-tinted square — it now contains an `<Icon>` instead of an emoji glyph. The icon inherits color via `currentColor`; the container's `color` is set on the `.miniapp-cat-tile` via inheritance from `--brand-ink`, which gives the gold-on-cream look. If the icon looks too dark, add `color: var(--brand-gold-deep)` to `.miniapp-cat-emoji` in `globals.css`.

- [ ] **Step 2: Visual check**

Reload home page. Hero CTA has a chevron icon. "Thông báo" section heading has a Megaphone glyph. Category tiles show Lucide icons (BookOpen / Film / Wrench / Package). Featured section heading has a Sparkles glyph. On ultrawide (≥1536px) the grid pulls 7 cards per row.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/\(miniapp\)/page.tsx
git commit -m "feat(miniapp): icons on home — categories, announcements, featured"
```

---

## Task 6: Category page — Search icon + empty state

**Files:**
- Modify: `web/src/app/(miniapp)/danh-muc/[slug]/page.tsx`

- [ ] **Step 1: Apply edits**

Replace the two emoji occurrences (`🔍`) with icons. Specifically:

In the `.miniapp-search` block, replace:
```tsx
        <span className="opacity-60">🔍</span>
```
with:
```tsx
        <span className="opacity-60 flex"><Icon name="search" size={18} /></span>
```

In the empty-state block, replace:
```tsx
            <div className="text-4xl mb-2">🔍</div>
```
with:
```tsx
            <div className="mb-2 inline-flex p-3 rounded-full" style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-gold-deep)' }}>
              <Icon name="search" size={28} />
            </div>
```

Add the import at the top:
```tsx
import { Icon } from '../../components/Icon'
```

- [ ] **Step 2: Visual check**

Navigate to http://localhost:3001/danh-muc/hoc-tap. Search bar has a Lucide search icon. Type gibberish to trigger the empty state — pill with search icon appears.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/\(miniapp\)/danh-muc/\[slug\]/page.tsx
git commit -m "feat(miniapp): icons on category page"
```

---

## Task 7: Product detail — icons on CTA + fallback + responsive layout

**Files:**
- Modify: `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`

- [ ] **Step 1: Apply edits**

Add import:
```tsx
import { Icon } from '../../components/Icon'
```

Replace the emoji image fallback:
```tsx
            : <div className="absolute inset-0 grid place-items-center text-7xl">{p.emoji || '📦'}</div>}
```
with:
```tsx
            : <div className="absolute inset-0 grid place-items-center" style={{ color: 'var(--brand-gold-deep)' }}>
                <Icon name="package" size={88} strokeWidth={1.25} />
              </div>}
```

Replace the qty stepper buttons (lines with `−` and `+`) so the glyphs are Lucide icons:
```tsx
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="w-7 h-7 grid place-items-center rounded-full"
              style={{ background: 'var(--tg-bg)' }}
            >−</button>
```
becomes:
```tsx
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="w-7 h-7 grid place-items-center rounded-full"
              style={{ background: 'var(--tg-bg)' }}
              aria-label="Giảm số lượng"
            ><Icon name="minus" size={14} /></button>
```

Apply the same change to the `+` button (use `name="plus"` and `aria-label="Tăng số lượng"`).

Replace the bottombar buttons:
```tsx
          🛒 {t.product.addToCart}
```
becomes:
```tsx
          <Icon name="cart" size={18} /> {t.product.addToCart}
```

And:
```tsx
          ⚡ {t.product.buyNow}
```
becomes:
```tsx
          <Icon name="zap" size={18} /> {t.product.buyNow}
```

Wrap the existing detail content in a desktop two-column layout. Replace the outer `<MiniAppShell title={p.name} hasBottombar>` block's children with:

```tsx
      <div className="md:grid md:grid-cols-2 md:gap-8 md:items-start">
        <div className="rounded-2xl overflow-hidden mb-4 md:mb-0 md:sticky md:top-20" style={{ background: 'var(--brand-gold-soft)' }}>
          <div className="aspect-square" style={{ position: 'relative' }}>
            {/* existing image / promotion / fallback block — unchanged */}
          </div>
        </div>
        <div>
          {/* existing price + qty + description + details — unchanged */}
        </div>
      </div>
      {/* existing bottombar — unchanged */}
```

(Keep the existing JSX inside each wrapper exactly as it is; only the outer wrapping is new.)

- [ ] **Step 2: Visual check**

Navigate to http://localhost:3001/san-pham/tai-khoan-grammarly-premium-gia-re (or any product slug from `curl http://localhost:3000/api/v1/products?limit=1`). Mobile: image stacks above details. Desktop ≥768px: image on the left, sticky as you scroll details on the right. CTA buttons show ShoppingCart + Zap icons.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/\(miniapp\)/san-pham/\[slug\]/page.tsx
git commit -m "feat(miniapp): product detail icons + desktop two-col layout"
```

---

## Task 8: Cart page — icons everywhere

**Files:**
- Modify: `web/src/app/(miniapp)/gio-hang/page.tsx`

- [ ] **Step 1: Apply edits**

Add import:
```tsx
import { Icon } from '../components/Icon'
```

Replace the empty-state emoji block:
```tsx
          <div className="text-6xl mb-3">🛒</div>
```
with:
```tsx
          <div className="mb-3 inline-flex p-4 rounded-full" style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-gold-deep)' }}>
            <Icon name="cart" size={40} strokeWidth={1.25} />
          </div>
```

Replace the per-item fallback:
```tsx
                  : <div className="absolute inset-0 grid place-items-center text-2xl">{it.emoji || '📦'}</div>}
```
with:
```tsx
                  : <div className="absolute inset-0 grid place-items-center" style={{ color: 'var(--brand-gold-deep)' }}>
                      <Icon name="package" size={24} strokeWidth={1.5} />
                    </div>}
```

Replace the three control buttons (decrement `−`, increment `+`, remove `t.cart.remove`):

Decrement:
```tsx
                  >−</button>
```
becomes:
```tsx
                  ><Icon name="minus" size={14} /></button>
```

Increment:
```tsx
                  >+</button>
```
becomes:
```tsx
                  ><Icon name="plus" size={14} /></button>
```

Remove — keep the text label since `t.cart.remove` is a translation string, but prepend the trash icon:
```tsx
                  >{t.cart.remove}</button>
```
becomes:
```tsx
                  ><span className="inline-flex items-center gap-1"><Icon name="trash" size={12} />{t.cart.remove}</span></button>
```

- [ ] **Step 2: Visual check**

Add an item to the cart, then visit http://localhost:3001/gio-hang. Items show Package icon if no thumbnail, stepper uses Minus/Plus, remove has trash icon. Empty cart shows a gold-tinted ShoppingCart pill.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/\(miniapp\)/gio-hang/page.tsx
git commit -m "feat(miniapp): icon-based cart page"
```

---

## Task 9: Orders list — Inbox empty state

**Files:**
- Modify: `web/src/app/(miniapp)/don-hang/page.tsx`

- [ ] **Step 1: Apply edits**

Add import:
```tsx
import { Icon } from '../components/Icon'
```

Replace:
```tsx
          <div className="text-6xl mb-3">📋</div>
```
with:
```tsx
          <div className="mb-3 inline-flex p-4 rounded-full" style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-gold-deep)' }}>
            <Icon name="inbox" size={40} strokeWidth={1.25} />
          </div>
```

- [ ] **Step 2: Visual check**

Visit http://localhost:3001/don-hang as a user with no orders → Inbox icon pill renders. If you have orders, the list itself doesn't change.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/\(miniapp\)/don-hang/page.tsx
git commit -m "feat(miniapp): inbox icon empty state on orders list"
```

---

## Task 10: StatusBadge component + order detail icons

**Files:**
- Create: `web/src/app/(miniapp)/components/StatusBadge.tsx`
- Modify: `web/src/app/(miniapp)/don-hang/[id]/page.tsx`

- [ ] **Step 1: Create StatusBadge**

`web/src/app/(miniapp)/components/StatusBadge.tsx`:

```tsx
import { Icon } from './Icon'
import type { MiniappIconName } from '@/lib/miniappIcons'

type Status = 'pending' | 'paid' | 'delivered' | 'cancelled' | 'expired'

const statusIcon: Record<Status, MiniappIconName> = {
  pending:   'clock',
  paid:      'check',
  delivered: 'check',
  cancelled: 'cross',
  expired:   'alert',
}

const statusLabel: Record<Status, string> = {
  pending:   'Chờ thanh toán',
  paid:      'Đã thanh toán',
  delivered: 'Đã giao',
  cancelled: 'Đã huỷ',
  expired:   'Đã hết hạn',
}

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`miniapp-status miniapp-status--${status}`}>
      <Icon name={statusIcon[status]} size={14} />
      {statusLabel[status]}
    </span>
  )
}
```

- [ ] **Step 2: Replace ⏳ in the order detail page**

Open `web/src/app/(miniapp)/don-hang/[id]/page.tsx`. Add import:
```tsx
import { Icon } from '../../components/Icon'
import { StatusBadge } from '../../components/StatusBadge'
```

Replace:
```tsx
          <div className="text-3xl mb-1">⏳</div>
```
with:
```tsx
          <div className="mb-2 inline-flex p-2.5 rounded-full" style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-gold-deep)' }}>
            <Icon name="clock" size={22} strokeWidth={1.5} />
          </div>
```

If the page currently renders a status string directly (e.g. `<span className="miniapp-status miniapp-status--pending">…</span>`), replace that span with `<StatusBadge status={order.status} />`. (Grep the file: `grep -n 'miniapp-status' web/src/app/\(miniapp\)/don-hang/\[id\]/page.tsx`. Apply only to occurrences that match the Status type — leave any non-typed strings as text-only.)

- [ ] **Step 3: Visual check**

Place a test order via http://localhost:3001/, navigate to its detail page. Status badge has an icon. Pending QR page shows a Clock icon. Once paid (or in dev, manually flip status in DB), badge swaps to CheckCircle.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/\(miniapp\)/components/StatusBadge.tsx web/src/app/\(miniapp\)/don-hang/\[id\]/page.tsx
git commit -m "feat(miniapp): StatusBadge component + icons on order detail"
```

---

## Task 11: Verify responsive behavior end-to-end

**Files:** none (verification only)

- [ ] **Step 1: Smoke each page across breakpoints**

Open Chrome devtools → device toolbar. Test at widths: **375px, 480px, 768px, 1024px, 1280px, 1536px**. For each width, walk these URLs:
- `/` — grid columns: 2 / 3 / 4 / 5 / 6 / 7
- `/danh-muc/hoc-tap` — same grid, sort chips stay horizontally scrollable on mobile, inline on desktop
- `/san-pham/<slug>` — mobile stacked, desktop two-column
- `/gio-hang` — list stays single column (intentional)
- `/don-hang` — list single column
- `/don-hang/<id>` — single column

Expected: no horizontal scroll at any width, bottom nav hides ≥768px, top-nav appears ≥768px, no emoji anywhere except in long-form Vietnamese copy (announcements / descriptions — those are content, not UI).

- [ ] **Step 2: Run the type check**

```bash
cd web && npx tsc --noEmit
```
Expected: clean (or only pre-existing unrelated errors — those are the engineer's call to defer).

- [ ] **Step 3: Run the dev build to catch import errors**

```bash
cd web && npm run build 2>&1 | tail -30
```
Expected: build completes. Common failure: case-mismatch on Lucide import — fix by re-checking `miniappIcons.ts`. If you change anything, rerun.

- [ ] **Step 4: Commit any verification fixes**

If steps 2 or 3 surfaced anything, fix and commit:
```bash
git add -p
git commit -m "fix(miniapp): build + type errors from responsive/icons refactor"
```

If everything passes clean, nothing to commit — proceed.

---

## Task 12: Final polish + tag

**Files:** none

- [ ] **Step 1: Search for stray emojis in components**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web/src/app/(miniapp)"
grep -rnE '[📦🛒📋🏠🔍⚡📣✨🎬📚🛠️⏳⚠️❌✅🎉]' . --include='*.tsx' --include='*.ts'
```
Expected: empty output. If anything shows up, swap it to an `<Icon>`.

- [ ] **Step 2: Tag**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git tag v0.4-miniapp-responsive -m "Mini App: responsive 2-7 col grid + icon system"
```

- [ ] **Step 3: Done**

Report back: page URLs verified, breakpoints confirmed, type-check + build green, tag created.

---

## Self-Review Checklist

- [x] Spec covers: responsive 4-7 cols on desktop → Task 2 grid (2→3→4→5→6→7).
- [x] Spec covers: Clay tokens from DESIGN.md → Task 2 adds Clay shadow on hover, oat borders; brand layer already in place.
- [x] Spec covers: icons replace emojis → Tasks 1, 3, 4, 5, 6, 7, 8, 9, 10 + verification grep in Task 12.
- [x] No placeholders — every JSX snippet is complete, every CSS block is final.
- [x] Type consistency — `MiniappIconName` defined Task 1, used in Tasks 3, 10.
- [x] CSS class naming — `.miniapp-cat-emoji` retained (legacy) but now hosts an icon; not renamed to avoid churn.
- [x] Build verification — Task 11 step 3 catches lucide import errors.
