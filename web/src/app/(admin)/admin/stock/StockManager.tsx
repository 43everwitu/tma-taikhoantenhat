'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Pencil, Search, Trash2, X } from '@/lib/icons'
import { ResponsiveTable, Column } from '@/components/ResponsiveTable'
import { useToast } from '@/components/Toast'

interface StockItem {
  id: string
  productId: string
  content: string
  sold: boolean
  createdAt: string | null
  soldAt?: string | null
  soldTo?: number | null
  variantId?: string | null
  variantName?: string | null
  durationDays?: number | null
}

interface StockResponse {
  items: StockItem[]
  total: number
  page: number
  limit: number
  productName: string
}

interface VariantRow {
  id: string
  name: string
  stock: number
}

export function StockManager({ productId, onClose }: { productId: string; onClose?: () => void }) {
  const queryClient = useQueryClient()
  const t = useToast()
  const [page, setPage] = useState(1)
  const [newItems, setNewItems] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [variantId, setVariantId] = useState<string>('')
  const [durationDays, setDurationDays] = useState<string>('')
  const [notifyFollowers, setNotifyFollowers] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set())
  const [bulkVariantId, setBulkVariantId] = useState('')
  const [bulkDurationDays, setBulkDurationDays] = useState('')
  const limit = 50

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timeout)
  }, [search])

  const stockQuery = useQuery({
    queryKey: ['admin', 'stock', productId, page, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (debouncedSearch) params.set('q', debouncedSearch)
      return api.get<StockResponse>(`/admin/stock/${productId}?${params.toString()}`)
    },
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  })

  const variantsQuery = useQuery({
    queryKey: ['admin', 'variants', productId],
    queryFn: () => api.get<VariantRow[]>(`/admin/products/${productId}/variants`),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const stock = stockQuery.data?.data
  const items = stock?.items ?? []
  const total = stock?.total ?? 0
  const totalPages = Math.ceil(total / limit)
  const variants = useMemo(() => variantsQuery.data?.data ?? [], [variantsQuery.data?.data])
  const hasVariants = variants.length > 0
  const selectedCount = selectedIds.size

  const invalidateStock = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'stock', productId] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'stock', 'all'] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'products'] })
  }

  const addMutation = useMutation({
    mutationFn: (lines: string[]) => {
      const payload: { items: string[]; variantId?: number; durationDays?: number; notifyFollowers?: boolean } = { items: lines, notifyFollowers }
      if (variantId) payload.variantId = Number(variantId)
      if (durationDays && Number(durationDays) > 0) payload.durationDays = Number(durationDays)
      return api.post<{ added?: number }>(`/admin/stock/${productId}`, payload)
    },
    onSuccess: (res) => {
      invalidateStock()
      setNewItems('')
      t.success(`Đã thêm ${res.data?.added ?? 0} key`)
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'thêm thất bại'}`),
  })

  const clearUnsoldMutation = useMutation({
    mutationFn: () => api.delete<{ deleted?: number }>(`/admin/stock/${productId}/unsold`),
    onSuccess: (res) => {
      invalidateStock()
      setSelectedIds(new Set())
      t.success(`Đã xoá ${res.data?.deleted ?? 0} key chưa bán`)
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'xoá thất bại'}`),
  })

  const editMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      api.patch(`/admin/stock/${productId}/${id}`, { content }),
    onSuccess: () => {
      invalidateStock()
      setEditingId(null)
      setEditDraft('')
      t.success('Đã cập nhật key')
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'cập nhật thất bại'}`),
  })

  const deleteItemMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/stock/${productId}/${id}`),
    onSuccess: () => {
      invalidateStock()
      t.success('Đã xoá key')
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'xoá thất bại'}`),
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: () => api.post<{ deleted?: number }>('/admin/stock/_bulk/delete', {
      ids: [...selectedIds].map(Number),
    }),
    onSuccess: (res) => {
      invalidateStock()
      setSelectedIds(new Set())
      t.success(`Đã xoá ${res.data?.deleted ?? 0} key`)
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'xoá hàng loạt thất bại'}`),
  })

  const bulkEditMutation = useMutation({
    mutationFn: () => {
      const payload: { ids: number[]; variantId?: number | null; durationDays?: number | null } = {
        ids: [...selectedIds].map(Number),
      }
      if (bulkVariantId === '__none__') payload.variantId = null
      else if (bulkVariantId) payload.variantId = Number(bulkVariantId)
      if (bulkDurationDays === '__clear__') payload.durationDays = null
      else if (bulkDurationDays && Number(bulkDurationDays) > 0) payload.durationDays = Number(bulkDurationDays)
      return api.patch<{ updated?: number }>('/admin/stock/_bulk', payload)
    },
    onSuccess: (res) => {
      invalidateStock()
      setSelectedIds(new Set())
      setBulkVariantId('')
      setBulkDurationDays('')
      t.success(`Đã cập nhật ${res.data?.updated ?? 0} key`)
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'sửa hàng loạt thất bại'}`),
  })

  const notifyFollowersMutation = useMutation({
    mutationFn: () => api.post<{ sent?: number; failed?: number; skipped?: string | null }>(`/admin/stock/${productId}/notify-followers`, {}),
    onSuccess: (res) => {
      if (res.data?.skipped) t.error(`Bỏ qua gửi thông báo (${res.data.skipped})`)
      else t.success(`Đã gửi thông báo Telegram: ${res.data?.sent ?? 0} thành công, ${res.data?.failed ?? 0} lỗi`)
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'gửi thông báo thất bại'}`),
  })

  function handleAdd() {
    if (hasVariants && !variantId) {
      t.error('Sản phẩm có biến thể, vui lòng chọn biến thể trước khi thêm key.')
      return
    }
    const lines = newItems.split('\n').map((line) => line.trim()).filter(Boolean)
    if (lines.length === 0) return
    addMutation.mutate(lines)
  }

  function renderActions(item: StockItem) {
    if (item.sold) return <span className="text-clay-silver text-xs">—</span>
    if (editingId === item.id) {
      return (
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => editMutation.mutate({ id: item.id, content: editDraft })}
            disabled={editMutation.isPending || !editDraft.trim()}
            className="clay-btn clay-btn--matcha text-xs disabled:opacity-50"
          >
            Lưu
          </button>
          <button onClick={() => { setEditingId(null); setEditDraft('') }} className="clay-btn text-xs">
            Huỷ
          </button>
        </div>
      )
    }
    return (
      <div className="flex gap-2 justify-center">
        <button
          onClick={() => { setEditingId(item.id); setEditDraft(item.content) }}
          className="clay-btn text-xs flex items-center gap-1"
        >
          <Pencil size={14} />Sửa
        </button>
        <button
          onClick={() => {
            if (confirm('Xoá mục này?')) deleteItemMutation.mutate(item.id)
          }}
          disabled={deleteItemMutation.isPending}
          className="clay-btn clay-btn--pomegranate text-xs disabled:opacity-50 flex items-center gap-1"
        >
          <Trash2 size={14} />Xoá
        </button>
      </div>
    )
  }

  const columns: Column<StockItem>[] = [
    {
      header: 'ID',
      cell: (item) => <span className="font-mono text-xs text-clay-silver">{item.id}</span>,
    },
    {
      header: 'Tài khoản',
      primary: true,
      cell: (item) =>
        editingId === item.id ? (
          <input
            autoFocus
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            className="clay-input w-full text-xs"
          />
        ) : (
          <code className="font-mono text-xs break-all">{item.content}</code>
        ),
    },
    {
      header: 'Biến thể',
      cell: (item) => <span className="text-clay-charcoal text-xs">{item.variantName || '-'}</span>,
    },
    {
      header: 'Thời hạn',
      className: 'text-center',
      cell: (item) => <span className="text-xs text-clay-charcoal">{item.durationDays ? `${item.durationDays} ngày` : '-'}</span>,
    },
    {
      header: 'Trạng thái',
      className: 'text-center',
      cell: (item) => (
        <span
          className="clay-pill"
          style={item.sold ? { background: 'var(--color-clay-oat-light)' } : { background: 'var(--color-matcha-300)' }}
        >
          {item.sold ? `Đã bán${item.soldTo ? ` (#${item.soldTo})` : ''}` : 'Còn hàng'}
        </span>
      ),
    },
    {
      header: 'Thêm lúc',
      cell: (item) => <span className="text-clay-silver text-xs">{item.createdAt ? formatDate(item.createdAt) : '-'}</span>,
    },
    {
      header: 'Bán lúc',
      cell: (item) => <span className="text-clay-silver text-xs">{item.soldAt ? formatDate(item.soldAt) : '-'}</span>,
    },
    {
      header: 'Thao tác',
      className: 'text-center',
      hideOnCard: true,
      cell: (item) => renderActions(item),
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="clay-display text-3xl mb-1">Kho</h1>
          {stock?.productName && <p className="text-clay-charcoal mt-1">Sản phẩm: {stock.productName}</p>}
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-clay-silver" />
            <input
              type="search"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); setSelectedIds(new Set()) }}
              placeholder="Tìm theo tài khoản hoặc ID..."
              className="clay-input text-sm w-64 pl-9"
            />
          </div>
          <span className="text-sm text-clay-charcoal">Tổng: {total} mục</span>
          {onClose && <button onClick={onClose} className="clay-btn p-2" aria-label="Đóng"><X size={16} /></button>}
        </div>
      </div>

      <div className="clay-card p-5">
        <h3 className="text-lg font-semibold mb-3">Thêm hàng mới</h3>
        {hasVariants && (
          <label className="block text-sm mb-3">
            <span className="text-xs opacity-70 mb-1 inline-block">Biến thể <span className="text-red-500">*</span></span>
            <select value={variantId} onChange={(e) => setVariantId(e.target.value)} className="clay-input w-full text-sm">
              <option value="">— Chọn biến thể —</option>
              {variants.map((variant) => (
                <option key={variant.id} value={variant.id}>{variant.name} (kho {variant.stock})</option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-sm mb-3">
          <span className="text-xs opacity-70 mb-1 inline-block">Thời hạn (ngày, trống = không hết hạn / dùng mặc định của biến thể)</span>
          <input
            type="number"
            min={1}
            value={durationDays}
            onChange={(e) => setDurationDays(e.target.value)}
            placeholder="VD: 30"
            className="clay-input w-full text-sm"
          />
        </label>
        <textarea
          value={newItems}
          onChange={(e) => setNewItems(e.target.value)}
          rows={6}
          placeholder={"KEY-ABC-123\nKEY-DEF-456\nKEY-GHI-789"}
          className="clay-input w-full resize-none font-mono text-sm"
        />
        <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
          <span className="text-sm text-clay-silver">{newItems.split('\n').filter((line) => line.trim()).length} dòng</span>
          <label className="flex items-center gap-2 text-sm text-clay-charcoal">
            <input
              type="checkbox"
              checked={notifyFollowers}
              onChange={(e) => setNotifyFollowers(e.target.checked)}
              className="h-4 w-4"
            />
            Gửi thông báo Telegram tới tất cả khách
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => notifyFollowersMutation.mutate()}
              disabled={notifyFollowersMutation.isPending}
              className="clay-btn text-sm disabled:opacity-50"
            >
              {notifyFollowersMutation.isPending ? 'Đang gửi...' : 'Gửi thông báo Telegram'}
            </button>
            <button
              onClick={() => {
                if (confirm('Xoá toàn bộ stock chưa bán? Hành động này không thể hoàn tác.')) clearUnsoldMutation.mutate()
              }}
              disabled={clearUnsoldMutation.isPending}
              className="clay-btn clay-btn--pomegranate text-sm disabled:opacity-50"
            >
              {clearUnsoldMutation.isPending ? 'Đang xoá...' : 'Xoá hàng chưa bán'}
            </button>
            <button
              onClick={handleAdd}
              disabled={addMutation.isPending || !newItems.trim()}
              className="clay-btn clay-btn--ink text-sm disabled:opacity-50"
            >
              {addMutation.isPending ? 'Đang thêm...' : 'Thêm hàng'}
            </button>
          </div>
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="clay-card p-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">Đã chọn {selectedCount} key</span>
          {hasVariants && (
            <select value={bulkVariantId} onChange={(e) => setBulkVariantId(e.target.value)} className="clay-input text-sm py-2">
              <option value="">Không đổi biến thể</option>
              <option value="__none__">Bỏ biến thể</option>
              {variants.map((variant) => (
                <option key={variant.id} value={variant.id}>{variant.name}</option>
              ))}
            </select>
          )}
          <input
            type="number"
            min={1}
            value={bulkDurationDays}
            onChange={(e) => setBulkDurationDays(e.target.value)}
            placeholder="Thời hạn ngày"
            className="clay-input text-sm py-2 w-36"
          />
          <button
            onClick={() => setBulkDurationDays('__clear__')}
            className="clay-btn text-xs"
          >
            Xoá thời hạn
          </button>
          <button
            onClick={() => bulkEditMutation.mutate()}
            disabled={bulkEditMutation.isPending || (!bulkVariantId && !bulkDurationDays)}
            className="clay-btn clay-btn--matcha text-sm disabled:opacity-50"
          >
            {bulkEditMutation.isPending ? 'Đang sửa...' : 'Sửa đã chọn'}
          </button>
          <button
            onClick={() => {
              if (confirm(`Xoá ${selectedCount} key đã chọn?`)) bulkDeleteMutation.mutate()
            }}
            disabled={bulkDeleteMutation.isPending}
            className="clay-btn clay-btn--pomegranate text-sm disabled:opacity-50"
          >
            {bulkDeleteMutation.isPending ? 'Đang xoá...' : 'Xoá đã chọn'}
          </button>
        </div>
      )}

      <ResponsiveTable
        rows={items}
        columns={columns}
        rowKey={(item) => item.id}
        loading={stockQuery.isLoading}
        emptyText="Chưa có hàng nào trong kho"
        cardActions={renderActions}
        selectable
        selectedIds={selectedIds}
        isRowSelectable={(item) => !item.sold}
        onToggleRow={(id, checked) => {
          setSelectedIds((prev) => {
            const next = new Set(prev)
            if (checked) next.add(id)
            else next.delete(id)
            return next
          })
        }}
        onToggleAll={(checked) => {
          setSelectedIds(checked ? new Set(items.filter((item) => !item.sold).map((item) => item.id)) : new Set())
        }}
      />

      {totalPages > 1 && (
        <div className="clay-card flex items-center justify-between px-4 py-3">
          <span className="text-sm text-clay-charcoal">Trang {page} / {totalPages}</span>
          <div className="flex gap-2">
            <button
              onClick={() => { setPage((p) => Math.max(1, p - 1)); setSelectedIds(new Set()) }}
              disabled={page <= 1}
              className="clay-btn text-sm py-1.5 px-3 disabled:opacity-40"
            >
              Trước
            </button>
            <button
              onClick={() => { setPage((p) => Math.min(totalPages, p + 1)); setSelectedIds(new Set()) }}
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
