'use client'

import { useMemo } from 'react'
import { RichText } from '@/components/RichText'
import { formatRelativeTime } from '@/lib/utils'
import { HScroll } from './HScroll'

interface AnnouncementItem {
  id: string
  title: string
  body: string
  createdAt: string
}

interface Props {
  items: AnnouncementItem[]
}

export function AnnouncementCarousel({ items }: Props) {
  const safeItems = useMemo(() => items.filter((x) => !!x && !!x.id), [items])

  if (safeItems.length === 0) return null

  return (
    <HScroll ariaLabel="Danh sách thông báo">
      {safeItems.map((it) => (
        <article key={it.id} className="miniapp-ann miniapp-ann-rail-cell">
          <div className="miniapp-ann-head">
            <p className="miniapp-ann-title">{it.title}</p>
            <span className="miniapp-ann-time">{formatRelativeTime(it.createdAt)}</span>
          </div>
          <RichText html={it.body} className="miniapp-ann-body" />
        </article>
      ))}
    </HScroll>
  )
}
