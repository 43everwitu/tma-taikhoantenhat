'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatPrice } from '@/lib/utils'
import { buildTelegramContactUrl, telegramContactTitle } from '@/lib/telegramContact'
import { Search, Users, Wallet, X } from '@/lib/icons'
import { ResponsiveTable, Column } from '@/components/ResponsiveTable'
import { useHighlightId, useHighlightedRowRef } from '@/lib/useHighlightedRow'

interface UserRow {
  telegram_id: number
  username: string | null
  full_name: string
  balance: number
  created_at: string | null
  order_count: number
  is_virtual?: boolean
}

interface UsersResponse {
  users: UserRow[]
  stats: { totalUsers: number; buyers: number; missingProfiles: number }
}

interface UsersMeta {
  page: number
  limit: number
  total: number
  totalPages?: number
}

interface UserDetail {
  user: UserRow
  orders: Array<{
    id: number
    product_name: string
    quantity: number
    total_price: number
    status: string
    created_at: string
  }>
  recentTopups: Array<{
    id: number
    amount: number
    memo: string
    status: string
    requested_at: string
    matched_at: string | null
  }>
}

export default function UsersPage() {
  const queryClient = useQueryClient()
  const highlightId = useHighlightId()
  const refFor = useHighlightedRowRef(highlightId)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [limit] = useState(20)
  const [selectedTgid, setSelectedTgid] = useState<number | null>(null)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustForm, setAdjustForm] = useState({ delta: 0, reason: '' })

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', page, limit, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(limit))
      if (debouncedSearch) params.set('search', debouncedSearch)
      return api.get<UsersResponse>(`/admin/users?${params.toString()}`)
    },
  })

  const { data: detailData } = useQuery({
    queryKey: ['admin', 'users', selectedTgid],
    queryFn: () => api.get<UserDetail>(`/admin/users/${selectedTgid}`),
    enabled: !!selectedTgid,
  })

  const adjustMutation = useMutation({
    mutationFn: ({ tgid, body }: { tgid: number; body: { delta: number; reason: string } }) =>
      api.post(`/admin/wallet/${tgid}/adjust`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      setAdjustOpen(false)
      setAdjustForm({ delta: 0, reason: '' })
    },
  })

  const users = data?.data.users ?? []
  const stats = data?.data.stats
  const meta = data?.meta as UsersMeta | undefined
  const totalPages = meta?.totalPages ?? (meta ? Math.ceil(meta.total / meta.limit) : 0)

  function openDetail(u: UserRow) {
    setSelectedTgid(u.telegram_id)
    setAdjustOpen(false)
    setAdjustForm({ delta: 0, reason: '' })
  }

  const columns: Column<UserRow>[] = [
    {
      header: 'Tên', primary: true,
      cell: (u) => (
        <button onClick={() => openDetail(u)} className="text-left hover:underline">
          <div className="font-medium flex items-center gap-2">
            <span>{u.full_name}</span>
            {u.is_virtual && (
              <span className="clay-pill text-[10px] px-2 py-0.5" style={{ background: 'var(--color-lemon-400)' }}>
                ảo
              </span>
            )}
          </div>
          <div className="text-xs text-clay-silver">
            {u.username ? `@${u.username}` : `ID ${u.telegram_id}`}
          </div>
        </button>
      ),
    },
    { header: 'Username', cell: (u) => <span className="text-clay-charcoal">{u.username ? `@${u.username}` : '—'}</span> },
    { header: 'Telegram ID', cell: (u) => <span className="font-mono text-xs text-clay-silver">{u.telegram_id}</span> },
    { header: 'Số dư', className: 'text-right font-medium', cell: (u) => formatPrice(u.balance) },
    { header: 'Đơn đã giao', className: 'text-right', cell: (u) => u.order_count },
    {
      header: 'Tham gia',
      cell: (u) => <span className="text-xs text-clay-charcoal">{u.created_at ? new Date(u.created_at).toLocaleDateString('vi') : '—'}</span>,
    },
    {
      header: 'Thao tác',
      className: 'text-center',
      cell: (u) => (
        <a
          href={buildTelegramContactUrl({ username: u.username, telegramId: u.telegram_id })}
          target="_blank"
          rel="noreferrer"
          title={telegramContactTitle({ username: u.username, telegramId: u.telegram_id })}
          className="clay-btn text-xs py-1 px-2"
        >
          Nhắn tin
        </a>
      ),
    },
  ]

  function closeDetail() {
    setSelectedTgid(null)
    setAdjustOpen(false)
  }

  function submitAdjust(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedTgid) return
    if (!adjustForm.delta) return alert('Nhập số tiền (âm để trừ).')
    if (!adjustForm.reason.trim()) return alert('Nhập lý do.')
    adjustMutation.mutate({ tgid: selectedTgid, body: adjustForm })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="clay-display text-3xl flex items-center gap-2">
          <Users size={28} />Người dùng
        </h1>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-clay-silver" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="Tìm theo tên, @username, ID..."
            className="clay-input text-sm w-72 pl-9"
          />
        </div>
      </div>

      {stats && (
        <div className="clay-card p-4 space-y-2">
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <div><span className="text-clay-silver">Tổng users:</span> <b>{stats.totalUsers}</b></div>
            <div><span className="text-clay-silver">Người mua:</span> <b>{stats.buyers}</b></div>
            <div><span className="text-clay-silver">Thiếu hồ sơ:</span> <b>{stats.missingProfiles}</b></div>
          </div>
          {stats.missingProfiles > 0 && (
            <p className="text-xs text-amber-700">
              Có {stats.missingProfiles} người mua thiếu hồ sơ user; đây là dòng người mua ảo từ đơn hàng không có bot profile.
            </p>
          )}
        </div>
      )}

      <ResponsiveTable
        rows={users}
        columns={columns}
        rowKey={(u) => u.telegram_id}
        loading={isLoading}
        emptyText="Không có người dùng nào"
        rowRef={refFor}
      />

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

      {/* Detail drawer */}
      {selectedTgid && (
        <div className="fixed inset-0 z-50 bg-black/50 flex justify-end" onClick={closeDetail}>
          <div
            className="bg-white w-full sm:max-w-xl h-full overflow-y-auto p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="clay-display text-2xl">Chi tiết người dùng</h2>
              <button onClick={closeDetail} className="clay-btn p-2"><X size={16} /></button>
            </div>

            {!detailData ? (
              <p className="text-clay-charcoal">Đang tải...</p>
            ) : (
              <div className="space-y-6">
                <div className="clay-card p-4">
                  <div className="text-lg font-semibold">{detailData.data.user.full_name}</div>
                  <div className="text-sm text-clay-charcoal">
                    {detailData.data.user.username ? `@${detailData.data.user.username}` : 'Không có username'}
                  </div>
                  <div className="font-mono text-xs text-clay-silver mt-1">ID {detailData.data.user.telegram_id}</div>
                  <div className="mt-3 text-2xl clay-display">
                    💼 {formatPrice(detailData.data.user.balance)}
                  </div>
                  {!detailData.data.user.is_virtual && (
                    <button
                      onClick={() => setAdjustOpen(true)}
                      className="clay-btn clay-btn--ube text-sm mt-3 flex items-center gap-1.5"
                    >
                      <Wallet size={16} />Điều chỉnh số dư
                    </button>
                  )}
                </div>

                {adjustOpen && !detailData.data.user.is_virtual && (
                  <form onSubmit={submitAdjust} className="clay-card-dashed p-4 space-y-3">
                    <h3 className="font-semibold">Điều chỉnh số dư</h3>
                    <p className="text-xs text-clay-charcoal">
                      Số dương để cộng, âm để trừ. Mọi thay đổi được ghi audit log.
                    </p>
                    <input
                      type="number"
                      value={adjustForm.delta || ''}
                      onChange={(e) => setAdjustForm(f => ({ ...f, delta: Number(e.target.value) }))}
                      placeholder="Ví dụ: 50000 hoặc -10000"
                      className="clay-input w-full text-sm"
                      required
                    />
                    <input
                      type="text"
                      value={adjustForm.reason}
                      onChange={(e) => setAdjustForm(f => ({ ...f, reason: e.target.value }))}
                      placeholder="Lý do (bắt buộc)"
                      className="clay-input w-full text-sm"
                      maxLength={500}
                      required
                    />
                    <div className="flex gap-2 justify-end">
                      <button type="button" onClick={() => setAdjustOpen(false)} className="clay-btn text-sm">Huỷ</button>
                      <button
                        type="submit"
                        disabled={adjustMutation.isPending}
                        className="clay-btn clay-btn--ink text-sm disabled:opacity-50"
                      >
                        {adjustMutation.isPending ? 'Đang lưu...' : 'Áp dụng'}
                      </button>
                    </div>
                  </form>
                )}

                <div>
                  <h3 className="font-semibold mb-2">Đơn hàng gần đây</h3>
                  {detailData.data.orders.length === 0 ? (
                    <p className="text-clay-silver text-sm">Chưa có đơn hàng.</p>
                  ) : (
                    <ul className="space-y-2">
                      {detailData.data.orders.slice(0, 10).map(o => (
                        <li key={o.id} className="clay-card p-3 text-sm flex items-center justify-between">
                          <div>
                            <div className="font-medium">#{o.id} · {o.product_name}</div>
                            <div className="text-xs text-clay-charcoal">SL {o.quantity} · {new Date(o.created_at).toLocaleString('vi')}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-medium">{formatPrice(o.total_price)}</div>
                            <div className="text-xs text-clay-silver">{o.status}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h3 className="font-semibold mb-2">Nạp tiền gần đây</h3>
                  {detailData.data.recentTopups.length === 0 ? (
                    <p className="text-clay-silver text-sm">Chưa có yêu cầu nạp.</p>
                  ) : (
                    <ul className="space-y-2">
                      {detailData.data.recentTopups.map(t => (
                        <li key={t.id} className="clay-card p-3 text-sm flex items-center justify-between">
                          <div>
                            <div className="font-mono text-xs">{t.memo}</div>
                            <div className="text-xs text-clay-charcoal">{new Date(t.requested_at).toLocaleString('vi')}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-medium">{formatPrice(t.amount)}</div>
                            <div className="text-xs text-clay-silver">{t.status}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
