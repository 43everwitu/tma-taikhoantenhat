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
  priceMin?: number
  priceMax?: number
  salePrice?: number
  salePriceMin?: number
  salePriceMax?: number
  discountLabel?: string
  stock: number
  promotion?: string | null
}

export function ProductCard({ p, eager = false }: { p: ProductSummary; eager?: boolean }) {
  const [quickOpen, setQuickOpen] = useState(false)
  const inStock = p.stock > 0
  const priceMin = p.priceMin ?? p.price
  const priceMax = p.priceMax ?? p.price
  const salePriceMin = p.salePriceMin ?? p.salePrice ?? priceMin
  const salePriceMax = p.salePriceMax ?? p.salePrice ?? priceMax
  const hasRange = priceMin !== priceMax
  const hasDiscount = hasRange
    ? salePriceMin < priceMin || salePriceMax < priceMax
    : typeof p.salePrice === 'number' && p.salePrice < p.price

  return (
    <>
      <Link href={`/san-pham/${p.slug}`} className="miniapp-product-card">
        <div className="miniapp-product-img" style={{ position: 'relative' }}>
          {(p.discountLabel || p.promotion) && <span className="miniapp-product-badge">{p.discountLabel || p.promotion}</span>}
          {p.imageUrl ? (
            <Image
              src={p.imageUrl}
              alt={p.name}
              fill
              sizes="(min-width: 1024px) 20vw, (min-width: 768px) 25vw, (min-width: 480px) 33vw, 50vw"
              style={{ objectFit: 'cover' }}
              priority={eager}
              loading={eager ? undefined : 'lazy'}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center" style={{ color: 'var(--brand-gold-deep)' }}>
              <Icon name="package" size={44} strokeWidth={1.25} />
            </div>
          )}
        </div>
        <div className="miniapp-product-info">
          <p className="miniapp-product-name">{p.name}</p>
          <p className="miniapp-product-price">
            {hasRange
              ? `${formatPrice(hasDiscount ? salePriceMin : priceMin)} - ${formatPrice(hasDiscount ? salePriceMax : priceMax)}`
              : hasDiscount ? formatPrice(p.salePrice!) : formatPrice(p.price)}
          </p>
          {hasDiscount && (
            <p className="text-[11px] opacity-50 line-through -mt-1">
              {hasRange
                ? `${formatPrice(priceMin)} - ${formatPrice(priceMax)}`
                : formatPrice(p.price)}
            </p>
          )}
          <p className={`miniapp-product-stock ${inStock ? 'in' : 'out'}`}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor', display: 'inline-block' }} />
            {inStock ? `Còn ${p.stock}` : 'Hết hàng'}
          </p>
          {inStock && (
            <button
              type="button"
              aria-label="Mua nhanh"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setQuickOpen(true) }}
              className="miniapp-product-quickbuy"
            >
              <Icon name="zap" size={14} />
              <span>Mua nhanh</span>
            </button>
          )}
        </div>
      </Link>
      {quickOpen && <VariantQuickBuy slug={p.slug} onClose={() => setQuickOpen(false)} />}
    </>
  )
}
