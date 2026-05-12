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
    select: (rows) => rows.slice(0, 14),
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
