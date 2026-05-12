'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import { Icon } from './Icon'
import { VariantQuickBuy } from './VariantQuickBuy'
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
  const [quickOpen, setQuickOpen] = useState(false)
  const inStock = p.stock > 0

  return (
    <>
      <Link href={`/san-pham/${p.slug}`} className="miniapp-product-card">
        <div className="miniapp-product-img" style={{ position: 'relative' }}>
          {p.promotion && <span className="miniapp-product-badge">{p.promotion}</span>}
          {p.imageUrl ? (
            <Image
              src={p.imageUrl}
              alt={p.name}
              fill
              sizes="(min-width: 1536px) 14vw, (min-width: 1280px) 17vw, (min-width: 1024px) 20vw, (min-width: 768px) 25vw, (min-width: 480px) 33vw, 50vw"
              style={{ objectFit: 'cover' }}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center" style={{ color: 'var(--brand-gold-deep)' }}>
              <Icon name="package" size={44} strokeWidth={1.25} />
            </div>
          )}
          {inStock && (
            <button
              type="button"
              aria-label="Thêm nhanh vào giỏ"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setQuickOpen(true) }}
              className="absolute bottom-2 right-2 w-8 h-8 grid place-items-center rounded-full"
              style={{ background: 'var(--brand-gold)', color: 'var(--brand-ink)', boxShadow: '0 2px 6px rgba(0,0,0,.18)' }}
            >
              <Icon name="plus" size={16} />
            </button>
          )}
        </div>
        <div className="miniapp-product-info">
          <p className="miniapp-product-name">{p.name}</p>
          <p className="miniapp-product-price">{formatPrice(p.price)}</p>
          <p className={`miniapp-product-stock ${inStock ? 'in' : 'out'}`}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor', display: 'inline-block' }} />
            {inStock ? `Còn ${p.stock}` : 'Hết hàng'}
          </p>
        </div>
      </Link>
      {quickOpen && <VariantQuickBuy slug={p.slug} onClose={() => setQuickOpen(false)} />}
    </>
  )
}
