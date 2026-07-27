'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from '../../components/MiniAppShell'
import { ProductCard, ProductSummary } from '../../components/ProductCard'
import { SearchBox } from '../../components/SearchBox'
import { FilterBar, type FilterValue } from '../../components/FilterBar'
import { Icon } from '../../components/Icon'
import { SmartSearchCatalogResults } from '../../components/SmartSearchCatalogResults'
import {
  buildSmartSearchPath,
  isSmartSearchQuery,
  type SmartSearchResponse,
} from '@/lib/smartProductSearch'
import { t } from '@/i18n/vi'

interface Category { id: number; name: string; slug: string; emoji: string }

const DEFAULT_FILTER: FilterValue = { sort: 'default', priceMin: '', priceMax: '' }

export default function CategoryPage() {
  const params = useParams<{ slug: string }>()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<FilterValue>(DEFAULT_FILTER)

  const cats = useQuery({
    queryKey: ['categories', 'noUncat'],
    queryFn: () => apiFetch<Category[]>('/categories?exclude=uncategorized'),
  })
  const cat = cats.data?.find((c) => c.slug === params.slug)

  const queryString = useMemo(() => {
    const p = new URLSearchParams()
    p.set('category', params.slug)
    if (filter.sort !== 'default') p.set('sort', filter.sort)
    if (filter.priceMin !== '') p.set('priceMin', String(filter.priceMin))
    if (filter.priceMax !== '') p.set('priceMax', String(filter.priceMax))
    return p.toString()
  }, [params.slug, filter])

  const smartSearchActive = isSmartSearchQuery(q)
  const products = useQuery({
    queryKey: ['products', params.slug, queryString],
    queryFn: () => apiFetch<ProductSummary[]>(`/products?${queryString}`),
    enabled: !smartSearchActive,
  })
  const smartProducts = useQuery({
    queryKey: ['products', 'smart-search', params.slug, q.trim(), queryString],
    queryFn: () => apiFetch<SmartSearchResponse<ProductSummary>>(
      buildSmartSearchPath(q, {
        category: params.slug,
        sort: filter.sort,
        priceMin: filter.priceMin,
        priceMax: filter.priceMax,
        limit: 100,
        suggestionLimit: 20,
      }),
    ),
    enabled: smartSearchActive,
  })
  const productCount = smartSearchActive
    ? smartProducts.data && (smartProducts.data.total || smartProducts.data.suggestions.length)
    : products.data?.length

  return (
    <MiniAppShell
      title={cat?.name || 'Danh mục'}
      subtitle={productCount !== undefined ? `${productCount} sản phẩm` : undefined}
    >
      <SearchBox
        value={q}
        onChange={setQ}
        placeholder={t.catalog.searchPlaceholder}
        category={params.slug}
      />
      <FilterBar value={filter} onChange={setFilter} />

      <div className="miniapp-section">
        {smartSearchActive ? (
          <SmartSearchCatalogResults
            results={smartProducts.data?.results ?? []}
            suggestions={smartProducts.data?.suggestions ?? []}
            isLoading={smartProducts.isLoading}
          />
        ) : (
          <>
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
            {products.data.map((p, i) => (
              <li key={p.id}><ProductCard p={p} eager={i === 0} /></li>
            ))}
          </ul>
          )}
          </>
        )}
      </div>
    </MiniAppShell>
  )
}
