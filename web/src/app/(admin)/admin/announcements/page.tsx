'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/utils'

interface Announcement {
  id: string
  title: string
  body: string
  target: 'all' | 'telegram' | 'web'
  pinned: boolean
  sentCount: number
  failedCount: number
  createdAt: string
}

const targetLabels: Record<string, string> = {
  all: 'Tất cả',
  telegram: 'Telegram',
  web: 'Web',
}

export default function AnnouncementsPage() {
  const queryClient = useQueryClient()

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [target, setTarget] = useState<'all' | 'telegram' | 'web'>('all')
  const [pinned, setPinned] = useState(false)

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
              </tr>
            </thead>
            <tbody>
              {announcements.map((ann) => (
                <tr key={ann.id} className="border-b border-clay-oat-light hover:bg-clay-oat-light/40">
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
                      <span style={{ color: 'var(--color-pomegranate-700)' }}>{ann.failedCount}</span>
                    ) : (
                      <span className="text-clay-silver">0</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-clay-silver text-xs">
                    {formatDate(ann.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
