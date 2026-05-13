'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { MediaLibrary } from '@/components/admin/MediaLibrary'
import { useToast } from '@/components/Toast'

interface Variant {
  id: string
  name: string
  description: string
  price: number
  sortOrder: number
  isActive: boolean
  requiresInput: boolean
  inputLabel: string | null
  inputPlaceholder: string | null
  inputType: string
  stock: number
  imageUrl: string | null
}

const INPUT_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'password', label: 'Password' },
  { value: 'tel', label: 'Phone' },
  { value: 'url', label: 'URL' },
  { value: 'number', label: 'Number' },
  { value: 'textarea', label: 'Textarea' },
]

export function VariantsManager({ productId }: { productId: string | null }) {
  const qc = useQueryClient()
  const t = useToast()
  const [showInactive, setShowInactive] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'variants', productId, showInactive],
    queryFn: () => api.get<Variant[]>(`/admin/products/${productId}/variants${showInactive ? '?includeInactive=1' : ''}`),
    enabled: !!productId,
  })
  const variants = data?.data ?? []
  const [editing, setEditing] = useState<Variant | 'new' | null>(null)

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/products/${productId}/variants/${id}`),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['admin', 'variants', productId] })
      const snapshots = qc.getQueriesData<{ data: Variant[] }>({ queryKey: ['admin', 'variants', productId] })
      snapshots.forEach(([key, prev]) => {
        if (!prev) return
        qc.setQueryData(key, { ...prev, data: prev.data.filter((v) => v.id !== id) })
      })
      return { snapshots }
    },
    onError: (_e, _id, ctx) => {
      ctx?.snapshots.forEach(([key, prev]) => prev && qc.setQueryData(key, prev))
      t.error('Xoá biến thể thất bại')
    },
    onSuccess: () => {
      t.success('Đã xoá biến thể')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId, 'panel'] })
    },
  })

  if (!productId) return <p className="text-xs opacity-60">Lưu sản phẩm trước khi thêm biến thể.</p>
  if (isLoading) return <p className="text-xs opacity-60">Đang tải biến thể…</p>

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wider opacity-60">Biến thể ({variants.length})</span>
        <div className="flex items-center gap-2">
          <label className="text-xs opacity-70 inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            /> Hiện đã xoá
          </label>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="text-xs px-2 py-1 rounded bg-yellow-100 hover:bg-yellow-200"
          >+ Thêm biến thể</button>
        </div>
      </div>

      {variants.length === 0 && <p className="text-xs opacity-60">Chưa có biến thể.</p>}

      <ul className="space-y-1.5">
        {variants.map((v) => (
          <li
            key={v.id}
            className={`rounded-lg border p-2 text-sm flex items-center gap-2 ${v.isActive ? 'bg-white' : 'bg-red-50 border-red-200'}`}
          >
            <div className="flex-1 min-w-0">
              <p className={`font-medium truncate ${v.isActive ? '' : 'line-through opacity-60'}`}>
                {v.name}
                {!v.isActive && (
                  <span className="ml-2 text-[10px] uppercase tracking-wide bg-red-600 text-white px-1.5 py-0.5 rounded">
                    Đã xoá
                  </span>
                )}
              </p>
              <p className="text-xs opacity-60">{v.price.toLocaleString('vi-VN')}đ · kho {v.stock} {v.requiresInput && `· cần ${v.inputLabel || v.inputType}`}</p>
            </div>
            <button
              type="button"
              onClick={() => setEditing(v)}
              className="text-xs opacity-70 hover:opacity-100 px-2"
            >Sửa</button>
            {v.isActive && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Xoá biến thể "${v.name}"?`)) deleteMut.mutate(v.id)
                }}
                className="text-xs text-red-600 px-2"
              >Xoá</button>
            )}
          </li>
        ))}
      </ul>

      {editing && (
        <VariantEditModal
          productId={productId}
          variant={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] }); qc.invalidateQueries({ queryKey: ['admin', 'variants', productId, 'panel'] }); setEditing(null) }}
        />
      )}
    </div>
  )
}

function VariantEditModal({ productId, variant, onClose, onSaved }: {
  productId: string
  variant: Variant | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    name: variant?.name ?? '',
    description: variant?.description ?? '',
    price: variant?.price ?? 0,
    sortOrder: variant?.sortOrder ?? 0,
    requiresInput: variant?.requiresInput ?? false,
    inputLabel: variant?.inputLabel ?? '',
    inputPlaceholder: variant?.inputPlaceholder ?? '',
    inputType: variant?.inputType ?? 'text',
    isActive: variant?.isActive ?? true,
    imageUrl: variant?.imageUrl ?? '',
  })
  const [err, setErr] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const t = useToast()

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        description: form.description || null,
        price: Number(form.price),
        sortOrder: Number(form.sortOrder),
        requiresInput: form.requiresInput,
        inputLabel: form.inputLabel || null,
        inputPlaceholder: form.inputPlaceholder || null,
        inputType: form.inputType,
        imageUrl: form.imageUrl || null,
        ...(variant ? { isActive: form.isActive } : {}),
      }
      if (variant) return api.put(`/admin/products/${productId}/variants/${variant.id}`, payload)
      return api.post(`/admin/products/${productId}/variants`, payload)
    },
    onSuccess: () => {
      t.success(variant ? 'Đã cập nhật biến thể' : 'Đã thêm biến thể')
      onSaved()
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : 'Lỗi'
      setErr(msg)
      t.error(`Lỗi: ${msg}`)
    },
  })

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{variant ? 'Sửa biến thể' : 'Thêm biến thể'}</h3>
          <button onClick={onClose} className="opacity-60 text-xl leading-none">×</button>
        </div>

        <label className="block text-sm">
          <span className="text-xs opacity-70 mb-1 inline-block">Tên (vd: 1 tháng, 3 tháng)</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="clay-input w-full text-sm" />
        </label>

        <label className="block text-sm">
          <span className="text-xs opacity-70 mb-1 inline-block">Mô tả ngắn</span>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="clay-input w-full text-sm" />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">
            <span className="text-xs opacity-70 mb-1 inline-block">Giá (VND)</span>
            <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} className="clay-input w-full text-sm" />
          </label>
          <label className="block text-sm">
            <span className="text-xs opacity-70 mb-1 inline-block">Thứ tự</span>
            <input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} className="clay-input w-full text-sm" />
          </label>
        </div>

        <label className="block text-sm">
          <span className="text-xs opacity-70 mb-1 inline-block">Ảnh biến thể (tuỳ chọn — nếu trống dùng ảnh sản phẩm)</span>
          <div className="flex items-center gap-2">
            {form.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.imageUrl} alt="" className="w-16 h-16 rounded-lg object-cover border border-gray-200" />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-gray-100 grid place-items-center text-xs opacity-60">—</div>
            )}
            <button type="button" onClick={() => setPickerOpen(true)} className="clay-btn text-xs">Chọn ảnh</button>
            {form.imageUrl && <button type="button" onClick={() => setForm({ ...form, imageUrl: '' })} className="text-xs text-red-600">Xoá</button>}
          </div>
        </label>

        {pickerOpen && (
          <MediaLibrary
            onPick={(url) => { setForm({ ...form, imageUrl: url }); setPickerOpen(false) }}
            onClose={() => setPickerOpen(false)}
          />
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.requiresInput} onChange={(e) => setForm({ ...form, requiresInput: e.target.checked })} />
          <span>Yêu cầu khách nhập thông tin khi mua</span>
        </label>

        {form.requiresInput && (
          <div className="pl-5 space-y-2 border-l-2 border-yellow-200">
            <label className="block text-sm">
              <span className="text-xs opacity-70 mb-1 inline-block">Loại input</span>
              <select value={form.inputType} onChange={(e) => setForm({ ...form, inputType: e.target.value })} className="clay-input w-full text-sm">
                {INPUT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-xs opacity-70 mb-1 inline-block">Label</span>
              <input value={form.inputLabel} onChange={(e) => setForm({ ...form, inputLabel: e.target.value })} placeholder="vd: Email tài khoản" className="clay-input w-full text-sm" />
            </label>
            <label className="block text-sm">
              <span className="text-xs opacity-70 mb-1 inline-block">Placeholder</span>
              <input value={form.inputPlaceholder} onChange={(e) => setForm({ ...form, inputPlaceholder: e.target.value })} placeholder="vd: you@example.com" className="clay-input w-full text-sm" />
            </label>
          </div>
        )}

        {variant && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            <span>Hoạt động</span>
          </label>
        )}

        {err && <p className="text-xs text-red-600">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="clay-btn text-sm">Huỷ</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.name}
            className="clay-btn clay-btn--lemon text-sm"
          >{mutation.isPending ? 'Đang lưu…' : 'Lưu'}</button>
        </div>
      </div>
    </div>
  )
}
