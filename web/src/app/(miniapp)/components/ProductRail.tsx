'use client'

import { ProductCard, type ProductSummary } from './ProductCard'
import { HScroll } from './HScroll'

interface Props {
  items: ProductSummary[]
}

export function ProductRail({ items }: Props) {
  if (items.length === 0) return null
  return (
    <HScroll ariaLabel="Danh sách sản phẩm">
      {items.map((p) => (
        <div key={p.id} className="miniapp-rail-cell">
          <ProductCard p={p} />
        </div>
      ))}
    </HScroll>
  )
}
