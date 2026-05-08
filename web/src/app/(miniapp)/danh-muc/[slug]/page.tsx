'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from '../../components/MiniAppShell'
import { ProductCard, ProductSummary } from '../../components/ProductCard'
import { t } from '@/i18n/vi'

export default function CategoryPage() {
  const params = useParams<{ slug: string }>()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('default')

  const products = useQuery({
    queryKey: ['products', params.slug, q, sort],
    queryFn: () => apiFetch<ProductSummary[]>(
      `/products?category=${encodeURIComponent(params.slug)}&q=${encodeURIComponent(q)}&sort=${sort}`
    ),
  })

  return (
    <MiniAppShell title={t.appName}>
      <div className="mb-3 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.catalog.searchPlaceholder}
          className="flex-1 rounded-md px-3 py-2"
          style={{ background: 'var(--tg-bg-2)' }}
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-md px-2"
          style={{ background: 'var(--tg-bg-2)' }}
        >
          <option value="default">{t.catalog.sortDefault}</option>
          <option value="price_asc">{t.catalog.sortPriceAsc}</option>
          <option value="price_desc">{t.catalog.sortPriceDesc}</option>
          <option value="newest">{t.catalog.sortNewest}</option>
        </select>
      </div>

      {products.isLoading && <p className="opacity-60">…</p>}
      {products.data && products.data.length === 0 && (
        <p className="opacity-60">{t.catalog.empty}</p>
      )}
      {products.data && products.data.length > 0 && (
        <ul className="grid grid-cols-2 gap-3">
          {products.data.map((p) => (
            <li key={p.id}><ProductCard p={p} /></li>
          ))}
        </ul>
      )}
    </MiniAppShell>
  )
}
