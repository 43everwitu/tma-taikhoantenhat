'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Copy, Pencil, Search, Trash2 } from '@/lib/icons'
import { ResponsiveTable, Column } from '@/components/ResponsiveTable'
import { useToast } from '@/components/Toast'
import { QuickAddKeysModal } from '../QuickAddKeysModal'
import { ProductVariantFilterCombobox } from './ProductVariantFilterCombobox'

interface ProductRow {
  id: string
  name: string
  category?: string
  slug?: string
  variantNames?: string[]
  variantOptions?: Array<{ id: string; name: string }>
}

interface VariantRow {
  id: string
  name: string
  stock: number
}

interface KeyRow {
  id: string
  productId: string
  productName: string
  variantId: string | null
  variantName: string | null
  content: string
  sold: boolean
  soldTo: number | null
  createdAt: string | null
  soldAt: string | null
  durationDays: number | null
  soldOrder: {
    id: string
    paymentCode: string | null
    status: string
    deliveredAt: string | null
  } | null
  soldCustomer: {
    telegramId: number
    username: string | null
    fullName: string | null
  } | null
}

interface KeyListResponse {
  items: KeyRow[]
  total: number
  page: number
  limit: number
}

interface EditDraft {
  content: string
  productId: string
  variantId: string
  durationDays: string
}

export default function AllStockKeysPage() {
  const qc = useQueryClient()
  const t = useToast()
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [productId, setProductId] = useState('')
  const [variantId, setVariantId] = useState('')
  const [status, setStatus] = useState<'all' | 'unsold' | 'sold'>('unsold')
  const [editingRow, setEditingRow] = useState<KeyRow | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set())
  const [bulkVariantId, setBulkVariantId] = useState('')
  const [bulkDurationDays, setBulkDurationDays] = useState('')
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const limit = 50

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(timeout)
  }, [q])

  const productsQuery = useQuery({
    queryKey: ['admin', 'products'],
    queryFn: () => api.get<ProductRow[]>('/admin/products'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const products = useMemo(() => productsQuery.data?.data ?? [], [productsQuery.data?.data])

  const variantsQuery = useQuery({
    queryKey: ['admin', 'variants', productId],
    queryFn: () => api.get<VariantRow[]>(`/admin/products/${productId}/variants`),
    enabled: !!productId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const variants = useMemo(() => variantsQuery.data?.data ?? [], [variantsQuery.data?.data])

  const keysQuery = useQuery({
    queryKey: ['admin', 'stock', 'all', page, debouncedQ, productId, variantId, status],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (debouncedQ) params.set('q', debouncedQ)
      if (productId) params.set('productId', productId)
      if (variantId) params.set('variantId', variantId)
      if (status === 'sold') params.set('sold', 'true')
      if (status === 'unsold') params.set('sold', 'false')
      return api.get<KeyListResponse>(`/admin/stock?${params.toString()}`)
    },
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  })

  const rows = useMemo(() => keysQuery.data?.data.items ?? [], [keysQuery.data?.data.items])
  const total = keysQuery.data?.data.total ?? 0
  const totalPages = Math.ceil(total / limit)
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id)),
    [rows, selectedIds]
  )
  const selectedProductIds = new Set(selectedRows.map((row) => row.productId))
  const selectedSingleProductId = selectedProductIds.size === 1 ? selectedRows[0]?.productId : ''
  const bulkProductId = productId || selectedSingleProductId

  const bulkVariantsQuery = useQuery({
    queryKey: ['admin', 'variants', bulkProductId, 'bulk'],
    queryFn: () => api.get<VariantRow[]>(`/admin/products/${bulkProductId}/variants`),
    enabled: !!bulkProductId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const bulkVariants = bulkVariantsQuery.data?.data ?? []

  const editVariantsQuery = useQuery({
    queryKey: ['admin', 'variants', editDraft?.productId, 'stock-key-edit'],
    queryFn: () => api.get<VariantRow[]>(`/admin/products/${editDraft!.productId}/variants`),
    enabled: !!editDraft?.productId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const editVariants = editVariantsQuery.data?.data ?? []

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'stock'] })
    qc.invalidateQueries({ queryKey: ['admin', 'products'] })
    qc.invalidateQueries({ queryKey: ['admin', 'variants'] })
    if (bulkProductId) qc.invalidateQueries({ queryKey: ['admin', 'variants', bulkProductId] })
  }

  async function copyKey(content: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard không khả dụng')
      await navigator.clipboard.writeText(content)
      t.success('Đã copy key')
    } catch (e) {
      t.error(`Lỗi: ${e instanceof Error ? e.message : 'copy key thất bại'}`)
    }
  }

  const editMutation = useMutation({
    mutationFn: ({ row, draft }: { row: KeyRow; draft: EditDraft }) =>
      api.patch(`/admin/stock/items/${row.id}`, {
        content: draft.content.trim(),
        productId: Number(draft.productId),
        variantId: draft.variantId ? Number(draft.variantId) : null,
        durationDays: draft.durationDays && Number(draft.durationDays) > 0 ? Number(draft.durationDays) : null,
      }),
    onSuccess: () => {
      invalidate()
      setEditingRow(null)
      setEditDraft(null)
      t.success('Đã cập nhật key')
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'cập nhật thất bại'}`),
  })

  const deleteMutation = useMutation({
    mutationFn: (row: KeyRow) => api.delete(`/admin/stock/items/${row.id}`),
    onSuccess: () => {
      invalidate()
      t.success('Đã xoá key')
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'xoá thất bại'}`),
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: () => api.post<{ deleted?: number }>('/admin/stock/_bulk/delete', {
      ids: [...selectedIds].map(Number),
    }),
    onSuccess: (res) => {
      invalidate()
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
      invalidate()
      setSelectedIds(new Set())
      setBulkVariantId('')
      setBulkDurationDays('')
      t.success(`Đã cập nhật ${res.data?.updated ?? 0} key`)
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'sửa hàng loạt thất bại'}`),
  })

  function openEdit(row: KeyRow) {
    setEditingRow(row)
    setEditDraft({
      content: row.content,
      productId: row.productId,
      variantId: row.variantId ?? '',
      durationDays: row.durationDays ? String(row.durationDays) : '',
    })
  }

  function closeEdit() {
    setEditingRow(null)
    setEditDraft(null)
  }

  function renderActions(row: KeyRow) {
    return (
      <div className="flex gap-2 justify-center">
        <button
          onClick={() => openEdit(row)}
          className="clay-btn text-xs flex items-center gap-1"
        >
          <Pencil size={14} />Sửa
        </button>
        <button
          onClick={() => {
            const message = row.sold
              ? 'Xoá key đã bán khỏi kho? Đơn đã giao vẫn giữ snapshot key cũ.'
              : 'Xoá key này?'
            if (confirm(message)) deleteMutation.mutate(row)
          }}
          disabled={deleteMutation.isPending}
          className="clay-btn clay-btn--pomegranate text-xs disabled:opacity-50 flex items-center gap-1"
        >
          <Trash2 size={14} />Xoá
        </button>
      </div>
    )
  }

  const renderKeyCell = (row: KeyRow) => (
    <div className="flex items-start gap-2">
      <code className="block max-h-20 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-clay-oat-light bg-clay-cream/50 px-2 py-1.5 font-mono text-xs leading-relaxed text-clay-ink select-text">
        {row.content}
      </code>
      <button
        type="button"
        onClick={() => copyKey(row.content)}
        className="clay-btn px-2 py-1.5 text-xs"
        title="Copy key"
        aria-label="Copy key"
      >
        <Copy size={14} />
      </button>
    </div>
  )

  const renderProductCell = (row: KeyRow) => (
    <div className="space-y-1">
      <p className="text-sm font-medium text-clay-charcoal">{row.productName}</p>
      <p className="text-xs text-clay-charcoal/70">{row.variantName || 'Không biến thể'}</p>
      <p className="text-xs text-clay-silver">{row.durationDays ? `${row.durationDays} ngày` : 'Chưa đặt thời hạn'}</p>
    </div>
  )

  const renderSoldTransactionCell = (row: KeyRow) => (
    <div className="space-y-1 text-xs text-clay-charcoal">
      {row.soldOrder ? (
        <Link href={`/admin/orders?highlight=${row.soldOrder.id}`} className="font-medium hover:underline">
          #{row.soldOrder.id}{row.soldOrder.paymentCode ? ` · ${row.soldOrder.paymentCode}` : ''}
        </Link>
      ) : (
        <span className="text-clay-silver">Chưa khớp đơn</span>
      )}
      <p>
        {row.soldCustomer?.fullName || row.soldCustomer?.username || (row.soldTo ? `#${row.soldTo}` : 'Không rõ khách')}
      </p>
      {row.soldCustomer?.telegramId && <p className="text-clay-silver">TG: {row.soldCustomer.telegramId}</p>}
    </div>
  )

  const renderAllStatusCell = (row: KeyRow) => (
    <span
      className="clay-pill"
      style={row.sold ? { background: 'var(--color-clay-oat-light)' } : { background: 'var(--color-matcha-300)' }}
    >
      {row.sold ? 'Đã bán' : 'Còn hàng'}
    </span>
  )

  const renderAllTimeCell = (row: KeyRow) => (
    <div className="space-y-1 text-xs text-clay-silver">
      <p>Thêm: {row.createdAt ? formatDate(row.createdAt) : '-'}</p>
      {row.sold && <p>Bán: {row.soldAt ? formatDate(row.soldAt) : '-'}</p>}
    </div>
  )

  const renderAllTransactionCell = (row: KeyRow) => (
    row.sold ? renderSoldTransactionCell(row) : <span className="text-xs text-clay-charcoal">Còn hàng</span>
  )

  const columns = useMemo<Column<KeyRow>[]>(() => {
    const idColumn: Column<KeyRow> = {
      header: 'ID',
      cell: (row) => <span className="font-mono text-xs text-clay-silver">{row.id}</span>,
    }
    const keyColumn: Column<KeyRow> = {
      header: 'Tài khoản',
      primary: true,
      cell: (row) => renderKeyCell(row),
    }
    const productColumn: Column<KeyRow> = {
      header: 'Sản phẩm',
      cell: (row) => renderProductCell(row),
    }
    const actionColumn: Column<KeyRow> = {
      header: 'Thao tác',
      className: 'text-center',
      hideOnCard: true,
      cell: (row) => renderActions(row),
    }

    if (status === 'unsold') {
      return [
        idColumn,
        keyColumn,
        productColumn,
        {
          header: 'Thêm lúc',
          cell: (row) => <span className="text-clay-silver text-xs">{row.createdAt ? formatDate(row.createdAt) : '-'}</span>,
        },
        actionColumn,
      ]
    }

    if (status === 'sold') {
      return [
        idColumn,
        keyColumn,
        productColumn,
        {
          header: 'Bán lúc',
          cell: (row) => <span className="text-clay-silver text-xs">{row.soldAt ? formatDate(row.soldAt) : '-'}</span>,
        },
        {
          header: 'Đơn/khách',
          cell: (row) => renderSoldTransactionCell(row),
        },
        actionColumn,
      ]
    }

    return [
      idColumn,
      keyColumn,
      productColumn,
      {
        header: 'Trạng thái',
        cell: (row) => renderAllStatusCell(row),
      },
      {
        header: 'Thời gian',
        cell: (row) => renderAllTimeCell(row),
      },
      {
        header: 'Giao dịch',
        cell: (row) => renderAllTransactionCell(row),
      },
      actionColumn,
    ]
  }, [status, deleteMutation.isPending])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="clay-display text-3xl">Tất cả Key</h1>
          <p className="text-sm text-clay-charcoal">Xem, tìm kiếm và chỉnh sửa key trên toàn bộ kho.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setQuickAddOpen(true)}
            className="clay-btn clay-btn--lemon text-sm"
          >
            + Thêm key
          </button>
          <Link href="/admin/stock" className="clay-btn text-sm">Theo sản phẩm</Link>
        </div>
      </div>

      <div className="clay-card p-4 space-y-3">
        <div className="grid gap-3 lg:grid-cols-[1fr_minmax(280px,340px)_220px_180px]">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-clay-silver" />
            <input
              type="search"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); setSelectedIds(new Set()) }}
              placeholder="Tìm theo key, ID hoặc tên sản phẩm..."
              className="clay-input w-full text-sm pl-9"
            />
          </div>
          <ProductVariantFilterCombobox
            products={products}
            value={{ productId, variantId }}
            loading={productsQuery.isLoading}
            onChange={(next) => {
              setProductId(next.productId)
              setVariantId(next.variantId)
              setPage(1)
              setSelectedIds(new Set())
            }}
          />
          <select
            value={variantId}
            onChange={(e) => { setVariantId(e.target.value); setPage(1); setSelectedIds(new Set()) }}
            disabled={!productId || variants.length === 0}
            className="clay-input text-sm disabled:opacity-50"
          >
            <option value="">Tất cả biến thể</option>
            <option value="0">Không biến thể</option>
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>{variant.name}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); setSelectedIds(new Set()) }}
            className="clay-input text-sm"
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="unsold">Còn hàng</option>
            <option value="sold">Đã bán</option>
          </select>
        </div>
        <div className="text-sm text-clay-charcoal">Tổng: {total} key</div>
      </div>

      {selectedIds.size > 0 && (
        <div className="clay-card p-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">Đã chọn {selectedIds.size} key</span>
          <select
            value={bulkVariantId}
            onChange={(e) => setBulkVariantId(e.target.value)}
            disabled={!bulkProductId || selectedProductIds.size > 1 || bulkVariants.length === 0}
            className="clay-input text-sm py-2 disabled:opacity-50"
          >
            <option value="">Không đổi biến thể</option>
            <option value="__none__">Bỏ biến thể</option>
            {bulkVariants.map((variant) => (
              <option key={variant.id} value={variant.id}>{variant.name}</option>
            ))}
          </select>
          {selectedProductIds.size > 1 && (
            <span className="text-xs text-clay-silver">Chỉ đổi biến thể khi các key cùng một sản phẩm.</span>
          )}
          <input
            type="number"
            min={1}
            value={bulkDurationDays}
            onChange={(e) => setBulkDurationDays(e.target.value)}
            placeholder="Thời hạn ngày"
            className="clay-input text-sm py-2 w-36"
          />
          <button onClick={() => setBulkDurationDays('__clear__')} className="clay-btn text-xs">Xoá thời hạn</button>
          <button
            onClick={() => bulkEditMutation.mutate()}
            disabled={bulkEditMutation.isPending || (!bulkVariantId && !bulkDurationDays)}
            className="clay-btn clay-btn--matcha text-sm disabled:opacity-50"
          >
            {bulkEditMutation.isPending ? 'Đang sửa...' : 'Sửa đã chọn'}
          </button>
          <button
            onClick={() => {
              if (confirm(`Xoá ${selectedIds.size} key đã chọn?`)) bulkDeleteMutation.mutate()
            }}
            disabled={bulkDeleteMutation.isPending}
            className="clay-btn clay-btn--pomegranate text-sm disabled:opacity-50"
          >
            {bulkDeleteMutation.isPending ? 'Đang xoá...' : 'Xoá đã chọn'}
          </button>
        </div>
      )}

      <ResponsiveTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        loading={keysQuery.isLoading}
        emptyText="Không tìm thấy key phù hợp"
        cardActions={renderActions}
        selectable
        selectedIds={selectedIds}
        isRowSelectable={(row) => !row.sold}
        onToggleRow={(id, checked) => {
          setSelectedIds((prev) => {
            const next = new Set(prev)
            if (checked) next.add(id)
            else next.delete(id)
            return next
          })
        }}
        onToggleAll={(checked) => {
          setSelectedIds(checked ? new Set(rows.filter((row) => !row.sold).map((row) => row.id)) : new Set())
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

      {quickAddOpen && (
        <QuickAddKeysModal
          products={products}
          initialProductId={null}
          onClose={() => {
            setQuickAddOpen(false)
            qc.invalidateQueries({ queryKey: ['admin', 'stock'] })
          }}
        />
      )}

      {editingRow && editDraft && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={closeEdit}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!editDraft.content.trim() || !editDraft.productId) return
              editMutation.mutate({ row: editingRow, draft: editDraft })
            }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Sửa key #{editingRow.id}</h2>
                <p className="text-xs text-clay-charcoal">
                  Cập nhật value, sản phẩm, biến thể và thời hạn của key trong kho.
                </p>
              </div>
              <button type="button" onClick={closeEdit} className="opacity-60 text-xl leading-none">×</button>
            </div>

            {editingRow.sold && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Key này đã bán. Thao tác chỉ cập nhật dữ liệu kho, không sửa snapshot key trong đơn đã giao.
              </div>
            )}

            <label className="block text-sm">
              <span className="text-xs text-clay-charcoal mb-1 inline-block">Value key</span>
              <textarea
                autoFocus
                value={editDraft.content}
                onChange={(e) => setEditDraft({ ...editDraft, content: e.target.value })}
                rows={6}
                className="clay-input w-full text-xs font-mono"
              />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm">
                <span className="text-xs text-clay-charcoal mb-1 inline-block">Sản phẩm</span>
                <select
                  value={editDraft.productId}
                  onChange={(e) => setEditDraft({ ...editDraft, productId: e.target.value, variantId: '' })}
                  className="clay-input w-full text-sm"
                >
                  <option value="">Chọn sản phẩm</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>{product.name}</option>
                  ))}
                </select>
              </label>

              <label className="block text-sm">
                <span className="text-xs text-clay-charcoal mb-1 inline-block">Biến thể</span>
                <select
                  value={editDraft.variantId}
                  onChange={(e) => setEditDraft({ ...editDraft, variantId: e.target.value })}
                  disabled={!editDraft.productId || editVariantsQuery.isLoading}
                  className="clay-input w-full text-sm disabled:opacity-50"
                >
                  <option value="">Không biến thể</option>
                  {editVariants.map((variant) => (
                    <option key={variant.id} value={variant.id}>{variant.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <label className="block text-sm">
                <span className="text-xs text-clay-charcoal mb-1 inline-block">Thời hạn (ngày)</span>
                <input
                  type="number"
                  min={1}
                  value={editDraft.durationDays}
                  onChange={(e) => setEditDraft({ ...editDraft, durationDays: e.target.value })}
                  placeholder="VD: 30"
                  className="clay-input w-full text-sm"
                />
              </label>
              <button
                type="button"
                onClick={() => setEditDraft({ ...editDraft, durationDays: '' })}
                className="clay-btn text-xs"
              >
                Xoá thời hạn
              </button>
            </div>

            {editingRow.sold && (
              <div className="rounded-xl border border-clay-oat bg-clay-cream/50 px-3 py-2 text-xs text-clay-charcoal space-y-1">
                <p>
                  Đơn bán:{' '}
                  {editingRow.soldOrder ? (
                    <Link href={`/admin/orders?highlight=${editingRow.soldOrder.id}`} className="font-medium hover:underline">
                      #{editingRow.soldOrder.id}
                    </Link>
                  ) : (
                    <span className="text-clay-silver">chưa khớp đơn</span>
                  )}
                </p>
                <p>Khách: {editingRow.soldCustomer?.fullName || editingRow.soldCustomer?.username || editingRow.soldTo || 'Không rõ'}</p>
                <p>Bán lúc: {editingRow.soldAt ? formatDate(editingRow.soldAt) : '-'}</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={closeEdit} className="clay-btn text-sm">Huỷ</button>
              <button
                type="submit"
                disabled={editMutation.isPending || !editDraft.content.trim() || !editDraft.productId}
                className="clay-btn clay-btn--matcha text-sm disabled:opacity-50"
              >
                {editMutation.isPending ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
