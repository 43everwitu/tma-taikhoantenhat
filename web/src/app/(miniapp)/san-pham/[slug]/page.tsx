'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import { apiFetch } from '@/lib/miniappApi'
import { useCart } from '@/lib/cart'
import { pushRecentlyViewed, getRecentlyViewedIds } from '@/lib/recentlyViewed'
import { MiniAppShell } from '../../components/MiniAppShell'
import { Icon } from '../../components/Icon'
import { DiscountCodeMeta, type DiscountMetaMode } from '../../components/DiscountCodeMeta'
import { VariantPicker, type Variant } from '../../components/VariantPicker'
import { ProductRail } from '../../components/ProductRail'
import type { ProductSummary } from '../../components/ProductCard'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'

interface ProductBase {
  id: string; slug: string; name: string; emoji: string; imageUrl?: string
  price: number; stock: number; contactOnly: boolean; contactUrl?: string
  priceMin?: number; priceMax?: number
  salePrice?: number; discountLabel?: string
  salePriceMin?: number; salePriceMax?: number
  promotion?: string | null
  categorySlug?: string
}
interface ProductDetail extends ProductBase {
  longDescription: string; description: string
  variants?: Variant[]
  globalDiscount?: {
    code: string
    label: string
    title?: string
    appMetaMode?: DiscountMetaMode
    appMetaText?: string
    appMessage?: string
    salePrice?: number
    discountAmount?: number
  } | null
}

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const cart = useCart()
  const [qty, setQty] = useState(1)
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const [copiedGlobalCode, setCopiedGlobalCode] = useState(false)

  const { data: p, isLoading } = useQuery({
    queryKey: ['product', slug],
    queryFn: () => apiFetch<ProductDetail>(`/products/${slug}`),
  })

  const related = useQuery({
    queryKey: ['products', 'related', p?.categorySlug, p?.id],
    queryFn: () => apiFetch<ProductSummary[]>(`/products?category=${encodeURIComponent(p!.categorySlug!)}&limit=12`),
    enabled: !!p?.categorySlug && !!p?.id,
    select: (rows) => rows.filter((r) => r.id !== p?.id).slice(0, 10),
  })

  // Snapshot recently-viewed BEFORE pushing the current id so the rail
  // doesn't include this page. Single effect = no waterfall.
  const recentIds = useMemo(() => {
    if (!p?.id) return []
    const id = String(p.id)
    return getRecentlyViewedIds().filter((x) => x !== id)
  }, [p?.id])
  useEffect(() => {
    if (!p?.id) return
    pushRecentlyViewed(String(p.id))
  }, [p?.id])

  const recently = useQuery({
    queryKey: ['products', 'recently-detail', recentIds.join(',')],
    queryFn: () => apiFetch<ProductSummary[]>(`/products?ids=${recentIds.join(',')}`),
    enabled: recentIds.length > 0,
  })

  if (isLoading) return <MiniAppShell><p className="opacity-60 text-sm">Đang tải…</p></MiniAppShell>
  if (!p) return <MiniAppShell><p>Không tìm thấy sản phẩm.</p></MiniAppShell>

  const variants = p?.variants ?? []
  const defaultVariantId = variants.length > 0
    ? (variants.find((v) => v.stock > 0)?.id ?? variants[0].id)
    : null
  const selected = variants.find((v) => v.id === selectedVariantId) ?? variants.find((v) => v.id === defaultVariantId) ?? null
  const effectiveImage = (selected?.imageUrl && selected.imageUrl.length > 0) ? selected.imageUrl : p.imageUrl
  const effectivePrice = selected?.price ?? p?.price ?? 0
  const effectiveSalePrice = selected?.salePrice ?? p?.salePrice ?? null
  const hasDiscount = typeof effectiveSalePrice === 'number' && effectiveSalePrice < effectivePrice
  const baseMin = p.priceMin ?? p.price
  const baseMax = p.priceMax ?? p.price
  const saleMin = p.salePriceMin ?? p.salePrice ?? baseMin
  const saleMax = p.salePriceMax ?? p.salePrice ?? baseMax
  const hasPriceRange = variants.length > 1 && baseMin !== baseMax
  const rangeHasDiscount = hasPriceRange && (saleMin < baseMin || saleMax < baseMax)
  const effectiveStock = variants.length > 0 ? (selected?.stock ?? 0) : (p?.stock ?? 0)
  const requiresInput = !!selected?.requiresInput
  const fields = selected?.inputFields && selected.inputFields.length > 0
    ? selected.inputFields
    : (requiresInput
        ? [{ label: selected!.inputLabel || 'Thông tin', placeholder: '', type: 'text' as const, required: true }]
        : [])
  const inputValid = !requiresInput || fields.every((f) => !f.required || (inputValues[f.label] ?? '').trim().length >= 1)

  const disabled = (!selected?.isBackorder && effectiveStock <= 0) || p.contactOnly || !inputValid
  const addToCart = () => {
    const trimmed: Record<string, string> = {}
    if (requiresInput) {
      for (const f of fields) {
        const v = (inputValues[f.label] ?? '').trim()
        if (v) trimmed[f.label] = v
      }
    }
    cart.add({
      productId: p.id,
      variantId: selected?.id ?? null,
      variantName: selected?.name ?? null,
      inputValue: requiresInput ? JSON.stringify(trimmed) : null,
      slug: p.slug,
      name: p.name,
      price: effectivePrice,
      emoji: p.emoji,
      imageUrl: p.imageUrl,
      quantity: qty,
    })
  }

  async function copyGlobalDiscountCode(code: string) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(code)
      setCopiedGlobalCode(true)
      setTimeout(() => setCopiedGlobalCode(false), 1500)
    } catch {
      // No-op: clipboard can fail on unsupported clients.
    }
  }

  return (
    <MiniAppShell title={p.name} hasBottombar>
      <div className="md:grid md:grid-cols-2 md:gap-8 md:items-start">
        <div className="rounded-2xl overflow-hidden mb-4 md:mb-0 md:sticky md:top-20" style={{ background: 'var(--brand-gold-soft)' }}>
          <div className="aspect-square" style={{ position: 'relative' }}>
            {(selected?.discountLabel || p.discountLabel || p.promotion) && (
              <span className="miniapp-product-badge" style={{ top: 12, left: 12 }}>
                {selected?.discountLabel || p.discountLabel || p.promotion}
              </span>
            )}
            {effectiveImage ? (
              <Image
                src={effectiveImage}
                alt={p.name}
                fill
                priority
                sizes="(min-width: 768px) 50vw, 100vw"
                style={{ objectFit: 'cover' }}
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center" style={{ color: 'var(--brand-gold-deep)' }}>
                <Icon name="package" size={88} strokeWidth={1.25} />
              </div>
            )}
          </div>
        </div>

        <div>
          {variants.length > 0 && (
            <div className="mb-3">
              <VariantPicker
                variants={variants}
                selectedId={selected?.id ?? null}
                onSelect={(id) => { setSelectedVariantId(id); setInputValues({}) }}
                inputValues={inputValues}
                onInputChange={setInputValues}
              />
            </div>
          )}
          {p.globalDiscount && (
            <div className="rounded-2xl p-3 mb-3 text-sm" style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-ink)' }}>
              <p className="font-semibold leading-snug">
                {p.globalDiscount.title || `${p.globalDiscount.label} tự động`}
              </p>
              <DiscountCodeMeta
                code={p.globalDiscount.code}
                label={p.globalDiscount.label}
                mode={p.globalDiscount.appMetaMode}
                text={p.globalDiscount.appMetaText}
                copied={copiedGlobalCode}
                onCopy={() => copyGlobalDiscountCode(p.globalDiscount!.code)}
              />
              {p.globalDiscount.appMessage && <p className="text-xs opacity-75 mt-1 leading-relaxed">{p.globalDiscount.appMessage}</p>}
            </div>
          )}
          <div className="flex items-end justify-between mb-2">
            <div>
              {hasPriceRange && (
                <p className="text-sm opacity-70 mb-1">
                  {rangeHasDiscount
                    ? `${formatPrice(saleMin)} - ${formatPrice(saleMax)}`
                    : `${formatPrice(baseMin)} - ${formatPrice(baseMax)}`}
                </p>
              )}
              <p className="text-2xl font-bold tracking-tight">{formatPrice(hasDiscount ? effectiveSalePrice! : effectivePrice)}</p>
              {hasDiscount && (
                <p className="text-sm opacity-50 line-through">{formatPrice(effectivePrice)}</p>
              )}
              <p className="text-xs mt-1">
                {selected?.isBackorder
                  ? <span style={{ color: '#16a34a' }}>● Có sẵn (đặt trước)</span>
                  : effectiveStock > 0
                    ? <span style={{ color: '#16a34a' }}>● {t.product.inStock.replace('{n}', String(effectiveStock))}</span>
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
                  onClick={() => setQty((q) => Math.min(selected?.isBackorder ? 99 : (effectiveStock || 99), q + 1))}
                  className="w-7 h-7 grid place-items-center rounded-full"
                  style={{ background: 'var(--tg-bg)' }}
                  aria-label="Tăng số lượng"
                ><Icon name="plus" size={14} /></button>
              </div>
            )}
          </div>

          {p.description && (
            <div
              className="rich-text mb-3 text-[0.9375rem]"
              dangerouslySetInnerHTML={{ __html: p.description }}
            />
          )}

          {p.longDescription && (
            <section className="mb-4">
              <h2 className="font-medium text-sm mb-2">Thông tin sản phẩm</h2>
              <div
                className="rich-text text-sm opacity-90"
                dangerouslySetInnerHTML={{ __html: p.longDescription }}
              />
            </section>
          )}
        </div>
      </div>

      {related.data && related.data.length > 0 && (
        <section className="miniapp-section mt-6">
          <div className="miniapp-section-title">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="sparkles" size={16} />
              Sản phẩm liên quan
            </span>
          </div>
          <ProductRail items={related.data} />
        </section>
      )}

      {recently.data && recently.data.length > 0 && (
        <section className="miniapp-section mt-4">
          <div className="miniapp-section-title">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="clock" size={16} />
              Sản phẩm đã xem
            </span>
          </div>
          <ProductRail items={recently.data} />
        </section>
      )}

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
