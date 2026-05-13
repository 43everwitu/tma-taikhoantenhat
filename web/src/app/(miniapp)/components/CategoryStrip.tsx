'use client'

import Link from 'next/link'
import { HScroll } from './HScroll'
import { Icon } from './Icon'
import { categoryIcons } from '@/lib/miniappIcons'

interface Category { id: number; name: string; slug: string; emoji: string }

interface Props {
  items: Category[]
}

export function CategoryStrip({ items }: Props) {
  if (items.length === 0) return null
  return (
    <HScroll ariaLabel="Danh mục">
      {items.map((c) => (
        <Link
          key={c.id}
          href={`/danh-muc/${c.slug}`}
          className="miniapp-cat-strip-tile"
        >
          <span className="miniapp-cat-strip-icon">
            <Icon name={categoryIcons[c.slug] ?? 'package'} size={20} strokeWidth={1.75} />
          </span>
          <span className="miniapp-cat-strip-name">{c.name}</span>
        </Link>
      ))}
    </HScroll>
  )
}
