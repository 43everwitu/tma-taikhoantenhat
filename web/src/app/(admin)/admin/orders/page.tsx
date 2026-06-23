'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import { formatPrice, formatDate } from '@/lib/utils'
import { buildTelegramContactUrl, telegramContactTitle } from '@/lib/telegramContact'
import { Search, Clock, CheckCircle2, XCircle, Check, Eye, EyeOff, Copy, Send, X } from '@/lib/icons'
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
  productId: number
  bankName?: string
  source?: string
  createdAt: string
  paidAt?: string | null
  deliveredAt?: string | null
  expiresAt?: string | null
  deletedAt?: string | null
  deletedBy?: number | null
  keyExpiresAt?: string | null
  keyExpired?: boolean
  hasCustomerInput?: boolean
}

interface OrderDetail extends Order {
  accounts?: string[]
  inputFields?: Record<string, string>
  inputValueText?: string
  customer: {
    telegramId: string
    fullName: string | null
    username: string | null
  }
  product: {
    id: string
    name: string
    variantId: string | null
    variantName: string | null
    variantLabel: string
  } | null
  stockItems: Array<{
    id: string
    value: string
    variantId: string | null
    variantName: string | null
    soldAt: string | null
    durationDays: number | null
    expiresAt: string | null
    expired: boolean
  }>
  matchedTransaction: {
    id: string
    amount: number
    description: string | null
    transactionDate: string | null
    bankReference: string | null
  } | null
  renewalLogs: Array<{
    id: string
    stockId: string | null
    status: string
    expiryDate: string | null
    daysBeforeExpiry: number | null
    messagePreview: string
    createdAt: string
  }>
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

function SensitiveValue({ value, visible }: { value: string; visible: boolean }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <code
        className="font-mono text-xs bg-clay-oat-light px-2 py-1 rounded flex-1 min-w-0 break-all"
        title={visible ? value : 'Dữ liệu đang được ẩn'}
      >
        {visible ? value : '••••••••••••'}
      </code>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(value)}
        className="clay-btn p-1.5 shrink-0"
        title="Copy"
        aria-label="Copy dữ liệu"
      >
        <Copy size={12} />
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
  { value: 'expired', label: 'Hết hạn (chưa thanh toán)' },
  { value: 'expired_key', label: 'Key đã hết hạn' },
  { value: 'refunded', label: 'Đã hoàn tiền' },
]

export default function OrdersPage() {
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const highlightId = useHighlightId()
  const refFor = useHighlightedRowRef(highlightId)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null)
  const [showSensitive, setShowSensitive] = useState(false)
  const detailTriggerRef = useRef<HTMLElement | null>(null)
  const detailAsideRef = useRef<HTMLElement | null>(null)
  const detailCloseButtonRef = useRef<HTMLButtonElement | null>(null)
  const limit = 20

  useEffect(() => {
    if (searchParams.get('detail') !== '1' || !highlightId) return
    const timer = setTimeout(() => {
      setDetailOrderId(highlightId)
      setShowSensitive(false)
    }, 0)
    return () => clearTimeout(timer)
  }, [highlightId, searchParams])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!detailOrderId) return

    if (!detailTriggerRef.current && document.activeElement instanceof HTMLElement) {
      detailTriggerRef.current = document.activeElement
    }

    const focusTimer = setTimeout(() => {
      detailCloseButtonRef.current?.focus()
    }, 0)

    function handleDrawerKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setDetailOrderId(null)
        setShowSensitive(false)
        return
      }
      if (event.key !== 'Tab') return

      const drawer = detailAsideRef.current
      if (!drawer) return
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ))
      if (focusable.length === 0) {
        event.preventDefault()
        drawer.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (!drawer.contains(active)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleDrawerKeyDown)
    return () => {
      clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleDrawerKeyDown)
      const trigger = detailTriggerRef.current
      detailTriggerRef.current = null
      if (trigger?.isConnected) trigger.focus()
    }
  }, [detailOrderId])

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

  const {
    data: detailResponse,
    isLoading: detailLoading,
    isError: detailError,
  } = useQuery({
    queryKey: ['admin', 'order', detailOrderId, 'detail'],
    queryFn: () => api.get<OrderDetail>(`/admin/orders/${detailOrderId}`),
    enabled: !!detailOrderId,
  })

  function openDetail(id: string) {
    if (document.activeElement instanceof HTMLElement) {
      detailTriggerRef.current = document.activeElement
    }
    setDetailOrderId(id)
    setShowSensitive(false)
  }

  function closeDetail() {
    setDetailOrderId(null)
    setShowSensitive(false)
  }

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
    const detailButton = (
      <button
        type="button"
        onClick={() => openDetail(order.id)}
        className="clay-btn text-xs py-1 px-2"
      >
        Chi tiết
      </button>
    )
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
          {detailButton}
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
          {detailButton}
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
    return (
      <>
        {detailButton}
        {contactButton}
      </>
    )
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

      {detailOrderId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex justify-end" onClick={closeDetail}>
          <aside
            ref={detailAsideRef}
            className="bg-clay-cream w-full sm:max-w-2xl h-full overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Chi tiết đơn hàng #${detailOrderId}`}
            tabIndex={-1}
          >
            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-clay-oat px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-clay-silver">Chi tiết đơn hàng</p>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <h2 className="clay-display text-2xl">#{detailOrderId}</h2>
                  {detailResponse?.data && <StatusPill status={detailResponse.data.status} />}
                </div>
              </div>
              <button
                ref={detailCloseButtonRef}
                type="button"
                onClick={closeDetail}
                className="clay-btn p-2 shrink-0"
                aria-label="Đóng chi tiết đơn hàng"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 sm:p-6">
              {detailLoading && <p className="text-sm text-clay-charcoal">Đang tải chi tiết...</p>}
              {detailError && (
                <div className="clay-card p-4 text-sm text-red-700">
                  Không thể tải chi tiết đơn hàng.
                </div>
              )}
              {!detailLoading && !detailError && !detailResponse?.data && (
                <div className="clay-card p-4 text-sm text-clay-charcoal">
                  Không có dữ liệu chi tiết.
                </div>
              )}
              {detailResponse?.data && (() => {
                const detail = detailResponse.data
                const customerInputEntries = Object.entries(detail.inputFields ?? {}).filter(([, value]) => value)
                const stockValues = detail.stockItems.length > 0
                  ? detail.stockItems.map(item => ({ id: item.id, value: item.value, item }))
                  : (detail.accounts ?? []).map((value, index) => ({ id: `account-${index}`, value, item: null }))
                return (
                  <div className="space-y-4">
                    <section className="clay-card p-4">
                      <h3 className="font-semibold mb-3">Tổng quan</h3>
                      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                        <div><dt className="text-clay-silver">Tạo lúc</dt><dd>{formatDate(detail.createdAt)}</dd></div>
                        {detail.paidAt && <div><dt className="text-clay-silver">Thanh toán lúc</dt><dd>{formatDate(detail.paidAt)}</dd></div>}
                        {detail.deliveredAt && <div><dt className="text-clay-silver">Giao lúc</dt><dd>{formatDate(detail.deliveredAt)}</dd></div>}
                        {detail.expiresAt && <div><dt className="text-clay-silver">Hết hạn thanh toán</dt><dd>{formatDate(detail.expiresAt)}</dd></div>}
                        {detail.deletedAt && <div><dt className="text-clay-silver">Đã xóa lúc</dt><dd>{formatDate(detail.deletedAt)}</dd></div>}
                        {detail.deletedBy != null && <div><dt className="text-clay-silver">Đã xóa bởi</dt><dd>Admin #{detail.deletedBy}</dd></div>}
                        <div><dt className="text-clay-silver">Nguồn</dt><dd>{detail.source || '—'}</dd></div>
                        <div><dt className="text-clay-silver">Số lượng</dt><dd>{detail.quantity}</dd></div>
                        <div><dt className="text-clay-silver">Tổng tiền</dt><dd className="font-semibold">{formatPrice(detail.totalPrice)}</dd></div>
                      </dl>
                    </section>

                    <section className="clay-card p-4">
                      <h3 className="font-semibold mb-3">Khách hàng</h3>
                      <div className="space-y-1 text-sm">
                        <p className="font-medium">{detail.customer.fullName || detail.userName || 'Chưa có tên'}</p>
                        <p className="text-clay-charcoal">{detail.customer.username ? `@${detail.customer.username}` : 'Không có username'}</p>
                        <p className="font-mono text-xs text-clay-silver">Telegram ID {detail.customer.telegramId}</p>
                        <a
                          href={buildTelegramContactUrl({
                            username: detail.customer.username ?? undefined,
                            telegramId: detail.customer.telegramId,
                          })}
                          target="_blank"
                          rel="noreferrer"
                          className="clay-btn inline-flex text-xs mt-2"
                          title={telegramContactTitle({
                            username: detail.customer.username ?? undefined,
                            telegramId: detail.customer.telegramId,
                          })}
                        >
                          Nhắn tin Telegram
                        </a>
                      </div>
                    </section>

                    <section className="clay-card p-4">
                      <h3 className="font-semibold mb-3">Thanh toán</h3>
                      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                        <div><dt className="text-clay-silver">Mã thanh toán</dt><dd className="font-mono">{detail.paymentCode || detail.payment_code || '—'}</dd></div>
                        <div><dt className="text-clay-silver">Ngân hàng</dt><dd>{detail.bankName || '—'}</dd></div>
                        <div><dt className="text-clay-silver">Nguồn</dt><dd>{detail.source || '—'}</dd></div>
                      </dl>
                      <div className="mt-4 pt-4 border-t border-clay-oat">
                        <h4 className="text-sm font-medium mb-2">Giao dịch khớp</h4>
                        {detail.matchedTransaction ? (
                          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                            <div><dt className="text-clay-silver">Số tiền</dt><dd className="font-semibold">{formatPrice(detail.matchedTransaction.amount)}</dd></div>
                            <div><dt className="text-clay-silver">Thời gian</dt><dd>{detail.matchedTransaction.transactionDate ? formatDate(detail.matchedTransaction.transactionDate) : '—'}</dd></div>
                            <div><dt className="text-clay-silver">Mã tham chiếu</dt><dd className="font-mono break-all">{detail.matchedTransaction.bankReference || '—'}</dd></div>
                            <div><dt className="text-clay-silver">Nội dung</dt><dd className="break-words">{detail.matchedTransaction.description || '—'}</dd></div>
                          </dl>
                        ) : (
                          <p className="text-sm text-clay-silver">Chưa có giao dịch khớp.</p>
                        )}
                      </div>
                    </section>

                    <section className="clay-card p-4">
                      <h3 className="font-semibold mb-3">Sản phẩm</h3>
                      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                        <div><dt className="text-clay-silver">Sản phẩm</dt><dd>{detail.product?.name || detail.productName || '—'}</dd></div>
                        <div><dt className="text-clay-silver">Product ID</dt><dd className="font-mono">{detail.product?.id || detail.productId}</dd></div>
                        <div><dt className="text-clay-silver">Phiên bản</dt><dd>{detail.product?.variantLabel || 'mặc định/legacy'}</dd></div>
                        <div><dt className="text-clay-silver">Variant ID</dt><dd className="font-mono">{detail.product?.variantId || '—'}</dd></div>
                      </dl>
                    </section>

                    <section className="clay-card p-4">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div>
                          <h3 className="font-semibold">Dữ liệu nhạy cảm</h3>
                          <p className="text-xs text-clay-silver">Key và thông tin khách hàng được ẩn mặc định.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowSensitive(value => !value)}
                          aria-pressed={showSensitive}
                          className="clay-btn text-xs shrink-0 inline-flex items-center gap-1.5"
                        >
                          {showSensitive ? <EyeOff size={14} /> : <Eye size={14} />}
                          {showSensitive ? 'Ẩn tất cả' : 'Hiện tất cả'}
                        </button>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <h4 className="text-sm font-medium mb-2">Stock / key ({stockValues.length})</h4>
                          {stockValues.length > 0 ? (
                            <div className="space-y-2">
                              {stockValues.map(({ id, value, item }) => (
                                <div key={id} className="rounded-xl border border-clay-oat p-2 space-y-1.5">
                                  <SensitiveValue value={value} visible={showSensitive} />
                                  {item && (
                                    <p className="text-xs text-clay-silver">
                                      Stock #{item.id} · {item.variantName || 'mặc định/legacy'}
                                      {item.expiresAt ? ` · hết hạn ${item.expiresAt}` : ''}
                                      {item.expired ? ' · đã hết hạn' : ''}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-clay-silver">Không có stock/key.</p>
                          )}
                        </div>

                        <div className="pt-4 border-t border-clay-oat">
                          <h4 className="text-sm font-medium mb-2">Thông tin khách hàng</h4>
                          {customerInputEntries.length > 0 ? (
                            <div className="space-y-2">
                              {customerInputEntries.map(([label, value]) => (
                                <div key={label}>
                                  {formatInputFieldLabel(label) && <p className="text-xs text-clay-silver mb-1">{formatInputFieldLabel(label)}</p>}
                                  <SensitiveValue value={value} visible={showSensitive} />
                                </div>
                              ))}
                            </div>
                          ) : detail.inputValueText ? (
                            <SensitiveValue value={detail.inputValueText} visible={showSensitive} />
                          ) : (
                            <p className="text-sm text-clay-silver">Không có thông tin khách hàng.</p>
                          )}
                        </div>
                      </div>
                    </section>

                    <section className="clay-card p-4">
                      <h3 className="font-semibold mb-3">Gia hạn liên quan</h3>
                      {detail.renewalLogs.length > 0 ? (
                        <div className="space-y-2">
                          {detail.renewalLogs.map(log => (
                            <a
                              key={log.id}
                              href={`/admin/renewals?highlight=${encodeURIComponent(log.id)}`}
                              className="block rounded-xl border border-clay-oat p-3 hover:bg-clay-oat-light"
                            >
                              <div className="flex items-center justify-between gap-3 text-sm">
                                <span className="font-medium">Log #{log.id}</span>
                                <span className="text-clay-silver">{log.status}</span>
                              </div>
                              <p className="text-xs text-clay-silver mt-1">
                                {log.expiryDate || 'Không có ngày hết hạn'}
                                {log.daysBeforeExpiry != null ? ` · trước ${log.daysBeforeExpiry} ngày` : ''}
                                {log.createdAt ? ` · ${formatDate(log.createdAt)}` : ''}
                              </p>
                              {log.messagePreview && <p className="text-xs text-clay-charcoal mt-2 line-clamp-2">{log.messagePreview}</p>}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-clay-silver">Chưa có log gia hạn liên quan.</p>
                      )}
                    </section>
                  </div>
                )
              })()}
            </div>
          </aside>
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
