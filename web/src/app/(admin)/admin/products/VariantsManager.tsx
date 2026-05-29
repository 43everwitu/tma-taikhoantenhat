'use client'

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { MediaLibrary } from '@/components/admin/MediaLibrary'
import { useToast } from '@/components/Toast'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface InputField {
  label: string
  placeholder?: string | null
  type: 'text' | 'email' | 'password' | 'tel' | 'url' | 'number' | 'textarea'
  required: boolean
}

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
  inputFields: InputField[] | null
  isBackorder: boolean
  defaultDurationDays: number | null
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
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'variants', productId],
    queryFn: () => api.get<Variant[]>(`/admin/products/${productId}/variants?includeInactive=1`),
    enabled: !!productId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const variants = data?.data ?? []
  const [editing, setEditing] = useState<Variant | 'new' | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false)
  const [bulkPrice, setBulkPrice] = useState<number>(0)

  useEffect(() => {
    setSelectedIds((prev) => {
      const valid = new Set(variants.map((v) => v.id))
      const next = new Set<string>()
      for (const id of prev) if (valid.has(id)) next.add(id)
      return next.size === prev.size ? prev : next
    })
  }, [variants])

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelectedIds((prev) => prev.size === variants.length ? new Set() : new Set(variants.map((v) => v.id)))
  }

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
      t.success('Đã xoá biến thể vĩnh viễn')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId, 'panel'] })
    },
  })

  const reorderMut = useMutation({
    mutationFn: (items: { id: number; sortOrder: number }[]) =>
      api.patch(`/admin/products/${productId}/variants/reorder`, { items }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
      t.success('Đã sắp xếp lại biến thể')
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'sắp xếp thất bại'}`),
  })

  const bulkDeleteMut = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => api.delete(`/admin/products/${productId}/variants/${id}`)))
    },
    onSuccess: () => {
      t.success('Đã xoá biến thể đã chọn')
      setSelectedIds(new Set())
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'xoá thất bại'}`),
  })

  const bulkActiveMut = useMutation({
    mutationFn: async ({ ids, isActive }: { ids: string[]; isActive: boolean }) => {
      await Promise.all(ids.map((id) => api.put(`/admin/products/${productId}/variants/${id}`, { isActive })))
    },
    onSuccess: (_r, vars) => {
      t.success(vars.isActive ? 'Đã hiện biến thể đã chọn' : 'Đã ẩn biến thể đã chọn')
      setSelectedIds(new Set())
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'cập nhật thất bại'}`),
  })

  const bulkPriceMut = useMutation({
    mutationFn: async ({ ids, price }: { ids: string[]; price: number }) => {
      await Promise.all(ids.map((id) => api.put(`/admin/products/${productId}/variants/${id}`, { price })))
    },
    onSuccess: () => {
      t.success('Đã cập nhật giá biến thể đã chọn')
      setSelectedIds(new Set())
      setBulkPriceOpen(false)
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'cập nhật giá thất bại'}`),
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = variants.findIndex((v) => v.id === active.id)
    const newIdx = variants.findIndex((v) => v.id === over.id)
    if (oldIdx < 0 || newIdx < 0) return
    const next = arrayMove(variants, oldIdx, newIdx)
    qc.setQueryData<{ data: Variant[] }>(['admin', 'variants', productId], (prev) => prev ? { ...prev, data: next } : prev)
    reorderMut.mutate(next.map((v, i) => ({ id: Number(v.id), sortOrder: i })))
  }

  if (!productId) return <p className="text-xs opacity-60">Lưu sản phẩm trước khi thêm biến thể.</p>
  if (isLoading) return <p className="text-xs opacity-60">Đang tải biến thể…</p>

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs uppercase tracking-wider opacity-60 inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={variants.length > 0 && selectedIds.size === variants.length}
            ref={(el) => {
              if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < variants.length
            }}
            onChange={toggleAll}
          />
          Biến thể ({variants.length})
        </label>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="text-xs px-2 py-1 rounded bg-yellow-100 hover:bg-yellow-200"
        >+ Thêm biến thể</button>
      </div>

      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-10 -mx-2 px-2 py-2 bg-yellow-50 border border-yellow-300 rounded-lg flex items-center flex-wrap gap-2 text-xs">
          <span className="font-medium">Đã chọn {selectedIds.size}</span>
          <span className="opacity-60">·</span>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Xoá vĩnh viễn ${selectedIds.size} biến thể đã chọn?`))
                bulkDeleteMut.mutate(Array.from(selectedIds))
            }}
            disabled={bulkDeleteMut.isPending}
            className="px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700 disabled:opacity-50"
          >Xoá</button>
          <button
            type="button"
            onClick={() => bulkActiveMut.mutate({ ids: Array.from(selectedIds), isActive: false })}
            disabled={bulkActiveMut.isPending}
            className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-50"
          >Ẩn</button>
          <button
            type="button"
            onClick={() => bulkActiveMut.mutate({ ids: Array.from(selectedIds), isActive: true })}
            disabled={bulkActiveMut.isPending}
            className="px-2 py-1 rounded bg-green-100 hover:bg-green-200 text-green-800 disabled:opacity-50"
          >Hiện</button>
          <button
            type="button"
            onClick={() => { setBulkPrice(0); setBulkPriceOpen(true) }}
            className="px-2 py-1 rounded bg-yellow-100 hover:bg-yellow-200"
          >Sửa giá…</button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto px-2 py-1 rounded opacity-70 hover:opacity-100"
          >Bỏ chọn</button>
        </div>
      )}

      {variants.length === 0 && <p className="text-xs opacity-60">Chưa có biến thể.</p>}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={variants.map((v) => v.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1.5">
            {variants.map((v) => (
              <SortableVariantRow
                key={v.id}
                v={v}
                selected={selectedIds.has(v.id)}
                onToggle={() => toggleOne(v.id)}
                onEdit={() => setEditing(v)}
                onDelete={() => {
                  if (confirm(`Xoá vĩnh viễn biến thể "${v.name}"? Không thể hoàn tác.`)) deleteMut.mutate(v.id)
                }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {editing && (
        <VariantEditModal
          productId={productId}
          variant={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] }); qc.invalidateQueries({ queryKey: ['admin', 'variants', productId, 'panel'] }); setEditing(null) }}
        />
      )}

      {bulkPriceOpen && (
        <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setBulkPriceOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Đổi giá {selectedIds.size} biến thể</h3>
              <button type="button" onClick={() => setBulkPriceOpen(false)} className="opacity-60 text-xl leading-none">×</button>
            </div>
            <label className="block text-sm">
              <span className="text-xs opacity-70 mb-1 inline-block">Giá mới (VND)</span>
              <input
                type="number"
                min={0}
                step={1000}
                value={bulkPrice}
                onChange={(e) => setBulkPrice(Number(e.target.value))}
                className="clay-input w-full text-sm"
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setBulkPriceOpen(false)} className="clay-btn text-sm">Huỷ</button>
              <button
                type="button"
                onClick={() => bulkPriceMut.mutate({ ids: Array.from(selectedIds), price: Math.max(0, bulkPrice) })}
                disabled={bulkPriceMut.isPending}
                className="clay-btn clay-btn--lemon text-sm"
              >{bulkPriceMut.isPending ? 'Đang lưu…' : 'Áp dụng'}</button>
            </div>
          </div>
        </div>
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
  const initialFields: InputField[] = variant?.inputFields && variant.inputFields.length > 0
    ? variant.inputFields
    : variant?.requiresInput
      ? [{ label: variant.inputLabel || 'Thông tin', placeholder: variant.inputPlaceholder || '', type: (variant.inputType as InputField['type']) || 'text', required: true }]
      : []

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
    isBackorder: variant?.isBackorder ?? false,
    defaultDurationDays: variant?.defaultDurationDays ?? '',
  })
  const [inputFields, setInputFields] = useState<InputField[]>(initialFields)
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
        inputFields: form.requiresInput && inputFields.length > 0
          // Label is optional now — keep any field that has a label OR a
          // placeholder; only drop truly-empty accidental rows.
          ? inputFields.filter((f) => f.label.trim().length > 0 || (f.placeholder ?? '').trim().length > 0)
          : null,
        imageUrl: form.imageUrl || null,
        isBackorder: form.isBackorder,
        defaultDurationDays: form.defaultDurationDays === '' ? null : Number(form.defaultDurationDays),
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
          <button type="button" onClick={onClose} className="opacity-60 text-xl leading-none">×</button>
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
          <span className="text-xs opacity-70 mb-1 inline-block">Thời hạn mặc định (ngày, trống = không hết hạn)</span>
          <input
            type="number"
            min={1}
            value={form.defaultDurationDays}
            onChange={(e) => setForm({ ...form, defaultDurationDays: e.target.value === '' ? '' : Number(e.target.value) })}
            placeholder="VD: 30, 90, 365"
            className="clay-input w-full text-sm"
          />
        </label>

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

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={form.isBackorder} onChange={(e) => setForm({ ...form, isBackorder: e.target.checked })} />
          <span>
            <span>Đặt trước (admin xử lý thủ công)</span>
            <span className="block text-xs opacity-60">Không cần stock key sẵn. Khách thanh toán xong, bot báo admin để giao thủ công.</span>
          </span>
        </label>

        {form.requiresInput && (
          <div className="pl-5 space-y-3 border-l-2 border-yellow-200">
            {inputFields.length === 0 && (
              <p className="text-xs opacity-60">Chưa có trường nào — bấm + Thêm trường.</p>
            )}
            {inputFields.map((f, idx) => (
              <div key={idx} className="space-y-1 p-2 rounded border border-gray-200 bg-gray-50">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-sm">
                    <span className="text-xs opacity-70 mb-1 inline-block">Label (tuỳ chọn)</span>
                    <input
                      value={f.label}
                      onChange={(e) => {
                        const next = [...inputFields]; next[idx] = { ...f, label: e.target.value }; setInputFields(next)
                      }}
                      placeholder="Để trống nếu không cần nhãn"
                      className="clay-input w-full text-sm"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-xs opacity-70 mb-1 inline-block">Loại</span>
                    <select
                      value={f.type}
                      onChange={(e) => {
                        const next = [...inputFields]; next[idx] = { ...f, type: e.target.value as InputField['type'] }; setInputFields(next)
                      }}
                      className="clay-input w-full text-sm"
                    >
                      {INPUT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </label>
                </div>
                <label className="block text-sm">
                  <span className="text-xs opacity-70 mb-1 inline-block">Placeholder</span>
                  <input
                    value={f.placeholder ?? ''}
                    onChange={(e) => {
                      const next = [...inputFields]; next[idx] = { ...f, placeholder: e.target.value }; setInputFields(next)
                    }}
                    placeholder="vd: you@example.com"
                    className="clay-input w-full text-sm"
                  />
                </label>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) => {
                        const next = [...inputFields]; next[idx] = { ...f, required: e.target.checked }; setInputFields(next)
                      }}
                    /> Bắt buộc
                  </label>
                  <button
                    type="button"
                    onClick={() => setInputFields(inputFields.filter((_, i) => i !== idx))}
                    className="text-xs text-red-600"
                  >Xoá trường</button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setInputFields([...inputFields, { label: '', placeholder: '', type: 'text', required: true }])}
              className="text-xs px-2 py-1 rounded bg-yellow-100 hover:bg-yellow-200"
            >+ Thêm trường</button>
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
          <button type="button" onClick={onClose} className="clay-btn text-sm">Huỷ</button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.name}
            className="clay-btn clay-btn--lemon text-sm"
          >{mutation.isPending ? 'Đang lưu…' : 'Lưu'}</button>
        </div>
      </div>
    </div>
  )
}

function SortableVariantRow({ v, selected, onToggle, onEdit, onDelete }: {
  v: Variant
  selected: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: v.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  }
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border p-2 text-sm flex items-center gap-2 ${selected ? 'ring-2 ring-yellow-400 bg-yellow-50' : v.isActive ? 'bg-white' : 'bg-gray-50'}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="cursor-pointer"
      />
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab opacity-50 hover:opacity-100 px-1"
        aria-label="Kéo để sắp xếp"
      >⋮⋮</button>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">
          {v.name}
          {!v.isActive && (
            <span className="ml-2 text-[10px] uppercase tracking-wide bg-gray-500 text-white px-1.5 py-0.5 rounded">
              Tạm ẩn
            </span>
          )}
          {v.isBackorder && (
            <span className="ml-2 text-[10px] uppercase tracking-wide bg-blue-500 text-white px-1.5 py-0.5 rounded">
              Đặt trước
            </span>
          )}
        </p>
        <p className="text-xs opacity-60">{v.price.toLocaleString('vi-VN')}đ · kho {v.stock} {v.requiresInput && '· cần nhập'}</p>
      </div>
      <button type="button" onClick={onEdit} className="text-xs opacity-70 hover:opacity-100 px-2">Sửa</button>
      <button type="button" onClick={onDelete} className="text-xs text-red-600 px-2">Xoá</button>
    </li>
  )
}
