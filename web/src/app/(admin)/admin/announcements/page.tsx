'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { useHighlightId, useHighlightedRowRef } from '@/lib/useHighlightedRow'

interface BroadcastError {
  userId: number
  username: string | null
  error: string
  at: string
}

interface Announcement {
  id: string
  title: string
  body: string
  target: 'all' | 'telegram' | 'web'
  pinned: boolean
  sentCount: number
  failedCount: number
  createdAt: string
  errorDetails: BroadcastError[] | null
}

const targetLabels: Record<string, string> = {
  all: 'Tất cả',
  telegram: 'Telegram',
  web: 'Web',
}

export default function AnnouncementsPage() {
  const queryClient = useQueryClient()
  const highlightId = useHighlightId()
  const refFor = useHighlightedRowRef(highlightId)

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [errorView, setErrorView] = useState<Announcement | null>(null)
  const [target, setTarget] = useState<'all' | 'telegram' | 'web'>('all')
  const [pinned, setPinned] = useState(false)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editTarget, setEditTarget] = useState<'all' | 'telegram' | 'web'>('all')
  const [editPinned, setEditPinned] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'announcements'],
    queryFn: () => api.get<Announcement[]>('/admin/announcements'),
    refetchInterval: 60000,
    refetchOnWindowFocus: false,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/admin/announcements', { title, body, target, pinned }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] })
      setTitle('')
      setBody('')
      setTarget('all')
      setPinned(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => api.patch(`/admin/announcements/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] })
      setEditing(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/announcements/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] }),
  })

  const resendMutation = useMutation({
    mutationFn: (id: string) => api.post<{ sent: number; failed: number }>(`/admin/announcements/${id}/resend`),
    onSuccess: (r) => {
      alert(`✅ Đã gửi lại: ${r.data.sent} thành công, ${r.data.failed} lỗi.`)
      queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] })
    },
    onError: (e) => alert(`❌ ${e instanceof Error ? e.message : 'Gửi lại thất bại'}`),
  })

  function openEdit(ann: Announcement) {
    setEditing(ann)
    setEditTitle(ann.title)
    setEditBody(ann.body)
    setEditTarget(ann.target)
    setEditPinned(ann.pinned)
  }

  const announcements = data?.data ?? []

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    createMutation.mutate()
  }

  return (
    <div className="space-y-6">
      <h1 className="clay-display text-3xl mb-6">Thông báo</h1>

      {/* Tạo thông báo mới */}
      <div className="clay-card p-6">
        <h3 className="text-lg font-semibold mb-4">Tạo thông báo mới</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-clay-charcoal mb-1">Tiêu đề</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="clay-input w-full"
              placeholder="Tiêu đề thông báo"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-clay-charcoal mb-1">Nội dung</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              rows={5}
              className="clay-input w-full resize-none"
              placeholder="Nội dung thông báo..."
            />
          </div>
          <div className="flex items-center gap-6">
            <div>
              <label className="block text-sm font-medium text-clay-charcoal mb-1">Đối tượng</label>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value as 'all' | 'telegram' | 'web')}
                className="clay-input text-sm"
              >
                <option value="all">Tất cả</option>
                <option value="telegram">Telegram</option>
                <option value="web">Web</option>
              </select>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                id="pinned"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
                className="w-4 h-4 border-clay-oat rounded"
              />
              <label htmlFor="pinned" className="text-sm text-clay-charcoal">
                Ghim thông báo
              </label>
            </div>
          </div>

          {createMutation.isError && (
            <p className="text-sm" style={{ color: 'var(--color-pomegranate-700)' }}>
              Lỗi: {createMutation.error instanceof Error ? createMutation.error.message : 'Gửi thất bại'}
            </p>
          )}
          {createMutation.isSuccess && (
            <p className="text-sm" style={{ color: 'var(--color-matcha-600)' }}>Gửi thông báo thành công!</p>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="clay-btn clay-btn--ink text-sm disabled:opacity-50"
            >
              {createMutation.isPending ? 'Đang gửi...' : 'Gửi thông báo'}
            </button>
          </div>
        </form>
      </div>

      {/* Lịch sử thông báo */}
      <div className="clay-card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-clay-oat bg-clay-oat-light">
          <h3 className="text-base font-semibold text-clay-charcoal">Lịch sử thông báo</h3>
        </div>
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="animate-pulse space-y-2">
                <div className="h-5 bg-clay-oat-light rounded w-48" />
                <div className="h-4 bg-clay-oat-light rounded w-full" />
                <div className="h-4 bg-clay-oat-light rounded w-64" />
              </div>
            ))}
          </div>
        ) : announcements.length === 0 ? (
          <div className="text-center py-12 text-clay-silver">Chưa có thông báo nào</div>
        ) : (
          <table className="w-full">
            <thead className="bg-clay-oat-light border-b border-clay-oat">
              <tr>
                <th className="text-left text-xs uppercase tracking-wider text-clay-charcoal py-3 px-4">Tiêu đề</th>
                <th className="text-left text-xs uppercase tracking-wider text-clay-charcoal py-3 px-4">Nội dung</th>
                <th className="text-left text-xs uppercase tracking-wider text-clay-charcoal py-3 px-4">Đối tượng</th>
                <th className="text-right text-xs uppercase tracking-wider text-clay-charcoal py-3 px-4">Đã gửi</th>
                <th className="text-right text-xs uppercase tracking-wider text-clay-charcoal py-3 px-4">Lỗi</th>
                <th className="text-left text-xs uppercase tracking-wider text-clay-charcoal py-3 px-4">Thời gian</th>
                <th className="text-right text-xs uppercase tracking-wider text-clay-charcoal py-3 px-4">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {announcements.map((ann) => (
                <tr key={ann.id} ref={refFor(ann.id)} className="border-b border-clay-oat-light hover:bg-clay-oat-light/40">
                  <td className="py-3 px-4 font-medium">
                    <div className="flex items-center gap-2">
                      {ann.title}
                      {ann.pinned && (
                        <span className="clay-pill" style={{ background: 'var(--color-lemon-400)' }}>Ghim</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-clay-charcoal text-sm max-w-xs truncate">
                    {ann.body}
                  </td>
                  <td className="py-3 px-4">
                    <span className="clay-pill">{targetLabels[ann.target] || ann.target}</span>
                  </td>
                  <td className="py-3 px-4 text-right font-medium" style={{ color: 'var(--color-matcha-600)' }}>
                    {ann.sentCount}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {ann.failedCount > 0 ? (
                      <button
                        onClick={() => setErrorView(ann)}
                        className="underline font-medium"
                        style={{ color: 'var(--color-pomegranate-700)' }}
                        title="Xem log lỗi"
                      >{ann.failedCount}</button>
                    ) : (
                      <span className="text-clay-silver">0</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-clay-silver text-xs">
                    {formatDate(ann.createdAt)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => openEdit(ann)}
                        className="clay-btn text-xs py-1 px-2"
                      >Sửa</button>
                      <button
                        onClick={() => { if (confirm(`Gửi lại "${ann.title}" cho tất cả user?`)) resendMutation.mutate(ann.id) }}
                        disabled={resendMutation.isPending}
                        className="clay-btn clay-btn--ube text-xs py-1 px-2 disabled:opacity-50"
                      >Gửi lại</button>
                      <button
                        onClick={() => { if (confirm(`Xoá "${ann.title}"?`)) deleteMutation.mutate(ann.id) }}
                        disabled={deleteMutation.isPending}
                        className="clay-btn clay-btn--pomegranate text-xs py-1 px-2 disabled:opacity-50"
                      >Xoá</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Sửa thông báo #{editing.id}</h3>
              <button type="button" onClick={() => setEditing(null)} className="opacity-60 text-xl leading-none">×</button>
            </div>
            <p className="text-xs opacity-70">Chỉ cập nhật nội dung lưu trữ. Không gửi lại — bấm Gửi lại sau khi lưu nếu cần.</p>
            <label className="block text-sm">
              <span className="text-xs opacity-70 mb-1 inline-block">Tiêu đề</span>
              <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="clay-input w-full text-sm" />
            </label>
            <label className="block text-sm">
              <span className="text-xs opacity-70 mb-1 inline-block">Nội dung</span>
              <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={5} className="clay-input w-full text-sm resize-none" />
            </label>
            <div className="flex items-center gap-3">
              <label className="block text-sm flex-1">
                <span className="text-xs opacity-70 mb-1 inline-block">Đối tượng</span>
                <select value={editTarget} onChange={(e) => setEditTarget(e.target.value as 'all' | 'telegram' | 'web')} className="clay-input w-full text-sm">
                  <option value="all">Tất cả</option>
                  <option value="telegram">Telegram</option>
                  <option value="web">Web</option>
                </select>
              </label>
              <label className="flex items-center gap-1 text-sm mt-5">
                <input type="checkbox" checked={editPinned} onChange={(e) => setEditPinned(e.target.checked)} />
                <span>Ghim</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setEditing(null)} className="clay-btn text-sm">Huỷ</button>
              <button
                type="button"
                onClick={() => updateMutation.mutate({ id: editing.id, body: { title: editTitle, body: editBody, target: editTarget, isPinned: editPinned } })}
                disabled={updateMutation.isPending || !editTitle || !editBody}
                className="clay-btn clay-btn--lemon text-sm"
              >{updateMutation.isPending ? 'Đang lưu…' : 'Lưu'}</button>
            </div>
          </div>
        </div>
      )}

      {errorView && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setErrorView(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-5 space-y-3 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Log lỗi: {errorView.title}</h3>
              <button type="button" onClick={() => setErrorView(null)} className="opacity-60 text-xl leading-none">×</button>
            </div>
            <p className="text-xs opacity-70">
              {errorView.failedCount} thất bại / {errorView.sentCount} thành công · {formatDate(errorView.createdAt)}
            </p>
            {(!errorView.errorDetails || errorView.errorDetails.length === 0) ? (
              <p className="text-sm text-clay-silver">Không có chi tiết lỗi.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {errorView.errorDetails.map((e, i) => (
                  <li key={i} className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5">
                    <div className="font-medium">
                      {e.username ? `@${e.username}` : `ID ${e.userId}`}
                      <span className="opacity-60 ml-2">{new Date(e.at).toLocaleString('vi-VN')}</span>
                    </div>
                    <div className="font-mono text-red-700 break-all">{e.error}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
