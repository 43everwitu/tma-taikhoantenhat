'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { Icon } from './Icon'
import { formatPrice } from '@/lib/utils'

interface Preview {
  id: string; slug: string; name: string; price: number; imageUrl?: string
}

interface Props {
  value: string
  onChange: (q: string) => void
  placeholder?: string
}

export function SearchBox({ value, onChange, placeholder }: Props) {
  const [debounced, setDebounced] = useState(value)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 200)
    return () => clearTimeout(t)
  }, [value])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const { data } = useQuery({
    queryKey: ['products', 'search-preview', debounced],
    queryFn: () => apiFetch<Preview[]>(`/products?q=${encodeURIComponent(debounced)}&limit=5`),
    enabled: debounced.length >= 2,
  })
  const previews = data ?? []

  return (
    <div ref={wrapRef} className="relative">
      <div className="miniapp-search">
        <span className="opacity-60 flex"><Icon name="search" size={18} /></span>
        <input
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder ?? 'Tìm sản phẩm…'}
          autoComplete="off"
        />
      </div>

      {open && debounced.length >= 2 && previews.length > 0 && (
        <ul className="absolute left-0 right-0 mt-1 rounded-xl shadow-lg z-30 max-h-80 overflow-y-auto"
            style={{ background: 'var(--tg-bg-2, #fff)', border: '1px solid color-mix(in srgb, var(--brand-ink) 12%, transparent)' }}>
          {previews.map((p) => (
            <li key={p.id}>
              <Link
                href={`/san-pham/${p.slug}`}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 p-2 hover:bg-black/5"
              >
                <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0" style={{ background: 'var(--brand-gold-soft)', position: 'relative' }}>
                  {p.imageUrl ? (
                    <Image src={p.imageUrl} alt={p.name} fill sizes="40px" style={{ objectFit: 'cover' }} />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center" style={{ color: 'var(--brand-gold-deep)' }}>
                      <Icon name="package" size={18} />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm line-clamp-1">{p.name}</p>
                  <p className="text-xs opacity-70">{formatPrice(p.price)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
