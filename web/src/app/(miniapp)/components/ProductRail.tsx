'use client'

import { useState } from 'react'
import { ProductCard, type ProductSummary } from './ProductCard'
import { Icon } from './Icon'

interface Props {
  items: ProductSummary[]
}

// Page size = 10 (5 cols × 2 rows on desktop; mobile shows 4 visible due to
// grid-cols-2 but pagination is consistent — user can see the rest by paging).
const PAGE_SIZE = 10

export function ProductRail({ items }: Props) {
  const [page, setPage] = useState(0)
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const slice = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <>
      <ul className="miniapp-product-grid miniapp-product-grid--rail">
        {slice.map((p) => (
          <li key={p.id}><ProductCard p={p} /></li>
        ))}
      </ul>
      {totalPages > 1 && (
        <nav className="miniapp-pager" aria-label="Phân trang">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label="Trang trước"
          >
            <Icon name="arrowRight" size={14} className="rotate-180" />
          </button>
          <span className="miniapp-pager-page">{page + 1} / {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            aria-label="Trang sau"
          >
            <Icon name="arrowRight" size={14} />
          </button>
        </nav>
      )}
    </>
  )
}
