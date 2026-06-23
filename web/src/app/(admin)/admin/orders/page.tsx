'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatPrice, formatDate } from '@/lib/utils'
import { buildTelegramContactUrl, telegramContactTitle } from '@/lib/telegramContact'
import { Search, Clock, CheckCircle2, XCircle, Check, Eye, EyeOff, Copy, Send } from '@/lib/icons'
import { ResponsiveTable, Column } from '@/components/ResponsiveTable'
import { useHighlightId, useHighlightedRowRef } from '@/lib/useHighlightedRow'

interface Order {
  id: string
  userId: string
  userName: string
  username?: string
  productName: string
  quantity: number
  totalPrice: number
  status: string
  paymentCode?: string
  payment_code?: string
  createdAt: string
  keyExpiresAt?: string | null
  keyExpired?: boolean
  hasCustomerInput?: boolean
}

interface OrderDetail extends Order {
  accounts?: string[]
  inputFields?: Record<string, string>
  inputValueText?: string
}

function formatInputFieldLabel(label: string) {
  if (!label || /^__field_\d+$/.test(label)) return null
  return label
}

function CustomerInputBlock({ inputFields, inputValueText }: { inputFields?: Record<string, string>; inputValueText?: string }) {
  if (!inputFields && !inputValueText) return null
  return (
    <div className="rounded-md bg-yellow-50 border border-yellow-200 px-2 py-1.5 text-xs">
      <p className="font-medium opacity-70 mb-0.5">Thông tin KH:</p>
      {inputFields
        ? <ul className="space-y-0.5">
            {Object.entries(inputFields).filter(([, v]) => v).map(([label, v]) => {
              const displayLabel = formatInputFieldLabel(label)
              return (
                <li key={label}>
                  {displayLabel ? <><b>{displayLabel}:</b> </> : null}
                  <code className="font-mono">{v}</code>
                </li>
              )
            })}
          </ul>
        : <p className="font-mono break-all">{inputValueText}</p>
      }
    </div>
  )
}

function OrderExtraCell({ orderId, status, hasCustomerInput }: { orderId: string; status: string; hasCustomerInput?: boolean }) {
  const [revealed, setRevealed] = useState(false)
  const showKeys = status === 'delivered'
  const showCustomerOnly = !showKeys && hasCustomerInput && (status === 'paid' || status === 'pending')
  const canReveal = showKeys || showCustomerOnly

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'order', orderId, 'detail'],
    queryFn: () => api.get<OrderDetail>(`/admin/orders/${orderId}`),
    enabled: revealed && canReveal,
  })

  if (!canReveal) {
    return <span className="text-clay-silver text-xs">—</span>
  }

  if (!revealed) {
    return (
      <button
        onClick={() => setRevealed(true)}
        className="inline-flex items-center gap-1.5 text-xs text-clay-charcoal hover:text-clay-ink"
        title={showKeys ? 'Hiện key' : 'Xem thông tin khách'}
      >
        <Eye size={14} />
        {showKeys
          ? <span className="font-mono blur-sm select-none">••••••••••••</span>
          : <span>Thông tin KH</span>}
      </button>
    )
  }

  if (isLoading) {
    return <span className="text-clay-silver text-xs">Đang tải...</span>
  }

  const accounts = data?.data?.accounts ?? []
  const inputFields = data?.data?.inputFields
  const inputValueText = data?.data?.inputValueText
  const hasContent = accounts.length > 0 || inputFields || inputValueText

  if (!hasContent) {
    return (
      <button
        onClick={() => setRevealed(false)}
        className="inline-flex items-center gap-1 text-xs text-clay-silver hover:text-clay-charcoal"
      >
        <EyeOff size={12} /> (không có)
      </button>
    )
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setRevealed(false)}
        className="inline-flex items-center gap-1.5 text-xs text-clay-charcoal"
        title="Ẩn"
      >
        <EyeOff size={14} />
        <span className="font-mono">
          {accounts.length > 0 ? `${accounts.length} key` : 'Thông tin KH'}
        </span>
      </button>
      <div
        className="absolute z-30 top-full mt-1 left-0 min-w-[260px] max-w-md bg-white rounded-lg shadow-xl border border-clay-oat-light p-2 space-y-1"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <CustomerInputBlock inputFields={inputFields} inputValueText={inputValueText} />
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
      </div>
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
  { value: 'expired', label: 'Hết hạn (chưa thanh toán)' },
  { value: 'expired_key', label: 'Key đã hết hạn' },
  { value: 'refunded', label: 'Đã hoàn tiền' },
]

export default function OrdersPage() {
  const queryClient = useQueryClient()
  const highlightId = useHighlightId()
  const refFor = useHighlightedRowRef(highlightId)
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
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
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

  const manualDeliverMutation = useMutation({
    mutationFn: ({ id, accounts, durationDays }: { id: string; accounts: string[]; durationDays?: number }) =>
      api.post(`/admin/orders/${id}/manual-deliver`, { accounts, ...(durationDays ? { durationDays } : {}) }),
    onSuccess: (_res, vars) => {
      alert('✅ Đã giao thủ công + gửi key cho khách.')
      queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] })
      queryClient.removeQueries({ queryKey: ['admin', 'order', vars.id, 'detail'] })
      setManualOrderId(null)
      setManualText('')
    },
    onError: (e) => alert(`❌ ${e instanceof Error ? e.message : 'Giao thất bại'}`),
  })

  const editKeysMutation = useMutation({
    mutationFn: ({ id, accounts }: { id: string; accounts: string[] }) =>
      api.patch(`/admin/orders/${id}/keys`, { accounts }),
    onSuccess: (_res, vars) => {
      alert('✅ Đã cập nhật key.')
      queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'order', vars.id, 'detail'] })
      queryClient.removeQueries({ queryKey: ['admin', 'order', vars.id, 'detail'] })
      setEditOrderId(null)
      setEditText('')
    },
    onError: (e) => alert(`❌ ${e instanceof Error ? e.message : 'Cập nhật thất bại'}`),
  })

  function handleResend(id: string) {
    if (!confirm(`Gửi lại key đơn #${id} cho khách qua Telegram?`)) return
    resendMutation.mutate(id)
  }

  const [manualOrderId, setManualOrderId] = useState<string | null>(null)
  const [manualText, setManualText] = useState('')
  const [manualDuration, setManualDuration] = useState<string>('')
  const [editOrderId, setEditOrderId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  const { data: manualOrderDetail } = useQuery({
    queryKey: ['admin', 'order', manualOrderId, 'detail'],
    queryFn: () => api.get<OrderDetail>(`/admin/orders/${manualOrderId}`),
    enabled: !!manualOrderId,
  })

  async function openEditKeys(order: Order) {
    setEditOrderId(order.id)
    setEditText('')
    try {
      const r = await api.get<OrderDetail>(`/admin/orders/${order.id}`)
      setEditText((r.data.accounts || []).join('\n'))
    } catch {}
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
    { header: 'Key', cell: (o) => <OrderExtraCell orderId={o.id} status={o.status} hasCustomerInput={o.hasCustomerInput} /> },
    { header: 'Hết hạn', cell: (o) => o.keyExpiresAt
        ? <span className={`text-xs whitespace-nowrap ${o.keyExpired ? 'text-red-600 font-medium' : 'text-clay-silver'}`}>{o.keyExpiresAt}{o.keyExpired ? ' ⚠' : ''}</span>
        : <span className="text-xs text-clay-silver">—</span>,
      className: 'text-center' },
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
    const contactButton = order.userId ? (
      <a
        href={buildTelegramContactUrl({ username: order.username, telegramId: order.userId })}
        target="_blank"
        rel="noreferrer"
        title={telegramContactTitle({ username: order.username, telegramId: order.userId })}
        className="clay-btn text-xs py-1 px-2"
      >
        Nhắn tin
      </a>
    ) : null

    if (order.status === 'pending' || order.status === 'paid') {
      return (
        <>
          {contactButton}
          <button
            onClick={() => confirmMutation.mutate(order.id)}
            disabled={confirmMutation.isPending}
            className="clay-btn clay-btn--matcha text-xs py-1 px-2 disabled:opacity-50"
          >Xác nhận</button>
          <button
            onClick={() => { setManualOrderId(order.id); setManualText('') }}
            className="clay-btn clay-btn--lemon text-xs py-1 px-2"
          >Giao thủ công</button>
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
        <>
          {contactButton}
          <button
            onClick={() => handleResend(order.id)}
            disabled={resendMutation.isPending}
            className="clay-btn clay-btn--ube text-xs py-1 px-2 disabled:opacity-50 flex items-center gap-1"
          >
            <Send size={12} />Gửi lại
          </button>
          <button
            onClick={() => openEditKeys(order)}
            className="clay-btn text-xs py-1 px-2"
          >Sửa key</button>
        </>
      )
    }
    return contactButton
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
        rowRef={refFor}
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

      {manualOrderId && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setManualOrderId(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Giao thủ công đơn #{manualOrderId}</h3>
              <button onClick={() => setManualOrderId(null)} className="opacity-60 text-xl leading-none">×</button>
            </div>
            <p className="text-xs opacity-70">Mỗi dòng là 1 key. Bot sẽ gửi danh sách này cho khách kèm hướng dẫn sản phẩm.</p>
            {(manualOrderDetail?.data?.inputFields || manualOrderDetail?.data?.inputValueText) && (
              <CustomerInputBlock
                inputFields={manualOrderDetail.data.inputFields}
                inputValueText={manualOrderDetail.data.inputValueText}
              />
            )}
            <label className="block text-sm">
              <span className="text-xs opacity-70 mb-1 inline-block">Thời hạn (ngày, trống = dùng mặc định)</span>
              <input
                type="number"
                min={1}
                value={manualDuration}
                onChange={(e) => setManualDuration(e.target.value)}
                placeholder="VD: 30"
                className="clay-input w-full text-sm"
              />
            </label>
            <textarea
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              rows={8}
              placeholder={"key1\nkey2\nkey3"}
              className="clay-input w-full font-mono text-sm"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setManualOrderId(null)} className="clay-btn text-sm">Huỷ</button>
              <button
                onClick={() => {
                  const accounts = manualText.split('\n').map((s) => s.trim()).filter(Boolean)
                  if (accounts.length === 0) { alert('Chưa nhập key nào'); return }
                  const dur = manualDuration ? Number(manualDuration) : undefined
                  manualDeliverMutation.mutate({ id: manualOrderId, accounts, durationDays: dur })
                }}
                disabled={manualDeliverMutation.isPending}
                className="clay-btn clay-btn--lemon text-sm"
              >{manualDeliverMutation.isPending ? 'Đang giao…' : 'Giao + gửi tin nhắn'}</button>
            </div>
          </div>
        </div>
      )}

      {editOrderId && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setEditOrderId(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Sửa key đơn #{editOrderId}</h3>
              <button onClick={() => setEditOrderId(null)} className="opacity-60 text-xl leading-none">×</button>
            </div>
            <p className="text-xs opacity-70">Sửa danh sách key (mỗi dòng 1 key). Không tự động gửi lại — bấm Gửi lại key sau khi lưu nếu cần.</p>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={8}
              className="clay-input w-full font-mono text-sm"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditOrderId(null)} className="clay-btn text-sm">Huỷ</button>
              <button
                onClick={() => {
                  const accounts = editText.split('\n').map((s) => s.trim()).filter(Boolean)
                  if (accounts.length === 0) { alert('Cần ít nhất 1 key'); return }
                  editKeysMutation.mutate({ id: editOrderId, accounts })
                }}
                disabled={editKeysMutation.isPending}
                className="clay-btn clay-btn--lemon text-sm"
              >{editKeysMutation.isPending ? 'Đang lưu…' : 'Lưu'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
