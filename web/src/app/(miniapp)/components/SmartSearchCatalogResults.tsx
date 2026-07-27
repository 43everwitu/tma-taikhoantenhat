'use client'

import { t } from '@/i18n/vi'
import { Icon } from './Icon'
import { ProductCard, type ProductSummary } from './ProductCard'

interface Props {
  results: ProductSummary[]
  suggestions: ProductSummary[]
  isLoading: boolean
}

function ProductGrid({ products, eager }: { products: ProductSummary[]; eager?: boolean }) {
  return (
    <ul className="miniapp-product-grid">
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard p={product} eager={!!eager && index === 0} showMatchLabel />
        </li>
      ))}
    </ul>
  )
}

export function SmartSearchCatalogResults({ results, suggestions, isLoading }: Props) {
  if (isLoading) {
    return <p className="opacity-60 text-sm">{t.catalog.searchLoading}</p>
  }

  if (results.length === 0 && suggestions.length === 0) {
    return (
      <div className="text-center py-12 opacity-60">
        <div
          className="mb-2 inline-flex p-3 rounded-full"
          style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-gold-deep)' }}
        >
          <Icon name="search" size={28} />
        </div>
        <p className="text-sm">{t.catalog.searchNoResults}</p>
      </div>
    )
  }

  return (
    <div className="space-y-7">
      {results.length > 0 && <ProductGrid products={results} eager />}
      {suggestions.length > 0 && (
        <section>
          <div className="miniapp-section-title">
            <span>{t.catalog.searchSuggestions}</span>
            <span className="text-xs font-normal opacity-55">{suggestions.length}</span>
          </div>
          <ProductGrid products={suggestions} />
        </section>
      )}
    </div>
  )
}
