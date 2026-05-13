'use client'

import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface Product { id: string; name: string }

export function QuickAddKeysModal({ products, onClose }: { products: Product[]; onClose: () => void }) {
  const [productId, setProductId] = useState<string>(products[0]?.id ?? '')
  const [variantId, setVariantId] = useState<string>('')
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const qc = useQueryClient()

  const variantsQuery = useQuery({
    queryKey: ['admin', 'variants', productId],
    queryFn: () => api.get<{ id: string; name: string; stock: number }[]>(`/admin/products/${productId}/variants`),
    enabled: !!productId,
  })
  const variants = variantsQuery.data?.data ?? []
  const hasVariants = variants.length > 0

  useEffect(() => {
    if (hasVariants && !variantId) setVariantId(variants[0].id)
  }, [hasVariants, variantId, variants])

  const mutation = useMutation({
    mutationFn: async () => {
      const items = text.split('\n').map((s) => s.trim()).filter(Boolean)
      if (items.length === 0) throw new Error('Chưa nhập key nào')
      if (!productId) throw new Error('Chưa chọn sản phẩm')
      if (hasVariants && !variantId) throw new Error('Sản phẩm có biến thể — phải chọn biến thể')
      const payload: { items: string[]; variantId?: number } = { items }
      if (variantId) payload.variantId = Number(variantId)
      return api.post(`/admin/stock/${productId}`, payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] })
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId, 'panel'] })
      onClose()
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Lỗi'),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Thêm key</h2>
          <button onClick={onClose} className="opacity-60 text-xl leading-none">×</button>
        </div>

        <label className="block text-sm">
          <span className="text-xs text-clay-charcoal mb-1 inline-block">Sản phẩm</span>
          <select
            value={productId}
            onChange={(e) => { setProductId(e.target.value); setVariantId('') }}
            className="clay-input w-full text-sm"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        {hasVariants && (
          <label className="block text-sm">
            <span className="text-xs text-clay-charcoal mb-1 inline-block">
              Biến thể <span className="text-red-500">*</span>
            </span>
            <select
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              className="clay-input w-full text-sm"
              required
            >
              <option value="">— Chọn biến thể —</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>{v.name} (kho {v.stock})</option>
              ))}
            </select>
            {!variantId && (
              <span className="text-xs text-red-600 mt-1 inline-block">Sản phẩm này có biến thể, phải chọn biến thể.</span>
            )}
          </label>
        )}

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
