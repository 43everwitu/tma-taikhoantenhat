'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import Link from 'next/link'
import { ResponsiveTable, Column } from '@/components/ResponsiveTable'
import { QuickAddKeysModal } from './QuickAddKeysModal'

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

function cardActions(p: ProductStock) {
  return (
    <Link
      href={`/admin/stock/${p.id}`}
      className="clay-btn clay-btn--ink text-xs py-1 px-3"
    >
      Xem kho
    </Link>
  )
}

export default function StockIndexPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'products'],
    queryFn: () => api.get<ProductStock[]>('/admin/products'),
    refetchInterval: 10000,
  })
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'in' | 'out' | 'low'>('all')
  const [sort, setSort] = useState<'default' | 'stock_asc' | 'stock_desc'>('default')
  const [quickAddOpen, setQuickAddOpen] = useState(false)

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
        cardActions={cardActions}
      />

      {quickAddOpen && (
        <QuickAddKeysModal products={products} onClose={() => setQuickAddOpen(false)} />
      )}
    </div>
  )
}
