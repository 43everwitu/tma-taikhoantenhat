'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatPrice } from '@/lib/utils'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { ResponsiveTable, Column } from '@/components/ResponsiveTable'

interface DashboardStats {
  revenueToday: number
  revenueWeek: number
  revenueMonth: number
  pendingOrders: number
  totalStock: number
  activeUsers: number
  lowStockCount: number
  unmatchedTransactions: number
}

interface RevenuePoint {
  date: string
  revenue: number
}

interface TopProduct {
  id: string
  name: string
  sold: number
  revenue: number
}

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['admin', 'dashboard', 'stats'],
    queryFn: () => api.get<DashboardStats>('/admin/dashboard/stats'),
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  })

  const { data: revenueData } = useQuery({
    queryKey: ['admin', 'dashboard', 'revenue'],
    queryFn: () => api.get<RevenuePoint[]>('/admin/dashboard/revenue?period=30'),
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  })

  const { data: topProducts } = useQuery({
    queryKey: ['admin', 'dashboard', 'top-products'],
    queryFn: () => api.get<TopProduct[]>('/admin/dashboard/top-products'),
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  })

  const s = stats?.data

  const productColumns: Column<TopProduct>[] = [
    { header: 'Sản phẩm', primary: true, cell: (p) => <span className="font-medium">{p.name}</span> },
    { header: 'Đã bán', className: 'text-right', cell: (p) => p.sold },
    { header: 'Doanh thu', className: 'text-right font-medium', cell: (p) => formatPrice(p.revenue) },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="clay-display text-3xl mb-6">Tổng quan</h1>
        <div className="flex gap-2">
          {s && s.lowStockCount > 0 && (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium" style={{ background: 'var(--color-pomegranate-100)', color: 'var(--color-pomegranate-700)' }}>
              Sắp hết hàng: {s.lowStockCount}
            </span>
          )}
          {s && s.unmatchedTransactions > 0 && (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium" style={{ background: 'var(--color-lemon-100)', color: 'var(--color-lemon-700)' }}>
              GD chưa khớp: {s.unmatchedTransactions}
            </span>
          )}
        </div>
      </div>

      {/* Stat Cards */}
      {statsLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="clay-card p-5 animate-pulse">
              <div className="h-4 bg-clay-oat rounded w-24 mb-3" />
              <div className="h-8 bg-clay-oat rounded w-20" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {(() => {
            const cards = [
              { label: 'Doanh thu hôm nay', value: formatPrice(s?.revenueToday ?? 0), bg: 'var(--color-matcha-300)' },
              { label: 'Doanh thu tháng', value: formatPrice(s?.revenueMonth ?? 0), bg: 'var(--color-lemon-400)' },
              { label: 'Đang chờ', value: s?.pendingOrders ?? 0, bg: 'var(--color-ube-300)' },
              { label: 'Tồn kho', value: s?.totalStock ?? 0, bg: 'var(--color-slushie-500)' },
            ]
            return cards.map((card, i) => (
              <div key={i} className="clay-card p-5" style={{ background: card.bg }}>
                <div className="text-sm text-clay-charcoal">{card.label}</div>
                <div className="clay-display text-3xl mt-2">{card.value}</div>
              </div>
            ))
          })()}
        </div>
      )}

      {/* Revenue Chart */}
      <div className="clay-card p-6">
        <h3 className="font-semibold mb-4">Doanh thu 30 ngày</h3>
        {revenueData?.data ? (
          revenueData.data.length === 0 ? (
            <div className="text-clay-charcoal text-center py-12">Chưa có doanh thu trong 30 ngày.</div>
          ) : (
            <ResponsiveContainer width="100%" height={300} minWidth={0}>
              <LineChart data={revenueData.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v) => {
                    const d = new Date(v)
                    return `${d.getDate()}/${d.getMonth() + 1}`
                  }}
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(value) => [formatPrice(Number(value)), 'Doanh thu']}
                  labelFormatter={(label) => new Date(label).toLocaleDateString('vi-VN')}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="var(--color-ube-600)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )
        ) : (
          <div className="text-clay-charcoal text-center py-12">Đang tải biểu đồ...</div>
        )}
      </div>

      {/* Top Products */}
      <div className="clay-card p-6">
        <h3 className="font-semibold mb-4">Sản phẩm bán chạy</h3>
        {topProducts?.data ? (
          <ResponsiveTable columns={productColumns} rows={topProducts.data} rowKey={(p) => p.id} />
        ) : (
          <div className="text-clay-charcoal text-center py-8">Đang tải...</div>
        )}
      </div>
    </div>
  )
}
