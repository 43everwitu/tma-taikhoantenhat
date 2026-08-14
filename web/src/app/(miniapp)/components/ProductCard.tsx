'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { MouseEvent } from 'react'
import { useState } from 'react'
import { Icon } from './Icon'
import { MiniAppProductImage } from './MiniAppProductImage'
import { getProductDisplayPrice } from '@/lib/productPriceDisplay'
import { resolveContactUrl } from '@/lib/contactUrl'
import { getProductStockMode } from '@/lib/productStockDisplay'
import { t } from '@/i18n/vi'

const VariantQuickBuy = dynamic(
  () => import('./VariantQuickBuy').then((mod) => mod.VariantQuickBuy),
  { ssr: false }
)

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
  hasBackorder?: boolean
  promotion?: string | null
  contactOnly?: boolean
  contactUrl?: string | null
  matchLabel?: string
}

export function ProductCard({
  p,
  eager = false,
  showMatchLabel = false,
}: {
  p: ProductSummary
  eager?: boolean
  showMatchLabel?: boolean
}) {
  const [quickOpen, setQuickOpen] = useState(false)
  const isContactOnly = !!p.contactOnly
  const stockMode = getProductStockMode({
    stock: p.stock,
    isBackorder: p.hasBackorder,
    contactOnly: isContactOnly,
  })
  const inStock = stockMode === 'stock' || stockMode === 'backorder'
  const displayPrice = getProductDisplayPrice(p)
  const stockLabel = stockMode === 'contact'
    ? t.product.contactOnly
    : stockMode === 'stock'
      ? `Còn ${p.stock}`
      : stockMode === 'backorder'
        ? '∞'
        : t.product.outOfStock

  function openContact(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault()
    e.stopPropagation()
    window.open(resolveContactUrl(p.contactUrl), '_blank', 'noopener,noreferrer')
  }

  return (
    <>
      <Link href={`/san-pham/${p.slug}`} className="miniapp-product-card">
        <div className="miniapp-product-img" style={{ position: 'relative' }}>
          {(p.discountLabel || p.promotion) && <span className="miniapp-product-badge">{p.discountLabel || p.promotion}</span>}
          <MiniAppProductImage src={p.imageUrl} alt={p.name} priority={eager} />
        </div>
        <div className="miniapp-product-info">
          <p className="miniapp-product-name">{p.name}</p>
          {showMatchLabel && (
            <p className="text-[11px] opacity-55 line-clamp-1">{p.matchLabel || '\u00a0'}</p>
          )}
          <p className={`miniapp-product-price${displayPrice.hasRange ? ' is-range' : ''}`}>
            <span className="miniapp-price-num">{displayPrice.current}</span>
          </p>
          <p className={`miniapp-product-price-old${displayPrice.hasDiscount ? '' : ' is-empty'}`} aria-hidden={!displayPrice.hasDiscount}>
            {displayPrice.original || '\u00a0'}
          </p>
          <p className={`miniapp-product-stock ${isContactOnly || inStock ? 'in' : 'out'}`}>
            <span className="miniapp-product-stock-dot" />
            {stockLabel}
          </p>
          <div className="miniapp-product-actions">
            {isContactOnly ? (
              <button
                type="button"
                aria-label={t.product.contactOnly}
                onClick={openContact}
                className="miniapp-product-quickbuy"
              >
                <Icon name="support" size={14} />
                <span>Liên hệ</span>
              </button>
            ) : inStock && (
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
        </div>
      </Link>
      {quickOpen && <VariantQuickBuy slug={p.slug} onClose={() => setQuickOpen(false)} />}
    </>
  )
}
