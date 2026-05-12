'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatPrice } from '@/lib/utils'
import Link from 'next/link'
import { Search, Plus, Pencil, Trash2, Boxes, Sparkles, GripVertical, Copy } from '@/lib/icons'
import { ResponsiveTable, Column } from '@/components/ResponsiveTable'
import { RichEditor } from '@/components/RichEditor'
import { RichEditorRich } from '@/components/RichEditorRich'
import { VariantsManager } from './VariantsManager'

interface Product {
  id: string
  name: string
  category: string
  categoryId?: number
  price: number
  stock: number
  lowStockThreshold: number
  active: boolean
  description?: string
  longDescription?: string
  usageInstructions?: string
  emoji?: string
  imageUrl?: string
  promotion?: string
  contactOnly?: boolean
  contactUrl?: string
}

interface Category {
  id: number
  name: string
  slug: string
}

interface ProductForm {
  name: string
  category: string
  price: number
  emoji: string
  description: string
  longDescription: string
  usageInstructions: string
  imageUrl: string
  lowStockThreshold: number
  promotion: string
  contactOnly: boolean
  contactUrl: string
}

const emptyForm: ProductForm = {
  name: '',
  category: '',
  price: 0,
  emoji: '📦',
  description: '',
  longDescription: '',
  usageInstructions: '',
  imageUrl: '',
  lowStockThreshold: 5,
  promotion: '',
  contactOnly: false,
  contactUrl: '',
}

export default function ProductsPage() {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ProductForm>(emptyForm)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data: catsData } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<Category[]>('/categories'),
  })
  const categories = catsData?.data ?? []

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'products', debouncedSearch],
    queryFn: () => {
      let url = '/admin/products'
      if (debouncedSearch) url += `?q=${encodeURIComponent(debouncedSearch)}`
      return api.get<Product[]>(url)
    },
  })

  const createMutation = useMutation({
    mutationFn: (body: ProductForm) => api.post('/admin/products', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'products'] })
      closeModal()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ProductForm }) =>
      api.put(`/admin/products/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'products'] })
      closeModal()
    },
  })

  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/products/${id}/toggle`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'products'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/products/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'products'] }),
  })

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/products/${id}/duplicate`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'products'] }),
  })

  const reorderMutation = useMutation({
    mutationFn: (items: Array<{ id: number; sortOrder: number; categoryId?: number }>) =>
      api.patch('/admin/products/reorder', { items }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'products'] }),
  })

  // Drag-and-drop reorder state. dragId = product currently being dragged;
  // overId = row the cursor is hovering. Cross-category drops update the
  // dragged product's category_id alongside its sort_order.
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  function handleDragStart(e: React.DragEvent, id: string) {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    // Required by Firefox to actually fire dragend.
    e.dataTransfer.setData('text/plain', id)
  }
  function handleDragOver(e: React.DragEvent, id: string) {
    if (!dragId || dragId === id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOverId(id)
  }
  function handleDragLeave(id: string) {
    if (overId === id) setOverId(null)
  }
  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault()
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return }

    const dragged = allProducts.find(p => p.id === dragId)
    if (!dragged) { setDragId(null); setOverId(null); return }

    // Reorder against the full unfiltered list so sort_order remains globally
    // consistent even when a category filter is active. The dragged item is
    // placed at the target's index within allProducts; non-visible rows keep
    // their relative order.
    const without = allProducts.filter(p => p.id !== dragId)
    const targetIdx = without.findIndex(p => p.id === targetId)
    if (targetIdx < 0) { setDragId(null); setOverId(null); return }

    const reordered = [...without]
    reordered.splice(targetIdx, 0, dragged)

    // Only sort_order changes — category stays put. ORDER BY p.sort_order
    // gives a single flat ordering regardless of category.
    const items = reordered.map((p, i) => ({
      id: parseInt(p.id), sortOrder: i * 10,
    }))
    reorderMutation.mutate(items)
    setDragId(null)
    setOverId(null)
  }
  function handleDragEnd() { setDragId(null); setOverId(null) }

  const columns: Column<Product>[] = [
    {
      header: '',
      className: 'w-10 text-center',
      hideOnCard: true,
      cell: () => <GripVertical size={16} className="inline text-clay-silver cursor-grab" />,
    },
    { header: 'Mã', cell: (p) => <span className="font-mono text-xs text-clay-silver">{p.id.slice(0, 8)}</span> },
    { header: 'Tên', primary: true, cell: (p) => <span className="font-medium">{p.name}</span> },
    { header: 'Danh mục', cell: (p) => <span className="text-clay-charcoal">{p.category}</span> },
    { header: 'Giá', className: 'text-right', cell: (p) => <span className="font-medium">{formatPrice(p.price)}</span> },
    {
      header: 'Tồn kho', className: 'text-right',
      cell: (p) => {
        const isLow = p.stock <= p.lowStockThreshold
        return (
          <span className={`clay-pill ${isLow ? 'text-pomegranate-700' : ''}`}
                style={isLow ? { background: 'var(--color-pomegranate-100)' } : {}}>
            {p.stock}{isLow && ' (thấp)'}
          </span>
        )
      },
    },
    {
      header: 'Trạng thái', className: 'text-center',
      cell: (p) => (
        <button
          onClick={() => toggleMutation.mutate(p.id)}
          disabled={toggleMutation.isPending}
          className="clay-btn text-xs py-1 px-3"
          style={p.active ? { background: 'var(--color-matcha-300)' } : {}}
        >{p.active ? 'Hoạt động' : 'Tắt'}</button>
      ),
    },
    {
      header: 'Thao tác', className: 'text-center', hideOnCard: true,
      cell: (product) => (
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <Link href={`/admin/stock/${product.id}`} className="clay-btn clay-btn--ube text-xs py-1 px-3 flex items-center gap-1">
            <Boxes size={14} />Kho
          </Link>
          <button onClick={() => openEdit(product)} className="clay-btn text-xs py-1 px-3 flex items-center gap-1">
            <Pencil size={14} />Sửa
          </button>
          <button
            onClick={() => handleDelete(product.id, product.name)}
            disabled={deleteMutation.isPending}
            className="clay-btn clay-btn--pomegranate text-xs py-1 px-3 disabled:opacity-50 flex items-center gap-1"
          ><Trash2 size={14} />Xoá</button>
        </div>
      ),
    },
  ]

  function cardActions(product: Product) {
    return (
      <>
        <Link href={`/admin/stock/${product.id}`} className="clay-btn clay-btn--ube text-xs py-1 px-3 flex items-center gap-1">
          <Boxes size={14} />Kho
        </Link>
        <button onClick={() => openEdit(product)} className="clay-btn text-xs py-1 px-3 flex items-center gap-1">
          <Pencil size={14} />Sửa
        </button>
        <button
          onClick={() => duplicateMutation.mutate(product.id)}
          disabled={duplicateMutation.isPending}
          className="clay-btn text-xs py-1 px-3 flex items-center gap-1 disabled:opacity-50"
          title="Nhân đôi sản phẩm"
        ><Copy size={14} />Nhân đôi</button>
        <button
          onClick={() => handleDelete(product.id, product.name)}
          disabled={deleteMutation.isPending}
          className="clay-btn clay-btn--pomegranate text-xs py-1 px-3 disabled:opacity-50 flex items-center gap-1"
        ><Trash2 size={14} />Xoá</button>
      </>
    )
  }

  const [generatingImage, setGeneratingImage] = useState(false)
  const [imagePrompt, setImagePrompt] = useState('')

  async function handleGenerateImage() {
    if (!form.name.trim()) {
      alert('Nhập tên sản phẩm trước khi tạo ảnh AI')
      return
    }
    setGeneratingImage(true)
    try {
      const subject = [form.name, form.description].filter(Boolean).join(', ')
      const prompt = imagePrompt.trim() ||
        `${subject}, product hero shot, clay 3D illustration, pastel matcha and lemon palette, soft shadow, cute, centered composition, no text, no watermark`
      const seed = Math.floor(Math.random() * 1_000_000)
      const params = new URLSearchParams({
        width: '768', height: '768', nologo: 'true', enhance: 'true', model: 'flux', seed: String(seed),
      })
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`
      setForm(f => ({ ...f, imageUrl: url }))
    } finally {
      setGeneratingImage(false)
    }
  }

  const allProducts = data?.data ?? []
  // Client-side category filter — uses Category.slug. Server already orders
  // by sort_order so the filtered subset preserves the global ordering.
  const selectedCat = categories.find(c => c.slug === categoryFilter)
  const products = categoryFilter && selectedCat
    ? allProducts.filter(p => p.categoryId === selectedCat.id)
    : allProducts

  function openCreate() {
    setForm(emptyForm)
    setEditingId(null)
    setShowModal(true)
  }

  function openEdit(product: Product) {
    setForm({
      name: product.name,
      category: product.category,
      price: product.price,
      emoji: product.emoji || '📦',
      description: product.description || '',
      longDescription: product.longDescription || '',
      usageInstructions: product.usageInstructions || '',
      imageUrl: product.imageUrl || '',
      lowStockThreshold: product.lowStockThreshold,
      promotion: product.promotion || '',
      contactOnly: !!product.contactOnly,
      contactUrl: product.contactUrl || '',
    })
    setEditingId(product.id)
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditingId(null)
    setForm(emptyForm)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (editingId) {
      updateMutation.mutate({ id: editingId, body: form })
    } else {
      createMutation.mutate(form)
    }
  }

  function handleDelete(id: string, name: string) {
    if (confirm(`Xoá sản phẩm "${name}"? Hành động này không thể hoàn tác.`)) {
      deleteMutation.mutate(id)
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  const allSelected = products.length > 0 && products.every(p => selectedIds.has(p.id))
  const someSelected = selectedIds.size > 0
  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(products.map(p => p.id)))
  }
  function clearSelection() { setSelectedIds(new Set()) }

  async function bulkDelete() {
    if (!someSelected) return
    if (!confirm(`Xoá ${selectedIds.size} sản phẩm đã chọn?`)) return
    await Promise.all([...selectedIds].map(id => api.delete(`/admin/products/${id}`)))
    clearSelection()
    queryClient.invalidateQueries({ queryKey: ['admin', 'products'] })
  }
  async function bulkToggle() {
    if (!someSelected) return
    await Promise.all([...selectedIds].map(id => api.patch(`/admin/products/${id}/toggle`)))
    clearSelection()
    queryClient.invalidateQueries({ queryKey: ['admin', 'products'] })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="clay-display text-3xl mb-6">Sản phẩm</h1>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-clay-silver" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo tên, slug, danh mục..."
              className="clay-input text-sm w-64 pl-9"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="clay-input text-sm"
            aria-label="Lọc theo danh mục"
          >
            <option value="">Tất cả danh mục</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
          <button
            onClick={openCreate}
            className="clay-btn clay-btn--ink text-sm flex items-center gap-1.5"
          >
            <Plus size={16} />Sản phẩm mới
          </button>
        </div>
      </div>

      {someSelected && (
        <div className="flex flex-wrap items-center gap-3 p-3 rounded-2xl bg-clay-oat-light">
          <span className="text-sm font-medium">Đã chọn {selectedIds.size}</span>
          <button onClick={bulkToggle} className="clay-btn text-xs py-1 px-3">Bật / tắt</button>
          <button onClick={bulkDelete} className="clay-btn clay-btn--pomegranate text-xs py-1 px-3">Xoá</button>
          <button onClick={clearSelection} className="clay-btn text-xs py-1 px-3">Bỏ chọn</button>
        </div>
      )}

      <div className="hidden md:block clay-card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-clay-oat-light border-b border-clay-oat">
              <tr>
                <th className="text-center text-xs uppercase tracking-wider text-clay-charcoal py-3 px-2 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Chọn tất cả" />
                </th>
                <th className="text-center text-xs uppercase tracking-wider text-clay-charcoal py-3 px-2 w-10" title="Kéo & thả để sắp xếp"></th>
                <th className="text-left text-xs uppercase tracking-wider text-clay-charcoal py-3 px-4">Mã</th>
                <th className="text-left text-xs uppercase tracking-wider text-clay-charcoal py-3 px-4">Tên</th>
                <th className="text-left text-xs uppercase tracking-wider text-clay-charcoal py-3 px-4">Danh mục</th>
                <th className="text-right text-xs uppercase tracking-wider text-clay-charcoal py-3 px-4">Giá</th>
                <th className="text-right text-xs uppercase tracking-wider text-clay-charcoal py-3 px-4">Tồn kho</th>
                <th className="text-center text-xs uppercase tracking-wider text-clay-charcoal py-3 px-4">Trạng thái</th>
                <th className="text-center text-xs uppercase tracking-wider text-clay-charcoal py-3 px-4">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b border-clay-oat-light">
                    {[...Array(9)].map((_, j) => (
                      <td key={j} className="py-3 px-4">
                        <div className="h-4 bg-clay-oat-light rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-clay-silver">
                    Chưa có sản phẩm nào
                  </td>
                </tr>
              ) : (
                products.map((product) => {
                  const isLowStock = product.stock <= product.lowStockThreshold
                  const isDragging = dragId === product.id
                  const isOver = overId === product.id
                  return (
                    <tr
                      key={product.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, product.id)}
                      onDragOver={(e) => handleDragOver(e, product.id)}
                      onDragLeave={() => handleDragLeave(product.id)}
                      onDrop={(e) => handleDrop(e, product.id)}
                      onDragEnd={handleDragEnd}
                      className={`border-b border-clay-oat-light hover:bg-clay-oat-light/40 transition-colors ${
                        isDragging ? 'opacity-40' : ''
                      } ${isOver ? 'bg-lemon-100' : ''}`}
                      style={isOver ? { background: 'var(--color-lemon-100)', boxShadow: 'inset 0 2px 0 var(--color-clay-ink)' } : undefined}
                    >
                      <td className="py-3 px-2 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(product.id)}
                          onChange={() => toggleOne(product.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="py-3 px-2 text-center cursor-grab active:cursor-grabbing select-none" title="Kéo để sắp xếp">
                        <GripVertical size={16} className="inline text-clay-silver" />
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-clay-silver">
                        {product.id.slice(0, 8)}
                      </td>
                      <td className="py-3 px-4 font-medium">{product.name}</td>
                      <td className="py-3 px-4 text-clay-charcoal">{product.category}</td>
                      <td className="py-3 px-4 text-right font-medium">
                        {formatPrice(product.price)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span
                          className={`clay-pill ${isLowStock ? 'text-pomegranate-700' : ''}`}
                          style={isLowStock ? { background: 'var(--color-pomegranate-100)' } : {}}
                        >
                          {product.stock}
                          {isLowStock && ' (thấp)'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => toggleMutation.mutate(product.id)}
                          disabled={toggleMutation.isPending}
                          className="clay-btn text-xs py-1 px-3"
                          style={product.active ? { background: 'var(--color-matcha-300)' } : {}}
                        >
                          {product.active ? 'Hoạt động' : 'Tắt'}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Link
                            href={`/admin/stock/${product.id}`}
                            className="clay-btn clay-btn--ube text-xs py-1 px-3 flex items-center gap-1"
                          >
                            <Boxes size={14} />Kho
                          </Link>
                          <button
                            onClick={() => openEdit(product)}
                            className="clay-btn text-xs py-1 px-3 flex items-center gap-1"
                          >
                            <Pencil size={14} />Sửa
                          </button>
                          <button
                            onClick={() => duplicateMutation.mutate(product.id)}
                            disabled={duplicateMutation.isPending}
                            className="clay-btn text-xs py-1 px-3 flex items-center gap-1 disabled:opacity-50"
                            title="Nhân đôi sản phẩm"
                          ><Copy size={14} />Nhân đôi</button>
                          <button
                            onClick={() => handleDelete(product.id, product.name)}
                            disabled={deleteMutation.isPending}
                            className="clay-btn clay-btn--pomegranate text-xs py-1 px-3 disabled:opacity-50 flex items-center gap-1"
                          >
                            <Trash2 size={14} />Xoá
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="md:hidden">
        <ResponsiveTable
          rows={products}
          columns={columns}
          rowKey={(p) => p.id}
          loading={isLoading}
          emptyText="Chưa có sản phẩm nào"
          cardActions={cardActions}
        />
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingId ? 'Sửa sản phẩm' : 'Thêm sản phẩm mới'}
              </h3>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tên sản phẩm
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Danh mục</label>
                <input
                  type="text"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-gray-900"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Giá (VND)</label>
                  <input
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
                    required
                    min={0}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Ngưỡng tồn kho thấp
                  </label>
                  <input
                    type="number"
                    value={form.lowStockThreshold}
                    onChange={(e) =>
                      setForm({ ...form, lowStockThreshold: Number(e.target.value) })
                    }
                    min={0}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-gray-900"
                  />
                </div>
              </div>
              <label className="block text-sm font-medium text-gray-700 mt-3">Mô tả ngắn</label>
              <RichEditorRich
                value={form.description}
                onChange={(html) => setForm({ ...form, description: html })}
                placeholder="Hiển thị trên thẻ sản phẩm..."
              />

              <label className="block text-sm font-medium text-gray-700 mt-3">Mô tả chi tiết</label>
              <RichEditorRich
                value={form.longDescription}
                onChange={(html) => setForm({ ...form, longDescription: html })}
                placeholder="Mô tả đầy đủ hiển thị trên trang sản phẩm..."
              />

              <label className="block text-sm font-medium text-gray-700 mt-3">Hướng dẫn sử dụng (gửi sau khi giao hàng)</label>
              <RichEditor
                value={form.usageInstructions}
                onChange={(html) => setForm({ ...form, usageInstructions: html })}
                rows={5}
                placeholder="Cách đăng nhập, lưu ý bảo mật, link app..."
              />

              <label className="block text-sm font-medium text-gray-700 mt-3">Ảnh sản phẩm</label>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={form.imageUrl}
                    onChange={e => setForm({ ...form, imageUrl: e.target.value })}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
                    placeholder="https://... hoặc tạo bằng AI →"
                  />
                  <button
                    type="button"
                    onClick={handleGenerateImage}
                    disabled={generatingImage || !form.name.trim()}
                    className="clay-btn clay-btn--ube text-sm flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                    title="Tạo ảnh AI từ tên + mô tả (Pollinations Flux)"
                  >
                    <Sparkles size={14} />{generatingImage ? 'Đang tạo...' : 'Tạo ảnh AI'}
                  </button>
                </div>
                <input
                  type="text"
                  value={imagePrompt}
                  onChange={e => setImagePrompt(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="(Tùy chọn) Prompt riêng — bỏ trống để dùng tên + mô tả tự động"
                />
                {form.imageUrl && (
                  <img
                    src={form.imageUrl}
                    alt="Preview"
                    className="w-32 h-32 object-cover rounded-lg border border-gray-200"
                  />
                )}
              </div>

              <label className="block text-sm font-medium text-gray-700 mt-3">Emoji</label>
              <input
                type="text"
                value={form.emoji}
                onChange={e => setForm({ ...form, emoji: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder="📦"
              />

              <label className="block text-sm font-medium text-gray-700 mt-3">
                Khuyến mãi <span className="text-gray-400 font-normal">(hiển thị trên cả webapp và Telegram)</span>
              </label>
              <input
                type="text"
                value={form.promotion}
                onChange={e => setForm({ ...form, promotion: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder="🎁 Mua 2 tặng 1"
                maxLength={200}
              />

              <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.contactOnly}
                  onChange={e => setForm({ ...form, contactOnly: e.target.checked })}
                  className="h-4 w-4"
                />
                <span className="text-sm font-medium text-gray-700">
                  Chỉ liên hệ (không bán trực tiếp)
                </span>
              </label>
              <p className="text-xs text-gray-500 -mt-1">
                Khi bật, khách trên Telegram sẽ thấy nút liên hệ thay vì chọn số lượng.
              </p>

              {form.contactOnly && (
                <>
                  <label className="block text-sm font-medium text-gray-700 mt-3">URL liên hệ (Zalo / Telegram)</label>
                  <input
                    type="url"
                    value={form.contactUrl}
                    onChange={e => setForm({ ...form, contactUrl: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    placeholder="https://zalo.me/g/..."
                    maxLength={500}
                  />
                </>
              )}

              <div className="mt-4 pt-4 border-t border-gray-200">
                <VariantsManager productId={editingId} />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition"
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition"
                >
                  {isSaving ? 'Đang lưu...' : editingId ? 'Cập nhật' : 'Tạo mới'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
