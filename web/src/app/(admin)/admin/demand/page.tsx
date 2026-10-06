'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Eye } from '@/lib/icons'
import { ResponsiveTable, Column } from '@/components/ResponsiveTable'

interface DemandVariant {
  variantId: number
  name: string
  isBackorder: boolean
  waiting: number
  notifiedRecent: number
  stock: number
  lastSubscribedAt: string | null
}

interface DemandProduct {
  productId: number
  name: string
  slug: string
  waiting: number
  notifiedRecent: number
  variants: DemandVariant[]
}

interface DemandResponse {
  days: number
  totals: { products: number; waiting: number; notifiedRecent: number }
  products: DemandProduct[]
}

interface DemandRow extends DemandVariant {
  productId: number
  productName: string
  productWaiting: number
  firstOfProduct: boolean
}

const DAY_OPTIONS = [7, 30, 90] as const

function flatten(products: DemandProduct[]): DemandRow[] {
  return products.flatMap((product) =>
    product.variants.map((variant, index) => ({
      ...variant,
      productId: product.productId,
      productName: product.name,
      productWaiting: product.waiting,
      firstOfProduct: index === 0,
    })),
  )
}

function StockBadge({ row }: { row: DemandRow }) {
  if (row.stock > 0) {
    return <span className="clay-pill" style={{ background: 'var(--color-matcha-300)' }}>Còn {row.stock}</span>
  }
  if (row.isBackorder) {
    return <span className="clay-pill" style={{ background: 'var(--color-clay-oat-light)' }}>Đặt trước</span>
  }
  return <span className="clay-pill" style={{ background: 'var(--color-pomegranate-100)' }}>Hết hàng</span>
}

export default function DemandPage() {
  const [days, setDays] = useState<number>(30)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'stock-demand', days],
    queryFn: () => api.get<DemandResponse>(`/admin/stock/demand?days=${days}`),
  })

  const totals = data?.data.totals
  const rows = flatten(data?.data.products ?? [])

  const columns: Column<DemandRow>[] = [
    {
      header: 'Sản phẩm', primary: true,
      cell: (r) => (
        <div>
          <Link href={`/admin/stock/${r.productId}`} className="font-medium underline underline-offset-2">
            {r.productName}
          </Link>
          {r.firstOfProduct && (
            <div className="text-xs text-clay-silver">Tổng đang chờ: {r.productWaiting}</div>
          )}
        </div>
      ),
    },
    { header: 'Biến thể', cell: (r) => <span className="text-sm">{r.name}</span> },
    {
      header: 'Đang chờ', className: 'text-center',
      cell: (r) => <span className="font-semibold">{r.waiting}</span>,
    },
    {
      header: `Đã báo (${days} ngày)`, className: 'text-center',
      cell: (r) => <span>{r.notifiedRecent}</span>,
    },
    { header: 'Tồn kho', className: 'text-center', cell: (r) => <StockBadge row={r} /> },
    {
      header: 'Đăng ký gần nhất',
      cell: (r) => <span className="text-xs text-clay-silver whitespace-nowrap">{formatDate(r.lastSubscribedAt)}</span>,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="clay-display text-3xl flex items-center gap-2">
            <Eye size={28} />Nhu cầu khách
          </h1>
          <p className="text-sm text-clay-charcoal mt-1">
            Sản phẩm có khách bấm &quot;Thông báo khi có hàng&quot;. Số đang chờ cao mà hết hàng là sản phẩm nên nhập thêm.
          </p>
        </div>
        <div className="flex gap-2">
          {DAY_OPTIONS.map((option) => (
            <button
              key={option}
              onClick={() => setDays(option)}
              className="clay-pill cursor-pointer"
              style={days === option
                ? { background: 'var(--color-clay-ink)', color: '#fff', borderColor: 'var(--color-clay-ink)' }
                : {}}
            >
              {option} ngày
            </button>
          ))}
        </div>
      </div>

      {totals && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="clay-card p-4">
            <div className="text-xs text-clay-silver">Sản phẩm có nhu cầu</div>
            <div className="text-2xl font-semibold">{totals.products}</div>
          </div>
          <div className="clay-card p-4">
            <div className="text-xs text-clay-silver">Khách đang chờ</div>
            <div className="text-2xl font-semibold">{totals.waiting}</div>
          </div>
          <div className="clay-card p-4">
            <div className="text-xs text-clay-silver">Đã báo có hàng ({days} ngày)</div>
            <div className="text-2xl font-semibold">{totals.notifiedRecent}</div>
          </div>
        </div>
      )}

      <ResponsiveTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.variantId}
        loading={isLoading}
        emptyText="Chưa có khách nào đăng ký theo dõi sản phẩm"
      />
    </div>
  )
}
