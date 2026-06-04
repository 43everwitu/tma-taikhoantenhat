'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatPrice } from '@/lib/utils'
import { Search, Wallet, Check, X } from '@/lib/icons'
import { ResponsiveTable, Column } from '@/components/ResponsiveTable'
import { useHighlightId, useHighlightedRowRef } from '@/lib/useHighlightedRow'

interface Topup {
  id: number
  userId: number
  userName: string | null
  username: string | null
  amount: number
  memo: string
  status: 'pending' | 'awaiting_credit' | 'matched' | 'expired' | 'cancelled'
  mbTransactionNumber: string | null
  requestedAt: string
  matchedAt: string | null
  expiresAt: string | null
  cancelReason: string | null
}

const STATUS_LABEL: Record<Topup['status'], string> = {
  pending: 'Chờ CK',
  awaiting_credit: 'Chờ duyệt',
  matched: 'Đã cộng',
  expired: 'Hết hạn',
  cancelled: 'Đã hủy',
}

const STATUS_BG: Record<Topup['status'], string> = {
  pending: 'var(--color-lemon-100)',
  awaiting_credit: 'var(--color-lemon-400)',
  matched: 'var(--color-matcha-300)',
  expired: 'var(--color-clay-oat-light)',
  cancelled: 'var(--color-pomegranate-100)',
}

export default function TopupsPage() {
  const queryClient = useQueryClient()
  const highlightId = useHighlightId()
  const refFor = useHighlightedRowRef(highlightId)
  const [statusFilter, setStatusFilter] = useState<'' | Topup['status']>('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'topups', statusFilter, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (debouncedSearch) params.set('search', debouncedSearch)
      return api.get<Topup[]>(`/admin/topups${params.toString() ? '?' + params.toString() : ''}`)
    },
  })

  const creditMutation = useMutation({
    mutationFn: (id: number) => api.post(`/admin/topups/${id}/manual-credit`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'topups'] }),
  })

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      api.post(`/admin/topups/${id}/cancel`, { reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'topups'] }),
  })

  const topups = data?.data ?? []

  function handleCredit(t: Topup) {
    if (!confirm(`Cộng thủ công ${formatPrice(t.amount)} cho user ${t.userId}?\nHành động này ghi audit log.`)) return
    creditMutation.mutate(t.id)
  }

  function handleCancel(t: Topup) {
    const reason = prompt(`Lý do hủy yêu cầu nạp #${t.id}?`)
    if (!reason || !reason.trim()) return
    cancelMutation.mutate({ id: t.id, reason: reason.trim() })
  }

  const columns: Column<Topup>[] = [
    { header: '#', cell: (t) => <span className="font-mono text-xs">{t.id}</span> },
    {
      header: 'User', primary: true,
      cell: (t) => (
        <>
          <div className="font-medium">{t.userName || '—'}</div>
          <div className="text-xs text-clay-silver">
            {t.username ? `@${t.username}` : `ID ${t.userId}`}
          </div>
        </>
      ),
    },
    { header: 'Memo', cell: (t) => <span className="font-mono text-xs">{t.memo}</span> },
    { header: 'Số tiền', className: 'text-right font-medium', cell: (t) => formatPrice(t.amount) },
    {
      header: 'Trạng thái', className: 'text-center',
      cell: (t) => (
        <span className="clay-pill" style={{ background: STATUS_BG[t.status] }}>
          {STATUS_LABEL[t.status]}
        </span>
      ),
    },
    {
      header: 'Yêu cầu',
      cell: (t) => (
        <span className="text-clay-charcoal text-xs">
          {new Date(t.requestedAt).toLocaleString('vi')}
          {t.matchedAt && (
            <div className="text-clay-silver">→ khớp {new Date(t.matchedAt).toLocaleString('vi')}</div>
          )}
        </span>
      ),
    },
    {
      header: 'Thao tác', className: 'text-center', hideOnCard: true,
      cell: (t) => (t.status === 'pending' || t.status === 'awaiting_credit') ? (
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <button
            onClick={() => handleCredit(t)}
            disabled={creditMutation.isPending}
            className="clay-btn clay-btn--matcha text-xs py-1 px-3 flex items-center gap-1 disabled:opacity-50"
          ><Check size={14} />Cộng</button>
          <button
            onClick={() => handleCancel(t)}
            disabled={cancelMutation.isPending}
            className="clay-btn clay-btn--pomegranate text-xs py-1 px-3 flex items-center gap-1 disabled:opacity-50"
          ><X size={14} />Hủy</button>
        </div>
      ) : <span className="text-clay-silver text-xs">—</span>,
    },
  ]

  function cardActions(t: Topup) {
    if (t.status !== 'pending' && t.status !== 'awaiting_credit') return null
    return (
      <>
        <button
          onClick={() => handleCredit(t)}
          disabled={creditMutation.isPending}
          className="clay-btn clay-btn--matcha text-xs py-1 px-3 flex items-center gap-1 disabled:opacity-50"
        ><Check size={14} />Cộng</button>
        <button
          onClick={() => handleCancel(t)}
          disabled={cancelMutation.isPending}
          className="clay-btn clay-btn--pomegranate text-xs py-1 px-3 flex items-center gap-1 disabled:opacity-50"
        ><X size={14} />Hủy</button>
      </>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="clay-display text-3xl flex items-center gap-2">
          <Wallet size={28} />Nạp tiền
        </h1>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-clay-silver" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Memo, user ID, username..."
            className="clay-input text-sm w-64 pl-9"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['', 'pending', 'awaiting_credit', 'matched', 'expired', 'cancelled'] as const).map(s => (
          <button
            key={s || 'all'}
            onClick={() => setStatusFilter(s)}
            className="clay-pill cursor-pointer"
            style={statusFilter === s
              ? { background: 'var(--color-clay-ink)', color: '#fff', borderColor: 'var(--color-clay-ink)' }
              : {}}
          >
            {s === '' ? 'Tất cả' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <ResponsiveTable
        rows={topups}
        columns={columns}
        rowKey={(t) => t.id}
        loading={isLoading}
        emptyText="Chưa có yêu cầu nạp nào"
        cardActions={cardActions}
        rowRef={refFor}
      />
    </div>
  )
}
