'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from '../components/MiniAppShell'
import { ProductCard, ProductSummary } from '../components/ProductCard'
import { Icon } from '../components/Icon'
import { t } from '@/i18n/vi'

interface Category { id: number; name: string; slug: string; emoji: string }

export default function AllProductsPage() {
  const [q, setQ] = useState('')
  const [activeSlug, setActiveSlug] = useState<string | ''>('')

  const cats = useQuery({
    queryKey: ['categories', 'noUncat'],
    queryFn: () => apiFetch<Category[]>('/categories?exclude=uncategorized'),
  })

  const products = useQuery({
    queryKey: ['products', 'all', activeSlug, q],
    queryFn: () => apiFetch<ProductSummary[]>(
      `/products?category=${encodeURIComponent(activeSlug)}&q=${encodeURIComponent(q)}`,
    ),
  })

  return (
    <MiniAppShell title="Tất cả sản phẩm" subtitle={products.data ? `${products.data.length} sản phẩm` : undefined}>
      <div className="miniapp-search">
        <span className="opacity-60 flex"><Icon name="search" size={18} /></span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.catalog.searchPlaceholder}
        />
      </div>

      <div className="miniapp-chip-row">
        <button
          type="button"
          className="miniapp-chip"
          aria-pressed={activeSlug === ''}
          onClick={() => setActiveSlug('')}
        >
          Tất cả
        </button>
        {cats.data?.map((c) => (
          <button
            key={c.id}
            type="button"
            className="miniapp-chip"
            aria-pressed={activeSlug === c.slug}
            onClick={() => setActiveSlug(c.slug)}
          >
            {c.name}
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
