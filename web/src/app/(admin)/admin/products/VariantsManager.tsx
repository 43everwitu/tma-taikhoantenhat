'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

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
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'variants', productId],
    queryFn: () => api.get<Variant[]>(`/admin/products/${productId}/variants?includeInactive=1`),
    enabled: !!productId,
  })
  const variants = data?.data ?? []
  const [editing, setEditing] = useState<Variant | 'new' | null>(null)

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/products/${productId}/variants/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] }),
  })

  if (!productId) return <p className="text-xs opacity-60">Lưu sản phẩm trước khi thêm biến thể.</p>
  if (isLoading) return <p className="text-xs opacity-60">Đang tải biến thể…</p>

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider opacity-60">Biến thể ({variants.length})</span>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="text-xs px-2 py-1 rounded bg-yellow-100 hover:bg-yellow-200"
        >+ Thêm biến thể</button>
      </div>

      {variants.length === 0 && <p className="text-xs opacity-60">Chưa có biến thể.</p>}

      <ul className="space-y-1.5">
        {variants.map((v) => (
          <li key={v.id} className={`rounded-lg border p-2 text-sm flex items-center gap-2 ${v.isActive ? 'bg-white' : 'bg-gray-50 opacity-70'}`}>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{v.name}</p>
              <p className="text-xs opacity-60">{v.price.toLocaleString('vi-VN')}đ · kho {v.stock} {v.requiresInput && `· cần ${v.inputLabel || v.inputType}`}</p>
            </div>
            <button
              type="button"
              onClick={() => setEditing(v)}
              className="text-xs opacity-70 hover:opacity-100 px-2"
            >Sửa</button>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Xoá biến thể "${v.name}"?`)) deleteMut.mutate(v.id)
              }}
              className="text-xs text-red-600 px-2"
            >Xoá</button>
          </li>
        ))}
      </ul>

      {editing && (
        <VariantEditModal
          productId={productId}
          variant={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] }); setEditing(null) }}
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
  })
  const [err, setErr] = useState<string | null>(null)

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
        ...(variant ? { isActive: form.isActive } : {}),
      }
      if (variant) return api.put(`/admin/products/${productId}/variants/${variant.id}`, payload)
      return api.post(`/admin/products/${productId}/variants`, payload)
    },
    onSuccess: onSaved,
    onError: (e) => setErr(e instanceof Error ? e.message : 'Lỗi'),
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
