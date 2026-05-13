'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Pencil, Trash2, Search } from '@/lib/icons'
import { ResponsiveTable, Column } from '@/components/ResponsiveTable'
import { useToast } from '@/components/Toast'

interface StockItem {
  id: string
  content: string
  sold: boolean
  createdAt: string | null
  soldAt?: string | null
  soldTo?: number | null
}

interface StockResponse {
  items: StockItem[]
  total: number
  page: number
  limit: number
  productName: string
}

export default function StockPage() {
  const params = useParams()
  const productId = params.productId as string
  const queryClient = useQueryClient()

  const [page, setPage] = useState(1)
  const [newItems, setNewItems] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const limit = 50

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'stock', productId, page, debouncedSearch],
    queryFn: () => {
      let url = `/admin/stock/${productId}?page=${page}&limit=${limit}`
      if (debouncedSearch) url += `&q=${encodeURIComponent(debouncedSearch)}`
      return api.get<StockResponse>(url)
    },
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  })

  const variantsQuery = useQuery({
    queryKey: ['admin', 'variants', productId],
    queryFn: () => api.get<{ id: string; name: string; stock: number }[]>(`/admin/products/${productId}/variants`),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const variants = variantsQuery.data?.data ?? []
  const hasVariants = variants.length > 0
  const [variantId, setVariantId] = useState<string>('')

  useEffect(() => {
    if (hasVariants && !variantId) setVariantId(variants[0].id)
  }, [hasVariants, variantId, variants])

  const t = useToast()

  const addMutation = useMutation({
    mutationFn: (items: string[]) => {
      const payload: { items: string[]; variantId?: number } = { items }
      if (variantId) payload.variantId = Number(variantId)
      return api.post(`/admin/stock/${productId}`, payload)
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'stock', productId] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
      setNewItems('')
      const added = (res?.data as { added?: number } | undefined)?.added ?? 0
      t.success(`Đã thêm ${added} key`)
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'thêm thất bại'}`),
  })

  const clearUnsoldMutation = useMutation({
    mutationFn: () => api.delete(`/admin/stock/${productId}/unsold`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'stock', productId] })
      const deleted = (res?.data as { deleted?: number } | undefined)?.deleted ?? 0
      t.success(`Đã xoá ${deleted} key chưa bán`)
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'xoá thất bại'}`),
  })

  const editMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      api.patch(`/admin/stock/${productId}/${id}`, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'stock', productId] })
      setEditingId(null)
      setEditDraft('')
      t.success('Đã cập nhật key')
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'cập nhật thất bại'}`),
  })

  const deleteItemMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/stock/${productId}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'stock', productId] })
      t.success('Đã xoá key')
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'xoá thất bại'}`),
  })

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const stock = data?.data
  const items = stock?.items ?? []
  const total = stock?.total ?? 0
  const totalPages = Math.ceil(total / limit)

  function handleAdd() {
    if (hasVariants && !variantId) {
      alert('Sản phẩm có biến thể — vui lòng chọn biến thể trước khi thêm key.')
      return
    }
    const lines = newItems
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length === 0) return
    addMutation.mutate(lines)
  }

  function handleClearUnsold() {
    if (confirm('Xoá toàn bộ stock chưa bán? Hành động này không thể hoàn tác.')) {
      clearUnsoldMutation.mutate()
    }
  }

  function renderActions(item: StockItem) {
    if (item.sold) {
      return <span className="text-clay-silver text-xs">—</span>
    }
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
          <button
            onClick={() => { setEditingId(null); setEditDraft('') }}
            className="clay-btn text-xs"
          >
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
      cell: (item) => (
        <span className="font-mono text-xs text-clay-silver">{item.id}</span>
      ),
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
      header: 'Trạng thái',
      className: 'text-center',
      cell: (item) => (
        <span
          className="clay-pill"
          style={item.sold
            ? { background: 'var(--color-clay-oat-light)' }
            : { background: 'var(--color-matcha-300)' }
          }
        >
          {item.sold ? `Đã bán${item.soldTo ? ` (#${item.soldTo})` : ''}` : 'Còn hàng'}
        </span>
      ),
    },
    {
      header: 'Thêm lúc',
      cell: (item) => (
        <span className="text-clay-silver text-xs">
          {item.createdAt ? formatDate(item.createdAt) : '-'}
        </span>
      ),
    },
    {
      header: 'Bán lúc',
      cell: (item) => (
        <span className="text-clay-silver text-xs">
          {item.soldAt ? formatDate(item.soldAt) : '-'}
        </span>
      ),
    },
    {
      header: 'Thao tác',
      className: 'text-center',
      hideOnCard: true,
      cell: (item) => renderActions(item),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="clay-display text-3xl mb-1">Kho</h1>
          {stock?.productName && (
            <p className="text-clay-charcoal mt-1">Sản phẩm: {stock.productName}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-clay-silver" />
            <input
              type="search"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Tìm theo tài khoản hoặc ID..."
              className="clay-input text-sm w-64 pl-9"
            />
          </div>
          <span className="text-sm text-clay-charcoal">Tổng: {total} mục</span>
        </div>
      </div>

      {/* Thêm hàng */}
      <div className="clay-card p-6">
        <h3 className="text-lg font-semibold mb-3">Thêm hàng mới</h3>
        {hasVariants && (
          <div className="mb-3">
            <label className="block text-sm font-medium text-clay-charcoal mb-1">
              Biến thể <span className="text-red-500">*</span>
            </label>
            <select
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              className="clay-input w-full text-sm"
              required
            >
              <option value="">— Chọn biến thể —</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>{v.name} (kho {v.stock})</option>
              ))}
            </select>
            {!variantId && (
              <p className="text-xs text-red-600 mt-1">Sản phẩm này có biến thể, phải chọn biến thể trước khi thêm key.</p>
            )}
          </div>
        )}
        <p className="text-sm text-clay-silver mb-3">Mỗi dòng là 1 mục (key, code, link...)</p>
        <textarea
          value={newItems}
          onChange={(e) => setNewItems(e.target.value)}
          rows={6}
          placeholder={"KEY-ABC-123\nKEY-DEF-456\nKEY-GHI-789"}
          className="clay-input w-full resize-none font-mono text-sm"
        />
        <div className="flex items-center justify-between mt-3">
          <span className="text-sm text-clay-silver">
            {newItems.split('\n').filter((l) => l.trim()).length} dòng
          </span>
          <div className="flex gap-3">
            <button
              onClick={handleClearUnsold}
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
        {addMutation.isSuccess && (
          <p className="text-sm mt-2" style={{ color: 'var(--color-matcha-600)' }}>Thêm hàng thành công!</p>
        )}
        {addMutation.isError && (
          <p className="text-sm mt-2" style={{ color: 'var(--color-pomegranate-700)' }}>
            Lỗi: {addMutation.error instanceof Error ? addMutation.error.message : 'Thêm thất bại'}
          </p>
        )}
      </div>

      {/* Danh sách kho */}
      <ResponsiveTable
        rows={items}
        columns={columns}
        rowKey={(item) => item.id}
        loading={isLoading}
        emptyText="Chưa có hàng nào trong kho"
        cardActions={renderActions}
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
