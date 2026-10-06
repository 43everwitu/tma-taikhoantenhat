'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { formatPrice } from '@/lib/utils'
import { productMatchesKeySearch } from '../stock/QuickAddKeysModal'

interface OrderProductOption {
  id: string
  name: string
  category: string
  slug: string
  price: number
  stock: number
  variantNames: string[]
}

interface OrderVariantOption {
  id: string
  name: string
  price: number
  stock: number
  isBackorder: boolean
}

interface ChangeProductModalProps {
  orderId: string
  quantity: number
  onClose: () => void
}

export function ChangeProductModal({ orderId, quantity, onClose }: ChangeProductModalProps) {
  const qc = useQueryClient()
  const t = useToast()
  const [search, setSearch] = useState('')
  const [productId, setProductId] = useState('')
  const [variantId, setVariantId] = useState('')
  const [priceInput, setPriceInput] = useState('')
  const [priceTouched, setPriceTouched] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const productsQuery = useQuery({
    queryKey: ['admin', 'products'],
    queryFn: () => api.get<OrderProductOption[]>('/admin/products'),
  })
  const products = productsQuery.data?.data ?? []
  const filtered = useMemo(
    () => products.filter((p) => productMatchesKeySearch(p, search)).slice(0, 8),
    [products, search],
  )
  const selectedProduct = products.find((p) => p.id === productId) ?? null

  const variantsQuery = useQuery({
    queryKey: ['admin', 'variants', productId],
    queryFn: () => api.get<OrderVariantOption[]>(`/admin/products/${productId}/variants`),
    enabled: !!productId,
  })
  const variants = variantsQuery.data?.data ?? []
  const hasVariants = variants.length > 0
  const selectedVariantId = variantId || (hasVariants ? variants[0].id : '')
  const selectedVariant = variants.find((v) => v.id === selectedVariantId) ?? null

  const availableStock = selectedVariant ? selectedVariant.stock : (selectedProduct?.stock ?? 0)
  const isBackorderOk = selectedVariant ? selectedVariant.isBackorder : false
  const insufficientStock = !!selectedProduct && availableStock < quantity && !isBackorderOk

  const unitPrice = selectedVariant ? selectedVariant.price : (selectedProduct?.price ?? 0)
  const autoTotal = unitPrice * quantity

  useEffect(() => {
    if (!priceTouched) setPriceInput(String(autoTotal))
  }, [autoTotal, priceTouched])

  const mutation = useMutation({
    mutationFn: () => {
      if (!productId) throw new Error('Chưa chọn sản phẩm')
      if (hasVariants && !selectedVariantId) throw new Error('Sản phẩm có biến thể — phải chọn biến thể')
      const totalPrice = Number(priceInput)
      if (!Number.isFinite(totalPrice) || totalPrice < 0) throw new Error('Giá không hợp lệ')
      return api.post(`/admin/orders/${orderId}/change-product`, {
        productId: Number(productId),
        variantId: selectedVariantId ? Number(selectedVariantId) : null,
        totalPrice,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'orders'] })
      qc.invalidateQueries({ queryKey: ['admin', 'order', orderId, 'detail'] })
      t.success('Đã đổi sản phẩm cho đơn hàng')
      onClose()
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : 'Lỗi'
      setErr(msg)
      t.error(`Lỗi: ${msg}`)
    },
  })

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Đổi sản phẩm — đơn #{orderId}</h2>
          <button onClick={onClose} className="opacity-60 text-xl leading-none">×</button>
        </div>

        <div>
          <label className="text-xs font-medium opacity-70">Tìm sản phẩm mới</label>
          <input
            className="clay-input w-full text-sm mt-1"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setProductId(''); setVariantId(''); setPriceTouched(false) }}
            placeholder="Tên sản phẩm..."
          />
          {search && !productId && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-clay-oat bg-white divide-y">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-clay-cream"
                  onClick={() => { setProductId(p.id); setSearch(p.name); setVariantId(''); setPriceTouched(false) }}
                >
                  {p.name} <span className="text-xs opacity-60">({p.category})</span>
                </button>
              ))}
              {filtered.length === 0 && <p className="px-3 py-2 text-sm opacity-60">Không tìm thấy</p>}
            </div>
          )}
        </div>

        {productId && hasVariants && (
          <div>
            <label className="text-xs font-medium opacity-70">Biến thể</label>
            <select
              className="clay-input w-full text-sm mt-1"
              value={selectedVariantId}
              onChange={(e) => { setVariantId(e.target.value); setPriceTouched(false) }}
            >
              {variants.map((v) => (
                <option key={v.id} value={v.id}>{v.name} — {formatPrice(v.price)} (còn {v.stock})</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="text-xs font-medium opacity-70">Tổng tiền mới ({quantity} sản phẩm)</label>
          <input
            type="number"
            min={0}
            className="clay-input w-full text-sm mt-1"
            value={priceInput}
            onChange={(e) => { setPriceInput(e.target.value); setPriceTouched(true) }}
          />
        </div>

        {productId && insufficientStock && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
            ⚠️ Hết hàng — đơn sẽ chuyển sang chờ giao thủ công sau khi đổi.
          </p>
        )}
        {err && <p className="text-xs text-red-600">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="clay-btn text-sm">Hủy</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!productId || mutation.isPending}
            className="clay-btn clay-btn--lemon text-sm disabled:opacity-50"
          >
            {mutation.isPending ? 'Đang đổi...' : 'Xác nhận đổi'}
          </button>
        </div>
      </div>
    </div>
  )
}
