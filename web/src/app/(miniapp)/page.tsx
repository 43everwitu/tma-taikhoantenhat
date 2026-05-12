'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from './components/MiniAppShell'
import { ProductSummary } from './components/ProductCard'
import { ProductRail } from './components/ProductRail'
import { SearchBox } from './components/SearchBox'
import { Icon } from './components/Icon'
import { categoryIcons } from '@/lib/miniappIcons'
import { getRecentlyViewedIds } from '@/lib/recentlyViewed'
import { t } from '@/i18n/vi'

interface Announcement { id: string; title: string; body: string; pinned: boolean }
interface Category { id: number; name: string; slug: string; emoji: string }

export default function MiniAppHome() {
  const [recentIds, setRecentIds] = useState<string[]>([])
  const [q, setQ] = useState('')

  useEffect(() => {
    setRecentIds(getRecentlyViewedIds())
  }, [])

  const ann = useQuery({
    queryKey: ['announcements'],
    queryFn: () => apiFetch<Announcement[]>('/announcements'),
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

  return (
    <MiniAppShell>
      <div className="mb-3">
        <SearchBox value={q} onChange={setQ} placeholder="Tìm sản phẩm…" />
      </div>
      <section className="miniapp-hero">
        <p className="text-xs uppercase tracking-wider opacity-70 mb-2">{t.appName}</p>
        <h1>Tài khoản số chính chủ</h1>
        <p>Mua trong Telegram. Giao key tự động. Bảo hành dài hạn.</p>
        <Link href="/san-pham" className="miniapp-hero-cta">
          Khám phá ngay
          <Icon name="arrowRight" size={16} />
        </Link>
      </section>

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

      {recently.data && recently.data.length > 0 && (
        <section className="miniapp-section">
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
