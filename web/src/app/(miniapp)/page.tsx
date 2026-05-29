'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from './components/MiniAppShell'
import { ProductSummary } from './components/ProductCard'
import { ProductRail } from './components/ProductRail'
import { SearchBox } from './components/SearchBox'
import { CategoryStrip } from './components/CategoryStrip'
import { AnnouncementCarousel } from './components/AnnouncementCarousel'
import { Icon } from './components/Icon'
import { DiscountCodeMeta, type DiscountMetaMode } from './components/DiscountCodeMeta'
import { getRecentlyViewedIds } from '@/lib/recentlyViewed'
import { t } from '@/i18n/vi'

interface Announcement { id: string; title: string; body: string; pinned: boolean; createdAt: string }
interface Category { id: number; name: string; slug: string; emoji: string }
interface GlobalDiscount {
  code: string
  label: string
  title?: string
  appMetaMode?: DiscountMetaMode
  appMetaText?: string
  appMessage?: string
}

export default function MiniAppHome() {
  const [recentIds] = useState<string[]>(() => getRecentlyViewedIds())
  const [q, setQ] = useState('')
  const [copiedGlobalCode, setCopiedGlobalCode] = useState(false)

  const ann = useQuery({
    queryKey: ['announcements'],
    queryFn: () => apiFetch<Announcement[]>('/announcements'),
  })
  const globalDiscount = useQuery({
    queryKey: ['discounts', 'global'],
    queryFn: () => apiFetch<GlobalDiscount | null>('/discounts/global'),
    staleTime: 60_000,
  })
  const cats = useQuery({
    queryKey: ['categories', 'noUncat'],
    queryFn: () => apiFetch<Category[]>('/categories?exclude=uncategorized'),
  })
  const featured = useQuery({
    queryKey: ['products', 'featured'],
    queryFn: () => apiFetch<ProductSummary[]>('/products/featured'),
  })
  const newest = useQuery({
    queryKey: ['products', 'newest', 30],
    queryFn: () => apiFetch<ProductSummary[]>('/products?sort=newest&limit=30'),
    select: (rows) => rows.slice(0, 30),
  })
  const recently = useQuery({
    queryKey: ['products', 'recently', recentIds.join(',')],
    queryFn: () => apiFetch<ProductSummary[]>(`/products?ids=${recentIds.join(',')}`),
    enabled: recentIds.length > 0,
  })
  const activeGlobalDiscount = globalDiscount.data

  async function copyGlobalDiscountCode(code: string) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(code)
      setCopiedGlobalCode(true)
      setTimeout(() => setCopiedGlobalCode(false), 1500)
    } catch {
      // No-op: clipboard can fail on unsupported clients.
    }
  }

  return (
    <MiniAppShell>
      <section className="miniapp-hero">
        <p className="text-xs uppercase tracking-wider opacity-70 mb-2">{t.appName}</p>
        <h1>Mua hàng tự động</h1>
        <p>Mua trong Mini App Telegram. Giao key tự động - Bảo hành toàn thời hạn.</p>
        <Link href="/san-pham" className="miniapp-hero-cta">
          Khám phá ngay
          <Icon name="arrowRight" size={16} />
        </Link>
      </section>

      {activeGlobalDiscount && (
        <section className="rounded-2xl p-3 mt-3 text-sm" style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-ink)' }}>
          <p className="font-semibold leading-snug">
            {activeGlobalDiscount.title || `${activeGlobalDiscount.label} tự động`}
          </p>
          <DiscountCodeMeta
            code={activeGlobalDiscount.code}
            label={activeGlobalDiscount.label}
            mode={activeGlobalDiscount.appMetaMode}
            text={activeGlobalDiscount.appMetaText}
            copied={copiedGlobalCode}
            onCopy={() => copyGlobalDiscountCode(activeGlobalDiscount.code)}
          />
          {activeGlobalDiscount.appMessage && <p className="text-xs opacity-75 mt-1 leading-relaxed">{activeGlobalDiscount.appMessage}</p>}
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
          <CategoryStrip items={cats.data} />
        )}
      </section>

      <div className="mb-3 mt-2">
        <SearchBox value={q} onChange={setQ} placeholder="Tìm sản phẩm…" />
      </div>

      {ann.data && ann.data.length > 0 && (
        <section className="miniapp-section miniapp-section--compact miniapp-home-notifications">
          <div className="miniapp-section-title">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="megaphone" size={16} />
              {t.home.announcementsTitle}
            </span>
          </div>
          <AnnouncementCarousel items={ann.data} />
        </section>
      )}

      {recently.data && recently.data.length > 0 && (
        <section className="miniapp-section miniapp-section--compact miniapp-home-recent">
          <div className="miniapp-section-title">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="clock" size={16} />
              Sản phẩm đã xem
            </span>
          </div>
          <ProductRail items={recently.data} />
        </section>
      )}

      {featured.data && featured.data.length > 0 && (
        <section className="miniapp-section">
          <div className="miniapp-section-title">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="sparkles" size={16} />
              Sản phẩm nổi bật
            </span>
            <Link href="/san-pham" className="inline-flex items-center gap-1">
              Tất cả <Icon name="arrowRight" size={14} />
            </Link>
          </div>
          <ProductRail items={featured.data} />
        </section>
      )}

      {newest.data && newest.data.length > 0 && (
        <section className="miniapp-section">
          <div className="miniapp-section-title">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="sparkles" size={16} />
              Sản phẩm mới
            </span>
            <Link href="/san-pham" className="inline-flex items-center gap-1">
              Tất cả <Icon name="arrowRight" size={14} />
            </Link>
          </div>
          <ProductRail items={newest.data} />
        </section>
      )}
    </MiniAppShell>
  )
}
