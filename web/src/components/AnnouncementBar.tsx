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
  const [index, setIndex] = useState(0)

  const { data } = useQuery({
    queryKey: ['public', 'announcements'],
    queryFn: () => api.get<Announcement[]>('/announcements'),
    refetchInterval: 60_000,
  })

  useEffect(() => {
    try {
      const raw = localStorage.getItem('dismissed-announcements')
      if (raw) setDismissed(new Set(JSON.parse(raw)))
    } catch {
      // ignore
    }
  }, [])

  const items = (data?.data ?? []).filter(a => !dismissed.has(a.id))
  if (items.length === 0) return null

  const ann = items[index % items.length]
  const isPinned = ann.pinned

  function dismiss(id: string) {
    const next = new Set(dismissed).add(id)
    setDismissed(next)
    try {
      localStorage.setItem('dismissed-announcements', JSON.stringify([...next]))
    } catch {
      // ignore
    }
  }

  return (
    <div
      className="border-b border-clay-oat"
      style={{ background: isPinned ? 'var(--color-lemon-400)' : 'var(--color-clay-oat-light)' }}
    >
      <div className="max-w-6xl mx-auto px-6 py-2.5 flex items-center gap-3 text-sm">
        <span className="clay-pill" style={{ background: '#fff' }}>
          {isPinned ? '📌 Ghim' : '📣 Thông báo'}
        </span>
        <div className="flex-1 truncate">
          <b className="mr-2">{ann.title}</b>
          <span className="text-clay-charcoal" dangerouslySetInnerHTML={{ __html: ann.body }} />
        </div>
        {items.length > 1 && (
          <div className="flex items-center gap-1 text-clay-charcoal text-xs">
            <button
              onClick={() => setIndex(i => (i - 1 + items.length) % items.length)}
              className="px-2 py-1 rounded hover:bg-white"
              aria-label="Trước"
            >
              ‹
            </button>
            <span>{(index % items.length) + 1}/{items.length}</span>
            <button
              onClick={() => setIndex(i => (i + 1) % items.length)}
              className="px-2 py-1 rounded hover:bg-white"
              aria-label="Sau"
            >
              ›
            </button>
          </div>
        )}
        <button
          onClick={() => dismiss(ann.id)}
          className="px-2 py-1 rounded hover:bg-white text-clay-charcoal"
          aria-label="Đóng"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
