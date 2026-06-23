'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { api, audit } from '@/lib/api'
import type { AuditRow } from '@/lib/api'
import { AuditDetailModal } from '@/components/AuditDetailModal'
import { ChevronLeft, ChevronRight, X } from '@/lib/icons'

const ENTITY_NAV: Record<string, (id: number) => string> = {
  order:        (id) => `/admin/orders?highlight=${id}`,
  user:         (id) => `/admin/users?highlight=${id}`,
  product:      (id) => `/admin/products?highlight=${id}`,
  topup:        (id) => `/admin/topups?highlight=${id}`,
  admin:        (id) => `/admin/admins?highlight=${id}`,
  stock:        (id) => `/admin/stock?highlight=${id}`,
  discount:     (id) => `/admin/discounts?highlight=${id}`,
  announcement: ()   => `/admin/announcements`,
}

const PAGE_LIMIT = 50

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function parseDbDate(s: string): Date {
  // SQLite CURRENT_TIMESTAMP yields 'YYYY-MM-DD HH:MM:SS' UTC; append Z so JS parses as UTC.
  return new Date(s.replace(' ', 'T') + 'Z')
}

function localToUtcDbString(local: string, endOfMinute = false): string {
  const d = new Date(local) // browser parses as local time
  const iso = d.toISOString() // 'YYYY-MM-DDTHH:MM:SS.000Z' in UTC
  // Strip milliseconds + 'Z'; replace 'T' with ' '.
  const base = iso.slice(0, 19).replace('T', ' ')
  return endOfMinute ? base.slice(0, 17) + '59' : base
}

interface AdminListRow { id: number; username: string; displayName: string }

export default function AuditPage() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [adminId, setAdminId] = useState('')
  const [entityType, setEntityType] = useState('')
  const [page, setPage] = useState(1)
  const [modalRow, setModalRow] = useState<AuditRow | null>(null)

  const debouncedQ = useDebounced(q, 300)

  const adminsQuery = useQuery({
    queryKey: ['admin', 'admins-list-for-audit'],
    queryFn: () => api.get<AdminListRow[]>('/admin/admins'),
    staleTime: 5 * 60_000,
  })
  const admins = adminsQuery.data?.data ?? []

  const entityTypesQuery = useQuery({
    queryKey: ['admin', 'audit', 'entity-types'],
    queryFn: () => audit.entityTypes(),
    staleTime: 5 * 60_000,
  })
  const entityTypes = entityTypesQuery.data?.data ?? []

  const listQuery = useQuery({
    queryKey: ['admin', 'audit', 'list', { q: debouncedQ, from, to, adminId, entityType, page }],
    queryFn: () => audit.list({
      q: debouncedQ || undefined,
      from: from ? localToUtcDbString(from, false) : undefined,
      to:   to   ? localToUtcDbString(to,   true)  : undefined,
      adminId: adminId ? Number(adminId) : undefined,
      entityType: entityType || undefined,
      page,
      limit: PAGE_LIMIT,
    }),
    staleTime: 30_000,
  })
  const rows = listQuery.data?.data ?? []
  const total = listQuery.data?.meta?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT))

  const filtersActive = useMemo(
    () => !!(q || from || to || adminId || entityType),
    [q, from, to, adminId, entityType]
  )

  function reset() {
    setQ(''); setFrom(''); setTo(''); setAdminId(''); setEntityType(''); setPage(1)
  }

  function handleRowClick(row: AuditRow) {
    const builder = row.entity_type ? ENTITY_NAV[row.entity_type] : undefined
    if (builder && row.entity_id !== null) {
      router.push(builder(row.entity_id))
      return
    }
    if (builder) {
      router.push(builder(0))
      return
    }
    setModalRow(row)
  }

  function parseDetails(s: string | null): Record<string, unknown> | null {
    if (!s) return null
    try {
      const v = JSON.parse(s)
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
    } catch {
      return null
    }
  }

  function truncate(s: string | null, n: number) {
    if (!s) return '—'
    return s.length > n ? s.slice(0, n) + '…' : s
  }

  return (
    <div className="p-4 lg:p-6">
      <h1 className="text-2xl font-semibold mb-4">Lịch sử</h1>

      <div className="clay-card p-3 mb-4 grid gap-3 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_max-content]">
        <input
          type="search"
          placeholder="Tìm theo action hoặc details…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1) }}
          className="clay-input"
          aria-label="Tìm kiếm"
        />
        <input
          type="datetime-local"
          value={from}
          onChange={(e) => { setFrom(e.target.value); setPage(1) }}
          className="clay-input"
          aria-label="Từ"
        />
        <input
          type="datetime-local"
          value={to}
          onChange={(e) => { setTo(e.target.value); setPage(1) }}
          className="clay-input"
          aria-label="Đến"
        />
        <select
          value={adminId}
          onChange={(e) => { setAdminId(e.target.value); setPage(1) }}
          className="clay-input"
          aria-label="Admin"
        >
          <option value="">Tất cả admin</option>
          {admins.map(a => (
            <option key={a.id} value={a.id}>{a.displayName || a.username}</option>
          ))}
        </select>
        <select
          value={entityType}
          onChange={(e) => { setEntityType(e.target.value); setPage(1) }}
          className="clay-input"
          aria-label="Entity"
        >
          <option value="">Tất cả entity</option>
          {entityTypes.map(et => (
            <option key={et} value={et}>{et}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={reset}
          className="clay-btn flex items-center gap-1"
          disabled={!filtersActive}
        >
          <X size={14} /> Xoá lọc
        </button>
      </div>

      <div className="clay-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left opacity-70">
            <tr>
              <th className="px-3 py-2">Thời gian</th>
              <th className="px-3 py-2">Admin</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Chi tiết</th>
              <th className="px-3 py-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && (
              <tr><td colSpan={6} className="px-3 py-6 text-center opacity-60">Đang tải…</td></tr>
            )}
            {!listQuery.isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center opacity-60">Không có bản ghi.</td></tr>
            )}
            {rows.map(row => (
              <tr
                key={row.id}
                onClick={() => handleRowClick(row)}
                className="border-t border-black/5 hover:bg-black/[0.02] cursor-pointer"
              >
                <td className="px-3 py-2 whitespace-nowrap">{parseDbDate(row.created_at).toLocaleString('vi-VN')}</td>
                <td className="px-3 py-2">{row.admin_name ?? '(system)'}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-black/5">
                    {row.action}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div>{row.entity_type ?? '—'}{row.entity_id !== null ? ` #${row.entity_id}` : ''}</div>
                  {(() => {
                    const d = parseDetails(row.details)
                    const label = d && typeof d.entityLabel === 'string' ? d.entityLabel : null
                    return label ? <div className="text-xs opacity-60 truncate max-w-[220px]">{label}</div> : null
                  })()}
                </td>
                <td className="px-3 py-2 max-w-[420px]">{truncate(row.details, 80)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{row.ip_address ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3 text-sm opacity-80">
        <div>Tổng {total} bản ghi · Trang {page}/{totalPages}</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1 || listQuery.isLoading}
            className="clay-btn p-2"
            aria-label="Trang trước"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || listQuery.isLoading}
            className="clay-btn p-2"
            aria-label="Trang sau"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <AuditDetailModal row={modalRow} onClose={() => setModalRow(null)} />
    </div>
  )
}
