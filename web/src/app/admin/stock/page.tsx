'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import Link from 'next/link'
import { ResponsiveTable, Column } from '@/components/ResponsiveTable'

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

  const products = data?.data ?? []

  return (
    <div className="space-y-6">
      <h1 className="clay-display text-3xl mb-6">Kho</h1>

      <ResponsiveTable
        rows={products}
        columns={columns}
        rowKey={(p) => p.id}
        loading={isLoading}
        emptyText="Chưa có sản phẩm nào"
        cardActions={cardActions}
      />
    </div>
  )
}
