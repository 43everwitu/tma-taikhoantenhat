'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Search, Clock, CheckCircle2, XCircle } from '@/lib/icons'
import { ResponsiveTable, Column } from '@/components/ResponsiveTable'

type RenewalStatus = 'sent' | 'sent_legacy' | 'skipped' | 'failed' | 'exhausted'

interface RenewalLog {
  id: string
  stockId: string | null
  orderId: string | null
  userId: string
  productId: string
  productName: string
  expiryDate: string | null
  daysBeforeExpiry: number | null
  telegramSent: boolean
  webNotificationId: string | null
  status: RenewalStatus
  errorMessage: string | null
  messageBody: string
  createdAt: string
}

interface RenewalResponse {
  items: RenewalLog[]
  total: number
  page: number
  limit: number
}

interface RenewalSweepSummary {
  scanned: number
  sent: number
  skipped: number
  failed: number
  exhausted: number
}

const STATUS_LABEL: Record<RenewalStatus, string> = {
  sent: 'Đã gửi',
  sent_legacy: 'Đã gửi (khôi phục)',
  skipped: 'Bỏ qua',
  failed: 'Lỗi',
  exhausted: 'Dừng retry',
}

const STATUS_BG: Record<RenewalStatus, string> = {
  sent: 'var(--color-matcha-300)',
  sent_legacy: 'var(--color-matcha-100)',
  skipped: 'var(--color-clay-oat-light)',
  failed: 'var(--color-pomegranate-100)',
  exhausted: 'var(--color-clay-silver)',
}

export default function RenewalsPage() {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<'' | RenewalStatus>('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sweepResult, setSweepResult] = useState<RenewalSweepSummary | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'renewals', statusFilter, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (debouncedSearch) params.set('q', debouncedSearch)
      return api.get<RenewalResponse>(`/admin/renewals${params.toString() ? '?' + params.toString() : ''}`)
    },
  })

  const sweepMutation = useMutation({
    mutationFn: () => api.post<RenewalSweepSummary>('/admin/renewals/sweep', {}),
    onSuccess: (res) => {
      setSweepResult(res.data)
      queryClient.invalidateQueries({ queryKey: ['admin', 'renewals'] })
    },
  })

  const rows = data?.data.items ?? []
  const total = data?.data.total ?? 0

  const columns: Column<RenewalLog>[] = [
    { header: '#', cell: (r) => <span className="font-mono text-xs">{r.id}</span> },
    {
      header: 'Đơn', primary: true,
      cell: (r) => r.orderId ? (
        <Link href={`/admin/orders?highlight=${r.orderId}`} className="font-mono text-sm underline underline-offset-2">
          #{r.orderId}
        </Link>
      ) : <span className="text-clay-silver">—</span>,
    },
    {
      header: 'Khách',
      cell: (r) => <span className="font-mono text-xs">{r.userId}</span>,
    },
    {
      header: 'Sản phẩm',
      cell: (r) => (
        <div>
          <div className="font-medium">{r.productName}</div>
          <div className="text-xs text-clay-silver">Product #{r.productId}{r.stockId ? ` · Stock #${r.stockId}` : ''}</div>
        </div>
      ),
    },
    {
      header: 'Hết hạn',
      cell: (r) => (
        <div className="text-sm">
          <div>{r.expiryDate || '—'}</div>
          {r.daysBeforeExpiry !== null && <div className="text-xs text-clay-silver">Còn {r.daysBeforeExpiry} ngày</div>}
        </div>
      ),
    },
    {
      header: 'Kênh',
      cell: (r) => (
        <div className="text-xs text-clay-charcoal">
          <div>{r.telegramSent ? 'Telegram: đã gửi' : 'Telegram: chưa gửi'}</div>
          <div>{r.webNotificationId ? `TMA: #${r.webNotificationId}` : 'TMA: —'}</div>
        </div>
      ),
    },
    {
      header: 'Trạng thái', className: 'text-center',
      cell: (r) => (
        <span className="clay-pill" style={{ background: STATUS_BG[r.status] }}>
          {STATUS_LABEL[r.status]}
        </span>
      ),
    },
    {
      header: 'Thời gian',
      cell: (r) => <span className="text-xs text-clay-silver whitespace-nowrap">{formatDate(r.createdAt)}</span>,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="clay-display text-3xl flex items-center gap-2">
            <Clock size={28} />Gia hạn
          </h1>
          <p className="text-sm text-clay-charcoal mt-1">
            Theo dõi các tin nhắc tài khoản/key sắp hết hạn đã gửi cho khách.
          </p>
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-clay-silver" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Đơn, user, sản phẩm..."
            className="clay-input text-sm w-64 pl-9"
          />
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-wrap gap-2">
          {(['', 'sent', 'sent_legacy', 'skipped', 'failed', 'exhausted'] as const).map(s => (
            <button
              key={s || 'all'}
              onClick={() => setStatusFilter(s)}
              className="clay-pill cursor-pointer inline-flex items-center gap-1.5"
              style={statusFilter === s
                ? { background: 'var(--color-clay-ink)', color: '#fff', borderColor: 'var(--color-clay-ink)' }
                : {}}
            >
              {s === 'sent' && <CheckCircle2 size={13} />}
              {s === 'failed' && <XCircle size={13} />}
              {s === '' ? 'Tất cả' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => sweepMutation.mutate()}
            disabled={sweepMutation.isPending}
            className="clay-btn clay-btn--lemon text-sm"
          >
            {sweepMutation.isPending ? 'Đang quét...' : 'Quét gia hạn ngay'}
          </button>
          <span className="text-xs text-clay-silver">{total} bản ghi</span>
        </div>
      </div>

      {sweepResult && (
        <div className="clay-card p-3 text-sm">
          Đã quét {sweepResult.scanned} key · Gửi {sweepResult.sent} · Bỏ qua {sweepResult.skipped} · Lỗi {sweepResult.failed} · Dừng retry {sweepResult.exhausted}
        </div>
      )}

      <ResponsiveTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        loading={isLoading}
        emptyText="Chưa có log gia hạn nào"
      />
    </div>
  )
}
