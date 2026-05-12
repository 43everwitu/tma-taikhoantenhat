'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from '../components/MiniAppShell'
import { ProductCard, ProductSummary } from '../components/ProductCard'
import { SearchBox } from '../components/SearchBox'
import { FilterBar, type FilterValue } from '../components/FilterBar'
import { Icon } from '../components/Icon'
import { t } from '@/i18n/vi'

interface Category { id: number; name: string; slug: string; emoji: string }

const DEFAULT_FILTER: FilterValue = { sort: 'default', priceMin: '', priceMax: '' }

export default function AllProductsPage() {
  const [q, setQ] = useState('')
  const [activeSlug, setActiveSlug] = useState<string | ''>('')
  const [filter, setFilter] = useState<FilterValue>(DEFAULT_FILTER)

  const cats = useQuery({
    queryKey: ['categories', 'noUncat'],
    queryFn: () => apiFetch<Category[]>('/categories?exclude=uncategorized'),
  })

  const queryString = useMemo(() => {
    const p = new URLSearchParams()
    if (activeSlug) p.set('category', activeSlug)
    if (q.trim()) p.set('q', q.trim())
    if (filter.sort !== 'default') p.set('sort', filter.sort)
    if (filter.priceMin !== '') p.set('priceMin', String(filter.priceMin))
    if (filter.priceMax !== '') p.set('priceMax', String(filter.priceMax))
    return p.toString()
  }, [activeSlug, q, filter])

  const products = useQuery({
    queryKey: ['products', 'all', queryString],
    queryFn: () => apiFetch<ProductSummary[]>(`/products?${queryString}`),
  })

  return (
    <MiniAppShell title="Tất cả sản phẩm" subtitle={products.data ? `${products.data.length} sản phẩm` : undefined}>
      <SearchBox value={q} onChange={setQ} placeholder={t.catalog.searchPlaceholder} />

      <div className="miniapp-chip-row">
        <button
          type="button"
          className="miniapp-chip"
          aria-pressed={activeSlug === ''}
          onClick={() => setActiveSlug('')}
        >Tất cả</button>
        {cats.data?.map((c) => (
          <button
            key={c.id}
            type="button"
            className="miniapp-chip"
            aria-pressed={activeSlug === c.slug}
            onClick={() => setActiveSlug(c.slug)}
          >{c.name}</button>
        ))}
      </div>

      <FilterBar value={filter} onChange={setFilter} />

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
