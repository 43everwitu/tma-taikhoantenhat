'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { useCart } from '@/lib/cart'
import { VariantPicker, type Variant } from './VariantPicker'
import { Icon } from './Icon'
import { formatPrice } from '@/lib/utils'

interface ProductFull {
  id: string; slug: string; name: string; emoji: string; imageUrl?: string
  price: number; stock: number; contactOnly: boolean
  variants?: Variant[]
}

interface Props {
  slug: string
  onClose: () => void
}

export function VariantQuickBuy({ slug, onClose }: Props) {
  const cart = useCart()
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const { data: p, isLoading } = useQuery({
    queryKey: ['product-quickbuy', slug],
    queryFn: () => apiFetch<ProductFull>(`/products/${slug}`),
  })

  useEffect(() => {
    if (!p?.variants?.length) { setSelectedVariantId(null); return }
    const firstInStock = p.variants.find((v) => v.stock > 0)
    setSelectedVariantId((firstInStock ?? p.variants[0]).id)
  }, [p?.variants])

  if (isLoading || !p) {
    return (
      <Backdrop onClose={onClose}>
        <div className="miniapp-sheet">
          <p className="text-center opacity-70 text-sm py-6">Đang tải…</p>
        </div>
      </Backdrop>
    )
  }

  const variants = p.variants ?? []
  const selected = variants.find((v) => v.id === selectedVariantId) ?? null
  const effectivePrice = selected?.price ?? p.price
  const effectiveStock = variants.length > 0 ? (selected?.stock ?? 0) : p.stock
  const requiresInput = !!selected?.requiresInput
  const fields = selected?.inputFields && selected.inputFields.length > 0
    ? selected.inputFields
    : (requiresInput
        ? [{ label: selected!.inputLabel || 'Thông tin', placeholder: '', type: 'text' as const, required: true }]
        : [])
  const inputValid = !requiresInput || fields.every((f) => !f.required || (inputValues[f.label] ?? '').trim().length >= 1)
  const disabled = effectiveStock <= 0 || p.contactOnly || !inputValid || busy

  const product = p
  function addAndClose() {
    setBusy(true)
    const trimmed: Record<string, string> = {}
    if (requiresInput) {
      for (const f of fields) {
        const v = (inputValues[f.label] ?? '').trim()
        if (v) trimmed[f.label] = v
      }
    }
    cart.add({
      productId: product.id,
      variantId: selected?.id ?? null,
      variantName: selected?.name ?? null,
      inputValue: requiresInput ? JSON.stringify(trimmed) : null,
      slug: product.slug,
      name: product.name,
      price: effectivePrice,
      emoji: product.emoji,
      imageUrl: product.imageUrl,
      quantity: 1,
    })
    setBusy(false)
    onClose()
  }

  return (
    <Backdrop onClose={onClose}>
      <div className="miniapp-sheet">
        <div className="flex items-center justify-between mb-2">
          <p className="font-medium text-sm truncate">{p.name}</p>
          <button onClick={onClose} aria-label="Đóng" className="opacity-60"><Icon name="close" size={18} /></button>
        </div>

        {variants.length > 0 ? (
          <VariantPicker
            variants={variants}
            selectedId={selectedVariantId}
            onSelect={(id) => { setSelectedVariantId(id); setInputValues({}) }}
            inputValues={inputValues}
            onInputChange={setInputValues}
          />
        ) : (
          <p className="text-xs opacity-70">Sản phẩm không có biến thể.</p>
        )}

        <div className="flex items-center justify-between mt-3 mb-2">
          <span className="text-lg font-bold">{formatPrice(effectivePrice)}</span>
          <span className="text-xs opacity-60">{effectiveStock > 0 ? `Còn ${effectiveStock}` : 'Hết hàng'}</span>
        </div>

        <button
          type="button"
          onClick={addAndClose}
          disabled={disabled}
          className="miniapp-btn miniapp-btn--primary"
        >
          <Icon name="cart" size={18} /> Thêm vào giỏ
        </button>
      </div>
    </Backdrop>
  )
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="miniapp-sheet-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="miniapp-sheet-panel" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
