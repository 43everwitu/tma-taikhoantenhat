'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'

interface Discount {
  id: number
  code: string
  type: 'percent' | 'fixed'
  amount: number
  maxDiscount: number | null
  minOrder: number
  usageLimit: number | null
  usedCount: number
  perUserLimit: number | null
  startsAt: string | null
  endsAt: string | null
  isActive: boolean
}

type DiscountForm = {
  code: string
  type: 'percent' | 'fixed'
  amount: number
  maxDiscount: number | ''
  minOrder: number
  usageLimit: number | ''
  perUserLimit: number | ''
  startsAt: string
  endsAt: string
  isActive: boolean
}

const empty: DiscountForm = {
  code: '', type: 'percent', amount: 10,
  maxDiscount: '', minOrder: 0, usageLimit: '', perUserLimit: '',
  startsAt: '', endsAt: '', isActive: true,
}

export default function DiscountsPage() {
  const qc = useQueryClient()
  const t = useToast()
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'discounts'],
    queryFn: () => api.get<Discount[]>('/admin/discounts'),
    refetchOnWindowFocus: false,
  })
  const list = data?.data ?? []
  const [editing, setEditing] = useState<Discount | 'new' | null>(null)

  const createMut = useMutation({
    mutationFn: (body: object) => api.post('/admin/discounts', body),
    onSuccess: () => { t.success('Đã tạo mã'); qc.invalidateQueries({ queryKey: ['admin', 'discounts'] }); setEditing(null) },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'Tạo thất bại'}`),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) => api.put(`/admin/discounts/${id}`, body),
    onSuccess: () => { t.success('Đã cập nhật'); qc.invalidateQueries({ queryKey: ['admin', 'discounts'] }); setEditing(null) },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'Cập nhật thất bại'}`),
  })
  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/discounts/${id}`),
    onSuccess: () => { t.success('Đã xoá'); qc.invalidateQueries({ queryKey: ['admin', 'discounts'] }) },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'Xoá thất bại'}`),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="clay-display text-3xl">Mã giảm giá</h1>
        <button onClick={() => setEditing('new')} className="clay-btn clay-btn--lemon text-sm">+ Tạo mã</button>
      </div>

      {isLoading && <p className="opacity-60 text-sm">Đang tải…</p>}
      {!isLoading && list.length === 0 && <p className="opacity-60 text-sm">Chưa có mã giảm giá.</p>}

      <ul className="space-y-2">
        {list.map((d) => (
          <li key={d.id} className="clay-card p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-mono font-bold text-lg">{d.code}</p>
              <p className="text-xs opacity-70">
                {d.type === 'percent' ? `${d.amount}%` : `${d.amount.toLocaleString('vi-VN')}đ`}
                {d.maxDiscount ? ` (tối đa ${d.maxDiscount.toLocaleString('vi-VN')}đ)` : ''}
                {d.minOrder ? ` · đơn từ ${d.minOrder.toLocaleString('vi-VN')}đ` : ''}
                {d.usageLimit != null ? ` · ${d.usedCount}/${d.usageLimit} lượt` : ` · ${d.usedCount} lượt dùng`}
                {!d.isActive && ' · TẮT'}
              </p>
            </div>
            <button onClick={() => setEditing(d)} className="clay-btn text-xs">Sửa</button>
            <button onClick={() => { if (confirm(`Xoá mã ${d.code}?`)) deleteMut.mutate(d.id) }} className="clay-btn clay-btn--pomegranate text-xs">Xoá</button>
          </li>
        ))}
      </ul>

      {editing && (
        <DiscountModal
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={(body) => {
            if (editing === 'new') createMut.mutate(body)
            else updateMut.mutate({ id: editing.id, body })
          }}
          isPending={createMut.isPending || updateMut.isPending}
        />
      )}
    </div>
  )
}

function DiscountModal({ initial, onClose, onSubmit, isPending }: {
  initial: Discount | null
  onClose: () => void
  onSubmit: (body: object) => void
  isPending: boolean
}) {
  const [form, setForm] = useState<DiscountForm>(initial
    ? {
        code: initial.code,
        type: initial.type,
        amount: initial.amount,
        maxDiscount: initial.maxDiscount ?? '',
        minOrder: initial.minOrder,
        usageLimit: initial.usageLimit ?? '',
        perUserLimit: initial.perUserLimit ?? '',
        startsAt: initial.startsAt ?? '',
        endsAt: initial.endsAt ?? '',
        isActive: initial.isActive,
      }
    : empty)

  function submit() {
    const body: Record<string, unknown> = {
      code: form.code.toUpperCase(),
      type: form.type,
      amount: form.amount,
      minOrder: form.minOrder || 0,
      isActive: form.isActive,
    }
    if (form.maxDiscount !== '') body.maxDiscount = Number(form.maxDiscount)
    else body.maxDiscount = null
    if (form.usageLimit !== '') body.usageLimit = Number(form.usageLimit)
    else body.usageLimit = null
    if (form.perUserLimit !== '') body.perUserLimit = Number(form.perUserLimit)
    else body.perUserLimit = null
    body.startsAt = form.startsAt || null
    body.endsAt = form.endsAt || null
    onSubmit(body)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{initial ? 'Sửa mã giảm giá' : 'Tạo mã giảm giá'}</h3>
          <button type="button" onClick={onClose} className="opacity-60 text-xl leading-none">×</button>
        </div>
        <label className="block text-sm">
          <span className="text-xs opacity-70 mb-1 inline-block">Mã (vd: SUMMER10)</span>
          <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="clay-input w-full font-mono uppercase" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">
            <span className="text-xs opacity-70 mb-1 inline-block">Loại</span>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'percent' | 'fixed' })} className="clay-input w-full text-sm">
              <option value="percent">% giảm</option>
              <option value="fixed">Số tiền cố định</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-xs opacity-70 mb-1 inline-block">Giá trị {form.type === 'percent' ? '(%)' : '(VND)'}</span>
            <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} className="clay-input w-full text-sm" />
          </label>
        </div>
        {form.type === 'percent' && (
          <label className="block text-sm">
            <span className="text-xs opacity-70 mb-1 inline-block">Giảm tối đa (VND, trống = không giới hạn)</span>
            <input type="number" value={form.maxDiscount} onChange={(e) => setForm({ ...form, maxDiscount: e.target.value === '' ? '' : Number(e.target.value) })} className="clay-input w-full text-sm" placeholder="VD: 100000" />
          </label>
        )}
        <label className="block text-sm">
          <span className="text-xs opacity-70 mb-1 inline-block">Đơn tối thiểu (VND)</span>
          <input type="number" value={form.minOrder} onChange={(e) => setForm({ ...form, minOrder: Number(e.target.value) })} className="clay-input w-full text-sm" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">
            <span className="text-xs opacity-70 mb-1 inline-block">Tổng lượt dùng</span>
            <input type="number" value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: e.target.value === '' ? '' : Number(e.target.value) })} className="clay-input w-full text-sm" placeholder="∞" />
          </label>
          <label className="block text-sm">
            <span className="text-xs opacity-70 mb-1 inline-block">/ khách</span>
            <input type="number" value={form.perUserLimit} onChange={(e) => setForm({ ...form, perUserLimit: e.target.value === '' ? '' : Number(e.target.value) })} className="clay-input w-full text-sm" placeholder="∞" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">
            <span className="text-xs opacity-70 mb-1 inline-block">Bắt đầu</span>
            <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} className="clay-input w-full text-sm" />
          </label>
          <label className="block text-sm">
            <span className="text-xs opacity-70 mb-1 inline-block">Kết thúc</span>
            <input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} className="clay-input w-full text-sm" />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          <span>Đang hoạt động</span>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="clay-btn text-sm">Huỷ</button>
          <button
            type="button"
            onClick={submit}
            disabled={isPending || !form.code || !form.amount}
            className="clay-btn clay-btn--lemon text-sm"
          >{isPending ? 'Đang lưu…' : 'Lưu'}</button>
        </div>
      </div>
    </div>
  )
}
