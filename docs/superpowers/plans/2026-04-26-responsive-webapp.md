# Responsive Webapp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Peanut Shop webapp (`web/`) work cleanly on mobile (360px), tablet (768px), and desktop (1024px+) — both the customer storefront and the admin dashboard.

**Architecture:** Mobile-first Tailwind breakpoints (`sm 640`, `md 768`, `lg 1024`, `xl 1280`). Admin sidebar collapses into a slide-over drawer on `<lg`. Tables in admin pages switch to card layout on `<md` so they don't horizontal-scroll. Customer header collapses long nav into a single hamburger that reveals the same items via the existing `UserMenu` styling. No new libs — vanilla Tailwind + native `<dialog>` / `useState` for the drawer.

**Tech Stack:**
- Next.js 16 (App Router, Turbopack)
- Tailwind v4 (clay design tokens already defined in `web/src/app/globals.css`)
- Lucide React icons (`web/src/lib/icons.tsx`)
- React 19, TanStack Query 5

---

## File Structure

**New files:**
- `web/src/components/AdminSidebar.tsx` — extracted sidebar with mobile drawer state
- `web/src/components/MobileNavToggle.tsx` — reusable hamburger button
- `web/src/components/ResponsiveTable.tsx` — wrapper that renders table on `md+` and card list on `<md`

**Modified files:**
- `web/src/app/globals.css` — add `.clay-drawer` + `.clay-card-list` utilities and a `--header-height` token
- `web/src/app/admin/layout.tsx` — swap inline sidebar for `<AdminSidebar />`, add top bar with hamburger on mobile
- `web/src/app/admin/products/page.tsx` — table → ResponsiveTable
- `web/src/app/admin/orders/page.tsx` — table → ResponsiveTable
- `web/src/app/admin/users/page.tsx` — table → ResponsiveTable + drawer width responsive
- `web/src/app/admin/topups/page.tsx` — table → ResponsiveTable
- `web/src/app/admin/stock/page.tsx` and `web/src/app/admin/stock/[productId]/page.tsx` — table → ResponsiveTable
- `web/src/app/admin/dashboard/page.tsx` — stack stat cards single-column on `<sm`
- `web/src/app/admin/settings/page.tsx` — settings rows: stack label/input on `<md`
- `web/src/app/page.tsx` — header nav cluster, hero typography clamp, mascot stack hidden `<lg`
- `web/src/app/san-pham/page.tsx` — filter bar wrap; product grid already responsive (verify)
- `web/src/app/san-pham/[slug]/page.tsx` — image+info side-by-side already at `md+` (verify), quantity buttons wrap
- `web/src/app/lien-ket/page.tsx`, `dang-nhap/page.tsx`, `quen-mat-khau/page.tsx` — verify max-w + padding
- `web/src/app/tai-khoan/page.tsx` — header nav stack, profile card stack on `<sm`, tabs scroll
- `web/src/app/thanh-toan/[orderId]/page.tsx` — QR + info responsive
- `web/src/components/UserMenu.tsx` — mobile-friendly dropdown alignment + tap target sizes

**Test files:** No automated tests exist for the web app. Verification is manual via Chrome DevTools device emulation. Each task includes the exact viewport widths to check.

---

## Conventions

- **Breakpoints used:** `sm` (640px), `md` (768px), `lg` (1024px). Skip `xs` (Tailwind v4 doesn't ship it; use no-prefix = mobile default). `xl` only when a desktop layout genuinely benefits.
- **Tap targets:** minimum 40×40 (`min-h-10 min-w-10`) for any interactive element on mobile. Tailwind classes `h-10 w-10` work.
- **Horizontal scroll:** allowed only inside an explicit `overflow-x-auto` container with a visible scrollbar hint. Page-level horizontal scroll is a bug.
- **Sidebar:** `lg:translate-x-0 -translate-x-full` pattern — drawer slides in from left, `<aside>` keeps `lg:static lg:translate-x-0` for desktop.
- **Commit style:** `feat(web): <change>` or `fix(web): <change>` prefix. Frequent commits — one per task.

---

## Task 1: Add `.clay-drawer` + `.clay-card-list` utilities

**Files:**
- Modify: `web/src/app/globals.css` (append to `@layer components`)

- [ ] **Step 1: Append utilities at end of `@layer components` block**

Open `web/src/app/globals.css` and add inside the existing `@layer components { ... }`:

```css
  /* Mobile sidebar drawer — slides in from left on <lg, becomes static on lg+ */
  .clay-drawer-backdrop {
    position: fixed; inset: 0; z-index: 40;
    background: rgba(0,0,0,0.4);
    backdrop-filter: blur(2px);
  }
  .clay-drawer-panel {
    position: fixed; top: 0; bottom: 0; left: 0; z-index: 50;
    width: 16rem; max-width: 85vw;
    background: #fff;
    border-right: 1px solid var(--color-clay-oat);
    transform: translateX(-100%);
    transition: transform 250ms cubic-bezier(.34,1.56,.64,1);
    overflow-y: auto;
  }
  .clay-drawer-panel.open { transform: translateX(0); }
  @media (min-width: 1024px) {
    .clay-drawer-backdrop { display: none; }
    .clay-drawer-panel { position: static; transform: none; max-width: none; z-index: auto; }
  }

  /* Mobile alternative to data tables — stacked card list */
  .clay-card-list { display: flex; flex-direction: column; gap: .75rem; }
  .clay-card-list-item {
    background: #fff;
    border: 1px solid var(--color-clay-oat);
    border-radius: 16px;
    padding: 1rem;
  }
  .clay-row-label {
    display: inline-block; min-width: 6.5rem;
    font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--color-clay-charcoal);
  }
```

- [ ] **Step 2: Verify Next dev picks up the CSS change**

Run (in a separate terminal that's already running `npm run dev:all`):
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/admin/login
```
Expected: `200`. (The change is CSS-only — Turbopack hot-reloads it without restart.)

- [ ] **Step 3: Commit**

```bash
git add web/src/app/globals.css
git commit -m "feat(web): add clay-drawer and clay-card-list utilities for responsive layouts"
```

---

## Task 2: Build `<AdminSidebar />` component (extract + add drawer state)

**Files:**
- Create: `web/src/components/AdminSidebar.tsx`
- Test: manual verify after Task 3 wiring

The current sidebar lives inline in `web/src/app/admin/layout.tsx:48-82`. Extract it so we can drive the open/close state from a sibling toggle without prop drilling.

- [ ] **Step 1: Create the component**

Write to `web/src/components/AdminSidebar.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { clearAdminToken } from '@/lib/api'
import { BarChart3, Receipt, Package, Boxes, Megaphone, Settings, LogOut, Users, Wallet, X } from '@/lib/icons'

const NAV = [
  { href: '/admin/dashboard', label: 'Tổng quan', icon: BarChart3 },
  { href: '/admin/orders', label: 'Đơn hàng', icon: Receipt },
  { href: '/admin/products', label: 'Sản phẩm', icon: Package },
  { href: '/admin/stock', label: 'Kho', icon: Boxes },
  { href: '/admin/users', label: 'Người dùng', icon: Users },
  { href: '/admin/topups', label: 'Nạp tiền', icon: Wallet },
  { href: '/admin/announcements', label: 'Thông báo', icon: Megaphone },
  { href: '/admin/settings', label: 'Cài đặt', icon: Settings },
]

interface Props {
  open: boolean
  onClose: () => void
}

export function AdminSidebar({ open, onClose }: Props) {
  const router = useRouter()
  const pathname = usePathname()

  // Close drawer on navigation (mobile) — desktop stays static so this is a no-op there.
  useEffect(() => { onClose() }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // ESC closes drawer
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  function handleLogout() {
    clearAdminToken()
    router.replace('/admin/login')
  }

  return (
    <>
      {open && <div className="clay-drawer-backdrop" onClick={onClose} aria-hidden="true" />}
      <aside className={`clay-drawer-panel ${open ? 'open' : ''} lg:w-64 p-5 flex flex-col flex-shrink-0`}>
        <div className="flex items-center justify-between mb-8">
          <div className="clay-display text-2xl">
            Peanut Shop <span style={{ color: 'var(--color-ube-800)' }}>Admin</span>
          </div>
          <button onClick={onClose} className="clay-btn p-2 lg:hidden" aria-label="Đóng menu">
            <X size={16} />
          </button>
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          {NAV.map(item => {
            const active = pathname === item.href || pathname?.startsWith(item.href + '/')
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center px-3 py-2 rounded-xl text-sm font-medium transition ${
                  active ? 'bg-clay-ink text-white' : 'text-clay-charcoal hover:bg-clay-oat-light'
                }`}
              >
                <Icon size={18} className="mr-2 shrink-0" />{item.label}
              </Link>
            )
          })}
        </nav>
        <div className="border-t border-clay-oat pt-4 mt-4">
          <button
            onClick={handleLogout}
            className="clay-btn w-full text-sm flex items-center justify-center gap-2"
          >
            <LogOut size={16} />Đăng xuất
          </button>
        </div>
      </aside>
    </>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```
Expected: `TypeScript: No errors found`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/AdminSidebar.tsx
git commit -m "feat(web): extract AdminSidebar with mobile drawer state"
```

---

## Task 3: Wire `<AdminSidebar />` into admin layout + add mobile top bar

**Files:**
- Modify: `web/src/app/admin/layout.tsx` (replace inline sidebar)

- [ ] **Step 1: Rewrite the layout**

Replace the entire content of `web/src/app/admin/layout.tsx` with:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getAdminToken } from '@/lib/api'
import { AdminSidebar } from '@/components/AdminSidebar'
import { Menu } from '@/lib/icons'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    if (pathname === '/admin/login') {
      setReady(true)
      return
    }
    if (!getAdminToken()) {
      router.replace('/admin/login')
    } else {
      setReady(true)
    }
  }, [pathname, router])

  if (pathname === '/admin/login') {
    return <>{children}</>
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-clay-cream">
        <div className="text-clay-charcoal">Đang tải...</div>
      </div>
    )
  }

  return (
    <div className="lg:flex min-h-screen bg-clay-cream">
      <AdminSidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {/* Mobile top bar (hidden on lg+) */}
      <header className="lg:hidden sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-clay-oat px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Mở menu"
          className="clay-btn p-2"
        >
          <Menu size={18} />
        </button>
        <div className="clay-display text-lg">
          Peanut Shop <span style={{ color: 'var(--color-ube-800)' }}>Admin</span>
        </div>
        <div className="w-10" aria-hidden /> {/* spacer to balance the menu button */}
      </header>

      <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-auto">{children}</main>
    </div>
  )
}
```

- [ ] **Step 2: Add `Menu` icon to the icons barrel**

Open `web/src/lib/icons.tsx`. In the existing `export {` block, add `Menu,` near the other layout icons (after `LogOut` is fine):

```ts
  LogOut,
  Menu,
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd web && npx tsc --noEmit
```
Expected: `TypeScript: No errors found`

- [ ] **Step 4: Manual check — load admin in 3 widths**

Start (or keep) `npm run dev:all` running. In Chrome DevTools (F12 → device toolbar):
- 360×640 (iPhone SE): top bar visible, hamburger opens drawer, backdrop closes it, ESC closes it
- 768×1024 (iPad): same behavior — sidebar still hidden until hamburger
- 1280×800 (Desktop): top bar hidden, sidebar permanently visible on left

Visit `/admin/dashboard` after logging in. Click each nav item — drawer should close on navigation in mobile, stay visible on desktop.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/admin/layout.tsx web/src/lib/icons.tsx
git commit -m "feat(web): mobile-friendly admin layout with hamburger + drawer"
```

---

## Task 4: Build `<ResponsiveTable />` wrapper

**Files:**
- Create: `web/src/components/ResponsiveTable.tsx`

Tables in `/admin/products`, `/admin/orders`, etc. don't fit in 360px. Rather than horizontal scroll (poor UX with sticky headers), render a card list on `<md` and the existing table on `md+`.

Strategy: caller passes the column definition once; the component renders both a `<table>` (md+) and a stacked card list (<md), using the same data and cell renderers.

- [ ] **Step 1: Create the component**

Write to `web/src/components/ResponsiveTable.tsx`:

```tsx
'use client'

import { ReactNode } from 'react'

export interface Column<T> {
  /** Header label shown in the table head AND as the row-label in card view. */
  header: string
  /** Render the cell. Receives the row + index. */
  cell: (row: T, index: number) => ReactNode
  /** Optional: extra classes for the <th>/<td> on table view. */
  className?: string
  /** Optional: hide this column on the card list (e.g. avatar already in header). */
  hideOnCard?: boolean
  /** Optional: when true, render this column as the card's header line. */
  primary?: boolean
}

interface Props<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  loading?: boolean
  emptyText?: string
  /** Optional render of action buttons in the card footer. */
  cardActions?: (row: T) => ReactNode
}

export function ResponsiveTable<T>({
  rows, columns, rowKey, loading, emptyText = 'Không có dữ liệu', cardActions,
}: Props<T>) {
  if (loading) {
    return (
      <div className="clay-card p-6 space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-10 bg-clay-oat-light rounded animate-pulse" />
        ))}
      </div>
    )
  }
  if (rows.length === 0) {
    return <div className="clay-card p-12 text-center text-clay-silver">{emptyText}</div>
  }

  return (
    <>
      {/* Table on md+ */}
      <div className="hidden md:block clay-card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-clay-oat-light border-b border-clay-oat">
              <tr>
                {columns.map((col, i) => (
                  <th key={i} className={`text-left text-xs uppercase tracking-wider text-clay-charcoal py-3 px-4 ${col.className || ''}`}>
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rowKey(row)} className="border-b border-clay-oat-light hover:bg-clay-oat-light/40 align-top">
                  {columns.map((col, cIdx) => (
                    <td key={cIdx} className={`py-3 px-4 ${col.className || ''}`}>
                      {col.cell(row, rIdx)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Card list on <md */}
      <ul className="md:hidden clay-card-list">
        {rows.map((row, rIdx) => {
          const primary = columns.find(c => c.primary)
          const others = columns.filter(c => !c.primary && !c.hideOnCard)
          return (
            <li key={rowKey(row)} className="clay-card-list-item">
              {primary && (
                <div className="font-semibold mb-2">{primary.cell(row, rIdx)}</div>
              )}
              <dl className="space-y-1.5 text-sm">
                {others.map((col, cIdx) => (
                  <div key={cIdx} className="flex items-baseline gap-2">
                    <dt className="clay-row-label">{col.header}</dt>
                    <dd className="flex-1 min-w-0">{col.cell(row, rIdx)}</dd>
                  </div>
                ))}
              </dl>
              {cardActions && (
                <div className="mt-3 pt-3 border-t border-clay-oat-light flex flex-wrap gap-2">
                  {cardActions(row)}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd web && npx tsc --noEmit
```
Expected: `TypeScript: No errors found`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ResponsiveTable.tsx
git commit -m "feat(web): add ResponsiveTable wrapper (table on md+, cards on <md)"
```

---

## Task 5: Migrate `/admin/orders` table → ResponsiveTable

**Files:**
- Modify: `web/src/app/admin/orders/page.tsx` (replace `<table>` block, keep filters + pagination)

- [ ] **Step 1: Add import**

In `web/src/app/admin/orders/page.tsx`, near the existing imports, add:

```ts
import { ResponsiveTable, Column } from '@/components/ResponsiveTable'
```

- [ ] **Step 2: Define columns above the return**

Inside `OrdersPage()` after `const totalPages = ...`, add:

```ts
const columns: Column<Order>[] = [
  {
    header: 'Mã', primary: true,
    cell: (o) => <span className="font-mono text-xs">#{o.id}</span>,
    className: 'w-20',
  },
  { header: 'Khách', cell: (o) => o.userName || '—' },
  { header: 'Sản phẩm', cell: (o) => o.productName },
  { header: 'SL', cell: (o) => o.quantity, className: 'text-right' },
  { header: 'Tổng', cell: (o) => formatPrice(o.totalPrice), className: 'text-right font-medium' },
  { header: 'Trạng thái', cell: (o) => <StatusPill status={o.status} />, className: 'text-center' },
  { header: 'Key', cell: (o) => <KeyCell orderId={o.id} status={o.status} /> },
  { header: 'Thời gian', cell: (o) => <span className="text-xs text-clay-silver whitespace-nowrap">{formatDate(o.createdAt)}</span> },
]

function rowActions(order: Order) {
  if (order.status === 'pending' || order.status === 'paid') {
    return (
      <>
        <button
          onClick={() => confirmMutation.mutate(order.id)}
          disabled={confirmMutation.isPending}
          className="clay-btn clay-btn--matcha text-xs py-1 px-2 disabled:opacity-50"
        >Xác nhận</button>
        <button
          onClick={() => cancelMutation.mutate(order.id)}
          disabled={cancelMutation.isPending}
          className="clay-btn clay-btn--pomegranate text-xs py-1 px-2 disabled:opacity-50"
        >Hủy</button>
      </>
    )
  }
  if (order.status === 'delivered') {
    return (
      <button
        onClick={() => handleResend(order.id)}
        disabled={resendMutation.isPending}
        className="clay-btn clay-btn--ube text-xs py-1 px-2 disabled:opacity-50 flex items-center gap-1"
      >
        <Send size={12} />Gửi lại
      </button>
    )
  }
  return null
}
```

- [ ] **Step 3: Replace the existing `<div className="clay-card p-0 overflow-hidden">...</div>` block**

Find the block that starts with `<div className="clay-card p-0 overflow-hidden">` and contains the `<table>`. Replace it (and only it — keep the pagination block that follows) with:

```tsx
<ResponsiveTable
  rows={orders}
  columns={columns}
  rowKey={(o) => o.id}
  loading={isLoading}
  emptyText="Chưa có đơn hàng nào"
  cardActions={rowActions}
/>

{/* Per-row actions on table view (rendered as a 9th column) */}
{orders.length > 0 && (
  <div className="hidden md:block -mt-4 clay-card p-3">
    <p className="text-xs text-clay-silver">
      Thao tác hiển thị trong cột riêng trên mobile. Trên desktop dùng cột "Thao tác" cũ.
    </p>
  </div>
)}
```

Wait — this approach drops the desktop action column. Better path: add an `actions` column to `columns`:

Replace the previous Step 3 with this corrected version:

Add to the end of the `columns` array:

```ts
{
  header: 'Thao tác',
  className: 'text-center',
  hideOnCard: true,
  cell: (order) => (
    <div className="flex gap-1.5 justify-center flex-wrap">
      {rowActions(order)}
    </div>
  ),
},
```

Then replace ONLY the `<div className="clay-card p-0 overflow-hidden">...</div>` block (the wrapper around the `<table>` — NOT the pagination block) with:

```tsx
<ResponsiveTable
  rows={orders}
  columns={columns}
  rowKey={(o) => o.id}
  loading={isLoading}
  emptyText="Chưa có đơn hàng nào"
  cardActions={rowActions}
/>
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd web && npx tsc --noEmit
```
Expected: `TypeScript: No errors found`

- [ ] **Step 5: Manual check at 360px and 1280px**

DevTools → 360×640: orders list should show as stacked cards with Mã as the title and other fields as labeled rows. Action buttons at the bottom of each card.

DevTools → 1280×800: original table layout with action column on the right.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/admin/orders/page.tsx
git commit -m "feat(web): /admin/orders responsive — table on md+, card list on <md"
```

---

## Task 6: Migrate `/admin/products` table → ResponsiveTable

**Files:**
- Modify: `web/src/app/admin/products/page.tsx`

Same pattern as Task 5. Reorder buttons (`↑/↓`) belong in actions on mobile too.

- [ ] **Step 1: Add import**

```ts
import { ResponsiveTable, Column } from '@/components/ResponsiveTable'
```

- [ ] **Step 2: Define columns inside the component, after `function move(...)`**

```ts
const columns: Column<Product>[] = [
  {
    header: '⇅', className: 'w-16 text-center', hideOnCard: false,
    cell: (product, idx) => {
      const prev = products[idx - 1]
      const next = products[idx + 1]
      const canMoveUp = !!prev && prev.category === product.category
      const canMoveDown = !!next && next.category === product.category
      return (
        <div className="inline-flex flex-col gap-0.5">
          <button
            onClick={() => move(product.id, -1)}
            disabled={!canMoveUp || reorderMutation.isPending}
            title="Lên"
            className="p-1 rounded hover:bg-clay-oat-light disabled:opacity-25 disabled:cursor-not-allowed"
          ><ArrowUp size={14} /></button>
          <button
            onClick={() => move(product.id, 1)}
            disabled={!canMoveDown || reorderMutation.isPending}
            title="Xuống"
            className="p-1 rounded hover:bg-clay-oat-light disabled:opacity-25 disabled:cursor-not-allowed"
          ><ArrowDown size={14} /></button>
        </div>
      )
    },
  },
  { header: 'Mã', cell: (p) => <span className="font-mono text-xs text-clay-silver">{p.id.slice(0, 8)}</span> },
  { header: 'Tên', primary: true, cell: (p) => <span className="font-medium">{p.name}</span> },
  { header: 'Danh mục', cell: (p) => <span className="text-clay-charcoal">{p.category}</span> },
  { header: 'Giá', className: 'text-right', cell: (p) => <span className="font-medium">{formatPrice(p.price)}</span> },
  {
    header: 'Tồn kho', className: 'text-right',
    cell: (p) => {
      const isLow = p.stock <= p.lowStockThreshold
      return (
        <span className={`clay-pill ${isLow ? 'text-pomegranate-700' : ''}`}
              style={isLow ? { background: 'var(--color-pomegranate-100)' } : {}}>
          {p.stock}{isLow && ' (thấp)'}
        </span>
      )
    },
  },
  {
    header: 'Trạng thái', className: 'text-center',
    cell: (p) => (
      <button
        onClick={() => toggleMutation.mutate(p.id)}
        disabled={toggleMutation.isPending}
        className="clay-btn text-xs py-1 px-3"
        style={p.active ? { background: 'var(--color-matcha-300)' } : {}}
      >{p.active ? 'Hoạt động' : 'Tắt'}</button>
    ),
  },
  {
    header: 'Thao tác', className: 'text-center', hideOnCard: true,
    cell: (product) => (
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <Link href={`/admin/stock/${product.id}`} className="clay-btn clay-btn--ube text-xs py-1 px-3 flex items-center gap-1">
          <Boxes size={14} />Kho
        </Link>
        <button onClick={() => openEdit(product)} className="clay-btn text-xs py-1 px-3 flex items-center gap-1">
          <Pencil size={14} />Sửa
        </button>
        <button
          onClick={() => handleDelete(product.id, product.name)}
          disabled={deleteMutation.isPending}
          className="clay-btn clay-btn--pomegranate text-xs py-1 px-3 disabled:opacity-50 flex items-center gap-1"
        ><Trash2 size={14} />Xoá</button>
      </div>
    ),
  },
]

function cardActions(product: Product) {
  return (
    <>
      <Link href={`/admin/stock/${product.id}`} className="clay-btn clay-btn--ube text-xs py-1 px-3 flex items-center gap-1">
        <Boxes size={14} />Kho
      </Link>
      <button onClick={() => openEdit(product)} className="clay-btn text-xs py-1 px-3 flex items-center gap-1">
        <Pencil size={14} />Sửa
      </button>
      <button
        onClick={() => handleDelete(product.id, product.name)}
        disabled={deleteMutation.isPending}
        className="clay-btn clay-btn--pomegranate text-xs py-1 px-3 disabled:opacity-50 flex items-center gap-1"
      ><Trash2 size={14} />Xoá</button>
    </>
  )
}
```

- [ ] **Step 3: Replace the table block**

Find `<div className="clay-card p-0 overflow-hidden">` containing the `<table>` element. Replace ONLY that wrapper div (everything inside it — table, thead, tbody) with:

```tsx
<ResponsiveTable
  rows={products}
  columns={columns}
  rowKey={(p) => p.id}
  loading={isLoading}
  emptyText="Chưa có sản phẩm nào"
  cardActions={cardActions}
/>
```

- [ ] **Step 4: Form modal — make it scroll on small screens**

Find `<div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">` and confirm it already has `max-h-[90vh] overflow-y-auto` and `mx-4`. If the modal still feels cramped on 360px, change `max-w-lg` to `max-w-lg sm:max-w-lg w-full`. Already correct via `w-full max-w-lg` — no change needed.

- [ ] **Step 5: Verify TypeScript**

```bash
cd web && npx tsc --noEmit
```
Expected: `TypeScript: No errors found`

- [ ] **Step 6: Manual check 360px + 1280px**

DevTools 360px on `/admin/products`: cards stack vertically, name as title, reorder arrows + status toggle inline, action row at bottom. DevTools 1280px: original table.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/admin/products/page.tsx
git commit -m "feat(web): /admin/products responsive table"
```

---

## Task 7: Migrate `/admin/topups` and `/admin/users` tables

**Files:**
- Modify: `web/src/app/admin/topups/page.tsx`
- Modify: `web/src/app/admin/users/page.tsx`

Same pattern as Tasks 5–6. The users page also has a side drawer for the detail view — its width needs a responsive cap.

- [ ] **Step 1: Migrate `/admin/topups`**

In `web/src/app/admin/topups/page.tsx`, add the import:

```ts
import { ResponsiveTable, Column } from '@/components/ResponsiveTable'
```

Inside `TopupsPage()` after `const topups = data?.data ?? []`, define:

```ts
const columns: Column<Topup>[] = [
  { header: '#', cell: (t) => <span className="font-mono text-xs">{t.id}</span> },
  {
    header: 'User', primary: true,
    cell: (t) => (
      <>
        <div className="font-medium">{t.userName || '—'}</div>
        <div className="text-xs text-clay-silver">
          {t.username ? `@${t.username}` : `ID ${t.userId}`}
        </div>
      </>
    ),
  },
  { header: 'Memo', cell: (t) => <span className="font-mono text-xs">{t.memo}</span> },
  { header: 'Số tiền', className: 'text-right font-medium', cell: (t) => formatPrice(t.amount) },
  {
    header: 'Trạng thái', className: 'text-center',
    cell: (t) => (
      <span className="clay-pill" style={{ background: STATUS_BG[t.status] }}>
        {STATUS_LABEL[t.status]}
      </span>
    ),
  },
  {
    header: 'Yêu cầu',
    cell: (t) => (
      <span className="text-clay-charcoal text-xs">
        {new Date(t.requestedAt).toLocaleString('vi')}
        {t.matchedAt && (
          <div className="text-clay-silver">→ khớp {new Date(t.matchedAt).toLocaleString('vi')}</div>
        )}
      </span>
    ),
  },
  {
    header: 'Thao tác', className: 'text-center', hideOnCard: true,
    cell: (t) => (t.status === 'pending' || t.status === 'awaiting_credit') ? (
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <button
          onClick={() => handleCredit(t)}
          disabled={creditMutation.isPending}
          className="clay-btn clay-btn--matcha text-xs py-1 px-3 flex items-center gap-1 disabled:opacity-50"
        ><Check size={14} />Cộng</button>
        <button
          onClick={() => handleCancel(t)}
          disabled={cancelMutation.isPending}
          className="clay-btn clay-btn--pomegranate text-xs py-1 px-3 flex items-center gap-1 disabled:opacity-50"
        ><X size={14} />Hủy</button>
      </div>
    ) : <span className="text-clay-silver text-xs">—</span>,
  },
]

function cardActions(t: Topup) {
  if (t.status !== 'pending' && t.status !== 'awaiting_credit') return null
  return (
    <>
      <button
        onClick={() => handleCredit(t)}
        disabled={creditMutation.isPending}
        className="clay-btn clay-btn--matcha text-xs py-1 px-3 flex items-center gap-1 disabled:opacity-50"
      ><Check size={14} />Cộng</button>
      <button
        onClick={() => handleCancel(t)}
        disabled={cancelMutation.isPending}
        className="clay-btn clay-btn--pomegranate text-xs py-1 px-3 flex items-center gap-1 disabled:opacity-50"
      ><X size={14} />Hủy</button>
    </>
  )
}
```

Replace the existing `<div className="clay-card p-0 overflow-hidden">...</div>` (the table wrapper) with:

```tsx
<ResponsiveTable
  rows={topups}
  columns={columns}
  rowKey={(t) => t.id}
  loading={isLoading}
  emptyText="Chưa có yêu cầu nạp nào"
  cardActions={cardActions}
/>
```

- [ ] **Step 2: Migrate `/admin/users`**

In `web/src/app/admin/users/page.tsx`, add the import and define columns analogously (full_name primary, username + telegram_id + balance + order_count + joined_at as labeled rows). Open the detail drawer on row click — same as today.

```ts
import { ResponsiveTable, Column } from '@/components/ResponsiveTable'
```

Inside `UsersPage()` after `const users = data?.data ?? []`, add:

```ts
const columns: Column<UserRow>[] = [
  {
    header: 'Tên', primary: true,
    cell: (u) => (
      <button onClick={() => openDetail(u)} className="text-left hover:underline">
        <div className="font-medium">{u.full_name}</div>
        <div className="text-xs text-clay-silver">
          {u.username ? `@${u.username}` : `ID ${u.telegram_id}`}
        </div>
      </button>
    ),
  },
  { header: 'Username', cell: (u) => <span className="text-clay-charcoal">{u.username ? `@${u.username}` : '—'}</span> },
  { header: 'Telegram ID', cell: (u) => <span className="font-mono text-xs text-clay-silver">{u.telegram_id}</span> },
  { header: 'Số dư', className: 'text-right font-medium', cell: (u) => formatPrice(u.balance) },
  { header: 'Đơn đã giao', className: 'text-right', cell: (u) => u.order_count },
  { header: 'Tham gia', cell: (u) => <span className="text-xs text-clay-charcoal">{new Date(u.created_at).toLocaleDateString('vi')}</span> },
]
```

Replace the existing table wrapper with:

```tsx
<ResponsiveTable
  rows={users}
  columns={columns}
  rowKey={(u) => u.telegram_id}
  loading={isLoading}
  emptyText="Không có người dùng nào"
/>
```

Now make the detail drawer responsive. Find:

```tsx
<div className="bg-white w-full max-w-xl h-full overflow-y-auto p-6"
```

Change `w-full max-w-xl` → `w-full sm:max-w-xl` and `p-6` → `p-4 sm:p-6`. Final:

```tsx
<div className="bg-white w-full sm:max-w-xl h-full overflow-y-auto p-4 sm:p-6"
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd web && npx tsc --noEmit
```
Expected: `TypeScript: No errors found`

- [ ] **Step 4: Manual check 360px**

`/admin/topups`, `/admin/users` — cards stack, drawer fills full width on mobile.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/admin/topups/page.tsx web/src/app/admin/users/page.tsx
git commit -m "feat(web): /admin/topups and /admin/users responsive"
```

---

## Task 8: Migrate `/admin/stock` tables

**Files:**
- Modify: `web/src/app/admin/stock/page.tsx`
- Modify: `web/src/app/admin/stock/[productId]/page.tsx`

- [ ] **Step 1: Read both files first**

```bash
head -100 web/src/app/admin/stock/page.tsx web/src/app/admin/stock/\[productId\]/page.tsx
```

Identify the table structure in each (column headers and cell rendering). The pattern is identical to Tasks 5–7: extract columns, swap `<table>` for `<ResponsiveTable>`.

- [ ] **Step 2: Apply ResponsiveTable to `/admin/stock` (list view)**

The list page shows products with stock counts. Use these columns:

```ts
const columns: Column<StockRow>[] = [
  { header: 'Sản phẩm', primary: true, cell: (s) => <span className="font-medium">{s.name}</span> },
  { header: 'Còn lại', className: 'text-right font-medium', cell: (s) => s.stock },
  { header: 'Đã bán', className: 'text-right', cell: (s) => s.soldStock },
  { header: 'Tổng', className: 'text-right', cell: (s) => s.totalStock },
  {
    header: 'Thao tác', className: 'text-center', hideOnCard: true,
    cell: (s) => (
      <Link href={`/admin/stock/${s.productId}`} className="clay-btn clay-btn--ink text-xs py-1 px-3">
        Quản lý
      </Link>
    ),
  },
]

function cardActions(s: StockRow) {
  return (
    <Link href={`/admin/stock/${s.productId}`} className="clay-btn clay-btn--ink text-xs py-1 px-3">
      Quản lý kho
    </Link>
  )
}
```

(Adjust the `StockRow` type name to whatever the file already uses — e.g. if it's an inline interface, lift it to a named export or import.)

- [ ] **Step 3: Apply ResponsiveTable to `/admin/stock/[productId]` (item list)**

Per-stock items table. Columns:

```ts
const columns: Column<StockItem>[] = [
  { header: 'ID', cell: (i) => <span className="font-mono text-xs">{i.id}</span> },
  { header: 'Nội dung', primary: true, cell: (i) => <code className="font-mono text-xs break-all">{i.content}</code> },
  {
    header: 'Trạng thái', className: 'text-center',
    cell: (i) => (
      <span className="clay-pill" style={i.sold ? { background: 'var(--color-pomegranate-100)' } : { background: 'var(--color-matcha-300)' }}>
        {i.sold ? 'Đã bán' : 'Còn'}
      </span>
    ),
  },
  { header: 'Bán cho', cell: (i) => i.soldTo ? <span className="text-xs">{i.soldTo}</span> : <span className="text-clay-silver text-xs">—</span> },
  { header: 'Thời gian', cell: (i) => <span className="text-xs text-clay-silver">{i.soldAt || i.createdAt || '—'}</span> },
]
```

(Adapt to whatever the existing types look like.)

- [ ] **Step 4: Verify TypeScript**

```bash
cd web && npx tsc --noEmit
```
Expected: `TypeScript: No errors found`

- [ ] **Step 5: Manual check 360px**

- [ ] **Step 6: Commit**

```bash
git add web/src/app/admin/stock/
git commit -m "feat(web): /admin/stock pages responsive"
```

---

## Task 9: Admin dashboard — stat cards stack, chart shrink

**Files:**
- Modify: `web/src/app/admin/dashboard/page.tsx`

- [ ] **Step 1: Locate the stat cards grid**

```bash
grep -n "grid-cols\|recharts" web/src/app/admin/dashboard/page.tsx | head
```

- [ ] **Step 2: Wrap the stat cards in a responsive grid**

Find any line like `<div className="grid grid-cols-4 gap-4">` (or whatever count). Change to:

```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
```

If the existing class is something like `grid grid-cols-3` or similar, apply the same `grid-cols-1 sm:grid-cols-2 lg:grid-cols-N` pattern with `N` matching the original.

- [ ] **Step 3: Make the recharts container responsive**

Find the `<ResponsiveContainer>` usage. It's likely already `width="100%"`. Confirm the wrapping div has no fixed width. If it has `h-80` (or similar fixed height), keep it — recharts needs a fixed height to render.

- [ ] **Step 4: Top-products table — wrap in ResponsiveTable**

Apply the same pattern from Task 5 to the top-products table.

- [ ] **Step 5: Verify TypeScript**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 6: Manual check 360px + 768px + 1280px**

- [ ] **Step 7: Commit**

```bash
git add web/src/app/admin/dashboard/page.tsx
git commit -m "feat(web): admin dashboard responsive grid"
```

---

## Task 10: Admin settings page — stack label/input on `<md`

**Files:**
- Modify: `web/src/app/admin/settings/page.tsx`

The current `<FieldRow>` uses `grid-cols-1 md:grid-cols-[1fr_minmax(280px,400px)]` — already responsive. Verify, and adjust the sticky save bar so it doesn't overlap content on mobile.

- [ ] **Step 1: Confirm `FieldRow` already stacks**

Read the file's `FieldRow` definition. The `grid-cols-1 md:grid-cols-[1fr_minmax(280px,400px)]` pattern stacks single-column on `<md` and side-by-side on `md+`. No change needed unless the description text overflows.

- [ ] **Step 2: Sticky save bar — adjust margin so it spans the mobile padding**

Find the line:

```tsx
<div className="sticky bottom-0 z-10 bg-clay-cream/95 backdrop-blur border-t border-clay-oat -mx-8 px-8 py-4 flex items-center justify-between">
```

The `-mx-8 px-8` assumes the parent has `p-8` padding. With Task 3's new layout (`p-4 sm:p-6 lg:p-8`), this misaligns on mobile. Change to:

```tsx
<div className="sticky bottom-0 z-10 bg-clay-cream/95 backdrop-blur border-t border-clay-oat -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between flex-wrap gap-3">
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 4: Manual check 360px — group panels stack, sticky bar spans full width**

- [ ] **Step 5: Commit**

```bash
git add web/src/app/admin/settings/page.tsx
git commit -m "fix(web): admin settings sticky save bar respects responsive padding"
```

---

## Task 11: Customer header + UserMenu polish

**Files:**
- Modify: `web/src/app/page.tsx` (header)
- Modify: `web/src/app/san-pham/page.tsx` (header)
- Modify: `web/src/app/san-pham/[slug]/page.tsx` (header)
- Modify: `web/src/app/tai-khoan/page.tsx` (header)
- Modify: `web/src/components/UserMenu.tsx`

The header has 2–3 nav items + UserMenu, which together overflow on 360px.

- [ ] **Step 1: Tighten header padding on mobile**

Each customer header looks like:

```tsx
<header className="border-b border-clay-oat bg-clay-cream/80 backdrop-blur sticky top-0 z-10">
  <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
```

Change `px-6 py-5` → `px-4 sm:px-6 py-3 sm:py-5` in all 4 customer page files listed above.

- [ ] **Step 2: Logo size scales**

Logo is `text-2xl clay-display`. Change to `text-xl sm:text-2xl clay-display` so it doesn't dominate small screens. Apply in all 4 headers.

- [ ] **Step 3: Hide secondary nav text on `<sm`**

Where the nav has `<ShoppingCart size={16} />Sản phẩm`, wrap the label in a span with `hidden sm:inline`:

```tsx
<Link href="/san-pham" className="clay-btn clay-btn--lemon flex items-center gap-1.5">
  <ShoppingCart size={16} /><span className="hidden sm:inline">Sản phẩm</span>
</Link>
```

Apply in all 4 customer page headers (icon stays visible — labels collapse).

- [ ] **Step 4: UserMenu dropdown alignment**

In `web/src/components/UserMenu.tsx`, find the dropdown panel:

```tsx
<div role="menu" className="absolute right-0 mt-2 w-72 bg-white rounded-2xl border border-clay-oat shadow-lg overflow-hidden z-50">
```

Change to:

```tsx
<div role="menu" className="absolute right-0 mt-2 w-[calc(100vw-2rem)] sm:w-72 max-w-[20rem] bg-white rounded-2xl border border-clay-oat shadow-lg overflow-hidden z-50">
```

This caps the dropdown to viewport on mobile while keeping 288px on desktop.

- [ ] **Step 5: UserMenu trigger button — hide balance text on `<sm`**

Find:

```tsx
<span className="hidden sm:inline-flex flex-col items-start leading-tight">
  <span className="text-xs text-clay-charcoal">Số dư</span>
  <span className="text-sm font-semibold">{me ? formatPrice(me.balance) : '...'}</span>
</span>
```

Already gated behind `hidden sm:inline-flex` — good. No change.

- [ ] **Step 6: Login + Link Telegram buttons in `!tokenPresent` branch**

The current code shows both buttons. On `<sm` they overflow. Change:

```tsx
return (
  <div className="flex gap-2">
    <Link href="/dang-nhap" className="clay-btn flex items-center gap-1.5">
      <Lock size={16} />Đăng nhập
    </Link>
    <Link href="/lien-ket" className="clay-btn clay-btn--ube hidden sm:flex items-center gap-1.5">
      <Send size={16} />Liên kết Telegram
    </Link>
  </div>
)
```

This is already the state in the file. Confirm and move on.

- [ ] **Step 7: Verify TypeScript**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 8: Manual check 360px**

Visit `/`, `/san-pham`, `/san-pham/<slug>`, `/tai-khoan` at 360px. Header should be a clean single row with logo (compact), an icon-only Sản phẩm button, and either Đăng nhập (logged-out) or the avatar (logged-in).

- [ ] **Step 9: Commit**

```bash
git add web/src/app/page.tsx web/src/app/san-pham/ web/src/app/tai-khoan/page.tsx web/src/components/UserMenu.tsx
git commit -m "feat(web): customer header + UserMenu mobile polish"
```

---

## Task 12: Hero typography + mascot stack mobile behavior

**Files:**
- Modify: `web/src/app/page.tsx`

- [ ] **Step 1: Verify hero h1 already uses clamp**

Find the hero h1. If it's using fixed sizes like `text-[64px] md:text-[80px]`, change to:

```tsx
<h1 className="clay-display max-w-4xl leading-[1.05]" style={{ fontSize: 'clamp(40px, 8vw, 80px)' }}>
```

`clamp(40px, 8vw, 80px)` keeps text readable from 360px (≈40px) up to 1280px (≈80px) without breakpoint jumps.

- [ ] **Step 2: Hide mascot stack on `<lg`**

If a mascot/decoration block exists that pushes content down on mobile, wrap it with `hidden lg:block` so it only shows when there's room.

```bash
grep -n "mascot\|🥜\|peanut" web/src/app/page.tsx | head
```

If nothing matches, no mascot present — skip this step.

- [ ] **Step 3: CTA buttons wrap on overflow**

Find the hero CTAs container. Add `flex-wrap` to its parent:

```tsx
<div className="flex flex-wrap gap-3 mt-8">
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 5: Manual check 360px / 768px / 1280px**

Hero text shouldn't overflow. CTA buttons stack on narrow viewport.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/page.tsx
git commit -m "fix(web): hero typography clamp + CTA flex-wrap on mobile"
```

---

## Task 13: Auth pages — verify max-w + padding

**Files:**
- Modify (if needed): `web/src/app/lien-ket/page.tsx`, `web/src/app/dang-nhap/page.tsx`, `web/src/app/quen-mat-khau/page.tsx`

These pages use `max-w-md` or `max-w-xl`. On mobile they should fill the viewport with `px-4` padding.

- [ ] **Step 1: Audit each page's main element**

```bash
grep -n "<main" web/src/app/lien-ket/page.tsx web/src/app/dang-nhap/page.tsx web/src/app/quen-mat-khau/page.tsx
```

Each `<main>` should have `px-4 sm:px-6` (or equivalent). If a page only has `px-6` (no `px-4` fallback), update it.

- [ ] **Step 2: 3-step explainer grid in `/dang-nhap`**

The current code has `grid grid-cols-3 gap-2`. On 360px, three cards squeeze tight. Change to:

```tsx
<ol className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-6 text-center text-xs">
```

(Keeps the visual flow horizontal on tablet+, stacks on mobile.)

- [ ] **Step 3: Verify TypeScript**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 4: Manual check 360px on each auth page**

- [ ] **Step 5: Commit**

```bash
git add web/src/app/lien-ket/ web/src/app/dang-nhap/ web/src/app/quen-mat-khau/
git commit -m "fix(web): auth pages mobile padding + dang-nhap stepper stack"
```

---

## Task 14: Tài khoản page — profile card + tabs responsive

**Files:**
- Modify: `web/src/app/tai-khoan/page.tsx`

The profile card uses `flex flex-col sm:flex-row sm:items-center` — already correct. Tabs cluster + logout button overflows on mobile.

- [ ] **Step 1: Tabs row — wrap on overflow**

Find the tab row (`Nạp ví / Đơn hàng` + logout). Add `flex-wrap`:

```tsx
<div className="flex flex-wrap gap-2 mb-6">
```

- [ ] **Step 2: Active topup card layout**

Find the active topup card with `flex flex-col sm:flex-row gap-6 items-center`. The QR is `w-56 h-56` — too large for mobile. Change to `w-44 h-44 sm:w-56 sm:h-56`.

- [ ] **Step 3: Email + password form — already stacks**

Confirm the Lock panel form stacks naturally (no grid). No change needed.

- [ ] **Step 4: Verify TypeScript**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 5: Manual check 360px**

- [ ] **Step 6: Commit**

```bash
git add web/src/app/tai-khoan/page.tsx
git commit -m "fix(web): tai-khoan page mobile polish"
```

---

## Task 15: Thanh toán page — QR + info responsive

**Files:**
- Modify: `web/src/app/thanh-toan/[orderId]/page.tsx`

This page has no header. The QR + payment info should stack on mobile.

- [ ] **Step 1: Read the file**

```bash
cat web/src/app/thanh-toan/\[orderId\]/page.tsx | head -100
```

- [ ] **Step 2: Wrap QR + info in responsive grid**

Find the main layout container that wraps the QR image and the payment info text. If it uses `flex` or `grid grid-cols-2`, change to `grid grid-cols-1 md:grid-cols-2 gap-6`. Container `max-w-` should be `max-w-3xl mx-auto px-4 sm:px-6`.

- [ ] **Step 3: QR image size**

Find the QR `<img>`. Change to `w-full max-w-xs sm:max-w-sm mx-auto h-auto`.

- [ ] **Step 4: Verify TypeScript**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 5: Manual check 360px**

- [ ] **Step 6: Commit**

```bash
git add web/src/app/thanh-toan/
git commit -m "fix(web): payment page responsive grid + QR sizing"
```

---

## Task 16: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type check**

```bash
cd web && npx tsc --noEmit
```
Expected: `TypeScript: No errors found`

- [ ] **Step 2: Lint**

```bash
cd web && npx eslint .
```
Expected: zero errors. Warnings are acceptable; investigate any new errors.

- [ ] **Step 3: Build**

```bash
cd web && npm run build
```
Expected: build completes; no Tailwind class purge warnings about classes that don't exist.

- [ ] **Step 4: Manual smoke at 3 breakpoints**

Start dev: `cd web && npm run dev` (or `npm run dev:all` from repo root). In Chrome DevTools device toolbar, check at 360px, 768px, 1280px:

| Page | What to verify |
|---|---|
| `/` | Hero text fits, CTAs wrap, header compact |
| `/san-pham` | Filter bar wraps, product grid 1/2/3 cols |
| `/san-pham/<slug>` | Image stacks above info on mobile, qty buttons wrap |
| `/lien-ket` | Form fits, no horizontal scroll |
| `/dang-nhap` | 3-step stepper stacks on mobile |
| `/tai-khoan` | Profile + tabs + topup form fit |
| `/thanh-toan/<id>` | QR + info stack, no overflow |
| `/admin/login` | Centered card fits |
| `/admin/dashboard` | Sidebar drawer works, stat grid 1/2/4 |
| `/admin/orders` | Cards on mobile, table on desktop |
| `/admin/products` | Cards on mobile, reorder arrows visible |
| `/admin/topups` | Cards on mobile |
| `/admin/users` | Cards on mobile, drawer fills width |
| `/admin/stock` | Cards on mobile |
| `/admin/settings` | Field rows stack, sticky save bar full width |
| `/admin/announcements` | Form + list usable |

Open the drawer, click each nav link — should auto-close.

- [ ] **Step 5: Touch target audit**

In DevTools, hover the cursor pointer over each interactive button. Anything visibly smaller than ~40×40 on mobile is a problem. Common offenders: pagination chevrons, table row actions. Bump padding if found.

- [ ] **Step 6: Commit any final touch-ups**

```bash
git add -A
git commit -m "chore(web): final responsive polish"
```

- [ ] **Step 7: Push the branch**

```bash
git push -u origin HEAD
```

---

## Self-Review Notes

**Spec coverage:**
- Customer pages (home, list, detail, auth, account, payment): Tasks 11–15 ✓
- Admin layout (sidebar drawer): Tasks 2–3 ✓
- Admin tables (5 pages): Tasks 5–8 ✓
- Admin dashboard / settings: Tasks 9–10 ✓
- Final QA: Task 16 ✓

**Type consistency:** `Column<T>` interface defined in Task 4 is reused with the same shape (`header`, `cell`, `className`, `hideOnCard`, `primary`) across Tasks 5–8. `ResponsiveTable` props (`rows`, `columns`, `rowKey`, `loading`, `emptyText`, `cardActions`) are consistent.

**Known follow-ups (not in scope):**
- E2E tests with Playwright at multiple viewports
- A11y audit (focus trap on drawer, ARIA on dropdown)
- Print styles for admin orders export
