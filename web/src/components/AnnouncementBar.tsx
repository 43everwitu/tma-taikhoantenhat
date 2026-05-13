'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface Announcement {
  id: string
  title: string
  body: string
  pinned: boolean
  target: string
  createdAt: string
}

export function AnnouncementBar() {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [popupOpen, setPopupOpen] = useState(false)

  const { data } = useQuery({
    queryKey: ['public', 'announcements'],
    queryFn: () => api.get<Announcement[]>('/announcements'),
    refetchInterval: 60_000,
  })

  useEffect(() => {
    try {
      const raw = localStorage.getItem('dismissed-announcements')
      if (raw) setDismissed(new Set(JSON.parse(raw)))
    } catch {}
  }, [])

  const all = data?.data ?? []
  const visible = all.filter(a => !dismissed.has(a.id))
  if (visible.length === 0) return null

  // Show ONLY the newest unread (pinned first, then by createdAt desc — backend already orders).
  const ann = visible[0]
  const isPinned = ann.pinned
  const olderCount = all.length - 1

  function dismiss(id: string) {
    const next = new Set(dismissed).add(id)
    setDismissed(next)
    try { localStorage.setItem('dismissed-announcements', JSON.stringify([...next])) } catch {}
  }

  return (
    <>
      <div
        className="border-b border-clay-oat cursor-pointer"
        style={{ background: isPinned ? 'var(--color-lemon-400)' : 'var(--color-clay-oat-light)' }}
        onClick={() => setPopupOpen(true)}
      >
        <div className="max-w-6xl mx-auto px-6 py-2.5 flex items-center gap-3 text-sm">
          <span className="clay-pill" style={{ background: '#fff' }}>
            {isPinned ? '📌 Ghim' : '📣 Thông báo'}
          </span>
          <div className="flex-1 truncate">
            <b className="mr-2">{ann.title}</b>
            <span className="text-clay-charcoal" dangerouslySetInnerHTML={{ __html: ann.body }} />
          </div>
          {olderCount > 0 && (
            <span className="text-xs text-clay-charcoal whitespace-nowrap">+{olderCount} cũ</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); dismiss(ann.id) }}
            className="px-2 py-1 rounded hover:bg-white text-clay-charcoal"
            aria-label="Đóng"
          >✕</button>
        </div>
      </div>

      {popupOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center p-4 pt-16"
          onClick={() => setPopupOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[80vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">📣 Thông báo ({all.length})</h3>
              <button type="button" onClick={() => setPopupOpen(false)} className="opacity-60 text-xl leading-none">×</button>
            </div>
            {all.length === 0 && <p className="text-sm text-clay-silver">Chưa có thông báo.</p>}
            <ul className="space-y-2">
              {all.map((a) => (
                <li
                  key={a.id}
                  className="rounded-xl p-3 border"
                  style={{
                    background: a.pinned ? 'var(--color-lemon-100, #fff8d4)' : 'var(--color-clay-oat-light)',
                    borderColor: 'var(--color-clay-oat)',
                  }}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <b className="text-sm">{a.title}</b>
                    <span className="text-xs text-clay-charcoal whitespace-nowrap">{new Date(a.createdAt).toLocaleString('vi-VN')}</span>
                  </div>
                  <div className="text-sm text-clay-charcoal" dangerouslySetInnerHTML={{ __html: a.body }} />
                  {a.pinned && <span className="inline-block mt-1 text-[10px] uppercase tracking-wide bg-lemon-400 px-1.5 py-0.5 rounded">📌 Ghim</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}
