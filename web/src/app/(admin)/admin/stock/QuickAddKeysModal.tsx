'use client'

import { useState, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'

export interface Product {
  id: string
  name: string
  category?: string
  slug?: string
  variantNames?: string[]
}

interface QuickAddKeysModalProps {
  products: Product[]
  initialProductId?: string | null
  onClose: () => void
}

function getInitialProductId(products: Product[], initialProductId?: string | null) {
  if (initialProductId === undefined) return products[0]?.id ?? ''
  return initialProductId ?? ''
}

export function productMatchesKeySearch(product: Product, query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true

  return [
    product.name,
    product.category,
    product.id,
    product.slug,
    ...(product.variantNames ?? []),
  ].some((value) => value?.toLowerCase().includes(normalizedQuery))
}

export function QuickAddKeysModal({ products, initialProductId, onClose }: QuickAddKeysModalProps) {
  const initialSelectedProductId = getInitialProductId(products, initialProductId)
  const initialProduct = products.find((p) => p.id === initialSelectedProductId)
  const [productId, setProductId] = useState<string>(initialSelectedProductId)
  const [search, setSearch] = useState<string>(initialProduct?.name ?? '')
  const [variantId, setVariantId] = useState<string>('')
  const [durationDays, setDurationDays] = useState<string>('')
  const [notifyFollowers, setNotifyFollowers] = useState(false)
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const qc = useQueryClient()
  const t = useToast()

  const variantsQuery = useQuery({
    queryKey: ['admin', 'variants', productId],
    queryFn: () => api.get<{ id: string; name: string; stock: number }[]>(`/admin/products/${productId}/variants`),
    enabled: !!productId,
  })
  const variants = variantsQuery.data?.data ?? []
  const hasVariants = variants.length > 0
  const selectedVariantId = variantId || (hasVariants ? variants[0].id : '')
  const selectedProduct = products.find((p) => p.id === productId) ?? null
  const filteredProducts = useMemo(
    () => products.filter((p) => productMatchesKeySearch(p, search)).slice(0, 8),
    [products, search],
  )

  const mutation = useMutation({
    mutationFn: async () => {
      const items = text.split('\n').map((s) => s.trim()).filter(Boolean)
      if (items.length === 0) throw new Error('Chưa nhập key nào')
      if (!productId) throw new Error('Chưa chọn sản phẩm')
      if (hasVariants && !selectedVariantId) throw new Error('Sản phẩm có biến thể — phải chọn biến thể')
      const payload: { items: string[]; variantId?: number; durationDays?: number; notifyFollowers?: boolean } = { items, notifyFollowers }
      if (selectedVariantId) payload.variantId = Number(selectedVariantId)
      if (durationDays && Number(durationDays) > 0) payload.durationDays = Number(durationDays)
      return api.post(`/admin/stock/${productId}`, payload)
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] })
      qc.invalidateQueries({ queryKey: ['admin', 'stock'] })
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId, 'panel'] })
      const added = (res?.data as { added?: number } | undefined)?.added ?? 0
      t.success(`Đã thêm ${added} key`)
      onClose()
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : 'Lỗi'
      setErr(msg)
      t.error(`Lỗi: ${msg}`)
    },
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Thêm key</h2>
          <button onClick={onClose} className="opacity-60 text-xl leading-none">×</button>
        </div>

        <div className="block text-sm">
          <span className="text-xs text-clay-charcoal mb-1 inline-block">Sản phẩm</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên, danh mục, ID, slug, biến thể"
            className="clay-input w-full text-sm"
          />
          <div className="mt-2 rounded-xl border border-clay-border bg-white overflow-hidden">
            {filteredProducts.length > 0 ? (
              <div className="max-h-56 overflow-y-auto divide-y divide-clay-border">
                {filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setProductId(p.id)
                      setVariantId('')
                      setSearch(p.name)
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-clay-cream/60 ${productId === p.id ? 'bg-clay-lemon/25' : ''}`}
                  >
                    <span className="font-medium text-clay-charcoal">{p.name}</span>
                    <span className="mt-0.5 block text-[11px] text-clay-charcoal/60">
                      {[p.category, p.slug, p.id].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-3 py-2 text-xs text-clay-charcoal/60">Không tìm thấy sản phẩm phù hợp.</p>
            )}
          </div>
          <p className="mt-2 text-xs text-clay-charcoal">
            Đang chọn: <span className="font-semibold">{selectedProduct?.name ?? 'Chưa chọn sản phẩm'}</span>
          </p>
        </div>

        <label className="flex items-center gap-2 mt-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={notifyFollowers}
            onChange={(e) => setNotifyFollowers(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-xs text-clay-charcoal">Gửi thông báo Telegram tới tất cả khách sau khi thêm</span>
        </label>

        {hasVariants && (
          <label className="block text-sm">
            <span className="text-xs text-clay-charcoal mb-1 inline-block">
              Biến thể <span className="text-red-500">*</span>
            </span>
            <select
              value={selectedVariantId}
              onChange={(e) => setVariantId(e.target.value)}
              className="clay-input w-full text-sm"
              required
            >
              <option value="">— Chọn biến thể —</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>{v.name} (kho {v.stock})</option>
              ))}
            </select>
            {!selectedVariantId && (
              <span className="text-xs text-red-600 mt-1 inline-block">Sản phẩm này có biến thể, phải chọn biến thể.</span>
            )}
          </label>
        )}

        <label className="block text-sm">
          <span className="text-xs text-clay-charcoal mb-1 inline-block">Thời hạn (ngày, trống = dùng mặc định)</span>
          <input
            type="number"
            min={1}
            value={durationDays}
            onChange={(e) => setDurationDays(e.target.value)}
            placeholder="VD: 30"
            className="clay-input w-full text-sm"
          />
        </label>

        <label className="block text-sm">
          <span className="text-xs text-clay-charcoal mb-1 inline-block">Keys (mỗi key một dòng)</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder={"key1@example.com|password\nkey2@example.com|password"}
            className="clay-input w-full text-sm font-mono"
          />
        </label>

        {err && <p className="text-xs text-red-600">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="clay-btn text-sm">Huỷ</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="clay-btn clay-btn--lemon text-sm"
          >
            {mutation.isPending ? 'Đang thêm…' : 'Thêm'}
          </button>
        </div>
      </div>
    </div>
  )
}
