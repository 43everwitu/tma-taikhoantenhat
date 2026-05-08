'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatPrice, formatDate } from '@/lib/utils'
import { Search, Clock, CheckCircle2, XCircle, Check, Eye, EyeOff, Copy, Send } from '@/lib/icons'
import { ResponsiveTable, Column } from '@/components/ResponsiveTable'

interface Order {
  id: string
  userId: string
  userName: string
  productName: string
  quantity: number
  totalPrice: number
  status: string
  paymentCode?: string
  payment_code?: string
  createdAt: string
}

interface OrderDetail extends Order {
  accounts?: string[]
}

function KeyCell({ orderId, status }: { orderId: string; status: string }) {
  const [revealed, setRevealed] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'order', orderId, 'detail'],
    queryFn: () => api.get<OrderDetail>(`/admin/orders/${orderId}`),
    enabled: revealed,
  })

  if (status !== 'delivered') {
    return <span className="text-clay-silver text-xs">—</span>
  }

  if (!revealed) {
    return (
      <button
        onClick={() => setRevealed(true)}
        className="inline-flex items-center gap-1.5 text-xs text-clay-charcoal hover:text-clay-ink"
        title="Hiện key"
      >
        <Eye size={14} />
        <span className="font-mono blur-sm select-none">••••••••••••</span>
      </button>
    )
  }

  if (isLoading) {
    return <span className="text-clay-silver text-xs">Đang tải...</span>
  }

  const accounts = data?.data?.accounts ?? []
  if (accounts.length === 0) {
    return <span className="text-clay-silver text-xs">(không có)</span>
  }

  return (
    <div className="space-y-1 max-w-md">
      {accounts.map((acc, i) => (
        <div key={i} className="flex items-center gap-2 group">
          <code className="font-mono text-xs bg-clay-oat-light px-2 py-0.5 rounded flex-1 truncate" title={acc}>
            {acc}
          </code>
          <button
            onClick={() => navigator.clipboard.writeText(acc)}
            className="opacity-50 hover:opacity-100 transition"
            title="Copy"
          >
            <Copy size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={() => setRevealed(false)}
        className="inline-flex items-center gap-1 text-xs text-clay-silver hover:text-clay-charcoal mt-1"
      >
        <EyeOff size={12} /> Ẩn
      </button>
    </div>
  )
}

interface OrdersResponse {
  orders: Order[]
  total: number
  page: number
  limit: number
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; color?: string; icon: React.ReactNode }> = {
    pending: { label: 'Chờ thanh toán', bg: 'var(--color-clay-oat-light)', icon: <Clock size={14} /> },
    paid: { label: 'Đã thanh toán', bg: 'var(--color-lemon-400)', icon: <Check size={14} /> },
    delivered: { label: 'Đã giao', bg: 'var(--color-matcha-300)', icon: <CheckCircle2 size={14} /> },
    expired: { label: 'Hết hạn', bg: 'var(--color-pomegranate-400)', color: '#fff', icon: <XCircle size={14} /> },
    cancelled: { label: 'Đã hủy', bg: 'var(--color-pomegranate-400)', color: '#fff', icon: <XCircle size={14} /> },
    refunded: { label: 'Đã hoàn tiền', bg: 'var(--color-ube-300)', icon: <XCircle size={14} /> },
    // Legacy aliases — kept to gracefully render any old rows from the
    // pre-rename era. Safe to remove once the DB has none of these values.
    confirmed: { label: 'Đã xác nhận', bg: 'var(--color-matcha-300)', icon: <CheckCircle2 size={14} /> },
    completed: { label: 'Hoàn thành', bg: 'var(--color-matcha-300)', icon: <CheckCircle2 size={14} /> },
  }
  const m = map[status] || { label: status, bg: 'var(--color-clay-oat-light)', icon: null }
  return (
    <span className="clay-pill inline-flex items-center gap-1.5" style={{ background: m.bg, color: m.color }}>
      {m.icon}{m.label}
    </span>
  )
}

// Must match the actual `orders.status` values written by orderService /
// confirmAndDeliver / cancel / expire / refund. Old labels "Đã xác nhận" and
// "Hoàn thành" referenced statuses that don't exist in the DB ('confirmed',
// 'completed'), so they always returned an empty list.
const statusOptions = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'pending', label: 'Chờ thanh toán' },
  { value: 'paid', label: 'Đã trả (chờ giao)' },
  { value: 'delivered', label: 'Đã giao' },
  { value: 'cancelled', label: 'Đã hủy' },
  { value: 'expired', label: 'Hết hạn' },
  { value: 'refunded', label: 'Đã hoàn tiền' },
]

export default function OrdersPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const limit = 20

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const queryKey = ['admin', 'orders', page, statusFilter, debouncedSearch]

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => {
      let url = `/admin/orders?page=${page}&limit=${limit}`
      if (statusFilter) url += `&status=${statusFilter}`
      if (debouncedSearch) url += `&q=${encodeURIComponent(debouncedSearch)}`
      return api.get<OrdersResponse>(url)
    },
    refetchInterval: 10000,
  })

  const confirmMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/orders/${id}/confirm`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] }),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/orders/${id}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] }),
  })

  const resendMutation = useMutation({
    mutationFn: (id: string) => api.post<{ orderId: string; sent: number }>(`/admin/orders/${id}/resend-keys`),
    onSuccess: (res) => {
      alert(`✅ Đã gửi lại ${res.data.sent} key cho khách (đơn #${res.data.orderId}).`)
      queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] })
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Gửi lại thất bại'
      alert(`❌ ${msg}`)
    },
  })

  function handleResend(id: string) {
    if (!confirm(`Gửi lại key đơn #${id} cho khách qua Telegram?`)) return
    resendMutation.mutate(id)
  }

  const orders = data?.data?.orders ?? []
  const total = data?.data?.total ?? 0
  const totalPages = Math.ceil(total / limit)

  const columns: Column<Order>[] = [
    {
      header: 'Mã', primary: true,
      cell: (o) => <span className="font-mono text-xs">#{o.id}</span>,
      className: 'w-20',
    },
    { header: 'Khách', cell: (o) => o.userName || '—' },
    { header: 'Sản phẩm', cell: (o) => o.productName },
    { header: 'SL', cell: (o) => o.quantity, className: 'text-right' },
    { header: 'Tổng', cell: (o) => formatPrice(o.totalPrice), className: 'text-right font-medium' },
    { header: 'Trạng thái', cell: (o) => <StatusPill status={o.status} />, className: 'text-center' },
    { header: 'Key', cell: (o) => <KeyCell orderId={o.id} status={o.status} /> },
    { header: 'Thời gian', cell: (o) => <span className="text-xs text-clay-silver whitespace-nowrap">{formatDate(o.createdAt)}</span> },
    {
      header: 'Thao tác',
      className: 'text-center',
      hideOnCard: true,
      cell: (order) => (
        <div className="flex gap-1.5 justify-center flex-wrap">
          {rowActions(order)}
        </div>
      ),
    },
  ]

  function rowActions(order: Order) {
    if (order.status === 'pending' || order.status === 'paid') {
      return (
        <>
          <button
            onClick={() => confirmMutation.mutate(order.id)}
            disabled={confirmMutation.isPending}
            className="clay-btn clay-btn--matcha text-xs py-1 px-2 disabled:opacity-50"
          >Xác nhận</button>
          <button
            onClick={() => cancelMutation.mutate(order.id)}
            disabled={cancelMutation.isPending}
            className="clay-btn clay-btn--pomegranate text-xs py-1 px-2 disabled:opacity-50"
          >Hủy</button>
        </>
      )
    }
    if (order.status === 'delivered') {
      return (
        <button
          onClick={() => handleResend(order.id)}
          disabled={resendMutation.isPending}
          className="clay-btn clay-btn--ube text-xs py-1 px-2 disabled:opacity-50 flex items-center gap-1"
        >
          <Send size={12} />Gửi lại
        </button>
      )
    }
    return null
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="clay-display text-3xl mb-6">Đơn hàng</h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-clay-silver" />
            <input
              type="search"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Tìm theo mã đơn, mã CK, khách, sản phẩm..."
              className="clay-input text-sm w-72 pl-9"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPage(1)
            }}
            className="clay-input text-sm"
          >
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="text-sm text-clay-charcoal">Tổng: {total} đơn</span>
        </div>
      </div>

      <ResponsiveTable
        rows={orders}
        columns={columns}
        rowKey={(o) => o.id}
        loading={isLoading}
        emptyText="Chưa có đơn hàng nào"
        cardActions={rowActions}
      />

      {/* Phân trang */}
      {totalPages > 1 && (
        <div className="clay-card flex items-center justify-between px-4 py-3">
          <span className="text-sm text-clay-charcoal">
            Trang {page} / {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="clay-btn text-sm py-1.5 px-3 disabled:opacity-40"
            >
              Trước
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="clay-btn text-sm py-1.5 px-3 disabled:opacity-40"
            >
              Sau
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
