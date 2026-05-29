'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import Link from 'next/link'
import { ResponsiveTable, Column } from '@/components/ResponsiveTable'
import { useHighlightId, useHighlightedRowRef } from '@/lib/useHighlightedRow'
import { QuickAddKeysModal } from './QuickAddKeysModal'
import { useToast } from '@/components/Toast'

function VariantStockBadge({ productId }: { productId: string }) {
  const { data } = useQuery({
    queryKey: ['admin', 'variants', productId, 'count'],
    queryFn: () => api.get<{ id: string; name: string; stock: number }[]>(`/admin/products/${productId}/variants`),
    staleTime: 30000,
  })
  const variants = data?.data ?? []
  if (variants.length === 0) return <span className="text-xs opacity-40">—</span>
  const total = variants.reduce((s, v) => s + (v.stock || 0), 0)
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700" title={variants.map(v => `${v.name}: ${v.stock}`).join(' · ')}>
      {variants.length} biến thể · {total}
    </span>
  )
}

interface ProductStock {
  id: string
  name: string
  category: string
  stock: number
  soldStock: number
  totalStock: number
}

const columns: Column<ProductStock>[] = [
  {
    header: 'ID',
    cell: (p) => (
      <span className="font-mono text-xs text-clay-silver">{p.id.slice(0, 8)}</span>
    ),
  },
  {
    header: 'Sản phẩm',
    primary: true,
    cell: (p) => <span className="font-medium">{p.name}</span>,
  },
  {
    header: 'Danh mục',
    cell: (p) => <span className="text-clay-charcoal">{p.category}</span>,
  },
  {
    header: 'Tổng kho',
    className: 'text-center',
    cell: (p) => <span className="text-clay-charcoal">{p.totalStock ?? '-'}</span>,
  },
  {
    header: 'Đã bán',
    className: 'text-center',
    cell: (p) => (
      <span className="clay-pill" style={{ background: 'var(--color-clay-oat-light)' }}>
        {p.soldStock ?? '-'}
      </span>
    ),
  },
  {
    header: 'Biến thể',
    className: 'text-center',
    cell: (p) => <VariantStockBadge productId={p.id} />,
  },
  {
    header: 'Còn lại',
    className: 'text-center',
    cell: (p) => (
      <span className="clay-pill" style={{ background: 'var(--color-matcha-300)' }}>
        {p.stock ?? '-'}
      </span>
    ),
  },
  {
    header: 'Thao tác',
    className: 'text-center',
    hideOnCard: true,
    cell: (p) => (
      <Link
        href={`/admin/stock/${p.id}`}
        className="clay-btn clay-btn--ink text-xs py-1 px-3"
      >
        Xem kho
      </Link>
    ),
  },
]

export default function StockIndexPage() {
  const highlightId = useHighlightId()
  const refFor = useHighlightedRowRef(highlightId)
  const t = useToast()
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'products'],
    queryFn: () => api.get<ProductStock[]>('/admin/products'),
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  })
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'in' | 'out' | 'low'>('all')
  const [sort, setSort] = useState<'default' | 'stock_asc' | 'stock_desc'>('default')
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const notifyFollowersMutation = useMutation({
    mutationFn: (productId: string) => api.post<{ sent?: number; failed?: number; skipped?: string | null }>(`/admin/stock/${productId}/notify-followers`, {}),
    onSuccess: (res) => {
      if (res.data?.skipped) t.error(`Bỏ qua gửi thông báo (${res.data.skipped})`)
      else t.success(`Đã gửi followers: ${res.data?.sent ?? 0} thành công, ${res.data?.failed ?? 0} lỗi`)
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'gửi thông báo thất bại'}`),
  })

  const cardActionsFor = (p: ProductStock) => (
    <div className="flex gap-2">
      <Link
        href={`/admin/stock/${p.id}`}
        className="clay-btn clay-btn--ink text-xs py-1 px-3"
      >
        Xem kho
      </Link>
      <button
        type="button"
        onClick={() => setExpanded(expanded === p.id ? null : p.id)}
        className="clay-btn text-xs py-1 px-3"
      >
        {expanded === p.id ? 'Đóng' : 'Biến thể'}
      </button>
      <button
        type="button"
        onClick={() => notifyFollowersMutation.mutate(p.id)}
        disabled={notifyFollowersMutation.isPending}
        className="clay-btn text-xs py-1 px-3 disabled:opacity-50"
      >
        {notifyFollowersMutation.isPending ? 'Đang gửi…' : 'Notify followers'}
      </button>
    </div>
  )

  const products = data?.data ?? []

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    let rows = products
    if (ql) {
      rows = rows.filter((p) =>
        p.name.toLowerCase().includes(ql) || p.category.toLowerCase().includes(ql)
      )
    }
    if (statusFilter === 'in') rows = rows.filter((p) => p.stock > 0)
    else if (statusFilter === 'out') rows = rows.filter((p) => p.stock === 0)
    else if (statusFilter === 'low') rows = rows.filter((p) => p.stock > 0 && p.stock <= 5)

    if (sort === 'stock_asc') rows = [...rows].sort((a, b) => a.stock - b.stock)
    else if (sort === 'stock_desc') rows = [...rows].sort((a, b) => b.stock - a.stock)
    return rows
  }, [products, q, statusFilter, sort])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="clay-display text-3xl">Kho</h1>
        <button
          type="button"
          onClick={() => setQuickAddOpen(true)}
          className="clay-btn clay-btn--lemon text-sm"
        >
          + Thêm key
        </button>
      </div>

      <div className="clay-input flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo tên sản phẩm hoặc danh mục…"
          className="w-full bg-transparent outline-none text-sm"
        />
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        {[
          { k: 'all', label: 'Tất cả' },
          { k: 'in', label: 'Còn hàng' },
          { k: 'out', label: 'Hết hàng' },
          { k: 'low', label: 'Sắp hết' },
        ].map((s) => (
          <button
            key={s.k}
            type="button"
            onClick={() => setStatusFilter(s.k as typeof statusFilter)}
            className="clay-pill text-xs"
            style={statusFilter === s.k ? { background: 'var(--color-clay-ink)', color: '#fff', borderColor: 'var(--color-clay-ink)' } : undefined}
          >
            {s.label}
          </button>
        ))}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="clay-input text-xs py-1 px-2 ml-auto"
        >
          <option value="default">Sắp xếp mặc định</option>
          <option value="stock_asc">Tồn ↑</option>
          <option value="stock_desc">Tồn ↓</option>
        </select>
      </div>

      <ResponsiveTable
        rows={filtered}
        columns={columns}
        rowKey={(p) => p.id}
        loading={isLoading}
        emptyText="Không tìm thấy sản phẩm phù hợp"
        cardActions={cardActionsFor}
        rowRef={refFor}
      />

      {expanded && (
        <VariantBreakdownPanel productId={expanded} onClose={() => setExpanded(null)} />
      )}

      {quickAddOpen && (
        <QuickAddKeysModal products={products} onClose={() => setQuickAddOpen(false)} />
      )}
    </div>
  )
}

function VariantBreakdownPanel({ productId, onClose }: { productId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const t = useToast()
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'variants', productId, 'panel'],
    queryFn: () => api.get<{ id: string; name: string; stock: number }[]>(`/admin/products/${productId}/variants`),
  })
  const variants = data?.data ?? []
  const [addVar, setAddVar] = useState<string | null>(null)
  const [keyText, setKeyText] = useState('')
  const [notifyFollowers, setNotifyFollowers] = useState(false)

  const addMut = useMutation({
    mutationFn: async () => {
      const items = keyText.split('\n').map((s) => s.trim()).filter(Boolean)
      const payload: { items: string[]; variantId?: number; notifyFollowers?: boolean } = { items, notifyFollowers }
      if (addVar) payload.variantId = Number(addVar)
      return api.post(`/admin/stock/${productId}`, payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId, 'panel'] })
      qc.invalidateQueries({ queryKey: ['admin', 'products'] })
      setAddVar(null)
      setKeyText('')
      setNotifyFollowers(false)
    },
  })

  const notifyMut = useMutation({
    mutationFn: async () => api.post<{ sent?: number; failed?: number; skipped?: string | null }>(`/admin/stock/${productId}/notify-followers`, {}),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] })
      if (res.data?.skipped) t.error(`Bỏ qua gửi thông báo (${res.data.skipped})`)
      else t.success(`Đã gửi followers: ${res.data?.sent ?? 0} thành công, ${res.data?.failed ?? 0} lỗi`)
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'gửi thông báo thất bại'}`),
  })

  return (
    <div className="rounded-2xl border border-purple-200 bg-purple-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Biến thể của sản phẩm #{productId}</h3>
        <button onClick={onClose} className="text-xs opacity-60">Đóng ×</button>
      </div>

      {isLoading && <p className="text-xs opacity-60">Đang tải…</p>}

      {!isLoading && variants.length === 0 && (
        <p className="text-xs opacity-60">Sản phẩm này chưa có biến thể.</p>
      )}

      <ul className="space-y-1.5">
        {variants.map((v) => (
          <li key={v.id} className="rounded-lg bg-white border border-purple-100 p-2 text-sm flex items-center gap-2">
            <span className="flex-1 min-w-0 truncate font-medium">{v.name}</span>
            <span className="text-xs opacity-70">kho {v.stock}</span>
            <button
              type="button"
              onClick={() => setAddVar(v.id)}
              className="text-xs px-2 py-1 rounded bg-yellow-100 hover:bg-yellow-200"
            >
              + Thêm key
            </button>
          </li>
        ))}
      </ul>

      {addVar && (
        <div className="bg-white rounded-lg p-3 space-y-2 border border-purple-100">
          <p className="text-xs opacity-70">Nhập keys (mỗi key một dòng) cho biến thể đã chọn:</p>
          <textarea
            value={keyText}
            onChange={(e) => setKeyText(e.target.value)}
            rows={6}
            className="clay-input w-full text-xs font-mono"
            placeholder={"key1\nkey2"}
          />
          <label className="flex items-center gap-2 text-xs text-clay-charcoal">
            <input
              type="checkbox"
              checked={notifyFollowers}
              onChange={(e) => setNotifyFollowers(e.target.checked)}
              className="h-4 w-4"
            />
            Gửi thông báo tới followers khi thêm
          </label>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => notifyMut.mutate()}
              disabled={notifyMut.isPending}
              className="clay-btn text-xs disabled:opacity-50"
            >
              {notifyMut.isPending ? 'Đang gửi…' : 'Gửi thông báo followers'}
            </button>
            <button
              onClick={() => { setAddVar(null); setKeyText('') }}
              className="clay-btn text-xs"
            >
              Huỷ
            </button>
            <button
              onClick={() => addMut.mutate()}
              disabled={addMut.isPending || !keyText.trim()}
              className="clay-btn clay-btn--lemon text-xs"
            >
              {addMut.isPending ? 'Đang thêm…' : 'Thêm'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
