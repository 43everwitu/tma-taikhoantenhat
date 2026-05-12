'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from '../../components/MiniAppShell'
import { ProductCard, ProductSummary } from '../../components/ProductCard'
import { Icon } from '../../components/Icon'
import { t } from '@/i18n/vi'

interface Category { id: number; name: string; slug: string; emoji: string }

const SORTS = [
  { key: 'default',    label: t.catalog.sortDefault },
  { key: 'price_asc',  label: t.catalog.sortPriceAsc },
  { key: 'price_desc', label: t.catalog.sortPriceDesc },
  { key: 'newest',     label: t.catalog.sortNewest },
] as const

export default function CategoryPage() {
  const params = useParams<{ slug: string }>()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<typeof SORTS[number]['key']>('default')

  const cats = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<Category[]>('/categories'),
  })
  const cat = cats.data?.find((c) => c.slug === params.slug)

  const products = useQuery({
    queryKey: ['products', params.slug, q, sort],
    queryFn: () =>
      apiFetch<ProductSummary[]>(
        `/products?category=${encodeURIComponent(params.slug)}&q=${encodeURIComponent(q)}&sort=${sort}`,
      ),
  })

  return (
    <MiniAppShell
      title={cat?.name || 'Danh mục'}
      subtitle={products.data ? `${products.data.length} sản phẩm` : undefined}
    >
      <div className="miniapp-search">
        <span className="opacity-60 flex"><Icon name="search" size={18} /></span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.catalog.searchPlaceholder}
        />
      </div>

      <div className="miniapp-chip-row">
        {SORTS.map((s) => (
          <button
            key={s.key}
            type="button"
            className="miniapp-chip"
            aria-pressed={sort === s.key}
            onClick={() => setSort(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="miniapp-section">
        {products.isLoading && <p className="opacity-60 text-sm">Đang tải…</p>}
        {products.data && products.data.length === 0 && (
          <div className="text-center py-12 opacity-60">
            <div className="mb-2 inline-flex p-3 rounded-full" style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-gold-deep)' }}>
              <Icon name="search" size={28} />
            </div>
            <p className="text-sm">{t.catalog.empty}</p>
          </div>
        )}
        {products.data && products.data.length > 0 && (
          <ul className="miniapp-product-grid">
            {products.data.map((p) => (
              <li key={p.id}><ProductCard p={p} /></li>
            ))}
          </ul>
        )}
      </div>
    </MiniAppShell>
  )
}
