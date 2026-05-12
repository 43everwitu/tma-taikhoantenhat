'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import { apiFetch } from '@/lib/miniappApi'
import { useCart } from '@/lib/cart'
import { MiniAppShell } from '../../components/MiniAppShell'
import { Icon } from '../../components/Icon'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'

interface ProductBase {
  id: string; slug: string; name: string; emoji: string; imageUrl?: string
  price: number; stock: number; contactOnly: boolean; contactUrl?: string
  promotion?: string | null
}
interface ProductDetail extends ProductBase {
  longDescription: string; description: string
}

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const cart = useCart()
  const [qty, setQty] = useState(1)

  const { data: p, isLoading } = useQuery({
    queryKey: ['product', slug],
    queryFn: () => apiFetch<ProductDetail>(`/products/${slug}`),
  })

  if (isLoading) return <MiniAppShell><p className="opacity-60 text-sm">Đang tải…</p></MiniAppShell>
  if (!p) return <MiniAppShell><p>Không tìm thấy sản phẩm.</p></MiniAppShell>

  const disabled = p.stock <= 0 || p.contactOnly
  const addToCart = () => {
    for (let i = 0; i < qty; i++) {
      cart.add({ id: p.id, slug: p.slug, name: p.name, price: p.price, emoji: p.emoji, imageUrl: p.imageUrl })
    }
  }

  return (
    <MiniAppShell title={p.name} hasBottombar>
      <div className="md:grid md:grid-cols-2 md:gap-8 md:items-start">
        <div className="rounded-2xl overflow-hidden mb-4 md:mb-0 md:sticky md:top-20" style={{ background: 'var(--brand-gold-soft)' }}>
          <div className="aspect-square" style={{ position: 'relative' }}>
            {p.promotion && <span className="miniapp-product-badge" style={{ top: 12, left: 12 }}>{p.promotion}</span>}
            {p.imageUrl
              ? <Image src={p.imageUrl} alt={p.name} fill sizes="100vw" style={{ objectFit: 'cover' }} />
              : <div className="absolute inset-0 grid place-items-center" style={{ color: 'var(--brand-gold-deep)' }}>
                  <Icon name="package" size={88} strokeWidth={1.25} />
                </div>}
          </div>
        </div>

        <div>
          <div className="flex items-end justify-between mb-2">
            <div>
              <p className="text-2xl font-bold tracking-tight">{formatPrice(p.price)}</p>
              <p className="text-xs mt-1">
                {p.stock > 0
                  ? <span style={{ color: '#16a34a' }}>● {t.product.inStock.replace('{n}', String(p.stock))}</span>
                  : <span style={{ color: '#dc2626' }}>● {t.product.outOfStock}</span>}
              </p>
            </div>
            {!disabled && (
              <div className="inline-flex items-center gap-1 rounded-full p-1" style={{ background: 'var(--tg-bg-2)' }}>
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="w-7 h-7 grid place-items-center rounded-full"
                  style={{ background: 'var(--tg-bg)' }}
                  aria-label="Giảm số lượng"
                ><Icon name="minus" size={14} /></button>
                <span className="w-6 text-center text-sm font-semibold">{qty}</span>
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.min(p.stock || 99, q + 1))}
                  className="w-7 h-7 grid place-items-center rounded-full"
                  style={{ background: 'var(--tg-bg)' }}
                  aria-label="Tăng số lượng"
                ><Icon name="plus" size={14} /></button>
              </div>
            )}
          </div>

          {p.description && (
            <p className="mb-3 whitespace-pre-line text-[0.9375rem] leading-relaxed">{p.description}</p>
          )}

          {p.longDescription && (
            <details className="mb-4 rounded-xl p-3" style={{ background: 'var(--tg-bg-2)' }}>
              <summary className="cursor-pointer font-medium text-sm">Chi tiết sản phẩm</summary>
              <div className="mt-2 whitespace-pre-line text-sm opacity-90">{p.longDescription}</div>
            </details>
          )}
        </div>
      </div>

      <div className="miniapp-bottombar">
        <button
          type="button"
          onClick={addToCart}
          disabled={disabled}
          className="miniapp-btn miniapp-btn--ghost"
        >
          <Icon name="cart" size={18} /> {t.product.addToCart}
        </button>
        <button
          type="button"
          onClick={() => { addToCart(); router.push('/dat-hang') }}
          disabled={disabled}
          className="miniapp-btn miniapp-btn--primary"
        >
          <Icon name="zap" size={18} /> {t.product.buyNow}
        </button>
      </div>
    </MiniAppShell>
  )
}
