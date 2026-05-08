'use client'

import Link from 'next/link'
import Image from 'next/image'
import { formatPrice } from '@/lib/utils'

export interface ProductSummary {
  id: string
  slug: string
  name: string
  emoji: string
  imageUrl?: string
  price: number
  stock: number
  promotion?: string | null
}

export function ProductCard({ p }: { p: ProductSummary }) {
  const inStock = p.stock > 0
  return (
    <Link href={`/san-pham/${p.slug}`} className="miniapp-product-card">
      <div className="miniapp-product-img" style={{ position: 'relative' }}>
        {p.promotion && <span className="miniapp-product-badge">{p.promotion}</span>}
        {p.imageUrl ? (
          <Image
            src={p.imageUrl}
            alt={p.name}
            fill
            sizes="(max-width: 768px) 50vw, 240px"
            style={{ objectFit: 'cover' }}
          />
        ) : (
          <div className="miniapp-product-emoji">{p.emoji || '📦'}</div>
        )}
      </div>
      <div className="miniapp-product-info">
        <p className="miniapp-product-name">{p.name}</p>
        <p className="miniapp-product-price">{formatPrice(p.price)}</p>
        <p className={`miniapp-product-stock ${inStock ? 'in' : 'out'}`}>
          <span style={{
            width: 6, height: 6, borderRadius: 999,
            background: 'currentColor', display: 'inline-block',
          }} />
          {inStock ? `Còn ${p.stock}` : 'Hết hàng'}
        </p>
      </div>
    </Link>
  )
}
